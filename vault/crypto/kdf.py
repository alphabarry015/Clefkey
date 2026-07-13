"""Dérivation de clé avec Argon2id."""

import os

from argon2.low_level import Type, hash_secret_raw

SALT_SIZE = 16
KEY_SIZE = 32
MEMORY_COST = 65536  # 64 Mo
TIME_COST = 3
PARALLELISM = 4


def generate_salt() -> bytes:
    return os.urandom(SALT_SIZE)


def derive_key(master_password: str, salt: bytes) -> bytes:
    """Dérive une clé de 256 bits à partir du mot de passe maître."""
    return hash_secret_raw(
        secret=master_password.encode("utf-8"),
        salt=salt,
        time_cost=TIME_COST,
        memory_cost=MEMORY_COST,
        parallelism=PARALLELISM,
        hash_len=KEY_SIZE,
        type=Type.ID,
    )


def create_auth_verifier(derived_key: bytes) -> bytes:
    """Crée un vérificateur d'authentification (HMAC-like via hash)."""
    import hashlib

    return hashlib.sha256(derived_key + b"auth_verifier").digest()
