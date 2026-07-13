"""Vues HTTP de BINALPH93 (auth, entrées chiffrées, favicons, PWA)."""

import hashlib
import hmac
import json

from django.conf import settings
from django.http import FileResponse, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .auth import b64_decode, b64_encode, create_access_token
from .crypto.password_gen import generate_password
from .decorators import api_error, require_auth
from .favicon import fetch_site_favicon, normalize_page_url
from .models import VaultEntry, VaultUser
from .ratelimit import rate_limit

# Taille max d'un blob d'entrée (décodé) — limite DoS / stockage.
MAX_ENCRYPTED_ENTRY_BYTES = 256 * 1024
# Sel factice 16 octets pour réponses /auth/salt sans révéler l'existence d'un compte.
SALT_SIZE = 16
_DUMMY_AUTH_VERIFIER = b"\x00" * 32


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


def _dummy_salt_for_email(email: str) -> bytes:
    """Sel déterministe pour emails inconnus (anti-énumération, même format que les vrais)."""
    digest = hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        f"salt:{email}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return digest[:SALT_SIZE]


def _profile_payload(user: VaultUser, entries_count: int | None = None) -> dict:
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


def index(request):
    index_path = settings.BASE_DIR / "frontend" / "index.html"
    return FileResponse(index_path.open("rb"), content_type="text/html; charset=utf-8")


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

    user = VaultUser.objects.create(
        email=email,
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        display_name="",
        salt=b64_decode(data["salt"]),
        auth_verifier=b64_decode(data["auth_verifier"]),
        encrypted_vault_key=b64_decode(data["encrypted_vault_key"]),
        public_key=b64_decode(data["public_key"]),
        encrypted_private_key=b64_decode(data["encrypted_private_key"]),
    )
    return JsonResponse(_auth_response(user), status=201)


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


@csrf_exempt
@require_http_methods(["POST"])
@require_auth
@rate_limit("vault-generate-password", limit=30, window_seconds=60)
def generate_password_view(request):
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    length = int(data.get("length", 20))
    length = max(12, min(64, length))
    return JsonResponse({"password": generate_password(length)})


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
        return HttpResponse(status=404)

    content, content_type = result
    response = HttpResponse(content, content_type=content_type)
    response["Cache-Control"] = "public, max-age=86400"
    response["X-Content-Type-Options"] = "nosniff"
    return response
