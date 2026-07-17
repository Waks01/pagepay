import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert
from app.models import UserAuditLog

logger = logging.getLogger("uvicorn.error")


async def log_user_action(
    db: AsyncSession,
    user_id: int,
    action: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    device_fingerprint: str | None = None,
    extra_data: dict | None = None,
) -> None:
    """Log a user action for audit trail."""
    try:
        log_entry = UserAuditLog(
            user_id=user_id,
            action=action,
            ip_address=ip_address,
            user_agent=user_agent,
            device_fingerprint=device_fingerprint,
            extra_data=str(extra_data) if extra_data else None,
        )
        db.add(log_entry)
        await db.commit()
    except Exception as exc:
        logger.error("Failed to log user action: %s", exc)
        await db.rollback()


async def get_user_audit_logs(
    db: AsyncSession,
    user_id: int,
    limit: int = 50,
    offset: int = 0,
) -> list[UserAuditLog]:
    """Get audit logs for a user."""
    result = await db.execute(
        select(UserAuditLog)
        .where(UserAuditLog.user_id == user_id)
        .order_by(UserAuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())
