"""Récupération légale des favicons publics (même principe qu'un navigateur)."""

from __future__ import annotations

import time
from urllib.parse import urljoin, urlparse

import httpx

from .favicon_constants import (
    CACHE_HIT_TTL_SECONDS,
    CACHE_MISS_TTL_SECONDS,
    MAX_CACHE_ENTRIES,
    MAX_CANDIDATES,
    TIMEOUT,
    USER_AGENT,
)
from .favicon_image import IconCandidate, _dedupe_candidates, _origin
from .favicon_ssrf import (
    _PinnedFetchSession,
    _fetch_url,
    _pinned_request_target,
    _resolve_global_ips,
    _safe_request_url,
    is_safe_hostname,
)

_cache: dict[str, tuple[float, tuple[bytes, str] | None]] = {}


def _cache_get(key: str) -> tuple[bool, tuple[bytes, str] | None]:
    """Retourne (trouvé, valeur). valeur peut être None (miss négatif encore valide)."""
    entry = _cache.get(key)
    if not entry:
        return False, None
    expires_at, value = entry
    if time.monotonic() > expires_at:
        _cache.pop(key, None)
        return False, None
    return True, value


def _cache_put(key: str, value: tuple[bytes, str] | None) -> None:
    ttl = CACHE_HIT_TTL_SECONDS if value is not None else CACHE_MISS_TTL_SECONDS
    _cache[key] = (time.monotonic() + ttl, value)
    if len(_cache) > MAX_CACHE_ENTRIES:
        oldest = min(_cache, key=lambda k: _cache[k][0])
        _cache.pop(oldest, None)


def normalize_page_url(url: str) -> str | None:
    value = (url or "").strip()
    if not value:
        return None
    if not value.startswith(("http://", "https://")):
        value = f"https://{value}"
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    if not is_safe_hostname(parsed.hostname):
        return None
    return value

def _cache_key(page_url: str) -> str:
    hostname = urlparse(page_url).hostname or page_url
    return hostname.lower().removeprefix("www.")


def _build_fallback_candidates(page_url: str) -> list[IconCandidate]:
    """Candidats rapides d’abord (CDN), puis favicon d’origine — pas de scrape HTML."""
    domain = _cache_key(page_url)
    return _dedupe_candidates([
        IconCandidate(
            f"https://www.google.com/s2/favicons?domain={domain}&sz=128",
            100,
        ),
        IconCandidate(
            f"https://icons.duckduckgo.com/ip3/{domain}.ico",
            80,
        ),
        IconCandidate(urljoin(_origin(page_url), "/favicon.ico"), 40),
    ])


def fetch_site_favicon(page_url: str) -> tuple[bytes, str] | None:
    normalized = normalize_page_url(page_url)
    if not normalized:
        return None

    cache_key = _cache_key(normalized)
    hit, cached = _cache_get(cache_key)
    if hit:
        return cached

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "image/*,*/*;q=0.8",
    }
    # Fast path : CDN puis /favicon.ico — pas de scrape HTML (trop lent).
    # Les CDN sont appelés uniquement côté serveur (proxy) — pas depuis le navigateur.
    candidates = _build_fallback_candidates(normalized)[:MAX_CANDIDATES]
    session = _PinnedFetchSession(headers)
    plain_client = httpx.Client(timeout=TIMEOUT, follow_redirects=False, headers=headers)
    try:
        for candidate in candidates:
            result = _fetch_url(session, candidate.url, plain_client=plain_client)
            if result:
                _cache_put(cache_key, result)
                return result
    except httpx.HTTPError:
        pass
    finally:
        plain_client.close()
        session.close()

    _cache_put(cache_key, None)
    return None
