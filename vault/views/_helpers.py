"""Helpers et serializers partagés des vues Clefkey."""

import hashlib
import hmac

from django.conf import settings

from ..auth import b64_decode, b64_encode, create_access_token
from ..models import VaultEntry, VaultRecoveryKey, VaultShare, VaultUser

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
