"""Récupération légale des favicons publics (même principe qu'un navigateur)."""

from __future__ import annotations

import ipaddress
import re
import socket
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpcore
import httpx
from httpcore._backends.sync import SyncBackend
from httpx._config import DEFAULT_LIMITS, create_ssl_context


USER_AGENT = "Clefkey/1.0 (+favicon; usage personnel)"
# Timeouts courts : un favicon lent ne doit pas bloquer le dashboard.
TIMEOUT = httpx.Timeout(2.5, connect=1.2)
MAX_ICON_BYTES = 128_000
MAX_HTML_BYTES = 64_000
MAX_CANDIDATES = 4
MAX_REDIRECTS = 2
# Cache en mémoire borné (processus serverless / long-running).
MAX_CACHE_ENTRIES = 256
# Succès : garder longtemps (même instance). Échecs : TTL court pour réessayer.
CACHE_HIT_TTL_SECONDS = 6 * 3600
CACHE_MISS_TTL_SECONDS = 90

_cache: dict[str, tuple[float, tuple[bytes, str] | None]] = {}
# Résolution DNS mémorisée brièvement (évite getaddrinfo × N candidats).
_dns_cache: dict[str, tuple[float, list[str] | None]] = {}
_DNS_TTL_SECONDS = 60.0


def _cache_get(key: str) -> tuple[bool, tuple[bytes, str] | None]:
    """Retourne (trouvé, valeur). valeur peut être None (miss négatif encore valide)."""
    entry = _cache.get(key)
    if entry is None:
        return False, None
    expires_at, value = entry
    if time.monotonic() >= expires_at:
        _cache.pop(key, None)
        return False, None
    return True, value


def _cache_put(key: str, value: tuple[bytes, str] | None) -> None:
    ttl = CACHE_HIT_TTL_SECONDS if value is not None else CACHE_MISS_TTL_SECONDS
    expires_at = time.monotonic() + ttl
    if key in _cache:
        _cache.pop(key, None)
    elif len(_cache) >= MAX_CACHE_ENTRIES:
        _cache.pop(next(iter(_cache)), None)
    _cache[key] = (expires_at, value)


@dataclass
class IconCandidate:
    url: str
    score: int


class _IconLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.icons: list[IconCandidate] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "link":
            return
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        rel = attr_map.get("rel", "").lower()
        href = attr_map.get("href", "").strip()
        if not href:
            return

        sizes = _parse_sizes(attr_map.get("sizes", ""))
        href_lower = href.lower()

        if "apple-touch-icon" in rel:
            score = 120 + sizes
        elif "icon" in rel or "shortcut icon" in rel:
            if href_lower.endswith(".svg"):
                score = 90 + sizes
            elif href_lower.endswith(".png"):
                score = 80 + sizes
            else:
                score = 50 + sizes
        else:
            return

        self.icons.append(IconCandidate(href, score))


def _parse_sizes(value: str) -> int:
    max_dim = 0
    for part in (value or "").split():
        match = re.match(r"(\d+)x(\d+)", part)
        if match:
            max_dim = max(max_dim, int(match.group(1)), int(match.group(2)))
    return max_dim


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


def is_safe_hostname(hostname: str) -> bool:
    return _resolve_global_ips(hostname) is not None


def _resolve_global_ips(hostname: str) -> list[str] | None:
    """Résout un hôte et ne retient que les IP globales (anti-SSRF / rebinding)."""
    host = hostname.strip().lower().rstrip(".")
    if not host or host == "localhost" or host.endswith(".local"):
        return None
    if host in {"0.0.0.0", "::1", "[::1]"}:
        return None

    now = time.monotonic()
    cached = _dns_cache.get(host)
    if cached is not None:
        expires_at, ips = cached
        if now < expires_at:
            return ips

    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        _dns_cache[host] = (now + _DNS_TTL_SECONDS, None)
        return None

    ips: list[str] = []
    seen: set[str] = set()
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            continue
        text = ip.compressed if ip.version == 6 else str(ip)
        if text in seen:
            continue
        seen.add(text)
        ips.append(text)
    result = ips or None
    if len(_dns_cache) > 512:
        _dns_cache.clear()
    _dns_cache[host] = (now + _DNS_TTL_SECONDS, result)
    return result


def _pinned_request_target(url: str, ip: str) -> tuple[str, dict[str, str]]:
    """Conserve l’URL hostname (TLS/SNI) et expose l’IP à épingler côté transport."""
    parsed = urlparse(url)
    if not parsed.hostname:
        raise ValueError("hostname requis")
    host_header = parsed.netloc
    return url, {"Host": host_header, "X-Clefkey-Pinned-IP": ip}


