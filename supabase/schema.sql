-- =============================================================================
-- BINALPH93 — Schéma PostgreSQL (Supabase)
-- =============================================================================
-- Où exécuter : Supabase Dashboard → SQL Editor → New query → Run
--
-- Méthode recommandée (plus simple) :
--   1. Renseigner DATABASE_URL dans .env
--   2. Lancer : python manage.py migrate
--   (fait aussi automatiquement au build Vercel)
--
-- Ce fichier SQL est utile si vous préférez créer les tables à la main.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id                    VARCHAR(36)  PRIMARY KEY,
    email                 VARCHAR(255) NOT NULL UNIQUE,
    first_name            VARCHAR(50)  NOT NULL DEFAULT '',
    middle_name           VARCHAR(50)  NOT NULL DEFAULT '',
    last_name             VARCHAR(50)  NOT NULL DEFAULT '',
    display_name          VARCHAR(100) NOT NULL,
    salt                  BYTEA        NOT NULL,
    auth_verifier         BYTEA        NOT NULL,
    encrypted_vault_key   BYTEA        NOT NULL,
    public_key            BYTEA        NOT NULL,
    encrypted_private_key BYTEA        NOT NULL,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS vault_entries (
    id             VARCHAR(36) PRIMARY KEY,
    owner_id       VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    encrypted_data BYTEA       NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vault_entries_owner_id_idx ON vault_entries (owner_id);
CREATE INDEX IF NOT EXISTS vault_entries_updated_at_idx ON vault_entries (updated_at DESC);

COMMIT;

-- Vérification :
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name IN ('users', 'vault_entries');
