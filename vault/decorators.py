"""Décorateurs et helpers d'authentification JWT pour l'API vault."""

from functools import wraps

from django.http import JsonResponse

from .auth import decode_access_token
from .models import VaultUser


def get_bearer_token(request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def get_current_user(request) -> VaultUser | None:
    token = get_bearer_token(request)
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        if not user_id:
            return None
        return VaultUser.objects.filter(id=user_id).first()
    except Exception:
        return None


def require_auth(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        user = get_current_user(request)
        if not user:
            return JsonResponse({"detail": "Token invalide"}, status=401)
        request.vault_user = user
        return view_func(request, *args, **kwargs)

    return wrapper


def api_error(message: str, status: int = 400) -> JsonResponse:
    return JsonResponse({"detail": message}, status=status)
