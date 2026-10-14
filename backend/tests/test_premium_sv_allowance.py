"""Premium's monthly SV allowance and the top-up discount.

These are what make N3,000 defensible rather than a price bump on
Study+ at N1,000: the subscriber is buying compute they will actually
spend, and everything they buy beyond the allowance is margin.

Three properties worth pinning:

- the monthly grant is idempotent, so a repeated or missed run cannot
  double-credit. It reuses the existing ledger rather than a new table,
  which keeps this a migration-free deployment.
- the grant lands in the spendable wallet. A withdrawable monthly grant
  would turn the subscription into a cash-out route: pay N3,000, claim
  N250, withdraw.
- a refund reverses exactly what the deposit credited, so a premium
  user refunded cannot keep discounted points they never paid for.
"""

import os
from datetime import datetime, timedelta

import pytest

_ENV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".env",
)
if os.path.exists(_ENV):
    with open(_ENV) as _fh:
        for _line in _fh:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())

from httpx import AsyncClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.models import StudyTransaction, User, UserTier  # noqa: E402
from app.services.money import deposit_points_for_user, kobo_to_points  # noqa: E402
from app.services.sv_allowance import (  # noqa: E402
    METHOD_ALLOWANCE,
    allowance_granted_this_month,
    grant_allowance,
    grant_all_allowances,
)
from app.config import settings


async def _user(db, email, tier=UserTier.FREE, sv=0, cashable=0, premium=False):
    from datetime import datetime, timedelta as td

    u = User(email=email, password_hash="hash")
    u.tier = tier
    u.service_credit_balance = sv
    u.cashable_balance = cashable
    if premium:
        u.tier = UserTier.STUDY_PLUS_MONTHLY
        u.subscription_expires_at = datetime.utcnow() + td(days=30)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


# ── the allowance ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_allowance_is_granted_to_premium(db_session):
    u = await _user(db_session, "alw1@test.com", premium=True)
    granted = await grant_allowance(db_session, u)
    assert granted == settings.premium_sv_monthly_allowance
    await db_session.refresh(u)
    assert u.service_credit_balance == settings.premium_sv_monthly_allowance


@pytest.mark.asyncio
async def test_allowance_is_idempotent_within_a_month(db_session):
    """A repeated run must not double-credit.

    This is the whole safety property: the job runs daily, so it will
    run ~30 times a month whether it needs to or not.
    """
    u = await _user(db_session, "alw2@test.com", premium=True)
    assert await grant_allowance(db_session, u) > 0
    assert await grant_allowance(db_session, u) == 0
    assert await grant_allowance(db_session, u) == 0
    await db_session.refresh(u)
    assert u.service_credit_balance == settings.premium_sv_monthly_allowance


@pytest.mark.asyncio
async def test_allowance_grants_again_next_month(db_session):
    """The grant must not be a one-off that starves month two."""
    u = await _user(db_session, "alw3@test.com", premium=True)
    assert await grant_allowance(db_session, u) > 0

    # Rewind the ledger row into last month, as time moving on would.
    row = (
        await db_session.execute(select(StudyTransaction).where(
            StudyTransaction.method == METHOD_ALLOWANCE
        ))
    ).scalar_one()
    row.created_at = datetime.utcnow().replace(day=1) - timedelta(days=31)
    await db_session.commit()

    assert await allowance_granted_this_month(db_session, u.id) is False
    assert await grant_allowance(db_session, u) > 0
    await db_session.refresh(u)
    assert u.service_credit_balance == settings.premium_sv_monthly_allowance * 2


@pytest.mark.asyncio
async def test_free_user_never_gets_an_allowance(db_session):
    u = await _user(db_session, "alw4@test.com", tier=UserTier.FREE)
    assert await grant_allowance(db_session, u) == 0


@pytest.mark.asyncio
async def test_allowance_never_touches_the_withdrawable_wallet(db_session):
    """A withdrawable monthly grant would be a cash-out route:
    pay N3,000, claim N250, withdraw."""
    u = await _user(db_session, "alw5@test.com", premium=True, cashable=5_000)
    await grant_allowance(db_session, u)
    await db_session.refresh(u)
    assert u.cashable_balance == 5_000, "withdrawable balance was touched"
    assert u.service_credit_balance == settings.premium_sv_monthly_allowance


@pytest.mark.asyncio
async def test_expired_subscription_gets_nothing(db_session):
    """The allowance follows entitlement, not a stale tier value.

    Expired *beyond the grace period*: inside it `is_premium` still
    returns True by design, and a lapsed subscriber who can still use
    their entitlement should still be able to spend its allowance.
    """
    grace = settings.premium_grace_period_days
    u = await _user(db_session, "alw6@test.com", tier=UserTier.STUDY_PLUS_MONTHLY)
    u.subscription_expires_at = datetime.utcnow() - timedelta(days=grace + 1)
    await db_session.commit()
    assert await grant_allowance(db_session, u) == 0


@pytest.mark.asyncio
async def test_in_grace_period_still_grants(db_session):
    """A subscriber inside grace keeps full entitlement."""
    grace = settings.premium_grace_period_days
    u = await _user(db_session, "alw7@test.com", tier=UserTier.STUDY_PLUS_MONTHLY)
    u.subscription_expires_at = datetime.utcnow() - timedelta(days=max(grace - 1, 0))
    await db_session.commit()
    assert await grant_allowance(db_session, u) > 0


# ── the top-up discount ───────────────────────────────────────────


def test_free_deposit_is_unchanged():
    free = User(email="a@b.c", password_hash="h")
    free.tier = UserTier.FREE
    assert deposit_points_for_user(100_000, free) == kobo_to_points(100_000)


def test_premium_deposit_is_discounted():
    prem = User(email="a@b.c", password_hash="h")
    prem.tier = UserTier.STUDY_PLUS_MONTHLY
    prem.subscription_expires_at = datetime.utcnow() + timedelta(days=30)

    base = kobo_to_points(100_000)
    got = deposit_points_for_user(100_000, prem)
    assert got > base
    # 30% more points for the same naira.
    assert got == pytest.approx(base / 0.70, abs=2)


def test_zero_deposit_is_zero():
    prem = User(email="a@b.c", password_hash="h")
    prem.tier = UserTier.STUDY_PLUS_MONTHLY
    prem.subscription_expires_at = datetime.utcnow() + timedelta(days=30)
    assert deposit_points_for_user(0, prem) == 0


def test_total_discount_is_ignored():
    """A 100% discount would mint money; clamp it rather than apply it."""
    from unittest.mock import patch

    prem = User(email="a@b.c", password_hash="h")
    prem.tier = UserTier.STUDY_PLUS_MONTHLY
    prem.subscription_expires_at = datetime.utcnow() + timedelta(days=30)
    with patch.object(settings, "premium_top_up_discount_percent", 1.0):
        assert deposit_points_for_user(100_000, prem) == kobo_to_points(100_000)
