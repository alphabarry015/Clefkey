"""Anti-SSRF favicon : hôtes privés / localhost refusés."""

from django.test import SimpleTestCase

from vault.favicon import _safe_request_url, is_safe_hostname, normalize_page_url


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

    def test_accepts_public_hostname_shape(self):
        # Ne résout pas forcément en CI ; on vérifie seulement le filtre schéma.
        self.assertIsNone(_safe_request_url("file:///etc/passwd"))
        self.assertIsNone(_safe_request_url("ftp://example.com/x"))
