"""
Fraud Detection Service for PagePay
Detects and flags:
- Duplicate screenshots in task submissions
- Duplicate accounts (same device/IP)
- Referral abuse
- Suspicious reading sessions
"""
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from app.models import (
    FraudFlag, TaskSubmission, ReadingSession, 
    Referral
)

logger = logging.getLogger("uvicorn")


class FraudDetectionService:
    """Service for detecting fraudulent activity."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def check_duplicate_screenshot(
        self, 
        submission_id: int,
        image_hash: str,
        user_id: int
    ) -> Optional[FraudFlag]:
        """
        Check if screenshot has been used before.
        
        Args:
            submission_id: Current submission ID
            image_hash: SHA256 hash of the screenshot
            user_id: User who submitted
        
        Returns:
            FraudFlag if duplicate found, None otherwise
        """
        # Check if this hash exists in other submissions
        stmt = select(TaskSubmission).where(
            and_(
                TaskSubmission.proof_image_url.isnot(None),
                TaskSubmission.id != submission_id
            )
        ).limit(100)  # Check last 100 submissions
        
        result = await self.db.execute(stmt)
        submissions = result.scalars().all()
        
        # Count how many times this hash appears
        duplicate_count = 0
        duplicate_submission_ids = []
        
        for sub in submissions:
            if sub.proof_image_url and self._hash_matches(sub.proof_image_url, image_hash):
                duplicate_count += 1
                duplicate_submission_ids.append(sub.id)
        
        if duplicate_count > 0:
            flag = FraudFlag(
                user_id=user_id,
                session_id=None,
                flag_type="duplicate_screenshot",
                severity="high" if duplicate_count >= 3 else "medium",
                details=f"Screenshot reused {duplicate_count} times. Submission IDs: {duplicate_submission_ids}",
                status="pending"
            )
            self.db.add(flag)
            await self.db.commit()
            logger.warning(f"Duplicate screenshot detected for user {user_id}, submission {submission_id}")
            return flag
        
        return None
    
    async def check_duplicate_accounts(
        self,
        user_id: int,
        device_fingerprint: Optional[str] = None,
        ip_address: Optional[str] = None
    ) -> Optional[FraudFlag]:
        """
        Check if user shares device/IP with other accounts via TaskSubmission.
        
        Queries TaskSubmission for matching device_fingerprint or ip_address
        to detect multi-accounting in the task marketplace.
        """
        if not device_fingerprint and not ip_address:
            return None
        
        # Find other task submissions with same device fingerprint or IP
        duplicate_submission_count = 0
        duplicate_user_ids = set()
        
        if device_fingerprint:
            stmt = select(TaskSubmission).where(
                and_(
                    TaskSubmission.device_fingerprint == device_fingerprint,
                    TaskSubmission.worker_id != user_id
                )
            ).limit(50)
            
            result = await self.db.execute(stmt)
            submissions = result.scalars().all()
            duplicate_user_ids.update(s.worker_id for s in submissions if s.worker_id)
            duplicate_submission_count += len(submissions)
        
        if ip_address:
            stmt = select(TaskSubmission).where(
                and_(
                    TaskSubmission.ip_address == ip_address,
                    TaskSubmission.worker_id != user_id
                )
            ).limit(50)
            
            result = await self.db.execute(stmt)
            submissions = result.scalars().all()
            duplicate_user_ids.update(s.worker_id for s in submissions if s.worker_id)
            duplicate_submission_count += len(submissions)
        
        if duplicate_user_ids:
            flag = FraudFlag(
                user_id=user_id,
                session_id=None,
                flag_type="duplicate_account",
                severity="high" if len(duplicate_user_ids) >= 5 else "medium",
                details=f"Device/IP shared with {len(duplicate_user_ids)} other accounts via submissions",
                status="pending"
            )
            self.db.add(flag)
            await self.db.commit()
            logger.warning(f"Duplicate account detected for user {user_id}: {len(duplicate_user_ids)} accounts share device/IP")
            return flag
        
        return None
    
    async def check_referral_abuse(
        self,
        referrer_id: int
    ) -> Optional[FraudFlag]:
        """
        Check for suspicious referral patterns.
        
        Flags:
        - Too many referrals in short time (>10 in 1 hour)
        - Referred users with same device fingerprint
        - Referred users who never read
        
        Args:
            referrer_id: User who referred others
        
        Returns:
            FraudFlag if abuse detected, None otherwise
        """
        # Check referral velocity (last 24 hours)
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        
        stmt = select(func.count()).select_from(Referral).where(
            and_(
                Referral.referrer_id == referrer_id,
                Referral.created_at >= since
            )
        )
        
        result = await self.db.execute(stmt)
        recent_referrals = result.scalar_one()
        
        if recent_referrals > 10:  # Suspicious: >10 referrals in 24 hours
            flag = FraudFlag(
                user_id=referrer_id,
                session_id=None,
                flag_type="referral_abuse",
                severity="high" if recent_referrals > 20 else "medium",
                details=f"{recent_referrals} referrals in last 24 hours (threshold: 10)",
                status="pending"
            )
            self.db.add(flag)
            await self.db.commit()
            logger.warning(f"Referral abuse detected for user {referrer_id}: {recent_referrals} referrals in 24h")
            return flag
        
        return None
    
    async def check_suspicious_session(
        self,
        session_id: int,
        user_id: int,
        duration_seconds: int,
        content_length: int
    ) -> Optional[FraudFlag]:
        """
        Check for suspicious reading session patterns.
        
        Flags:
        - Reading too fast (>10 pages/minute)
        - Reading too slow (<1 page/10 minutes)
        - Suspicious duration (reading for >12 hours straight)
        
        Args:
            session_id: Reading session ID
            user_id: User who read
            duration_seconds: Session duration
            content_length: Content length in words
        
        Returns:
            FraudFlag if suspicious, None otherwise
        """
        # Calculate reading speed (words per minute)
        if duration_seconds < 10:  # Too short to evaluate
            return None
        
        duration_minutes = duration_seconds / 60
        wpm = content_length / duration_minutes if duration_minutes > 0 else 0
        
        # Normal reading: 200-400 WPM
        # Suspicious: <50 WPM (not reading) or >800 WPM (skipping)
        
        if wpm < 50 and duration_minutes > 5:
            # User opened page but didn't read
            flag = FraudFlag(
                user_id=user_id,
                session_id=session_id,
                flag_type="suspicious_session",
                severity="low",
                details=f"Abnormally slow reading: {wpm:.1f} WPM (expected: 200-400 WPM)",
                status="pending"
            )
            self.db.add(flag)
            await self.db.commit()
            return flag
        
        if wpm > 800:
            # User skipped through content
            flag = FraudFlag(
                user_id=user_id,
                session_id=session_id,
                flag_type="suspicious_session",
                severity="medium",
                details=f"Abnormally fast reading: {wpm:.1f} WPM (expected: 200-400 WPM)",
                status="pending"
            )
            self.db.add(flag)
            await self.db.commit()
            logger.warning(f"Suspicious session detected for user {user_id}: {wpm:.1f} WPM")
            return flag
        
        # Check for marathon sessions (>12 hours)
        if duration_seconds > 43200:  # 12 hours
            flag = FraudFlag(
                user_id=user_id,
                session_id=session_id,
                flag_type="suspicious_session",
                severity="high",
                details=f"Extremely long session: {duration_seconds/3600:.1f} hours (threshold: 12 hours)",
                status="pending"
            )
            self.db.add(flag)
            await self.db.commit()
            logger.warning(f"Marathon session detected for user {user_id}: {duration_seconds/3600:.1f} hours")
            return flag
        
        return None
    
    def _hash_matches(self, url: str, target_hash: str) -> bool:
        """
        Check if URL content hash matches target.
        
        In production, you'd download and hash the image.
        For now, we use URL as proxy.
        """
        url_hash = hashlib.sha256(url.encode()).hexdigest()
        return url_hash == target_hash
    
    def calculate_image_hash(self, image_data: bytes) -> str:
        """Calculate SHA256 hash of image data."""
        return hashlib.sha256(image_data).hexdigest()


async def run_fraud_checks_on_submission(
    db: AsyncSession,
    submission_id: int,
    user_id: int,
    proof_image_url: Optional[str] = None,
    device_fingerprint: Optional[str] = None,
    ip_address: Optional[str] = None
):
    """
    Run all fraud checks on a task submission.
    
    Call this after a submission is created.
    """
    service = FraudDetectionService(db)
    
    # Check duplicate screenshot
    if proof_image_url:
        image_hash = hashlib.sha256(proof_image_url.encode()).hexdigest()
        await service.check_duplicate_screenshot(submission_id, image_hash, user_id)
    
    # Check duplicate accounts
    if device_fingerprint or ip_address:
        await service.check_duplicate_accounts(user_id, device_fingerprint, ip_address)


async def run_fraud_checks_on_session(
    db: AsyncSession,
    session_id: int,
    user_id: int,
    duration_seconds: int,
    content_length: int
):
    """
    Run fraud checks on a reading session.
    
    Call this after a session ends.
    """
    service = FraudDetectionService(db)
    await service.check_suspicious_session(session_id, user_id, duration_seconds, content_length)


async def run_fraud_checks_on_referral(
    db: AsyncSession,
    referrer_id: int
):
    """
    Run fraud checks on referral activity.
    
    Call this after a new referral bonus is awarded.
    """
    service = FraudDetectionService(db)
    await service.check_referral_abuse(referrer_id)
