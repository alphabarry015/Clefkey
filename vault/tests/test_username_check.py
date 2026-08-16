"""Énumération d'usernames : validation, règles de détection et base Sherlock."""

from django.test import SimpleTestCase

from vault.username_check import (
    check_username,
    check_usernames,
    detect,
    load_sites,
    sanitize_username,
)


class UsernameValidationTests(SimpleTestCase):
    def test_accepts_valid_usernames(self):
        self.assertEqual(sanitize_username("WebBreacher"), "WebBreacher")
        self.assertEqual(sanitize_username("  abc_123.-x  "), "abc_123.-x")

    def test_rejects_invalid_usernames(self):
        for bad in ("", "a", "ab@cd", "sp ace", "truc/", "..", "-start", "x" * 40, "user;drop"):
            self.assertIsNone(sanitize_username(bad), bad)


class DetectionTests(SimpleTestCase):
    def test_status_code_found_when_not_in_error_codes(self):
        site = {"error_type": "status_code", "error_codes": [404, 410]}
        self.assertEqual(detect(site, 200, "page"), "found")
        self.assertEqual(detect(site, 404, "page"), "not_found")

    def test_status_code_defaults_to_404(self):
        site = {"error_type": "status_code", "error_codes": [404]}
        self.assertEqual(detect(site, 404, ""), "not_found")
        self.assertEqual(detect(site, 200, ""), "found")

    def test_message_error_rule(self):
        site = {"error_type": "message", "error_msgs": ["<title>404</title>", "No user"]}
        self.assertEqual(detect(site, 200, "profile of <title>404</title>"), "not_found")
        self.assertEqual(detect(site, 200, "welcome back"), "found")

    def test_response_url_rule(self):
        site = {"error_type": "response_url", "error_url": "https://site.tld/no-such-user"}
        self.assertEqual(detect(site, 200, "", "https://site.tld/no-such-user"), "not_found")
        self.assertEqual(detect(site, 200, "", "https://site.tld/users/bob"), "found")

    def test_unknown_type_inconclusive(self):
        self.assertEqual(detect({"error_type": ""}, 200, "x"), "inconclusive")


class DataTests(SimpleTestCase):
    def test_sherlock_data_loaded(self):
        sites = load_sites()
        self.assertGreaterEqual(len(sites), 400)
        self.assertTrue(all(site.get("name") for site in sites))
        with_probe = sum("{}" in (site.get("probe") or "") for site in sites)
        # La quasi-totalité des sites sont interrogeables par URL GET.
        self.assertGreaterEqual(with_probe / len(sites), 0.9)

    def test_check_username_shape(self):
        result = check_username("webbreacher", limit=3, concurrency=2)
        self.assertLessEqual(result.checked, 3)
        for entry in result.found + result.not_found + result.inconclusive:
            self.assertIn("name", entry)
            self.assertIn("uri", entry)

    def test_check_usernames_bulk(self):
        results = check_usernames(["webbreacher", "bob"], limit=2, concurrency=2)
        self.assertIn("webbreacher", results)
        self.assertIn("bob", results)
        for result in results.values():
            self.assertLessEqual(result.checked, 2)

    def test_check_usernames_skips_invalid(self):
        results = check_usernames(["webbreacher", "", "x", "webbreacher"], limit=2, concurrency=2)
        self.assertEqual(set(results), {"webbreacher"})