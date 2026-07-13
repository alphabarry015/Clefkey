"""Limitation de débit simple (fenêtre glissante en mémoire).

Sur Vercel (multi-instances), la limite est par instance — utile contre les abus
basiques, pas un WAF global.
"""

from __future__ import annotations

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


def is_rate_limited(key: str, limit: int, window_seconds: float) -> bool:
    now = time.monotonic()
    with _lock:
        bucket = _buckets[key]
        _prune(bucket, window_seconds, now)
        if len(bucket) >= limit:
            return True
        bucket.append(now)
        return False


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
