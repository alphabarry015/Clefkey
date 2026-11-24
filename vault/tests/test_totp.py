"""2FA authenticator : le code n'ouvre pas le coffre, seulement la session."""

import time

from django.test import Client, TestCase, override_settings

from vault.auth import b64_encode, create_access_token
from vault.crypto.kdf import create_auth_verifier, derive_key, generate_salt
from vault.crypto.keys import generate_keypair
from vault.crypto.totp import open_secret, totp_at
from vault.crypto.vault_crypto import encrypt_bytes, generate_vault_key
from vault.models import VaultUser


@override_settings(
    SECRET_KEY="test-secret-key-for-auth-api",
    RATE_LIMIT_REQUIRE_UPSTASH=False,
)
class TotpApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.master = "MotDePasseFort-Audit99!"
        self.salt = generate_salt()
        self.derived = derive_key(self.master, self.salt)
        self.auth_verifier = create_auth_verifier(self.derived)
        vault_key = generate_vault_key()
        private_key, public_key = generate_keypair()
        user = VaultUser.objects.create(
            email="totp@example.com",
            first_name="Ada",
            last_name="Lovelace",
            display_name="Ada Lovelace",
            salt=self.salt,
            auth_verifier=self.auth_verifier,
            encrypted_vault_key=encrypt_bytes(vault_key, self.derived),
            public_key=public_key,
            encrypted_private_key=encrypt_bytes(private_key, vault_key),
        )
        self.token = create_access_token(str(user.id), user.email)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {self.token}"}

    def _enable(self) -> list[str]:
        begun = self.client.post("/auth/totp/begin", data={}, content_type="application/json", **self.auth)
        self.assertEqual(begun.status_code, 200, begun.content)
        user = VaultUser.objects.get(email="totp@example.com")
        secret = open_secret(bytes(user.totp_pending_secret))
        code = totp_at(secret, int(time.time()) // 30)
        confirmed = self.client.post(
            "/auth/totp/confirm",
            data={"code": code},
            content_type="application/json",
            **self.auth,
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.content)
        return confirmed.json()["backup_codes"]

    def test_login_asks_for_code_then_opens_session(self):
        self._enable()
        VaultUser.objects.filter(email="totp@example.com").update(totp_last_step=None)
        user = VaultUser.objects.get(email="totp@example.com")
        secret = open_secret(bytes(user.totp_secret))
        code = totp_at(secret, int(time.time()) // 30)

        login = self.client.post(
            "/auth/login",
            data={"email": "totp@example.com", "auth_verifier": b64_encode(self.auth_verifier)},
            content_type="application/json",
        )
        self.assertEqual(login.status_code, 200, login.content)
        body = login.json()
        self.assertTrue(body["totp_required"])
        self.assertNotIn("access_token", body)
        self.assertNotIn("encrypted_vault_key", body)

        blocked = self.client.get("/auth/me", HTTP_AUTHORIZATION=f"Bearer {body['totp_token']}")
        self.assertEqual(blocked.status_code, 401)

        opened = self.client.post(
            "/auth/login/totp",
            data={"totp_token": body["totp_token"], "code": code},
            content_type="application/json",
        )
        self.assertEqual(opened.status_code, 200, opened.content)
        self.assertIn("access_token", opened.json())
        self.assertIn("encrypted_vault_key", opened.json())

        replay = self.client.post(
            "/auth/login",
            data={"email": "totp@example.com", "auth_verifier": b64_encode(self.auth_verifier)},
            content_type="application/json",
        )
        again = self.client.post(
            "/auth/login/totp",
            data={"totp_token": replay.json()["totp_token"], "code": code},
            content_type="application/json",
        )
        self.assertEqual(again.status_code, 401)

    def test_backup_code_is_single_use(self):
        codes = self._enable()
        login = self.client.post(
            "/auth/login",
            data={"email": "totp@example.com", "auth_verifier": b64_encode(self.auth_verifier)},
            content_type="application/json",
        )
        opened = self.client.post(
            "/auth/login/totp",
            data={"totp_token": login.json()["totp_token"], "code": codes[0]},
            content_type="application/json",
        )
        self.assertEqual(opened.status_code, 200, opened.content)
        login_again = self.client.post(
            "/auth/login",
            data={"email": "totp@example.com", "auth_verifier": b64_encode(self.auth_verifier)},
            content_type="application/json",
        )
        reused = self.client.post(
            "/auth/login/totp",
            data={"totp_token": login_again.json()["totp_token"], "code": codes[0]},
            content_type="application/json",
        )
        self.assertEqual(reused.status_code, 401)

    def test_disable_requires_master_and_code(self):
        codes = self._enable()
        denied = self.client.post(
            "/auth/totp/disable",
            data={"current_auth_verifier": b64_encode(b"x" * 32), "code": codes[1]},
            content_type="application/json",
            **self.auth,
        )
        self.assertEqual(denied.status_code, 401)
        removed = self.client.post(
            "/auth/totp/disable",
            data={"current_auth_verifier": b64_encode(self.auth_verifier), "code": codes[1]},
            content_type="application/json",
            **self.auth,
        )
        self.assertEqual(removed.status_code, 200, removed.content)
        self.assertFalse(removed.json()["totp_enabled"])
        login = self.client.post(
            "/auth/login",
            data={"email": "totp@example.com", "auth_verifier": b64_encode(self.auth_verifier)},
            content_type="application/json",
        )
        self.assertIn("access_token", login.json())
