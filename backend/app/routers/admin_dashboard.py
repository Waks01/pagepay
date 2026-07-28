"""Admin dashboard statistics endpoints.

Provides high-level overview of platform metrics including users,
revenue, payouts, fraud flags, and community moderation queue.
Real-time data aggregation from multiple sources.
"""

import logging
from datetime import date, datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import settings
from app.models import (
    User, ReadingSession, AdEvent, PayoutTransaction, Payment, CommunityNote,
    FraudFlag, AdminUser, Task, TaskSubmission,
)
from app.schemas import DashboardStats
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/dashboard", tags=["admin-dashboard"])


@router.get("/stats", response_model=DashboardStats)
async def dashboard_stats(
    days: int | None = Query(None, ge=1, le=366),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    current_admin: AdminUser = Depends(require_permission("dashboard.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get high-level dashboard statistics for a date window.

    Defaults to "today". Pass `days` (e.g. 7/30/90) or explicit
    `start_date`/`end_date` (ISO date) to scope the time-bounded
    aggregations (active users, ad revenue, task & premium revenue).
    Global counts (total users, pending payouts/notes, high fraud) are
    always returned irrespective of the window.
    """
    from app.services import fx
    from datetime import timedelta

    logger.info(
        "dashboard_stats: admin=%s days=%s start_date=%s end_date=%s",
        current_admin.email if current_admin else None,
        days,
        start_date,
        end_date,
    )

    if start_date and end_date:
        try:
            window_start = datetime.fromisoformat(start_date)
            window_end = datetime.fromisoformat(end_date) + timedelta(days=1)
        except ValueError as exc:
            logger.error("dashboard_stats: bad date format: %s", exc)
            raise HTTPException(status_code=400, detail=f"Invalid date format: {exc}")
        logger.info("dashboard_stats: custom window %s..%s", window_start, window_end)
    elif days:
        window_end = datetime.utcnow()
        window_start = window_end - timedelta(days=days)
        logger.info("dashboard_stats: rolling %d-day window %s..%s", days, window_start, window_end)
    else:
        window_start = datetime.combine(date.today(), datetime.min.time())
        window_end = datetime.utcnow()
        logger.info("dashboard_stats: today-only window %s..%s", window_start, window_end)

    # Basic stats
    total_users = (await db.execute(select(func.count(User.id)))).scalar_one()
    active_today = (
        await db.execute(
            select(func.count(func.distinct(ReadingSession.user_id))).where(
                ReadingSession.start_time >= window_start,
                ReadingSession.start_time <= window_end,
            )
        )
    ).scalar_one()
    pending_payouts = (
        await db.execute(
            select(func.count(PayoutTransaction.id)).where(
                PayoutTransaction.status == "pending"
            )
        )
    ).scalar_one()
    pending_notes = (
        await db.execute(
            select(func.count(CommunityNote.id)).where(
                CommunityNote.status == "pending"
            )
        )
    ).scalar_one()
    high_fraud = (
        await db.execute(
            select(func.count(FraudFlag.id)).where(
                FraudFlag.severity == "high",
                FraudFlag.status == "pending",
            )
        )
    ).scalar_one()

    # Ad Revenue - Calculate using historical FX rates stored in each AdEvent.
    # Include both legacy events (with revenue_usd) and SSV events (with user_points_credited).
    ad_events = (
        await db.execute(
            select(
                AdEvent.revenue_usd,
                AdEvent.fx_rate_used,
                AdEvent.user_points_credited,
            )
            .where(AdEvent.created_at >= window_start)
            .where(AdEvent.created_at <= window_end)
            .where(AdEvent.credit_status == "credited")
        )
    ).all()

    ad_revenue_usd = 0.0
    ad_revenue_ngn_kobo = 0
    total_points = 0

    for event in ad_events:
        if event.revenue_usd and event.fx_rate_used:
            # Convert from micro-units
            usd = float(event.revenue_usd) / 1_000_000
            fx_rate = float(event.fx_rate_used) / 1_000_000
            ngn = usd * fx_rate
            kobo = int(ngn * 100)

            ad_revenue_usd += usd
            ad_revenue_ngn_kobo += kobo

        if event.user_points_credited:
            total_points += event.user_points_credited

    # Calculate platform/user split for ads from config
    PLATFORM_SHARE = settings.platform_ad_revenue_percent
    USER_SHARE = 1.0 - PLATFORM_SHARE

    ad_platform_share_usd = ad_revenue_usd * PLATFORM_SHARE
    ad_user_share_usd = ad_revenue_usd * USER_SHARE
    ad_platform_share_ngn = int(ad_revenue_ngn_kobo * PLATFORM_SHARE)
    ad_user_share_ngn = int(ad_revenue_ngn_kobo * USER_SHARE)

    # Task Revenue - from completed task submissions today
    task_revenue_kobo = 0
    task_platform_share_kobo = 0
    task_worker_share_kobo = 0

    today_task_submissions = (
        await db.execute(
            select(TaskSubmission)
            .join(Task, Task.id == TaskSubmission.task_id)
            .where(TaskSubmission.payment_status == "paid")
            .where(TaskSubmission.paid_at >= window_start)
            .where(TaskSubmission.paid_at <= window_end)
        )
    ).scalars().all()

    for submission in today_task_submissions:
        task = await db.get(Task, submission.task_id)
        if task:
            reward = submission.reward_paid or 0
            task_revenue_kobo += task.reward_amount
            task_platform_share_kobo += task.platform_fee_amount
            task_worker_share_kobo += reward

    # Premium Revenue (already in kobo)
    premium_revenue_kobo = (
        await db.execute(
            select(func.sum(Payment.amount_kobo)).where(
                Payment.status == "success",
                Payment.created_at >= window_start,
                Payment.created_at <= window_end,
            )
        )
    ).scalar_one() or 0

    # Get current FX rate
    current_fx = 0.0
    premium_revenue_usd = 0.0
    try:
        fx_rate = await fx.get_usd_to_ngn()
        current_fx = fx_rate.rate
        # Convert premium to USD using current FX rate
        if premium_revenue_kobo > 0:
            premium_ngn = float(premium_revenue_kobo) / 100
            premium_revenue_usd = premium_ngn / fx_rate.rate
    except Exception as exc:
        logger.error("FX lookup failed in dashboard stats: %s", exc)

    # Combined totals
    total_revenue_usd = ad_revenue_usd + premium_revenue_usd
    total_revenue_ngn = ad_revenue_ngn_kobo + int(premium_revenue_kobo) + task_revenue_kobo
    platform_earnings_ngn = ad_platform_share_ngn + int(premium_revenue_kobo) + task_platform_share_kobo
    user_earnings_ngn = ad_user_share_ngn + task_worker_share_kobo

    return DashboardStats(
        total_users=int(total_users),
        active_users_today=int(active_today),
        ad_revenue_usd=ad_revenue_usd,
        ad_revenue_ngn=ad_revenue_ngn_kobo,
        ad_platform_share_usd=ad_platform_share_usd,
        ad_platform_share_ngn=ad_platform_share_ngn,
        ad_user_share_usd=ad_user_share_usd,
        ad_user_share_ngn=ad_user_share_ngn,
        task_revenue_ngn=task_revenue_kobo,
        task_platform_share_ngn=task_platform_share_kobo,
        task_worker_share_ngn=task_worker_share_kobo,
        premium_revenue_ngn=int(premium_revenue_kobo),
        premium_revenue_usd=premium_revenue_usd,
        total_revenue_usd=total_revenue_usd,
        total_revenue_ngn=total_revenue_ngn,
        platform_earnings_ngn=platform_earnings_ngn,
        user_earnings_ngn=user_earnings_ngn,
        total_points_distributed=total_points,
        pending_payouts=int(pending_payouts),
        pending_notes=int(pending_notes),
        high_severity_fraud_flags=int(high_fraud),
    )
