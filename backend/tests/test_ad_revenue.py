"""Ad revenue reporting.

The ad revenue number is what tells us whether ad-watching actually
funds the rewards we pay out (admob.md section 8). Without it,
"reward < ad revenue" is a rule we can only assert, not check.
"""

import os

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

from app.models import AiUsageLog, User  # noqa: E402


def _auth(user_id: int) -> dict:
    from app.services.auth import create_access_token

    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


@pytest.mark.asyncio
async def test_revenue_is_recorded_as_a_negative_cost(client, db_session):
    """Ad revenue offsets AI spend, so it is recorded as negative cost.

    Positive cost would make the margin summary report ad revenue as
    extra expense, which is backwards.
    """
    user = User(email="rev1@test.com", password_hash="h")
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    res = await client.post(
        "/api/v1/study/ads/revenue",
        json={
            "format": "rewarded",
            "value_micros": 2000,  # $0.002
            "currency": "USD",
            "precision": "PRECISE",
        },
        headers=_auth(user.id),
    )
    assert res.status_code == 200

    rows = (await db_session.execute(select(AiUsageLog))).scalars().all()
    assert len(rows) == 1
    assert rows[0].endpoint == "ad_revenue"
    assert rows[0].cost_usd == pytest.approx(-0.002)
    assert rows[0].model == "rewarded"


@pytest.mark.asyncio
async def test_revenue_never_credits_a_balance(client, db_session):
    """A client could post anything here - it is telemetry, not money.

    The balance must be untouched no matter what the client claims.
    """
    user = User(email="rev2@test.com", password_hash="h")
    user.service_credit_balance = 100
    user.cashable_balance = 100
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    res = await client.post(
        "/api/v1/study/ads/revenue",
        json={
            "format": "banner",
            "value_micros": 999_999_999,  # a student claiming $999
            "currency": "USD",
            "precision": "PRECISE",
        },
        headers=_auth(user.id),
    )
    assert res.status_code == 200

    await db_session.refresh(user)
    assert user.service_credit_balance == 100
    assert user.cashable_balance == 100


@pytest.mark.asyncio
async def test_revenue_requires_auth(client, db_session):
    res = await client.post(
        "/api/v1/study/ads/revenue",
        json={"format": "rewarded", "value_micros": 100},
    )
    assert res.status_code in (401, 403)
