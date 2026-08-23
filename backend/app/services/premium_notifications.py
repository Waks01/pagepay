"""
Phase 6: Premium Subscription Notifications

Centralized notification creation for premium-related events:
- Subscription activation
- Subscription expiring soon (7 days, 3 days, 1 day)
- Subscription expired
- Earning milestone notifications with premium multipliers
"""

import logging
from datetime import datetime, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserTier
from app.services.notifications import create_notification

logger = logging.getLogger(__name__)


async def notify_premium_activated(
    db: AsyncSession,
    user_id: int,
    tier: UserTier,
    expires_at: datetime,
) -> None:
    """Notify user that premium subscription is now active.
    
    Phase 6: Welcome notification with benefits summary.
    """
    tier_name = "Premium Monthly" if tier == UserTier.PREMIUM_MONTHLY else "Premium Yearly"
    expires_str = expires_at.strftime("%B %d, %Y")
    
    benefits = [
        "2x reading points",
        "1.5x ad rewards",
        "2x task & daily rewards",
        "2x bills cashback",
        "Skip ads on novels",
        "Free study material access"
    ]
    
    await create_notification(
        db=db,
        user_id=user_id,
        title=f"🎉 {tier_name} Activated!",
        body=f"Your premium subscription is active until {expires_str}. Enjoy: {', '.join(benefits[:3])} and more!",
        category="subscription",
        data={
            "type": "subscription_activated",
            "tier": tier.value,
            "expires_at": expires_at.isoformat(),
        },
    )
    
    logger.info(
        "Sent premium activation notification: user=%d tier=%s",
        user_id, tier.value
    )


async def notify_premium_expiring_soon(
    db: AsyncSession,
    user_id: int,
    tier: UserTier,
    expires_at: datetime,
    days_left: int,
) -> None:
    """Notify user that premium subscription is expiring soon.
    
    Phase 6: Reminder notification with renewal CTA.
    """
    tier_name = "Premium Monthly" if tier == UserTier.PREMIUM_MONTHLY else "Premium Yearly"
    
    if days_left == 7:
        title = "⏰ Premium Expires in 7 Days"
        body = f"Your {tier_name} subscription expires on {expires_at.strftime('%B %d')}. Renew now to keep earning 2x points!"
    elif days_left == 3:
        title = "⚠️ Premium Expires in 3 Days"
        body = f"Don't lose your premium benefits! Renew your {tier_name} subscription before {expires_at.strftime('%B %d')}."
    elif days_left == 1:
        title = "🚨 Premium Expires Tomorrow!"
        body = f"Your {tier_name} subscription ends tomorrow. Renew now to keep your 2x multipliers and ad-free experience."
    else:
        return  # Only send at 7, 3, 1 days
    
    await create_notification(
        db=db,
        user_id=user_id,
        title=title,
        body=body,
        category="subscription",
        data={
            "type": "subscription_expiring",
            "tier": tier.value,
            "expires_at": expires_at.isoformat(),
            "days_left": days_left,
        },
    )
    
    logger.info(
        "Sent premium expiring notification: user=%d days_left=%d",
        user_id, days_left
    )


async def notify_premium_expired(
    db: AsyncSession,
    user_id: int,
    expired_tier: UserTier,
) -> None:
    """Notify user that premium subscription has expired.
    
    Phase 6: Expiry notification with re-subscribe CTA.
    """
    tier_name = "Premium Monthly" if expired_tier == UserTier.PREMIUM_MONTHLY else "Premium Yearly"
    
    await create_notification(
        db=db,
        user_id=user_id,
        title="💔 Premium Subscription Expired",
        body=f"Your {tier_name} subscription has ended. You're now on the Free plan. Re-subscribe to get back your 2x earnings and ad-free reading!",
        category="subscription",
        data={
            "type": "subscription_expired",
            "expired_tier": expired_tier.value,
        },
    )
    
    logger.info(
        "Sent premium expired notification: user=%d tier=%s",
        user_id, expired_tier.value
    )


