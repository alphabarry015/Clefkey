from django.urls import path

from . import views

urlpatterns = [
    path("entries", views.list_entries, name="vault-list-entries"),
    path("entries/<str:entry_id>", views.entry_detail, name="vault-entry-detail"),
    path("generate-password", views.generate_password_view, name="vault-generate-password"),
]
