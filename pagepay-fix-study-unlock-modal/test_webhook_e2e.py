"""
End-to-end webhook test.

What this does:
  1. Reads the live Paystack secret from backend/.env (the same one the
     production backend uses — so the signature will verify on both the
     Worker and the Render FastAPI endpoint).
  2. Builds a real-looking `charge.success` event for a wallet deposit
     with a `pp_wallet_<uid>_<rand>` reference (matches the format the
     backend creates in wallet.py:251).
  3. HMAC-SHA512 signs the raw JSON body — exactly the way Paystack does.
  4. POSTs it to the live Worker URL.
  5. Prints the exact response the Worker returned — status, headers, body.

This is NOT a placeholder. The signature is real, the payload shape is
real (Paystack-documented), and the Worker will route it via the prefix
match into the live Render backend.
"""

import hashlib
import hmac
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path
import urllib.request
import urllib.error


def read_secret() -> str:
    env_path = Path(__file__).parent / "backend" / ".env"
    if not env_path.exists():
        sys.exit(f"FAIL: {env_path} not found")
    text = env_path.read_text(encoding="utf-8")
    for line in text.splitlines():
        m = re.match(r"^PAYSTACK_SECRET_KEY\s*=\s*(.+?)\s*$", line)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    sys.exit("FAIL: PAYSTACK_SECRET_KEY not in .env")


def sign(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha512).hexdigest()


def post(url: str, body: bytes, signature: str) -> tuple[int, dict, str]:
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Paystack-Signature": signature,
            # Cloudflare's Browser Integrity Check (error 1010) rejects
            # requests that don't look like a browser. Set a normal UA
            # so the Worker code (which is what we're testing) actually
            # runs and we can see its real response.
            "User-Agent": "Paystack-Webhook-Test/1.0 (E2E diagnostic)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, dict(resp.headers), resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", errors="replace")


def main() -> int:
    secret = read_secret()
    print(f"Using secret: {secret[:8]}...{secret[-4:]}  (len={len(secret)})")
    assert secret.startswith("sk_"), "Expected a Paystack live secret key"

    # Realistic charge.success payload for a wallet deposit. The `data.metadata`
    # block mirrors what backend/app/routers/wallet.py:261-268 writes when
    # initiating a deposit. The reference prefix `pp_wallet_` is what the
    # Worker ROUTES table matches on.
    user_id = 99999  # synthetic — won't actually credit, just verifies the wire
    reference = f"pp_wallet_{user_id}_{uuid.uuid4().hex[:16]}"
    payload = {
        "event": "charge.success",
        "data": {
            "id": 12345678,
            "domain": "test",
            "status": "success",
            "reference": reference,
            "amount": 10000,
            "message": None,
            "gateway_response": "Successful",
            "paid_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "channel": "card",
            "currency": "NGN",
            "ip_address": "127.0.0.1",
            "metadata": {
                "user_id": user_id,
                "type": "wallet_deposit",
                "deposit_amount_kobo": 10000,
                "processing_fee_kobo": 150,
                "total_amount_kobo": 10150,
                "custom_amount": False,
            },
            "fees_breakdown": None,
            "customer": {
                "id": user_id,
                "first_name": "Test",
                "last_name": "User",
                "email": f"test+{user_id}@example.com",
                "customer_code": f"CUS_{user_id}",
                "phone": None,
                "metadata": None,
                "risk_action": "default",
            },
            "authorization": {
                "authorization_code": "AUTH_test",
                "bin": "408408",
                "last4": "4081",
                "exp_month": "12",
                "exp_year": "2030",
                "channel": "card",
                "card_type": "visa ",
                "bank": "TEST BANK",
                "country_code": "NG",
                "brand": "Visa",
                "reusable": True,
                "signature": "SIG_test",
                "account_name": None,
            },
            "plan": None,
        },
    }

    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = sign(body, secret)

    worker_url = "https://paystack-webhook-router.kenikool.workers.dev/"
    print(f"\nPOST {worker_url}")
    print(f"Body bytes: {len(body)}")
    print(f"Signature: {signature[:16]}...{signature[-8:]}")
    print(f"Reference: {reference}")

    status, headers, response_body = post(worker_url, body, signature)
    print("\n" + "=" * 70)
    print(f"WORKER RESPONSE  status={status}")
    print("=" * 70)
    print(f"Content-Type: {headers.get('Content-Type', '<none>')}")
    print(f"Allow:        {headers.get('Allow', '<none>')}")
    print(f"Body ({len(response_body)} bytes):")
    print(response_body)

    # Expected: status code reflects what the live Render backend returned
    # for this webhook. Because no Payment row exists for our synthetic
    # reference, the dispatcher should respond with something like 404 or
    # an explicit "reference not found" — NOT a 200 + generic OK echo.
    if status == 200 and '"ok": true' in response_body.lower():
        print("\n!! PLACEHOLDER DETECTED — Worker is wrapping unknown responses as 200 OK.")
        return 1
    if status == 200:
        print("\n200 OK — verifying body is real backend output (no placeholder)...")
        # 200 from the backend is fine as long as the body is the real one.
        # The dispatcher's verify_paystack_signature / lookup_payment flow
        # returns 200 with {"received": true} ONLY after a successful
        # lookup. For our synthetic reference it should NOT be 200.
        if 'received' in response_body.lower() and len(response_body) < 80:
            print("!! SUSPICIOUS: tiny 200 OK body — likely a hardcoded placeholder.")
            return 1
    print("\n[OK] Response looks like a real backend outcome (status passthrough).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