async def notify_earning_milestone(
    db: AsyncSession,
    user_id: int,
    activity_type: str,
    points_earned: int,
    multiplier: float,
) -> None:
    """Notify premium user about boosted earnings milestone.
    
    Phase 6: Celebrate premium multiplier benefits with milestone notifications.
    """
    # Only send for premium users with multipliers
    if multiplier <= 1.0:
        return
    
    # Only send for significant milestones
    if points_earned < 100:
        return
    
    activity_icons = {
        "reading": "📚",
        "ad": "📺",
        "task": "✅",
        "daily": "🎁",
        "bills": "💳",
    }
    
    icon = activity_icons.get(activity_type, "⚡")
    base_points = int(points_earned / multiplier)
    bonus_points = points_earned - base_points
    
    await create_notification(
        db=db,
        user_id=user_id,
        title=f"{icon} Premium Boost: +{points_earned} Points!",
        body=f"You earned {points_earned} points ({base_points} + {bonus_points} premium bonus) from {activity_type}. That's {multiplier}x more than Free users!",
        category="achievement",
        data={
            "type": "earning_milestone",
            "activity_type": activity_type,
            "points_earned": points_earned,
            "base_points": base_points,
            "bonus_points": bonus_points,
            "multiplier": multiplier,
        },
    )
    
    logger.info(
        "Sent earning milestone notification: user=%d activity=%s points=%d",
        user_id, activity_type, points_earned
    )


async def check_and_notify_expiring_subscriptions(db: AsyncSession) -> int:
    """Background task: Check for expiring subscriptions and send reminders.
    
    Phase 6: Cron job to send expiry reminders at 7, 3, and 1 days before expiry.
    
    Returns:
        Number of notifications sent
    """
    now = datetime.utcnow()
    
    # Check for subscriptions expiring in 7, 3, or 1 days
    for days_left in [7, 3, 1]:
        target_date = now + timedelta(days=days_left)
        date_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        date_end = target_date.replace(hour=23, minute=59, second=59, microsecond=999999)
        
        # Find users whose subscription expires on target date
        result = await db.execute(
            select(User).where(
                User.tier.in_([UserTier.PREMIUM_MONTHLY, UserTier.PREMIUM_YEARLY]),
                User.subscription_expires_at >= date_start,
                User.subscription_expires_at <= date_end,
            )
        )
        users = result.scalars().all()
        
        for user in users:
            await notify_premium_expiring_soon(
                db=db,
                user_id=user.id,
                tier=user.tier,
                expires_at=user.subscription_expires_at,
                days_left=days_left,
            )
        
        logger.info(
            "Sent %d expiring subscription reminders for %d days left",
            len(users), days_left
        )
    
    await db.commit()
    return sum([len(users) for days_left in [7, 3, 1]])



async def notify_payment_initiated(
    db: AsyncSession,
    user_id: int,
    tier: UserTier,
    amount_kobo: int,
    reference: str,
) -> None:
    """Notify user that premium payment has been initiated.
    
    Phase 6: Payment started - waiting for Paystack confirmation.
    """
    tier_name = "Premium Monthly" if tier == UserTier.PREMIUM_MONTHLY else "Premium Yearly"
    amount_naira = amount_kobo / 100
    
    await create_notification(
        db=db,
        user_id=user_id,
        title="⏳ Processing Your Premium Payment",
        body=f"We're processing your {tier_name} payment of ₦{amount_naira:,.0f}. You'll be notified once it's confirmed.",
        category="subscription",
        data={
            "type": "payment_initiated",
            "tier": tier.value,
            "amount_kobo": amount_kobo,
            "reference": reference,
        },
    )
    
    logger.info(
        "Sent payment initiated notification: user=%d tier=%s ref=%s",
        user_id, tier.value, reference
    )


async def notify_payment_pending(
    db: AsyncSession,
    user_id: int,
    tier: UserTier,
    reference: str,
) -> None:
    """Notify user that payment is pending verification.
    
    Phase 6: Payment received but awaiting bank/Paystack confirmation.
    """
    tier_name = "Premium Monthly" if tier == UserTier.PREMIUM_MONTHLY else "Premium Yearly"
    
    await create_notification(
        db=db,
        user_id=user_id,
        title="⏰ Premium Payment Pending",
        body=f"Your {tier_name} payment is pending bank confirmation. This usually takes a few minutes. We'll notify you once it's confirmed.",
        category="subscription",
        data={
            "type": "payment_pending",
            "tier": tier.value,
            "reference": reference,
        },
    )
    
    logger.info(
        "Sent payment pending notification: user=%d tier=%s ref=%s",
        user_id, tier.value, reference
    )


