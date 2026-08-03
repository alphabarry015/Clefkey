-- =============================================================================
-- Clefkey. — Schéma PostgreSQL (Supabase)
-- =============================================================================
-- Où exécuter : Supabase Dashboard → SQL Editor → New query → Run
--
-- Méthode recommandée :
--   1. Renseigner DATABASE_URL + DIRECT_DATABASE_URL dans .env
--   2. En local : python manage.py migrate
--   (Le build Vercel ne lance PAS migrate — IPv6 / pooler ; appliquer le schéma
--    ici ou via migrate en local contre DIRECT_DATABASE_URL.)
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

CREATE TABLE IF NOT EXISTS vault_shares (
    id             VARCHAR(36) PRIMARY KEY,
    entry_id       VARCHAR(36) REFERENCES vault_entries (id) ON DELETE SET NULL,
    sender_id      VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recipient_id   VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    encrypted_data BYTEA       NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS vault_shares_entry_recipient_uniq
    ON vault_shares (entry_id, recipient_id)
    WHERE entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vault_shares_sender_id_idx ON vault_shares (sender_id);
CREATE INDEX IF NOT EXISTS vault_shares_recipient_id_idx ON vault_shares (recipient_id);
CREATE INDEX IF NOT EXISTS vault_shares_created_at_idx ON vault_shares (created_at DESC);

CREATE TABLE IF NOT EXISTS vault_recovery_keys (
    id                   VARCHAR(36) PRIMARY KEY,
    user_id              VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    slot                 SMALLINT    NOT NULL CHECK (slot BETWEEN 1 AND 7),
    verifier             BYTEA       NOT NULL UNIQUE,
    encrypted_vault_key  BYTEA       NOT NULL,
    -- Stocké scellé côté Django : HMAC(SECRET_KEY, SHA-256(domaine||vaultKey))
    key_proof            BYTEA       NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, slot)
);

CREATE INDEX IF NOT EXISTS vault_recovery_keys_user_id_idx ON vault_recovery_keys (user_id);

-- ---------------------------------------------------------------------------
-- RLS : tables Django exposées via le schéma public PostgREST.
-- Aucune policy = deny-all pour anon / authenticated.
-- Django (rôle propriétaire / connexion directe) contourne RLS sauf FORCE.
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_recovery_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE users FROM anon, authenticated;
REVOKE ALL ON TABLE vault_entries FROM anon, authenticated;
REVOKE ALL ON TABLE vault_shares FROM anon, authenticated;
REVOKE ALL ON TABLE vault_recovery_keys FROM anon, authenticated;

COMMIT;

-- Si une table existait déjà SANS ON DELETE CASCADE, exécutez aussi :
--   supabase/fix_delete_cascade.sql
--
-- Vérification :
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('users', 'vault_entries', 'vault_shares', 'vault_recovery_keys');
