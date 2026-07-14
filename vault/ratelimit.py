"""Limitation de débit (Upstash Redis en prod, mémoire en local).

Variables :
  UPSTASH_REDIS_REST_URL
  UPSTASH_REDIS_REST_TOKEN
  RATE_LIMIT_REQUIRE_UPSTASH=1  (forcé automatiquement sur Vercel)
  RATE_LIMIT_ALLOW_MEMORY=1     (échapper temporairement sur Vercel — déconseillé)
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque
from functools import wraps

from django.http import JsonResponse


_lock = threading.Lock()
_buckets: dict[str, deque[float]] = defaultdict(deque)


def _is_vercel_runtime() -> bool:
    if os.getenv("VERCEL", "").strip() in ("1", "true", "yes"):
        return True
    return bool(
        os.getenv("VERCEL_ENV", "").strip()
        or os.getenv("VERCEL_URL", "").strip()
        or os.getenv("VERCEL_BRANCH_URL", "").strip()
    )


def require_upstash() -> bool:
    if os.getenv("RATE_LIMIT_ALLOW_MEMORY", "").strip().lower() in ("1", "true", "yes"):
        return False
    flagged = os.getenv("RATE_LIMIT_REQUIRE_UPSTASH", "").strip().lower() in ("1", "true", "yes")
    return flagged or _is_vercel_runtime()


def client_ip(request) -> str:
    """IP client. Sur Vercel : en-têtes de confiance ; ne pas prendre le 1er XFF (spoofable)."""
    for header in ("HTTP_X_REAL_IP", "HTTP_X_VERCEL_FORWARDED_FOR"):
        value = (request.META.get(header) or "").strip()
        if value:
            return value.split(",")[0].strip()

    forwarded = (request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
    if forwarded:
        parts = [part.strip() for part in forwarded.split(",") if part.strip()]
        if parts:
            # Derrière un proxy de confiance (Vercel), l'IP edge est à droite.
            if _is_vercel_runtime():
                return parts[-1]
            return parts[0]
    return request.META.get("REMOTE_ADDR") or "unknown"


def _prune(bucket: deque[float], window: float, now: float) -> None:
    while bucket and now - bucket[0] > window:
        bucket.popleft()


def _memory_limited(key: str, limit: int, window_seconds: float) -> bool:
    now = time.monotonic()
    with _lock:
        bucket = _buckets[key]
        _prune(bucket, window_seconds, now)
        if len(bucket) >= limit:
            return True
        bucket.append(now)
        return False


def _upstash_configured() -> bool:
    return bool(
        os.getenv("UPSTASH_REDIS_REST_URL", "").strip()
        and os.getenv("UPSTASH_REDIS_REST_TOKEN", "").strip()
    )


def _upstash_limited(key: str, limit: int, window_seconds: int) -> bool | None:
    """
    Incrément atomique + TTL via l'API REST Upstash.
    Retourne True/False si OK, None si erreur réseau / réponse invalide.
    """
    import json
    import urllib.error
    import urllib.request

    base = os.environ["UPSTASH_REDIS_REST_URL"].rstrip("/")
    token = os.environ["UPSTASH_REDIS_REST_TOKEN"]
    redis_key = f"rl:{key}"

    # INCR + EXPIRE NX : TTL fixé au 1er hit (fenêtre fixe), ignore si déjà une expiry.
    body = json.dumps(
        [
            ["INCR", redis_key],
            ["EXPIRE", redis_key, int(window_seconds), "NX"],
        ]
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/pipeline",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if not isinstance(payload, list) or not payload:
            return None
        first = payload[0]
        if not isinstance(first, dict) or first.get("error"):
            return None
        count = int(first.get("result") or 0)
        return count > limit
    except (urllib.error.URLError, TimeoutError, ValueError, TypeError, json.JSONDecodeError, IndexError, KeyError):
        return None


def is_rate_limited(key: str, limit: int, window_seconds: float) -> bool:
    must_upstash = require_upstash()
    if must_upstash and not _upstash_configured():
        # Prod mal configurée : refuser plutôt que d'ouvrir la vanne.
        return True

    if _upstash_configured():
        result = _upstash_limited(key, limit, int(window_seconds))
        if result is not None:
            return result
        # Upstash joignable au démarrage mais erreur réseau ponctuelle :
        # repli mémoire plutôt que de bloquer toutes les connexions.
        return _memory_limited(key, limit, window_seconds)

    return _memory_limited(key, limit, window_seconds)


def rate_limit(scope: str, *, limit: int, window_seconds: int = 60):
    """Décorateur : max `limit` requêtes / `window_seconds` par IP (+ scope)."""

    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            key = f"{scope}:{client_ip(request)}"
            if is_rate_limited(key, limit, float(window_seconds)):
                detail = "Trop de tentatives. Réessayez plus tard."
                if require_upstash() and not _upstash_configured():
                    detail = "Service temporairement indisponible (rate limit)."
                return JsonResponse({"detail": detail}, status=429)
            return view_func(request, *args, **kwargs)

        return wrapper

    return decorator
