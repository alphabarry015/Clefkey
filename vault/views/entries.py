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

from ._helpers import MAX_ENCRYPTED_ENTRY_BYTES, _decode_encrypted_blob, _entry_response

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
