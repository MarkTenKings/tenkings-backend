"""Failure-path checks use only private temporary files and synthetic archive bytes.

No package manager, executable, network request, signing key, or build is run.
"""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
spec = importlib.util.spec_from_file_location('candidate_build', HERE / 'build-candidate.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
c = b.module('candidate_bundle_fixture', 'candidate-bundle.py')


class InterruptedCandidateBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='vault-candidate-interruption-')
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'source'; self.source.mkdir()
        entries = []
        for name in sorted({*c.FIXED, *(tree + '/fixture.js' for tree in c.TREES)}):
            file = self.source / name; file.parent.mkdir(parents=True, exist_ok=True)
            data = b'synthetic source fixture\n'; file.write_bytes(data)
            entries.append(c.entry(name, data))
        self.manifest = {'schemaVersion': 1, 'sourceState': 'UNCOMMITTED_CANDIDATE', 'baseCommit': 'a' * 40, 'files': entries}
        (self.source / c.MANIFEST).write_text(json.dumps(self.manifest))
        # A real tiny archive exercises extraction; these bytes are never executed.
        self.archive = self.root / 'synthetic-node.tar.xz'
        with tarfile.open(self.archive, 'w:xz') as bundle:
            member = tarfile.TarInfo('node-v' + b.a.PIN['nodeVersion'] + '-linux-x64/bin/node')
            data = b'SYNTHETIC_NONEXECUTABLE_RUNTIME\n'; member.size = len(data)
            bundle.addfile(member, io.BytesIO(data))
        self.pin = {**b.a.PIN, 'nodeArchiveSha256': b.a.sha(self.archive)}

    def tearDown(self):
        self.temp.cleanup()

    def assert_not_signable(self, output):
        marker = json.loads((output / 'source-build.json').read_text())
        self.assertEqual(marker['sourceState'], 'UNCOMMITTED_CANDIDATE')
        self.assertFalse(marker['releaseAuthorized']); self.assertFalse(marker['buildCompleted'])
        self.assertEqual(marker['baseCommit'], self.manifest['baseCommit'])
        self.assertEqual(marker['candidateManifestSha256'], b.a.sha(self.source / c.MANIFEST))
        with patch.object(b.a, 'run', side_effect=AssertionError('Signing subprocess must never run')) as signing:
            with self.assertRaisesRegex(ValueError, 'unsigned source rehearsal'):
                b.a.make_manifest(SimpleNamespace(release=output, release_id='must-not-sign', app_version='0.1.0',
                                                source_commit='a' * 40, schema_version=6, signing_key=self.root / 'absent-key'))
            signing.assert_not_called()
        self.assertFalse((output / 'release.json').exists()); self.assertFalse((output / 'release.sig').exists())

    def test_marker_is_durable_before_archive_or_executable_copy(self):
        output = self.root / 'archive-interrupted'; syncs = []; original_sync = b.os.fsync
        def sync(fd):
            syncs.append(fd); return original_sync(fd)
        def interrupted_archive(*args, **kwargs):
            self.assert_not_signable(output)
            self.assertGreaterEqual(len(syncs), 2, 'file and directory fsync must precede extraction')
            self.assertFalse((output / 'runtime/bin/node').exists())
            raise OSError('synthetic interruption before runtime copy')
        with patch.object(b.platform, 'system', return_value='Linux'), patch.object(b.platform, 'machine', return_value='x86_64'), \
             patch.object(b.a, 'PIN', self.pin), patch.object(b.os, 'fsync', side_effect=sync), \
             patch.object(b.tarfile, 'open', side_effect=interrupted_archive), \
             patch.object(b.subprocess, 'run', side_effect=AssertionError('No build subprocess allowed')) as run, \
             patch.object(b.subprocess, 'check_output', side_effect=AssertionError('No executable allowed')) as check:
            with self.assertRaisesRegex(OSError, 'synthetic interruption'):
                b.build(self.source, output, self.archive)
            run.assert_not_called(); check.assert_not_called()
        self.assert_not_signable(output)
        self.assertEqual(c.verify_bundle(self.source)['files'], len(self.manifest['files']))

    def test_failed_package_manager_version_preserves_denial_after_runtime_copy(self):
        output = self.root / 'version-interrupted'
        with patch.object(b.platform, 'system', return_value='Linux'), patch.object(b.platform, 'machine', return_value='x86_64'), \
             patch.object(b.a, 'PIN', self.pin), patch.object(b.subprocess, 'check_output', return_value='wrong-version\n') as check, \
             patch.object(b.subprocess, 'run', side_effect=AssertionError('No build subprocess allowed')) as run:
            with self.assertRaisesRegex(ValueError, 'Pinned pnpm required'):
                b.build(self.source, output, self.archive)
            self.assertEqual(check.call_args.args[0], ['pnpm', '--version']); run.assert_not_called()
        self.assertTrue((output / 'runtime/bin/node').is_file())
        self.assert_not_signable(output)

    def test_interrupted_first_build_command_preserves_denial_and_exact_source(self):
        output = self.root / 'build-interrupted'
        before = c.verify_bundle(self.source)
        def interrupted_run(argv, **kwargs):
            self.assert_not_signable(output)
            self.assertEqual(argv, ['pnpm', '--filter', '@tenkings/vault-machine...', '--filter', '@tenkings/vault-kiosk...', 'install', '--frozen-lockfile'])
            raise subprocess.CalledProcessError(1, argv)
        with patch.object(b.platform, 'system', return_value='Linux'), patch.object(b.platform, 'machine', return_value='x86_64'), \
             patch.object(b.a, 'PIN', self.pin), patch.object(b.subprocess, 'check_output', return_value=self.pin['pnpmVersion'] + '\n'), \
             patch.object(b.subprocess, 'run', side_effect=interrupted_run) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                b.build(self.source, output, self.archive)
            self.assertEqual(run.call_count, 1)
        self.assert_not_signable(output)
        self.assertEqual(c.verify_bundle(self.source), before)


if __name__ == '__main__':
    unittest.main()
