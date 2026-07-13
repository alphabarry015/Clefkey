"""Client API + gestion crypto locale."""

import base64
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vault.crypto.kdf import create_auth_verifier, derive_key, generate_salt
from vault.crypto.keys import (
    decrypt_private_key,
    encrypt_private_key,
    generate_keypair,
)
from vault.crypto.password_gen import generate_password
from vault.crypto.vault_crypto import (
    decrypt_bytes,
    decrypt_data,
    encrypt_bytes,
    encrypt_data,
    generate_vault_key,
)

API_URL = "http://127.0.0.1:8000"


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def b64d(data: str) -> bytes:
    return base64.b64decode(data)


class VaultSession:
    """Session utilisateur avec clés déchiffrées en mémoire."""

    def __init__(self, api_url: str = API_URL):
        self.token: str | None = None
        self.user_id: str | None = None
        self.email: str | None = None
        self.display_name: str | None = None
        self.vault_key: bytes | None = None
        self.private_key: bytes | None = None
        self.public_key: bytes | None = None
        self._client = httpx.Client(base_url=api_url, timeout=30.0)

    @property
    def headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def _unlock_keys(self, auth_response: dict, master_password: str):
        salt = b64d(auth_response["salt"])
        derived = derive_key(master_password, salt)
        self.vault_key = decrypt_bytes(b64d(auth_response["encrypted_vault_key"]), derived)
        self.private_key = decrypt_private_key(
            b64d(auth_response["encrypted_private_key"]), self.vault_key
        )
        self.public_key = b64d(auth_response["public_key"])
        self.token = auth_response["access_token"]
        self.user_id = auth_response["user_id"]
        self.email = auth_response["email"]
        self.display_name = auth_response["display_name"]

    def register(self, email: str, display_name: str, master_password: str) -> dict:
        salt = generate_salt()
        derived = derive_key(master_password, salt)
        auth_verifier = create_auth_verifier(derived)
        vault_key = generate_vault_key()
        private_key, public_key = generate_keypair()

        payload = {
            "email": email,
            "display_name": display_name,
            "salt": b64(salt),
            "auth_verifier": b64(auth_verifier),
            "encrypted_vault_key": b64(encrypt_bytes(vault_key, derived)),
            "public_key": b64(public_key),
            "encrypted_private_key": b64(encrypt_private_key(private_key, vault_key)),
        }
        resp = self._client.post("/auth/register", json=payload)
        resp.raise_for_status()
        data = resp.json()
        self._unlock_keys(data, master_password)
        return data

    def login(self, email: str, master_password: str) -> dict:
        salt_resp = self._client.get("/auth/salt", params={"email": email})
        salt_resp.raise_for_status()
        salt = b64d(salt_resp.json()["salt"])

        derived = derive_key(master_password, salt)
        auth_verifier = create_auth_verifier(derived)

        resp = self._client.post(
            "/auth/login",
            json={"email": email, "auth_verifier": b64(auth_verifier)},
        )
        resp.raise_for_status()
        data = resp.json()
        self._unlock_keys(data, master_password)
        return data

    def encrypt_entry(self, title: str, username: str, password: str, url: str = "", notes: str = "") -> bytes:
        return encrypt_data(
            {"title": title, "username": username, "password": password, "url": url, "notes": notes},
            self.vault_key,
        )

    def decrypt_entry(self, encrypted: bytes) -> dict:
        return decrypt_data(encrypted, self.vault_key)

    def add_entry(self, title: str, username: str, password: str, url: str = "", notes: str = "") -> dict:
        encrypted = self.encrypt_entry(title, username, password, url, notes)
        resp = self._client.post(
            "/vault/entries",
            json={"encrypted_data": b64(encrypted)},
            headers=self.headers,
        )
        resp.raise_for_status()
        return resp.json()

    def list_entries(self) -> list[dict]:
        resp = self._client.get("/vault/entries", headers=self.headers)
        resp.raise_for_status()
        results = []
        for e in resp.json():
            decrypted = self.decrypt_entry(b64d(e["encrypted_data"]))
            results.append({**decrypted, **e})
        return results

    def delete_entry(self, entry_id: str):
        resp = self._client.delete(f"/vault/entries/{entry_id}", headers=self.headers)
        resp.raise_for_status()

    def generate_password(self, length: int = 20) -> str:
        return generate_password(length)

    def lock(self):
        self.token = None
        self.vault_key = None
        self.private_key = None
        self.public_key = None

    def close(self):
        self._client.close()
