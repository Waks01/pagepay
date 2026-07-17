"""
Firebase Cloud Messaging service for sending push notifications.
Phase 3 feature: Push notifications via FCM.
"""
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, time as time_type

import firebase_admin
from firebase_admin import credentials, messaging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import UserNotificationPreference, FCMToken

logger = logging.getLogger(__name__)

# Initialize Firebase Admin SDK (singleton)
_firebase_app = None


def initialize_firebase():
    """
    Initialize Firebase Admin SDK with service account credentials.
    Call this once at app startup.
    """
    global _firebase_app
    
    if _firebase_app is not None:
        return _firebase_app
    
    try:
        # Load service account JSON from file
        cred = credentials.Certificate(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
        _firebase_app = firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin SDK initialized successfully")
        return _firebase_app
    except Exception as e:
        logger.error(f"Failed to initialize Firebase Admin SDK: {e}")
        raise


async def send_push_notification(
    db: AsyncSession,
    user_id: int,
    title: str,
    body: str,
    data: Optional[Dict[str, str]] = None,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Send push notification to a user via FCM.
    
    Args:
        db: Database session
        user_id: Target user ID
        title: Notification title
        body: Notification body
        data: Optional custom data payload
        category: Notification category (study_reminders, task_alerts, etc.)
    
    Returns:
        dict with success status and details
    """
    # Check user's notification preferences
    result = await db.execute(
        select(UserNotificationPreference).where(UserNotificationPreference.user_id == user_id)
    )
    prefs = result.scalar_one_or_none()

    # If no preferences, assume notifications enabled
    if prefs:
        # Check if push is globally disabled
        if not prefs.push_enabled:
            logger.info(f"Push notifications disabled for user {user_id}")
            return {"success": False, "reason": "push_disabled"}

        # Check category-specific preference
        if category:
            category_enabled = getattr(prefs, category, True)
            if not category_enabled:
                logger.info(f"{category} notifications disabled for user {user_id}")
                return {"success": False, "reason": f"{category}_disabled"}

        # Check quiet hours
        if prefs.quiet_hours_start and prefs.quiet_hours_end:
            now_time = datetime.utcnow().time()
            if is_in_quiet_hours(now_time, prefs.quiet_hours_start, prefs.quiet_hours_end):
                logger.info(f"User {user_id} is in quiet hours")
                return {"success": False, "reason": "quiet_hours"}

    # Get active FCM tokens for user
    result = await db.execute(
        select(FCMToken).where(
            FCMToken.user_id == user_id,
            FCMToken.is_active == True,
        )
    )
    tokens = result.scalars().all()

    if not tokens:
        logger.warning(f"No active FCM tokens found for user {user_id}")
        return {"success": False, "reason": "no_tokens"}
    
    # Build FCM message
    notification = messaging.Notification(
        title=title,
        body=body,
    )
    
    # Send to all user's devices
    successful_sends = 0
    failed_tokens = []
    
    for fcm_token in tokens:
        token = fcm_token.token
        
        try:
            message = messaging.Message(
                notification=notification,
                data=data or {},
                token=token,
                android=messaging.AndroidConfig(
                    priority='high',
                    notification=messaging.AndroidNotification(
                        sound='default',
                        channel_id='default',
                    )
                ),
                apns=messaging.APNSConfig(
                    payload=messaging.APNSPayload(
                        aps=messaging.Aps(
                            sound='default',
                            badge=1,
                        )
                    )
                ),
            )
            
            # Send message
            response = messaging.send(message)
            logger.info(f"Successfully sent notification to user {user_id}, token ending in ...{token[-10:]}")
            successful_sends += 1
            
        except messaging.UnregisteredError:
            # Token is invalid, mark as inactive
            logger.warning(f"FCM token invalid for user {user_id}, marking inactive")
            failed_tokens.append(token)
            
        except Exception as e:
            logger.error(f"Failed to send FCM notification to user {user_id}: {e}")
            failed_tokens.append(token)
    
    # Deactivate failed tokens
    if failed_tokens:
        await db.execute(
            update(FCMToken)
            .where(FCMToken.token.in_(failed_tokens))
            .values(is_active=False, updated_at=datetime.utcnow())
        )
        await db.commit()
    
    return {
        "success": successful_sends > 0,
        "successful_sends": successful_sends,
        "failed_tokens": len(failed_tokens),
        "total_tokens": len(tokens),
    }


async def send_bulk_push_notification(
    db: AsyncSession,
    user_ids: List[int],
    title: str,
    body: str,
    data: Optional[Dict[str, str]] = None,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Send push notification to multiple users.
    Useful for broadcast announcements or batch reminders.
    
    Args:
        db: Database session
        user_ids: List of target user IDs
        title: Notification title
        body: Notification body
        data: Optional custom data payload
        category: Notification category (study_reminders, task_alerts, etc.)
    
    Returns:
        dict with success counts and details
    """
    total_success = 0
    total_failed = 0
    
    for user_id in user_ids:
        result = await send_push_notification(
            db=db,
            user_id=user_id,
            title=title,
            body=body,
            data=data,
            category=category,
        )
        
        if result["success"]:
            total_success += result["successful_sends"]
        else:
            total_failed += 1
    
    return {
        "total_users": len(user_ids),
        "successful_notifications": total_success,
        "failed_notifications": total_failed,
    }


def is_in_quiet_hours(current_time: time_type, start: time_type, end: time_type) -> bool:
    """
    Check if current time is within quiet hours range.
    Handles cases where quiet hours span midnight (e.g., 22:00 to 07:00).
    """
    if start <= end:
        # Normal range (e.g., 09:00 to 17:00)
        return start <= current_time <= end
    else:
        # Range spans midnight (e.g., 22:00 to 07:00)
        return current_time >= start or current_time <= end


# Example usage functions for common notification types

async def send_study_reminder(db: AsyncSession, user_id: int, study_streak: int):
    """Send daily study reminder notification."""
    await send_push_notification(
        db=db,
        user_id=user_id,
        title="📚 Time to study!",
        body=f"Keep your {study_streak}-day streak going. Review your flashcards now.",
        data={"type": "study_reminder", "streak": str(study_streak)},
        category="study_reminders",
    )


async def send_task_alert(db: AsyncSession, user_id: int, task_title: str, reward_amount: int):
    """Send new task available notification."""
    await send_push_notification(
        db=db,
        user_id=user_id,
        title="💼 New Task Available!",
        body=f"Earn ₦{reward_amount} by completing: {task_title}",
        data={"type": "task_alert", "reward": str(reward_amount)},
        category="task_alerts",
    )


async def send_referral_bonus(db: AsyncSession, user_id: int, friend_name: str, bonus_points: int):
    """Send referral signup bonus notification."""
    await send_push_notification(
        db=db,
        user_id=user_id,
        title="🎁 Referral Bonus!",
        body=f"{friend_name} joined PagePay! You earned {bonus_points} points.",
        data={"type": "referral_bonus", "points": str(bonus_points)},
        category="referral_bonuses",
    )


async def send_wallet_update(db: AsyncSession, user_id: int, amount: int, transaction_type: str):
    """Send wallet credit/debit notification."""
    emoji = "💰" if transaction_type == "credit" else "💸"
    action = "received" if transaction_type == "credit" else "spent"
    
    await send_push_notification(
        db=db,
        user_id=user_id,
        title=f"{emoji} Wallet Update",
        body=f"You {action} ₦{amount}",
        data={"type": "wallet_update", "amount": str(amount), "transaction_type": transaction_type},
        category="wallet_updates",
    )


async def send_ad_reward(db: AsyncSession, user_id: int, points_earned: int):
    """Send ad watch reward notification."""
    await send_push_notification(
        db=db,
        user_id=user_id,
        title="📺 Ad Reward Earned!",
        body=f"You earned {points_earned} points for watching an ad!",
        data={"type": "ad_reward", "points": str(points_earned)},
        category="ad_rewards",
    )
