"""Génération de mots de passe sécurisés."""

import secrets
import string


def generate_password(length: int = 20) -> str:
    """Génère un mot de passe aléatoire cryptographiquement sûr."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))
