-- =============================================================================
-- Gardefort — Activer RLS deny-all sur les tables applicatives (bases existantes)
-- =============================================================================
-- Où exécuter : Supabase Dashboard → SQL Editor → Run
--
-- Django continue d’accéder via DATABASE_URL (rôle propriétaire / pooler).
-- Les rôles Data API `anon` / `authenticated` n’ont plus de lecture directe.
-- =============================================================================

BEGIN;

ALTER TABLE IF EXISTS users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS vault_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS vault_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS vault_recovery_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE users FROM anon, authenticated;
REVOKE ALL ON TABLE vault_entries FROM anon, authenticated;
REVOKE ALL ON TABLE vault_shares FROM anon, authenticated;
REVOKE ALL ON TABLE vault_recovery_keys FROM anon, authenticated;

COMMIT;
