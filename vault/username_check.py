"""Énumération d'usernames via la base open-source Sherlock (data.json).

100 % serveur : le navigateur ne peut pas interroger les ~480 sites cibles
(CORS). Chaque site de la base définit sa condition d'ERREUR (compte absent) :

  url / urlProbe  -> URL à interroger, {} remplacé par le username
  errorType       -> status_code | message | response_url
  errorCode       -> codes HTTP signifiant "compte absent" (défaut [404])
  errorMsg        -> chaîne(s) présente(s) dans le corps => compte absent
  errorUrl        -> URL finale contenant cette chaîne => compte absent

Le compte est considéré TROUVÉ quand aucune condition d'erreur ne s'applique.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

from .favicon_constants import MAX_REDIRECTS, USER_AGENT
from .favicon_ssrf import is_safe_hostname

_DATA_PATH = Path(__file__).resolve().parent / "data" / "sherlock-data.json"

USERNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{1,29}$")

CONNECT_TIMEOUT = 1.5
READ_TIMEOUT = 2.5
MAX_BODY_BYTES = 200_000
DEFAULT_CONCURRENCY = 40
DEFAULT_LIMIT = 60


@dataclass
class CheckResult:
    found: list[dict] = field(default_factory=list)
    not_found: list[dict] = field(default_factory=list)
    inconclusive: list[dict] = field(default_factory=list)
    attempted: int = 0
    checked: int = 0
    failed: int = 0


def sanitize_username(value: str) -> str | None:
    candidate = str(value or "").strip()
    if not USERNAME_RE.match(candidate):
        return None
    return candidate


def _as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v]
    text = str(value).strip()
    return [text] if text else []


def _as_int_list(value) -> list[int]:
    if value is None:
        return []
    values = value if isinstance(value, list) else [value]
    return [int(v) for v in values if str(v).isdigit()]


def load_sites() -> list[dict]:
    with _DATA_PATH.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    sites: list[dict] = []
    for name, site in data.items():
        if site.get("isNSFW"):
            continue
        probe = str(site.get("urlProbe") or site.get("url") or "").strip()
        sites.append(
            {
                "name": name,
                "url": str(site.get("url") or "").strip(),
                "url_main": str(site.get("urlMain") or "").strip(),
                "probe": probe,
                "method": str(site.get("request_method") or "GET").upper(),
                "headers": site.get("headers") or {},
                "payload": site.get("request_payload") or None,
                "error_type": str(site.get("errorType") or "").strip(),
                "error_codes": _as_int_list(site.get("errorCode")) or [404],
                "error_msgs": _as_list(site.get("errorMsg")),
                "error_url": str(site.get("errorUrl") or "").strip(),
                "regex": site.get("regexCheck") or None,
            }
        )
    return sites


def _trusted_public_host(hostname: str) -> bool:
    """Validation légère (sans DNS) de l'hôte initial issu de la base vendérisée."""
    host = hostname.strip().lower().rstrip(".")
    if not host or host == "localhost" or host.endswith(".local"):
        return False
    if host in {"0.0.0.0", "::1", "[::1]"}:
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        # Hostname de la base Sherlock (fiabilisée) — pas d'IP privée littérale.
        return True


def _http_headers() -> dict[str, str]:
    return {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
    }


def _build_payload(payload: dict, name: str) -> dict | None:
    if payload is None:
        return None
    try:
        text = json.dumps(payload)
        replaced = json.loads(text.replace("{}", name))
    except (TypeError, ValueError):
        return None
    return replaced if isinstance(replaced, dict) else None


async def _request(
    client: httpx.AsyncClient,
    site: dict,
    name: str,
) -> tuple[int, str, str] | None:
    """Requête asynchrone (GET/POST) avec redirections revalidées anti-SSRF.

    Retourne (status_code, corps, url_finale) ou None en cas d'échec.
    """
    probe = site.get("probe") or ""
    parsed = urlparse(probe)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    if not _trusted_public_host(parsed.hostname):
        return None

    method = site.get("method") or "GET"
    headers = dict(_http_headers())
    headers.update({str(k): str(v) for k, v in (site.get("headers") or {}).items()})
    payload = _build_payload(site.get("payload"), name) if method == "POST" else None

    current = probe
    for _ in range(MAX_REDIRECTS + 1):
        parsed = urlparse(current)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return None
        try:
            if method == "POST":
                request = client.stream("POST", current, headers=headers, json=payload)
            else:
                request = client.stream("GET", current, headers=headers)
            async with request as resp:
                if resp.status_code in {301, 302, 303, 307, 308}:
                    location = (resp.headers.get("location") or "").strip()
                    if not location:
                        return None
                    nxt = urljoin(current, location)
                    nxt_parsed = urlparse(nxt)
                    if nxt_parsed.scheme not in ("http", "https") or not nxt_parsed.hostname:
                        return None
                    if not is_safe_hostname(nxt_parsed.hostname):
                        return None
                    current = nxt
                    continue

                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    if not chunk:
                        continue
                    remaining = MAX_BODY_BYTES - total
                    if remaining <= 0:
                        break
                    chunks.append(chunk[:remaining])
                    total += len(chunk)
                    if total >= MAX_BODY_BYTES:
                        break
                body = b"".join(chunks).decode("utf-8", errors="replace")
                return resp.status_code, body, str(resp.url)
        except (httpx.HTTPError, ValueError, OSError):
            return None

    return None


