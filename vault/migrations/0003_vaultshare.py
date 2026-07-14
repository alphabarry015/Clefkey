import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("vault", "0002_vaultuser_name_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="VaultShare",
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
                ("encrypted_data", models.BinaryField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "entry",
                    models.ForeignKey(
                        blank=True,
                        db_column="entry_id",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="shares",
                        to="vault.vaultentry",
                    ),
                ),
                (
                    "recipient",
                    models.ForeignKey(
                        db_column="recipient_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="shares_received",
                        to="vault.vaultuser",
                    ),
                ),
                (
                    "sender",
                    models.ForeignKey(
                        db_column="sender_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="shares_sent",
                        to="vault.vaultuser",
                    ),
                ),
            ],
            options={
                "db_table": "vault_shares",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="vaultshare",
            constraint=models.UniqueConstraint(
                fields=("entry", "recipient"),
                name="vault_shares_entry_recipient_uniq",
            ),
        ),
    ]
