import base64
import uuid

from django.db import models


class VaultUser(models.Model):
    id = models.CharField(primary_key=True, max_length=36, default=uuid.uuid4, editable=False)
    email = models.EmailField(max_length=255, unique=True, db_index=True)
    first_name = models.CharField(max_length=50, default="")
    middle_name = models.CharField(max_length=50, blank=True, default="")
    last_name = models.CharField(max_length=50, default="")
    display_name = models.CharField(max_length=100)
    salt = models.BinaryField()
    auth_verifier = models.BinaryField()
    encrypted_vault_key = models.BinaryField()
    public_key = models.BinaryField()
    encrypted_private_key = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "users"
        ordering = ["-created_at"]

    def build_display_name(self) -> str:
        parts = [self.first_name.strip(), self.middle_name.strip(), self.last_name.strip()]
        return " ".join(part for part in parts if part)[:100]

    def save(self, *args, **kwargs):
        self.display_name = self.build_display_name() or self.display_name
        super().save(*args, **kwargs)

    def __str__(self):
        return self.display_name


class VaultEntry(models.Model):
    id = models.CharField(primary_key=True, max_length=36, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        VaultUser,
        on_delete=models.CASCADE,
        related_name="entries",
        db_column="owner_id",
    )
    encrypted_data = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "vault_entries"
        ordering = ["-updated_at"]

    def __str__(self):
        return f"Entrée {self.id}"
