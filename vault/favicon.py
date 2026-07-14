"""Récupération légale des favicons publics (même principe qu'un navigateur)."""

from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import quote, urljoin, urlparse

import httpx

USER_AGENT = "Gardefort/1.0 (+favicon; usage personnel)"
TIMEOUT = 6.0
MAX_ICON_BYTES = 512_000
MAX_HTML_BYTES = 200_000
# Cache en mémoire borné (processus serverless / long-running).
MAX_CACHE_ENTRIES = 256

_cache: dict[str, tuple[bytes, str] | None] = {}


def _cache_put(key: str, value: tuple[bytes, str] | None) -> None:
    if key in _cache:
        _cache.pop(key, None)
    elif len(_cache) >= MAX_CACHE_ENTRIES:
        _cache.pop(next(iter(_cache)), None)
    _cache[key] = value


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
    host = hostname.strip().lower().rstrip(".")
    if not host or host == "localhost" or host.endswith(".local"):
        return False
    if host in {"0.0.0.0", "::1", "[::1]"}:
        return False

    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False

    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
        ):
            return False
    return True


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
    parsed = urlparse(page_url)
    domain = _cache_key(page_url)
    encoded = quote(page_url, safe="")
    return _dedupe_candidates([
        IconCandidate(
            f"https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON"
            f"&fallback_opts=TYPE,SIZE,URL&url={encoded}&size=128",
            85,
        ),
        IconCandidate(
            f"https://www.google.com/s2/favicons?domain={domain}&sz=128",
            75,
        ),
        IconCandidate(urljoin(_origin(page_url), "/favicon.ico"), 20),
        IconCandidate(f"https://icons.duckduckgo.com/ip3/{domain}.ico", 10),
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


MAX_REDIRECTS = 3


def _safe_request_url(url: str) -> str | None:
    """Valide schéma + hostname (résolution DNS anti-SSRF) avant chaque requête."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    if not is_safe_hostname(parsed.hostname):
        return None
    return url


def _fetch_bytes(
    client: httpx.Client,
    url: str,
    *,
    max_bytes: int,
) -> tuple[bytes, str] | None:
    """
    GET sans follow_redirects aveugle : chaque hop est revalidé (anti-SSRF).
    Retourne (body tronqué, content-type) ou None.
    """
    current = _safe_request_url(url)
    if not current:
        return None

    for _ in range(MAX_REDIRECTS + 1):
        try:
            resp = client.get(current)
        except httpx.HTTPError:
            return None

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

        body = resp.content[:max_bytes]
        content_type = resp.headers.get("content-type", "application/octet-stream")
        return body, content_type

    return None


def _fetch_url(client: httpx.Client, url: str) -> tuple[bytes, str] | None:
    result = _fetch_bytes(client, url, max_bytes=MAX_ICON_BYTES)
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
    if cache_key in _cache:
        return _cache[cache_key]

    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,image/*,*/*;q=0.8"}
    candidates = _build_fallback_candidates(normalized)

    try:
        with httpx.Client(
            timeout=TIMEOUT,
            follow_redirects=False,
            headers=headers,
        ) as client:
            try:
                page = _fetch_bytes(client, normalized, max_bytes=MAX_HTML_BYTES)
                if page is not None:
                    body, content_type = page
                    if "text/html" in content_type:
                        html = body.decode("utf-8", errors="replace")[:MAX_HTML_BYTES]
                        candidates = _discover_icon_candidates(normalized, html) + candidates
            except httpx.HTTPError:
                pass

            candidates = _dedupe_candidates(candidates)[:12]
            best: tuple[bytes, str] | None = None
            best_score = 0

            for candidate in candidates:
                result = _fetch_url(client, candidate.url)
                if not result:
                    continue
                body, icon_type = result
                quality = _image_quality_score(body, icon_type)
                width, height = _image_dimensions(body)
                if quality > best_score:
                    best_score = quality
                    best = result
                if width >= 128 and height >= 128:
                    break

            if best:
                _cache_put(cache_key, best)
                return best
    except httpx.HTTPError:
        pass

    _cache_put(cache_key, None)
    return None
