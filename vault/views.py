"""Vues HTTP de Gardefort (auth, entrées chiffrées, favicons, PWA)."""

import hashlib
import hmac
import json

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .auth import b64_decode, b64_encode, create_access_token
from .decorators import api_error, require_auth
from .favicon import fetch_site_favicon, normalize_page_url
from .models import VaultEntry, VaultRecoveryKey, VaultShare, VaultUser
from .ratelimit import rate_limit

# Taille max d'un blob d'entrée (décodé) — limite DoS / stockage.
MAX_ENCRYPTED_ENTRY_BYTES = 256 * 1024
# Sel factice 16 octets pour réponses /auth/salt sans révéler l'existence d'un compte.
SALT_SIZE = 16
_DUMMY_AUTH_VERIFIER = b"\x00" * 32
RECOVERY_KEY_COUNT = VaultRecoveryKey.RECOVERY_KEY_COUNT
# AES-GCM : nonce 12 + plaintext 32 + tag 16 = 60 octets (vaultKey / clé privée X25519)
AES_GCM_OVERHEAD = 12 + 16
KEY_SIZE = 32
MIN_WRAPPED_KEY_BYTES = AES_GCM_OVERHEAD + KEY_SIZE
# Vérificateur + blob AES-GCM (nonce 12 + tag 16 + 32 octets vaultKey) ≈ 60–120 B attendus
MAX_RECOVERY_BLOB_BYTES = 512
VERIFIER_SIZE = 32
PUBLIC_KEY_SIZE = 32
KEY_PROOF_SEAL_PREFIX = b"\x01"


def _seal_key_proof(raw_proof: bytes) -> bytes:
    """HMAC serveur du key_proof client — un dump DB ne suffit plus pour complete."""
    digest = hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        raw_proof,
        hashlib.sha256,
    ).digest()
    return KEY_PROOF_SEAL_PREFIX + digest


def _key_proof_matches(stored: bytes, provided: bytes) -> bool:
    """Vérifie la preuve scellée (format v2 : préfixe + HMAC)."""
    expected = _seal_key_proof(provided)
    return hmac.compare_digest(bytes(stored), expected)


def _decode_encrypted_blob(encrypted_b64: str) -> bytes | str:
    """Décode le base64 ; retourne bytes ou message d'erreur."""
    try:
        raw = b64_decode(encrypted_b64)
    except Exception:
        return "encrypted_data invalide"
    if len(raw) > MAX_ENCRYPTED_ENTRY_BYTES:
        return "encrypted_data trop volumineux"
    if not raw:
        return "encrypted_data requis"
    return raw


def _decode_fixed_b64(value: str, expected: int, label: str) -> bytes | str:
    try:
        raw = b64_decode(value or "")
    except Exception:
        return f"{label} invalide"
    if len(raw) != expected:
        return f"{label} invalide"
    return raw


def _decode_wrapped_key_b64(value: str, label: str) -> bytes | str:
    """Blob AES-GCM envelopant une clé de 32 octets (vaultKey ou clé privée)."""
    try:
        raw = b64_decode(value or "")
    except Exception:
        return f"{label} invalide"
    if len(raw) < MIN_WRAPPED_KEY_BYTES or len(raw) > MAX_RECOVERY_BLOB_BYTES:
        return f"{label} invalide"
    return raw


def _dummy_salt_for_email(email: str) -> bytes:
    """Sel déterministe pour emails inconnus (anti-énumération, même format que les vrais)."""
    digest = hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        f"salt:{email}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return digest[:SALT_SIZE]


def _profile_payload(user: VaultUser, entries_count: int | None = None) -> dict:
    """Profil public JWT — sans matériel crypto (salt / blobs restent sur login/register/recovery)."""
    if entries_count is None:
        entries_count = VaultEntry.objects.filter(owner=user).count()
    return {
        "user_id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "middle_name": user.middle_name,
        "last_name": user.last_name,
        "display_name": user.display_name,
        "created_at": user.created_at.isoformat(),
        "entries_count": entries_count,
    }


def _parse_registration_names(data: dict) -> tuple[str, str, str] | str:
    first_name = (data.get("first_name") or "").strip()
    middle_name = (data.get("middle_name") or "").strip()
    last_name = (data.get("last_name") or "").strip()

    if first_name or last_name:
        return first_name, middle_name, last_name

    display_name = (data.get("display_name") or "").strip()
    if not display_name:
        return "Champs requis manquants"

    parts = display_name.split()
    if len(parts) >= 2:
        return parts[0], " ".join(parts[1:-1]), parts[-1]
    return parts[0], "", ""


