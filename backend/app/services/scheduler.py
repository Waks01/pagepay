import logging
from datetime import date, datetime, time, timedelta

from sqlalchemy import delete, select
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.database import AsyncSessionLocal
from app.models import User, UserStreak, UserNotificationPreference, Notification, ReadingSession
from app.services.fcm import send_push_notification, is_in_quiet_hours
from app.services.notifications import create_notification
from app.services.cron import expire_subscriptions

logger = logging.getLogger("uvicorn.error")


async def send_daily_study_reminder() -> None:
    today = date.today()
    today_start = datetime.combine(today, time.min)
    sent = 0

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User.id, UserStreak.current_streak, UserNotificationPreference)
            .outerjoin(UserStreak, User.id == UserStreak.user_id)
            .outerjoin(UserNotificationPreference, User.id == UserNotificationPreference.user_id)
            .where(User.status == "active")
        )

        for user_id, streak, prefs in result.fetchall():
            if prefs and not getattr(prefs, "study_reminders", True):
                continue
            if prefs and not getattr(prefs, "push_enabled", True):
                continue
            if prefs.quiet_hours_start and prefs.quiet_hours_end:
                now_time = datetime.utcnow().time()
                if is_in_quiet_hours(now_time, prefs.quiet_hours_start, prefs.quiet_hours_end):
                    continue

            already_sent = await db.execute(
                select(Notification).where(
                    Notification.user_id == user_id,
                    Notification.category == "study_reminders",
                    Notification.created_at >= today_start,
                )
            )
            if already_sent.scalar_one_or_none():
                continue

            streak_days = streak.current_streak if streak else 0
            await create_notification(
                db=db,
                user_id=user_id,
                title="📚 Time to study!",
                body=f"Keep your {streak_days}-day streak going.",
                category="study_reminders",
                data={"type": "study_reminder", "streak": str(streak_days)},
            )
            await send_push_notification(
                db=db,
                user_id=user_id,
                title="📚 Time to study!",
                body=f"Keep your {streak_days}-day streak going.",
                category="study_reminders",
            )
            sent += 1

    logger.info("Daily study reminder sent to %d users", sent)


def register_daily_reminder_job(scheduler: AsyncIOScheduler) -> None:
    scheduler.add_job(
        send_daily_study_reminder,
        "cron",
        hour=8,
        minute=0,
        misfire_grace_time=3600,
        coalesce=True,
        id="daily_study_reminder",
        replace_existing=True,
    )


async def cleanup_old_reading_sessions() -> None:
    now = datetime.utcnow()
    unverified_cutoff = now - timedelta(days=7)
    verified_cutoff = now - timedelta(days=60)

    async with AsyncSessionLocal() as db:
        unverified_deleted = await db.execute(
            delete(ReadingSession)
            .where(ReadingSession.end_time.is_not(None))
            .where(ReadingSession.verified == False)  # noqa: E712
            .where(ReadingSession.end_time < unverified_cutoff)
        )
        verified_deleted = await db.execute(
            delete(ReadingSession)
            .where(ReadingSession.end_time.is_not(None))
            .where(ReadingSession.verified == True)  # noqa: E712
            .where(ReadingSession.end_time < verified_cutoff)
        )
        await db.commit()

    logger.info(
        "ReadingSession cleanup: removed %d unverified, %d verified sessions",
        unverified_deleted.rowcount,
        verified_deleted.rowcount,
    )


def register_reading_session_cleanup_job(scheduler: AsyncIOScheduler) -> None:
    scheduler.add_job(
        cleanup_old_reading_sessions,
        "cron",
        hour=3,
        minute=0,
        misfire_grace_time=7200,
        coalesce=True,
        id="reading_session_cleanup",
        replace_existing=True,
    )


async def expire_premium_subscriptions() -> None:
    count = 0
    async with AsyncSessionLocal() as db:
        try:
            count = await expire_subscriptions(db)
        except Exception as exc:
            logger.error("Subscription expiry APScheduler job failed: %s", exc)

    if count:
        logger.info("APScheduler expired %d premium subscriptions", count)
    else:
        logger.info("APScheduler subscription expiry check: none expired")


def register_subscription_expiry_job(scheduler: AsyncIOScheduler) -> None:
    scheduler.add_job(
        expire_premium_subscriptions,
        "cron",
        hour=4,
        minute=0,
        misfire_grace_time=7200,
        coalesce=True,
        id="subscription_expiry_check",
        replace_existing=True,
    )
