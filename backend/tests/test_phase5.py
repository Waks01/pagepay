"""Phase 5 tests: referrals, community notes, streak."""

import pytest
from datetime import datetime, timedelta, timezone
from httpx import AsyncClient

from app.models import User, Referral, CommunityNote, CommunityLike, UserStreak, ReadingSession
from app.services.auth import hash_password


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _auth_header(user_id: int, db) -> dict:
    from app.services.auth import create_access_token
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}


@pytest.mark.asyncio
async def test_referral_generate_creates_code(client: AsyncClient, db_session):
    user = User(email="refgen@test.com", password_hash=hash_password("pass1234"))
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    resp = await client.post("/api/v1/referral/generate", headers=_auth_header(user.id, db_session))
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["code"]) == 6
    assert data["link"] == f"https://pagepay.app/ref/{data['code']}"


@pytest.mark.asyncio
async def test_referral_generate_returns_existing_code(client: AsyncClient, db_session):
    user = User(email="refgen2@test.com", password_hash=hash_password("pass1234"), referral_code="ABC123")
    db_session.add(user)
    await db_session.commit()

    resp = await client.post("/api/v1/referral/generate", headers=_auth_header(user.id, db_session))
    assert resp.status_code == 200
    assert resp.json()["code"] == "ABC123"


@pytest.mark.asyncio
async def test_referral_stats_empty(client: AsyncClient, db_session):
    user = User(email="refstats@test.com", password_hash=hash_password("pass1234"))
    db_session.add(user)
    await db_session.commit()

    resp = await client.get("/api/v1/referral/stats", headers=_auth_header(user.id, db_session))
    assert resp.status_code == 200
    assert resp.json() == {"code": "", "clicks": 0, "signups": 0, "pending_rewards": 0, "claimed_rewards": 0}


@pytest.mark.asyncio
async def test_referral_validate_blocks_self_referral(client: AsyncClient, db_session):
    user = User(email="selfref@test.com", password_hash=hash_password("pass1234"), referral_code="SELF01")
    db_session.add(user)
    await db_session.commit()

    user.referred_by = "SELF01"
    await db_session.commit()

    resp = await client.post("/api/v1/referral/validate", headers=_auth_header(user.id, db_session))
    assert resp.status_code == 200
    assert resp.json()["rewarded"] is False


@pytest.mark.asyncio
async def test_referral_validate_awards_points(client: AsyncClient, db_session):
    referrer = User(email="referrer@test.com", password_hash=hash_password("pass1234"), referral_code="REFCODE")
    referee = User(email="referee@test.com", password_hash=hash_password("pass1234"), referred_by="REFCODE")
    db_session.add_all([referrer, referee])
    await db_session.commit()

    session = ReadingSession(
        user_id=referee.id,
        content_id=1,
        duration_seconds=120,
        verified=True,
    )
    db_session.add(session)
    await db_session.commit()

    resp = await client.post("/api/v1/referral/validate", headers=_auth_header(referee.id, db_session))
    assert resp.status_code == 200
    data = resp.json()
    assert data["rewarded"] is True
    assert data["referrer_points"] == 500
    assert data["referee_points"] == 200


@pytest.mark.asyncio
async def test_referral_daily_cap(client: AsyncClient, db_session):
    referrer = User(
        email="cap@test.com",
        password_hash=hash_password("pass1234"),
        referral_code="CAPCODE",
        referrals_today_count=10,
        referrals_today_reset_at=datetime.now(timezone.utc),
    )
    referee = User(email="cap2@test.com", password_hash=hash_password("pass1234"), referred_by="CAPCODE")
    db_session.add_all([referrer, referee])
    await db_session.commit()

    resp = await client.post("/api/v1/referral/validate", headers=_auth_header(referee.id, db_session))
    assert resp.status_code == 200
    assert resp.json()["rewarded"] is False
    assert "cap" in resp.json()["message"].lower()


@pytest.mark.asyncio
async def test_community_upload_creates_pending_note(client: AsyncClient, db_session):
    user = User(email="note@test.com", password_hash=hash_password("pass1234"))
    db_session.add(user)
    await db_session.commit()

    resp = await client.post(
        "/api/v1/community/upload",
        headers=_auth_header(user.id, db_session),
        json={"title": "Test Note", "content": "This is a test note content body.", "course_code": "CS101"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "pending"
    assert data["title"] == "Test Note"


@pytest.mark.asyncio
async def test_community_feed_excludes_pending(client: AsyncClient, db_session):
    user = User(email="feed@test.com", password_hash=hash_password("pass1234"))
    db_session.add(user)
    await db_session.commit()

    note = CommunityNote(user_id=user.id, title="Pending Note", content="body", status="pending")
    db_session.add(note)
    await db_session.commit()

    resp = await client.get("/api/v1/community/feed")
    assert resp.status_code == 200
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_community_like_toggle(client: AsyncClient, db_session):
    user = User(email="like@test.com", password_hash=hash_password("pass1234"))
    db_session.add(user)
    await db_session.commit()

    note = CommunityNote(user_id=user.id, title="Likeable", content="body", status="approved", likes_count=0)
    db_session.add(note)
    await db_session.commit()
    await db_session.refresh(note)

    resp = await client.post(f"/api/v1/community/{note.id}/like", headers=_auth_header(user.id, db_session))
    assert resp.status_code == 200
    assert resp.json()["liked"] is True
    assert resp.json()["likes_count"] == 1

    resp2 = await client.post(f"/api/v1/community/{note.id}/like", headers=_auth_header(user.id, db_session))
    assert resp2.json()["liked"] is False
    assert resp2.json()["likes_count"] == 0


@pytest.mark.asyncio
async def test_streak_new_user(client: AsyncClient, db_session):
    user = User(email="streak@test.com", password_hash=hash_password("pass1234"))
    db_session.add(user)
    await db_session.commit()

    resp = await client.get("/api/v1/users/me/streak", headers=_auth_header(user.id, db_session))
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_streak"] == 0
    assert data["bonus_multiplier"] == 1.0


@pytest.mark.asyncio
async def test_streak_consecutive_days(client: AsyncClient, db_session):
    user = User(email="streak2@test.com", password_hash=hash_password("pass1234"))
    db_session.add(user)
    await db_session.commit()

    today = datetime.now(timezone.utc).date()
    for days_ago in [0, 1, 2]:
        d = datetime.combine(today - timedelta(days=days_ago), datetime.min.time()).replace(tzinfo=timezone.utc)
        db_session.add(ReadingSession(user_id=user.id, content_id=1, start_time=d, verified=True))
    await db_session.commit()

    resp = await client.get("/api/v1/users/me/streak", headers=_auth_header(user.id, db_session))
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_streak"] == 3


@pytest.mark.asyncio
async def test_streak_7_day_bonus(client: AsyncClient, db_session):
    user = User(email="streak7@test.com", password_hash=hash_password("pass1234"))
    db_session.add(user)
    await db_session.commit()

    today = datetime.now(timezone.utc).date()
    for days_ago in range(7):
        d = datetime.combine(today - timedelta(days=days_ago), datetime.min.time()).replace(tzinfo=timezone.utc)
        db_session.add(ReadingSession(user_id=user.id, content_id=1, start_time=d, verified=True))
    await db_session.commit()

    resp = await client.get("/api/v1/users/me/streak", headers=_auth_header(user.id, db_session))
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_streak"] == 7
    assert data["bonus_multiplier"] == 1.2
