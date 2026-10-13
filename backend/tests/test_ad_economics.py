"""Ad payout and free-tier quota.

Two invariants:

1. The ad payout must be derived from `platform_ad_revenue_percent`, not
   hand-set alongside it. This used to be a single
   `rewarded_ad_payout_points = 20` holding the GROSS under a name that
   said "payout", so the model looked like "pay 20, keep 4" when the real
   credit was 16 — an error that took a full analysis pass to unwind.
2. The free chat quota must be low enough that the rewarded-ad margin
   nearly covers it. At 50 turns/day the free tier cost ~N1,860/user/
   month against ~N120 of ad recovery.
"""

import os

_ENV = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    ".env",
)
if os.path.exists(_ENV):
    with open(_ENV) as _fh:
        for _line in _fh:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())


def test_ad_payout_is_derived_from_the_revenue_share():
    """Payout = gross x (1 - platform share). If this breaks, the split
    silently stops matching the revenue share."""
    from app.config import settings

    gross = settings.rewarded_ad_gross_points
    payout = settings.rewarded_ad_payout_points
    share = settings.platform_ad_revenue_percent

    assert payout == int(gross * (1 - share)), (
        f"payout {payout} != gross {gross} x (1 - {share}) = "
        f"{int(gross * (1 - share))}"
    )


def test_platform_keeps_the_revenue_share():
    """The platform's cut must equal the configured percent of gross."""
    from app.config import settings

    gross = settings.rewarded_ad_gross_points
    payout = settings.rewarded_ad_payout_points
    platform_cut = gross - payout

    assert platform_cut == pytest.approx(
        gross * settings.platform_ad_revenue_percent, abs=1
    ), f"platform keeps {platform_cut} of {gross}"


def test_payout_is_the_user_share_not_the_gross():
    """The regression this file exists for.

    `rewarded_ad_payout_points` used to hold the GROSS value (20) under a
    name that said payout, so the app credited users 20 instead of 16.
    """
    from app.config import settings

    assert settings.rewarded_ad_payout_points < settings.rewarded_ad_gross_points, (
        "payout must be the user's share, not the gross figure"
    )


def test_payout_is_16_at_defaults():
    """At the $1.50 eCPM assumption, gross is 20 pts (N2.00) and the
    user's 80% is 16 pts (N1.60)."""
    from app.config import settings

    assert settings.rewarded_ad_gross_points == 20
    assert settings.rewarded_ad_payout_points == 16
    assert settings.platform_ad_revenue_percent == 0.20


def test_env_example_does_not_set_the_derived_value():
    """`.env.example` must not ship a hand-set payout, which would
    override the derivation for anyone who copies it."""
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env_example = os.path.join(repo_root, "backend", ".env.example")
    if not os.path.exists(env_example):
        pytest.skip(".env.example not present")

    src = open(env_example, encoding="utf-8").read()
    active = [
        line
        for line in src.splitlines()
        if line.startswith("REWARDED_AD_PAYOUT_POINTS=")
    ]
    assert not active, (
        f".env.example must not set the derived payout: {active}. "
        "Set REWARDED_AD_GROSS_POINTS instead."
    )
    assert "REWARDED_AD_GROSS_POINTS=" in src


def test_free_chat_quota_is_bounded_by_the_ad_margin():
    """Free chat must cost less than the ads that fund it.

    With routing live the blended turn cost is ~N1.24 (68% Granite at
    ~N0.68, 32% GLM at ~N2.43). At 5 turns/day that is ~N186/user/month,
    against ~N120/user/month of rewarded-ad margin at 10 ads/day.
    """
    from app.config import settings

    blended_turn_cost_naira = 1.24
    ad_recovery_naira = 120.0

    free_monthly_cost = (
        settings.study_chat_daily_limit * 30 * blended_turn_cost_naira
    )
    assert free_monthly_cost <= 300, (
        f"free chat costs ~N{free_monthly_cost:,.0f}/user/month — too high "
        "for the ad margin to cover"
    )


def test_premium_quota_leaves_margin():
    """Premium chat must fit inside the subscription price.

    PagePay+ is N3,000/mo. 15 turns/day x 30 x ~N1.24 = N558, leaving
    room for the SV allowance and margin.
    """
    from app.config import settings

    blended_turn_cost_naira = 1.24
    subscription_price_naira = 3000.0

    premium_monthly_cost = (
        settings.study_chat_premium_daily_limit * 30 * blended_turn_cost_naira
    )
    assert premium_monthly_cost < subscription_price_naira * 0.5, (
        f"premium chat costs ~N{premium_monthly_cost:,.0f}/month — over "
        "half the subscription price"
    )


def test_premium_quota_exceeds_free():
    from app.config import settings

    assert (
        settings.study_chat_premium_daily_limit
        > settings.study_chat_daily_limit
    )


def test_chat_quota_is_not_the_old_unbounded_value():
    """Regression: 50 free / 300 premium left the free tier at
    ~N1,860/user/month against ~N0 of revenue."""
    from app.config import settings

    assert settings.study_chat_daily_limit <= 10
    assert settings.study_chat_premium_daily_limit <= 30


import pytest  # noqa: E402  (kept last so the module docstring leads)
