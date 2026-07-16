"""Rescelle les key_proof recovery au format v2 (préfixe + HMAC)."""

from django.core.management.base import BaseCommand

from vault.models import VaultRecoveryKey
from vault.views import KEY_PROOF_SEAL_PREFIX, _seal_key_proof


class Command(BaseCommand):
    help = (
        "Met à jour les key_proof recovery vers le format v2. "
        "Par défaut, préfixe les digests HMAC 32 o déjà scellés. "
        "Utiliser --legacy-raw uniquement si des preuves brutes (pré-HMAC) subsistent en DB."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Affiche les changements sans écrire en base.",
        )
        parser.add_argument(
            "--legacy-raw",
            action="store_true",
            help="Traite les valeurs 32 o sans préfixe comme preuves client brutes (reseal HMAC).",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        legacy_raw = options["legacy_raw"]
        updated = 0
        skipped = 0

        for row in VaultRecoveryKey.objects.iterator():
            stored = bytes(row.key_proof)
            if stored.startswith(KEY_PROOF_SEAL_PREFIX):
                skipped += 1
                continue
            if len(stored) != 32:
                self.stderr.write(
                    f"Ignoré user={row.user_id} slot={row.slot} : taille {len(stored)} inattendue"
                )
                skipped += 1
                continue

            new_value = _seal_key_proof(stored) if legacy_raw else KEY_PROOF_SEAL_PREFIX + stored
            if dry_run:
                self.stdout.write(f"[dry-run] user={row.user_id} slot={row.slot} -> format v2")
            else:
                row.key_proof = new_value
                row.save(update_fields=["key_proof"])
            updated += 1

        prefix = "[dry-run] " if dry_run else ""
        mode = "legacy-raw" if legacy_raw else "prefix"
        self.stdout.write(
            self.style.SUCCESS(f"{prefix}Terminé ({mode}) : {updated} mis à jour, {skipped} ignorés.")
        )
