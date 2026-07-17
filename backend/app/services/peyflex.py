"""Peyflex VTU API client (v2 — correct endpoints).

Phase 8 — Bills & Earn. Wraps the Peyflex API for airtime, data,
electricity, and cable TV purchases.

Base URL: https://client.peyflex.com.ng/api/
Auth: Authorization: Token <api_key> (header, required for POST)
Body: application/json

Reference: https://documenter.getpostman.com/view/17835214/2sB34imLMn
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import settings

logger = logging.getLogger("uvicorn.error")

_API_BASE = "https://client.peyflex.com.ng/api"
_HTTP_TIMEOUT_SECONDS = 15.0


class PeyflexError(Exception):
    """Raised for non-2xx responses or network errors from Peyflex."""


class AirtimeNetwork:
    def __init__(self, data: dict) -> None:
        self.id: str = data["id"]
        self.name: str = data["name"]


class DataNetwork:
    def __init__(self, data: dict) -> None:
        self.identifier: str = data["identifier"]
        self.name: str = data["name"]


class DataPlan:
    def __init__(self, data: dict) -> None:
        self.plan_code: str = data["plan_code"]
        self.amount: int = data["amount"]
        self.label: str = data["label"]


@dataclass
class AirtimeResult:
    status: str
    reference: str
    amount: str
    charged: str
    discount: str
    balance: str
    network: str
    mobile_number: str
    message: str


@dataclass
class DataResult:
    status: str
    reference: str
    amount: str
    charged: str
    discount: str
    balance: str
    plan: str
    network: str
    mobile_number: str
    message: str


class PeyflexClient:
    """HTTP client for the Peyflex VTU API (client.peyflex.com.ng)."""

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key
        self._headers = {
            "Authorization": f"Token {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "PagePay/1.0",
        }
        self._public_headers = {
            "Accept": "application/json",
            "User-Agent": "PagePay/1.0",
        }

    async def _get(self, path: str, params: dict | None = None) -> dict:
        """Make a public GET request (no auth needed for reads)."""
        url = f"{_API_BASE}/{path.lstrip('/')}"
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.get(url, params=params, headers=self._public_headers)
        if resp.status_code != 200:
            raise PeyflexError(f"Peyflex GET {path} returned {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    async def _post(self, path: str, payload: dict) -> dict:
        """Make an authenticated POST request."""
        url = f"{_API_BASE}/{path.lstrip('/')}"
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, json=payload, headers=self._headers)
        if resp.status_code not in (200, 201):
            raise PeyflexError(f"Peyflex POST {path} returned {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    # ── Airtime ──────────────────────────────────────────────────────

    async def get_airtime_networks(self) -> list[AirtimeNetwork]:
        """List supported airtime networks. No auth required."""
        body = await self._get("airtime/networks/")
        return [AirtimeNetwork(n) for n in body.get("networks", [])]

    async def buy_airtime(
        self, network: str, mobile_number: str, amount: int,
    ) -> AirtimeResult:
        """Buy airtime.

        network: mtn, airtel, glo (from get_airtime_networks())
        """
        body = await self._post("airtime/topup/", {
            "network": network,
            "amount": amount,
            "mobile_number": mobile_number,
        })
        return AirtimeResult(
            status="success" if body.get("status") == "SUCCESS" else "failed",
            reference=body.get("reference", ""),
            amount=body.get("amount", ""),
            charged=body.get("charged", ""),
            discount=body.get("discount", ""),
            balance=body.get("balance", ""),
            network=body.get("network", ""),
            mobile_number=body.get("mobile_number", ""),
            message=body.get("message", ""),
        )

    # ── Data ─────────────────────────────────────────────────────────

    async def get_data_networks(self) -> list[DataNetwork]:
        """List supported data networks. No auth required."""
        body = await self._get("data/networks/")
        return [DataNetwork(n) for n in body.get("networks", [])]

    async def get_data_plans(self, network: str) -> list[DataPlan]:
        """List available data plans for a network. No auth required.

        network: e.g. mtn_gifting_data, mtn_data_share, glo_data,
                  airtel_data, 9mobile_data, 9mobile_gifting
        """
        body = await self._get("data/plans/", params={"network": network})
        return [DataPlan(p) for p in body.get("plans", [])]

    async def buy_data(
        self, network: str, mobile_number: str, plan_code: str,
    ) -> DataResult:
        """Buy a data bundle.

        network: data network identifier (e.g. mtn_data_share)
        plan_code: plan code from get_data_plans (e.g. M1GBS)
        """
        body = await self._post("data/purchase/", {
            "network": network,
            "mobile_number": mobile_number,
            "plan_code": plan_code,
        })
        return DataResult(
            status="success" if body.get("status") == "SUCCESS" else "failed",
            reference=body.get("reference", ""),
            amount=body.get("amount", ""),
            charged=body.get("charged", ""),
            discount=body.get("discount", ""),
            balance=body.get("balance", ""),
            plan=body.get("plan", ""),
            network=body.get("network", ""),
            mobile_number=body.get("mobile_number", ""),
            message=body.get("message", ""),
        )

    # ── Electricity ──────────────────────────────────────────────────

    async def get_electricity_plans(self) -> list[dict]:
        """List electricity DISCO plans. No auth."""
        body = await self._get("electricity/plans/", params={"identifier": "electricity"})
        return body.get("plans", [])

    async def verify_meter(
        self, plan: str, meter: str, meter_type: str = "prepaid",
    ) -> dict:
        """Verify a meter number. No auth."""
        return await self._get("electricity/verify/", params={
            "identifier": "electricity",
            "meter": meter,
            "plan": plan,
            "type": meter_type,
        })

    async def buy_electricity(
        self, plan: str, meter: str, amount: int, meter_type: str, phone: str,
    ) -> dict:
        """Recharge electricity meter."""
        return await self._post("electricity/subscribe/", {
            "identifier": "electricity",
            "meter": meter,
            "plan": plan,
            "amount": str(amount),
            "type": meter_type,
            "phone": phone,
        })

    # ── Cable TV ─────────────────────────────────────────────────────

    async def get_cable_providers(self) -> list[dict]:
        """List cable TV providers. No auth."""
        body = await self._get("cable/providers/")
        return body.get("providers", [])

    async def get_cable_plans(self, provider: str) -> list[dict]:
        """List cable plans for a provider. No auth."""
        body = await self._get(f"cable/plans/{provider}/")
        return body.get("plans", [])

    async def verify_cable(self, iuc: str, identifier: str) -> dict:
        """Verify a cable IUC/smartcard number. Auth required."""
        return await self._post("cable/verify/", {
            "iuc": iuc,
            "identifier": identifier,
        })

    async def buy_cable(self, identifier: str, plan: str, iuc: str, phone: str, amount: int) -> dict:
        """Subscribe/renew cable TV."""
        return await self._post("cable/subscribe/", {
            "identifier": identifier,
            "plan": plan,
            "iuc": iuc,
            "phone": phone,
            "amount": str(amount),
        })


_client: PeyflexClient | None = None
_public_client: PeyflexClient | None = None


def get_client() -> PeyflexClient:
    """Lazily-built module-level PeyflexClient singleton (auth required)."""
    global _client
    if _client is None:
        key = settings.peyflex_api_key
        if not key:
            raise PeyflexError("peyflex_api_key is not configured in settings")
        _client = PeyflexClient(key)
    return _client


def get_public_client() -> PeyflexClient:
    """Client for public GET endpoints (networks/plans lists). No API key needed."""
    global _public_client
    if _public_client is None:
        _public_client = PeyflexClient(settings.peyflex_api_key or "")
    return _public_client


def reset_client_for_tests() -> None:
    global _client, _public_client
    _client = None
    _public_client = None
