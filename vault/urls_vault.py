from django.urls import path

from . import views

urlpatterns = [
    path("entries", views.vault_entries, name="vault-entries"),
    path("entries/<str:entry_id>", views.entry_detail, name="vault-entry-detail"),
    path("shares", views.vault_shares, name="vault-shares"),
    path("shares/received", views.shares_received, name="vault-shares-received"),
    path("shares/sent", views.shares_sent, name="vault-shares-sent"),
    path("shares/<str:share_id>", views.share_detail, name="vault-share-detail"),
    path("favicon", views.site_favicon, name="vault-site-favicon"),
    path("generate-password", views.generate_password_view, name="vault-generate-password"),
]
