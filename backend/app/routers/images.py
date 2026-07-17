"""Image proxy + disk cache for the v3 reader.

Per v3 §2.3 the cheap-and-correct path is to hot-link OpenStax
directly (zero infra). The proxy + disk cache is the v2 fallback —
it kicks in when an upstream URL breaks, when we need to rewrite
image paths to a single CDN, or when OpenStax reorganizes their
storage. We ship it now so the rollback path exists.

Endpoint:
  GET /api/v1/content/images/proxy?url=<url-encoded>

The `url` is the full upstream URL. We hash it (SHA1) and store
the response in `settings.image_cache_dir/<hash[:2]>/<hash>`. On
subsequent requests we serve from disk without re-fetching.

Public, not auth-gated. Cached images are static content; the
client already has the URL (it's in the slice body) and the
content is the same for every user. Putting auth on it would
break the React Native Image cache and force every client to
re-fetch through our auth, which is pointless.

Why no rate limit: the response is a 30-day cached file. An
attacker who hammers the proxy gets the same file from disk,
which is cheap. The cost of an honest cache miss is bounded by
`image_proxy_max_bytes` (5MB) and a 10s upstream timeout.
"""

import hashlib
import logging
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.config import settings

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/content/images", tags=["content"])


# Cache dir is created lazily on first call (and in the lifespan
# handler in main.py). Lazy creation here makes the test path
# easy — no fixtures needed.
def _cache_dir() -> Path:
    d = Path(settings.image_cache_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _cache_path(url: str) -> Path:
    """Map a URL to a 2-level cache path.

    SHA1 of the URL is the filename. The first 2 hex chars split
    into a subdirectory to keep any one dir under ~65k entries.
    Two levels is the sweet spot for ext4 — more levels helps
    nothing and means more inodes spent on empty dirs.
    """
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return _cache_dir() / h[:2] / h


# Host allowlist. We only proxy whitelisted hosts; anything else
# is rejected with 400 to keep this endpoint from being a generic
# open proxy. The list is small and explicit — adding to it is a
# code change on purpose.
ALLOWED_HOSTS: frozenset[str] = frozenset(
    {
        "openstax.org",
        "www.openstax.org",
        "cnx.org",
        "www.cnx.org",
        "archive.cnx.org",
        "flickr.com",
        "live.staticflickr.com",
        "upload.wikimedia.org",
    }
)


@router.get("/proxy")
async def proxy_image(url: str = Query(..., max_length=2000)):
    """Serve an image from cache or fetch + cache it.

    Query:
      url: full upstream URL (must be http(s) and on ALLOWED_HOSTS)

    Returns:
      200 with the image bytes and a 30-day Cache-Control.
      400 if the URL is missing/malformed/host not allowed.
      502 if the upstream fails (timeout, 4xx, 5xx, oversize).
      404 only if the file disappears from disk between the
        existence check and the open (rare race).
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="URL must be http(s)")
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="URL has no host")
    # netloc is host[:port] — compare host only
    if parsed.hostname is None or parsed.hostname.lower() not in ALLOWED_HOSTS:
        raise HTTPException(
            status_code=400, detail=f"Host {parsed.hostname!r} is not on the allowlist"
        )

    path = _cache_path(url)
    # Cache hit: stream from disk.
    if path.exists():
        return FileResponse(
            path,
            headers={"Cache-Control": f"public, max-age={settings.image_proxy_cache_ttl_seconds}"},
            # Don't sniff on every request — extension is enough for
            # expo-image to render. If the file has no extension, the
            # client falls back to image/* which works for everything.
        )

    # Cache miss: fetch upstream, stream to disk, then serve.
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".part")
    headers: dict[str, str] = {
        # OpenStax is a non-profit and serves academic images for
        # free; they sometimes reject requests without a UA. Most
        # CDNs also flag requests that look like abuse (no UA).
        "User-Agent": "PagePay/1.0 (+https://pagepay.ng)"
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            async with client.stream("GET", url, headers=headers, follow_redirects=True) as upstream:
                if upstream.status_code != 200:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Upstream returned {upstream.status_code}",
                    )
                content_type = upstream.headers.get("content-type", "application/octet-stream")
                total = 0
                with tmp_path.open("wb") as f:
                    async for chunk in upstream.aiter_bytes(chunk_size=64 * 1024):
                        total += len(chunk)
                        if total > settings.image_proxy_max_bytes:
                            f.close()
                            tmp_path.unlink(missing_ok=True)
                            raise HTTPException(
                                status_code=502,
                                detail=f"Upstream exceeded {settings.image_proxy_max_bytes} bytes",
                            )
                        f.write(chunk)
    except httpx.HTTPError as e:
        tmp_path.unlink(missing_ok=True)
        logger.warning("image proxy fetch failed: %s", e)
        raise HTTPException(status_code=502, detail="Upstream fetch failed") from e

    # Atomic rename so a concurrent request that arrived while we
    # were fetching never sees a half-written file. POSIX rename
    # within a single filesystem is atomic.
    tmp_path.replace(path)

    logger.info("image proxy cached: %s -> %s (%d bytes)", url, path, total)
    return FileResponse(
        path,
        media_type=content_type,
        headers={"Cache-Control": f"public, max-age={settings.image_proxy_cache_ttl_seconds}"},
    )