def _validate_name_field(value: str, label: str, required: bool, max_len: int = 50) -> str | None:
    value = value.strip()
    if required and not value:
        return f"{label} est requis"
    if len(value) > max_len:
        return f"{label} est trop long"
    return None


def _auth_response(user: VaultUser) -> dict:
    token = create_access_token(str(user.id), user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "middle_name": user.middle_name,
        "last_name": user.last_name,
        "display_name": user.display_name,
        "salt": b64_encode(user.salt),
        "encrypted_vault_key": b64_encode(user.encrypted_vault_key),
        "public_key": b64_encode(user.public_key),
        "encrypted_private_key": b64_encode(user.encrypted_private_key),
    }


def _entry_response(entry: VaultEntry) -> dict:
    return {
        "id": str(entry.id),
        "owner_id": str(entry.owner_id),
        "encrypted_data": b64_encode(entry.encrypted_data),
        "created_at": entry.created_at.isoformat(),
        "updated_at": entry.updated_at.isoformat(),
    }


def _share_received_response(share: VaultShare) -> dict:
    return {
        "id": str(share.id),
        "entry_id": str(share.entry_id) if share.entry_id else None,
        "sender_id": str(share.sender_id),
        "sender_email": share.sender.email,
        "sender_display_name": share.sender.display_name,
        "encrypted_data": b64_encode(share.encrypted_data),
        "created_at": share.created_at.isoformat(),
    }


def _share_sent_response(share: VaultShare) -> dict:
    return {
        "id": str(share.id),
        "entry_id": str(share.entry_id) if share.entry_id else None,
        "recipient_id": str(share.recipient_id),
        "recipient_email": share.recipient.email,
        "recipient_display_name": share.recipient.display_name,
        "created_at": share.created_at.isoformat(),
    }


def index(request):
    index_path = settings.BASE_DIR / "frontend" / "index.html"
    return FileResponse(index_path.open("rb"), content_type="text/html; charset=utf-8")


@require_GET
def favicon(request):
    favicon_path = settings.BASE_DIR / "frontend" / "icons" / "favicon.ico"
    response = FileResponse(favicon_path.open("rb"), content_type="image/x-icon")
    response["Cache-Control"] = "public, max-age=86400"
    return response


@require_GET
def manifest(request):
    manifest_path = settings.BASE_DIR / "frontend" / "manifest.webmanifest"
    response = FileResponse(manifest_path.open("rb"), content_type="application/manifest+json")
    response["Cache-Control"] = "public, max-age=3600"
    return response


@require_GET
def service_worker(request):
    sw_path = settings.BASE_DIR / "frontend" / "sw.js"
    response = FileResponse(sw_path.open("rb"), content_type="application/javascript; charset=utf-8")
    response["Cache-Control"] = "no-cache"
    response["Service-Worker-Allowed"] = "/"
    return response


@require_GET
def health(request):
    return JsonResponse({"status": "ok"})


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


def _get_owned_entry(request, entry_id) -> VaultEntry | None:
    """Retourne une entrée uniquement si elle appartient à l'utilisateur connecté."""
    return VaultEntry.objects.filter(id=entry_id, owner=request.vault_user).first()


@csrf_exempt
@require_auth
def vault_entries(request):
    """Liste (GET) ou crée (POST) des entrées chiffrées du coffre."""
    if request.method == "GET":
        entries = VaultEntry.objects.filter(owner=request.vault_user)
        return JsonResponse([_entry_response(e) for e in entries], safe=False)
    if request.method == "POST":
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return api_error("Corps JSON invalide", 400)

        encrypted = data.get("encrypted_data")
        if not encrypted:
            return api_error("encrypted_data requis", 400)
        raw = _decode_encrypted_blob(encrypted)
        if isinstance(raw, str):
            return api_error(raw, 400)

        entry = VaultEntry.objects.create(
            owner=request.vault_user,
            encrypted_data=raw,
        )
        return JsonResponse(_entry_response(entry), status=201)
    return api_error("Méthode non autorisée", 405)


@require_auth
@require_GET
def get_entry(request, entry_id):
    entry = _get_owned_entry(request, entry_id)
    if not entry:
        return api_error("Entrée introuvable", 404)
    return JsonResponse(_entry_response(entry))


@csrf_exempt
@require_auth
@require_http_methods(["PUT"])
def update_entry(request, entry_id):
    entry = _get_owned_entry(request, entry_id)
    if not entry:
        return api_error("Entrée introuvable", 404)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    encrypted = data.get("encrypted_data")
    if not encrypted:
        return api_error("encrypted_data requis", 400)
    raw = _decode_encrypted_blob(encrypted)
    if isinstance(raw, str):
        return api_error(raw, 400)

    entry.encrypted_data = raw
    entry.save(update_fields=["encrypted_data", "updated_at"])
    return JsonResponse(_entry_response(entry))


