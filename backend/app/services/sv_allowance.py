"""Premium's monthly SV allowance.

This is what makes the N3,000 subscription defensible rather than a
price bump on Study+. Without it the subscription buys free unlocks and
a chat quota, which at ~N250/month of serving cost is not worth N3,000;
with an allowance the subscriber is buying compute they will actually
spend, and every SV they buy beyond it is margin.

Idempotent by construction: a grant is recorded as a `StudyTransaction`
with `method="allowance"`, and a second grant in the same calendar
month is refused. Reusing the existing ledger keeps this to a
deployment with no migration — a new table would need one.

Two deliberate choices:

- The allowance lands in `service_credit_balance`, the spendable side.
  A withdrawable monthly grant would turn the subscription into a
  cash-out route: pay N3,000, claim N250 withdrawable, withdraw.
- It is a *top-up*, not a stake. A subscriber who did not spend last
  month's allowance still gets this month's; the subscription already
  charges for the entitlement, so withholding it would penalise a
  careful user for being careful.
"""

from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import StudyTransaction, User, UserTier
from app.services.subscription import is_premium

logger = logging.getLogger("uvicorn.error")

METHOD_ALLOWANCE = "allowance"


def _month_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def allowance_granted_this_month(
    db: AsyncSession, user_id: int, now: datetime | None = None
) -> bool:
    """True if the monthly allowance has already been granted."""
    now = now or datetime.utcnow()
    row = await db.execute(
        select(StudyTransaction.id)
        .where(
            StudyTransaction.user_id == user_id,
            StudyTransaction.method == METHOD_ALLOWANCE,
            StudyTransaction.created_at >= _month_start(now),
        )
        .limit(1)
    )
    return row.scalar_one_or_none() is not None


async def grant_allowance(
    db: AsyncSession, user: User, now: datetime | None = None
) -> int:
    """Credit the monthly allowance. Returns the amount granted (0 if already granted).

    Raises nothing for an ineligible user — returns 0, so a sweep over
    all users can call this unconditionally.
    """
    now = now or datetime.utcnow()
    amount = int(settings.premium_sv_monthly_allowance)
    if amount <= 0 or not is_premium(user):
        return 0
    if await allowance_granted_this_month(db, user.id, now):
        return 0

    db.add(
        StudyTransaction(
            user_id=user.id,
            asset_id=None,
            method=METHOD_ALLOWANCE,
            points_spent=0,
            reward_granted=True,
        )
    )
    if settings.wallet_split_enabled:
        user.service_credit_balance = (user.service_credit_balance or 0) + amount
    else:
        user.points_balance = (user.points_balance or 0) + amount
    await db.commit()
    return amount


async def grant_all_allowances(now: datetime | None = None) -> int:
    """Sweep every active premium subscriber and top up the allowance.

    Returns the number of users granted. Designed to be cheap to run
    daily: a user who already had this month's allowance costs one
    indexed SELECT, and the whole sweep is one transaction per payout
    rather than one big transaction, so a failure mid-sweep leaves the
    users already granted alone.
    """
    from app.database import AsyncSessionLocal

    now = now or datetime.utcnow()
    granted = 0
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(User).where(User.status == "active").where(
                    User.subscription_expires_at.is_not(None)
                )
            )
        ).scalars().all()

        for user in rows:
            if not is_premium(user):
                continue
            try:
                if await grant_allowance(db, user, now):
                    granted += 1
            except Exception as exc:
                logger.warning("Allowance grant failed for user=%s: %s", user.id, exc)
                try:
                    await db.rollback()
                except Exception:
                    pass
    return granted


# Re-exported for the scheduler job's import convenience.
__all__ = [
    "METHOD_ALLOWANCE",
    "allowance_granted_this_month",
    "grant_allowance",
    "grant_all_allowances",
    "UserTier",
]
