"""Reading-session endpoints.

Reward flow (split — ads and reading settled independently)
-----------------------------------------------------------
1. POST /session/start  — open a session, return session_id.
2. POST /session/heartbeat — keep the timer alive (scroll + app_state).
3. POST /session/end  — STOP the timer. If the session is verified
   (scroll_events > 0), **immediately credits the slice-completion
   bonus** (env `READING_SLICE_BONUS_POINTS`, default 2 pts) to the
   user's wallet and stamps `session.points_earned`. The response
   carries `slice_bonus_credited` and `new_balance`.

   Ad rewards (pre-read + post-read) are credited independently by the
   SSV webhook when the user finishes watching each ad. They land as
   their own wallet entries — see `AdEvent.user_points_credited`.

4. POST /session/claim — DEPRECATED no-op for back-compat. New clients
   should not call it. Kept so older clients don't 404.

The pre-read ad gate is enforced client-side: the reader surfaces a
"watch to start" modal and only calls /session/start after the user
finishes watching it. The pre-read ad itself is settled by the SSV
webhook, not by this router.
"""

import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.config import settings
from app.models import ReadingSession, User
from app.schemas import (
    SessionStart, SessionHeartbeat, SessionEnd,
    SessionEndResponse, SessionClaimResponse,
)
from app.routers.auth import get_current_user
from app.services.notifications import create_notification

router = APIRouter(prefix="/session", tags=["session"])
logger = logging.getLogger("uvicorn.error")


@router.post("/start", status_code=201)
async def start_session(
    payload: SessionStart,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = ReadingSession(user_id=current_user.id, content_id=payload.content_id)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return {"session_id": session.id}


@router.post("/heartbeat")
async def heartbeat(
    payload: SessionHeartbeat,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ReadingSession).where(ReadingSession.id == payload.session_id)
    )
    session = result.scalar_one_or_none()
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    session.scroll_events += payload.scroll_events

    now = datetime.utcnow()

    if payload.app_state == "background":
        if session.paused_at is None:
            session.paused_at = now
    else:
        if session.paused_at is not None:
            pause_duration = (now - session.paused_at).total_seconds()
            session.total_paused_seconds += int(pause_duration)
            session.paused_at = None

    await db.commit()
    await db.refresh(session)
    return {
        "paused": payload.app_state == "background",
        "duration_seconds": session.duration_seconds,
    }


@router.post("/end", response_model=SessionEndResponse)
async def end_session(
    payload: SessionEnd,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stop the timer and settle the slice-completion bonus (if verified).

    A verified session (scroll_events > 0) is one where the user genuinely
    engaged with the slice — they scrolled, didn't background the app, and
    the duration floor was met. For those sessions we credit the
    env-overridable `READING_SLICE_BONUS_POINTS` (default 2) directly to
    the user's wallet.

    Ad rewards (pre-read and post-read) are settled by the SSV webhook
    and are independent of this endpoint — they land as their own wallet
    entries when the user finishes watching each ad.

    Sessions that didn't pass anti-cheat (no scroll events, too short,
    etc.) get `bonus_eligible=False, slice_bonus_credited=0`. The session
    row is still updated with `end_time` for audit, but no wallet credit
    is issued.
    """
    result = await db.execute(
        select(ReadingSession).where(ReadingSession.id == payload.session_id)
    )
    session = result.scalar_one_or_none()
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    now = datetime.utcnow()
    session.end_time = now
    raw_duration = (now - session.start_time).total_seconds()
    session.duration_seconds = int(raw_duration)

    effective_duration = max(0, session.duration_seconds - session.total_paused_seconds)

    # Default: no bonus. Verified sessions below.
    bonus_credited = 0
    bonus_eligible = False

    if not session.verified and session.scroll_events > 0 and effective_duration >= settings.session_verified_min_seconds:
        session.verified = True
        
        # Apply premium multiplier to reading bonus (Phase 2)
        from app.services.subscription import get_points_multiplier
        base_bonus = settings.reading_slice_bonus_points
        multiplier = get_points_multiplier(current_user, "reading")
        bonus_credited = int(base_bonus * multiplier)
        
        current_user.points_balance += bonus_credited
        session.points_earned = bonus_credited
        bonus_eligible = True
        logger.info(
            "session %d settled: user=%d tier=%s verified=True base=%d multiplier=%.1fx bonus=%d new_balance=%d",
            session.id, current_user.id, current_user.tier.value,
            base_bonus, multiplier, bonus_credited, current_user.points_balance,
        )

    await db.commit()
    await db.refresh(current_user)
    await db.refresh(session)

    if bonus_credited > 0 and session.verified and session.points_earned == bonus_credited:
        bonus_naira = bonus_credited / max(1, settings.points_per_naira)
        from app.services.fcm import send_wallet_update_background
        from app.services.notifications import create_notification_background
        asyncio.create_task(
            send_wallet_update_background(
                current_user.id,
                amount_naira=bonus_naira,
                transaction_type="credit",
                reason="slice_bonus",
            )
        )
        asyncio.create_task(
            create_notification_background(
                current_user.id,
                title="Reading Reward",
                body=f"You earned {bonus_credited} points for finishing this slice!",
                category="reading_rewards",
                data={"type": "reading_reward", "points": str(bonus_credited)},
            )
        )

    return SessionEndResponse(
        session_id=session.id,
        verified=session.verified,
        bonus_eligible=bonus_eligible,
        slice_bonus_credited=bonus_credited,
        new_balance=current_user.points_balance,
    )


@router.post("/claim", response_model=SessionClaimResponse)
async def claim_session(
    payload: SessionEnd,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """DEPRECATED no-op for back-compat.

    Slice points are settled at /session/end (see SessionEndResponse). Ad
    rewards are settled by the SSV webhook. New clients should not call
    this endpoint. We return `already_claimed=True, points_earned=0` so
    old clients that still POST to /session/claim don't crash.

    We still verify the session exists and belongs to the caller before
    returning — that way guessing another user's session id still 404s
    instead of silently leaking a wallet balance.
    """
    result = await db.execute(
        select(ReadingSession).where(ReadingSession.id == payload.session_id)
    )
    session = result.scalar_one_or_none()
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    me = (await db.execute(
        select(User.points_balance).where(User.id == current_user.id)
    )).scalar_one()
    return SessionClaimResponse(
        points_earned=0,
        new_balance=me,
        already_claimed=True,
    )
