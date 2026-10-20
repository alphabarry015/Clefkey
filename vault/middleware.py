"""En-têtes de sécurité HTTP (CSP, framing, MIME sniffing) + CORS desktop."""

from __future__ import annotations

from django.conf import settings
from django.http import HttpResponse


class CorsMiddleware:
    """Autorise le client desktop (origine ≠ API) à appeler l’API en fetch.

    Origines : settings.CORS_ALLOWED_ORIGINS (env CORS_ORIGINS + défauts DEBUG).
    Pas de credentials cookies — le client envoie un Bearer JWT.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.allowed = frozenset(getattr(settings, "CORS_ALLOWED_ORIGINS", ()) or ())

    def __call__(self, request):
        origin = (request.headers.get("Origin") or "").strip()
        allowed = bool(origin and origin in self.allowed)

        if request.method == "OPTIONS" and allowed:
            response = HttpResponse(status=204)
            self._apply_cors(response, origin, preflight=True)
            return response

        response = self.get_response(request)
        if allowed:
            self._apply_cors(response, origin, preflight=False)
        return response

    @staticmethod
    def _apply_cors(response, origin: str, *, preflight: bool) -> None:
        response["Access-Control-Allow-Origin"] = origin
        response["Vary"] = "Origin"
        response["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Accept"
        response["Access-Control-Max-Age"] = "86400"
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
        response.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), clipboard-write=(self)")
        response.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        path = request.path
        if path.startswith(("/css/", "/js/", "/vendor/", "/icons/", "/assets/", "/data/")):
            response.setdefault("Cache-Control", "public, max-age=86400")
        if request.is_secure() or request.META.get("HTTP_X_FORWARDED_PROTO") == "https":
            response.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response
