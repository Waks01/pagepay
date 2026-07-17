"""Reading-session endpoints.

Reward-gate flow (Phase 1+)
----------------------------
1. POST /session/start  — open a session, return session_id.
2. POST /session/heartbeat — keep the timer alive (scroll + app_state).
3. POST /session/end  — STOP the timer. **Does not credit points.** Stages
   the earned amount on the row as `pending_points` and returns
   `requires_claim=True` so the client can show the post-read ad modal.
4. POST /session/claim — the user watched the post-read ad. Credit the
   staged `pending_points` to the user's wallet. Idempotent.

The pre-read ad gate (no separate endpoint) is enforced client-side: the
reader surfaces a "watch to start" modal and only calls /session/start
after the user claims it. If you want the same enforcement on the server
later, add a `claim_token` round-trip here.
"""

import logging
from datetime import datetime

logger = logging.getLogger("uvicorn")
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from app.database import get_db
from app.models import ReadingSession, User
from app.schemas import SessionStart, SessionHeartbeat, SessionEnd, SessionEndResponse, SessionClaimResponse
from app.routers.auth import get_current_user

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
    """Stop the timer. Does NOT credit points.

    If the session was verified (scroll_events > 0) and ran long enough to
    clear the duration floor, we stage `pending_points` on the row and tell
    the client to surface the claim modal. The actual wallet credit happens
    in /session/claim after the user has watched the post-read ad.

    Sessions that were too short or had no scroll events get
    `requires_claim=False, pending_points=0` — there's nothing to claim.
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

    if session.scroll_events > 0:
        session.verified = True

        # User earns points ONLY via the rewarded ads associated with this session.
        # Reading time itself provides no extra points.
        pending_total = session.pending_points or 0

        await db.commit()
        await db.refresh(session)
        return SessionEndResponse(
            requires_claim=True, # Always require claim if verified to trigger post-read ad
            pending_points=pending_total,
            session_id=session.id,
            verified=True,
        )

    await db.commit()
    return SessionEndResponse(
        requires_claim=False,
        pending_points=0,
        session_id=session.id,
        verified=False,
    )


@router.post("/claim", response_model=SessionClaimResponse)
async def claim_session(
    payload: SessionEnd,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Credit the staged `pending_points` to the user's wallet.

    Called after the user has watched the post-read ad. Idempotent: if the
    session was already claimed (`claimed_at` set), we return the original
    grant and the current balance without re-crediting.

    The claim modal is only shown by the client when /session/end returned
    `requires_claim=True`. We don't gate the claim endpoint on that flag —
    the user might close the app between end and claim and reopen later.
    """
    result = await db.execute(
        select(ReadingSession).where(ReadingSession.id == payload.session_id)
    )
    session = result.scalar_one_or_none()
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    # Already claimed: idempotent return. Pull current balance fresh so we
    # don't echo a stale value from a long-lived User ORM instance.
    if session.claimed_at is not None:
        me = (await db.execute(select(User.points_balance).where(User.id == current_user.id))).scalar_one()
        return SessionClaimResponse(
            points_earned=session.points_earned,
            new_balance=me,
            already_claimed=True,
        )

    pending = session.pending_points or 0
    if pending > 0:
        session.points_earned = pending
        session.pending_points = 0
    session.claimed_at = datetime.utcnow()
    current_user.points_balance += pending
    await db.commit()
    return SessionClaimResponse(
        points_earned=pending,
        new_balance=current_user.points_balance,
        already_claimed=False,
    )
