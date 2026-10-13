"""Verify estimated commission never becomes withdrawable cash, and that
the per-service rate limits are actually enforced."""
import re

import pytest

BILLS = r"C:\Users\kenik\OneDrive\Pictures\pagepay\backend\app\routers\bills.py"


def test_resolve_commission_flags_estimates():
    """`is_estimated` must distinguish provider margin from the fallback.

    This is the whole safety property: a caller cannot route fabricated
    commission to a withdrawable balance if it can tell the difference.
    """
    from app.routers.bills import _resolve_commission_kobo

    # Provider discount wins and is reported as real.
    kobo, estimated = _resolve_commission_kobo(100_000, "betting", discount="2.5")
    assert kobo == 250
    assert estimated is False

    # charged-vs-price gap is also real.
    kobo, estimated = _resolve_commission_kobo(
        100_000, "electricity", charged=900.0, price_naira=1000.0
    )
    assert kobo > 0
    assert estimated is False

    # Nothing available -> the 1.8% fallback, flagged as estimated.
    kobo, estimated = _resolve_commission_kobo(100_000, "betting")
    assert kobo == int(100_000 * 0.018)
    assert estimated is True


def test_legacy_helper_still_returns_kobo():
    """`_effective_commission_kobo` keeps its original contract."""
    from app.routers.bills import _effective_commission_kobo

    assert _effective_commission_kobo(100_000, "airtime", discount="2.5") == 250
    assert _effective_commission_kobo(100_000, "betting") == int(100_000 * 0.018)


def test_every_commission_path_reports_estimation():
    """All commission call sites must use the estimating vari.

    A site still calling `_effective_commission_kobo` cannot know whether
    its commission is real, so it cannot protect the cashable balance.
    """
    src = open(BILLS, encoding="utf-8").read()

    # The five services that used to omit the discount entirely.
    for service in ("betting", "isp_smile", "isp_spectranet", "education", "sms"):
        pattern = (
            r'commission_kobo, commission_estimated = _resolve_commission_kobo\(\s*'
            r'amount_kobo=amount_kobo,\s*service="' + service + r'"'
        )
        assert re.search(pattern, src), f"{service} does not report estimation"

    # And they must pass the provider's discount rather than omitting it.
    for service in ("betting", "isp_smile", "isp_spectranet", "education", "sms"):
        pattern = (
            r'commission_kobo, commission_estimated = _resolve_commission_kobo\(.*?'
            r'service="' + service + r'".*?discount='
        )
        assert re.search(pattern, src, re.S), f"{service} still omits the provider discount"


def test_cashable_credit_goes_through_the_helper():
    """No inline cashable credit may remain that ignores estimation."""
    src = open(BILLS, encoding="utf-8").read()
    assert "cashable_balance=User.cashable_balance + points" not in src, (
        "an inline cashable credit still bypasses the estimated-commission guard"
    )


def test_all_bill_services_enforce_rate_limits():
    """Every bills endpoint must guard on its service.

    betting/isp/education/sms had limits defined in rate_limiter.py but
    never called them, which is what made the deposit -> purchase ->
    withdraw loop unlimited.
    """
    src = open(BILLS, encoding="utf-8").read()
    guards = dict(
        re.findall(
            r'async def (\w+)\(.*?await enforce_rate_limits\(current_user\.id, "(\w+)"\)',
            src,
            re.S,
        )
    )
    for service in (
        "airtime",
        "data",
        "electricity",
        "tv",
        "betting",
        "isp_smile",
        "isp_spectranet",
        "education",
        "sms",
    ):
        assert service in guards.values(), f"no rate-limit guard for {service}"


def test_credit_helper_routes_by_estimation(monkeypatch):
    """Estimated commission must land in service credits, real in cash."""
    import asyncio

    from app.routers import bills

    seen: dict = {}

    class FakeResult:
        async def scalar_one(self):
            return None

    # Patch nothing structural - assert via the update values captured.
    captured: dict = {}

    class FakeDB:
        async def execute(self, stmt):
            captured["sql"] = str(stmt.compile(compile_kwargs={"literal_binds": True}))

    from app.config import settings

    monkeypatch.setattr(settings, "wallet_split_enabled", True, raising=False)

    asyncio.run(bills._credit_commission_points(FakeDB(), 1, 100, True))
    assert "service_credit_balance" in captured["sql"], "estimated credit went to cash"

    captured.clear()
    asyncio.run(bills._credit_commission_points(FakeDB(), 1, 100, False))
    assert "cashable_balance" in captured["sql"], "real margin did not reach cash"
