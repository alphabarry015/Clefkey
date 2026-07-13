from django.urls import path

from . import views

urlpatterns = [
    path("register", views.register, name="auth-register"),
    path("login", views.login, name="auth-login"),
    path("me", views.profile_me, name="auth-me"),
    path("salt", views.get_salt, name="auth-salt"),
]
