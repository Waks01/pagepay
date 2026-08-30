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

    Reading rewards are credited when the session ends and is verified.

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
from app.services.notifications import create_notification, create_notification_background
from app.services.fcm import send_wallet_update_background

router = APIRouter(prefix="/session", tags=["session"])
logger = logging.getLogger("uvicorn.error")


async def _credit_reading_reward(
    db: AsyncSession,
    user: User,
    session: ReadingSession,
    points: int,
):
    """Helper to credit points to user wallet and trigger notifications."""
    logger.info("Crediting reward: user=%d, points=%d", user.id, points)
    user.points_balance += points
    session.points_earned = points
    session.claimed_at = datetime.utcnow()

    # Trigger notifications in background
    logger.info("Scheduling background notifications for user %d", user.id)
    asyncio.create_task(create_notification_background(
        user_id=user.id,
        title="Reading Reward!",
        body=f"You earned {points} points for finishing your reading slice.",
        category="wallet_updates",
        data={"type": "reading_reward", "points": str(points)}
    ))

    naira = points / max(1, settings.points_per_naira)
    asyncio.create_task(send_wallet_update_background(
        user_id=user.id,
        amount_naira=naira,
        transaction_type="credit",
        reason="reading_bonus"
    ))


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
    """Stop the timer and stage pending points for post-read ad claim.

    A verified session (scroll_events > 0, effective_duration >= min)
    earns points calculated as `max(0, (effective_duration // 600) * 5)`.
    These points are staged as `pending_points` on the session row. The
    actual wallet credit happens in POST /session/claim after the user
    watches the post-read ad and the SSV webhook confirms.
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

    pending_points = 0
    bonus_eligible = False

    if not session.verified and session.scroll_events > 0 and effective_duration >= settings.session_verified_min_seconds:
        session.verified = True

        # Credit slice completion bonus immediately upon verification
        # Free: 2 pts, Premium: 4 pts
        base_bonus = settings.reading_slice_bonus_points
        multiplier = 2.0 if current_user.tier != UserTier.FREE else 1.0
        total_points = int(base_bonus * multiplier)

        session.pending_points = total_points
        bonus_eligible = True

        await _credit_reading_reward(db, current_user, session, total_points)
        logger.info(
            "session %d ended: user=%d verified=True. Credited slice bonus: %d pts",
            session.id, current_user.id, total_points,
        )
        pending_points = total_points

    await db.commit()
    await db.refresh(current_user)
    await db.refresh(session)

    return SessionEndResponse(
        session_id=session.id,
        verified=session.verified,
        bonus_eligible=bonus_eligible,
        pending_points=pending_points,
        requires_claim=bonus_eligible and pending_points > 0,
        new_balance=current_user.points_balance,
        new_cashable_balance=current_user.cashable_balance,
    )


@router.post("/claim", response_model=SessionClaimResponse)
async def claim_session(
    payload: SessionEnd,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Credit staged pending_points to the user's wallet.

    Idempotent: if the session has already been claimed, returns
    `already_claimed=True, points_earned=0` without double-crediting.
    """
    result = await db.execute(
        select(ReadingSession).where(ReadingSession.id == payload.session_id)
    )
    session = result.scalar_one_or_none()
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.claimed_at is not None:
        return SessionClaimResponse(
            points_earned=0,
            new_balance=current_user.points_balance,
            already_claimed=True,
        )

    points_to_credit = session.pending_points or 0
    if points_to_credit > 0:
        await _credit_reading_reward(db, current_user, session, points_to_credit)
        await db.commit()
        await db.refresh(current_user)
        await db.refresh(session)

    return SessionClaimResponse(
        points_earned=points_to_credit,
        new_balance=current_user.points_balance,
        already_claimed=False,
    )