async def notify_payment_failed(
    db: AsyncSession,
    user_id: int,
    tier: UserTier,
    reference: str,
    reason: str = "Payment could not be processed",
) -> None:
    """Notify user that premium payment failed.
    
    Phase 6: Payment was declined or failed.
    """
    tier_name = "Premium Monthly" if tier == UserTier.PREMIUM_MONTHLY else "Premium Yearly"
    
    await create_notification(
        db=db,
        user_id=user_id,
        title="❌ Premium Payment Failed",
        body=f"Your {tier_name} payment could not be processed. {reason}. Please try again or use a different payment method.",
        category="subscription",
        data={
            "type": "payment_failed",
            "tier": tier.value,
            "reference": reference,
            "reason": reason,
        },
    )
    
    logger.info(
        "Sent payment failed notification: user=%d tier=%s ref=%s",
        user_id, tier.value, reference
    )


async def notify_payment_cancelled(
    db: AsyncSession,
    user_id: int,
    tier: UserTier,
    reference: str,
) -> None:
    """Notify user that premium payment was cancelled.
    
    Phase 6: User cancelled the payment or it timed out.
    """
    tier_name = "Premium Monthly" if tier == UserTier.PREMIUM_MONTHLY else "Premium Yearly"
    
    await create_notification(
        db=db,
        user_id=user_id,
        title="🚫 Premium Payment Cancelled",
        body=f"Your {tier_name} payment was cancelled. You can try again anytime from the Premium tab.",
        category="subscription",
        data={
            "type": "payment_cancelled",
            "tier": tier.value,
            "reference": reference,
        },
    )
    
    logger.info(
        "Sent payment cancelled notification: user=%d tier=%s ref=%s",
        user_id, tier.value, reference
    )


async def notify_payment_refunded(
    db: AsyncSession,
    user_id: int,
    tier: UserTier,
    amount_kobo: int,
    reference: str,
    reason: str = "Refund processed",
) -> None:
    """Notify user that premium payment was refunded.
    
    Phase 6: Payment was refunded - subscription reversed.
    """
    tier_name = "Premium Monthly" if tier == UserTier.PREMIUM_MONTHLY else "Premium Yearly"
    amount_naira = amount_kobo / 100
    
    await create_notification(
        db=db,
        user_id=user_id,
        title="💰 Premium Payment Refunded",
        body=f"Your {tier_name} payment of ₦{amount_naira:,.0f} has been refunded. {reason}. Your premium subscription has been cancelled.",
        category="subscription",
        data={
            "type": "payment_refunded",
            "tier": tier.value,
            "amount_kobo": amount_kobo,
            "reference": reference,
            "reason": reason,
        },
    )
    
    logger.info(
        "Sent payment refunded notification: user=%d tier=%s ref=%s",
        user_id, tier.value, reference
    )


async def notify_payment_abandoned(
    db: AsyncSession,
    user_id: int,
    tier: UserTier,
    reference: str,
) -> None:
    """Notify user about abandoned premium payment (optional reminder).
    
    Phase 6: User initiated payment but didn't complete it.
    """
    tier_name = "Premium Monthly" if tier == UserTier.PREMIUM_MONTHLY else "Premium Yearly"
    
    await create_notification(
        db=db,
        user_id=user_id,
        title="💭 Complete Your Premium Upgrade?",
        body=f"You started a {tier_name} payment but didn't complete it. Ready to unlock 2x earnings and ad-free reading?",
        category="subscription",
        data={
            "type": "payment_abandoned",
            "tier": tier.value,
            "reference": reference,
        },
    )
    
    logger.info(
        "Sent payment abandoned notification: user=%d tier=%s ref=%s",
        user_id, tier.value, reference
    )



