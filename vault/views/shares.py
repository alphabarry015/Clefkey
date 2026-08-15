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
    MAX_ENCRYPTED_ENTRY_BYTES,
    PUBLIC_KEY_SIZE,
    _decode_encrypted_blob,
    _decode_fixed_b64,
    _share_received_response,
    _share_sent_response,
)
from .entries import _get_owned_entry

@require_auth
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
