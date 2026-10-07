import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import appliance as a
spec = importlib.util.spec_from_file_location('snapshot_tools', HERE / 'snapshot-tools.py')
s = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
MACHINE = '00000000-0000-4000-8000-000000000001'

class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='vault-snapshot-tests-')
        self.root = Path(self.temp.name).resolve(); self.state = self.root / 'state'; self.state.mkdir()
        with sqlite3.connect(self.state / 'vault.sqlite') as db:
            db.execute('CREATE TABLE machine_meta(singleton INTEGER,machine_id TEXT,schema_version INTEGER,service_locked INTEGER,automation_halted INTEGER,recovery_required INTEGER,last_cloud_success_at TEXT)')
            db.execute('INSERT INTO machine_meta VALUES(1,?,5,0,0,0,?)', (MACHINE, '2026-10-07T20:00:00Z'))
            db.execute('CREATE TABLE schema_migration(version INTEGER PRIMARY KEY)')
            db.executemany('INSERT INTO schema_migration VALUES(?)', [(n,) for n in range(1, 6)])
            db.execute('CREATE TABLE machine_event(sequence INTEGER)'); db.execute('INSERT INTO machine_event VALUES(71)')
            db.execute('CREATE TABLE sale_payment_binding(provider TEXT,binding_digest TEXT)'); db.execute("INSERT INTO sale_payment_binding VALUES('NAYAX_SPARK',?)", ('a'*64,))
            db.execute('CREATE TABLE original_facts(value TEXT)'); db.execute("INSERT INTO original_facts VALUES('captured-sale-and-stock-unchanged')")
        with sqlite3.connect(self.state / 'vault.sqlite.spark-provider.sqlite') as db:
            db.execute('CREATE TABLE spark_binding(singleton INTEGER,binding_digest TEXT)'); db.execute('INSERT INTO spark_binding VALUES(1,?)', ('a'*64,))
        (self.state / 'vault.sqlite.spark-provider.sqlite.anchor').write_text('a'*64)
        with patch.object(a, 'STATE', self.state), patch.object(a, 'ETC', self.root / 'no-config'):
            self.snapshot = a.snapshot_databases()
        self.sha = a.sha(self.snapshot / 'manifest.json')

    def tearDown(self): self.temp.cleanup()

    def test_verifies_exact_set_anchor_identity_and_watermark(self):
        report = s.verify_snapshot(self.snapshot, self.sha)
        self.assertEqual(report['machineId'], MACHINE); self.assertEqual(report['eventSequence'], 71)
        self.assertEqual(report['sparkBindingDigest'], 'a'*64); self.assertFalse(report['activationAllowed'])

    def test_corruption_missing_extra_and_links_fail_before_staging(self):
        for change in ['corrupt', 'missing', 'extra', 'symlink']:
            target = self.root / change; shutil.copytree(self.snapshot, target)
            file = target / 'vault.sqlite.spark-provider.sqlite'
            if change == 'corrupt': file.write_bytes(b'corrupted')
            if change == 'missing': file.unlink()
            if change == 'extra': (target / 'unexpected-secret.txt').write_text('not-exported')
            if change == 'symlink': file.unlink(); file.symlink_to(self.snapshot / file.name)
            with self.assertRaises((ValueError, OSError)): s.verify_snapshot(target, self.sha)

    def test_anchor_binding_and_migration_ledger_are_verified_beyond_hashes(self):
        (self.snapshot / 'vault.sqlite.spark-provider.sqlite.anchor').write_text('b'*64)
        manifest = json.loads((self.snapshot / 'manifest.json').read_text())
        for member in manifest['files']: member['sha256'] = a.sha(self.snapshot / member['file'])
        (self.snapshot / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'anchor'): s.verify_snapshot(self.snapshot)

    def test_mixed_main_and_provider_history_fails_even_with_valid_member_hashes(self):
        file = self.snapshot / 'vault.sqlite'
        with sqlite3.connect(file) as db: db.execute('UPDATE sale_payment_binding SET binding_digest=?', ('b'*64,))
        manifest = json.loads((self.snapshot / 'manifest.json').read_text())
        for member in manifest['files']: member['sha256'] = a.sha(self.snapshot / member['file'])
        (self.snapshot / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'binding mismatch'): s.verify_snapshot(self.snapshot)

    def production_snapshot(self):
        with sqlite3.connect(self.state / 'vault.sqlite') as db:
            db.execute("ALTER TABLE sale_payment_binding ADD COLUMN adapter_mode TEXT DEFAULT 'OFFICIAL_TEST'")
            db.execute("INSERT INTO sale_payment_binding VALUES('NAYAX_SPARK',?,'LIVE')", ('b'*64,))
            db.execute('CREATE TABLE command_controller_binding(command_id TEXT,binding_digest TEXT)')
            db.execute("INSERT INTO command_controller_binding VALUES('command',?)", ('c'*64,))
        for kind, binding in [('spark','b'*64),('controller','c'*64)]:
            name='vault.sqlite.'+kind+'-production-'+binding+'.sqlite'
            with sqlite3.connect(self.state / name) as db:
                table='spark_binding' if kind=='spark' else 'waveshare_state'
                db.execute('CREATE TABLE '+table+'(singleton INTEGER,binding_digest TEXT)')
                db.execute('INSERT INTO '+table+' VALUES(1,?)',(binding,))
            if kind=='spark': (self.state/(name+'.anchor')).write_text(binding)
        with patch.object(a,'STATE',self.state),patch.object(a,'ETC',self.root/'no-config'):
            return a.snapshot_databases()

    def test_rotated_production_and_old_sandbox_journals_restore_together(self):
        snapshot=self.production_snapshot(); report=s.verify_snapshot(snapshot,a.sha(snapshot/'manifest.json'))
        self.assertEqual(len(report['sparkJournalBindings']),2);self.assertEqual(len(report['controllerJournalBindings']),1)
        staged=self.root/'production-restored';s.stage_snapshot(snapshot,staged,a.sha(snapshot/'manifest.json'),MACHINE)
        for name in report['sparkJournalBindings']:
            self.assertEqual(a.sha(snapshot/name),a.sha(staged/name))
        self.assertFalse(s.verify_snapshot(snapshot)['activationAllowed'])

    def test_missing_old_production_controller_or_payment_generation_blocks_backup(self):
        self.production_snapshot()
        (self.state/('vault.sqlite.controller-production-'+'c'*64+'.sqlite')).unlink()
        with patch.object(a,'STATE',self.state),patch.object(a,'ETC',self.root/'no-config'):
            with self.assertRaisesRegex(ValueError,'Required coordinated journal missing'):a.snapshot_databases()

    def test_valid_hashes_cannot_relabel_a_production_journal_binding(self):
        snapshot=self.production_snapshot();name='vault.sqlite.spark-production-'+'b'*64+'.sqlite'
        with sqlite3.connect(snapshot/name) as db:db.execute('UPDATE spark_binding SET binding_digest=?',('a'*64,))
        (snapshot/(name+'.anchor')).write_text('a'*64)
        manifest=json.loads((snapshot/'manifest.json').read_text())
        for member in manifest['files']:member['sha256']=a.sha(snapshot/member['file'])
        (snapshot/'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError,'filename binding mismatch'):s.verify_snapshot(snapshot)

    def test_group_writable_staging_parent_is_rejected(self):
        parent = self.root / 'untrusted'; parent.mkdir(); parent.chmod(0o770)
        with self.assertRaisesRegex(ValueError, 'writable'): s.stage_snapshot(self.snapshot, parent / 'restored', self.sha, MACHINE)
        self.assertFalse((parent / 'restored').exists())

    def test_manifest_wrong_machine_digest_traversal_and_duplicate_keys_fail(self):
        with self.assertRaisesRegex(ValueError, 'digest'): s.stage_snapshot(self.snapshot, self.root / 'bad', '0'*64, MACHINE)
        with self.assertRaisesRegex(ValueError, 'another machine'): s.stage_snapshot(self.snapshot, self.root / 'bad', self.sha, '00000000-0000-4000-8000-000000000002')
        self.assertFalse((self.root / 'bad').exists())
        manifest = json.loads((self.snapshot / 'manifest.json').read_text()); manifest['files'][0]['file'] = '../vault.sqlite'
        (self.snapshot / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'member invalid'): s.verify_snapshot(self.snapshot)
        with self.assertRaisesRegex(ValueError, 'Duplicate'): s.parse('{"a":1,"a":2}')

    def test_staging_is_create_only_private_and_technically_held(self):
        before = {p.name: a.sha(p) for p in self.snapshot.iterdir()}
        out = self.root / 'restored'; result = s.stage_snapshot(self.snapshot, out, self.sha, MACHINE)
        self.assertFalse(result['serviceStarted']); self.assertEqual(result['providerCalls'], 0)
        self.assertFalse((out / s.PENDING).exists()); self.assertTrue((out / s.RECEIPT).exists())
        with sqlite3.connect(out / 'vault.sqlite') as db:
            self.assertEqual(db.execute('SELECT service_locked,automation_halted,recovery_required,last_cloud_success_at FROM machine_meta').fetchone(), (1,1,1,None))
            self.assertEqual(db.execute('SELECT value FROM original_facts').fetchone(), ('captured-sale-and-stock-unchanged',))
        self.assertEqual((out / 'vault.sqlite').stat().st_mode & 0o777, 0o600)
        self.assertEqual({p.name: a.sha(p) for p in self.snapshot.iterdir()}, before)
        with self.assertRaisesRegex(ValueError, 'must be new'): s.stage_snapshot(self.snapshot, out, self.sha, MACHINE)

    def test_interrupted_staging_keeps_pending_marker_and_original(self):
        out = self.root / 'interrupted'; original = s.write_new
        def stop_at_main(path, data):
            if Path(path).name == 'vault.sqlite': raise OSError('simulated disk interruption')
            return original(path, data)
        with patch.object(s, 'write_new', side_effect=stop_at_main):
            with self.assertRaises(OSError): s.stage_snapshot(self.snapshot, out, self.sha, MACHINE)
        self.assertTrue((out / s.PENDING).exists()); self.assertFalse((out / s.RECEIPT).exists())
        self.assertEqual(a.sha(self.snapshot / 'manifest.json'), self.sha)

    def test_failed_upgrade_keeps_staged_hold_and_pending_marker(self):
        out = self.root / 'upgrade-failed'
        with patch.object(a, 'verify', side_effect=ValueError('signature rejected')):
            with self.assertRaisesRegex(ValueError, 'signature'): s.stage_snapshot(self.snapshot, out, self.sha, MACHINE, (self.root / 'release', self.root / 'key'))
        self.assertTrue((out / s.PENDING).exists())
        with sqlite3.connect(out / 'vault.sqlite') as db: self.assertEqual(db.execute('SELECT recovery_required FROM machine_meta').fetchone(), (1,))

    def test_actual_compiled_schema_upgrade_preserves_held_state_and_provider_bytes(self):
        node = shutil.which('node')
        self.assertIsNotNone(node)
        # Produce a real previous-version database using this exact candidate's migration SQL.
        legacy = self.root / 'legacy'; legacy.mkdir()
        script = """
const {createRequire}=require('node:module');const path=require('node:path');const r=createRequire(path.join(process.argv[1],'packages/vault-machine/package.json'));
const DB=r('better-sqlite3');const {MIGRATIONS,LOCAL_SCHEMA_VERSION}=require(path.join(process.argv[1],'packages/vault-machine/dist/migrations'));
const db=new DB(process.argv[2]);db.exec('CREATE TABLE schema_migration(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT)');
for(const m of MIGRATIONS.filter(m=>m.version<LOCAL_SCHEMA_VERSION)){db.exec(m.sql);db.prepare('INSERT INTO schema_migration VALUES(?,?,?)').run(m.version,m.name,new Date().toISOString())}
db.prepare('INSERT INTO machine_meta(singleton,machine_id,app_version,source_commit,schema_version) VALUES(1,?,?,?,?)').run(process.argv[3],'0.1.0','synthetic-legacy-fixture',LOCAL_SCHEMA_VERSION-1);db.close();process.stdout.write(String(LOCAL_SCHEMA_VERSION));
"""
        env = {'PATH': os.environ['PATH'], 'NODE_ENV': 'test'}
        target_schema = int(subprocess.check_output([node, '-e', script, str(ROOT), str(legacy / 'vault.sqlite'), MACHINE], env=env, text=True))
        with patch.object(a, 'STATE', legacy), patch.object(a, 'ETC', self.root / 'no-config'): snapshot = a.snapshot_databases()
        out = self.root / 'upgraded'
        manifest = {'localSchemaVersion': target_schema, 'releaseId': 'synthetic-signed-release', 'sourceCommit': 'c'*40, 'appVersion': '0.2.0', 'files': [{'path': 'deploy/vault-linux/upgrade-snapshot.cjs'}]}
        actual_run = subprocess.run
        def run_real(argv, **kwargs): return actual_run([node, str(HERE / 'upgrade-snapshot.cjs'), *argv[2:]], **kwargs)
        with patch.object(a, 'verify', return_value=manifest), patch.object(s.subprocess, 'run', side_effect=run_real):
            result = s.stage_snapshot(snapshot, out, a.sha(snapshot / 'manifest.json'), MACHINE, (ROOT, self.root / 'fixture-key'))
        self.assertEqual(result['targetSchemaVersion'], target_schema)
        with sqlite3.connect(out / 'vault.sqlite') as db:
            self.assertEqual(db.execute('SELECT schema_version,service_locked,automation_halted,recovery_required FROM machine_meta').fetchone(), (target_schema,1,1,1))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM schema_migration').fetchone(), (target_schema,))

if __name__ == '__main__': unittest.main()
