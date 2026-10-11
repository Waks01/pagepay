"""Cloudflare R2 storage for narrated study audio.

Audio is written here instead of to disk. Render's filesystem is
ephemeral — the free plan has no persistent disk, and instances spin
down — so anything stored in `/tmp` is lost on restart or redeploy.
That would silently break audio a user has already paid for, so the
generated file must live in object storage that outlives the process.

R2 is S3-compatible, so boto3 is used with a custom endpoint.

Reads
-----
`audio_url_for()` returns a short-lived presigned GET URL by default,
which works with a private bucket and avoids handing out a durable
public link. The URL is regenerated whenever the client reads an
episode, so an expired link is never a problem. If
`cloudflare_r2_public_url` is
configured the bucket is treated as public and a stable CDN URL is
returned instead.

If R2 is not configured, uploads raise and the caller fails the batch
and refunds. There is no silent fallback to disk.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class R2NotConfigured(RuntimeError):
    """R2 credentials or bucket are missing."""


def is_configured() -> bool:
    """True when enough configuration exists to talk to R2.

    Uses the Cloudflare S3 credentials already configured for Workers
    AI — no separate access keys.
    """
    from app.config import settings

    return bool(
        settings.cloudflare_access_key
        and settings.cloudflare_secret_access_key
        and settings.cloudflare_s3_api_endpoint
        and settings.cloudflare_r2_bucket
    )


def _client():
    """Build an S3 client pointed at the Cloudflare R2 endpoint."""
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:  # pragma: no cover - dependency missing
        raise R2NotConfigured(
            "boto3 is not installed; cannot use Cloudflare R2 storage."
        ) from exc

    from app.config import settings

    if not is_configured():
        raise R2NotConfigured(
            "Cloudflare R2 is not configured. Set CLOUDFLARE_ACCESS_KEY, "
            "CLOUDFLARE_SECRET_ACCESS_KEY and CLOUDFLARE_S3_API_ENDPOINT."
        )

    return boto3.client(
        "s3",
        endpoint_url=settings.cloudflare_s3_api_endpoint,
        aws_access_key_id=settings.cloudflare_access_key,
        aws_secret_access_key=settings.cloudflare_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def object_key(filename: str) -> str:
    """Object key for a generated audio file, under the configured prefix."""
    from app.config import settings

    prefix = (settings.cloudflare_r2_prefix or "study-audio").strip("/")
    # Filenames come from the TTS cache and are content hashes, but
    # normalise anyway so a key can never escape the prefix.
    safe = filename.replace("\\", "/").split("/")[-1]
    return f"{prefix}/{safe}" if prefix else safe


def upload_bytes(key: str, data: bytes, content_type: str = "audio/mpeg") -> str:
    """Upload audio and return the object key.

    Raises `R2NotConfigured` when R2 is unavailable, so the caller can
    fail the generation and refund rather than store audio that will
    vanish.
    """
    if not data:
        raise R2NotConfigured("Refusing to upload empty audio.")

    client = _client()
    from app.config import settings

    client.put_object(
        Bucket=settings.cloudflare_r2_bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl="public, max-age=31536000, immutable",
    )
    logger.info("R2 upload ok: key=%s bytes=%d", key, len(data))
    return key


def audio_url_for(key: str) -> str | None:
    """A URL the client can stream this object from.

    Returns a presigned GET URL for a private bucket, or the public CDN
    URL when `cloudflare_r2_public_url` is set. Returns None if R2 is
    not configured so callers can omit the URL rather than serve a
    broken one.
    """
    if not key:
        return None

    from app.config import settings

    base = (settings.cloudflare_r2_public_url or "").rstrip("/")
    if base:
        return f"{base}/{key}"

    try:
        client = _client()
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.cloudflare_r2_bucket, "Key": key},
            ExpiresIn=settings.cloudflare_r2_presign_expiry_seconds,
        )
    except R2NotConfigured:
        return None
    except Exception as exc:
        logger.warning("R2 presign failed for key=%s: %s", key, exc)
        return None


def delete(key: str) -> bool:
    """Best-effort delete; a failed cleanup must not fail a refund."""
    if not key:
        return False
    try:
        client = _client()
        from app.config import settings

        client.delete_object(Bucket=settings.cloudflare_r2_bucket, Key=key)
        return True
    except Exception as exc:
        logger.warning("R2 delete failed for key=%s: %s", key, exc)
        return False
