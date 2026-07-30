"""Trace what /content/1 actually does."""
import time
import urllib.request
import json

BASE = "https://pagepay-fff6.onrender.com/api/v1"

# Time without auth (will fail auth but show how long the server takes)
url = BASE + "/content/1"
print(f"GET {url}")
start = time.perf_counter()
try:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read()
    elapsed = time.perf_counter() - start
    print(f"  Status: {resp.status}")
    print(f"  Time: {elapsed*1000:.0f}ms")
    print(f"  Body length: {len(body)} bytes")
    data = json.loads(body)
    print(f"  Title: {data.get('title', '?')[:60]}")
    print(f"  Body length: {len(data.get('body_text', ''))}")
except urllib.error.HTTPError as e:
    elapsed = time.perf_counter() - start
    print(f"  HTTP {e.code}: {elapsed*1000:.0f}ms")
    body = e.read()
    print(f"  Body: {body[:200]}")

# Time the feed endpoint
print(f"\nGET /content/feed/1")
start = time.perf_counter()
try:
    req = urllib.request.Request(BASE + "/content/feed/1")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read()
    elapsed = time.perf_counter() - start
    print(f"  Status: {resp.status}")
    print(f"  Time: {elapsed*1000:.0f}ms")
    print(f"  Body length: {len(body)} bytes")
except urllib.error.HTTPError as e:
    elapsed = time.perf_counter() - start
    print(f"  HTTP {e.code}: {elapsed*1000:.0f}ms")
    body = e.read()
    print(f"  Body: {body[:200]}")

# Time the works endpoint
print(f"\nGET /content/works/1")
start = time.perf_counter()
try:
    req = urllib.request.Request(BASE + "/content/works/1")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read()
    elapsed = time.perf_counter() - start
    print(f"  Status: {resp.status}")
    print(f"  Time: {elapsed*1000:.0f}ms")
    print(f"  Body length: {len(body)} bytes")
except urllib.error.HTTPError as e:
    elapsed = time.perf_counter() - start
    print(f"  HTTP {e.code}: {elapsed*1000:.0f}ms")
    body = e.read()
    print(f"  Body: {body[:200]}")