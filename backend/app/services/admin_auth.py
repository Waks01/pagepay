from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, status, Cookie, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import AdminUser
from app.config import settings


def hash_password(password: str) -> str:
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_admin_token(admin_id: int, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(admin_id), "role": role, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


async def get_current_admin(
    request: Request,
    admin_session: str | None = Cookie(None),
    db: AsyncSession = Depends(get_db),
) -> AdminUser:
    """Extract admin from httpOnly cookie instead of Authorization header."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate admin credentials",
    )
    
    # Get token from cookie
    token = admin_session
    if not token:
        raise credentials_exception
    
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        admin_id = payload.get("sub")
        role = payload.get("role")
        if admin_id is None or role is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(select(AdminUser).where(AdminUser.id == int(admin_id)))
    admin = result.scalar_one_or_none()
    if admin is None or not admin.is_active:
        raise credentials_exception
    return admin


def require_permission(permission: str):
    async def checker(current_admin: AdminUser = Depends(get_current_admin)) -> AdminUser:
        if current_admin.role == "super_admin":
            return current_admin
        perms = []
        if current_admin.permissions:
            import json
            try:
                perms = json.loads(current_admin.permissions)
            except (json.JSONDecodeError, TypeError):
                perms = []
        if "*" in perms or permission in perms:
            return current_admin
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return checker