async def _check_site(
    client: httpx.AsyncClient,
    site: dict,
    name: str,
    semaphore: asyncio.Semaphore,
) -> tuple[dict, str] | None:
    async with semaphore:
        outcome = await _request(client, site, name)
    if outcome is None:
        return None
    status_code, body, final_url = outcome
    return site, detect(site, status_code, body, final_url)


async def _run_checks(
    by_name: dict[str, list[dict]],
    concurrency: int,
) -> dict[str, list[tuple[dict, str] | None]]:
    """Vérifie tous les (name, site) dans un seul event loop et un seul client partagé."""
    timeout = httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT)
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    semaphore = asyncio.Semaphore(concurrency)
    pairs = [(name, site) for name, sites in by_name.items() for site in sites]

    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=False,
        headers=_http_headers(),
        limits=limits,
        http2=False,
    ) as client:
        outcomes = await asyncio.gather(
            *(_check_site(client, site, name, semaphore) for name, site in pairs)
        )

    results: dict[str, list[tuple[dict, str] | None]] = {name: [] for name in by_name}
    index = 0
    for name, sites in by_name.items():
        for _ in sites:
            results[name].append(outcomes[index])
            index += 1
    return results


def detect(site: dict, status_code: int, body: str, final_url: str = "") -> str:
    """Retourne 'found', 'not_found' ou 'inconclusive' selon la règle Sherlock."""
    error_type = site.get("error_type") or ""
    if error_type == "message":
        msgs = site.get("error_msgs") or []
        return "not_found" if any(m and m in body for m in msgs) else "found"
    if error_type == "response_url":
        error_url = site.get("error_url") or ""
        return "not_found" if error_url and error_url in final_url else "found"
    if error_type == "status_code":
        codes = site.get("error_codes") or [404]
        return "not_found" if status_code in codes else "found"
    return "inconclusive"


def _usable_sites(sites: list[dict], name: str) -> list[dict]:
    """Sites interrogeables pour ce username (URL/payload avec {} et regex compatible)."""
    out: list[dict] = []
    for site in sites:
        probe = site.get("probe") or ""
        if "{}" not in probe and "{}" not in json.dumps(site.get("payload") or {}):
            continue
        regex = site.get("regex")
        if regex is not None and not re.match(regex, name):
            continue
        out.append(site)
    return out


def _build_result(name: str, sites: list[dict], items: list[tuple[dict, str] | None]) -> CheckResult:
    result = CheckResult()
    result.attempted = len(sites)
    for item in items:
        if item is None:
            result.failed += 1
            continue
        site, verdict = item
        result.checked += 1
        page = (site.get("url") or site.get("url_main") or site.get("probe") or "").replace("{}", name)
        entry = {"name": site.get("name"), "uri": page}
        if verdict == "found":
            result.found.append(entry)
        elif verdict == "not_found":
            result.not_found.append(entry)
        else:
            result.inconclusive.append(entry)

    result.found.sort(key=lambda e: e["name"].lower())
    result.not_found.sort(key=lambda e: e["name"].lower())
    result.inconclusive.sort(key=lambda e: e["name"].lower())
    return result


def check_usernames(
    usernames: list[str],
    *,
    limit: int = DEFAULT_LIMIT,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> dict[str, CheckResult]:
    """Vérifie plusieurs usernames en un seul passage (event loop et client partagés)."""
    sites = load_sites()
    by_name: dict[str, list[dict]] = {}
    for raw in usernames:
        name = sanitize_username(raw)
        if not name or name in by_name:
            continue
        usable = _usable_sites(sites, name)
        if limit:
            usable = usable[: max(1, int(limit))]
        by_name[name] = usable

    results = asyncio.run(_run_checks(by_name, concurrency))
    return {name: _build_result(name, by_name[name], results[name]) for name in by_name}


def check_username(
    username: str,
    *,
    limit: int = DEFAULT_LIMIT,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> CheckResult:
    """Vérifie un username sur la base Sherlock."""
    name = sanitize_username(username)
    if not name:
        raise ValueError("Username invalide (3-30 caractères : lettres, chiffres, . _ -)")
    return check_usernames([name], limit=limit, concurrency=concurrency)[name]


if __name__ == "__main__":
    import sys

    target = sys.argv[1] if len(sys.argv) > 1 else "webbreacher"
    started = time.monotonic()
    outcome = check_username(target, limit=DEFAULT_LIMIT)
    print(f"username={target} attempted={outcome.attempted} checked={outcome.checked} failed={outcome.failed} en {time.monotonic() - started:.1f}s")
    print(f"Trouvé ({len(outcome.found)}) : " + ", ".join(e["name"] for e in outcome.found))
    print(f"Absent ({len(outcome.not_found)})")
    print(f"Indéterminé ({len(outcome.inconclusive)})")