"""Configuration Django — Gestionnaire de mots de passe."""

import os
import sys
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR / ".env.local", override=True)

def _is_vercel_runtime() -> bool:
    """Détecte Vercel via plusieurs variables (VERCEL n'est pas toujours à \"1\")."""
    if os.getenv("VERCEL", "").strip() in ("1", "true", "yes"):
        return True
    return bool(
        os.getenv("VERCEL_ENV", "").strip()
        or os.getenv("VERCEL_URL", "").strip()
        or os.getenv("VERCEL_BRANCH_URL", "").strip()
    )


IS_VERCEL = _is_vercel_runtime()


def _default_allowed_hosts() -> list[str]:
    hosts: list[str] = []

    if IS_VERCEL:
        hosts.extend([".vercel.app", ".now.sh"])
        for key in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
            value = os.getenv(key, "").strip()
            if value:
                hosts.append(value)

    hosts.extend(["127.0.0.1", "localhost"])

    extra = os.getenv("ALLOWED_HOSTS", "")
    if extra:
        hosts.extend(host.strip() for host in extra.split(",") if host.strip())

    return list(dict.fromkeys(hosts))


SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-in-production")

DEBUG = os.getenv("DEBUG", "false" if IS_VERCEL else "true").lower() in ("1", "true", "yes")

ALLOWED_HOSTS = _default_allowed_hosts()

if IS_VERCEL:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "vault",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "coffre.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "frontend"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
            ],
        },
    },
]

WSGI_APPLICATION = "coffre.wsgi.application"


def _migration_command_running() -> bool:
    migrate_commands = {"migrate", "makemigrations", "sqlmigrate", "showmigrations", "flush"}
    return any(cmd in sys.argv for cmd in migrate_commands)


def _resolve_database_url() -> str | None:
    """Supabase : pooler (DATABASE_URL) pour l'app, direct (DIRECT_DATABASE_URL) pour les migrations."""
    database_url = os.getenv("DATABASE_URL", "").strip()
    direct_url = os.getenv("DIRECT_DATABASE_URL", "").strip()

    if _migration_command_running():
        return direct_url or database_url or None
    return database_url or None


def _configure_databases() -> dict:
    database_url = _resolve_database_url()
    if database_url:
        conn_max_age = 0 if IS_VERCEL else int(os.getenv("DB_CONN_MAX_AGE", "600"))
        return {
            "default": dj_database_url.parse(
                database_url,
                conn_max_age=conn_max_age,
                conn_health_checks=not IS_VERCEL,
            )
        }

    return {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / os.getenv("SQLITE_NAME", "vault.db"),
        }
    }


DATABASES = _configure_databases()

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATICFILES_DIRS = []

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# JWT (compatible avec l'ancienne API FastAPI)
JWT_ALGORITHM = "HS256"
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
