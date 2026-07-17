"""
Background task processor for Phase 7 submissions.

Processes submissions in 'validating' status:
- Runs AI verification
- Updates submission status based on confidence threshold
- Credits worker wallet on approval
- Updates task/reputation stats
"""
import asyncio
import logging
from datetime import datetime
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import TaskSubmission, Task, User, UserReputation, SponsorWalletTransaction
from app.services.ai_verification import verification_service

logger = logging.getLogger("uvicorn")


class TaskProcessor:
    """Processes task submissions with AI verification."""
    
    def __init__(self):
        self.running = False
        self.batch_size = 10
        self.sleep_interval = 5  # seconds
    
    async def start(self):
        """Start the background processor."""
        self.running = True
        logger.info("Task processor started")
        
        while self.running:
            try:
                await self.process_batch()
                await asyncio.sleep(self.sleep_interval)
            except Exception as e:
                logger.error(f"Task processor error: {e}", exc_info=True)
                await asyncio.sleep(self.sleep_interval)
    
    def stop(self):
        """Stop the background processor."""
        self.running = False
        logger.info("Task processor stopped")
    
    async def process_batch(self):
        """Process a batch of pending submissions."""
        async with AsyncSessionLocal() as db:
            # Fetch submissions with status='validating'
            stmt = (
                select(TaskSubmission)
                .where(TaskSubmission.status == "validating")
                .limit(self.batch_size)
            )
            result = await db.execute(stmt)
            submissions = result.scalars().all()
            
            if not submissions:
                return
            
            logger.info(f"Processing {len(submissions)} submissions")
            
            for submission in submissions:
                try:
                    await self.process_submission(db, submission)
                except Exception as e:
                    logger.error(f"Error processing submission {submission.id}: {e}", exc_info=True)
                    # Mark as failed for manual review
                    submission.status = "pending"
                    submission.flagged_for_review = True
                    await db.commit()
    
    async def process_submission(self, db: AsyncSession, submission: TaskSubmission):
        """Process a single submission."""
        # Fetch related task
        stmt = select(Task).where(Task.id == submission.task_id)
        result = await db.execute(stmt)
        task = result.scalar_one_or_none()
        
        if not task:
            logger.warning(f"Task {submission.task_id} not found for submission {submission.id}")
            submission.status = "rejected"
            submission.rejection_reason = "Task not found"
            await db.commit()
            return
        
        # Prepare proof data
        proof_data = {
            "screenshot_url": submission.proof_image_url,
            "url": submission.proof_url,
            "text": submission.proof_text,
            "username": submission.proof_metadata  # May contain worker's social handle
        }
        
        # Prepare task requirements
        requirements = {
            "target_username": task.target_url.split("/")[-1] if task.target_url else None,
            "tweet_url": task.target_url,
            "url_pattern": task.target_url,
            "min_length": 50,  # Default for text tasks
            "keywords": []
        }
        
        # Run AI verification
        verification_result = await verification_service.verify_submission(
            task_type=task.task_type,
            platform=task.platform,
            proof_type=submission.proof_type,
            proof_data=proof_data,
            task_requirements=requirements
        )
        
        # Update submission with verification result
        submission.ai_verified = verification_result["verified"]
        submission.ai_confidence = verification_result["confidence"]
        submission.ai_verification_details = str(verification_result.get("checks", {}))
        submission.ai_verified_at = datetime.utcnow()
        submission.fraud_score = verification_result["fraud_score"]
        
        confidence = verification_result["confidence"]
        
        # Decision logic based on confidence threshold
        if confidence >= task.ai_auto_approve_threshold:
            # Auto-approve (high confidence)
            submission.status = "approved"
            submission.auto_approved = True
            await self._approve_submission(db, submission, task)
            logger.info(f"Submission {submission.id} auto-approved (confidence: {confidence:.2f})")
        
        elif confidence >= 0.6:
            # Pending manual review (medium confidence)
            submission.status = "pending"
            submission.flagged_for_review = True
            task.pending_count += 1
            logger.info(f"Submission {submission.id} flagged for manual review (confidence: {confidence:.2f})")
        
        else:
            # Auto-reject (low confidence)
            submission.status = "rejected"
            submission.rejection_reason = f"AI verification failed: {verification_result['details']}"
            task.rejected_count += 1
            logger.info(f"Submission {submission.id} auto-rejected (confidence: {confidence:.2f})")
        
        await db.commit()
    
    async def _approve_submission(self, db: AsyncSession, submission: TaskSubmission, task: Task):
        """Approve submission and credit worker."""
        # Update task stats
        task.approved_count += 1
        task.completed_count += 1
        
        # Check if task is complete
        if task.completed_count >= task.max_completions:
            task.status = "completed"
            task.completed_at = datetime.utcnow()
        
        # Credit worker
        stmt = select(User).where(User.id == submission.worker_id)
        result = await db.execute(stmt)
        worker = result.scalar_one_or_none()
        
        if worker:
            # Calculate net reward (after platform fee)
            net_reward = int(task.reward_amount * task.reward_multiplier * (100 - task.platform_fee_percent) / 100)
            
            worker.points_balance += net_reward
            submission.reward_paid = net_reward
            submission.payment_status = "paid"
            submission.paid_at = datetime.utcnow()
            
            logger.info(f"Credited {net_reward} points to user {worker.id}")
        
        # Update worker reputation
        stmt = select(UserReputation).where(UserReputation.user_id == submission.worker_id)
        result = await db.execute(stmt)
        reputation = result.scalar_one_or_none()
        
        if not reputation:
            # Create reputation record
            reputation = UserReputation(user_id=submission.worker_id)
            db.add(reputation)
        
        reputation.tasks_completed += 1
        reputation.tasks_approved += 1
        reputation.total_earnings += submission.reward_paid
        
        # Calculate approval rate
        if reputation.tasks_completed > 0:
            reputation.approval_rate = reputation.tasks_approved / reputation.tasks_completed
        
        # Award XP (10 XP per task + bonus for quality)
        xp_earned = 10
        if submission.ai_confidence >= 0.95:
            xp_earned += 5  # Bonus for high quality
        
        reputation.worker_xp += xp_earned
        
        # Check for level up
        while reputation.worker_xp >= reputation.worker_xp_to_next_level:
            reputation.worker_level += 1
            reputation.worker_xp -= reputation.worker_xp_to_next_level
            reputation.worker_xp_to_next_level = int(reputation.worker_xp_to_next_level * 1.5)
            logger.info(f"User {submission.worker_id} leveled up to {reputation.worker_level}")
        
        # Update streak
        today = datetime.utcnow().date()
        last_task_date = reputation.last_task_date.date() if reputation.last_task_date else None
        
        if last_task_date == today:
            pass  # Same day, no streak change
        elif last_task_date and (today - last_task_date).days == 1:
            # Consecutive day
            reputation.current_streak_days += 1
            if reputation.current_streak_days > reputation.longest_streak_days:
                reputation.longest_streak_days = reputation.current_streak_days
        elif not last_task_date or (today - last_task_date).days > 1:
            # Streak broken, restart
            reputation.current_streak_days = 1
        
        reputation.last_task_date = datetime.utcnow()
        
        await db.commit()


# Singleton instance
task_processor = TaskProcessor()
