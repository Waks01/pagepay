# PagePay Security Vulnerability & Gap Analysis

**Date:** 2026-07-06  
**Scope:** Backend (`backend/app`), Frontend (`client/app`, `client/src`), Infrastructure  
**Analyst:** Security review via code inspection

---

## CRITICAL — Immediate Action Required

### 1. Password Reset Token Leaked in API Response
**File:** `backend/app/routers/auth.py:204-208`  
**Description:** The `forgot-password` endpoint returns the raw password reset token in the JSON response body under `dev_token`. Even in production, a client-side attacker with network access (proxy, malicious extension, MITM) can intercept this token and reset any user's password before the legitimate user does.

```python
# auth.py:204-208
return {
    "ok": True,
    "message": "If that account exists, a reset link has been sent.",
    "dev_token": raw_token,  # ⚠️ CRITICAL: exposes raw reset token
}
```

**Impact:** Account takeover via password reset for any account whose email/phone is known.  
**Fix:** Remove `dev_token` from the response entirely. Return only the generic message. Send the token via email/SMS only.

---

### 2. Weak / Unset JWT Secret Key Fallback
**File:** `docker-compose.yml:32`  
**Description:** The Docker compose file falls back to `dev-secret-change-me` when `SECRET_KEY` is not set in the environment. This is a trivially guessable secret that would allow an attacker to forge JWTs for any user.

```yaml
# docker-compose.yml:32
SECRET_KEY: ${SECRET_KEY:-dev-secret-change-me}
```

**Impact:** Complete authentication bypass — attacker can create arbitrary JWTs to impersonate any user or admin.  
**Fix:** Remove the default fallback. Set `SECRET_KEY` to a strong random value in production and fail startup if it is missing or weak.

---

### 3. Hardcoded Default Admin Token
**File:** `backend/app/config.py:135` and `docker-compose.yml:34`  
**Description:** `admin_token` defaults to `"dev-admin-token"` and the docker-compose falls back to the same value. Admin endpoints protected by `X-Admin-Token` are entirely accessible to anyone who knows this default.

```python
# config.py:135
admin_token: str = "dev-admin-token"
```

**Impact:** Full admin API access — attacker can read/modify any user data, adjust balances, approve payouts, modify config.  
**Fix:** Require `ADMIN_TOKEN` to be set in production; fail startup with a clear error if it is missing or matches the default.

---

### 4. Global Exception Handler Leaks Internal Details
**File:** `backend/app/main.py:103-115`  
**Description:** The global exception handler returns `str(exc)` directly to the client in all 500 responses. This can expose internal error messages, database schemas, API keys from failed initializations, file paths, and stack trace information.

```python
# main.py:112-114
return JSONResponse(
    status_code=500,
    content={"detail": str(exc)},
)
```

**Impact:** Information disclosure aiding further attacks — attackers learn internal architecture, library versions, secret key presence, database structure.  
**Fix:** Return a generic `{"detail": "Internal server error"}` in production. Log the full exception server-side only. Use a flag like `DEBUG` to control verbosity.

---

### 5. Payment Info (NUBAN) Stored Unencrypted At Rest
**File:** `backend/app/models/__init__.py:270`, `backend/app/routers/payouts.py:303,371`  
**Description:** Bank account numbers (10-digit Nigerian NUBANs) are stored as plaintext in the database. The model docstring acknowledges this: "Phase 4 should encrypt this column at rest. v1 stores plain."

```python
# models/__init__.py:270
account_number: Mapped[str] = mapped_column(String(10))
```

**Impact:** PCI-DSS compliance violation; database breach exposes user bank account numbers for fraud (social engineering, direct debit abuse).  
**Fix:** Use application-level encryption (AES-256-GCM via `cryptography` library) with a key stored in a secrets manager. Store only ciphertext in DB.

---

## HIGH — Fix Before Production

