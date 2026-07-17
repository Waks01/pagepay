"""Tasks platform admin endpoints (Phase 7).

Manage sponsor KYC approvals/rejections, review task submissions flagged for
manual verification, and view task platform analytics. Includes worker reward
processing and fraud detection for tasks.
"""

import logging
import json
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    SponsorKYC, User, TaskSubmission, Task, UserReputation,
    AdminUser, AdminAuditLog,
)
from app.services.admin_auth import require_permission

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/tasks", tags=["admin-tasks"])


# ── Helpers ─────────────────────────────────────────────────────────


def _log_admin_action(
    admin_id: int | None,
    admin_email: str | None,
    action: str,
    target_type: str,
    target_id: int | None,
    changes: dict | None,
    ip: str | None = None,
    result: str = "success",
    error: str | None = None,
):
    """Create an audit log entry for admin actions."""
    return AdminAuditLog(
        admin_id=admin_id,
        admin_email=admin_email,
        action=action,
        target_type=target_type,
        target_id=target_id,
        changes=json.dumps(changes) if changes else None,
        ip_address=ip,
        result=result,
        error_message=error,
    )


# ── Sponsor KYC ─────────────────────────────────────────────────────


@router.get("/kyc/pending")
async def list_pending_kyc(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("tasks.kyc")),
    db: AsyncSession = Depends(get_db),
):
    """List pending KYC applications from sponsors."""
    q = (
        select(SponsorKYC, User)
        .join(User, User.id == SponsorKYC.sponsor_id)
        .where(SponsorKYC.status == "pending")
        .order_by(SponsorKYC.submitted_at.desc())
    )

    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()
    rows = await db.execute(q.limit(limit).offset((page - 1) * limit))

    items = []
    for kyc, user in rows.all():
        items.append({
            "sponsor_id": kyc.sponsor_id,
            "user_email": user.email,
            "user_phone": user.phone,
            "business_name": kyc.business_name,
            "business_type": kyc.business_type,
            "business_registration_number": kyc.business_registration_number,
            "id_document_type": kyc.id_document_type,
            "id_document_number": kyc.id_document_number,
            "id_document_url": kyc.id_document_url,
            "business_document_url": kyc.business_document_url,
            "contact_person_name": kyc.contact_person_name,
            "contact_person_phone": kyc.contact_person_phone,
            "contact_person_email": kyc.contact_person_email,
            "submitted_at": kyc.submitted_at.isoformat(),
            "status": kyc.status,
        })

    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.post("/kyc/{sponsor_id}/approve")
async def approve_kyc(
    request: Request,
    sponsor_id: int,
    admin_notes: str | None = Query(None),
    current_admin: AdminUser = Depends(require_permission("tasks.kyc")),
    db: AsyncSession = Depends(get_db),
):
    """Approve sponsor KYC application."""
    result = await db.execute(
        select(SponsorKYC).where(SponsorKYC.sponsor_id == sponsor_id)
    )
    kyc = result.scalar_one_or_none()

    if not kyc:
        raise HTTPException(status_code=404, detail="KYC application not found")

    if kyc.status != "pending":
        raise HTTPException(status_code=400, detail=f"KYC already {kyc.status}")

    # Update KYC status
    kyc.status = "approved"
    kyc.reviewed_at = datetime.now(timezone.utc)
    kyc.reviewed_by = current_admin.id
    if admin_notes:
        kyc.admin_notes = admin_notes

    # Update user sponsor status
    user_result = await db.execute(
        select(User).where(User.id == sponsor_id)
    )
    user = user_result.scalar_one_or_none()

    if user:
        user.sponsor_verified = True
        user.sponsor_kyc_status = "approved"
        user.sponsor_kyc_reviewed_at = datetime.now(timezone.utc)
        user.sponsor_kyc_reviewer_id = current_admin.id

    # Log action
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "approve_kyc",
            "sponsor_kyc",
            sponsor_id,
            {"status": "approved", "notes": admin_notes},
            request.client.host,
        )
    )

    await db.commit()

    logger.info(f"Admin {current_admin.id} approved KYC for sponsor {sponsor_id}")
    return {"success": True, "message": "KYC approved successfully"}


@router.post("/kyc/{sponsor_id}/reject")
async def reject_kyc(
    request: Request,
    sponsor_id: int,
    reason: str = Query(..., min_length=10, max_length=500),
    admin_notes: str | None = Query(None),
    current_admin: AdminUser = Depends(require_permission("tasks.kyc")),
    db: AsyncSession = Depends(get_db),
):
    """Reject sponsor KYC application."""
    result = await db.execute(
        select(SponsorKYC).where(SponsorKYC.sponsor_id == sponsor_id)
    )
    kyc = result.scalar_one_or_none()

    if not kyc:
        raise HTTPException(status_code=404, detail="KYC application not found")

    if kyc.status != "pending":
        raise HTTPException(status_code=400, detail=f"KYC already {kyc.status}")

    # Update KYC status
    kyc.status = "rejected"
    kyc.rejection_reason = reason
    kyc.reviewed_at = datetime.now(timezone.utc)
    kyc.reviewed_by = current_admin.id
    if admin_notes:
        kyc.admin_notes = admin_notes

    # Update user sponsor status
    user_result = await db.execute(
        select(User).where(User.id == sponsor_id)
    )
    user = user_result.scalar_one_or_none()

    if user:
        user.sponsor_kyc_status = "rejected"
        user.sponsor_kyc_reviewed_at = datetime.now(timezone.utc)
        user.sponsor_kyc_reviewer_id = current_admin.id

    # Log action
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "reject_kyc",
            "sponsor_kyc",
            sponsor_id,
            {"status": "rejected", "reason": reason, "notes": admin_notes},
            request.client.host,
        )
    )

    await db.commit()

    logger.info(f"Admin {current_admin.id} rejected KYC for sponsor {sponsor_id}")
    return {"success": True, "message": "KYC rejected", "reason": reason}


