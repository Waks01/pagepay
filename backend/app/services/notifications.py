"""
Notification creation helper.
Centralizes saving notifications to the DB so push + inbox stay in sync.
"""
import logging
import json as _json
from datetime import datetime
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification

logger = logging.getLogger(__name__)


async def create_notification(
    db: AsyncSession,
    user_id: int,
    title: str,
    body: str,
    category: str | None = None,
    data: dict | None = None,
) -> Notification:
    """Persist a notification row and emit socket event for real-time update."""
    notification = Notification(
        user_id=user_id,
        title=title,
        body=body,
        category=category,
        data=_json.dumps(data) if data else None,
        read=False,
        created_at=datetime.utcnow(),
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)
    logger.info("Created notification id=%s for user %s: %s", notification.id, user_id, title)
    
    # Emit socket event for real-time notification bell update
    try:
        from app.websocket import sio
        logger.info("Attempting to emit socket event for user %s, room %s", user_id, f"user_{user_id}")
        await sio.emit(
            "notification",
            {
                "id": notification.id,
                "title": title,
                "body": body,
                "category": category,
                "data": data,
                "read": False,
                "created_at": notification.created_at.isoformat(),
            },
            room=f"user_{user_id}",
        )
        logger.info("✅ Socket event emitted for notification id=%s to room user_%s", notification.id, user_id)
    except Exception as e:
        logger.warning("⚠️  Failed to emit socket event for notification: %s", e)
    
    return notification


async def create_notification_background(
    user_id: int,
    title: str,
    body: str,
    category: str | None = None,
    data: dict | None = None,
) -> None:
    """Create notification in a background task with its own DB session."""
    from app.database import AsyncSessionLocal
    
    async with AsyncSessionLocal() as db:
        try:
            await create_notification(
                db=db,
                user_id=user_id,
                title=title,
                body=body,
                category=category,
                data=data,
            )
        except Exception as e:
            logger.error(f"Background notification creation failed: {e}")


async def create_notifications_bulk(
    db: AsyncSession,
    user_ids: list[int],
    title: str,
    body: str,
    category: str | None = None,
    data: dict | None = None,
) -> list[Notification]:
    """Persist notification rows for multiple users and emit socket events."""
    rows = []
    now = datetime.utcnow()
    for user_id in user_ids:
        rows.append(
            {
                "user_id": user_id,
                "title": title,
                "body": body,
                "category": category,
                "data": _json.dumps(data) if data else None,
                "read": False,
                "created_at": now,
            }
        )
    if not rows:
        return []
    await db.execute(insert(Notification).values(rows))
    await db.commit()
    logger.info("Created %s notifications for title=%s", len(rows), title)
    
    # Emit socket events for all users
    try:
        from app.websocket import sio
        for user_id in user_ids:
            await sio.emit(
                "notification",
                {
                    "title": title,
                    "body": body,
                    "category": category,
                    "data": data,
                    "read": False,
                    "created_at": now.isoformat(),
                },
                room=f"user_{user_id}",
            )
        logger.info("✅ Socket events emitted for %s bulk notifications", len(user_ids))
    except Exception as e:
        logger.warning("⚠️  Failed to emit socket events for bulk notifications: %s", e)
    
    return rows
