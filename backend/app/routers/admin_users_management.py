"""Platform user management endpoints.

Admin operations on platform users: ban, unban, adjust balance, view details,
reading sessions, and transaction history. Includes user filtering and search.
"""

import logging
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    User, ReadingSession, PayoutTransaction, Payment, AdminUser,
    AdminAuditLog, AdEvent, FraudFlag, AdminUserNote, UserTier,
)
from app.schemas import UserListResponse
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/users", tags=["admin-users-management"])


# ── Helpers ─────────────────────────────────────────────────────────


def _log_admin_action(
    admin_id: int | None,
    admin_email: str | None,
    action: str,
    target_type: str,
    target_id: int | None,
    changes: dict | None,
    ip: str | None = None,
    result: str = "success",
    error: str | None = None,
):
    """Create an audit log entry for admin actions."""
    return AdminAuditLog(
        admin_id=admin_id,
        admin_email=admin_email,
        action=action,
        target_type=target_type,
        target_id=target_id,
        changes=json.dumps(changes) if changes else None,
        ip_address=ip,
        result=result,
        error_message=error,
    )


# ── User Segments (read-only aggregates) ────────────────────────────
# IMPORTANT: declared BEFORE the `/{user_id}` route. FastAPI matches
# routes in declaration order — if `/{user_id}` (user_id: int) is
# declared first, "/segments" is coerced as a user_id and fails int
# validation with 422 before this endpoint is ever considered.


