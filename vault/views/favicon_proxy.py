"""Proxy favicon distant (JWT + quota IP — pas d’accès anonyme)."""

import hashlib

from django.http import HttpResponse
from django.views.decorators.http import require_GET

from ..decorators import api_error, require_auth
from ..favicon import fetch_site_favicon, normalize_page_url
from ..ratelimit import rate_limit


@require_GET
@rate_limit("vault-favicon", limit=80, window_seconds=60)
@require_auth
def site_favicon(request):
    """Proxy local du favicon public d'un site, réservé au coffre authentifié."""
    page_url = request.GET.get("url", "").strip()
    normalized = normalize_page_url(page_url)
    if not normalized:
        return api_error("URL invalide", 400)

    result = fetch_site_favicon(normalized)
    if not result:
        response = HttpResponse(status=404)
        response["Cache-Control"] = "private, max-age=60"
        return response

    content, content_type = result
    response = HttpResponse(content, content_type=content_type)
    response["Cache-Control"] = "private, max-age=604800, stale-while-revalidate=86400"
    response["X-Content-Type-Options"] = "nosniff"
    digest = hashlib.sha256(content).hexdigest()[:32]
    response["ETag"] = f'"{digest}"'
    if_none_match = (request.META.get("HTTP_IF_NONE_MATCH") or "").strip()
    if if_none_match == response["ETag"]:
        return HttpResponse(status=304)
    return response
