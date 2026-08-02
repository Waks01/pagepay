"""Bigisub VTU API client (v2).

Phase 8 — Bills & Earn. Wraps the Bigisub API for airtime, data,
electricity, cable TV, recharge pins, ISP, betting, SMS, and education.

Base URL: https://api.bigisub.ng
Auth: Authorization: Token <api_key> (header)
Body: application/json
PIN: 4-digit transaction PIN required for all purchases

Network IDs (fixed, no listing endpoint):
  1 = MTN
  2 = GLO
  3 = AIRTEL
  4 = 9MOBILE

Reference: https://rif.africa/technotronics/api/bigisub
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger("uvicorn.error")

_API_BASE = settings.bigisub_base_url
_HTTP_TIMEOUT_SECONDS = 15.0

_NETWORK_MAP = {
    "mtn": 1,
    "glo": 2,
    "airtel": 3,
    "9mobile": 4,
    "etisalat": 4,
    "mtn_gifting_data": 1,
    "mtn_data_share": 1,
    "mtn_sme": 1,
    "glo_data": 2,
    "airtel_data": 3,
    "9mobile_data": 4,
    "9mobile_gifting": 4,
}


class BigisubError(Exception):
    """Raised for non-2xx responses or network errors from Bigisub."""


class AirtimeNetwork:
    def __init__(self, data: dict) -> None:
        self.id: int = data["id"]
        self.name: str = data["name"]


class DataNetwork:
    def __init__(self, data: dict) -> None:
        self.id: int = data["id"]
        self.identifier: str = str(self.id)
        self.name: str = data["name"]


class DataPlan:
    def __init__(self, data: dict) -> None:
        self.id: int = data["id"]
        self.network: int = data.get("network", 0)
        self.network_name: str = data.get("network_name", "")
        self.plantype: str = data.get("plantype", "")
        self.size: str = str(data.get("size", ""))
        self.plan_volume: str = data.get("plan_volume", "")
        self.validity: str = data.get("validity", "")
        self.cost_amount: int = int(data.get("amount", 0))
        self.plan_amount: int = int(data.get("plan_amount", self.cost_amount))
        self.corporate_amount: int = int(data.get("corporate_amount", self.cost_amount))
        self.plan_disabled: bool = data.get("plan_disabled", False)
        self.amount: int = self.plan_amount

    @property
    def plan_code(self) -> str:
        return str(self.id)

    @property
    def label(self) -> str:
        return f"{self.size} {self.plan_volume} {self.validity} ({self.plantype})"


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


class BigisubClient:
    """HTTP client for the Bigisub VTU API (api.bigisub.ng)."""

    def __init__(self, api_key: str, pin: str) -> None:
        self._api_key = api_key
        self._pin = pin
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
        url = f"{_API_BASE}/{path.lstrip('/')}"
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.get(url, params=params, headers=self._public_headers)
        if resp.status_code != 200:
            raise BigisubError(f"Bigisub GET {path} returned {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    async def _post(self, path: str, payload: dict) -> dict:
        url = f"{_API_BASE}/{path.lstrip('/')}"
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, json=payload, headers=self._headers)
        if resp.status_code not in (200, 201):
            raise BigisubError(f"Bigisub POST {path} returned {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    def _resolve_network_id(self, network: str | int) -> int:
        if isinstance(network, int):
            return network
        key = network.strip().lower()
        if key in _NETWORK_MAP:
            return _NETWORK_MAP[key]
        # Try parsing as integer
        try:
            return int(key)
        except ValueError:
            raise BigisubError(f"Unknown Bigisub network: {network}")

    # ── Airtime ──────────────────────────────────────────────────────

    async def get_airtime_networks(self) -> list[AirtimeNetwork]:
        return [
            AirtimeNetwork({"id": 1, "name": "MTN"}),
            AirtimeNetwork({"id": 2, "name": "GLO"}),
            AirtimeNetwork({"id": 3, "name": "AIRTEL"}),
            AirtimeNetwork({"id": 4, "name": "9MOBILE"}),
        ]

    async def buy_airtime(
        self, network: str | int, mobile_number: str, amount: int,
    ) -> AirtimeResult:
        network_id = self._resolve_network_id(network)
        body = await self._post("vtu/airtime/purchase/", {
            "network": network_id,
            "phone_number": mobile_number,
            "amount": str(amount),
            "airtime_type": "vtu",
            "pin": self._pin,
        })
        data = body.get("data", {})
        return AirtimeResult(
            status="success" if body.get("success") else "failed",
            reference=data.get("reference", data.get("transaction_id", "")),
            amount=data.get("amount", str(amount)),
            charged=data.get("amount", str(amount)),
            discount="0",
            balance="",
            network=data.get("network", str(network_id)),
            mobile_number=data.get("phone_number", mobile_number),
            message=body.get("message", ""),
        )

    # ── Data ─────────────────────────────────────────────────────────

    async def get_data_networks(self) -> list[DataNetwork]:
        return [
            DataNetwork({"id": 1, "name": "MTN"}),
            DataNetwork({"id": 2, "name": "GLO"}),
            DataNetwork({"id": 3, "name": "AIRTEL"}),
            DataNetwork({"id": 4, "name": "9MOBILE"}),
        ]

    async def get_data_plans(self, network: str | int) -> list[DataPlan]:
        network_id = self._resolve_network_id(network)
        body = await self._get("vtu/data/plans/", params={"network": network_id})
        plans = body.get("data", [])
        return [DataPlan(p) for p in plans if not p.get("plan_disabled")]

    async def buy_data(
        self, network: str | int, mobile_number: str, plan_code: str,
    ) -> DataResult:
        network_id = self._resolve_network_id(network)
        plan_id = int(plan_code)

        plans = await self.get_data_plans(network_id)
        plan = next((p for p in plans if p.id == plan_id), None)
        if plan is None:
            raise BigisubError(f"Bigisub plan {plan_code} not found for network {network_id}")

        body = await self._post("vtu/data/purchase/", {
            "network": network_id,
            "phone_number": mobile_number,
            "plan": plan_id,
            "pin": self._pin,
        })
        data = body.get("data", {})
        actual_charged = float(data.get("amount", plan.amount))

        discount_pct = 0.0
        if plan.plan_amount and plan.plan_amount > 0:
            discount_pct = ((plan.plan_amount - actual_charged) / plan.plan_amount) * 100

        return DataResult(
            status="success" if body.get("success") else "failed",
            reference=data.get("reference", data.get("transaction_id", "")),
            amount=str(plan.amount),
            charged=str(int(actual_charged)),
            discount=str(round(discount_pct, 2)),
            balance="",
            plan=str(plan.id),
            network=str(network_id),
            mobile_number=data.get("phone_number", mobile_number),
            message=body.get("message", ""),
        )

    # ── Electricity ──────────────────────────────────────────────────

    async def get_electricity_plans(self) -> list[dict]:
        body = await self._get("bills/electricity/providers/")
        providers = body.get("data", {}).get("providers", [])
        return [
            {
                "code": p["code"],
                "name": p["name"],
                "min_amount_prepaid": p.get("min_amount_prepaid", 0),
                "min_amount_postpaid": p.get("min_amount_postpaid", 0),
                "service_charge": p.get("service_charge", 0),
                "service_charge_type": p.get("service_charge_type", "fixed"),
                "description": p.get("description", ""),
            }
            for p in providers
        ]

    async def verify_meter(
        self, disco_code: str, meter_number: str, meter_type: str = "prepaid",
    ) -> dict:
        body = await self._post("bills/electricity/verify/", {
            "disco_code": disco_code,
            "meter_number": meter_number,
            "meter_type": meter_type,
        })
        return body.get("data", {})

    async def buy_electricity(
        self, disco_code: str, meter_number: str, amount: int, meter_type: str, phone: str,
    ) -> dict:
        verify_result = await self.verify_meter(disco_code, meter_number, meter_type)
        customer_name = verify_result.get("customer_name", "")

        body = await self._post("bills/electricity/pay/", {
            "disco_code": disco_code,
            "meter_number": meter_number,
            "amount": str(amount),
            "meter_type": meter_type,
            "phone_number": phone,
            "pin": self._pin,
            "customer_name": customer_name,
        })
        return body.get("data", {})

    # ── Cable TV ─────────────────────────────────────────────────────

    async def get_cable_providers(self) -> list[dict]:
        body = await self._get("vtu/cable/plans/")
        plans = body.get("data", [])
        providers: dict[str, dict] = {}
        for p in plans:
            name = p.get("cable_name", "").lower()
            if name not in providers:
                providers[name] = {"name": name, "plans": []}
            providers[name]["plans"].append(p)
        return list(providers.values())

    async def get_cable_plans(self, provider: str) -> list[dict]:
        body = await self._get("vtu/cable/plans/", params={"cable_name": provider.lower()})
        plans = body.get("data", [])
        normalized = []
        for p in plans:
            item = dict(p)
            item["plan_code"] = str(p.get("id", ""))
            normalized.append(item)
        return normalized

    async def verify_cable(self, iuc: str, cable_name: str) -> dict:
        body = await self._post("vtu/cable/verify/", {
            "smartcard_number": iuc,
            "cable_name": cable_name.lower(),
        })
        return body.get("data", {})

    async def buy_cable(
        self, cable_name: str, plan_code: str, iuc: str, phone: str, amount: int,
    ) -> dict:
        verify_result = await self.verify_cable(iuc, cable_name)
        customer_name = verify_result.get("customer_name", "")

        plan_id = int(plan_code)
        plans = await self.get_cable_plans(cable_name)
        plan = next((p for p in plans if p.get("id") == plan_id), None)
        plan_amount = int(plan["amount"]) if plan else amount

        body = await self._post("vtu/cable/purchase/", {
            "smartcard_number": iuc,
            "cable_name": cable_name.lower(),
            "plan_id": plan_id,
            "phone_number": phone,
            "amount": str(amount),
            "customer_name": customer_name,
            "pin": self._pin,
        })
        data = body.get("data", {})
        actual_charged = float(data.get("amount", amount))

        discount_pct = 0.0
        if plan_amount > 0:
            discount_pct = ((plan_amount - actual_charged) / plan_amount) * 100

        result = dict(data)
        result["discount"] = str(round(discount_pct, 2))
        result["plan_amount"] = plan_amount
        return result


_client: BigisubClient | None = None


def get_client() -> BigisubClient:
    global _client
    if _client is None:
        key = settings.bigisub_api_key
        pin = settings.bigisub_pin
        if not key:
            raise BigisubError("bigisub_api_key is not configured in settings")
        if not pin:
            raise BigisubError("bigisub_pin is not configured in settings")
        _client = BigisubClient(key, pin)
    return _client


def reset_client_for_tests() -> None:
    global _client
    _client = None
