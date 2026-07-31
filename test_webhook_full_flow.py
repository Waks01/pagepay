"""
Webhook E2E test #2 — full real flow.

Step 1: Register a fresh test user via the live Render backend.
Step 2: Log in to get a JWT.
Step 3: POST /wallet/deposit to get a real reference.
Step 4: Send a signed charge.success webhook for that reference to the
        live Worker URL.
Step 5: Verify the Worker's response body proves the credit landed.
Step 6: Confirm the user's balance went up via /wallet/transactions.

This is the full real-money-equivalent flow that runs when an actual
Paystack customer completes checkout, except step 1-3 are manual instead
of initiated by the customer's checkout session. The webhook itself is
exactly what Paystack would send.
"""

import hashlib
import hmac
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

RENDER = "https://pagepay-fff6.onrender.com"
WORKER = "https://paystack-webhook-router.kenikool.workers.dev/"


def read_secret() -> str:
    env_path = Path(__file__).parent / "backend" / ".env"
    text = env_path.read_text(encoding="utf-8")
    for line in text.splitlines():
        m = re.match(r"^PAYSTACK_SECRET_KEY\s*=\s*(.+?)\s*$", line)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    sys.exit("FAIL: secret not in .env")


def http(method: str, url: str, body=None, headers=None, form_body: str | None = None) -> tuple[int, dict, str]:
    data = None
    final_headers = {"User-Agent": "Paystack-Webhook-Test/2.0 (E2E diagnostic)"}
    if form_body is not None:
        data = form_body.encode("utf-8")
        final_headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode("utf-8")
        final_headers["Content-Type"] = "application/json"
    if headers:
        final_headers.update(headers)
    req = urllib.request.Request(url, data=data, method=method, headers=final_headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, dict(resp.headers), resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", errors="replace")


def post_raw(url: str, raw: bytes, headers: dict) -> tuple[int, dict, str]:
    """POST a pre-signed raw body (used for the webhook itself, where
    the signature is over the exact bytes — re-encoding would break it)."""
    final_headers = {"User-Agent": "Paystack-Webhook-Test/2.0 (E2E diagnostic)"}
    final_headers.update(headers)
    req = urllib.request.Request(url, data=raw, method="POST", headers=final_headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, dict(resp.headers), resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", errors="replace")


def sign(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha512).hexdigest()


def main() -> int:
    secret = read_secret()
    print(f"Secret loaded: {secret[:8]}...{secret[-4:]}")

    # ── 1. Register a fresh user ────────────────────────────────────────────
    suffix = uuid.uuid4().hex[:8]
    email = f"webhook-test-{suffix}@example.com"
    password = "TestPass!2345"

    print(f"\n[1] Registering {email} ...")
    status, _, body = http("POST", f"{RENDER}/api/v1/auth/register", {
        "email": email,
        "password": password,
        "full_name": "Webhook Test",
    })
    print(f"    register -> {status} {body[:200]}")
    if status not in (200, 201):
        print("FAIL: register did not succeed")
        return 1

    # ── 2. Log in to get a JWT ──────────────────────────────────────────────
    # The login endpoint uses OAuth2PasswordRequestForm, so we send
    # form-encoded data with the field `username` (the email goes here).
    print("\n[2] Logging in ...")
    form = f"username={urllib.parse.quote(email)}&password={urllib.parse.quote(password)}"
    status, _, body = http("POST", f"{RENDER}/api/v1/auth/login", form_body=form)
    print(f"    login -> {status} {body[:200]}")
    if status != 200:
        print("FAIL: login did not succeed")
        return 1
    token = json.loads(body)["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    # ── 3. Initiate a wallet deposit (this is the create-side of the flow) ─
    print("\n[3] Initiating wallet deposit ...")
    status, _, body = http("POST", f"{RENDER}/api/v1/wallet/deposit", {
        "deposit_amount_kobo": 10000,
        "custom_amount": False,
    }, headers=auth)
    print(f"    deposit -> {status} {body[:300]}")
    if status != 200:
        print("FAIL: deposit init did not succeed")
        return 1
    deposit = json.loads(body)
    reference = deposit["reference"]
    payment_url = deposit["payment_url"]
    print(f"    reference = {reference}")
    print(f"    payment_url = {payment_url[:80]}...")

    # ── 4. Send a signed charge.success webhook to the live Worker ──────────
    print("\n[4] Sending signed charge.success to live Worker ...")
    payload = {
        "event": "charge.success",
        "data": {
            "id": int(time.time()),
            "domain": "test",
            "status": "success",
            "reference": reference,
            "amount": deposit["amount_kobo"],
            "gateway_response": "Successful",
            "paid_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "channel": "card",
            "currency": "NGN",
            "metadata": {
                "user_id": 0,  # not trusted by dispatcher; ref lookup is the source of truth
                "type": "wallet_deposit",
                "deposit_amount_kobo": deposit["deposit_amount_kobo"],
                "processing_fee_kobo": deposit["amount_kobo"] - deposit["deposit_amount_kobo"],
                "total_amount_kobo": deposit["amount_kobo"],
                "custom_amount": False,
            },
            "customer": {
                "id": 0,
                "first_name": "Webhook",
                "last_name": "Test",
                "email": email,
                "customer_code": "CUS_test",
            },
        },
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = sign(raw, secret)

    worker_status, worker_headers, worker_body = post_raw(WORKER, raw, {
        "Content-Type": "application/json",
        "X-Paystack-Signature": sig,
    })
    print(f"    WORKER RESPONSE: status={worker_status}")
    print(f"    Content-Type: {worker_headers.get('Content-Type', '<none>')}")
    print(f"    Body: {worker_body}")
    if worker_status == 200 and '"ok": true' in worker_body.lower():
        print("\n!! PLACEHOLDER DETECTED in Worker response.")
        return 1

    # ── 5. Verify the credit actually landed on the user's wallet ───────────
    print("\n[5] Verifying credit landed on wallet ...")
    status, _, body = http("GET", f"{RENDER}/api/v1/auth/me", headers=auth)
    print(f"    /auth/me -> {status}")
    print(f"    body: {body}")
    try:
        me = json.loads(body)
        balance_pts = me.get("points_balance", 0)
    except json.JSONDecodeError:
        balance_pts = 0

    # The deposit converts to POINTS_PER_NAIRA=10 points/₦. A ₦100
    # (10,000 kobo) deposit = 1000 points credited.
    expected = 1000
    if balance_pts >= expected:
        print(f"\n[OK] Wallet balance is {balance_pts} pts (expected >= {expected}).")
        deposit_seen = True
    else:
        print(f"\nFAIL: balance is {balance_pts} pts, expected >= {expected}.")
        deposit_seen = False

    # ── 5b. Bonus check: bad signature must be rejected by the Worker ───────
    print("\n[5b] Bad-signature rejection check ...")
    bad_sig = "0" * 128
    bs, _, bbody = post_raw(WORKER, raw, {
        "Content-Type": "application/json",
        "X-Paystack-Signature": bad_sig,
    })
    print(f"    Bad-sig response: status={bs} body={bbody}")
    sig_rejected = (bs == 401 and "Invalid" in bbody)
    if sig_rejected:
        print("[OK] Worker rejected bad signature with 401.")
    else:
        print(f"FAIL: expected 401 Invalid webhook signature, got {bs} {bbody}")

    print("\n[6] Done.")
    return 0 if (deposit_seen and sig_rejected) else 1


if __name__ == "__main__":
    sys.exit(main())
