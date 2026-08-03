-- =============================================================================
-- Clefkey. — Forcer ON DELETE CASCADE sur les FK vers users
-- À exécuter dans Supabase → SQL Editor si la suppression d'un compte échoue.
-- =============================================================================

BEGIN;

-- vault_recovery_keys.user_id → users.id
ALTER TABLE vault_recovery_keys
  DROP CONSTRAINT IF EXISTS vault_recovery_keys_user_id_4982c3b9_fk_users_id;
ALTER TABLE vault_recovery_keys
  DROP CONSTRAINT IF EXISTS vault_recovery_keys_user_id_fkey;
ALTER TABLE vault_recovery_keys
  ADD CONSTRAINT vault_recovery_keys_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

-- vault_shares.sender_id → users.id
ALTER TABLE vault_shares
  DROP CONSTRAINT IF EXISTS vault_shares_sender_id_4d0f5e7e_fk_users_id;
ALTER TABLE vault_shares
  DROP CONSTRAINT IF EXISTS vault_shares_sender_id_fkey;
ALTER TABLE vault_shares
  ADD CONSTRAINT vault_shares_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE;

-- vault_shares.recipient_id → users.id
ALTER TABLE vault_shares
  DROP CONSTRAINT IF EXISTS vault_shares_recipient_id_77e7f7b2_fk_users_id;
ALTER TABLE vault_shares
  DROP CONSTRAINT IF EXISTS vault_shares_recipient_id_fkey;
ALTER TABLE vault_shares
  ADD CONSTRAINT vault_shares_recipient_id_fkey
  FOREIGN KEY (recipient_id) REFERENCES users (id) ON DELETE CASCADE;

-- vault_entries.owner_id → users.id
ALTER TABLE vault_entries
  DROP CONSTRAINT IF EXISTS vault_entries_owner_id_fkey;
ALTER TABLE vault_entries
  DROP CONSTRAINT IF EXISTS vault_entries_owner_id_7d8c0c0e_fk_users_id;
ALTER TABLE vault_entries
  ADD CONSTRAINT vault_entries_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE;

COMMIT;

-- Ensuite, suppression d'un compte (exemple) :
-- DELETE FROM users WHERE id = '224b46d4-ddef-4902-8721-9dac16b960e1';
