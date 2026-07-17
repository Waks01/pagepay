"""
Transaction PIN endpoints.
PIN is used as:
  - Fallback authentication when biometric fails
  - Authorization for sensitive actions like withdrawals

PIN is stored as a bcrypt hash in `users.transaction_pin_hash`.
A 4–6 digit PIN is enforced client-side; the backend only sees the
already-hashed value, so it cannot enumerate or reverse user PINs.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models import User
from app.routers.auth import get_current_user
from app.services.auth import hash_password, verify_password

router = APIRouter(prefix="/pin", tags=["pin"])
logger = logging.getLogger("uvicorn.error")


class PinSetupRequest(BaseModel):
    """Set transaction PIN for the first time.

    Requires the current account password so that an attacker who
    stole the device still cannot set a new PIN without knowing the
    user's password.
    """
    password: str = Field(min_length=8)
    pin: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")


class PinVerifyRequest(BaseModel):
    """Verify transaction PIN.

    Returns a short-lived success response. The client uses this
    after biometric auth fails, or before authorizing a withdrawal.
    """
    pin: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")


class PinChangeRequest(BaseModel):
    """Change transaction PIN."""
    current_pin: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")
    new_pin: str = Field(min_length=4, max_length=6, pattern=r"^\d+$")


class PinStatusResponse(BaseModel):
    has_pin: bool


@router.get("/status", response_model=PinStatusResponse)
async def pin_status(
    current_user: User = Depends(get_current_user),
):
    """Return whether the current user has a transaction PIN set."""
    return PinStatusResponse(has_pin=current_user.transaction_pin_hash is not None)


@router.post("/setup", status_code=status.HTTP_201_CREATED)
async def setup_pin(
    body: PinSetupRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set a transaction PIN for the first time.

    Requires the account password. Returns 409 if a PIN is already set.
    """
    if current_user.transaction_pin_hash is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="PIN already set. Use /pin/change to update it.",
        )

    if not verify_password(body.password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password.",
        )

    current_user.transaction_pin_hash = hash_password(body.pin)
    await db.commit()
    logger.info("User %s set transaction PIN.", current_user.id)
    return {"ok": True}


@router.post("/verify")
async def verify_pin(
    body: PinVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verify the transaction PIN.

    Returns 200 with `{"valid": true}` on success.
    Used as fallback auth when biometric fails, and before withdrawals.
    """
    if current_user.transaction_pin_hash is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No PIN set. Set one in Profile > Security.",
        )

    if not verify_password(body.pin, current_user.transaction_pin_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect PIN.",
        )

    logger.info("User %s verified transaction PIN.", current_user.id)
    return {"valid": True}


@router.post("/change")
async def change_pin(
    body: PinChangeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Change transaction PIN.

    Requires the current PIN. Returns 404 if no PIN is set.
    """
    if current_user.transaction_pin_hash is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No PIN set. Set one in Profile > Security.",
        )

    if not verify_password(body.current_pin, current_user.transaction_pin_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect current PIN.",
        )

    current_user.transaction_pin_hash = hash_password(body.new_pin)
    await db.commit()
    logger.info("User %s changed transaction PIN.", current_user.id)
    return {"ok": True}
