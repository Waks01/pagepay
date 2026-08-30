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
from app.models import Payment, AdminUser, Task, TaskSubmission
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
        start = datetime.fromisoformat(start_date)
    if end_date:
        end = datetime.fromisoformat(end_date)

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

    # Ad revenue removed
    ad_revenue_usd = 0.0
    ad_revenue_ngn_kobo = 0
    ad_platform_share_usd = 0.0
    ad_platform_share_ngn = 0
    ad_user_share_usd = 0.0
    ad_user_share_ngn = 0
    total_points = 0

    # Combined totals
    total_revenue_usd = premium_revenue_usd
    total_revenue_ngn = int(prem_rev_kobo) + task_revenue_kobo
    platform_earnings_ngn = int(prem_rev_kobo) + task_platform_share_kobo
    user_earnings_ngn = task_worker_share_kobo

    return RevenueSummary(
        ad_revenue_usd=0.0,
        ad_revenue_ngn=0,
        ad_platform_share_usd=0.0,
        ad_platform_share_ngn=0,
        ad_user_share_usd=0.0,
        ad_user_share_ngn=0,
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


@router.get("/daily")
async def revenue_daily(
    days: int = Query(30, ge=1, le=366),
    current_admin: AdminUser = Depends(require_permission("finance.view")),
    db: AsyncSession = Depends(get_db),
):
    """Daily revenue breakdown (ad + premium, in NGN kobo) for the last
    `days` days. Powers the revenue trend chart on the admin Finance page.
    """
    from app.services import fx

    end = datetime.utcnow()
    start = end - timedelta(days=days)

    # Ad revenue per day removed

    # Premium revenue per day (kobo)
    prem_rows = await db.execute(
        select(
            func.date(Payment.created_at).label("day"),
            func.sum(Payment.amount_kobo).label("amt"),
        )
        .where(Payment.created_at >= start)
        .where(Payment.created_at <= end)
        .where(Payment.status == "success")
        .group_by(func.date(Payment.created_at))
    )

    prem_by_day: dict[str, int] = {}
    for row in prem_rows.mappings().all():
        prem_by_day[str(row["day"])] = int(row["amt"] or 0)

    # Build a contiguous day series
    items = []
    cursor = start.date()
    while cursor <= end.date():
        day_str = cursor.isoformat()
        ad_kobo = 0
        prem_kobo = prem_by_day.get(day_str, 0)
        items.append({
            "date": day_str,
            "ad_revenue_kobo": 0,
            "premium_revenue_kobo": prem_kobo,
            "total_revenue_kobo": prem_kobo,
        })
        cursor += timedelta(days=1)

    return {"items": items, "days": days}
