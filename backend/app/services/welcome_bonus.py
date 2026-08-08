"""
Welcome bonus + welcome email + in-app notification for brand-new users.

Called from `routers/auth.py:register()` immediately after the user row
commits. Idempotency is enforced by the UNIQUE(user_id, source) constraint
on `point_credits` — a duplicate insert for the same user is a no-op, never
a double credit.

All side effects (email, in-app notification, push) are best-effort:
failures are logged but never propagate, so a flaky email provider or
push service can't break the /auth/register response. The user is
created + tokens issued even if every welcome message fails.
"""
import asyncio
import logging

from sqlalchemy import insert, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PointCredit, User
from app.services.email import send_welcome_email
from app.services.notifications import create_notification
from app.config import settings

logger = logging.getLogger("uvicorn.error")

WELCOME_BONUS_SOURCE = "welcome_bonus"


async def grant_welcome_bonus(db: AsyncSession, user: User) -> bool:
    """Credit the welcome bonus + fire side-effect messages.

    Returns True if the bonus was newly credited to this user (and the
    email + notification were sent). Returns False if a row already
    existed for `(user_id, 'welcome_bonus')` — the idempotency guard —
    in which case no side effects fire (no duplicate email, no duplicate
    notification).

    Set `settings.welcome_bonus_points = 0` to disable the bonus entirely;
    the function returns False without firing any side effects.
    """
    bonus_points = settings.welcome_bonus_points
    if bonus_points <= 0:
        logger.info(
            "Welcome bonus skipped: WELCOME_BONUS_POINTS=0 (user_id=%s)", user.id
        )
        return False

    # 1. Idempotency insert. The UNIQUE(user_id, source) constraint on
    #    point_credits catches a retry; rowcount=0 means a row already
    #    existed and we must NOT credit again.
    if settings.database_url.startswith("sqlite"):
        # SQLite (tests) doesn't support ON CONFLICT DO NOTHING in the
        # same way — use the dialect-agnostic `insert()` with prefix
        # `OR IGNORE` for SQLite, otherwise ON CONFLICT for postgres.
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert  # type: ignore

        stmt = (
            sqlite_insert(PointCredit)
            .values(
                user_id=user.id,
                source=WELCOME_BONUS_SOURCE,
                points=bonus_points,
                metadata_json={"trigger": "register"},
            )
            .on_conflict_do_nothing(index_elements=["user_id", "source"])
        )
    else:
        stmt = (
            pg_insert(PointCredit)
            .values(
                user_id=user.id,
                source=WELCOME_BONUS_SOURCE,
                points=bonus_points,
                metadata_json={"trigger": "register"},
            )
            .on_conflict_do_nothing(index_elements=["user_id", "source"])
        )

    result = await db.execute(stmt)
    inserted = result.rowcount or 0
    await db.commit()

    if inserted == 0:
        # A row already existed — idempotency guard fired. Skip the
        # credit and the side effects so we don't send a duplicate
        # welcome email or notification.
        logger.info(
            "Welcome bonus already claimed for user_id=%s; skipping duplicate credit",
            user.id,
        )
        return False

    # 2. Credit the wallet. Same atomic-increment pattern as the AdMob
    #    SSV handler in routers/ads.py.
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(points_balance=User.points_balance + bonus_points)
    )
    await db.commit()
    await db.refresh(user)

    logger.info(
        "Welcome bonus credited: user_id=%s points=%d new_balance=%d",
        user.id,
        bonus_points,
        user.points_balance,
    )

    # 3. Welcome email + 4. in-app notification. Both best-effort; never
    #    raise. The user is already logged in by this point — a failed
    #    email must not 500 the response.
    bonus_naira = bonus_points / max(1, settings.points_per_naira)

    try:
        if user.email:
            await send_welcome_email(
                to=user.email,
                name=user.email.split("@")[0],
                bonus_points=bonus_points,
                bonus_naira=bonus_naira,
            )
    except Exception as exc:
        logger.error(
            "Welcome email failed for user_id=%s: %s", user.id, exc
        )

    try:
        await create_notification(
            db,
            user_id=user.id,
            title="Welcome bonus!",
            body=(
                f"+{bonus_points:,} points (₦{bonus_naira:,.2f}) have been "
                "credited to your wallet as a welcome gift."
            ),
            category=WELCOME_BONUS_SOURCE,
            data={"points": bonus_points, "naira": bonus_naira},
        )
    except Exception as exc:
        logger.error(
            "Welcome notification failed for user_id=%s: %s", user.id, exc
        )

    # Push notification: fire-and-forget so the FCM round-trip never
    # adds latency to /auth/register. Uses the existing
    # `wallet_updates` category in user_notification_preferences so
    # users who already muted wallet pushes stay quiet. Most users
    # on a fresh device won't have an FCM token yet (they register
    # the token after the first /login), so the helper will return
    # {"reason": "no_tokens"} and log only — that's the expected
    # path for the *first* signup but the *second* (e.g. a re-issued
    # token) will start delivering.
    try:
        from app.services.fcm import send_push_notification_background

        asyncio.create_task(
            send_push_notification_background(
                user_id=user.id,
                title="Welcome bonus! 🎉",
                body=(
                    f"+{bonus_points:,} points (₦{bonus_naira:,.2f}) "
                    "credited to your wallet."
                ),
                data={"type": "welcome_bonus", "points": str(bonus_points)},
                category="wallet_updates",
            )
        )
    except Exception as exc:
        logger.error(
            "Welcome push failed for user_id=%s: %s", user.id, exc
        )

    return True