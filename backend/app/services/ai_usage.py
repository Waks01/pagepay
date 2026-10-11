"""Per-user daily quota for AI chat.

`/study/chat` calls a paid model (Cloudflare Workers AI, no free
tier). Without a per-user cap the endpoint is an open meter: any
signed-in user could drain the Cloudflare account with a script.

Mirrors the rolling-window pattern from `money_caps.py`: a
process-local dict keyed by user_id. Fine for a single Render
instance; when we scale to multiple workers, move the counter to
Redis (INCR + EXPIRE) so the quota stays global.

Admission records a timestamp; failed model calls are refunded with
`release()` so a provider outage doesn't eat the user's quota.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Deque, Dict

_WINDOW_SECONDS = 24 * 60 * 60

# user_id → deque of call timestamps within the window
_CALLS: Dict[int, Deque[float]] = defaultdict(deque)
_LOCK = Lock()


def check_and_record(user_id: int, daily_limit: int) -> tuple[bool, int]:
    """Try to admit one chat call for `user_id`.

    Returns `(allowed, remaining)` where `remaining` is the calls
    left in the current 24h window. On success the call is recorded;
    on rejection nothing is recorded (denied attempts don't consume
    the budget).
    """
    now = time.time()
    with _LOCK:
        bucket = _CALLS[user_id]
        while bucket and now - bucket[0] > _WINDOW_SECONDS:
            bucket.popleft()
        if len(bucket) >= daily_limit:
            return (False, 0)
        bucket.append(now)
        return (True, daily_limit - len(bucket))


def release(user_id: int) -> None:
    """Refund the most recent call for `user_id` (model failed).

    Only pops a timestamp still inside the window, so a late refund
    can't delete an unrelated newer call.
    """
    now = time.time()
    with _LOCK:
        bucket = _CALLS.get(user_id)
        if bucket and now - bucket[-1] <= _WINDOW_SECONDS:
            bucket.pop()


def reset_user(user_id: int) -> None:
    """Drop all recorded calls for one user (used by tests)."""
    with _LOCK:
        _CALLS.pop(user_id, None)


def reset_all() -> None:
    """Drop every counter (used by tests)."""
    with _LOCK:
        _CALLS.clear()
