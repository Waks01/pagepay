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
    """Persist a notification row and return it."""
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
    return notification


async def create_notifications_bulk(
    db: AsyncSession,
    user_ids: list[int],
    title: str,
    body: str,
    category: str | None = None,
    data: dict | None = None,
) -> list[Notification]:
    """Persist notification rows for multiple users."""
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
    return rows
