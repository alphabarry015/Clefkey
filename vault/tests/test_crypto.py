"""Smoke tests crypto serveur (alignés avec le client)."""

from django.test import SimpleTestCase

from vault.crypto.kdf import create_auth_verifier, derive_key, generate_salt
from vault.crypto.vault_crypto import decrypt_data, encrypt_data, generate_vault_key


class CryptoSmokeTests(SimpleTestCase):
    def test_encrypt_decrypt_roundtrip(self):
        key = generate_vault_key()
        payload = {"site": "example.com", "password": "s3cret"}
        blob = encrypt_data(payload, key)
        self.assertNotEqual(blob, b"")
        self.assertEqual(decrypt_data(blob, key), payload)

    def test_wrong_key_fails(self):
        key = generate_vault_key()
        other = generate_vault_key()
        blob = encrypt_data({"a": 1}, key)
        with self.assertRaises(Exception):
            decrypt_data(blob, other)

    def test_auth_verifier_deterministic(self):
        salt = generate_salt()
        derived = derive_key("MotDePasseTest-12!", salt)
        v1 = create_auth_verifier(derived)
        v2 = create_auth_verifier(derived)
        self.assertEqual(v1, v2)
        self.assertEqual(len(v1), 32)
        self.assertNotEqual(v1, derived)
