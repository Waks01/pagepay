import logging
from app.config import settings

logger = logging.getLogger("uvicorn.error")

# SMS provider configuration
# Set one of: termii, twilio, or none
SMS_PROVIDER = "none"


async def send_verification_sms(to: str, code: str) -> bool:
    """Send phone verification OTP via SMS."""
    logger.info("[SMS placeholder] verification code for %s: %s", to, code)
    return True


async def send_password_reset_sms(to: str, code: str) -> bool:
    """Send password reset OTP via SMS."""
    logger.info("[SMS placeholder] password reset code for %s: %s", to, code)
    return True


async def send_login_otp_sms(to: str, code: str) -> bool:
    """Send login OTP via SMS."""
    logger.info("[SMS placeholder] login OTP for %s: %s", to, code)
    return True
