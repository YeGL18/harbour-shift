"""Small local source-package safety regressions; no real ZIP is written."""
from pathlib import Path
import importlib.util
import json
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('source_packager', Path(__file__).with_name('package-source.py'))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackageSafety(unittest.TestCase):
    def test_operational_private_files_are_excluded_and_public_assets_stay(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            forbidden = ['android/app/debug.keystore', 'android/app/debug.KEYSTORE', 'ios/ExportOptions.plist', 'ios/UploadOptions.plist', 'qa/backend/private-receipt.json', 'server/owned/.dev.vars', 'server/owned/.dev.vars.production', 'server/owned/.wrangler/state/data.sqlite', 'server/owned/private/export.sql', 'server/owned/PRIVATE/credentials.json', 'assets/snapshot.enc', 'assets/snapshot.ENC']
            public = ['assets/map/roads.json', 'assets/icons/taxi.png', 'server/owned/wrangler.example.jsonc', 'server/owned/production.mjs']
            for name in forbidden + public:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('public fixture')
            with patch.object(packager, 'PROJECT', root), patch.object(packager, 'REQUIRED_FILES', set()):
                files, _ = packager.collect_files()
            self.assertEqual({path.as_posix() for path in files}, set(public))

    def test_real_credential_contexts_are_rejected_without_returning_values(self):
        value = 'cf' + 'aB9_' * 12
        token_json = json.dumps({'access_token': value})
        bearer = 'Authorization: ' + 'Bearer ' + value
        env = 'CLOUDFLARE_API_TOKEN=' + value
        key = '-----BEGIN ' + 'PRIVATE KEY-----'
        for text in [token_json, bearer, env, key]:
            issues = packager.credential_literal_issues(text)
            self.assertTrue(issues)
            self.assertNotIn(value, repr(issues))

    def test_hashes_ids_and_explicit_templates_are_not_credentials(self):
        hashes = json.dumps({'sha256': 'a' * 64, 'token_hash': 'b' * 64, 'mainBundleSha256': 'c' * 64, 'database_id': '12345678-1234-1234-1234-123456789abc'})
        templates = json.dumps({'CLOUDFLARE_API_TOKEN': '<YOUR_TOKEN>', 'stagingKey': 'TEST_ONLY_DETERMINISTIC_FIXTURE_NOT_A_DEPLOYMENT_SECRET'})
        self.assertEqual(packager.credential_literal_issues(hashes), [])
        self.assertEqual(packager.credential_literal_issues(templates), [])

    def test_validation_fails_with_path_and_reason_but_no_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            value = 'opaque' + 'ABCd123_' * 8
            (root / 'config.json').write_text(json.dumps({'resumeToken': value}))
            with patch.object(packager, 'PROJECT', root):
                with self.assertRaises(RuntimeError) as raised:
                    packager.validate_no_credential_literals([Path('config.json')])
            self.assertIn('config.json', str(raised.exception))
            self.assertNotIn(value, str(raised.exception))


if __name__ == '__main__':
    unittest.main()
