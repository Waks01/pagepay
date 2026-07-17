"""One-shot script: add RefundReceipt + refund_charge to paystack.py."""
EMDASH = b'\xe2\x80\x94'  # U+2014 em-dash used in this file
BOX = b'\xe2\x94\x80'  # U+2500 box-drawing char (different)

path = r'C:\Users\kenik\OneDrive\Desktop\pagepay\backend\app\services\paystack.py'
with open(path, 'rb') as f:
    data = f.read()

# 1. Add RefundReceipt after TransferReceipt
tr_end = (
    b'@dataclass\n'
    b'class TransferReceipt:\n'
    b'    """Result of /transfer ' + EMDASH + b' the transfer_code + reference Paystack echoed."""\n'
    b'    transfer_code: str\n'
    b'    reference: str\n'
    b'    status: str  # "pending" | "success" | "failed" | ...\n'
)
new_tr = tr_end + (
    b'\n'
    b'@dataclass\n'
    b'class RefundReceipt:\n'
    b'    """Result of /refund ' + EMDASH + b' Paystack\'s reference for the refund transaction."""\n'
    b'    reference: str\n'
    b'    transaction_id: int | None\n'
    b'    amount_kobo: int | None\n'
    b'    status: str  # "pending" | "success" | "failed" | "received" | ...\n'
)
assert tr_end in data, 'TransferReceipt block not found'
assert b'class RefundReceipt' not in data, 'RefundReceipt already present'
data = data.replace(tr_end, new_tr, 1)

# 2. Insert refund_charge before Webhook signature section.
# The box-drawing chars in the file are U+2500 (─), not U+2014.
# Header looks like: "    # ── Webhook signature ──────────────────────────────────────────"
# Build the marker dynamically from the prefix the file uses.
import re
m = re.search(rb'    # ' + BOX + rb'{2,} Webhook signature ' + BOX + rb'{2,}', data)
assert m, 'webhook section header not found'
webhook_marker = m.group(0)
print('webhook marker:', webhook_marker[:60])

refund_method = (
    b'    # ' + BOX + b'{2,} Refund ' + BOX * 21 + b'\n'
    b'\n'
    b'    async def refund_charge(\n'
    b'        self,\n'
    b'        *,\n'
    b'        reference: str,\n'
    b'        amount_kobo: int | None = None,\n'
    b'    ) -> RefundReceipt:\n'
    b'        """Create a refund for a previous charge via Paystack.\n'
    b'\n'
    b'        Paystack\'s `POST /refund` accepts either the original\n'
    b'        `reference` (our internal `provider_tx_ref`) or a numeric\n'
    b'        transaction id. We use the reference because that is what\n'
    b'        PagePay stores on the `Payment` row.\n'
    b'\n'
    b'        `amount_kobo` is optional ' + EMDASH + b' omit for a full refund. When\n'
    b'        provided, it must be <= the original charge.\n'
    b'\n'
    b'        Returns a `RefundReceipt` with Paystack\'s echoed reference\n'
    b'        (which differs from the original ' + EMDASH + b' Paystack generates a new\n'
    b'        reference for the refund). Status is typically "pending"\n'
    b'        and flips to "success" once the refund settles (webhook\n'
    b'        `refund.processed` or `refund.failed`).\n'
    b'        """\n'
    b'        url = f"{PAYSTACK_BASE_URL}/refund"\n'
    b'        payload: dict[str, Any] = {"reference": reference}\n'
    b'        if amount_kobo is not None:\n'
    b'            payload["amount"] = int(amount_kobo)\n'
    b'\n'
    b'        try:\n'
    b'            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:\n'
    b'                resp = await client.post(\n'
    b'                    url,\n'
    b'                    headers=_auth_headers(self._secret_key),\n'
    b'                    json=payload,\n'
    b'                )\n'
    b'        except httpx.HTTPError as exc:\n'
    b'            raise PaystackError(f"Paystack request failed: {exc}") from exc\n'
    b'\n'
    b'        if resp.status_code < 200 or resp.status_code >= 300:\n'
    b'            raise PaystackError(\n'
    b'                f"Paystack returned HTTP {resp.status_code} for POST /refund: {resp.text[:500]}"\n'
    b'            )\n'
    b'        try:\n'
    b'            body = resp.json()\n'
    b'        except ValueError as exc:\n'
    b'            raise PaystackError("Paystack returned non-JSON for POST /refund") from exc\n'
    b'        if not isinstance(body, dict) or body.get("status") is not True:\n'
    b'            raise PaystackError(f"Paystack status != true for POST /refund: {body!r}")\n'
    b'        data_resp = body.get("data") or {}\n'
    b'        return RefundReceipt(\n'
    b'            reference=str(data_resp.get("reference") or ""),\n'
    b'            transaction_id=(\n'
    b'                int(data_resp["transaction"])\n'
    b'                if isinstance(data_resp.get("transaction"), (int, float))\n'
    b'                else None\n'
    b'            ),\n'
    b'            amount_kobo=(\n'
    b'                int(data_resp["amount"])\n'
    b'                if isinstance(data_resp.get("amount"), (int, float))\n'
    b'                else None\n'
    b'            ),\n'
    b'            status=str(data_resp.get("status") or "pending"),\n'
    b'        )\n'
    b'\n'
)
data = data.replace(webhook_marker, refund_method + webhook_marker, 1)

with open(path, 'wb') as f:
    f.write(data)
print('paystack.py updated')

with open(path, 'rb') as f:
    d = f.read()
print('  RefundReceipt class:', b'class RefundReceipt' in d)
print('  refund_charge method:', b'async def refund_charge' in d)
print('  /refund endpoint used:', b'/refund' in d)

import ast
ast.parse(d)
print('  syntax OK')
