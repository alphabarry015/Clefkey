"""Couche réseau SSRF-safe pour le fetch de favicons."""

from __future__ import annotations

import ipaddress
import socket
import time
from urllib.parse import urlparse, urljoin

import httpcore
import httpx
from httpcore._backends.sync import SyncBackend
from httpx._config import DEFAULT_LIMITS, create_ssl_context

from .favicon_constants import (
    MAX_ICON_BYTES,
    MAX_REDIRECTS,
    TIMEOUT,
    USER_AGENT,
    _DNS_TTL_SECONDS,
    _dns_cache,
)
from .favicon_image import _is_image_response

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


