import secrets
from datetime import datetime, timedelta
from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import User, RevokedJWT
from app.config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def hash_password(password: str) -> str:
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: int, jti: str | None = None) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "exp": expire,
        "type": "access",
        "jti": jti or secrets.token_hex(16),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_refresh_token() -> str:
    return secrets.token_urlsafe(64)


async def revoke_jwt(db: AsyncSession, jti: str, user_id: int, reason: str | None = None) -> None:
    """Revoke a JWT by its jti."""
    # Get token expiration from the JWT payload to know when to keep the revocation record
    # For simplicity, we'll keep revoked records for 24 hours
    expires_at = datetime.utcnow() + timedelta(hours=24)
    revoked = RevokedJWT(jti=jti, user_id=user_id, reason=reason, expires_at=expires_at)
    db.add(revoked)
    await db.commit()


async def is_jwt_revoked(db: AsyncSession, jti: str) -> bool:
    """Check if a JWT has been revoked."""
    result = await db.execute(
        select(RevokedJWT).where(RevokedJWT.jti == jti, RevokedJWT.expires_at > datetime.utcnow())
    )
    return result.scalar_one_or_none() is not None


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        user_id = payload.get("sub")
        jti = payload.get("jti")
        if user_id is None or jti is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Check if token is revoked
    if await is_jwt_revoked(db, jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception

    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active",
        )

    return user


def decode_token(token: str) -> dict:
    """Decode a JWT token without verifying user existence.

    Used by the rate limiter to extract the user ID for per-user
    rate limiting. Does NOT check if the user is active or revoked.
    """
    payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    return payload
