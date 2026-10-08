import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('candidate_bundle', Path(__file__).resolve().parents[1] / 'candidate-bundle.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class CandidateBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'source'
        self.source.mkdir()
        for path in (*c.FIXED, *(tree + '/fixture.js' for tree in c.TREES)):
            file = self.source / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('fixture\n')
        subprocess.run(['git', 'init', '-q', str(self.source)], check=True)
        subprocess.run(['git', 'add', '.'], cwd=self.source, check=True)
        subprocess.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture base'], cwd=self.source, check=True)
        self.output = self.root / 'candidate'

    def tearDown(self):
        self.temp.cleanup()

    def export(self):
        return c.export_bundle(self.source, self.output)

    def edit_manifest(self, change):
        path = self.output / c.MANIFEST
        data = json.loads(path.read_text())
        change(data)
        path.write_text(json.dumps(data))

    def test_dirty_source_is_hashed_without_clean_commit_claim_or_git_on_verify(self):
        (self.source / 'package.json').write_text('dirty fixture\n')
        result = self.export()
        self.assertFalse(result['signedRelease'])
        self.assertFalse(result['hardwareCertificationEligible'])
        self.assertEqual(result['sourceState'], 'UNCOMMITTED_CANDIDATE')
        self.assertEqual(result['baseCommit'], c.git(self.source, 'rev-parse', 'HEAD').decode().strip())
        self.assertEqual((self.output / 'package.json').read_text(), 'dirty fixture\n')
        with patch.object(c, 'git', side_effect=AssertionError('Git must not be needed')):
            self.assertEqual(c.verify_bundle(self.output), {k: v for k, v in result.items() if k != 'bundle'})

    def test_excludes_dependencies_build_outputs_private_files_and_other_projects(self):
        excluded = ['packages/vault-machine/node_modules/x/index.js', 'frontend/vault-kiosk/dist/index.html', 'deploy/vault-linux/__pycache__/fake.py', 'packages/vault-machine/.env', 'packages/vault-machine/private.pem', 'packages/vault-machine/live-config.json', 'packages/vault-machine/credentials.js', 'packages/database/src/index.ts']
        for path in excluded:
            file = self.source / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('SYNTHETIC-PRIVATE-FIXTURE')
        self.export()
        for path in excluded:
            self.assertFalse((self.output / path).exists())
        self.assertFalse((self.output / '.git').exists())

    def test_output_is_create_only_and_outside_source(self):
        with self.assertRaisesRegex(ValueError, 'outside source'):
            c.export_bundle(self.source, self.source / 'candidate')
        self.output.mkdir()
        with self.assertRaisesRegex(ValueError, 'new'):
            self.export()

    def test_tamper_missing_extra_and_generated_outputs(self):
        self.export()
        package = self.output / 'package.json'
        original = package.read_bytes()
        package.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            c.verify_bundle(self.output)
        package.write_bytes(original)
        extra = self.output / 'packages/vault-machine/extra.js'
        extra.write_text('extra')
        with self.assertRaisesRegex(ValueError, 'membership'):
            c.verify_bundle(self.output)
        extra.unlink()
        generated = self.output / 'packages/vault-machine/node_modules'
        generated.symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            c.verify_bundle(self.output)
        self.assertTrue(c.verify_bundle(self.output, True)['generatedOutputsExcluded'])
        package.unlink()
        with self.assertRaisesRegex(ValueError, 'membership'):
            c.verify_bundle(self.output, True)

    def test_rejects_traversal_duplicate_and_non_source_manifest_paths(self):
        self.export()
        original = (self.output / c.MANIFEST).read_bytes()
        for path in ['../package.json', '/package.json', 'packages//x', 'packages/../x', 'packages\\x', 'packages/vault-machine/.env', 'packages/vault-machine/node_modules/x.js']:
            (self.output / c.MANIFEST).write_bytes(original)
            self.edit_manifest(lambda data: data['files'][0].update(path=path))
            with self.assertRaises(ValueError):
                c.verify_bundle(self.output)
        (self.output / c.MANIFEST).write_bytes(original)
        self.edit_manifest(lambda data: data['files'].append(data['files'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            c.verify_bundle(self.output)

    def test_source_file_and_parent_symlinks_rejected_without_copying_target(self):
        target = self.root / 'private-fixture'
        target.write_text('PRIVATE-FIXTURE')
        member = self.source / 'packages/vault-machine/fixture.js'
        member.unlink()
        member.symlink_to(target)
        with self.assertRaises(OSError):
            self.export()
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
        self.assertFalse((self.output / 'packages/vault-machine/fixture.js').exists())

    def test_fifo_rejected_without_waiting_for_writer(self):
        member = self.source / 'packages/vault-machine/fixture.js'
        member.unlink()
        os.mkfifo(member)
        with self.assertRaisesRegex(ValueError, 'regular file'):
            self.export()

    def test_concurrent_source_edit_rejected_by_second_hash_pass(self):
        original = c.read_member
        changed = False
        def read(root, path, limit=c.MAX_FILE):
            nonlocal changed
            data = original(root, path, limit)
            if Path(root) == self.source and path == 'package.json' and not changed:
                changed = True
                (self.source / path).write_text('concurrently edited fixture')
            return data
        with patch.object(c, 'read_member', side_effect=read):
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                self.export()


if __name__ == '__main__':
    unittest.main()
