"""Rolling 24-hour caps for money-moving endpoints.

Backs the M1+M2 audit fixes. The cap is enforced in `wallet.deposit`
and `payouts.withdraw` BEFORE calling Paystack, so a stolen-card
deposit or a verified-account withdrawal can't move more than the
daily limit through the system.

Process-local. The cap counter lives in a dict keyed by (kind, user_id).
For a single Render instance this is fine; if we scale to multiple
workers, swap the dict for Redis (INCR + EXPIRE).

Timestamps older than 24h are pruned lazily on every call, so the
dict size is bounded by `active_users × calls_per_day` worth of entries.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Deque, Dict, Tuple


# (kind, user_id) → deque of (timestamp, kobo_amount)
_AMOUNT_BUCKET: Dict[Tuple[str, int], Deque[Tuple[float, int]]] = defaultdict(deque)
_LOCK = Lock()

_WINDOW_SECONDS = 24 * 60 * 60  # 24h


def record_amount_v2(
    user_id: int,
    kind: str,
    amount_kobo: int,
    max_per_tx: int,
    max_per_day: int,
) -> tuple[bool, int]:
    """Check per-tx + 24h-rolling caps and record on success.

    `kind` is `"deposit"` or `"withdrawal"`.

    Returns `(allowed, current_24h_total_in_kobo)`:
      - `(False, 0)`: per-tx cap exceeded
      - `(False, N)`: 24h cap exceeded (N is current 24h total)
      - `(True, N+amount)`: recorded

    On success, the amount is recorded against the rolling window.
    On failure (over either cap), the amount is NOT recorded — so a
    series of denied attempts don't themselves consume the budget.
    """
    if amount_kobo > max_per_tx:
        return False, 0

    key = (kind, user_id)
    now = time.monotonic()
    cutoff = now - _WINDOW_SECONDS

    with _LOCK:
        bucket = _AMOUNT_BUCKET[key]
        # Prune entries older than the window
        while bucket and bucket[0][0] < cutoff:
            bucket.popleft()
        current = sum(amt for _, amt in bucket)
        if current + amount_kobo > max_per_day:
            return False, current
        bucket.append((now, amount_kobo))
        return True, current + amount_kobo