# ── Task Submission Review ──────────────────────────────────────────


@router.get("/submissions/flagged")
async def list_flagged_submissions(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    current_admin: AdminUser = Depends(require_permission("tasks.review")),
    db: AsyncSession = Depends(get_db),
):
    """List task submissions flagged for manual review."""
    q = (
        select(TaskSubmission, Task, User)
        .join(Task, Task.id == TaskSubmission.task_id)
        .join(User, User.id == TaskSubmission.worker_id)
        .where(
            (TaskSubmission.flagged_for_review == True) |
            (TaskSubmission.status == "pending")
        )
        .order_by(TaskSubmission.created_at.desc())
    )

    total = (
        await db.execute(select(func.count()).select_from(q.subquery()))
    ).scalar_one()
    rows = await db.execute(q.limit(limit).offset((page - 1) * limit))

    items = []
    for submission, task, worker in rows.all():
        items.append({
            "submission_id": submission.id,
            "task_id": task.id,
            "task_title": task.title,
            "worker_id": worker.id,
            "worker_email": worker.email,
            "proof_type": submission.proof_type,
            "proof_url": submission.proof_url,
            "proof_image_url": submission.proof_image_url,
            "proof_text": submission.proof_text,
            "status": submission.status,
            "ai_confidence": submission.ai_confidence,
            "ai_verification_details": submission.ai_verification_details,
            "fraud_score": submission.fraud_score,
            "flagged_for_review": submission.flagged_for_review,
            "duplicate_screenshot_detected": submission.duplicate_screenshot_detected,
            "submitted_at": submission.submitted_at.isoformat(),
            "reward_amount": task.reward_amount,
        })

    return {"items": items, "total": int(total), "page": page, "limit": limit}


@router.post("/submissions/{submission_id}/approve")
async def admin_approve_submission(
    request: Request,
    submission_id: int,
    notes: str | None = Query(None),
    current_admin: AdminUser = Depends(require_permission("tasks.review")),
    db: AsyncSession = Depends(get_db),
):
    """Manually approve a task submission."""
    result = await db.execute(
        select(TaskSubmission, Task)
        .join(Task, Task.id == TaskSubmission.task_id)
        .where(TaskSubmission.id == submission_id)
    )
    row = result.one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")

    submission, task = row

    if submission.status == "approved":
        raise HTTPException(status_code=400, detail="Already approved")

    # Update submission
    submission.status = "approved"
    submission.reviewed_by = current_admin.id
    submission.reviewed_at = datetime.utcnow()

    # Credit worker
    worker_result = await db.execute(
        select(User).where(User.id == submission.worker_id)
    )
    worker = worker_result.scalar_one_or_none()

    if worker:
        net_reward = int(
            task.reward_amount * task.reward_multiplier * (100 - task.platform_fee_percent) / 100
        )
        worker.points_balance += net_reward
        submission.reward_paid = net_reward
        submission.payment_status = "paid"
        submission.paid_at = datetime.now(timezone.utc)

    # Update task stats
    task.approved_count += 1
    task.completed_count += 1

    if task.pending_count > 0:
        task.pending_count -= 1

    if task.completed_count >= task.max_completions:
        task.status = "completed"
        task.completed_at = datetime.utcnow()

    # Update reputation
    rep_result = await db.execute(
        select(UserReputation).where(
            UserReputation.user_id == submission.worker_id
        )
    )
    reputation = rep_result.scalar_one_or_none()

    if not reputation:
        reputation = UserReputation(user_id=submission.worker_id)
        db.add(reputation)

    reputation.tasks_approved += 1
    reputation.tasks_completed += 1
    reputation.total_earnings += submission.reward_paid

    if reputation.tasks_completed > 0:
        reputation.approval_rate = (
            reputation.tasks_approved / reputation.tasks_completed
        )

    # Log action
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "approve_submission",
            "task_submission",
            submission_id,
            {
                "task_id": task.id,
                "worker_id": submission.worker_id,
                "reward": submission.reward_paid,
                "notes": notes,
            },
            request.client.host,
        )
    )

    await db.commit()

    logger.info(f"Admin {current_admin.id} approved submission {submission_id}")
    return {
        "success": True,
        "message": "Submission approved",
        "reward_paid": submission.reward_paid,
    }


