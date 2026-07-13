from django.urls import path

from . import views

urlpatterns = [
    path("entries", views.vault_entries, name="vault-entries"),
    path("entries/<str:entry_id>", views.entry_detail, name="vault-entry-detail"),
    path("favicon", views.site_favicon, name="vault-site-favicon"),
    path("generate-password", views.generate_password_view, name="vault-generate-password"),
]
