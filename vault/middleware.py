"""En-têtes de sécurité HTTP (CSP, framing, MIME sniffing) + CORS desktop."""

from __future__ import annotations

from urllib.parse import urlparse

from django.conf import settings
from django.http import HttpResponse


def _normalize_origin(origin: str) -> str | None:
    """Accepte uniquement scheme://host[:port] sans path/credentials."""
    value = (origin or "").strip()
    if not value or value.lower() == "null":
        return None
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https", "tauri"):
        return None
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return None
    if parsed.path not in ("", "/"):
        return None
    if not parsed.netloc:
        return None
    # Reconstruit une origine canonique (évite spoofing d’espace / casing).
    if parsed.scheme == "tauri":
        return f"tauri://{parsed.hostname}" if parsed.hostname else None
    host = parsed.hostname
    if not host:
        return None
    port = parsed.port
    if port:
        return f"{parsed.scheme}://{host}:{port}"
    return f"{parsed.scheme}://{host}"


def _is_api_path(path: str) -> bool:
    return path == "/health" or path.startswith("/health/") or any(
        path == prefix or path.startswith(prefix + "/") for prefix in ("/auth", "/vault")
    )


class CorsMiddleware:
    """Autorise le client desktop (origine ≠ API) à appeler l’API en fetch.

    Origines : settings.CORS_ALLOWED_ORIGINS (allowlist stricte).
    Pas de credentials cookies — le client envoie un Bearer JWT.
    CORS limité aux routes API (pas les pages HTML).
    """

    def __init__(self, get_response):
        self.get_response = get_response
        raw = getattr(settings, "CORS_ALLOWED_ORIGINS", ()) or ()
        allowed: set[str] = set()
        for item in raw:
            normalized = _normalize_origin(str(item))
            if normalized:
                allowed.add(normalized)
        self.allowed = frozenset(allowed)

    def __call__(self, request):
        origin = _normalize_origin(request.headers.get("Origin") or "")
        allowed = bool(origin and origin in self.allowed)
        api_path = _is_api_path(request.path)

        if request.method == "OPTIONS" and allowed and api_path:
            response = HttpResponse(status=204)
            self._apply_cors(response, origin, preflight=True)
            return response

        # Preflight non autorisé : ne pas laisser CommonMiddleware répondre 405 sans CORS clair.
        if request.method == "OPTIONS" and origin and not allowed:
            return HttpResponse(status=403)

        response = self.get_response(request)
        if allowed and api_path:
            self._apply_cors(response, origin, preflight=False)
        return response

    @staticmethod
    def _apply_cors(response, origin: str, *, preflight: bool) -> None:
        response["Access-Control-Allow-Origin"] = origin
        response["Vary"] = "Origin"
        response["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Accept"
        response["Access-Control-Max-Age"] = "600"
        # Pas de cookies cross-origin.
        response["Access-Control-Allow-Credentials"] = "false"
        if preflight:
            response["Content-Length"] = "0"


class SecurityHeadersMiddleware:
    """Ajoute des en-têtes défensifs sur toutes les réponses."""

    # Dépendances crypto/UI servies depuis /vendor (plus de CDN esm.sh)
    CSP = (
        "default-src 'self'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'; "
        "object-src 'none'; "
        "img-src 'self' data: https: blob:; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "script-src 'self' 'wasm-unsafe-eval'; "
        "connect-src 'self' https://api.pwnedpasswords.com https://api.xposedornot.com; "
        "worker-src 'self'; "
        "manifest-src 'self'"
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault("Content-Security-Policy", self.CSP)
        response.setdefault("X-Content-Type-Options", "nosniff")
        response.setdefault("X-Frame-Options", "DENY")
        response.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), clipboard-write=(self)",
        )
        response.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        path = request.path
        if path.startswith(("/css/", "/js/", "/vendor/", "/icons/", "/assets/", "/data/")):
            response.setdefault("Cache-Control", "public, max-age=86400")
        if request.is_secure() or request.META.get("HTTP_X_FORWARDED_PROTO") == "https":
            response.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response