@router.get("/segments")
async def get_user_segments(
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Count users in common behavioral segments (read-only)."""
    from datetime import timedelta

    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)
    thirty_ago = now - timedelta(days=30)

    logger.info(
        "segments: admin=%s now=%s week_ago=%s thirty_ago=%s",
        current_admin.email if current_admin else None,
        now.isoformat(),
        week_ago.isoformat(),
        thirty_ago.isoformat(),
    )

    total = (await db.execute(select(func.count(User.id)))).scalar_one()

    # High-value: users who watched >1000 ads (credited AdEvents)
    high_value = (
        await db.execute(
            select(func.count(func.distinct(AdEvent.user_id))).where(
                AdEvent.watched_fully == True,  # noqa: E712
                AdEvent.user_points_credited > 0,
            )
        )
    ).scalar_one()

    # Power readers: >50 reading sessions
    power_readers = (
        await db.execute(
            select(func.count())
            .select_from(
                select(ReadingSession.user_id)
                .group_by(ReadingSession.user_id)
                .having(func.count(ReadingSession.id) > 50)
                .subquery()
            )
        )
    ).scalar_one()

    # Premium users
    premium = (
        await db.execute(
            select(func.count(User.id)).where(User.tier != UserTier.FREE)
        )
    ).scalar_one()

    # New users: signed up <7 days ago
    new_users = (
        await db.execute(
            select(func.count(User.id)).where(User.created_at >= week_ago)
        )
    ).scalar_one()

    # At-risk: active 7+ days ago but not since
    at_risk = (
        await db.execute(
            select(func.count(User.id)).where(
                User.last_login_at < week_ago,
                User.last_login_at >= thirty_ago,
            )
        )
    ).scalar_one()

    logger.info(
        "segments: total=%s high_value=%s power_readers=%s premium=%s new=%s at_risk=%s",
        total,
        high_value,
        power_readers,
        premium,
        new_users,
        at_risk,
    )

    return {
        "total_users": int(total),
        "high_value_users": int(high_value),
        "power_readers": int(power_readers),
        "premium_users": int(premium),
        "new_users_7d": int(new_users),
        "at_risk_users_7_30d": int(at_risk),
    }


# ── User Listing & Details ──────────────────────────────────────────


@router.get("")
async def list_users(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    tier: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """List platform users with filtering and search."""
    query = select(User)
    if tier:
        # Coerce the query-string string into the UserTier enum so the
        # WHERE clause uses the enum's value (or name, depending on
        # the SQLAlchemy column config) consistently. Without this,
        # raw "free" → `WHERE tier = 'free'` raises
        # InvalidTextRepresentationError against the postgres enum.
        try:
            tier_enum = UserTier(tier)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid tier: {tier}")
        query = query.where(User.tier == tier_enum)
    if status:
        query = query.where(User.status == status)
    if search:
        query = query.where(
            (User.email.ilike(f"%{search}%")) |
            (User.phone.ilike(f"%{search}%"))
        )

    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar_one()
    rows = await db.execute(
        query.order_by(User.created_at.desc()).limit(limit).offset(
            (page - 1) * limit
        )
    )

    items = []
    for u in rows.scalars().all():
        # Defensive serialization: every field defaults to a JSON-safe
        # placeholder so a single bad row (None datetime, unknown enum
        # value from a manual DB edit, etc) doesn't 500 the whole page.
        # An admin list view must always render — better to show "—"
        # for one cell than to fail the entire request.
        tier_val = u.tier
        if hasattr(tier_val, "value"):
            tier_val = tier_val.value
        elif tier_val is not None:
            tier_val = str(tier_val)
        items.append({
            "id": u.id,
            "email": u.email,
            "phone": u.phone,
            "tier": tier_val,
            "status": u.status,
            "points_balance": u.points_balance,
            "referral_code": u.referral_code,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_active_at": (
                u.last_login_at.isoformat()
                if u.last_login_at else None
            ),
        })

    return UserListResponse(
        items=items, total=int(total), page=page, limit=limit
    )


@router.get("/{user_id}")
async def get_user_detail(
    user_id: int,
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get detailed information about a specific user."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "id": user.id,
        "email": user.email,
        "phone": user.phone,
        "tier": user.tier.value if hasattr(user.tier, "value") else str(user.tier),
        "status": user.status,
        "points_balance": user.points_balance,
        "referral_code": user.referral_code,
        "referred_by": user.referred_by,
        "subscription_expires_at": (
            user.subscription_expires_at.isoformat()
            if user.subscription_expires_at else None
        ),
        "created_at": user.created_at.isoformat(),
        "last_active_at": (
            user.last_login_at.isoformat()
            if user.last_login_at else None
        ),
    }


# ── User Actions ────────────────────────────────────────────────────


@router.post("/{user_id}/ban")
async def ban_user(
    request: Request,
    user_id: int,
    reason: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("users.ban")),
    db: AsyncSession = Depends(get_db),
):
    """Ban a user from the platform."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.status = "banned"
    user.banned_at = datetime.utcnow()
    user.ban_reason = reason
    user.banned_by = current_admin.id
    
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "ban_user",
            "user",
            user_id,
            {
                "status": {"from": "active", "to": "banned"},
                "reason": reason,
            },
            request.client.host,
        )
    )
    
    await db.commit()
    return {"success": True}


@router.post("/{user_id}/unban")
async def unban_user(
    request: Request,
    user_id: int,
    current_admin: AdminUser = Depends(require_permission("users.ban")),
    db: AsyncSession = Depends(get_db),
):
    """Unban a user and restore platform access."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.status = "active"
    user.banned_at = None
    user.ban_reason = None
    user.banned_by = None
    
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "unban_user",
            "user",
            user_id,
            {"status": {"from": "banned", "to": "active"}},
            request.client.host,
        )
    )
    
    await db.commit()
    return {"success": True}


@router.post("/{user_id}/adjust-balance")
async def adjust_balance(
    request: Request,
    user_id: int,
    amount: int = Query(...),
    reason: str = Query(...),
    current_admin: AdminUser = Depends(require_permission("users.adjust_balance")),
    db: AsyncSession = Depends(get_db),
):
    """Adjust user's point balance (add or deduct)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    old_balance = user.points_balance
    user.points_balance = max(0, old_balance + amount)
    
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "adjust_balance",
            "user",
            user_id,
            {
                "points": {"from": old_balance, "to": user.points_balance},
                "reason": reason,
            },
            request.client.host,
        )
    )
    
    await db.commit()
    return {"success": True, "new_balance": user.points_balance}

