"""Runner unit checks. These never claim an installed-systemd acceptance pass."""
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

FILE = Path(__file__).with_name('installed-service-rehearsal.py')
spec = importlib.util.spec_from_file_location('installed_rehearsal', FILE)
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)


class InstalledRehearsalTests(unittest.TestCase):
    def test_acknowledgement_is_required_before_host_inspection(self):
        validator = Mock()
        with self.assertRaisesRegex(ValueError, 'acknowledgement'):
            r.host_guard(SimpleNamespace(acknowledge='yes'), validator)
        validator.require_host.assert_not_called()

    def test_update_requires_same_source_payload_and_schema(self):
        original = {'releaseId': 'old', 'sourceCommit': 'a' * 40, 'localSchemaVersion': 7,
                    'files': [{'path': 'runtime/bin/node', 'sha256': 'b' * 64}]}
        r.equivalent_update(original, {**original, 'releaseId': 'new'})
        for mutation in ({'releaseId': 'old'}, {'sourceCommit': 'c' * 40},
                         {'localSchemaVersion': 8}, {'files': []}):
            with self.assertRaises(ValueError): r.equivalent_update(original, {**original, 'releaseId': 'new', **mutation})

    def test_container_on_virtual_machine_is_refused_before_vm_probe(self):
        host_id = 'a' * 32
        args = SimpleNamespace(acknowledge=r.ACK, disposable_machine_id=host_id)
        contents = {'/etc/machine-id': host_id, '/proc/1/comm': 'systemd\n'}
        validator = Mock()
        with patch.object(r.os, 'geteuid', return_value=0), patch.object(Path, 'read_text', lambda path: contents[str(path)]), \
             patch.object(Path, 'is_dir', return_value=True), \
             patch.object(r, 'command', return_value=SimpleNamespace(returncode=0, stdout='docker\n')) as command:
            with self.assertRaisesRegex(ValueError, 'Containers are refused'): r.host_guard(args, validator)
            command.assert_called_once_with(['systemd-detect-virt', '--container'], check=False)

    def test_configuration_cannot_select_external_or_physical_effects(self):
        base = {'VAULT_MACHINE_ID': 'fixture', 'VAULT_PAYMENT_ADAPTER': 'MOCK',
                'VAULT_CONTROLLER_ADAPTER': 'SIMULATOR', 'VAULT_CLOUD_ORIGIN': 'https://127.0.0.1:47839'}
        r.safe_config(base, 'fixture')
        for mutation in ({'VAULT_PAYMENT_ADAPTER': 'NAYAX_SPARK_PRODUCTION'}, {'VAULT_CONTROLLER_ADAPTER': 'WAVESHARE'},
                         {'VAULT_CLOUD_ORIGIN': 'https://example.com'}, {'VAULT_MACHINE_ID': 'other'},
                         {'VAULT_SPARK_CONFIG_PATH': '/etc/profile'}, {'VAULT_STRIPE_SECRET': 'fixture'}):
            with self.assertRaisesRegex(ValueError, 'configuration changed'): r.safe_config({**base, **mutation}, 'fixture')

    def test_create_only_evidence_preserves_existing_file_and_symlink_target(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); original = root / 'original'
            r.write_new(original, {'value': 'preserve'})
            with self.assertRaises(FileExistsError): r.write_new(original, {'value': 'replace'})
            link = root / 'link'; link.symlink_to(original)
            with self.assertRaises(FileExistsError): r.write_new(link, {'value': 'replace'})
            self.assertEqual(json.loads(original.read_text()), {'value': 'preserve'})

    def test_untrusted_paths_and_symlinks_refuse_before_read(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); file = root / 'file'; file.write_text('test'); file.chmod(0o666)
            link = root / 'link'; link.symlink_to(file)
            for path in (file, link, Path('relative'), root / '..' / 'file'):
                with self.assertRaises(ValueError): r.protected(path)

    def test_existing_broken_path_prevents_install_commands(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'state'; path.symlink_to(Path(folder) / 'missing')
            with patch.object(r, 'ROOT', path), patch.object(r, 'command') as command:
                with self.assertRaisesRegex(ValueError, 'Fresh VM'): r.fresh_guard()
                command.assert_not_called()

    def test_same_boot_refuses_resume_before_configuration_or_service(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            checkpoint = {'classification': 'SYNTHETIC_ONLY', 'hostId': 'fixture', 'bootId': 'same'}
            (root / 'evidence').mkdir()
            (root / 'evidence/awaiting-reboot.json').write_text(json.dumps(checkpoint))
            original = Path.read_text
            def read(path, *args, **kwargs):
                return 'same\n' if str(path) == '/proc/sys/kernel/random/boot_id' else original(path, *args, **kwargs)
            validator = Mock()
            with patch.object(r, 'ROOT', root), patch.object(r, 'protected', side_effect=lambda path: path), patch.object(Path, 'read_text', read), patch.object(r, 'command') as command:
                with self.assertRaisesRegex(ValueError, 'real VM reboot'): r.after_reboot(None, validator, 'fixture')
                validator.private_json.assert_not_called(); command.assert_not_called()

    def test_real_sqlite_canary_requires_both_databases_and_preserves_event_prefix(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            for name in r.DATABASES:
                with sqlite3.connect(root / name) as db:
                    db.execute('CREATE TABLE rehearsal_fixture(token TEXT NOT NULL)')
                    db.execute("INSERT INTO rehearsal_fixture VALUES ('fixture')")
                    if name == 'vault.sqlite':
                        db.execute('CREATE TABLE machine_meta(singleton INTEGER,machine_id TEXT,schema_version INTEGER,service_locked INTEGER,automation_halted INTEGER,recovery_required INTEGER)')
                        db.execute("INSERT INTO machine_meta VALUES (1,'machine',7,1,0,0)")
                        db.execute('CREATE TABLE machine_event(sequence INTEGER PRIMARY KEY,payload TEXT)')
                        db.execute("INSERT INTO machine_event VALUES (1,'preserve')")
            before = r.database_facts(root, 'fixture')
            with sqlite3.connect(root / 'vault.sqlite') as db: db.execute("INSERT INTO machine_event VALUES (2,'later')")
            after = r.database_facts(root, 'fixture', before['eventSequence'])
            self.assertEqual(after['eventPrefixSha256'], before['eventPrefixSha256'])
            self.assertGreater(after['eventSequence'], before['eventSequence'])
            with sqlite3.connect(root / 'vault.sqlite') as db: db.execute("UPDATE machine_event SET payload='mutated' WHERE sequence=1")
            self.assertNotEqual(r.database_facts(root, 'fixture', 1)['eventPrefixSha256'], before['eventPrefixSha256'])
            with self.assertRaisesRegex(ValueError, 'canary'): r.database_facts(root, 'wrong')
            (root / r.DATABASES[1]).unlink()
            with self.assertRaisesRegex(ValueError, 'database missing'): r.database_facts(root, 'fixture')


if __name__ == '__main__': unittest.main()
