"""Smoke API auth : salt anti-énumération, register + login."""

import hashlib
import os

from django.test import Client, TestCase, override_settings

from vault.auth import b64_encode
from vault.crypto.kdf import create_auth_verifier, derive_key, generate_salt
from vault.crypto.keys import generate_keypair
from vault.crypto.vault_crypto import encrypt_bytes, generate_vault_key
from vault.models import VaultRecoveryKey, VaultUser
from vault.views import RECOVERY_KEY_COUNT


def _recovery_packages(vault_key: bytes) -> list[dict]:
    proof = hashlib.sha256(b"gardefort-recovery-proof-v1" + vault_key).digest()
    packages = []
    for _ in range(RECOVERY_KEY_COUNT):
        secret = os.urandom(32)
        wrap = hashlib.sha256(b"gardefort-recovery-wrap-v1" + secret).digest()
        verifier = hashlib.sha256(b"gardefort-recovery-verify-v1" + secret).digest()
        packages.append({
            "verifier": b64_encode(verifier),
            "encrypted_vault_key": b64_encode(encrypt_bytes(vault_key, wrap)),
            "key_proof": b64_encode(proof),
        })
    return packages


@override_settings(
    SECRET_KEY="test-secret-key-for-auth-api",
    RATE_LIMIT_REQUIRE_UPSTASH=False,
)
class AuthApiSmokeTests(TestCase):
    def setUp(self):
        self.client = Client()

    def test_salt_same_shape_for_unknown_email(self):
        r1 = self.client.get("/auth/salt", {"email": "unknown@example.com"})
        r2 = self.client.get("/auth/salt", {"email": "unknown@example.com"})
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.json()["salt"], r2.json()["salt"])
        self.assertTrue(r1.json()["salt"])

    def test_register_and_login(self):
        salt = generate_salt()
        master = "MotDePasseFort-Audit99!"
        derived = derive_key(master, salt)
        auth_verifier = create_auth_verifier(derived)
        vault_key = generate_vault_key()
        private_key, public_key = generate_keypair()
        encrypted_vault_key = encrypt_bytes(vault_key, derived)
        encrypted_private = encrypt_bytes(private_key, vault_key)

        payload = {
            "email": "user@example.com",
            "first_name": "Ada",
            "last_name": "Lovelace",
            "salt": b64_encode(salt),
            "auth_verifier": b64_encode(auth_verifier),
            "encrypted_vault_key": b64_encode(encrypted_vault_key),
            "public_key": b64_encode(public_key),
            "encrypted_private_key": b64_encode(encrypted_private),
            "recovery_keys": _recovery_packages(vault_key),
        }
        reg = self.client.post(
            "/auth/register",
            data=payload,
            content_type="application/json",
        )
        self.assertEqual(reg.status_code, 201, reg.content)
        self.assertIn("access_token", reg.json())
        self.assertEqual(VaultRecoveryKey.objects.filter(user__email="user@example.com").count(), 7)

        login = self.client.post(
            "/auth/login",
            data={
                "email": "user@example.com",
                "auth_verifier": b64_encode(auth_verifier),
            },
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200, login.content)
        self.assertIn("access_token", login.json())

    def test_login_unknown_user_uniform_error(self):
        r = self.client.post(
            "/auth/login",
            data={
                "email": "nobody@example.com",
                "auth_verifier": b64_encode(os.urandom(32)),
            },
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 401)
        self.assertIn("Identifiants", r.json()["detail"])

    def test_register_duplicate_email(self):
        VaultUser.objects.create(
            email="dup@example.com",
            first_name="X",
            last_name="Y",
            display_name="X Y",
            salt=os.urandom(16),
            auth_verifier=os.urandom(32),
            encrypted_vault_key=os.urandom(60),
            public_key=os.urandom(32),
            encrypted_private_key=os.urandom(80),
        )
        salt = generate_salt()
        derived = derive_key("AutreMdp-Fort99!!", salt)
        vault_key = generate_vault_key()
        private_key, public_key = generate_keypair()
        payload = {
            "email": "dup@example.com",
            "first_name": "A",
            "last_name": "B",
            "salt": b64_encode(salt),
            "auth_verifier": b64_encode(create_auth_verifier(derived)),
            "encrypted_vault_key": b64_encode(encrypt_bytes(vault_key, derived)),
            "public_key": b64_encode(public_key),
            "encrypted_private_key": b64_encode(encrypt_bytes(private_key, vault_key)),
            "recovery_keys": _recovery_packages(vault_key),
        }
        r = self.client.post("/auth/register", data=payload, content_type="application/json")
        self.assertEqual(r.status_code, 409)
