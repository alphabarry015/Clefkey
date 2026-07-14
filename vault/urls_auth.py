from django.urls import path

from . import views

urlpatterns = [
    path("register", views.register, name="auth-register"),
    path("login", views.login, name="auth-login"),
    path("me", views.profile_me, name="auth-me"),
    path("salt", views.get_salt, name="auth-salt"),
    path("lookup", views.lookup_user, name="auth-lookup"),
    path("recovery/begin", views.recovery_begin, name="auth-recovery-begin"),
    path("recovery/complete", views.recovery_complete, name="auth-recovery-complete"),
]
