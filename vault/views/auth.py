"""Vues HTTP Clefkey — sous-module."""

import hashlib
import hmac
import json

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from ..auth import b64_decode, b64_encode, create_access_token
from ..decorators import api_error, require_auth
from ..favicon import fetch_site_favicon, normalize_page_url
from ..models import VaultEntry, VaultRecoveryKey, VaultShare, VaultUser
from ..ratelimit import rate_limit

from ._helpers import (
    KEY_SIZE,
    MAX_RECOVERY_BLOB_BYTES,
    MIN_WRAPPED_KEY_BYTES,
    PUBLIC_KEY_SIZE,
    RECOVERY_KEY_COUNT,
    SALT_SIZE,
    VERIFIER_SIZE,
    _DUMMY_AUTH_VERIFIER,
    _auth_response,
    _decode_fixed_b64,
    _decode_wrapped_key_b64,
    _dummy_salt_for_email,
    _key_proof_matches,
    _parse_registration_names,
    _profile_payload,
    _seal_key_proof,
    _validate_name_field,
)

def _parse_recovery_packages(raw) -> list[tuple[bytes, bytes, bytes]] | str:
    """Valide exactement 7 paquets {verifier, encrypted_vault_key, key_proof}."""
    if not isinstance(raw, list) or len(raw) != RECOVERY_KEY_COUNT:
        return f"Exactement {RECOVERY_KEY_COUNT} clés de récupération sont requises"
    packages: list[tuple[bytes, bytes, bytes]] = []
    seen: set[bytes] = set()
    first_proof: bytes | None = None
    for item in raw:
        if not isinstance(item, dict):
            return "Paquet de récupération invalide"
        try:
            verifier = b64_decode(item.get("verifier") or "")
            blob = b64_decode(item.get("encrypted_vault_key") or "")
            key_proof = b64_decode(item.get("key_proof") or "")
        except Exception:
            return "Paquet de récupération invalide"
        if len(verifier) != VERIFIER_SIZE:
            return "Vérificateur de récupération invalide"
        if len(key_proof) != VERIFIER_SIZE:
            return "Preuve de récupération invalide"
        if len(blob) < MIN_WRAPPED_KEY_BYTES or len(blob) > MAX_RECOVERY_BLOB_BYTES:
            return "Blob de récupération invalide"
        if verifier in seen:
            return "Vérificateurs de récupération en double"
        if first_proof is None:
            first_proof = key_proof
        elif not hmac.compare_digest(key_proof, first_proof):
            return "Preuves de récupération incohérentes"
        seen.add(verifier)
        packages.append((verifier, blob, key_proof))
    return packages


