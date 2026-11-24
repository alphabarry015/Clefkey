"""Activation et vérification du 2FA authenticator."""

import hmac
import json

from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from jose import JWTError

from ..auth import decode_access_token
from ..crypto.totp import (
    encode_secret,
    format_secret,
    generate_backup_codes,
    generate_secret,
    hash_backup_code,
    match_totp,
    normalize_backup_code,
    open_secret,
    otpauth_uri,
    seal_secret,
)
from ..decorators import api_error, require_auth
from ..models import VaultTotpBackupCode, VaultUser
from ..ratelimit import rate_limit
from ._helpers import VERIFIER_SIZE, _auth_response, _decode_fixed_b64


def _json(request) -> dict | None:
    try:
        data = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _master_ok(user: VaultUser, current_b64: str) -> bool:
    current = _decode_fixed_b64(current_b64, VERIFIER_SIZE, "current_auth_verifier")
    if isinstance(current, str):
        return False
    stored = bytes(user.auth_verifier)
    return len(current) == len(stored) and hmac.compare_digest(current, stored)


def _replace_backup_codes(user: VaultUser) -> list[str]:
    codes = generate_backup_codes()
    VaultTotpBackupCode.objects.filter(user=user).delete()
    VaultTotpBackupCode.objects.bulk_create([
        VaultTotpBackupCode(user=user, code_hash=hash_backup_code(code))
        for code in codes
    ])
    return codes


def _accept_backup(user: VaultUser, code: str) -> bool:
    digest = hash_backup_code(code)
    if len(normalize_backup_code(code)) < 8:
        return False
    matched = None
    for row in VaultTotpBackupCode.objects.filter(user=user, used=False):
        if hmac.compare_digest(bytes(row.code_hash), digest):
            matched = row
            break
    if matched is None:
        return False
    # Un seul des deux appels parallèles peut passer used=False → True.
    return VaultTotpBackupCode.objects.filter(pk=matched.pk, used=False).update(used=True) == 1


def _consume_totp_step(user: VaultUser, step: int) -> bool:
    updated = VaultUser.objects.filter(pk=user.pk).filter(
        Q(totp_last_step__isnull=True) | Q(totp_last_step__lt=step)
    ).update(totp_last_step=step)
    if not updated:
        return False
    user.totp_last_step = step
    return True


def _accept_code(user: VaultUser, code: str) -> bool:
    if not user.totp_secret:
        return False
    try:
        secret = open_secret(bytes(user.totp_secret))
    except Exception:
        return False
    step = match_totp(secret, code)
    if step is not None:
        return _consume_totp_step(user, step)
    return _accept_backup(user, code)


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit("auth-login-totp", limit=10, window_seconds=60)
def login_totp(request):
    data = _json(request)
    if data is None:
        return api_error("Corps JSON invalide", 400)
    token = data.get("totp_token") or ""
    code = data.get("code") or ""
    try:
        payload = decode_access_token(token)
    except JWTError:
        return api_error("Code expiré, reconnectez-vous", 401)
    except Exception:
        return api_error("Code expiré, reconnectez-vous", 401)
    if payload.get("purpose") != "totp" or not payload.get("sub"):
        return api_error("Code expiré, reconnectez-vous", 401)

    user = VaultUser.objects.filter(id=payload["sub"]).first()
    if user is None or not user.totp_enabled or payload.get("email") != user.email:
        return api_error("Code invalide", 401)
    if not _accept_code(user, code):
        return api_error("Code invalide", 401)
    return JsonResponse(_auth_response(user))


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit("auth-totp-begin", limit=5, window_seconds=300)
@require_auth
def totp_begin(request):
    user = request.vault_user
    if user.totp_enabled:
        return api_error("L'authentificateur est déjà activé", 400)
    secret = generate_secret()
    user.totp_pending_secret = seal_secret(secret)
    user.save(update_fields=["totp_pending_secret"])
    encoded = encode_secret(secret)
    return JsonResponse({
        "secret": format_secret(encoded),
        "otpauth_uri": otpauth_uri(encoded, user.email),
    })


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit("auth-totp-confirm", limit=8, window_seconds=300)
@require_auth
def totp_confirm(request):
    data = _json(request)
    if data is None:
        return api_error("Corps JSON invalide", 400)
    user = request.vault_user
    if user.totp_enabled:
        return api_error("L'authentificateur est déjà activé", 400)
    if not user.totp_pending_secret:
        return api_error("Générez d'abord une clé", 400)
    try:
        secret = open_secret(bytes(user.totp_pending_secret))
    except Exception:
        return api_error("Clé illisible, recommencez", 400)
    step = match_totp(secret, data.get("code") or "")
    if step is None:
        return api_error("Code invalide", 401)
    sealed = bytes(user.totp_pending_secret)
    with transaction.atomic():
        enabled = VaultUser.objects.filter(pk=user.pk, totp_enabled=False).update(
            totp_secret=sealed,
            totp_pending_secret=None,
            totp_enabled=True,
            totp_last_step=step,
        )
        if not enabled:
            return api_error("L'authentificateur est déjà activé", 400)
        user.totp_enabled = True
        user.totp_secret = sealed
        user.totp_pending_secret = None
        user.totp_last_step = step
        codes = _replace_backup_codes(user)
    return JsonResponse({"totp_enabled": True, "backup_codes": codes})


def _guarded_change(request):
    data = _json(request)
    if data is None:
        return None, api_error("Corps JSON invalide", 400)
    user = request.vault_user
    if not user.totp_enabled:
        return None, api_error("L'authentificateur n'est pas activé", 400)
    if not _master_ok(user, data.get("current_auth_verifier") or ""):
        return None, api_error("Mot de passe maître incorrect", 401)
    if not _accept_code(user, data.get("code") or ""):
        return None, api_error("Code invalide", 401)
    return user, None


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit("auth-totp-disable", limit=5, window_seconds=300)
@require_auth
def totp_disable(request):
    user, error = _guarded_change(request)
    if error:
        return error
    with transaction.atomic():
        user.totp_enabled = False
        user.totp_secret = None
        user.totp_pending_secret = None
        user.totp_last_step = None
        user.save(update_fields=["totp_enabled", "totp_secret", "totp_pending_secret", "totp_last_step"])
        VaultTotpBackupCode.objects.filter(user=user).delete()
    return JsonResponse({"totp_enabled": False})


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit("auth-totp-recovery", limit=5, window_seconds=300)
@require_auth
def totp_recovery_regenerate(request):
    user, error = _guarded_change(request)
    if error:
        return error
    codes = _replace_backup_codes(user)
    return JsonResponse({"backup_codes": codes})
