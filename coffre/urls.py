from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve

from vault import views

urlpatterns = [
    path("", views.index, name="index"),
    path("docs/", views.docs_app, name="docs"),
    path("docs/<slug:slug>/", views.docs_app, name="docs-page"),
    path("favicon.ico", views.favicon, name="favicon"),
    path("health/", views.health, name="health"),
    path("manifest.webmanifest", views.manifest, name="manifest"),
    path("sw.js", views.service_worker, name="service-worker"),
    path("auth/", include("vault.urls_auth")),
    path("vault/", include("vault.urls_vault")),
    re_path(
        r"^css/(?P<path>.*)$",
        serve,
        {"document_root": settings.BASE_DIR / "frontend" / "css"},
    ),
    re_path(
        r"^js/(?P<path>.*)$",
        serve,
        {"document_root": settings.BASE_DIR / "frontend" / "js"},
    ),
    re_path(
        r"^icons/(?P<path>.*)$",
        serve,
        {"document_root": settings.BASE_DIR / "frontend" / "icons"},
    ),
    re_path(
        r"^vendor/(?P<path>.*)$",
        serve,
        {"document_root": settings.BASE_DIR / "frontend" / "vendor"},
    ),
    re_path(
        r"^data/(?P<path>.*)$",
        serve,
        {"document_root": settings.BASE_DIR / "frontend" / "data"},
    ),
    re_path(
        r"^assets/(?P<path>.*)$",
        serve,
        {"document_root": settings.BASE_DIR / "frontend" / "assets"},
    ),
    re_path(
        r"^docs-content/(?P<path>.*)$",
        serve,
        {"document_root": settings.BASE_DIR / "docs"},
    ),
]
