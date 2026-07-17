"""Phase 7: Social Tasks Marketplace - Worker endpoints."""

import logging
from datetime import datetime
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from app.database import get_db
from app.models import User, Task, TaskSubmission, UserReputation, Leaderboard, TaskMessage, Achievement, UserAchievement
from app.schemas import (
    TaskListItem, TaskResponse, TaskSubmitRequest, TaskSubmissionResponse,
    WorkerStatsResponse, LeaderboardResponse, LeaderboardEntry,
    TaskMessageResponse, AchievementResponse, UserAchievementResponse
)
from app.services.auth import get_current_user

router = APIRouter(prefix="/tasks", tags=["tasks"])
logger = logging.getLogger("uvicorn.error")

# Hosts that should never appear in a proof_url. Captures the obvious
# cloud-metadata endpoints plus localhost variants — the URL validator
# also blocks private/loopback IP literals, this list is the host-name
# belt-and-braces.
_BLOCKED_HOSTS: frozenset[str] = frozenset({
    "localhost",
    "127.0.0.1",
    "0.0.0.0",  # nosec - documented exception
    "169.254.169.254",  # AWS / GCP / Azure instance metadata
    "metadata.google.internal",
    "metadata.azure.com",
})


@router.get("", response_model=list[TaskListItem])
async def list_tasks(
    category: str | None = None,
    platform: str | None = None,
    min_reward: int | None = None,
    max_reward: int | None = None,
    sort: str = "newest",
    page: int = 1,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List available tasks for worker.
    
    Filters:
    - Only active, not expired tasks
    - User hasn't already completed
    - User meets eligibility (level, approval rate, demographics)
    """
    if limit > 50:
        limit = 50
    offset = (page - 1) * limit
    
    # Build query with filters
    query = select(Task).where(
        Task.status == "active",
        Task.expires_at > datetime.utcnow(),
        Task.completed_count < Task.max_completions,
    )
    
    if category:
        query = query.where(Task.category == category)
    if platform:
        query = query.where(Task.platform == platform)
    if min_reward:
        query = query.where(Task.reward_amount >= min_reward)
    if max_reward:
        query = query.where(Task.reward_amount <= max_reward)
    
    # Check user reputation for eligibility
    rep_result = await db.execute(
        select(UserReputation).where(UserReputation.user_id == current_user.id)
    )
    user_rep = rep_result.scalar_one_or_none()
    
    if user_rep:
        query = query.where(
            Task.min_worker_level <= user_rep.worker_level,
            Task.min_approval_rate <= user_rep.approval_rate
        )
    
    # Exclude tasks user already submitted
    subquery = select(TaskSubmission.task_id).where(
        TaskSubmission.worker_id == current_user.id
    )
    query = query.where(Task.id.not_in(subquery))
    
    # Sorting
    if sort == "highest_reward":
        query = query.order_by(Task.reward_amount.desc())
    elif sort == "quickest":
        query = query.order_by(Task.time_limit_minutes.asc())
    elif sort == "popular":
        query = query.order_by(Task.completed_count.desc())
    else:  # newest
        query = query.order_by(Task.created_at.desc())
    
    query = query.offset(offset).limit(limit)
    
    result = await db.execute(query)
    tasks = result.scalars().all()
    
    # Format response
    response = []
    for task in tasks:
        sponsor = await db.get(User, task.sponsor_id)
        response.append(TaskListItem(
            id=task.id,
            title=task.title,
            task_type=task.task_type,
            platform=task.platform,
            reward_amount=task.reward_amount,
            max_completions=task.max_completions,
            completed_count=task.completed_count,
            expires_at=task.expires_at,
            sponsor_business_name=sponsor.business_name if sponsor else None,
            time_estimate_minutes=task.time_limit_minutes or 5
        ))
    
    return response


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task_detail(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get task detail for worker."""
    task = await db.get(Task, task_id)
    if not task or task.status != "active":
        raise HTTPException(status_code=404, detail="Task not found")
    
    return TaskResponse.model_validate(task)


@router.post("/{task_id}/start", status_code=201)
async def start_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Worker starts task (begins timer if time limit set)."""
    task = await db.get(Task, task_id)
    if not task or task.status != "active":
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Task expired")
    
    if task.completed_count >= task.max_completions:
        raise HTTPException(status_code=400, detail="Task full")
    
    # Check if already submitted
    existing = await db.execute(
        select(TaskSubmission).where(
            TaskSubmission.task_id == task_id,
            TaskSubmission.worker_id == current_user.id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already submitted this task")
    
    # Create submission record with started_at
    submission = TaskSubmission(
        task_id=task_id,
        worker_id=current_user.id,
        proof_type=task.proof_type,
        status="started",
        started_at=datetime.utcnow()
    )
    db.add(submission)
    
    # Update user reputation stats
    rep = await db.execute(
        select(UserReputation).where(UserReputation.user_id == current_user.id)
    )
    user_rep = rep.scalar_one_or_none()
    if not user_rep:
        user_rep = UserReputation(user_id=current_user.id)
        db.add(user_rep)
    
    user_rep.tasks_started += 1
    
    await db.commit()
    await db.refresh(submission)
    
    expires_at = None
    if task.time_limit_minutes:
        from datetime import timedelta
        expires_at = submission.started_at + timedelta(minutes=task.time_limit_minutes)
    
    return {
        "submission_id": submission.id,
        "started_at": submission.started_at,
        "expires_at": expires_at,
        "instructions": task.instructions,
        "target_url": task.target_url
    }


@router.get("/my-stats", response_model=WorkerStatsResponse)
async def get_worker_stats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get worker reputation and stats."""
    rep = await db.execute(
        select(UserReputation).where(UserReputation.user_id == current_user.id)
    )
    user_rep = rep.scalar_one_or_none()
    
    if not user_rep:
        user_rep = UserReputation(user_id=current_user.id)
        db.add(user_rep)
        await db.commit()
        await db.refresh(user_rep)
    
    import json
    badges = json.loads(user_rep.badges) if user_rep.badges else []
    
    return WorkerStatsResponse(
        user_id=current_user.id,
        worker_level=user_rep.worker_level,
        worker_xp=user_rep.worker_xp,
        xp_to_next_level=user_rep.worker_xp_to_next_level,
        tasks_completed=user_rep.tasks_completed,
        tasks_approved=user_rep.tasks_approved,
        tasks_rejected=user_rep.tasks_rejected,
        approval_rate=user_rep.approval_rate,
        total_earned=user_rep.total_earnings,
        current_streak=user_rep.current_streak_days,
        longest_streak=user_rep.longest_streak_days,
        badges=badges,
        created_at=current_user.created_at,
        updated_at=user_rep.updated_at
    )


@router.post("/{task_id}/submit", response_model=TaskSubmissionResponse)
async def submit_task(
    task_id: int,
    proof_image_base64: str | None = None,
    proof_url: str | None = None,
    proof_text: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Worker submits task proof.
    
    Accepts base64 encoded image for screenshot proof type.
    """
    task = await db.get(Task, task_id)
    if not task or task.status != "active":
        raise HTTPException(status_code=404, detail="Task not found")

    # Get started submission
    submission_result = await db.execute(
        select(TaskSubmission).where(
            TaskSubmission.task_id == task_id,
            TaskSubmission.worker_id == current_user.id,
            TaskSubmission.status == "started"
        )
    )
    submission = submission_result.scalar_one_or_none()

    if not submission:
        raise HTTPException(status_code=400, detail="Task not started. Call /start first.")

    # C3 audit fix: validate proof_url / proof_text inputs.
    # proof_url is rendered in the admin review UI — unvalidated, it can
    # be a `javascript:` URI, a private-IP SSRF target, or a megabyte
    # of garbage. proof_text is shown in the same review surface and
    # rendered as text, but we cap length so a worker can't blow up
    # the review page. proof_image_base64 already goes through
    # Cloudinary, which validates content type server-side.
    if proof_url is not None:
        proof_url = proof_url.strip()
        if not proof_url:
            proof_url = None
        else:
            if len(proof_url) > 2048:
                raise HTTPException(
                    status_code=400,
                    detail="proof_url is too long (max 2048 characters)",
                )
            parsed = urlparse(proof_url)
            if parsed.scheme not in ("http", "https"):
                raise HTTPException(
                    status_code=400,
                    detail="proof_url must be an http:// or https:// URL",
                )
            host = (parsed.hostname or "").lower()
            if not host:
                raise HTTPException(status_code=400, detail="proof_url must include a host")
            # SSRF: block private/loopback IP literals and known
            # metadata endpoints. DNS lookups aren't performed here
            # (that would block the request); if you need DNS-level
            # blocking, do it in the fraud_check step.
            if host in _BLOCKED_HOSTS or host.endswith(".internal"):
                raise HTTPException(
                    status_code=400,
                    detail="proof_url points to a blocked host",
                )
            try:
                import ipaddress
                ipaddress.ip_address(host)
                # Resolved to a literal IP — must be public.
                ip = ipaddress.ip_address(host)
                if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                    raise HTTPException(
                        status_code=400,
                        detail="proof_url must point to a public address",
                    )
            except ValueError:
                # Not an IP literal — hostname, that's fine.
                pass

    if proof_text is not None:
        proof_text = proof_text.strip()
        if not proof_text:
            proof_text = None
        elif len(proof_text) > 5000:
            raise HTTPException(
                status_code=400,
                detail="proof_text is too long (max 5000 characters)",
            )
    
    # Upload image to Cloudinary if provided
    proof_image_url = None
    if proof_image_base64 and task.proof_type in ["screenshot", "photo", "video"]:
        from app.services.cloudinary import upload_base64_image
        try:
            public_id = f"user_{current_user.id}_task_{task_id}_{int(datetime.now().timestamp())}"
            upload_result = await upload_base64_image(proof_image_base64, public_id)
            proof_image_url = upload_result["secure_url"]
        except Exception as e:
            logger.error(f"Cloudinary upload failed: {e}")
            raise HTTPException(status_code=500, detail="Image upload failed")
    
    # Calculate completion time
    completion_time = None
    if submission.started_at:
        completion_time = int((datetime.utcnow() - submission.started_at).total_seconds())
    
    # Update submission
    submission.proof_image_url = proof_image_url
    submission.proof_url = proof_url
    submission.proof_text = proof_text
    submission.status = "validating"  # Will trigger AI verification
    submission.submitted_at = datetime.utcnow()
    submission.completion_time_seconds = completion_time
    
    # Update reputation
    rep = await db.execute(
        select(UserReputation).where(UserReputation.user_id == current_user.id)
    )
    user_rep = rep.scalar_one_or_none()
    if user_rep:
        user_rep.tasks_completed += 1
    
    await db.commit()
    await db.refresh(submission)
    
    # H4 audit fix: run fraud checks but don't let a fraud-check bug
    # block a legitimate submission. We narrow the except to a known
    # transient set (DB disconnect, AI provider rate limit) so an
    # unexpected error (a typo in fraud_detection.py, a missing column)
    # surfaces as ERROR in the logs instead of a silent WARNING. The
    # submission keeps the "validating" status; an admin can re-run
    # the check later via the admin task reviewer.
    try:
        from app.services.fraud_detection import run_fraud_checks_on_submission
        await run_fraud_checks_on_submission(
            db=db,
            submission_id=submission.id,
            user_id=current_user.id,
            proof_image_url=proof_image_url,
            device_fingerprint=submission.device_fingerprint,
            ip_address=submission.ip_address
        )
    except (ConnectionError, TimeoutError) as e:
        # Transient: fraud check will be retried by the async worker.
        logger.warning(
            "Transient fraud-check failure on submission %s (will retry): %s",
            submission.id, e,
        )
    except Exception as e:
        # Unexpected: this is a bug in fraud_detection.py or a schema
        # mismatch, not normal operation. Log at ERROR with traceback
        # so it gets investigated, but still don't fail the submission
        # — the worker has already done the work, and the admin
        # reviewer will catch it during manual review.
        logger.error(
            "Fraud check raised an unexpected error on submission %s: %s",
            submission.id, e, exc_info=True,
        )
    
    return TaskSubmissionResponse(
        id=submission.id,
        task_id=submission.task_id,
        worker_id=submission.worker_id,
        proof_type=submission.proof_type,
        proof_image_url=submission.proof_image_url,
        proof_url=submission.proof_url,
        proof_text=submission.proof_text,
        status=submission.status,
        ai_verified=submission.ai_verified,
        ai_confidence=submission.ai_confidence,
        reviewed_at=submission.reviewed_at,
        rejection_reason=submission.rejection_reason,
        reward_paid=submission.reward_paid,
        submitted_at=submission.submitted_at,
        completion_time_seconds=submission.completion_time_seconds
    )


@router.get("/my-submissions", response_model=list[TaskSubmissionResponse])
async def get_my_submissions(
    status: str | None = None,
    page: int = 1,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get worker's submission history."""
    if limit > 50:
        limit = 50
    offset = (page - 1) * limit
    
    query = select(TaskSubmission).where(
        TaskSubmission.worker_id == current_user.id
    )
    
    if status and status != "all":
        query = query.where(TaskSubmission.status == status)
    
    query = query.order_by(TaskSubmission.created_at.desc()).offset(offset).limit(limit)
    
    result = await db.execute(query)
    submissions = result.scalars().all()
    
    # Pre-fetch tasks for enrichment
    task_ids = list({s.task_id for s in submissions if s.task_id})
    tasks_map = {}
    if task_ids:
        tasks_result = await db.execute(select(Task).where(Task.id.in_(task_ids)))
        for t in tasks_result.scalars().all():
            tasks_map[t.id] = t
    
    return [
        TaskSubmissionResponse(
            id=s.id,
            task_id=s.task_id,
            worker_id=s.worker_id,
            task_title=tasks_map.get(s.task_id, {}).title if s.task_id in tasks_map else "",
            task_type=tasks_map.get(s.task_id, {}).task_type if s.task_id in tasks_map else "",
            platform=tasks_map.get(s.task_id, {}).platform if s.task_id in tasks_map else "",
            reward_amount=tasks_map.get(s.task_id, {}).reward_amount if s.task_id in tasks_map else 0,
            proof_type=s.proof_type,
            proof_image_url=s.proof_image_url,
            proof_url=s.proof_url,
            proof_text=s.proof_text,
            status=s.status,
            ai_verified=s.ai_verified,
            ai_confidence=s.ai_confidence,
            verified_at=s.reviewed_at,
            reviewed_at=s.reviewed_at,
            rejection_reason=s.rejection_reason,
            reward_paid=s.reward_paid,
            submitted_at=s.submitted_at,
            completion_time_seconds=s.completion_time_seconds
        )
        for s in submissions
        ]


@router.get("/leaderboard", response_model=LeaderboardResponse)
async def get_leaderboard(
    leaderboard_type: str = "top_earners_week",
    period: str = "current_week",
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get leaderboard rankings."""
    if limit > 100:
        limit = 100
    
    rows = await db.execute(
        select(Leaderboard)
        .where(
            Leaderboard.leaderboard_type == leaderboard_type,
            Leaderboard.period == period
        )
        .order_by(Leaderboard.rank.asc())
        .limit(limit)
    )
    entries = rows.scalars().all()
    
    my_rank = None
    for entry in entries:
        if entry.user_id == current_user.id:
            my_rank = entry
            break
    
    return LeaderboardResponse(
        entries=[
            LeaderboardEntry(
                rank=e.rank,
                user_id=e.user_id,
                username=e.username,
                level=e.level,
                score=e.score,
                avatar_url=e.avatar_url
            )
            for e in entries
        ],
        my_rank=LeaderboardEntry(
            rank=my_rank.rank,
            user_id=my_rank.user_id,
            username=my_rank.username,
            level=my_rank.level,
            score=my_rank.score,
            avatar_url=my_rank.avatar_url
        ) if my_rank else None,
        leaderboard_type=leaderboard_type,
        period=period
    )


@router.get("/achievements", response_model=list[AchievementResponse])
async def list_achievements(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all achievements with unlock status for current user."""
    achievements = await db.execute(select(Achievement).where(Achievement.is_active == True))
    all_achievements = achievements.scalars().all()
    
    user_unlocks = await db.execute(
        select(UserAchievement).where(UserAchievement.user_id == current_user.id)
    )
    unlocked_ids = {ua.achievement_id for ua in user_unlocks.scalars().all()}
    
    return [
        AchievementResponse(
            id=a.id,
            slug=a.slug,
            name=a.name,
            description=a.description,
            icon_emoji=a.icon_emoji,
            xp_reward=a.xp_reward,
            points_reward=a.points_reward,
            rarity=a.rarity,
            unlocked=a.id in unlocked_ids,
            unlocked_at=None  # Could join if needed
        )
        for a in all_achievements
    ]


@router.get("/{task_id}/messages", response_model=list[TaskMessageResponse])
async def get_task_messages(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get chat messages for a task."""
    stmt = select(TaskMessage).where(
        TaskMessage.task_id == task_id,
        or_(
            TaskMessage.sender_id == current_user.id,
            TaskMessage.receiver_id == current_user.id,
        ),
    ).order_by(TaskMessage.created_at.asc())
    
    result = await db.execute(stmt)
    messages = result.scalars().all()
    
    return [
        TaskMessageResponse(
            id=m.id,
            task_id=m.task_id,
            submission_id=m.submission_id,
            sender_id=m.sender_id,
            receiver_id=m.receiver_id,
            message=m.message,
            attachment_url=m.attachment_url,
            attachment_type=m.attachment_type,
            read_at=m.read_at,
            created_at=m.created_at
        )
        for m in messages
    ]


@router.post("/{task_id}/messages", response_model=TaskMessageResponse, status_code=201)
async def send_task_message(
    task_id: int,
    message: str = Query(...),
    submission_id: int | None = None,
    attachment_url: str | None = None,
    attachment_type: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a message in task chat."""
    # Verify task exists
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Determine receiver
    receiver_id = task.sponsor_id if current_user.id != task.sponsor_id else task.sponsor_id
    if current_user.id == receiver_id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    
    msg = TaskMessage(
        task_id=task_id,
        submission_id=submission_id,
        sender_id=current_user.id,
        receiver_id=receiver_id,
        message=message,
        attachment_url=attachment_url,
        attachment_type=attachment_type
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    
    return TaskMessageResponse(
        id=msg.id,
        task_id=msg.task_id,
        submission_id=msg.submission_id,
        sender_id=msg.sender_id,
        receiver_id=msg.receiver_id,
        message=msg.message,
        attachment_url=msg.attachment_url,
        attachment_type=msg.attachment_type,
        read_at=msg.read_at,
        created_at=msg.created_at
    )