@csrf_exempt
@require_auth
def entry_detail(request, entry_id):
    """Détail (GET), mise à jour (PUT) ou suppression (DELETE) d'une entrée."""
    if request.method == "GET":
        return get_entry(request, entry_id)
    if request.method == "PUT":
        return update_entry(request, entry_id)
    if request.method == "DELETE":
        entry = _get_owned_entry(request, entry_id)
        if not entry:
            return api_error("Entrée introuvable", 404)
        entry.delete()
        return HttpResponse(status=204)
    return api_error("Méthode non autorisée", 405)


@require_auth
@require_GET
@rate_limit("auth-lookup", limit=30, window_seconds=60)
def lookup_user(request):
    """Clé publique d'un utilisateur (pour partage), sans secrets."""
    email = (request.GET.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return api_error("Email invalide", 400)
    user = VaultUser.objects.filter(email__iexact=email).first()
    if not user:
        return api_error("Utilisateur introuvable", 404)
    if user.id == request.vault_user.id:
        return api_error("Vous ne pouvez pas partager avec vous-même", 400)
    return JsonResponse({
        "user_id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "public_key": b64_encode(user.public_key),
    })


@csrf_exempt
@require_auth
@rate_limit("vault-shares", limit=40, window_seconds=60)
def vault_shares(request):
    """Crée un partage (POST)."""
    if request.method != "POST":
        return api_error("Méthode non autorisée", 405)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    entry_id = (data.get("entry_id") or "").strip()
    recipient_email = (data.get("recipient_email") or "").strip().lower()
    encrypted = data.get("encrypted_data")

    if not entry_id or not recipient_email or not encrypted:
        return api_error("entry_id, recipient_email et encrypted_data requis", 400)

    entry = _get_owned_entry(request, entry_id)
    if not entry:
        return api_error("Entrée introuvable", 404)

    recipient = VaultUser.objects.filter(email__iexact=recipient_email).first()
    if not recipient:
        return api_error("Destinataire introuvable", 404)
    if recipient.id == request.vault_user.id:
        return api_error("Vous ne pouvez pas partager avec vous-même", 400)

    raw = _decode_encrypted_blob(encrypted)
    if isinstance(raw, str):
        return api_error(raw, 400)

    share, created = VaultShare.objects.update_or_create(
        entry=entry,
        recipient=recipient,
        defaults={
            "sender": request.vault_user,
            "encrypted_data": raw,
        },
    )
    status = 201 if created else 200
    return JsonResponse(_share_sent_response(share), status=status)


@require_auth
@require_GET
def shares_received(request):
    shares = (
        VaultShare.objects
        .filter(recipient=request.vault_user)
        .select_related("sender")
    )
    return JsonResponse([_share_received_response(s) for s in shares], safe=False)


@require_auth
@require_GET
def shares_sent(request):
    shares = (
        VaultShare.objects
        .filter(sender=request.vault_user)
        .select_related("recipient")
    )
    return JsonResponse([_share_sent_response(s) for s in shares], safe=False)


@csrf_exempt
@require_auth
@require_http_methods(["DELETE"])
def share_detail(request, share_id):
    """Révocation (émetteur) ou suppression (destinataire)."""
    share = VaultShare.objects.filter(
        Q(id=share_id),
        Q(sender=request.vault_user) | Q(recipient=request.vault_user),
    ).first()
    if not share:
        return api_error("Partage introuvable", 404)
    share.delete()
    return HttpResponse(status=204)


@require_GET
@rate_limit("vault-favicon", limit=60, window_seconds=60)
def site_favicon(request):
    """Proxy local du favicon public d'un site (usage identique à un navigateur)."""
    page_url = request.GET.get("url", "").strip()
    normalized = normalize_page_url(page_url)
    if not normalized:
        return HttpResponse(status=400)

    result = fetch_site_favicon(normalized)
    if not result:
        # Miss court côté navigateur pour réessayer sans saturer.
        response = HttpResponse(status=404)
        response["Cache-Control"] = "public, max-age=60"
        return response

    content, content_type = result
    response = HttpResponse(content, content_type=content_type)
    # Cache navigateur agressif : le domaine ne repart pas vers des tiers depuis le client.
    response["Cache-Control"] = "public, max-age=604800, stale-while-revalidate=86400"
    response["X-Content-Type-Options"] = "nosniff"
    digest = hashlib.sha256(content).hexdigest()[:32]
    response["ETag"] = f'"{digest}"'
    if_none_match = (request.META.get("HTTP_IF_NONE_MATCH") or "").strip()
    if if_none_match == response["ETag"]:
        return HttpResponse(status=304)
    return response
