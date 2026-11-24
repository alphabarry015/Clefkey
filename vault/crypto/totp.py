"""TOTP (RFC 6238) et scellement du secret. Le secret n'ouvre pas le coffre."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
from urllib.parse import quote

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings

TOTP_DIGITS = 6
TOTP_PERIOD = 30
TOTP_SECRET_BYTES = 20
BACKUP_CODE_COUNT = 8
_BACKUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _aead_key() -> bytes:
    return hashlib.sha256(settings.SECRET_KEY.encode("utf-8") + b"clefkey-totp-v1").digest()


def seal_secret(secret: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + AESGCM(_aead_key()).encrypt(nonce, secret, b"totp")


def open_secret(blob: bytes) -> bytes:
    if len(blob) < 13:
        raise ValueError("secret TOTP illisible")
    nonce, ciphertext = blob[:12], blob[12:]
    return AESGCM(_aead_key()).decrypt(nonce, ciphertext, b"totp")


def generate_secret() -> bytes:
    return os.urandom(TOTP_SECRET_BYTES)


def encode_secret(secret: bytes) -> str:
    return base64.b32encode(secret).decode("ascii").rstrip("=")


def format_secret(secret_b32: str) -> str:
    return " ".join(secret_b32[i:i + 4] for i in range(0, len(secret_b32), 4))


def otpauth_uri(secret_b32: str, email: str) -> str:
    label = quote(f"Clefkey:{email}", safe="")
    return (
        f"otpauth://totp/{label}"
        f"?secret={secret_b32}&issuer={quote('Clefkey', safe='')}"
        f"&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_PERIOD}"
    )


def totp_at(secret: bytes, step: int) -> str:
    digest = hmac.new(secret, step.to_bytes(8, "big"), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = int.from_bytes(digest[offset:offset + 4], "big") & 0x7FFFFFFF
    return f"{binary % (10 ** TOTP_DIGITS):0{TOTP_DIGITS}d}"


def match_totp(secret: bytes, code: str, *, now: float | None = None, window: int = 1) -> int | None:
    cleaned = "".join(ch for ch in (code or "") if ch.isdigit())
    if len(cleaned) != TOTP_DIGITS:
        return None
    current = int((time.time() if now is None else now) // TOTP_PERIOD)
    for drift in range(-window, window + 1):
        step = current + drift
        if step < 0:
            continue
        if hmac.compare_digest(totp_at(secret, step), cleaned):
            return step
    return None


def generate_backup_codes() -> list[str]:
    codes: list[str] = []
    while len(codes) < BACKUP_CODE_COUNT:
        raw = "".join(_BACKUP_ALPHABET[b % len(_BACKUP_ALPHABET)] for b in os.urandom(10))
        pretty = f"{raw[:5]}-{raw[5:]}"
        if pretty not in codes:
            codes.append(pretty)
    return codes


def normalize_backup_code(code: str) -> str:
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


def hash_backup_code(code: str) -> bytes:
    normalized = normalize_backup_code(code)
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        b"clefkey-totp-backup:" + normalized.encode("ascii"),
        hashlib.sha256,
    ).digest()
