"""Tests récupération : scellement key_proof + parsing paquets."""

import os

from django.test import SimpleTestCase, TestCase, override_settings

from vault.auth import b64_encode
from vault.models import VaultRecoveryKey, VaultUser
from vault.views import (
    KEY_PROOF_SEAL_PREFIX,
    RECOVERY_KEY_COUNT,
    _key_proof_matches,
    _parse_recovery_packages,
    _save_recovery_keys,
    _seal_key_proof,
)


def _pkg(verifier=None, blob=None, proof=None):
    return {
        "verifier": b64_encode(verifier or os.urandom(32)),
        "encrypted_vault_key": b64_encode(blob or os.urandom(60)),
        "key_proof": b64_encode(proof or os.urandom(32)),
    }


class KeyProofSealTests(SimpleTestCase):
    @override_settings(SECRET_KEY="test-secret-key-for-hmac")
    def test_seal_hides_raw_proof(self):
        raw = os.urandom(32)
        sealed = _seal_key_proof(raw)
        self.assertEqual(len(sealed), 33)
        self.assertTrue(sealed.startswith(KEY_PROOF_SEAL_PREFIX))
        self.assertNotEqual(sealed, raw)
        self.assertTrue(_key_proof_matches(sealed, raw))
        self.assertFalse(_key_proof_matches(sealed, os.urandom(32)))

    @override_settings(SECRET_KEY="test-secret-key-for-hmac")
    def test_rejects_unprefixed_stored_proof(self):
        raw = os.urandom(32)
        self.assertFalse(_key_proof_matches(raw, raw))


class ParseRecoveryPackagesTests(SimpleTestCase):
    def test_requires_exactly_seven(self):
        pkgs = [_pkg() for _ in range(6)]
        err = _parse_recovery_packages(pkgs)
        self.assertIsInstance(err, str)

    def test_accepts_seven_coherent_proofs(self):
        proof = os.urandom(32)
        pkgs = [_pkg(proof=proof) for _ in range(RECOVERY_KEY_COUNT)]
        out = _parse_recovery_packages(pkgs)
        self.assertIsInstance(out, list)
        self.assertEqual(len(out), 7)

    def test_rejects_incoherent_proofs(self):
        pkgs = [_pkg() for _ in range(RECOVERY_KEY_COUNT)]
        err = _parse_recovery_packages(pkgs)
        self.assertIsInstance(err, str)


class SaveRecoveryKeysTests(TestCase):
    @override_settings(SECRET_KEY="test-secret-key-for-hmac")
    def test_stored_proof_is_sealed(self):
        user = VaultUser.objects.create(
            email="rec@test.local",
            first_name="A",
            last_name="B",
            display_name="A B",
            salt=os.urandom(16),
            auth_verifier=os.urandom(32),
            encrypted_vault_key=os.urandom(60),
            public_key=os.urandom(32),
            encrypted_private_key=os.urandom(80),
        )
        raw_proof = os.urandom(32)
        packages = [
            (os.urandom(32), os.urandom(60), raw_proof)
            for _ in range(RECOVERY_KEY_COUNT)
        ]
        _save_recovery_keys(user, packages)
        rows = list(VaultRecoveryKey.objects.filter(user=user).order_by("slot"))
        self.assertEqual(len(rows), 7)
        stored = bytes(rows[0].key_proof)
        self.assertTrue(stored.startswith(KEY_PROOF_SEAL_PREFIX))
        self.assertNotEqual(stored[1:], raw_proof)
        self.assertTrue(_key_proof_matches(stored, raw_proof))
        self.assertFalse(
            any(bytes(r.key_proof) == raw_proof for r in rows)
        )
