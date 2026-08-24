"""Webhook endpoints for external service callbacks.

Handles delivery verification from BIGISUB and other VTU providers.
All webhooks require signature verification for security.
"""

import hashlib
import hmac
import logging
from datetime import datetime
from typing import Dict, Any

from fastapi import APIRouter, Request, HTTPException, Depends
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import BillTransaction, User
from app.schemas import BaseResponse

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

logger = logging.getLogger("uvicorn.error")


def _verify_bigisub_signature(payload: bytes, signature: str) -> bool:
    """Verify BIGISUB webhook signature using HMAC-SHA256.
    
    Args:
        payload: Raw request body bytes
        signature: X-Signature header value from BIGISUB
        
    Returns:
        True if signature is valid, False otherwise
    """
    if not settings.bigisub_api_key:
        logger.warning("BIGISUB_API_KEY not set, webhook signature verification disabled")
        return True  # Allow in development
    
    # BIGISUB sends signature as "sha256=<hash>"
    if not signature.startswith("sha256="):
        return False
    
    received_hash = signature[7:]  # Remove "sha256=" prefix
    
    # Compute expected signature
    expected_signature = hmac.new(
        settings.bigisub_api_key.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    
    # Constant-time comparison to prevent timing attacks
    return hmac.compare_digest(expected_signature, received_hash)


@router.post("/bigisub/verify", response_model=BaseResponse)
async def bigisub_delivery_verification(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Receive delivery verification from BIGISUB.
    
    BIGISUB calls this webhook to confirm transaction status updates.
    
    Based on BIGISUB API v2.0.0 documentation, status values are:
    - Standard Services: "successful", "processing", "failed"
    - Marketing Hub: "pending", "processing", "in_progress", "completed", 
                     "partial", "failed", "cancelled", "refunded"
    
    Expected payload format (based on BIGISUB API patterns):
    {
        "transaction_id": "167630",
        "reference": "our_transaction_reference", 
        "status": "successful" | "processing" | "failed",
        "network": "MTN",
        "amount": "100.0",
        "mobile_number": "08012345678",
        "create_date": "2021-08-28T21:02:54.311846",
        "message": "Transaction completed successfully"
    }
    
    Security: Verifies HMAC-SHA256 signature in X-Signature header.
    """
    # Get raw body and signature
    body = await request.body()
    signature = request.headers.get("X-Signature", "")
    
    # Verify signature
    if not _verify_bigisub_signature(body, signature):
        logger.warning("Invalid BIGISUB webhook signature from IP %s", 
                      request.client.host if request.client else "unknown")
        raise HTTPException(status_code=401, detail="Invalid signature")
    
    # Parse JSON payload
    try:
        import json
        payload = json.loads(body.decode())
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        logger.error("Invalid JSON in BIGISUB webhook: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    
    # Validate required fields
    required_fields = ["transaction_id", "status"]
    for field in required_fields:
        if field not in payload:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    transaction_id = payload["transaction_id"]
    status = payload["status"]  # "successful" | "processing" | "failed" 
    message = payload.get("message", "")
    reference = payload.get("reference")  # Could be our transaction reference
    external_reference = payload.get("external_reference")  # Alternative field
    network = payload.get("network")
    amount = payload.get("amount")
    mobile_number = payload.get("mobile_number")
    create_date_str = payload.get("create_date")
    
    logger.info("BIGISUB webhook: tx_id=%s, status=%s, ref=%s, ext_ref=%s, message=%s", 
               transaction_id, status, reference, external_reference, message)
    
    # Find matching transaction - try our reference first, then external_ref, then transaction_id
    transaction = None
    
    # Try our transaction reference first
    if reference:
        result = await db.execute(
            select(BillTransaction)
            .where(BillTransaction.reference == reference)
        )
        transaction = result.scalar_one_or_none()
    
    # Try external_reference field
    if not transaction and external_reference:
        result = await db.execute(
            select(BillTransaction)
            .where(BillTransaction.reference == external_reference)
        )
        transaction = result.scalar_one_or_none()
    
    # Finally try matching by external_ref (BIGISUB transaction_id)
    if not transaction:
        result = await db.execute(
            select(BillTransaction)
            .where(BillTransaction.external_ref == transaction_id)
        )
        transaction = result.scalar_one_or_none()
    
    if not transaction:
        logger.warning("BIGISUB webhook: transaction not found for tx_id=%s, ref=%s, ext_ref=%s", 
                      transaction_id, reference, external_reference)
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    # Parse create_date timestamp
    delivered_at = None
    if create_date_str:
        try:
            from datetime import datetime
            # BIGISUB format: "2021-08-28T21:02:54.311846"
            delivered_at = datetime.fromisoformat(create_date_str.replace("Z", ""))
        except ValueError:
            logger.warning("Invalid create_date timestamp: %s", create_date_str)
    
    # Update transaction status based on BIGISUB webhook status
    if status == "successful":
        # Transaction completed successfully - mark as delivered
        await db.execute(
            update(BillTransaction)
            .where(BillTransaction.id == transaction.id)
            .values(
                delivery_status="delivered",
                delivery_verified_at=delivered_at or datetime.utcnow(),
                delivery_message=message or "Transaction completed successfully",
                status="success",  # Ensure main status is success
                updated_at=datetime.utcnow(),
            )
        )
        
        # Send success notification to user
        import asyncio
        from app.services.notifications import create_notification_background
        from app.services.fcm import send_push_notification_background
        
        asyncio.create_task(create_notification_background(
            user_id=transaction.user_id,
            title=f"{transaction.service.title()} Delivered",
            body=f"Your {transaction.service} purchase for {transaction.phone} has been successfully delivered.",
            category="wallet_updates",
            data={
                "type": "delivery_confirmed",
                "reference": transaction.reference,
                "service": transaction.service,
                "phone": transaction.phone,
            },
        ))
        asyncio.create_task(send_push_notification_background(
            user_id=transaction.user_id,
            title=f"{transaction.service.title()} Delivered",
            body=f"Your {transaction.service} purchase has been delivered successfully.",
            data={
                "type": "delivery_confirmed",
                "reference": transaction.reference,
            },
            category="wallet_updates",
        ))
        
        logger.info("Transaction %s confirmed as successful via BIGISUB webhook", transaction.reference)
        
    elif status == "failed":
        # Transaction failed - initiate refund
        await db.execute(
            update(BillTransaction)
            .where(BillTransaction.id == transaction.id)
            .values(
                delivery_status="failed",
                delivery_message=message or "Transaction failed",
                status="failed",  # Mark whole transaction as failed
                updated_at=datetime.utcnow(),
            )
        )
        
        # Refund user's points
        from app.services.money import kobo_to_points
        
        refund_points = kobo_to_points(transaction.amount_naira * 100)
        await db.execute(
            update(User)
            .where(User.id == transaction.user_id)
            .values(points_balance=User.points_balance + refund_points)
        )
        
        # Send refund notification
        import asyncio
        from app.services.notifications import create_notification_background
        from app.services.fcm import send_push_notification_background
        
        asyncio.create_task(create_notification_background(
            user_id=transaction.user_id,
            title=f"{transaction.service.title()} Purchase Failed",
            body=f"Your {transaction.service} purchase failed to deliver. {refund_points} points have been refunded to your wallet.",
            category="wallet_updates",
            data={
                "type": "delivery_failed_refund",
                "reference": transaction.reference,
                "service": transaction.service,
                "refund_points": refund_points,
            },
        ))
        asyncio.create_task(send_push_notification_background(
            user_id=transaction.user_id,
            title=f"{transaction.service.title()} Refunded",
            body=f"Purchase failed. {refund_points} points refunded to your wallet.",
            data={
                "type": "delivery_failed_refund",
                "reference": transaction.reference,
                "refund_points": refund_points,
            },
            category="wallet_updates",
        ))
        
        logger.info("Transaction %s delivery failed, refunded %d points via BIGISUB webhook", 
                   transaction.reference, refund_points)
    
    elif status in ["processing", "pending", "submitted"]:
        # Transaction still processing - update status but don't refund
        await db.execute(
            update(BillTransaction)
            .where(BillTransaction.id == transaction.id)
            .values(
                delivery_status="pending",
                delivery_message=message or "Transaction is being processed",
                updated_at=datetime.utcnow(),
            )
        )
        
        logger.info("Transaction %s still processing via BIGISUB webhook", transaction.reference)
    
    else:
        # Unknown status - log but don't fail the webhook
        logger.warning("Unknown status from BIGISUB webhook: %s (tx: %s)", status, transaction.reference)
        
        # Update with unknown status but don't change main transaction status
        await db.execute(
            update(BillTransaction)
            .where(BillTransaction.id == transaction.id)
            .values(
                delivery_message=f"Unknown status: {status} - {message}",
                updated_at=datetime.utcnow(),
            )
        )
    
    await db.commit()
    
    return BaseResponse(
        success=True,
        message="Delivery verification processed successfully"
    )


@router.get("/bigisub/test", response_model=BaseResponse)
async def test_bigisub_webhook():
    """Test endpoint to verify webhook routing is working.
    
    Returns a simple success response. Used by BIGISUB to verify
    that our webhook URL is reachable before sending real callbacks.
    """
    return BaseResponse(
        success=True,
        message="BIGISUB webhook endpoint is reachable"
    )