async def notify_daily_reward_available(
    db: AsyncSession,
    user_id: int,
    streak_days: int,
    is_premium: bool = False,
) -> None:
    """Notify user that daily reward is available to claim.
    
    Phase 6: Daily reminder to keep streak going.
    """
    if is_premium:
        title = "⚡ Daily Reward Ready - 2x Points!"
        body = f"Claim your daily reward with premium 2x boost! Current streak: {streak_days} days. Don't break it!"
    else:
        title = "🎁 Daily Reward Available!"
        body = f"Your daily reward is ready! Current streak: {streak_days} days. Claim it now to keep your streak!"
    
    await create_notification(
        db=db,
        user_id=user_id,
        title=title,
        body=body,
        category="daily_reward",
        data={
            "type": "daily_reward_reminder",
            "streak_days": streak_days,
            "is_premium": is_premium,
        },
    )
    
    logger.info(
        "Sent daily reward reminder: user=%d streak=%d premium=%s",
        user_id, streak_days, is_premium
    )


async def notify_streak_milestone(
    db: AsyncSession,
    user_id: int,
    streak_days: int,
    milestone_reward: int = 0,
) -> None:
    """Notify user about streak milestone achievement.
    
    Phase 6: Celebrate streak milestones (7, 14, 30, 60, 90, 365 days).
    """
    milestones = {
        7: ("🔥 7-Day Streak!", "Amazing! You've maintained a 7-day streak!"),
        14: ("🔥🔥 14-Day Streak!", "Incredible! Two weeks of daily rewards!"),
        30: ("🎯 30-Day Streak!", "Outstanding! A full month of dedication!"),
        60: ("🏆 60-Day Streak!", "Phenomenal! Two months of consistency!"),
        90: ("👑 90-Day Streak!", "Legendary! Three months of daily rewards!"),
        180: ("💎 180-Day Streak!", "Elite! Half a year of dedication!"),
        365: ("🌟 365-Day Streak!", "CHAMPION! A full year of daily rewards!"),
    }
    
    if streak_days not in milestones:
        return
    
    title, body = milestones[streak_days]
    if milestone_reward > 0:
        body += f" Bonus reward: {milestone_reward} points!"
    
    await create_notification(
        db=db,
        user_id=user_id,
        title=title,
        body=body,
        category="achievement",
        data={
            "type": "streak_milestone",
            "streak_days": streak_days,
            "milestone_reward": milestone_reward,
        },
    )
    
    logger.info(
        "Sent streak milestone notification: user=%d streak=%d",
        user_id, streak_days
    )


async def notify_streak_broken(
    db: AsyncSession,
    user_id: int,
    lost_streak: int,
) -> None:
    """Notify user that their streak was broken.
    
    Phase 6: Gentle reminder to start a new streak.
    """
    await create_notification(
        db=db,
        user_id=user_id,
        title="💔 Streak Broken",
        body=f"You missed yesterday's daily reward and lost your {lost_streak}-day streak. Start a new streak today!",
        category="daily_reward",
        data={
            "type": "streak_broken",
            "lost_streak": lost_streak,
        },
    )
    
    logger.info(
        "Sent streak broken notification: user=%d lost_streak=%d",
        user_id, lost_streak
    )


async def check_and_send_daily_reward_reminders(db: AsyncSession) -> int:
    """Background task: Send daily reward reminders to users who haven't claimed today.
    
    Phase 6: Cron job to send reminders (run once per day, e.g., at 9 AM).
    
    Returns:
        Number of reminders sent
    """
    from app.models import UserRewardStreak
    from datetime import date, datetime, timezone
    
    today = date.today().isoformat()
    
    # Find users who have a streak but haven't claimed today
    result = await db.execute(
        select(UserRewardStreak, User)
        .join(User, UserRewardStreak.user_id == User.id)
        .where(
            UserRewardStreak.last_reward_claim_date != today,
            UserRewardStreak.reward_streak > 0,  # Only users with active streaks
        )
    )
    streaks_users = result.all()
    
    count = 0
    for streak, user in streaks_users:
        is_premium = user.tier in (UserTier.PREMIUM_MONTHLY, UserTier.PREMIUM_YEARLY)
        await notify_daily_reward_available(
            db=db,
            user_id=user.id,
            streak_days=streak.reward_streak,
            is_premium=is_premium,
        )
        count += 1
    
    await db.commit()
    logger.info("Sent %d daily reward reminders", count)
    return count
