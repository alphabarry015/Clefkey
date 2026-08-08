"""Favicon fetch — constantes partagées."""

from __future__ import annotations

import httpx

USER_AGENT = "Clefkey/1.0 (+favicon; usage personnel)"
TIMEOUT = httpx.Timeout(2.5, connect=1.2)
MAX_ICON_BYTES = 128_000
MAX_HTML_BYTES = 64_000
MAX_CANDIDATES = 4
MAX_REDIRECTS = 2
MAX_CACHE_ENTRIES = 256
CACHE_HIT_TTL_SECONDS = 6 * 3600
CACHE_MISS_TTL_SECONDS = 90

_dns_cache: dict[str, tuple[float, list[str] | None]] = {}
_DNS_TTL_SECONDS = 60.0
