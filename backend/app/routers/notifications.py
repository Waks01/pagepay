"""
Notification preferences and FCM token management.
Phase 3 feature: Push notifications with Firebase Cloud Messaging.
"""
from datetime import datetime, time
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, insert, update, delete as sqla_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, UserNotificationPreference, FCMToken
from app.routers.auth import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ── Schemas ──────────────────────────────────────────────────────────


class NotificationPreferences(BaseModel):
    """User notification preferences."""
    push_enabled: bool = True
    study_reminders: bool = True
    task_alerts: bool = True
    referral_bonuses: bool = True
    wallet_updates: bool = True
    ad_rewards: bool = True
    quiet_hours_start: Optional[str] = None  # Format: "HH:MM"
    quiet_hours_end: Optional[str] = None    # Format: "HH:MM"


class NotificationPreferencesResponse(NotificationPreferences):
    """Response with creation/update timestamps."""
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FCMTokenRequest(BaseModel):
    """Register FCM token for push notifications."""
    token: str = Field(..., min_length=10, max_length=255)
    platform: str = Field(..., pattern="^(android|ios|web)$")
    device_id: Optional[str] = Field(None, max_length=255)


class FCMTokenResponse(BaseModel):
    """FCM token registration response."""
    id: int
    token: str
    platform: str
    device_id: Optional[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Endpoints ────────────────────────────────────────────────────────


@router.get("/preferences", response_model=NotificationPreferencesResponse)
async def get_notification_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get user's notification preferences.
    Creates default preferences if none exist.
    """
    user_id = current_user.id

    result = await db.execute(
        select(UserNotificationPreference).where(UserNotificationPreference.user_id == user_id)
    )
    prefs = result.scalar_one_or_none()

    if not prefs:
        prefs = UserNotificationPreference(
            user_id=user_id,
            push_enabled=True,
            study_reminders=True,
            task_alerts=True,
            referral_bonuses=True,
            wallet_updates=True,
            ad_rewards=True,
        )
        db.add(prefs)
        await db.commit()
        await db.refresh(prefs)

    return prefs


@router.put("/preferences", response_model=NotificationPreferencesResponse)
async def update_notification_preferences(
    preferences: NotificationPreferences,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update user's notification preferences.
    """
    user_id = current_user.id

    quiet_start = None
    quiet_end = None
    if preferences.quiet_hours_start:
        try:
            h, m = map(int, preferences.quiet_hours_start.split(":"))
            quiet_start = time(h, m)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="quiet_hours_start must be in HH:MM format"
            )
    if preferences.quiet_hours_end:
        try:
            h, m = map(int, preferences.quiet_hours_end.split(":"))
            quiet_end = time(h, m)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="quiet_hours_end must be in HH:MM format"
            )

    result = await db.execute(
        select(UserNotificationPreference).where(UserNotificationPreference.user_id == user_id)
    )
    prefs = result.scalar_one_or_none()

    if prefs:
        prefs.push_enabled = preferences.push_enabled
        prefs.study_reminders = preferences.study_reminders
        prefs.task_alerts = preferences.task_alerts
        prefs.referral_bonuses = preferences.referral_bonuses
        prefs.wallet_updates = preferences.wallet_updates
        prefs.ad_rewards = preferences.ad_rewards
        prefs.quiet_hours_start = quiet_start
        prefs.quiet_hours_end = quiet_end
        prefs.updated_at = datetime.utcnow()
    else:
        prefs = UserNotificationPreference(
            user_id=user_id,
            push_enabled=preferences.push_enabled,
            study_reminders=preferences.study_reminders,
            task_alerts=preferences.task_alerts,
            referral_bonuses=preferences.referral_bonuses,
            wallet_updates=preferences.wallet_updates,
            ad_rewards=preferences.ad_rewards,
            quiet_hours_start=quiet_start,
            quiet_hours_end=quiet_end,
        )
        db.add(prefs)

    await db.commit()
    await db.refresh(prefs)
    return prefs


@router.post("/fcm-token", response_model=FCMTokenResponse, status_code=status.HTTP_201_CREATED)
async def register_fcm_token(
    token_req: FCMTokenRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Register FCM token for push notifications.
    If token already exists, mark it as active and update timestamp.
    """
    user_id = current_user.id

    result = await db.execute(
        select(FCMToken).where(FCMToken.token == token_req.token)
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.is_active = True
        existing.user_id = user_id
        existing.platform = token_req.platform
        existing.device_id = token_req.device_id
        existing.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(existing)
        return existing

    new_token = FCMToken(
        user_id=user_id,
        token=token_req.token,
        platform=token_req.platform,
        device_id=token_req.device_id,
        is_active=True,
    )
    db.add(new_token)
    await db.commit()
    await db.refresh(new_token)
    return new_token


@router.delete("/fcm-token/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def deregister_fcm_token(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Deregister FCM token (mark as inactive).
    Called when user logs out or uninstalls app.
    """
    user_id = current_user.id

    result = await db.execute(
        select(FCMToken).where(
            FCMToken.token == token,
            FCMToken.user_id == user_id,
        )
    )
    fcm_token = result.scalar_one_or_none()

    if not fcm_token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Token not found or already inactive"
        )

    fcm_token.is_active = False
    fcm_token.updated_at = datetime.utcnow()
    await db.commit()
    return None


@router.get("/fcm-tokens", response_model=list[FCMTokenResponse])
async def list_fcm_tokens(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List all active FCM tokens for current user.
    Useful for debugging or device management.
    """
    user_id = current_user.id

    result = await db.execute(
        select(FCMToken)
        .where(FCMToken.user_id == user_id, FCMToken.is_active == True)
        .order_by(FCMToken.created_at.desc())
    )
    tokens = result.scalars().all()
    return list(tokens)
