from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("vault", "0007_vaultuser_passphrase"),
    ]

    operations = [
        migrations.AddField(
            model_name="vaultuser",
            name="totp_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="vaultuser",
            name="totp_secret",
            field=models.BinaryField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="vaultuser",
            name="totp_pending_secret",
            field=models.BinaryField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="vaultuser",
            name="totp_last_step",
            field=models.BigIntegerField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="VaultTotpBackupCode",
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
                ("code_hash", models.BinaryField()),
                ("used", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(
                        db_column="user_id",
                        on_delete=models.deletion.CASCADE,
                        related_name="totp_backup_codes",
                        to="vault.vaultuser",
                    ),
                ),
            ],
            options={
                "db_table": "vault_totp_backup_codes",
                "ordering": ["created_at"],
            },
        ),
    ]
