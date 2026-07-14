"""Modèles persistants. Les secrets restent chiffrés côté client (zero-knowledge)."""

import uuid

from django.db import models


class VaultUser(models.Model):
    id = models.CharField(primary_key=True, max_length=36, default=lambda: str(uuid.uuid4()), editable=False)
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
    id = models.CharField(primary_key=True, max_length=36, default=lambda: str(uuid.uuid4()), editable=False)
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


class VaultShare(models.Model):
    """Copie chiffrée d'une entrée destinée à un autre utilisateur (zero-knowledge)."""

    id = models.CharField(primary_key=True, max_length=36, default=lambda: str(uuid.uuid4()), editable=False)
    entry = models.ForeignKey(
        VaultEntry,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="shares",
        db_column="entry_id",
    )
    sender = models.ForeignKey(
        VaultUser,
        on_delete=models.CASCADE,
        related_name="shares_sent",
        db_column="sender_id",
    )
    recipient = models.ForeignKey(
        VaultUser,
        on_delete=models.CASCADE,
        related_name="shares_received",
        db_column="recipient_id",
    )
    encrypted_data = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "vault_shares"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["entry", "recipient"],
                name="vault_shares_entry_recipient_uniq",
            ),
        ]

    def __str__(self):
        return f"Partage {self.id}"


class VaultRecoveryKey(models.Model):
    """
    Copie de vaultKey chiffrée par une clé de récupération (entropie 256 bits).
    Le serveur ne stocke que le vérificateur (hash) et le blob — jamais la clé.
    """

    RECOVERY_KEY_COUNT = 7

    id = models.CharField(primary_key=True, max_length=36, default=lambda: str(uuid.uuid4()), editable=False)
    user = models.ForeignKey(
        VaultUser,
        on_delete=models.CASCADE,
        related_name="recovery_keys",
        db_column="user_id",
    )
    slot = models.PositiveSmallIntegerField()
    verifier = models.BinaryField(unique=True)
    encrypted_vault_key = models.BinaryField()
    # HMAC serveur de SHA-256(domaine || vaultKey) — prouve la vaultKey au reset
    # sans stocker la preuve brute (un dump DB ne suffit plus pour complete).
    key_proof = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "vault_recovery_keys"
        ordering = ["slot"]
        constraints = [
            models.UniqueConstraint(fields=["user", "slot"], name="vault_recovery_user_slot_uniq"),
            models.CheckConstraint(
                condition=models.Q(slot__gte=1) & models.Q(slot__lte=7),
                name="vault_recovery_slot_range",
            ),
        ]

    def __str__(self):
        return f"Recovery {self.user_id}#{self.slot}"