### 6. Password Reset Token Expiry Logic Is Unsafe
**File:** `backend/app/routers/auth.py:191`  
**Description:** Reset tokens expire at end-of-day UTC (23:59:59) rather than using a fixed time-to-live. A token created at 11:58 PM expires in 2 minutes. A token created at 3 PM is valid for ~9 hours — far too long for a reset token.

```python
# auth.py:191
expires_at = datetime.utcnow().replace(hour=23, minute=59, second=59)
```

**Impact:** Extremely short expiry window for late-day requests; excessively long window for daytime requests.  
**Fix:** Use `expires_at = datetime.utcnow() + timedelta(hours=1)` (or 15 minutes for higher security).

---

### 7. Database SSL Certificate Verification Disabled
**File:** `backend/app/database.py:15-17`  
**Description:** The PostgreSQL SSL context disables hostname checking and certificate verification (`CERT_NONE`). The comment says this is safe within Render's private network, but the same code runs in all environments.

```python
# database.py:15-17
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE
```

**Impact:** MITM attacks on database connections if the "private network" boundary is crossed (compromised Render peer, DNS hijack, insider threat).  
**Fix:** Enable certificate verification (`verify_mode = ssl.CERT_REQUIRED`) and provide the CA bundle path. Use `ssl_context.load_verify_locations(cafile=...)` with Render's CA.

---

### 8. Admin Cookie Uses `samesite="none"` Without Explicit Risk Acceptance
**File:** `backend/app/services/admin_auth.py:60-68`  
**Description:** The admin session cookie is set with `samesite="none"` and `secure=True`. While technically valid, `samesite="none"` means the cookie is sent on cross-site requests (CSRF risk), and combined with the wide CORS policy, this creates an attack surface. Additionally, `secure=True` breaks admin auth on plain HTTP localhost, which may push developers to disable it.

```python
# admin_auth.py:64-65
secure=True,
samesite="none",  # Allow cross-origin requests
```

**Impact:** CSRF attacks against admin endpoints; potential localhost auth bypass during development.  
**Fix:** Use `samesite="lax"` (or `"strict"`) instead of `"none"`. If cross-origin is genuinely needed, implement CSRF double-submit tokens on all state-changing admin endpoints.

---

### 9. In-Memory Study Session Store (Not Production-Safe)
**File:** `backend/app/routers/study.py:682-713`  
**Description:** `StudySession` stores all active sessions in a class-level Python dict (`_sessions: dict[int, dict]`). This is lost on process restart, doesn't work across multiple workers, and has no TTL/cleanup.

```python
class StudySession:
    _sessions: dict[int, dict] = {}  # Lost on restart, not distributed
```

**Impact:** Study sessions vanish on deploy/redeploy; worker count > 1 causes session-loss; memory leak over time.  
**Fix:** Store study sessions in the database (ReadingSession table already exists) or Redis with a TTL.

---

### 10. Gemini API Key Passed in URL Query Parameter
**File:** `backend/app/routers/study.py:114`  
**Description:** The Gemini API key is appended to the URL as a query parameter (`?key={api_key}`). URLs are logged by proxies, load balancers, and application logs.

```python
# study.py:114
url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
```

**Impact:** API key leakage through HTTP access logs, proxy logs, referrer headers.  
**Fix:** Pass the API key in the `x-goog-api-key` header instead.

---

### 11. No Idempotency / Race Condition on Withdrawal Debit
**File:** `backend/app/routers/payouts.py:483-513`  
**Description:** The withdrawal flow reads the user's balance, checks it, then debits — all in a single async handler without pessimistic locking. Two concurrent requests can both read a sufficient balance and both succeed in debiting, resulting in a negative balance.

```python
# payouts.py:483-513
if user_row.points_balance < total_debit_kobo:  # ← Check
    ...
user_row.points_balance -= total_debit_kobo      # ← Debit (no lock)
```

