"""Time each reader-mount API call against Render."""
import time
import urllib.request
import urllib.error

BASE = "https://pagepay-fff6.onrender.com/api/v1"
ENDPOINTS = [
    ("GET", "/auth/me", None),
    ("GET", "/config/ads?env=prod", None),
    ("GET", "/content/1", None),
    ("GET", "/progress/continue", None),
    ("POST", "/progress/start?work_id=1", None),
    ("POST", "/session/start", '{"content_id": 1}'),
]

# Need auth token — skip auth-required ones and measure the public ones
PUBLIC = [
    ("GET", "/config/ads?env=prod"),
    ("GET", "/content/1"),
]

print(f"Timing reader-mount API calls against Render (no auth):\n")
total = 0
for method, path in PUBLIC:
    url = BASE + path
    start = time.perf_counter()
    try:
        req = urllib.request.Request(url, method=method)
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
        elapsed = time.perf_counter() - start
        total += elapsed
        print(f"  {method:5} {path:35} {elapsed*1000:6.0f}ms  ({resp.status})")
    except urllib.error.HTTPError as e:
        elapsed = time.perf_counter() - start
        total += elapsed
        print(f"  {method:5} {path:35} {elapsed*1000:6.0f}ms  ({e.code})")

print(f"\n  Total for 2 calls: {total*1000:.0f}ms")
print(f"  Estimated total for 6 calls (assuming linear): {total*3*1000:.0f}ms")