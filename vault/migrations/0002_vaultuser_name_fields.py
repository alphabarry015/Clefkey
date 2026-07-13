from django.db import migrations, models


def split_display_names(apps, schema_editor):
    VaultUser = apps.get_model("vault", "VaultUser")
    for user in VaultUser.objects.all():
        parts = (user.display_name or "").split()
        if len(parts) >= 2:
            user.first_name = parts[0]
            user.last_name = parts[-1]
            user.middle_name = " ".join(parts[1:-1])
        elif parts:
            user.first_name = parts[0]
            user.last_name = ""
            user.middle_name = ""
        else:
            user.first_name = ""
            user.last_name = ""
            user.middle_name = ""
        user.save(update_fields=["first_name", "middle_name", "last_name"])


class Migration(migrations.Migration):
    dependencies = [
        ("vault", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="vaultuser",
            name="first_name",
            field=models.CharField(default="", max_length=50),
        ),
        migrations.AddField(
            model_name="vaultuser",
            name="middle_name",
            field=models.CharField(blank=True, default="", max_length=50),
        ),
        migrations.AddField(
            model_name="vaultuser",
            name="last_name",
            field=models.CharField(default="", max_length=50),
        ),
        migrations.RunPython(split_display_names, migrations.RunPython.noop),
    ]