**Impact:** Double withdrawal — user can withdraw more than their balance.  
**Fix:** Use `SELECT ... FOR UPDATE` (or SQLAlchemy's `with_for_update()`) to lock the user row during the balance check + debit. Alternatively, add a database-level constraint or use a serialized transaction isolation level.

---

### 12. Bills Debit Without Atomic Retry Safety
**File:** `backend/app/routers/bills.py:88-149` (and similar blocks for data/electricity/TV)  
**Description:** The bills router debits the wallet (`UPDATE User SET points_balance = points_balance - amount`) then calls the external Peyflex API. On failure, it rolls back. However, concurrent requests can slip past the balance check.

```python
# bills.py:95-99
await db.execute(
    update(User).where(User.id == current_user.id)
    .values(points_balance=User.points_balance - amount_kobo)
)
```

**Impact:** Race condition allows spending more points than owned.  
**Fix:** Use `SELECT ... FOR UPDATE` row locking for the user record during the entire purchase flow.

---

## MEDIUM — Fix In Next Sprint

### 13. Rate Limiter Uses IP Address Only
**File:** `backend/app/limiter.py:4`  
**Description:** `slowapi` is configured with `get_remote_address` as the key function. Behind NAT, CDNs, or mobile networks, many legitimate users share one IP. Conversely, an attacker with many IPs (botnet, rotating proxies) bypasses per-user limits.

```python
limiter = Limiter(key_func=get_remote_address)
```

**Impact:** IP-based rate limits either block innocent users or fail to deter distributed attackers.  
**Fix:** Use authenticated user ID when available (`key_func=get_user_id_or_ip` with a fallback), and apply per-user limits on sensitive endpoints.

---

### 14. Community Feed Exposes User Emails and Phones
**File:** `backend/app/routers/community.py:96`  
**Description:** The community feed endpoint returns `author_name` which is constructed from the user's raw email or phone number. This is PII exposure to all feed readers.

```python
# community.py:96
author_name = email or phone or "Anonymous"
```

**Impact:** PII (email, phone) exposed in API responses; GDPR/privacy violation if users haven't consented.  
**Fix:** Use a display name (e.g., first name + initials, or an anonymized handle). Never echo raw contact info.

---

### 15. CORS Allows `allow_methods=["*"]` and `allow_headers=["*"]`
**File:** `backend/app/main.py:135-141`  
**Description:** While `allow_origins` is restricted to specific domains, `allow_methods=["*"]` and `allow_headers=["*"]` allow any HTTP method and header. This widens the blast radius if origin restriction is ever misconfigured.

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],   # Should be explicit: GET, POST, PUT, DELETE, OPTIONS
    allow_headers=["*"],   # Should be explicit
)
```

**Impact:** If origins are ever broadened, all methods/headers are implicitly allowed.  
**Fix:** Explicitly list allowed methods and headers: `allow_methods=["GET","POST","PUT","DELETE","OPTIONS"]`, `allow_headers=["Authorization","Content-Type"]`.

---

### 16. KYC Document URLs Stored Without Access Control Indicators
**File:** `backend/app/models/__init__.py:895-899`  
**Description:** KYC documents (ID cards, business registration) are stored as plaintext URLs on the `SponsorKYC` model. If these URLs are predictable or the storage bucket is misconfigured, they are accessible without authentication.

**Impact:** Identity document exposure — full names, ID numbers, addresses publicly accessible.  
**Fix:** Store documents in access-controlled storage (signed URLs with expiry). Never expose the raw URL in API responses; generate time-limited signed URLs only when accessed by authorized admins.

---

### 17. AdMob SSV Allows Unauthenticated Connectivity Test GET
**File:** `backend/app/routers/ads.py:435-439`  
**Description:** An empty GET to `/ads/google/callback` returns 200 with `{"status": "verification_success"}` without any signature verification. While AdMob uses this for connectivity checks, any external attacker can probe the endpoint.

**Impact:** Endpoint reconnaissance; attacker can confirm SSV endpoint is live before crafting forged callbacks.  
**Fix:** Require at minimum a shared secret query parameter or IP-allowlist for connectivity tests. Document that AdMob's test includes the signature header even for connectivity probes.

---

### 18. No Request Body Size Limits Globally
**File:** `backend/app/main.py`  
**Description:** FastAPI's default request body limit is 1MB, but there is no explicit `LimitUploadSize` middleware configured. File uploads (study images, documents, task screenshots) could be used for DoS via large payloads.

**Impact:** Memory exhaustion via large uploads.  
**Fix:** Add `python-multipart` size limits and a FastAPI middleware to cap request body sizes (e.g., 10MB for multipart, 1MB for JSON).

---

### 19. Admin Audit Log IP Addresses Not Captured
**File:** `backend/app/routers/admin_*.py` (all)  
**Description:** Every `_log_admin_action` call passes `None` for the `ip` parameter. Admin actions have no IP audit trail, making forensic investigation impossible after a compromise.

```python
# admin_payouts.py:134-140 (example)
db.add(
    _log_admin_action(
        current_admin.id,
        current_admin.email,
        "approve_payout",
        "payout",
        payout_id,
        {...},
        None,  # ← IP not captured
    )
)
```

**Impact:** No forensic trail for admin actions — cannot trace unauthorized admin activity.  
**Fix:** Extract `request.client.host` from the FastAPI `Request` object and pass it to `_log_admin_action`.

---

### 20. Weak Password Policy
**File:** `backend/app/schemas/__init__.py:9`  
**Description:** The minimum password length is 8 characters with no complexity requirements (no uppercase, digit, or special character requirement).

```python
password: str = Field(min_length=8)
```

**Impact:** Users choose weak passwords vulnerable to brute-force and dictionary attacks.  
**Fix:** Require minimum 10 characters, with at least one uppercase letter, one digit, and one special character. Consider integrating `zxcvbn` for strength estimation.

---

## LOW / Informational

### 21. Referral Stats Mislabel "clicks" as "signups"
**File:** `backend/app/routers/referral.py:72,73`  
**Description:** The referral stats endpoint returns `clicks=signups` — the variable name implies link clicks, but it counts successful referrals. This is a minor correctness issue, not a security vulnerability, but could mislead ops.

```python
# referral.py:72-73
signups = len(referrals)
pending_rewards = sum(1 for r in referrals if ...)
return ReferralStats(
    code=code,
    clicks=signups,  # ← misleading label
    ...
)
```

---

### 22. AppLovin SSV Not Implemented
**File:** `backend/app/routers/ads.py:598-611`  
**Description:** The AppLovin MAX SSV endpoint returns 501. While documented, this means AppLovin ad revenue is not being credited to users.

**Impact:** AppLovin ad units earn zero points for users; revenue loss.  
**Fix:** Implement the AppLovin postback handler per their SSV spec.

---

### 23. Store Frontend API Key in Environment, Not Bundle
**File:** `client/app.json:44-47`  
**Description:** AdMob App IDs (`ca-app-pub-3898064484524772~...`) are committed in `app.json`. These are public identifiers, not secrets, but they enable ad fraud targeting.

**Impact:** Low — AdMob app IDs are public by design, but committing them makes it easier for fraudsters to target your inventory.  
**Fix:** Move to environment variables loaded at build time; consider separate dev/prod app IDs.

---

### 24. No CSRF Tokens on State-Changing Endpoints
**File:** `backend/app/main.py`  
**Description:** No CSRF middleware is configured. While the mobile app is less vulnerable than a browser (no automatic cookie sending on cross-origin navigation), the admin cookie-based auth is CSRF-vulnerable if the admin panel is ever opened in a browser.

**Impact:** Admin CSRF if admin panel is browser-accessible.  
**Fix:** Add `python-multipart` CSRF middleware or require a custom header (`X-Requested-With`) for all admin mutations.

---

### 25. `AdminUserCreate` Allows Setting Role at Registration
**File:** `backend/app/schemas/__init__.py:804`  
**Description:** The admin creation schema accepts any role matching the pattern, including `super_admin`, without checking if the requesting admin has permission to create super admins.

```python
role: str = Field(default="support", pattern="^(super_admin|finance|moderator|support)$")
```

**Impact:** Privilege escalation if the admin creation endpoint is exposed without additional role checks.  
**Fix:** Validate that only existing super_admins can assign `super_admin` or `finance` roles.

---

### 26. Docker Compose Exposes MySQL Port to Host
**File:** `backend/docker-compose.yml:10`  
**Description:** MySQL port 3306 is published to the host machine (`"3306:3306"`). If the host firewall is misconfigured, the database is exposed to the network.

```yaml
ports:
  - "3306:3306"
