import logging
import os
from base64 import b64encode, b64decode
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

from app.config import settings

logger = logging.getLogger("uvicorn.error")

# AES-256-GCM requires a 32-byte (256-bit) key.
_KEY_BYTES = 32


def _get_key() -> bytes:
    """Return the 32-byte AES key from settings.

    In development we fall back to a deterministic key derived from
    SECRET_KEY so that local tests don't need an extra env var.
    Production MUST set ENCRYPTION_KEY explicitly.
    """
    raw = settings.encryption_key
    if raw:
        return b64decode(raw)

    # Dev fallback: derive a 32-byte key from SECRET_KEY via SHA-256.
    # This is NOT secure for production — only for local development
    # where SECRET_KEY is already a strong random value.
    fallback = settings.secret_key.encode()
    if not fallback:
        raise RuntimeError("ENCRYPTION_KEY or SECRET_KEY must be set")
    import hashlib
    return hashlib.sha256(fallback).digest()


def encrypt(plaintext: str) -> str:
    """Encrypt a string with AES-256-GCM.

    Returns a base64-encoded blob containing: 12-byte nonce + ciphertext + 16-byte tag.
    """
    if not plaintext:
        return plaintext
    key = _get_key()
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    # Pack: nonce (12) + ciphertext+tag
    packed = nonce + ciphertext
    return b64encode(packed).decode("utf-8")


def decrypt(encoded: str) -> Optional[str]:
    """Decrypt a base64-encoded AES-256-GCM blob.

    Returns the original plaintext, or None if decryption fails.
    """
    if not encoded:
        return None
    try:
        key = _get_key()
        packed = b64decode(encoded)
        nonce = packed[:12]
        ciphertext = packed[12:]
        aesgcm = AESGCM(key)
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
        return plaintext.decode("utf-8")
    except (InvalidTag, Exception) as exc:
        logger.error("Decryption failed: %s", exc)
        return None
