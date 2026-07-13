"""Chiffrement AES-256-GCM pour le coffre."""

import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_SIZE = 12


def encrypt_bytes(plaintext: bytes, key: bytes) -> bytes:
    """Chiffre des bytes avec AES-256-GCM. Retourne nonce + ciphertext."""
    nonce = os.urandom(NONCE_SIZE)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)
    return nonce + ciphertext


def decrypt_bytes(encrypted: bytes, key: bytes) -> bytes:
    """Déchiffre des bytes (nonce + ciphertext)."""
    nonce = encrypted[:NONCE_SIZE]
    ciphertext = encrypted[NONCE_SIZE:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, None)


def encrypt_data(data: dict[str, Any], key: bytes) -> bytes:
    """Chiffre un dictionnaire JSON."""
    plaintext = json.dumps(data, ensure_ascii=False).encode("utf-8")
    return encrypt_bytes(plaintext, key)


def decrypt_data(encrypted: bytes, key: bytes) -> dict[str, Any]:
    """Déchiffre un dictionnaire JSON."""
    plaintext = decrypt_bytes(encrypted, key)
    return json.loads(plaintext.decode("utf-8"))


def generate_vault_key() -> bytes:
    """Génère une clé de coffre aléatoire de 256 bits."""
    return os.urandom(32)
