import logging
import resend
from app.config import settings

logger = logging.getLogger("uvicorn.error")

# Initialize Resend client
resend.api_key = settings.resend_api_key


async def send_email(to: str, subject: str, html: str) -> bool:
    """Send an email using Resend.

    Returns True if sent successfully, False otherwise.
    """
    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY not configured; email not sent")
        return False

    try:
        result = resend.Emails.send(
            params={
                "from": settings.email_from,
                "to": to,
                "subject": subject,
                "html": html,
            }
        )
        logger.info("Email sent to %s: %s", to, result.get("id", "unknown"))
        return True
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to, exc)
        return False


async def send_verification_email(to: str, token: str, code: str) -> bool:
    """Send email verification with code and fallback link."""
    verify_url = f"{settings.public_base_url}/verify-email?email={to}&token={token}"
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4F46E5;">Verify your email address</h2>
        <p>Thanks for signing up for PagePay! Enter this 6-digit code in the app to verify your email:</p>
        <div style="background-color: #F3F4F6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #4F46E5;">{code}</span>
        </div>
        <p style="color: #666; font-size: 14px;">This code will expire in 24 hours.</p>
        <p style="color: #666; font-size: 14px;">If you didn't create an account, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
        <p style="color: #9CA3AF; font-size: 12px;">Or click the link below:</p>
        <a href="{verify_url}" style="color: #4F46E5; font-size: 14px;">{verify_url}</a>
    </body>
    </html>
    """
    return await send_email(to, "Verify your PagePay account", html)


async def send_password_reset_otp_email(to: str, otp: str) -> bool:
    """Send password reset OTP code via email."""
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4F46E5;">Reset your password</h2>
        <p>You requested to reset your password. Enter this 6-digit code in the app:</p>
        <div style="background-color: #F3F4F6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #4F46E5;">{otp}</span>
        </div>
        <p style="color: #666; font-size: 14px;">This code will expire in 15 minutes.</p>
        <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email.</p>
    </body>
    </html>
    """
    return await send_email(to, "Reset your PagePay password", html)


async def send_password_reset_email(to: str, token: str) -> bool:
    """Send password reset link."""
    reset_url = f"{settings.public_base_url}/reset-password?token={token}"
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #4F46E5;">Reset your password</h2>
        <p>You requested to reset your password. Click the button below to proceed:</p>
        <a href="{reset_url}" style="display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0;">Reset Password</a>
        <p style="color: #666; font-size: 14px;">This link will expire in 15 minutes.</p>
        <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email.</p>
    </body>
    </html>
    """
    return await send_email(to, "Reset your PagePay password", html)


async def send_welcome_email(
    to: str,
    name: str = "there",
    bonus_points: int = 0,
    bonus_naira: float = 0.0,
) -> bool:
    """Send welcome email after registration.

    Includes the welcome bonus amount prominently so the user knows what
    they just earned. Pass `bonus_points=0` to suppress the bonus block
    (e.g. for a re-launch promo) — the rest of the email still fires.

    `bonus_naira` is the points-to-currency equivalent at the configured
    POINTS_PER_NAIRA rate, kept in lockstep with the in-app conversion.
    """
    bonus_block = ""
    if bonus_points > 0:
        naira_str = f"{bonus_naira:,.2f}"
        bonus_block = f"""
        <div style="background: linear-gradient(135deg, #0E7C66 0%, #34C39B 100%); border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <p style="color: #E6F1ED; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 8px 0;">Welcome Bonus</p>
            <p style="color: #FFFFFF; font-size: 40px; font-weight: bold; margin: 0; line-height: 1.1;">+{bonus_points:,}</p>
            <p style="color: #E6F1ED; font-size: 15px; margin: 8px 0 0 0;">points (₦{naira_str})</p>
            <p style="color: #E6F1ED; font-size: 13px; margin: 12px 0 0 0;">credited to your wallet</p>
        </div>
        """

    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #FBFAF6;">
        <div style="background-color: #FFFFFF; border-radius: 16px; padding: 32px; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
            <h2 style="color: #0E1116; margin-top: 0;">Welcome to PagePay, {name}!</h2>
            <p style="color: #6B7280; font-size: 15px; line-height: 22px;">Thanks for joining PagePay. We're excited to have you.</p>
            {bonus_block}
            <p style="color: #6B7280; font-size: 15px; line-height: 22px;">Here's what you can do with PagePay:</p>
            <ul style="color: #6B7280; font-size: 15px; line-height: 24px;">
                <li>Read for 1 minute → earn points</li>
                <li>Watch rewarded ads → multiply your earnings</li>
                <li>Redeem points as cash via mobile money or bank transfer</li>
                <li>Unlock AI study tools (flashcards, quizzes, essays)</li>
            </ul>
            <p style="color: #6B7280; font-size: 14px;">Verify your email to start earning. If you have any questions, reach out to our support team.</p>
        </div>
        <p style="color: #9CA3AF; font-size: 12px; text-align: center; margin-top: 16px;">© PagePay — Read. Learn. Earn.</p>
    </body>
    </html>
    """
    return await send_email(to, "Welcome to PagePay — your bonus is inside!", html)
