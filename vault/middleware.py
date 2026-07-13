"""En-têtes de sécurité HTTP (CSP, framing, MIME sniffing)."""

from __future__ import annotations


class SecurityHeadersMiddleware:
    """Ajoute des en-têtes défensifs sur toutes les réponses."""

    # Scripts/modules depuis esm.sh (crypto + lucide) ; polices Google
    CSP = (
        "default-src 'self'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'; "
        "object-src 'none'; "
        "img-src 'self' data: https: blob:; "
        "font-src 'self' https://fonts.gstatic.com data:; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "script-src 'self' https://esm.sh 'wasm-unsafe-eval'; "
        "connect-src 'self' https://esm.sh; "
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
        response.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        if request.is_secure() or request.META.get("HTTP_X_FORWARDED_PROTO") == "https":
            response.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response