```

**Impact:** Database directly accessible from outside the container network.  
**Fix:** Remove the `ports` mapping for production. Use Docker internal networking only; connect via `mysql` CLI from the API container if needed.

---

### 27. Webhook Replay Attack Window
**File:** `backend/app/routers/payouts.py:569-704`  
**Description:** The webhook handler checks `txn.status != "failed"` before reversing the debit, but does not verify the Paystack event `created_at` timestamp. A replayed event from weeks ago would still be honored.

**Impact:** If Paystack replays an old `transfer.failed` event, the debit is reversed again (though the idempotency check on `txn.status` would catch a second reversal if the status was already `failed`).  
**Fix:** Record `paystack_event_id` on the `PayoutTransaction` row and reject replays of already-seen event IDs. Verify `event.created_at` is within a reasonable window (e.g., 24 hours).

---

## Recommendations — Prioritized

| Priority | Action | Effort |
|----------|--------|--------|
| **P0** | Remove `dev_token` from forgot-password response | 5 min |
| **P0** | Remove `dev-secret-change-me` fallback from SECRET_KEY | 5 min |
| **P0** | Remove `dev-admin-token` fallback from ADMIN_TOKEN | 5 min |
| **P0** | Sanitize global exception handler (no `str(exc)` in prod) | 15 min |
| **P1** | Encrypt `PayoutAccount.account_number` at rest | 2-3 hours |
| **P1** | Fix password reset token expiry to fixed TTL | 10 min |
| **P1** | Enable PostgreSQL SSL verification | 30 min |
| **P1** | Add pessimistic locking (SELECT FOR UPDATE) to withdrawal and bills debit | 2 hours |
| **P1** | Move Gemini API key from URL to header | 15 min |
| **P1** | Capture admin IP in audit logs | 30 min |
| **P2** | Implement per-user rate limiting | 1 hour |
| **P2** | Replace in-memory StudySession with DB/Redis | 2 hours |
| **P2** | Fix community author_name PII exposure | 20 min |
| **P2** | Remove MySQL port exposure from docker-compose (prod) | 5 min |
| **P2** | Harden CORS with explicit methods/headers | 15 min |
| **P3** | Add request body size limits middleware | 30 min |
| **P3** | Enforce stronger password policy | 30 min |
| **P3** | Add CSRF protection to admin endpoints | 1 hour |
| **P3** | Validate admin role assignment permissions | 30 min |
| **P4** | Fix referral stats "clicks" mislabel | 10 min |
| **P4** | Move AdMob App IDs to env vars | 30 min |

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 5 |
| HIGH | 15 |
| MEDIUM | 7 |
| LOW | 5 |
| **Total** | **32** |

**Most urgent fixes:** Remove the `dev_token` leak in the password reset response and eliminate the hardcoded fallback secrets (`SECRET_KEY`, `ADMIN_TOKEN`). These two issues alone could lead to complete account takeover and full admin API compromise.

**Greatest financial risk:** Unencrypted NUBAN storage, withdrawal race conditions, and bills race conditions — these directly affect user funds and regulatory compliance.

**Easiest wins:** CORS tightening, moving API key from URL to header, fixing token expiry logic, and sanitizing the exception handler — all under 30 minutes of work each.
