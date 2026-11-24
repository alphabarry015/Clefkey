from django.urls import path

from . import views

urlpatterns = [
    path("register", views.register, name="auth-register"),
    path("login", views.login, name="auth-login"),
    path("login/totp", views.login_totp, name="auth-login-totp"),
    path("totp/begin", views.totp_begin, name="auth-totp-begin"),
    path("totp/confirm", views.totp_confirm, name="auth-totp-confirm"),
    path("totp/disable", views.totp_disable, name="auth-totp-disable"),
    path("totp/recovery", views.totp_recovery_regenerate, name="auth-totp-recovery"),
    path("me", views.profile_me, name="auth-me"),
    path("salt", views.get_salt, name="auth-salt"),
    path("lookup", views.lookup_user, name="auth-lookup"),
    path("recovery/begin", views.recovery_begin, name="auth-recovery-begin"),
    path("recovery/complete", views.recovery_complete, name="auth-recovery-complete"),
    path(
        "recovery/passphrase",
        views.recovery_passphrase_complete,
        name="auth-recovery-passphrase",
    ),
    path("password", views.change_password, name="auth-password"),
    path("passphrase", views.change_passphrase, name="auth-passphrase"),
]
