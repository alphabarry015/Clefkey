"""Pages statiques / PWA / health."""

from django.conf import settings
from django.http import FileResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET


def index(request):
    return render(request, "index.html")


@require_GET
def docs_app(request, slug=None):
    docs_path = settings.BASE_DIR / "frontend" / "docs.html"
    return FileResponse(docs_path.open("rb"), content_type="text/html; charset=utf-8")


@require_GET
def favicon(request):
    favicon_path = settings.BASE_DIR / "frontend" / "icons" / "favicon.ico"
    response = FileResponse(favicon_path.open("rb"), content_type="image/x-icon")
    response["Cache-Control"] = "public, max-age=86400"
    return response


@require_GET
def manifest(request):
    manifest_path = settings.BASE_DIR / "frontend" / "manifest.webmanifest"
    response = FileResponse(manifest_path.open("rb"), content_type="application/manifest+json")
    response["Cache-Control"] = "public, max-age=3600"
    return response


@require_GET
def service_worker(request):
    sw_path = settings.BASE_DIR / "frontend" / "sw.js"
    response = FileResponse(sw_path.open("rb"), content_type="application/javascript; charset=utf-8")
    response["Cache-Control"] = "no-cache"
    response["Service-Worker-Allowed"] = "/"
    return response


@require_GET
def health(request):
    return JsonResponse({"status": "ok"})
