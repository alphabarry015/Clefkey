"""Anti-SSRF favicon : hôtes privés / localhost refusés."""

from django.test import Client, SimpleTestCase, TestCase, override_settings

from vault.favicon import (
    _pinned_request_target,
    _resolve_global_ips,
    _safe_request_url,
    is_safe_hostname,
    normalize_page_url,
)


class FaviconSsrfTests(SimpleTestCase):
    def test_rejects_localhost_and_loopback(self):
        self.assertFalse(is_safe_hostname("localhost"))
        self.assertFalse(is_safe_hostname("127.0.0.1"))
        self.assertFalse(is_safe_hostname("::1"))
        self.assertIsNone(_safe_request_url("http://127.0.0.1/favicon.ico"))
        self.assertIsNone(normalize_page_url("http://localhost/"))

    def test_rejects_private_literals(self):
        self.assertFalse(is_safe_hostname("10.0.0.1"))
        self.assertFalse(is_safe_hostname("192.168.1.1"))
        self.assertFalse(is_safe_hostname("169.254.169.254"))

    def test_rejects_cgnat_shared_space(self):
        # RFC 6598 — pas is_private, mais pas is_global non plus.
        self.assertFalse(is_safe_hostname("100.64.0.1"))
        self.assertFalse(is_safe_hostname("100.127.255.254"))
        self.assertIsNone(_safe_request_url("http://100.64.1.2/favicon.ico"))

    def test_accepts_public_hostname_shape(self):
        # Ne résout pas forcément en CI ; on vérifie seulement le filtre schéma.
        self.assertIsNone(_safe_request_url("file:///etc/passwd"))
        self.assertIsNone(_safe_request_url("ftp://example.com/x"))

    def test_pinned_request_keeps_hostname_url(self):
        # L’URL reste le hostname (TLS/SNI) ; l’IP est fournie au transport séparément.
        pinned, headers = _pinned_request_target("https://example.com/path", "93.184.216.34")
        self.assertEqual(pinned, "https://example.com/path")
        self.assertEqual(headers["Host"], "example.com")
        self.assertEqual(headers["X-Clefkey-Pinned-IP"], "93.184.216.34")

    def test_resolve_global_ips_rejects_localhost(self):
        self.assertIsNone(_resolve_global_ips("localhost"))


@override_settings(
    SECRET_KEY="test-secret-key-for-favicon-auth",
    RATE_LIMIT_REQUIRE_UPSTASH=False,
)
class FaviconProxyAuthTests(TestCase):
    def test_unauthenticated_favicon_is_rejected(self):
        client = Client()
        response = client.get("/vault/favicon", {"url": "https://example.com/"})
        self.assertEqual(response.status_code, 401)
