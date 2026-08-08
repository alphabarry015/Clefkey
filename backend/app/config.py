import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from jose import jwt

_BASE_DIR = Path(__file__).resolve().parent.parent.parent
_DEBUG = os.getenv("DEBUG", "true").lower() in ("1", "true", "yes")


def _resolve_secret_key() -> str:
    """SECRET_KEY depuis l'env ; en DEBUG, fichier local gitignoré ; sinon erreur."""
    env_key = os.getenv("SECRET_KEY", "").strip()
    if env_key:
        return env_key
    if not _DEBUG:
        raise RuntimeError(
            "SECRET_KEY doit être défini en production (variable d'environnement)."
        )
    secret_path = _BASE_DIR / ".django_secret"
    if secret_path.is_file():
        stored = secret_path.read_text(encoding="utf-8").strip()
        if stored:
            return stored
    generated = secrets.token_urlsafe(48)
    secret_path.write_text(generated + "\n", encoding="utf-8")
    try:
        secret_path.chmod(0o600)
    except OSError:
        pass
    return generated


SECRET_KEY = _resolve_secret_key()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./vault.db")


def create_access_token(user_id: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "email": email, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
