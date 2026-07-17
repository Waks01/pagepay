"""Phase 7: Sponsor endpoints - registration, KYC, task creation."""

import logging
import json
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.config import settings
from app.models import User, SponsorKYC, Task, SponsorWalletTransaction, TaskSubmission, UserReputation
from app.schemas import (
    SponsorRegisterRequest, TokenResponse, SponsorKYCSubmitRequest, SponsorKYCResponse,
    SponsorWalletDepositRequest, SponsorWalletDepositResponse,
    TaskCreateRequest, TaskResponse, TaskPublishRequest, TaskSubmissionResponse
)
from app.services.auth import hash_password, create_access_token, get_current_user
from app.services.sanitize import sanitize_for_log

router = APIRouter(prefix="/sponsor", tags=["sponsor"])
logger = logging.getLogger("uvicorn.error")


def require_sponsor(current_user: User = Depends(get_current_user)) -> User:
    """Dependency to ensure user is a verified sponsor."""
    if not current_user.is_sponsor:
        raise HTTPException(status_code=403, detail="Not a sponsor")
    if not current_user.sponsor_verified:
        raise HTTPException(status_code=403, detail="Sponsor not verified. Complete KYC first.")
    return current_user


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register_sponsor(
    payload: SponsorRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """Register new sponsor account.
    
    Anyone can be a sponsor - individuals, influencers, small businesses, brands.
    No business registration required.
    """
    # Check if user exists
    existing = await db.execute(
        select(User).where(User.email == payload.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user with sponsor flags
    user = User(
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        is_worker=True,  # Sponsors can also be workers
        is_sponsor=True,
        business_name=payload.display_name,  # Use display_name as business_name
        business_registration_number=payload.business_registration_number,
        sponsor_kyc_status="none"
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    
    # Create reputation record
    reputation = UserReputation(user_id=user.id)
    db.add(reputation)
    await db.commit()
    
    token = create_access_token(user.id)
    # `user.email` and `payload.display_name` are user-controlled.
    # Sanitize before logging so a malicious sponsor can't forge
    # fake log lines.
    logger.info("Sponsor registered: %s (%s)", sanitize_for_log(user.email), sanitize_for_log(payload.display_name))
    
    return TokenResponse(access_token=token)


@router.get("/kyc", response_model=SponsorKYCResponse)
async def get_kyc_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current KYC status."""
    if not current_user.is_sponsor:
        raise HTTPException(status_code=403, detail="Not a sponsor")
    
    kyc = await db.get(SponsorKYC, current_user.id)
    
    if not kyc:
        return SponsorKYCResponse(
            status="none",
            submitted_at=None,
            reviewed_at=None,
            rejection_reason=None
        )
    
    return SponsorKYCResponse(
        status=kyc.status,
        submitted_at=kyc.submitted_at,
        reviewed_at=kyc.reviewed_at,
        rejection_reason=kyc.rejection_reason
    )


@router.put("/kyc", response_model=SponsorKYCResponse)
async def submit_kyc(
    payload: SponsorKYCSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit KYC documents for review.
    
    Only ID document is required. Business documents are optional for companies.
    """
    if not current_user.is_sponsor:
        raise HTTPException(status_code=403, detail="Not a sponsor")
    
    # Upload ID document to Cloudinary (required)
    from app.services.cloudinary import upload_base64_image
    
    if not payload.id_document_base64:
        raise HTTPException(status_code=400, detail="ID document is required")
    
    try:
        id_doc_result = await upload_base64_image(
            payload.id_document_base64,
            f"kyc/sponsor_{current_user.id}_id_{int(datetime.now().timestamp())}"
        )
        id_document_url = id_doc_result["secure_url"]
    except Exception as e:
        logger.error(f"ID document upload failed: {e}")
        raise HTTPException(status_code=500, detail="ID document upload failed")
    
    # Upload business document (optional, only if provided)
    business_document_url = None
    if payload.business_document_base64:
        try:
            bus_doc_result = await upload_base64_image(
                payload.business_document_base64,
                f"kyc/sponsor_{current_user.id}_business_{int(datetime.now().timestamp())}"
            )
            business_document_url = bus_doc_result["secure_url"]
        except Exception as e:
            logger.error(f"Business document upload failed: {e}")
    
    # Create or update KYC record
    kyc = await db.get(SponsorKYC, current_user.id)
    
    if kyc:
        # Update existing
        kyc.business_type = payload.business_type or "individual"
        kyc.business_address = payload.business_address
        kyc.business_website = payload.business_website
        kyc.contact_person_name = payload.full_name
        kyc.contact_person_phone = payload.phone_number
        kyc.id_document_url = id_document_url
        kyc.id_document_type = payload.id_document_type
        kyc.id_document_number = payload.id_document_number
        kyc.business_document_url = business_document_url
        kyc.status = "pending"
        kyc.submitted_at = datetime.utcnow()
    else:
        # Create new
        kyc = SponsorKYC(
            sponsor_id=current_user.id,
            business_name=current_user.business_name or payload.full_name,
            business_registration_number=current_user.business_registration_number,
            business_type=payload.business_type or "individual",
            business_address=payload.business_address,
            business_website=payload.business_website,
            contact_person_name=payload.full_name,
            contact_person_phone=payload.phone_number,
            id_document_url=id_document_url,
            id_document_type=payload.id_document_type,
            id_document_number=payload.id_document_number,
            business_document_url=business_document_url,
            status="pending",
            submitted_at=datetime.utcnow()
        )
        db.add(kyc)
    
    # Update user KYC status
    current_user.sponsor_kyc_status = "pending"
    current_user.sponsor_kyc_submitted_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(kyc)
    
    logger.info(f"Sponsor KYC submitted: user_id={current_user.id} (type: {payload.business_type or 'individual'})")
    
    return SponsorKYCResponse(
        status=kyc.status,
        submitted_at=kyc.submitted_at,
        reviewed_at=kyc.reviewed_at,
        rejection_reason=kyc.rejection_reason
    )


@router.post("/wallet/deposit", response_model=SponsorWalletDepositResponse)
async def initiate_wallet_deposit(
    payload: SponsorWalletDepositRequest,
    current_user: User = Depends(require_sponsor),
    db: AsyncSession = Depends(get_db),
):
    """Initiate Paystack deposit to sponsor wallet."""
    from app.services.paystack import get_client as get_paystack_client
    
    if not settings.paystack_secret_key:
        raise HTTPException(status_code=503, detail="Payment provider not configured")
    
        paystack = get_paystack_client()
    
    # Generate reference
    import uuid
    reference = f"sponsor_deposit_{current_user.id}_{uuid.uuid4().hex[:16]}"
    
    # Initialize transaction
    result = await paystack.initialize_transaction(
        email=current_user.email or f"sponsor{current_user.id}@pagepay.app",
        amount_kobo=payload.amount_kobo,
        reference=reference,
        callback_url=f"{settings.public_base_url}/sponsor/wallet/callback",
        metadata={
            "user_id": current_user.id,
            "type": "sponsor_wallet_deposit",
            "amount_kobo": payload.amount_kobo
        }
    )
    
    logger.info(f"Sponsor wallet deposit initiated: user_id={current_user.id}, amount={payload.amount_kobo}")
    
    return SponsorWalletDepositResponse(
        payment_url=result["authorization_url"],
        reference=reference,
        amount_kobo=payload.amount_kobo
    )


@router.post("/tasks", response_model=TaskResponse, status_code=201)
async def create_task(
    payload: TaskCreateRequest,
    current_user: User = Depends(require_sponsor),
    db: AsyncSession = Depends(get_db),
):
    """Create new task (draft status)."""
    # Calculate escrow: sponsor pays exactly the worker reward total.
    # The platform fee is deducted from the worker's payout, not added
    # on top — keeps the math transparent and avoids double-dipping.
    worker_rewards_total = int(payload.reward_amount_kobo * payload.max_completions * payload.reward_multiplier)
    total_escrowed = worker_rewards_total
    platform_fee = int(worker_rewards_total * settings.platform_task_revenue_percent)
    
    # Validate platform-controlled base rate
    from app.constants.task_rates import get_task_rates_from_db
    task_rates = await get_task_rates_from_db(db)
    if payload.task_type in task_rates:
        min_reward = task_rates[payload.task_type]
        if payload.reward_amount_kobo < min_reward:
            raise HTTPException(
                status_code=400,
                detail=f"Minimum reward for {payload.task_type.replace('youtube_', '')} is ₦{min_reward / 100:.2f}"
            )

    expires_at = datetime.utcnow() + timedelta(days=payload.expires_in_days)
    
    # Create task
    task = Task(
        sponsor_id=current_user.id,
        title=payload.title,
        description=payload.description,
        instructions=payload.instructions,
        task_type=payload.task_type,
        platform=payload.platform,
        category=payload.category,
        target_url=payload.target_url,
        proof_type=payload.proof_type,
        proof_instructions=payload.proof_instructions,
        reward_amount=payload.reward_amount_kobo,
        reward_multiplier=payload.reward_multiplier,
        max_completions=payload.max_completions,
        total_escrowed=total_escrowed,
        platform_fee_amount=platform_fee,
        expires_at=expires_at,
        time_limit_minutes=payload.time_limit_minutes,
        target_countries=json.dumps(payload.target_countries) if payload.target_countries else None,
        target_cities=json.dumps(payload.target_cities) if payload.target_cities else None,
        target_gender=payload.target_gender,
        target_age_min=payload.target_age_min,
        target_age_max=payload.target_age_max,
        min_worker_level=payload.min_worker_level,
        min_approval_rate=payload.min_approval_rate,
        status="draft"
    )
    
    db.add(task)
    await db.commit()
    await db.refresh(task)
    
    logger.info(f"Task created: task_id={task.id}, sponsor_id={current_user.id}")
    
    return TaskResponse.model_validate(task)


@router.post("/tasks/{task_id}/publish", response_model=TaskResponse)
async def publish_task(
    task_id: int,
    payload: TaskPublishRequest,
    current_user: User = Depends(require_sponsor),
    db: AsyncSession = Depends(get_db),
):
    """Publish task (lock escrow and make active)."""
    task = await db.get(Task, task_id)
    
    if not task or task.sponsor_id != current_user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.status != "draft":
        raise HTTPException(status_code=400, detail="Task already published")
    
    # Check sponsor has sufficient balance
    if current_user.sponsor_wallet_balance < task.total_escrowed:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient balance. Need ₦{task.total_escrowed/100:.2f}, have ₦{current_user.sponsor_wallet_balance/100:.2f}"
        )
    
    # Lock escrow
    current_user.sponsor_wallet_balance -= task.total_escrowed
    
    # Create wallet transaction
    transaction = SponsorWalletTransaction(
        sponsor_id=current_user.id,
        type="task_escrow",
        amount=-task.total_escrowed,
        balance_before=current_user.sponsor_wallet_balance + task.total_escrowed,
        balance_after=current_user.sponsor_wallet_balance,
        task_id=task_id,
        description=f"Escrow locked for task: {task.title}"
    )
    db.add(transaction)
    
    # Publish task
    task.status = "active"
    task.published_at = datetime.utcnow()
    
    # Update reputation
    rep = await db.execute(
        select(UserReputation).where(UserReputation.user_id == current_user.id)
    )
    sponsor_rep = rep.scalar_one_or_none()
    if sponsor_rep:
        sponsor_rep.tasks_posted += 1
    
    await db.commit()
    await db.refresh(task)
    
    logger.info(f"Task published: task_id={task_id}, escrow={task.total_escrowed}")
    
    return TaskResponse.model_validate(task)


@router.get("/tasks", response_model=list[TaskResponse])
async def get_sponsor_tasks(
    status: str | None = None,
    current_user: User = Depends(require_sponsor),
    db: AsyncSession = Depends(get_db),
):
    """Get sponsor's tasks."""
    query = select(Task).where(Task.sponsor_id == current_user.id)
    
    if status:
        query = query.where(Task.status == status)
    
    query = query.order_by(Task.created_at.desc())
    
    result = await db.execute(query)
    tasks = result.scalars().all()
    
    return [TaskResponse.model_validate(t) for t in tasks]


@router.get("/tasks/{task_id}/submissions", response_model=list[TaskSubmissionResponse])
async def get_task_submissions(
    task_id: int,
    status: str | None = None,
    current_user: User = Depends(require_sponsor),
    db: AsyncSession = Depends(get_db),
):
    """Get submissions for sponsor's task."""
    task = await db.get(Task, task_id)
    
    if not task or task.sponsor_id != current_user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    
    query = select(TaskSubmission).where(TaskSubmission.task_id == task_id)
    
    if status:
        query = query.where(TaskSubmission.status == status)
    
    query = query.order_by(TaskSubmission.created_at.desc())
    
    result = await db.execute(query)
    submissions = result.scalars().all()
    
    return [
        TaskSubmissionResponse(
            id=s.id,
            task_id=s.task_id,
            worker_id=s.worker_id,
            task_title=task.title,
            task_type=task.task_type,
            platform=task.platform,
            reward_amount=task.reward_amount,
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



@router.post("/submissions/{submission_id}/approve")
async def sponsor_approve_submission(
    submission_id: int,
    current_user: User = Depends(require_sponsor),
    db: AsyncSession = Depends(get_db),
):
    """Sponsor approves a submission on their task."""
    # Fetch submission and verify ownership
    stmt = (
        select(TaskSubmission, Task)
        .join(Task, Task.id == TaskSubmission.task_id)
        .where(
            TaskSubmission.id == submission_id,
            Task.sponsor_id == current_user.id
        )
    )
    result = await db.execute(stmt)
    row = result.one_or_none()
    
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found or not owned by you")
    
    submission, task = row
    
    if submission.status == "approved":
        raise HTTPException(status_code=400, detail="Submission already approved")
    
    if submission.status == "rejected":
        raise HTTPException(status_code=400, detail="Cannot approve rejected submission")
    
    # Update submission status
    submission.status = "approved"
    submission.reviewed_by = current_user.id
    submission.reviewed_at = datetime.utcnow()
    
    # Credit worker
    worker_stmt = select(User).where(User.id == submission.worker_id)
    worker_result = await db.execute(worker_stmt)
    worker = worker_result.scalar_one_or_none()
    
    net_reward = 0
    if worker:
        net_reward = int(task.reward_amount * task.reward_multiplier * (100 - task.platform_fee_percent) / 100)
        worker.points_balance += net_reward
        submission.reward_paid = net_reward
        submission.payment_status = "paid"
        submission.paid_at = datetime.utcnow()
    
    # Update task stats
    task.approved_count += 1
    task.completed_count += 1
    
    if task.pending_count > 0:
        task.pending_count -= 1
    
    if task.completed_count >= task.max_completions:
        task.status = "completed"
        task.completed_at = datetime.utcnow()
    
    # Update worker reputation
    rep_stmt = select(UserReputation).where(UserReputation.user_id == submission.worker_id)
    rep_result = await db.execute(rep_stmt)
    reputation = rep_result.scalar_one_or_none()
    
    if not reputation:
        reputation = UserReputation(user_id=submission.worker_id)
        db.add(reputation)
    
    reputation.tasks_approved += 1
    reputation.tasks_completed += 1
    reputation.total_earnings += net_reward
    
    if reputation.tasks_completed > 0:
        reputation.approval_rate = reputation.tasks_approved / reputation.tasks_completed
    
    # Update sponsor reputation
    sponsor_rep_stmt = select(UserReputation).where(UserReputation.user_id == current_user.id)
    sponsor_rep_result = await db.execute(sponsor_rep_stmt)
    sponsor_reputation = sponsor_rep_result.scalar_one_or_none()
    
    if not sponsor_reputation:
        sponsor_reputation = UserReputation(user_id=current_user.id)
        db.add(sponsor_reputation)
    
    sponsor_reputation.submissions_reviewed += 1
    sponsor_reputation.submissions_approved += 1
    
    if sponsor_reputation.submissions_reviewed > 0:
        sponsor_reputation.sponsor_approval_rate = (
            sponsor_reputation.submissions_approved / sponsor_reputation.submissions_reviewed
        )
    
    await db.commit()
    
    logger.info(f"Sponsor {current_user.id} approved submission {submission_id}, credited {net_reward} to worker {worker.id if worker else 'N/A'}")
    
    return {
        "success": True,
        "message": "Submission approved successfully",
        "reward_paid": net_reward,
        "worker_id": submission.worker_id,
    }


@router.post("/submissions/{submission_id}/reject")
async def sponsor_reject_submission(
    submission_id: int,
    reason: str = Query(..., min_length=10, max_length=500),
    current_user: User = Depends(require_sponsor),
    db: AsyncSession = Depends(get_db),
):
    """Sponsor rejects a submission on their task."""
    # Fetch submission and verify ownership
    stmt = (
        select(TaskSubmission, Task)
        .join(Task, Task.id == TaskSubmission.task_id)
        .where(
            TaskSubmission.id == submission_id,
            Task.sponsor_id == current_user.id
        )
    )
    result = await db.execute(stmt)
    row = result.one_or_none()
    
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found or not owned by you")
    
    submission, task = row
    
    if submission.status in ["approved", "rejected"]:
        raise HTTPException(status_code=400, detail=f"Submission already {submission.status}")
    
    # Update submission status
    submission.status = "rejected"
    submission.rejection_reason = reason
    submission.reviewed_by = current_user.id
    submission.reviewed_at = datetime.utcnow()
    
    # Update task stats
    task.rejected_count += 1
    
    if task.pending_count > 0:
        task.pending_count -= 1
    
    # Update worker reputation
    rep_stmt = select(UserReputation).where(UserReputation.user_id == submission.worker_id)
    rep_result = await db.execute(rep_stmt)
    reputation = rep_result.scalar_one_or_none()
    
    if reputation:
        reputation.tasks_rejected += 1
        if (reputation.tasks_approved + reputation.tasks_rejected) > 0:
            reputation.approval_rate = reputation.tasks_approved / (reputation.tasks_approved + reputation.tasks_rejected)
    
    # Update sponsor reputation
    sponsor_rep_stmt = select(UserReputation).where(UserReputation.user_id == current_user.id)
    sponsor_rep_result = await db.execute(sponsor_rep_stmt)
    sponsor_reputation = sponsor_rep_result.scalar_one_or_none()
    
    if not sponsor_reputation:
        sponsor_reputation = UserReputation(user_id=current_user.id)
        db.add(sponsor_reputation)
    
    sponsor_reputation.submissions_reviewed += 1
    sponsor_reputation.submissions_rejected += 1
    
    if sponsor_reputation.submissions_reviewed > 0:
        sponsor_reputation.sponsor_approval_rate = (
            sponsor_reputation.submissions_approved / sponsor_reputation.submissions_reviewed
        )
    
    await db.commit()

    # `reason` is a free-text admin field; sanitize before logging.
    logger.info("Sponsor %s rejected submission %s: %s", current_user.id, submission_id, sanitize_for_log(reason))
    
    return {
        "success": True,
        "message": "Submission rejected",
        "reason": reason,
        "worker_id": submission.worker_id,
    }
