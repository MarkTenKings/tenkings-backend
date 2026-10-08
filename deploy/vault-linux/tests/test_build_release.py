"""No native code or package manager runs in these interrupted release checks."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location('release_build', HERE / 'build-release.py')
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
import appliance as a

class CleanReleaseBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='vault-release-build-')
        self.root = Path(self.temp.name).resolve(); self.source = self.root / 'source'; self.source.mkdir()
        self.archive = self.root / 'fixture.tar.xz'; self.output = self.root / 'release'
        with tarfile.open(self.archive, 'w:xz') as archive:
            member = tarfile.TarInfo('node-v' + b.PIN['nodeVersion'] + '-linux-x64/bin/node')
            data = b'NONEXECUTABLE_TEST_RUNTIME'; member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
        self.pin = {**b.PIN, 'nodeArchiveSha256': b.sha(self.archive)}
        self.args = SimpleNamespace(source=self.source, output=self.output, node_archive=self.archive)
    def tearDown(self): self.temp.cleanup()
    def deny(self):
        evidence = json.loads((self.output / 'source-build.json').read_text())
        self.assertEqual(evidence['sourceState'], 'CLEAN_COMMITTED')
        self.assertFalse(evidence['buildCompleted']); self.assertFalse(evidence['releaseAuthorized'])
        with self.assertRaises(ValueError): a.completed_build(self.output, 'a' * 40)
        self.assertFalse((self.output / 'release.json').exists())
    def test_dirty_source_is_refused_before_output_creation(self):
        with patch.object(b.platform, 'system', return_value='Linux'), patch.object(b.platform, 'machine', return_value='x86_64'), patch.object(b, 'PIN', self.pin), patch.object(b.subprocess, 'check_output', return_value=' M package.json\n'):
            with self.assertRaisesRegex(ValueError, 'clean, reviewed and committed'): b.build(self.args)
        self.assertFalse(self.output.exists())
    def test_interrupted_archive_has_durable_denial_before_executable(self):
        def stop(*args, **kwargs):
            self.deny(); self.assertFalse((self.output / 'runtime/bin/node').exists())
            raise OSError('interrupted archive')
        with patch.object(b.platform, 'system', return_value='Linux'), patch.object(b.platform, 'machine', return_value='x86_64'), patch.object(b, 'PIN', self.pin), patch.object(b.subprocess, 'check_output', side_effect=['', 'a'*40]), patch.object(b.tarfile, 'open', side_effect=stop):
            with self.assertRaises(OSError): b.build(self.args)
        self.deny()
    def test_changed_commit_after_tests_never_becomes_signable(self):
        with patch.object(b.platform, 'system', return_value='Linux'), patch.object(b.platform, 'machine', return_value='x86_64'), patch.object(b, 'PIN', self.pin), patch.object(b.subprocess, 'check_output', side_effect=['', 'a'*40, b.PIN['pnpmVersion'], 'b'*40]), patch.object(b.subprocess, 'run'):
            with self.assertRaisesRegex(ValueError, 'commit changed'): b.build(self.args)
        self.deny()
    def test_mutated_source_after_tests_never_becomes_signable(self):
        with patch.object(b.platform, 'system', return_value='Linux'), patch.object(b.platform, 'machine', return_value='x86_64'), patch.object(b, 'PIN', self.pin), patch.object(b.subprocess, 'check_output', side_effect=['', 'a'*40, b.PIN['pnpmVersion'], 'a'*40, ' M source.ts']), patch.object(b.subprocess, 'run'):
            with self.assertRaisesRegex(ValueError, 'source changed'): b.build(self.args)
        self.deny()

if __name__ == '__main__': unittest.main()
