"""Single source of truth for the points ↔ naira conversion.

Every place in the backend that credits or debits a user's
`points_balance` goes through one of these helpers. The conversion
rate itself is owned by `settings.points_per_naira` (env var
`POINTS_PER_NAIRA`) so that revaluing the in-app currency is a
one-line change in `.env` instead of a sweep through every credit
site.

Convention (units):
  - kobo     = smallest NGN unit (100 kobo = ₦1)
  - naira    = NGN whole unit (1 naira = 100 kobo)
  - points   = in-app wallet unit (POINTS_PER_NAIRA points = ₦1)

Default rate: 10 points per ₦1 (1 point = ₦0.10). To revalue,
override POINTS_PER_NAIRA in `backend/.env`.

The mobile client reads EXPO_PUBLIC_POINTS_PER_NAIRA at build time
with the same value, so both sides always agree.
"""

from app.config import settings


def kobo_to_naira(kobo: int) -> float:
    """Convert kobo (smallest NGN unit) to whole naira.

    Example: kobo_to_naira(10000) == 100.0  (₦100.00)
    """
    return kobo / 100


def kobo_to_points(kobo: int) -> int:
    """Convert kobo to wallet points using the configured rate.

    This is the credit side: when a worker is owed ₦100 (10000 kobo)
    and POINTS_PER_NAIRA=10, the worker gets 1000 points.
    Example: kobo_to_points(10000) == 1000
    """
    return int(round((kobo / 100) * settings.points_per_naira))


def naira_to_points(naira: float) -> int:
    """Convert whole naira to wallet points.

    Example: naira_to_points(100) == 1000   (when POINTS_PER_NAIRA=10)
    """
    return int(round(naira * settings.points_per_naira))


def deposit_points_for_user(kobo: int, user) -> int:
    """Points a *deposit* should credit, honouring the premium discount.

    A deposit is the one direction of flow where tier matters: it is the
    user buying SV, and Premium gets a discount off the rate. Every other
    conversion in this module is a payout or price, where charging a
    premium user less would be a hole.

    The discount is applied as extra points for the same naira, which
    keeps points-per-naira as the single rate rather than introducing a
    second one. At POINTS_PER_NAIRA=10 and a 30% discount, N1,000 buys
    14,285 points instead of 10,000 — i.e. ₦0.07 a point.

    Returns the undiscounted figure for non-premium users, so the free
    path is byte-for-byte what it was.
    """
    from app.services.subscription import is_premium

    base = kobo_to_points(kobo)
    if base <= 0 or not is_premium(user):
        return base

    discount = float(settings.premium_top_up_discount_percent or 0)
    if discount <= 0:
        return base
    if discount >= 1:  # defensive; a 100% discount is a misconfiguration
        return base
    return int(round(base / (1 - discount)))


def points_to_naira(points: int) -> float:
    """Convert wallet points back to whole naira.

    Used for display-only paths (worker UI already reads the same
    conversion via EXPO_PUBLIC_POINTS_PER_NAIRA).
    Example: points_to_naira(1000) == 100.0  (when POINTS_PER_NAIRA=10)
    """
    return points / settings.points_per_naira


def points_to_kobo(points: int) -> int:
    """Convert wallet points back to kobo.

    Inverse of `kobo_to_points`. Used by payouts/withdrawals when
    the user picks "cash out X points".
    Example: points_to_kobo(1000) == 10000   (when POINTS_PER_NAIRA=10)
    """
    return int(round((points / settings.points_per_naira) * 100))