def _save_recovery_keys(user: VaultUser, packages: list[tuple[bytes, bytes, bytes]]) -> None:
    VaultRecoveryKey.objects.filter(user=user).delete()
    VaultRecoveryKey.objects.bulk_create([
        VaultRecoveryKey(
            user=user,
            slot=index,
            verifier=verifier,
            encrypted_vault_key=blob,
            key_proof=_seal_key_proof(key_proof),
        )
        for index, (verifier, blob, key_proof) in enumerate(packages, start=1)
    ])


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit("auth-register", limit=5, window_seconds=60)
def register(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    email = data.get("email", "").strip().lower()
    names = _parse_registration_names(data)
    if isinstance(names, str):
        return api_error(names, 400)
    first_name, middle_name, last_name = names
    required = ("salt", "auth_verifier", "encrypted_vault_key", "public_key", "encrypted_private_key")
    if not email or not first_name or not last_name or any(not data.get(f) for f in required):
        return api_error("Champs requis manquants", 400)

    packages = _parse_recovery_packages(data.get("recovery_keys"))
    if isinstance(packages, str):
        return api_error(packages, 400)

    for value, label, required_field in (
        (first_name, "Le prénom", True),
        (middle_name, "Le deuxième prénom", False),
        (last_name, "Le nom", True),
    ):
        err = _validate_name_field(value, label, required_field)
        if err:
            return api_error(err, 400)

    if VaultUser.objects.filter(email=email).exists():
        return api_error("Email déjà utilisé", 409)

    salt = _decode_fixed_b64(data["salt"], SALT_SIZE, "salt")
    if isinstance(salt, str):
        return api_error(salt, 400)
    auth_verifier = _decode_fixed_b64(data["auth_verifier"], VERIFIER_SIZE, "auth_verifier")
    if isinstance(auth_verifier, str):
        return api_error(auth_verifier, 400)
    public_key = _decode_fixed_b64(data["public_key"], PUBLIC_KEY_SIZE, "public_key")
    if isinstance(public_key, str):
        return api_error(public_key, 400)
    encrypted_vault_key = _decode_wrapped_key_b64(data["encrypted_vault_key"], "encrypted_vault_key")
    if isinstance(encrypted_vault_key, str):
        return api_error(encrypted_vault_key, 400)
    encrypted_private_key = _decode_wrapped_key_b64(
        data["encrypted_private_key"], "encrypted_private_key"
    )
    if isinstance(encrypted_private_key, str):
        return api_error(encrypted_private_key, 400)

    try:
        with transaction.atomic():
            user = VaultUser.objects.create(
                email=email,
                first_name=first_name,
                middle_name=middle_name,
                last_name=last_name,
                display_name="",
                salt=salt,
                auth_verifier=auth_verifier,
                encrypted_vault_key=encrypted_vault_key,
                public_key=public_key,
                encrypted_private_key=encrypted_private_key,
            )
            _save_recovery_keys(user, packages)
    except Exception:
        return api_error("Impossible de créer le compte", 500)

    return JsonResponse(_auth_response(user), status=201)


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit("auth-recovery-begin", limit=8, window_seconds=300)
def recovery_begin(request):
    """
    Étape 1 : le client prouve connaître une clé via son vérificateur (hash).
    Retourne le blob de vaultKey chiffré pour cette clé + matériaux nécessaires au reset.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    email = (data.get("email") or "").strip().lower()
    verifier_b64 = data.get("verifier")
    if not email or not verifier_b64:
        return api_error("Récupération impossible", 400)

    try:
        verifier = b64_decode(verifier_b64)
    except Exception:
        return api_error("Récupération impossible", 400)
    if len(verifier) != VERIFIER_SIZE:
        return api_error("Récupération impossible", 400)

    user = VaultUser.objects.filter(email__iexact=email).first()
    # Lookup par vérificateur unique ; message uniforme (anti-énumération).
    recovery = VaultRecoveryKey.objects.filter(verifier=verifier).select_related("user").first()
    if (
        user is None
        or recovery is None
        or recovery.user_id != user.id
    ):
        return api_error("Récupération impossible", 400)

    return JsonResponse({
        "email": user.email,
        "user_id": str(user.id),
        "salt": b64_encode(user.salt),
        "encrypted_vault_key_recovery": b64_encode(recovery.encrypted_vault_key),
        "encrypted_private_key": b64_encode(user.encrypted_private_key),
        "public_key": b64_encode(user.public_key),
        "slot": recovery.slot,
    })


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit("auth-recovery-complete", limit=5, window_seconds=300)
def recovery_complete(request):
    """
    Étape 2 : nouveau mot de passe maître (matériaux déjà dérivés côté client).
    Invalide uniquement la clé de récupération utilisée ; les autres restent valides.
    Exige la preuve de possession de vaultKey (key_proof) en plus du vérificateur.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    email = (data.get("email") or "").strip().lower()
    verifier_b64 = data.get("verifier")
    key_proof_b64 = data.get("key_proof")
    auth_verifier_b64 = data.get("auth_verifier")
    encrypted_vault_key_b64 = data.get("encrypted_vault_key")
    if not email or not verifier_b64 or not key_proof_b64 or not auth_verifier_b64 or not encrypted_vault_key_b64:
        return api_error("Champs requis manquants", 400)

    verifier = _decode_fixed_b64(verifier_b64, VERIFIER_SIZE, "verifier")
    if isinstance(verifier, str):
        return api_error("Récupération impossible", 400)
    key_proof = _decode_fixed_b64(key_proof_b64, VERIFIER_SIZE, "key_proof")
    if isinstance(key_proof, str):
        return api_error("Récupération impossible", 400)
    auth_verifier = _decode_fixed_b64(auth_verifier_b64, VERIFIER_SIZE, "auth_verifier")
    if isinstance(auth_verifier, str):
        return api_error(auth_verifier, 400)
    encrypted_vault_key = _decode_wrapped_key_b64(encrypted_vault_key_b64, "encrypted_vault_key")
    if isinstance(encrypted_vault_key, str):
        return api_error(encrypted_vault_key, 400)

    user = VaultUser.objects.filter(email__iexact=email).first()
    recovery = VaultRecoveryKey.objects.filter(verifier=verifier).first()
    if (
        user is None
        or recovery is None
        or recovery.user_id != user.id
        or not _key_proof_matches(bytes(recovery.key_proof), key_proof)
    ):
        return api_error("Récupération impossible", 400)

    with transaction.atomic():
        user.auth_verifier = auth_verifier
        user.encrypted_vault_key = encrypted_vault_key
        user.save(update_fields=["auth_verifier", "encrypted_vault_key"])
        # Une seule clé consommée — les autres restent utilisables.
        recovery.delete()

    return JsonResponse(_auth_response(user))


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit("auth-password", limit=5, window_seconds=300)
@require_auth
def change_password(request):
    """
    Change le mot de passe maître depuis une session authentifiée.
    Le client envoie le vérificateur actuel et les nouveaux matériaux dérivés.
    Les clés de récupération ne sont ni exigées ni invalidées.
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    current_b64 = data.get("current_auth_verifier")
    auth_verifier_b64 = data.get("auth_verifier")
    encrypted_vault_key_b64 = data.get("encrypted_vault_key")
    if not current_b64 or not auth_verifier_b64 or not encrypted_vault_key_b64:
        return api_error("Champs requis manquants", 400)

    current_verifier = _decode_fixed_b64(current_b64, VERIFIER_SIZE, "current_auth_verifier")
    if isinstance(current_verifier, str):
        return api_error("Mot de passe actuel incorrect", 401)
    auth_verifier = _decode_fixed_b64(auth_verifier_b64, VERIFIER_SIZE, "auth_verifier")
    if isinstance(auth_verifier, str):
        return api_error(auth_verifier, 400)
    encrypted_vault_key = _decode_wrapped_key_b64(encrypted_vault_key_b64, "encrypted_vault_key")
    if isinstance(encrypted_vault_key, str):
        return api_error(encrypted_vault_key, 400)

    user = request.vault_user
    stored = bytes(user.auth_verifier)
    if len(current_verifier) != len(stored) or not hmac.compare_digest(current_verifier, stored):
        return api_error("Mot de passe actuel incorrect", 401)
    if hmac.compare_digest(auth_verifier, stored):
        return api_error("Le nouveau mot de passe doit être différent", 400)

    user.auth_verifier = auth_verifier
    user.encrypted_vault_key = encrypted_vault_key
    user.save(update_fields=["auth_verifier", "encrypted_vault_key"])
    return JsonResponse(_auth_response(user))


@csrf_exempt
@require_http_methods(["POST"])
@rate_limit("auth-login", limit=10, window_seconds=60)
def login(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    email = data.get("email", "").strip().lower()
    auth_verifier_b64 = data.get("auth_verifier")
    if not email or not auth_verifier_b64:
        return api_error("Identifiants invalides", 401)

    user = VaultUser.objects.filter(email=email).first()

    try:
        provided = b64_decode(auth_verifier_b64)
    except Exception:
        return api_error("Identifiants invalides", 401)

    # Comparaison toujours exécutée (utilisateur absent → vérifieur factice) pour limiter
    # les oracles de timing / d'existence de compte.
    stored = bytes(user.auth_verifier) if user else _DUMMY_AUTH_VERIFIER
    if len(provided) != len(stored) or not hmac.compare_digest(provided, stored) or user is None:
        return api_error("Identifiants invalides", 401)

    return JsonResponse(_auth_response(user))


@csrf_exempt
@require_auth
def profile_me(request):
    if request.method == "GET":
        return _get_profile(request)
    if request.method == "PATCH":
        return _update_profile(request)
    return api_error("Méthode non autorisée", 405)


def _get_profile(request):
    user = request.vault_user
    return JsonResponse(_profile_payload(user))


def _update_profile(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    user = request.vault_user
    email = data.get("email")
    updated = False

    name_fields = (
        ("first_name", "Le prénom", True),
        ("middle_name", "Le deuxième prénom", False),
        ("last_name", "Le nom", True),
    )
    for field_name, label, required in name_fields:
        if field_name not in data:
            continue
        value = (data[field_name] or "").strip()
        err = _validate_name_field(value, label, required)
        if err:
            return api_error(err, 400)
        setattr(user, field_name, value)
        updated = True

    if email is not None:
        email = email.strip().lower()
        if not email:
            return api_error("L'email est requis", 400)
        if VaultUser.objects.filter(email=email).exclude(id=user.id).exists():
            return api_error("Email déjà utilisé", 409)
        user.email = email
        updated = True

    if not updated:
        return api_error("Aucune modification fournie", 400)

    user.save()
    payload = _profile_payload(user)
    payload["access_token"] = create_access_token(user.id, user.email)
    return JsonResponse(payload)


@require_GET
@rate_limit("auth-salt", limit=20, window_seconds=60)
def get_salt(request):
    """Retourne toujours un sel (réel ou factice) pour ne pas révéler si l'email existe."""
    email = request.GET.get("email", "").strip().lower()
    if not email:
        return api_error("Email requis", 400)

    user = VaultUser.objects.filter(email=email).first()
    salt = bytes(user.salt) if user else _dummy_salt_for_email(email)
    return JsonResponse({"salt": b64_encode(salt)})
