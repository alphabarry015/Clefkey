"""Limitation de débit (mémoire locale, ou Upstash Redis si configuré).

Variables optionnelles :
  UPSTASH_REDIS_REST_URL
  UPSTASH_REDIS_REST_TOKEN

Sans Upstash : fenêtre glissante en mémoire (par instance Vercel).
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


def client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
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
    return bool(os.getenv("UPSTASH_REDIS_REST_URL", "").strip() and os.getenv("UPSTASH_REDIS_REST_TOKEN", "").strip())


def _upstash_limited(key: str, limit: int, window_seconds: int) -> bool:
    """Incrément atomique + TTL via l'API REST Upstash. Fail-open mémoire si erreur."""
    import json
    import urllib.error
    import urllib.request

    base = os.environ["UPSTASH_REDIS_REST_URL"].rstrip("/")
    token = os.environ["UPSTASH_REDIS_REST_TOKEN"]
    redis_key = f"rl:{key}"

    body = json.dumps([["INCR", redis_key]]).encode("utf-8")
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
            return _memory_limited(key, limit, float(window_seconds))
        count = int(payload[0].get("result") or 0)
        if count == 1:
            expire_body = json.dumps([["EXPIRE", redis_key, int(window_seconds)]]).encode("utf-8")
            expire_req = urllib.request.Request(
                f"{base}/pipeline",
                data=expire_body,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            urllib.request.urlopen(expire_req, timeout=2.0).read()
        return count > limit
    except (urllib.error.URLError, TimeoutError, ValueError, TypeError, json.JSONDecodeError, IndexError):
        return _memory_limited(key, limit, float(window_seconds))


def is_rate_limited(key: str, limit: int, window_seconds: float) -> bool:
    if _upstash_configured():
        return _upstash_limited(key, limit, int(window_seconds))
    return _memory_limited(key, limit, window_seconds)


def rate_limit(scope: str, *, limit: int, window_seconds: int = 60):
    """Décorateur : max `limit` requêtes / `window_seconds` par IP (+ scope)."""

    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            key = f"{scope}:{client_ip(request)}"
            if is_rate_limited(key, limit, float(window_seconds)):
                return JsonResponse(
                    {"detail": "Trop de tentatives. Réessayez plus tard."},
                    status=429,
                )
            return view_func(request, *args, **kwargs)

        return wrapper

    return decorator