# ── User Sessions & Transactions ────────────────────────────────────


@router.get("/{user_id}/sessions")
async def get_user_sessions(
    user_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get reading sessions for a user."""
    q = (
        select(ReadingSession)
        .where(ReadingSession.user_id == user_id)
        .order_by(ReadingSession.start_time.desc())
    )
    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()
    rows = await db.execute(q.limit(limit).offset((page - 1) * limit))
    
    items = [
        {
            "id": s.id,
            "content_id": s.content_id,
            "start_time": s.start_time.isoformat(),
            "duration_seconds": s.duration_seconds,
            "verified": s.verified,
            "points_earned": s.points_earned,
        }
        for s in rows.scalars().all()
    ]
    
    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.get("/{user_id}/transactions")
async def get_user_transactions(
    user_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get all transactions for a user (payouts, payments, etc)."""
    payout_q = (
        select(PayoutTransaction)
        .where(PayoutTransaction.user_id == user_id)
    )
    payment_q = select(Payment).where(Payment.user_id == user_id)
    
    # Simplified: return both as items
    items = []
    
    # Payouts
    rows = await db.execute(
        payout_q.limit(limit).offset((page - 1) * limit)
    )
    for r in rows.scalars().all():
        items.append({
            "type": "payout",
            "id": r.id,
            "amount_kobo": r.amount_kobo,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
        })
    
    # Payments
    rows = await db.execute(
        payment_q.limit(limit).offset((page - 1) * limit)
    )
    for r in rows.scalars().all():
        items.append({
            "type": "payment",
            "id": r.id,
            "amount_kobo": r.amount_kobo,
            "tier": r.tier,
            "status": r.status,
            "created_at": r.created_at.isoformat(),
        })
    
    return {"items": items, "total": len(items), "page": page, "limit": limit}


# ── User Activity Timeline ──────────────────────────────────────────


@router.get("/{user_id}/activity")
async def get_user_activity(
    user_id: int,
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Chronological activity timeline for a user, used by the admin
    'Activity' tab. Aggregates reading sessions, rewarded ad watches,
    balance adjustments (admin audit log), payouts, payments, fraud
    flags, and ban/unban events into a single sorted feed.
    """
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    events: list[dict] = []

    # Reading sessions
    rows = await db.execute(
        select(ReadingSession)
        .where(ReadingSession.user_id == user_id)
        .order_by(ReadingSession.start_time.desc())
        .limit(limit)
    )
    for s in rows.scalars().all():
        events.append({
            "type": "session",
            "id": s.id,
            "timestamp": s.start_time.isoformat() if s.start_time else None,
            "summary": f"Read content #{s.content_id}",
            "detail": f"{'verified' if s.verified else 'unverified'} · {s.points_earned or 0} pts",
        })

    # Rewarded ad watches (credited AdEvents)
    rows = await db.execute(
        select(AdEvent)
        .where(AdEvent.user_id == user_id, AdEvent.watched_fully == True)  # noqa: E712
        .order_by(AdEvent.created_at.desc())
        .limit(limit)
    )
    for e in rows.scalars().all():
        events.append({
            "type": "ad_watch",
            "id": e.id,
            "timestamp": e.created_at.isoformat() if e.created_at else None,
            "summary": f"Watched ad: {e.ad_unit or 'unknown'}",
            "detail": f"+{e.user_points_credited or 0} pts"
            if e.user_points_credited else "no credit",
        })

    # Balance adjustments (admin audit log)
    rows = await db.execute(
        select(AdminAuditLog)
        .where(
            AdminAuditLog.action == "adjust_balance",
            AdminAuditLog.target_id == user_id,
        )
        .order_by(AdminAuditLog.created_at.desc())
        .limit(limit)
    )
    for a in rows.scalars().all():
        events.append({
            "type": "balance_adjustment",
            "id": a.id,
            "timestamp": a.created_at.isoformat() if a.created_at else None,
            "summary": f"Balance adjusted by {a.admin_email or 'admin'}",
            "detail": (a.changes or "")[:200],
        })

    # Payouts
    rows = await db.execute(
        select(PayoutTransaction)
        .where(PayoutTransaction.user_id == user_id)
        .order_by(PayoutTransaction.created_at.desc())
        .limit(limit)
    )
    for p in rows.scalars().all():
        events.append({
            "type": "payout",
            "id": p.id,
            "timestamp": p.created_at.isoformat() if p.created_at else None,
            "summary": f"Payout request · {p.status}",
            "detail": f"{p.amount_kobo / 100:.2f} NGN",
        })

    # Payments (premium)
    rows = await db.execute(
        select(Payment)
        .where(Payment.user_id == user_id)
        .order_by(Payment.created_at.desc())
        .limit(limit)
    )
    for pmt in rows.scalars().all():
        events.append({
            "type": "payment",
            "id": pmt.id,
            "timestamp": pmt.created_at.isoformat() if pmt.created_at else None,
            "summary": f"Premium payment · {pmt.status}",
            "detail": f"{pmt.amount_kobo / 100:.2f} NGN · {pmt.tier or ''}",
        })

    # Fraud flags
    rows = await db.execute(
        select(FraudFlag)
        .where(FraudFlag.user_id == user_id)
        .order_by(FraudFlag.created_at.desc())
        .limit(limit)
    )
    for f in rows.scalars().all():
        events.append({
            "type": "fraud_flag",
            "id": f.id,
            "timestamp": f.created_at.isoformat() if f.created_at else None,
            "summary": f"Fraud flag: {f.flag_type}",
            "detail": f"{f.severity} · {f.status}",
        })

    # Ban / unban events
    rows = await db.execute(
        select(AdminAuditLog)
        .where(
            AdminAuditLog.target_id == user_id,
            AdminAuditLog.action.in_(["ban_user", "unban_user"]),
        )
        .order_by(AdminAuditLog.created_at.desc())
        .limit(limit)
    )
    for b in rows.scalars().all():
        events.append({
            "type": "ban" if b.action == "ban_user" else "unban",
            "id": b.id,
            "timestamp": b.created_at.isoformat() if b.created_at else None,
            "summary": f"{'Banned' if b.action == 'ban_user' else 'Unbanned'} by {b.admin_email or 'admin'}",
            "detail": (b.changes or "")[:200],
        })

    # Sort by timestamp descending (None timestamps go last)
    def _ts(e: dict) -> str:
        return e.get("timestamp") or ""

    events.sort(key=_ts, reverse=True)
    events = events[:limit]

    return {
        "items": events,
        "total": len(events),
        "user_id": user_id,
    }


# ── User Ad Watch History ───────────────────────────────────────────


@router.get("/{user_id}/ads")
async def get_user_ads(
    user_id: int,
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """List rewarded ad impressions watched by a user (ad watch history)."""
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    rows = await db.execute(
        select(AdEvent)
        .where(AdEvent.user_id == user_id)
        .order_by(AdEvent.created_at.desc())
        .limit(limit)
    )
    items = [
        {
            "id": e.id,
            "ad_unit": e.ad_unit,
            "provider": e.provider,
            "watched_fully": e.watched_fully,
            "reward_granted": e.reward_granted,
            "points_credited": e.user_points_credited or 0,
            "transaction_id": e.transaction_id,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in rows.scalars().all()
    ]
    return {"items": items, "total": len(items), "user_id": user_id}


# ── User Wallet History (detailed) ─────────────────────────────────


@router.get("/{user_id}/wallet")
async def get_user_wallet_history(
    user_id: int,
    limit: int = Query(100, ge=1, le=500),
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Detailed wallet history: ad credits, admin balance adjustments,
    payouts and payments, merged into one chronological, point-aware feed.
    """
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    entries: list[dict] = []

    # Ad credits
    rows = await db.execute(
        select(AdEvent)
        .where(AdEvent.user_id == user_id, AdEvent.watched_fully == True)  # noqa: E712
        .order_by(AdEvent.created_at.desc())
        .limit(limit)
    )
    for e in rows.scalars().all():
        if e.user_points_credited:
            entries.append({
                "type": "ad_credit",
                "id": e.id,
                "timestamp": e.created_at.isoformat() if e.created_at else None,
                "delta": e.user_points_credited,
                "detail": f"{e.ad_unit or 'ad'} via {e.provider or '?'}: +{e.user_points_credited} pts",
            })

    # Admin balance adjustments
    rows = await db.execute(
        select(AdminAuditLog)
        .where(
            AdminAuditLog.action == "adjust_balance",
            AdminAuditLog.target_id == user_id,
        )
        .order_by(AdminAuditLog.created_at.desc())
        .limit(limit)
    )
    for a in rows.scalars().all():
        entries.append({
            "type": "adjustment",
            "id": a.id,
            "timestamp": a.created_at.isoformat() if a.created_at else None,
            "delta": None,
            "detail": f"Adjusted by {a.admin_email or 'admin'}: {(a.changes or '')[:160]}",
        })

    # Payouts (negative balance impact)
    rows = await db.execute(
        select(PayoutTransaction)
        .where(PayoutTransaction.user_id == user_id)
        .order_by(PayoutTransaction.created_at.desc())
        .limit(limit)
    )
    for p in rows.scalars().all():
        entries.append({
            "type": "payout",
            "id": p.id,
            "timestamp": p.created_at.isoformat() if p.created_at else None,
            "delta": -p.amount_kobo,
            "detail": f"Payout {p.status}: {p.amount_kobo / 100:.2f} NGN",
        })

    # Payments (premium, negative balance impact)
    rows = await db.execute(
        select(Payment)
        .where(Payment.user_id == user_id)
        .order_by(Payment.created_at.desc())
        .limit(limit)
    )
    for pmt in rows.scalars().all():
        entries.append({
            "type": "payment",
            "id": pmt.id,
            "timestamp": pmt.created_at.isoformat() if pmt.created_at else None,
            "delta": -pmt.amount_kobo,
            "detail": f"Premium {pmt.status}: {pmt.amount_kobo / 100:.2f} NGN ({pmt.tier or ''})",
        })

    def _ts(e: dict) -> str:
        return e.get("timestamp") or ""

    entries.sort(key=_ts, reverse=True)
    entries = entries[:limit]

    return {
        "items": entries,
        "total": len(entries),
        "user_id": user_id,
        "current_balance": user.points_balance,
    }


# ── User Admin Notes ────────────────────────────────────────────────


@router.get("/{user_id}/notes")
async def list_user_notes(
    user_id: int,
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """List admin notes attached to a user (most recent first)."""
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    rows = await db.execute(
        select(AdminUserNote)
        .where(AdminUserNote.user_id == user_id)
        .order_by(AdminUserNote.created_at.desc())
    )
    items = [
        {
            "id": n.id,
            "note": n.note,
            "admin_email": n.admin_email,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in rows.scalars().all()
    ]
    return {"items": items, "total": len(items), "user_id": user_id}


@router.post("/{user_id}/notes")
async def create_user_note(
    request: Request,
    user_id: int,
    note: str = Query(..., min_length=1, max_length=2000),
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Add an admin note to a user."""
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    row = AdminUserNote(
        user_id=user_id,
        admin_id=current_admin.id,
        admin_email=current_admin.email,
        note=note,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {
        "id": row.id,
        "note": row.note,
        "admin_email": row.admin_email,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.delete("/notes/{note_id}")
async def delete_user_note(
    note_id: int,
    current_admin: AdminUser = Depends(require_permission("users.view")),
    db: AsyncSession = Depends(get_db),
):
    """Delete an admin note."""
    row = (
        await db.execute(select(AdminUserNote).where(AdminUserNote.id == note_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    await db.delete(row)
    await db.commit()
    return {"success": True}
