"""Passe les key_proof scellés (32 o HMAC) au format v2 (préfixe \\x01 + digest)."""

from django.db import migrations

_PREFIX = b"\x01"


def upgrade_key_proof_format(apps, schema_editor):
    VaultRecoveryKey = apps.get_model("vault", "VaultRecoveryKey")
    for row in VaultRecoveryKey.objects.iterator():
        stored = bytes(row.key_proof)
        if stored.startswith(_PREFIX):
            continue
        if len(stored) != 32:
            continue
        row.key_proof = _PREFIX + stored
        row.save(update_fields=["key_proof"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("vault", "0005_fk_on_delete_cascade"),
    ]

    operations = [
        migrations.RunPython(upgrade_key_proof_format, noop_reverse),
    ]
