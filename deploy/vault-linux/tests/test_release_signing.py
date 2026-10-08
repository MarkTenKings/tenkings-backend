import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('signing',Path(__file__).resolve().parents[1]/'release-signing.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)

class OfflineSigningTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='vault-signing-');self.root=Path(self.temp.name).resolve();self.target=self.root/'new-key'
    def tearDown(self):self.temp.cleanup()
    def test_dry_run_then_private_create_only_pair(self):
        self.assertFalse(s.initialize(self.target,'RELEASE_SIGNING')['applied']);self.assertFalse(self.target.exists())
        report=s.initialize(self.target,'RELEASE_SIGNING',True)
        self.assertTrue(report['verified']);self.assertFalse(report['productionAcceptanceGranted'])
        self.assertNotIn('PRIVATE KEY',json.dumps(report));self.assertEqual(len(report['publicKeySha256']),64)
        self.assertEqual((self.target/'private.pem').stat().st_mode & 0o777,0o600)
        self.assertEqual(self.target.stat().st_mode & 0o777,0o700)
        with self.assertRaisesRegex(ValueError,'create-only'):s.initialize(self.target,'RELEASE_SIGNING',True)
    def test_symlink_or_other_account_writable_paths_rejected(self):
        link=self.root/'linked';link.symlink_to(self.root)
        with self.assertRaises(ValueError):s.initialize(link/'unsafe','RELEASE_SIGNING',True)
        self.root.chmod(0o770)
        with self.assertRaises(ValueError):s.initialize(self.target,'RELEASE_SIGNING',True)
        self.root.chmod(0o700)
    def test_interrupted_key_setup_cannot_be_used(self):
        with patch.object(s,'command',side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError):s.initialize(self.target,'SPARK_ACTIVATION',True)
        self.assertTrue((self.target/'initialization.pending').exists())
        with self.assertRaisesRegex(ValueError,'incomplete'):s.inspect(self.target)
    def test_key_metadata_substitution_and_public_exposure_rejected(self):
        s.initialize(self.target,'RELEASE_SIGNING',True)
        (self.target/'private.pem').chmod(0o644)
        with self.assertRaisesRegex(ValueError,'owner-only'):s.inspect(self.target)
        (self.target/'private.pem').chmod(0o600)
        metadata=json.loads((self.target/'key.json').read_text());metadata['publicKeySha256']='f'*64
        (self.target/'key.json').write_text(json.dumps(metadata))
        with self.assertRaisesRegex(ValueError,'metadata mismatch'):s.inspect(self.target)

if __name__=='__main__':unittest.main()
