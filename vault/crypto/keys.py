"""Gestion des clés X25519 pour le chiffrement du coffre."""

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

from .vault_crypto import decrypt_bytes, encrypt_bytes


def generate_keypair() -> tuple[bytes, bytes]:
    """Génère une paire de clés X25519. Retourne (private_key_bytes, public_key_bytes)."""
    private_key = X25519PrivateKey.generate()
    public_key = private_key.public_key()
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return private_bytes, public_bytes


def encrypt_private_key(private_key: bytes, vault_key: bytes) -> bytes:
    """Chiffre la clé privée X25519 avec la clé de coffre."""
    return encrypt_bytes(private_key, vault_key)


def decrypt_private_key(encrypted: bytes, vault_key: bytes) -> bytes:
    """Déchiffre la clé privée X25519."""
    return decrypt_bytes(encrypted, vault_key)
