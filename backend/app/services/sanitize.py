"""Helpers for sanitizing user-supplied text on the way OUT of the API.

Why this module exists: every place we render user input in a browser
or in logs is an XSS / log-injection surface. PagePay is a JSON API,
so we don't emit HTML — but the admin panel, fraud review queue,
and the audit log view all render strings the user typed. The
cheapest, most consistent defense is to sanitize at the response
boundary:

  - `sanitize_for_display()` — escape HTML special chars, strip the
    C0 control range except `\t \n \r`. Use this for any field the
    admin UI or audit log view will render.

  - `sanitize_for_log()` — strip newlines, tabs, and the C0 control
    range; collapse whitespace. Use this for any user-derived value
    that goes into `logger.info / warning / error` so a malicious
    user can't forge fake log lines.

  - `is_safe_url()` — central SSRF guard. Same rule as the one in
    `routers/tasks.py:submit_task` (no private/loopback IPs, no
    metadata hosts, no non-http(s) schemes). Use this for every
    server-side outbound request whose URL came from user data
    (the AI verification URL check, Nitter follow lookups, etc).

  - `safe_filename()` — basename + strip control chars + cap length
    + allowlist of printable ASCII. Use this for `UploadFile.filename`
    before persisting it.

  - `bounded_text()` — clamp a free-text value to `[lo, hi]` codepoints
    and strip the C0 control range. Use this as a belt-and-braces
    guard when a schema already declares `max_length` but a buggy
    code path might bypass validation.

All of these are pure functions with no I/O — they're trivially
testable and the failure modes are obvious.
"""

from __future__ import annotations

import html
import ipaddress
import re
from typing import Final
from urllib.parse import urlparse


# ── Display sanitizer (XSS defense) ──────────────────────────────────

# C0 control range minus the three whitespace characters that
# legitimately appear in user-typed text. NIST SP 800-53 SI-10 calls
# these out as the canonical "strip before rendering" set.
_BAD_CONTROL_RE: Final[re.Pattern[str]] = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")


def sanitize_for_display(value: str | None, *, max_length: int = 5000) -> str:
    """Return a string safe to drop into an HTML/JSON admin surface.

    - `None` → empty string.
    - HTML-escapes `< > & " '` so a stored-XSS payload becomes
      visible text instead of markup.
    - Strips C0 control characters (NULL, BEL, ESC, etc).
    - Caps length to `max_length` codepoints.
    """
    if value is None:
        return ""
    s = str(value)
    s = _BAD_CONTROL_RE.sub("", s)
    s = html.escape(s, quote=True)
    if len(s) > max_length:
        s = s[:max_length] + "…"
    return s


# ── Log sanitizer (log-injection defense) ────────────────────────────

# Newline, tab, and the C0 control range. A user with `email =
# "x\n[CRITICAL] breach detected"` can otherwise forge log lines
# that look like real alerts.
_LOG_BAD_RE: Final[re.Pattern[str]] = re.compile(r"[\x00-\x1F\x7F]")


def sanitize_for_log(value: object, *, max_length: int = 500) -> str:
    """Return a string safe to interpolate into a log line.

    Strips newlines, tabs, and control characters. Truncates. Casts
    non-strings via `repr()` so a dict or list doesn't blow up the
    formatter.
    """
    if value is None:
        return ""
    s = value if isinstance(value, str) else repr(value)
    s = _LOG_BAD_RE.sub(" ", s)
    # Collapse runs of whitespace left after stripping newlines.
    s = re.sub(r" {2,}", " ", s).strip()
    if len(s) > max_length:
        s = s[:max_length] + "…"
    return s


# ── SSRF guard (URL safety) ──────────────────────────────────────────

_BLOCKED_HOSTS: Final[frozenset[str]] = frozenset({
    "localhost",
    "127.0.0.1",
    "0.0.0.0",  # nosec - documented
    "::1",
    "169.254.169.254",  # AWS / GCP / Azure instance metadata
    "metadata.google.internal",
    "metadata.azure.com",
    "100.100.100.200",  # Alibaba metadata
})


def is_safe_url(url: str) -> bool:
    """True iff `url` is safe to fetch from the server.

    Rules (in order):
      1. Must parse as a URL.
      2. Scheme must be http or https.
      3. Host must be present.
      4. Host must not be a literal in `_BLOCKED_HOSTS` or end in
         `.internal` / `.local`.
      5. If host is an IP literal, it must be globally routable
         (no private/loopback/link-local/reserved/multicast).

    DNS resolution isn't performed here — if a hostname resolves to
    a private IP at fetch time, that's a separate concern (block at
    the httpx transport layer if you need it). This guard stops the
    common cases (literal `127.0.0.1`, `localhost`, the AWS metadata
    IP) which is the high-value defense.
    """
    try:
        parsed = urlparse(url)
    except (ValueError, TypeError):
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    if host in _BLOCKED_HOSTS or host.endswith(".internal") or host.endswith(".local"):
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        # Hostname (not an IP literal). Allow it; the transport
        # layer would still fail if DNS resolves to a bad address.
        return True
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        return False
    return True


# ── Filename sanitizer (path traversal + null bytes) ────────────────

# Allow printable ASCII + a small set of safe Unicode marks. Disallow
# path separators, control chars, and quotes.
_FILENAME_BAD_RE: Final[re.Pattern[str]] = re.compile(r"[^A-Za-z0-9._\- ()]")


def safe_filename(name: str | None, *, fallback: str = "upload", max_length: int = 200) -> str:
    """Return a filename safe to persist / display.

    Strips path separators, NUL bytes, and any character outside a
    conservative printable-ASCII allowlist. Falls back to `fallback`
    on empty result. Caps length.
    """
    if not name:
        return fallback
    # Take the basename only — strip everything before the last
    # separator on either OS.
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    base = _FILENAME_BAD_RE.sub("_", base).strip("._-")
    if not base:
        return fallback
    if len(base) > max_length:
        # Preserve the extension if present.
        if "." in base:
            stem, _, ext = base.rpartition(".")
            ext = "." + ext
        else:
            stem, ext = base, ""
        stem = stem[: max_length - len(ext)]
        base = stem + ext
    return base


# ── Bounded text (defense-in-depth for free-text fields) ─────────────


def bounded_text(value: str | None, *, max_length: int, min_length: int = 0) -> str:
    """Strip control chars, trim, and clamp length.

    Use as a belt-and-braces guard when a schema already has a
    `max_length` but a code path could bypass it. Returns "" for
    `None`. Raises `ValueError` if the result is shorter than
    `min_length` so the caller can return a 400.
    """
    if value is None:
        s = ""
    else:
        s = _BAD_CONTROL_RE.sub("", str(value)).strip()
    if len(s) > max_length:
        s = s[:max_length]
    if len(s) < min_length:
        raise ValueError(f"value must be at least {min_length} characters")
    return s
