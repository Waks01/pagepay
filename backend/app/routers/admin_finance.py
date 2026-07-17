"""Finance and revenue reporting endpoints.

Revenue summaries combining ad revenue and premium subscriptions.
Tracks platform earnings, user earnings, and financial metrics.
Supports date range filtering for custom reporting periods.
"""

import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.config import settings
from app.models import AdEvent, Payment, AdminUser, Task, TaskSubmission
from app.schemas import RevenueSummary
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/revenue", tags=["admin-finance"])


@router.get("/summary")
async def revenue_summary(
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    current_admin: AdminUser = Depends(require_permission("finance.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get revenue summary for a date range (default: last 30 days)."""
    from app.services import fx

    end = datetime.utcnow()
    start = end - timedelta(days=30)
    
    if start_date:
        start = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
    if end_date:
        end = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)

    # Ad Revenue - Calculate using historical FX rates.
    # Include both legacy events (with revenue_usd) and SSV events (with user_points_credited).
    ad_events = (
        await db.execute(
            select(
                AdEvent.revenue_usd,
                AdEvent.fx_rate_used,
                AdEvent.user_points_credited,
            )
            .where(AdEvent.created_at >= start)
            .where(AdEvent.created_at <= end)
            .where(AdEvent.credit_status == "credited")
        )
    ).all()

    ad_revenue_usd = 0.0
    ad_revenue_ngn_kobo = 0
    total_points = 0
    total_fx_rate = 0.0
    fx_count = 0

    for event in ad_events:
        if event.revenue_usd and event.fx_rate_used:
            # Convert from micro-units
            usd = float(event.revenue_usd) / 1_000_000
            fx_rate = float(event.fx_rate_used) / 1_000_000
            ngn = usd * fx_rate
            kobo = int(ngn * 100)

            ad_revenue_usd += usd
            ad_revenue_ngn_kobo += kobo
            total_fx_rate += fx_rate
            fx_count += 1

        if event.user_points_credited:
            total_points += event.user_points_credited

    # Calculate average FX rate used during period
    average_fx_rate = (
        total_fx_rate / fx_count if fx_count > 0 else 0.0
    )

    # Calculate platform/user split for ads from config
    PLATFORM_SHARE = settings.platform_ad_revenue_percent
    USER_SHARE = 1.0 - PLATFORM_SHARE

    ad_platform_share_usd = ad_revenue_usd * PLATFORM_SHARE
    ad_user_share_usd = ad_revenue_usd * USER_SHARE
    ad_platform_share_ngn = int(ad_revenue_ngn_kobo * PLATFORM_SHARE)
    ad_user_share_ngn = int(ad_revenue_ngn_kobo * USER_SHARE)

    # Premium Revenue (already in kobo)
    prem_rev_kobo = (
        await db.execute(
            select(func.sum(Payment.amount_kobo)).where(
                Payment.status == "success",
                Payment.created_at >= start,
                Payment.created_at <= end,
            )
        )
    ).scalar_one() or 0

    # Get current FX rate
    current_fx = 0.0
    premium_revenue_usd = 0.0

    # Always fetch current FX rate
    fx_rate_obj = await fx.get_usd_to_ngn()
    current_fx = fx_rate_obj.rate

    # Convert premium to USD using current FX rate
    if prem_rev_kobo > 0:
        premium_ngn = float(prem_rev_kobo) / 100
        premium_revenue_usd = premium_ngn / current_fx

    # Task Revenue - from published tasks in the period
    task_revenue_kobo = 0
    task_platform_share_kobo = 0
    task_worker_share_kobo = 0

    completed_task_submissions = (
        await db.execute(
            select(TaskSubmission)
            .join(Task, Task.id == TaskSubmission.task_id)
            .where(TaskSubmission.payment_status == "paid")
            .where(TaskSubmission.paid_at >= start)
            .where(TaskSubmission.paid_at <= end)
        )
    ).scalars().all()

    for submission in completed_task_submissions:
        task = await db.get(Task, submission.task_id)
        if task:
            reward = submission.reward_paid or 0
            task_revenue_kobo += task.reward_amount
            task_platform_share_kobo += task.platform_fee_amount
            task_worker_share_kobo += reward

    # Combined totals
    total_revenue_usd = ad_revenue_usd + premium_revenue_usd
    total_revenue_ngn = ad_revenue_ngn_kobo + int(prem_rev_kobo) + task_revenue_kobo
    platform_earnings_ngn = ad_platform_share_ngn + int(prem_rev_kobo) + task_platform_share_kobo
    user_earnings_ngn = ad_user_share_ngn + task_worker_share_kobo

    return RevenueSummary(
        ad_revenue_usd=ad_revenue_usd,
        ad_revenue_ngn=ad_revenue_ngn_kobo,
        ad_platform_share_usd=ad_platform_share_usd,
        ad_platform_share_ngn=ad_platform_share_ngn,
        ad_user_share_usd=ad_user_share_usd,
        ad_user_share_ngn=ad_user_share_ngn,
        task_revenue_ngn=task_revenue_kobo,
        task_platform_share_ngn=task_platform_share_kobo,
        task_worker_share_ngn=task_worker_share_kobo,
        premium_revenue_ngn=int(prem_rev_kobo),
        premium_revenue_usd=premium_revenue_usd,
        total_revenue_usd=total_revenue_usd,
        total_revenue_ngn=total_revenue_ngn,
        platform_earnings_ngn=platform_earnings_ngn,
        user_earnings_ngn=user_earnings_ngn,
        total_points_distributed=total_points,
        average_fx_rate=average_fx_rate,
        current_fx_rate=current_fx,
        period_start=start.isoformat(),
        period_end=end.isoformat(),
    )
