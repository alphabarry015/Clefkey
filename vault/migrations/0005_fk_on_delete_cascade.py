from django.db import migrations


SQL_POSTGRES = """
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.conname, c.conrelid::regclass AS tbl
        FROM pg_constraint c
        JOIN pg_class rel ON rel.oid = c.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE c.contype = 'f'
          AND nsp.nspname = 'public'
          AND rel.relname IN ('vault_recovery_keys', 'vault_shares', 'vault_entries')
          AND c.confrelid = 'public.users'::regclass
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
    END LOOP;

    ALTER TABLE vault_recovery_keys
      ADD CONSTRAINT vault_recovery_keys_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

    ALTER TABLE vault_shares
      ADD CONSTRAINT vault_shares_sender_id_fkey
      FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE;

    ALTER TABLE vault_shares
      ADD CONSTRAINT vault_shares_recipient_id_fkey
      FOREIGN KEY (recipient_id) REFERENCES users (id) ON DELETE CASCADE;

    ALTER TABLE vault_entries
      ADD CONSTRAINT vault_entries_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE;
END $$;
"""


def apply_cascade(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        # SQLite (tests CI) : les FK Django sont déjà en CASCADE via les modèles.
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(SQL_POSTGRES)


class Migration(migrations.Migration):
    """Assure ON DELETE CASCADE sur les FK vers users (bases Postgres créées sans CASCADE)."""

    dependencies = [
        ("vault", "0004_vaultrecoverykey"),
    ]

    operations = [
        migrations.RunPython(apply_cascade, migrations.RunPython.noop),
    ]