class _PinIPBackend(httpcore.NetworkBackend):
    """Connecte le TCP à une IP fixe ; le hostname reste pour SNI / vérif certificat."""

    def __init__(self, pinned_ip: str) -> None:
        self._pinned_ip = pinned_ip
        self._inner = SyncBackend()

    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options=None,
    ):
        return self._inner.connect_tcp(
            self._pinned_ip,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    def connect_unix_socket(self, path: str, timeout: float | None = None, socket_options=None):
        return self._inner.connect_unix_socket(
            path, timeout=timeout, socket_options=socket_options
        )

    def sleep(self, seconds: float) -> None:
        self._inner.sleep(seconds)


class _PinnedIPTransport(httpx.HTTPTransport):
    """Transport httpx qui force la connexion TCP vers une IP déjà validée."""

    def __init__(self, pinned_ip: str, **kwargs) -> None:
        verify = kwargs.pop("verify", True)
        cert = kwargs.pop("cert", None)
        trust_env = kwargs.pop("trust_env", True)
        http1 = kwargs.pop("http1", True)
        http2 = kwargs.pop("http2", False)
        limits = kwargs.pop("limits", DEFAULT_LIMITS)
        retries = kwargs.pop("retries", 0)
        socket_options = kwargs.pop("socket_options", None)
        ssl_context = create_ssl_context(verify=verify, cert=cert, trust_env=trust_env)
        # Ne pas appeler super().__init__ : on injecte network_backend.
        self._pool = httpcore.ConnectionPool(
            ssl_context=ssl_context,
            max_connections=limits.max_connections,
            max_keepalive_connections=limits.max_keepalive_connections,
            keepalive_expiry=limits.keepalive_expiry,
            http1=http1,
            http2=http2,
            retries=retries,
            socket_options=socket_options,
            network_backend=_PinIPBackend(pinned_ip),
        )


class _PinnedFetchSession:
    """Réutilise client/transport tant que l’IP épinglée ne change pas."""

    def __init__(self, headers: dict[str, str]) -> None:
        self._headers = headers
        self._ip: str | None = None
        self._transport: _PinnedIPTransport | None = None
        self._client: httpx.Client | None = None

    def client_for(self, ip: str) -> httpx.Client:
        if self._client is not None and self._ip == ip:
            return self._client
        self.close()
        self._ip = ip
        self._transport = _PinnedIPTransport(ip)
        self._client = httpx.Client(
            timeout=TIMEOUT,
            follow_redirects=False,
            headers=self._headers,
            transport=self._transport,
        )
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
        if self._transport is not None:
            self._transport.close()
            self._transport = None
        self._ip = None



def _origin(page_url: str) -> str:
    parsed = urlparse(page_url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _discover_icon_candidates(page_url: str, html: str) -> list[IconCandidate]:
    parser = _IconLinkParser()
    parser.feed(html)
    candidates = [
        IconCandidate(urljoin(page_url, icon.url), icon.score)
        for icon in parser.icons
    ]
    candidates.append(IconCandidate(urljoin(_origin(page_url), "/favicon.ico"), 20))
    return _dedupe_candidates(candidates)


def _dedupe_candidates(candidates: list[IconCandidate]) -> list[IconCandidate]:
    seen: set[str] = set()
    unique: list[IconCandidate] = []
    for candidate in sorted(candidates, key=lambda item: item.score, reverse=True):
        if candidate.url in seen:
            continue
        seen.add(candidate.url)
        unique.append(candidate)
    return unique


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


def _is_image_response(content_type: str, content: bytes) -> bool:
    if not content:
        return False
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct.startswith("image/"):
        return True
    if ct in {"application/octet-stream", "image/x-icon", "image/vnd.microsoft.icon"}:
        return True
    return content[:4] in {b"\x89PNG", b"GIF8", b"RIFF"} or content[:2] == b"\xff\xd8"


def _jpeg_dimensions(data: bytes) -> tuple[int, int]:
    index = 2
    while index < len(data) - 9:
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC9, 0xCA, 0xCB}:
            height = int.from_bytes(data[index + 5 : index + 7], "big")
            width = int.from_bytes(data[index + 7 : index + 9], "big")
            return width, height
        if marker in {0xD8, 0x01}:
            index += 2
            continue
        if index + 3 >= len(data):
            break
        length = int.from_bytes(data[index + 2 : index + 4], "big")
        index += 2 + length
    return 0, 0


def _webp_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 30 or data[8:12] != b"WEBP":
        return 0, 0
    chunk = data[12:16]
    if chunk == b"VP8 " and len(data) >= 30:
        width = int.from_bytes(data[26:28], "little") & 0x3FFF
        height = int.from_bytes(data[28:30], "little") & 0x3FFF
        return width, height
    if chunk == b"VP8L" and len(data) >= 25:
        bits = int.from_bytes(data[21:25], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
        return width, height
    return 0, 0


def _ico_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 6 or data[:4] != b"\x00\x00\x01\x00":
        return 0, 0
    count = int.from_bytes(data[4:6], "little")
    best_pixels = 0
    best_size = (0, 0)
    offset = 6
    for _ in range(count):
        if offset + 16 > len(data):
            break
        width = data[offset] or 256
        height = data[offset + 1] or 256
        pixels = width * height
        if pixels > best_pixels:
            best_pixels = pixels
            best_size = (width, height)
        offset += 16
    return best_size


def _image_dimensions(content: bytes) -> tuple[int, int]:
    if len(content) < 10:
        return 0, 0
    if content[:8] == b"\x89PNG\r\n\x1a\n" and len(content) >= 24:
        width = int.from_bytes(content[16:20], "big")
        height = int.from_bytes(content[20:24], "big")
        return width, height
    if content[:6] in (b"GIF87a", b"GIF89a"):
        width = int.from_bytes(content[6:8], "little")
        height = int.from_bytes(content[8:10], "little")
        return width, height
    if content[:2] == b"\xff\xd8":
        return _jpeg_dimensions(content)
    if content[:4] == b"RIFF":
        return _webp_dimensions(content)
    if content[:4] == b"\x00\x00\x01\x00":
        return _ico_dimensions(content)
    return 0, 0


def _image_quality_score(content: bytes, content_type: str) -> int:
    width, height = _image_dimensions(content)
    if width > 0 and height > 0:
        return width * height
    ct = (content_type or "").lower()
    if "svg" in ct:
        return 96 * 96
    return min(len(content), 4096)


def _safe_request_url(url: str) -> str | None:
    """Valide schéma + hostname (résolution DNS anti-SSRF) avant chaque requête."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    if not is_safe_hostname(parsed.hostname):
        return None
    return url


def _is_trusted_cdn_host(hostname: str) -> bool:
    host = hostname.strip().lower().rstrip(".")
    return host in {
        "www.google.com",
        "google.com",
        "icons.duckduckgo.com",
        "t1.gstatic.com",
    }


def _fetch_bytes(
    session: _PinnedFetchSession,
    url: str,
    *,
    max_bytes: int,
    plain_client: httpx.Client | None = None,
) -> tuple[bytes, str] | None:
    """
    GET sans follow_redirects aveugle : chaque hop est revalidé (anti-SSRF).
    CDN de confiance : client HTTP classique (plus rapide).
    Autres hôtes : TCP épinglé ; hostname conservé pour TLS/SNI.
    """
    current = _safe_request_url(url)
    if not current:
        return None

    for _ in range(MAX_REDIRECTS + 1):
        parsed = urlparse(current)
        hostname = parsed.hostname
        if not hostname:
            return None
        ips = _resolve_global_ips(hostname)
        if not ips:
            return None

        try:
            if plain_client is not None and _is_trusted_cdn_host(hostname):
                client = plain_client
            else:
                client = session.client_for(ips[0])
            with client.stream("GET", current) as resp:
                if resp.status_code in {301, 302, 303, 307, 308}:
                    location = (resp.headers.get("location") or "").strip()
                    if not location:
                        return None
                    nxt = urljoin(current, location)
                    current = _safe_request_url(nxt)
                    if not current:
                        return None
                    continue

                if resp.status_code != 200:
                    return None

                content_length = resp.headers.get("content-length")
                if content_length is not None:
                    try:
                        if int(content_length) > max_bytes:
                            return None
                    except ValueError:
                        pass

                chunks: list[bytes] = []
                total = 0
                for chunk in resp.iter_bytes():
                    if not chunk:
                        continue
                    remaining = max_bytes - total
                    if remaining <= 0:
                        break
                    if len(chunk) > remaining:
                        chunks.append(chunk[:remaining])
                        total = max_bytes
                        break
                    chunks.append(chunk)
                    total += len(chunk)

                body = b"".join(chunks)
                content_type = resp.headers.get("content-type", "application/octet-stream")
                return body, content_type
        except (httpx.HTTPError, ValueError, OSError):
            return None

    return None


def _fetch_url(
    session: _PinnedFetchSession,
    url: str,
    *,
    plain_client: httpx.Client | None = None,
) -> tuple[bytes, str] | None:
    result = _fetch_bytes(session, url, max_bytes=MAX_ICON_BYTES, plain_client=plain_client)
    if result is None:
        return None
    body, content_type = result
    if _is_image_response(content_type, body):
        return body, content_type.split(";")[0].strip() or "image/x-icon"
    return None


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
