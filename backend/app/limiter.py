from typing import Optional

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.services.auth import decode_token


def _get_user_id_or_ip(request: Request) -> str:
    """Rate-limit key: user ID if authenticated, else IP address.

    This prevents IP-based rate limits from penalizing shared NATs while
    still throttling unauthenticated abuse by source address.
    """
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            payload = decode_token(token)
            user_id = payload.get("sub")
            if user_id:
                return f"user:{user_id}"
        except Exception:
            pass
    return get_remote_address(request)


limiter = Limiter(key_func=_get_user_id_or_ip)
