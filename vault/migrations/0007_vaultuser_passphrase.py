from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("vault", "0006_key_proof_seal_v2"),
    ]

    operations = [
        migrations.AddField(
            model_name="vaultuser",
            name="passphrase_salt",
            field=models.BinaryField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="vaultuser",
            name="passphrase_verifier",
            field=models.BinaryField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="vaultuser",
            name="encrypted_vault_key_passphrase",
            field=models.BinaryField(blank=True, null=True),
        ),
    ]
