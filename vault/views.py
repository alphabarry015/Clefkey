import json

from django.conf import settings
from django.http import FileResponse, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .auth import b64_decode, b64_encode, create_access_token
from .crypto.password_gen import generate_password
from .decorators import api_error, require_auth
from .models import VaultEntry, VaultUser


def _profile_payload(user: VaultUser, entries_count: int | None = None) -> dict:
    if entries_count is None:
        entries_count = VaultEntry.objects.filter(owner=user).count()
    return {
        "user_id": user.id,
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
    token = create_access_token(user.id, user.email)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user.id,
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
        "id": entry.id,
        "owner_id": entry.owner_id,
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
    if not user:
        return api_error("Identifiants invalides", 401)

    if b64_decode(auth_verifier_b64) != bytes(user.auth_verifier):
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
def get_salt(request):
    email = request.GET.get("email", "").strip().lower()
    if not email:
        return api_error("Email requis", 400)

    user = VaultUser.objects.filter(email=email).first()
    if not user:
        return api_error("Utilisateur introuvable", 404)

    return JsonResponse({"salt": b64_encode(user.salt)})


@require_auth
@require_GET
def list_entries(request):
    entries = VaultEntry.objects.filter(owner=request.vault_user)
    return JsonResponse([_entry_response(e) for e in entries], safe=False)


@csrf_exempt
@require_auth
@require_http_methods(["POST"])
def create_entry(request):
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    encrypted = data.get("encrypted_data")
    if not encrypted:
        return api_error("encrypted_data requis", 400)

    entry = VaultEntry.objects.create(
        owner=request.vault_user,
        encrypted_data=b64_decode(encrypted),
    )
    return JsonResponse(_entry_response(entry), status=201)


@require_auth
@require_GET
def get_entry(request, entry_id):
    entry = VaultEntry.objects.filter(id=entry_id).first()
    if not entry:
        return api_error("Entrée introuvable", 404)
    if entry.owner_id != request.vault_user.id:
        return api_error("Accès refusé", 403)
    return JsonResponse(_entry_response(entry))


@csrf_exempt
@require_auth
@require_http_methods(["PUT"])
def update_entry(request, entry_id):
    entry = VaultEntry.objects.filter(id=entry_id).first()
    if not entry:
        return api_error("Entrée introuvable", 404)
    if entry.owner_id != request.vault_user.id:
        return api_error("Modification interdite", 403)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    encrypted = data.get("encrypted_data")
    if not encrypted:
        return api_error("encrypted_data requis", 400)

    entry.encrypted_data = b64_decode(encrypted)
    entry.save(update_fields=["encrypted_data", "updated_at"])
    return JsonResponse(_entry_response(entry))


@csrf_exempt
@require_auth
def entry_detail(request, entry_id):
    if request.method == "GET":
        return get_entry(request, entry_id)
    if request.method == "PUT":
        return update_entry(request, entry_id)
    if request.method == "DELETE":
        entry = VaultEntry.objects.filter(id=entry_id).first()
        if not entry:
            return api_error("Entrée introuvable", 404)
        if entry.owner_id != request.vault_user.id:
            return api_error("Suppression interdite", 403)
        entry.delete()
        return HttpResponse(status=204)
    return api_error("Méthode non autorisée", 405)


@csrf_exempt
@require_http_methods(["POST"])
def generate_password_view(request):
    try:
        data = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return api_error("Corps JSON invalide", 400)

    length = int(data.get("length", 20))
    length = max(12, min(64, length))
    return JsonResponse({"password": generate_password(length)})
