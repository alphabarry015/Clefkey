import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("vault", "0003_vaultshare"),
    ]

    operations = [
        migrations.CreateModel(
            name="VaultRecoveryKey",
            fields=[
                (
                    "id",
                    models.CharField(
                        default=lambda: str(uuid.uuid4()),
                        editable=False,
                        max_length=36,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("slot", models.PositiveSmallIntegerField()),
                ("verifier", models.BinaryField(unique=True)),
                ("encrypted_vault_key", models.BinaryField()),
                ("key_proof", models.BinaryField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        db_column="user_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="recovery_keys",
                        to="vault.vaultuser",
                    ),
                ),
            ],
            options={
                "db_table": "vault_recovery_keys",
                "ordering": ["slot"],
            },
        ),
        migrations.AddConstraint(
            model_name="vaultrecoverykey",
            constraint=models.UniqueConstraint(
                fields=("user", "slot"),
                name="vault_recovery_user_slot_uniq",
            ),
        ),
        migrations.AddConstraint(
            model_name="vaultrecoverykey",
            constraint=models.CheckConstraint(
                condition=models.Q(("slot__gte", 1), ("slot__lte", 7)),
                name="vault_recovery_slot_range",
            ),
        ),
    ]