@router.post("/submissions/{submission_id}/reject")
async def admin_reject_submission(
    request: Request,
    submission_id: int,
    reason: str = Query(..., min_length=10, max_length=500),
    current_admin: AdminUser = Depends(require_permission("tasks.review")),
    db: AsyncSession = Depends(get_db),
):
    """Manually reject a task submission."""
    result = await db.execute(
        select(TaskSubmission, Task)
        .join(Task, Task.id == TaskSubmission.task_id)
        .where(TaskSubmission.id == submission_id)
    )
    row = result.one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")

    submission, task = row

    if submission.status in ["approved", "rejected"]:
        raise HTTPException(
            status_code=400, detail=f"Already {submission.status}"
        )

    # Update submission
    submission.status = "rejected"
    submission.rejection_reason = reason
    submission.reviewed_by = current_admin.id
    submission.reviewed_at = datetime.utcnow()

    # Update task stats
    task.rejected_count += 1

    if task.pending_count > 0:
        task.pending_count -= 1

    # Update reputation
    rep_result = await db.execute(
        select(UserReputation).where(
            UserReputation.user_id == submission.worker_id
        )
    )
    reputation = rep_result.scalar_one_or_none()

    if reputation:
        reputation.tasks_rejected += 1
        if reputation.tasks_completed > 0:
            reputation.approval_rate = (
                reputation.tasks_approved /
                (reputation.tasks_approved + reputation.tasks_rejected)
            )

    # Log action
    db.add(
        _log_admin_action(
            current_admin.id,
            current_admin.email,
            "reject_submission",
            "task_submission",
            submission_id,
            {
                "task_id": task.id,
                "worker_id": submission.worker_id,
                "reason": reason,
            },
            request.client.host,
        )
    )

    await db.commit()

    logger.info(f"Admin {current_admin.id} rejected submission {submission_id}")
    return {"success": True, "message": "Submission rejected", "reason": reason}


# ── Task Analytics ─────────────────────────────────────────────────


@router.get("/analytics")
async def tasks_analytics(
    days: int = Query(30, ge=1, le=90),
    current_admin: AdminUser = Depends(require_permission("analytics.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get Phase 7 tasks analytics."""
    cutoff = datetime.utcnow() - timedelta(days=days)

    # Task stats
    total_tasks = (await db.execute(
        select(func.count(Task.id))
    )).scalar_one()
    active_tasks = (await db.execute(
        select(func.count(Task.id)).where(Task.status == "active")
    )).scalar_one()
    completed_tasks = (await db.execute(
        select(func.count(Task.id)).where(Task.status == "completed")
    )).scalar_one()

    # Submission stats
    total_submissions = (await db.execute(
        select(func.count(TaskSubmission.id)).where(
            TaskSubmission.created_at >= cutoff
        )
    )).scalar_one()

    approved_submissions = (await db.execute(
        select(func.count(TaskSubmission.id)).where(
            TaskSubmission.status == "approved",
            TaskSubmission.created_at >= cutoff,
        )
    )).scalar_one()

    pending_submissions = (await db.execute(
        select(func.count(TaskSubmission.id)).where(
            TaskSubmission.status == "pending"
        )
    )).scalar_one()

    # Revenue stats
    platform_revenue = (await db.execute(
        select(func.sum(Task.platform_fee_amount)).where(
            Task.status == "completed"
        )
    )).scalar_one() or 0

    total_paid_out = (await db.execute(
        select(func.sum(TaskSubmission.reward_paid)).where(
            TaskSubmission.payment_status == "paid"
        )
    )).scalar_one() or 0

    # User stats
    total_workers = (await db.execute(
        select(func.count(User.id)).where(User.is_worker == True)
    )).scalar_one()

    total_sponsors = (await db.execute(
        select(func.count(User.id)).where(User.is_sponsor == True)
    )).scalar_one()

    verified_sponsors = (await db.execute(
        select(func.count(User.id)).where(User.sponsor_verified == True)
    )).scalar_one()

    pending_kyc = (await db.execute(
        select(func.count(SponsorKYC.sponsor_id)).where(
            SponsorKYC.status == "pending"
        )
    )).scalar_one()

    return {
        "period_days": days,
        "tasks": {
            "total": int(total_tasks),
            "active": int(active_tasks),
            "completed": int(completed_tasks),
        },
        "submissions": {
            "total": int(total_submissions),
            "approved": int(approved_submissions),
            "pending": int(pending_submissions),
            "approval_rate": (
                round(approved_submissions / total_submissions * 100, 2)
                if total_submissions > 0 else 0
            ),
        },
        "revenue": {
            "platform_fee_collected": int(platform_revenue),
            "total_paid_to_workers": int(total_paid_out),
            "net_margin": int(platform_revenue) - int(total_paid_out),
        },
        "users": {
            "total_workers": int(total_workers),
            "total_sponsors": int(total_sponsors),
            "verified_sponsors": int(verified_sponsors),
            "pending_kyc": int(pending_kyc),
        },
    }
