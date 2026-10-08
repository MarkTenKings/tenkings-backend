import importlib.util
import contextlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1] / 'appliance.py'
spec = importlib.util.spec_from_file_location('appliance', FILE)
a = importlib.util.module_from_spec(spec); spec.loader.exec_module(a)

class ApplianceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name).resolve()
        self.release = self.root / 'release'; self.release.mkdir()
        self.key = self.root / 'private.pem'; self.pub = self.root / 'public.pem'
        a.run(['openssl', 'genpkey', '-algorithm', 'Ed25519', '-out', self.key])
        a.run(['openssl', 'pkey', '-in', self.key, '-pubout', '-out', self.pub])
        for member in ['runtime/bin/node', 'packages/vault-machine/dist/cli.js', 'packages/vault-machine/package.json', 'packages/vault-contracts/dist/index.js', 'frontend/vault-kiosk/dist/index.html', 'deploy/vault-linux/launch.py', 'deploy/vault-linux/probe.cjs', 'deploy/vault-linux/templates/' + a.UNIT]:
            file = self.release / member; file.parent.mkdir(parents=True, exist_ok=True); file.write_text('fixture')
        (self.release / 'runtime/bin/node').chmod(0o755)
        (self.release / 'deploy/vault-linux/runtime.json').write_text(json.dumps(a.PIN))
        # Synthetic metadata exercises the signer; it never represents a real build.
        probe = {'nodeVersion': a.PIN['nodeVersion'], 'nodeAbi': '127', 'platform': 'linux', 'architecture': 'x64',
                 'betterSqlite3Version': a.PIN['betterSqlite3Version'], 'sqliteVersion': '3.49.2',
                 'wal': True, 'transactionRollback': True, 'integrity': True}
        self.provenance = {'schemaVersion': 1, 'sourceState': 'CLEAN_COMMITTED', 'sourceCommit': 'a'*40,
                           'releaseAuthorized': True, 'buildCompleted': True, 'nativeBuild': 'linux-x64',
                           'pnpmVersion': a.PIN['pnpmVersion'], 'nodeArchiveSha256': a.PIN['nodeArchiveSha256'],
                           'lockfileSha256': 'b'*64, 'nativeProbe': probe}
        (self.release / 'source-build.json').write_text(json.dumps(self.provenance))
        (self.release / 'native-runtime-evidence.json').write_text(json.dumps(probe))
        a.make_manifest(SimpleNamespace(release=self.release, release_id='test-1', app_version='0.1.0', source_commit='a'*40, schema_version=3, signing_key=self.key))

    def tearDown(self): self.tmp.cleanup()

    def test_signed_payload_verifies(self):
        self.assertEqual(a.verify(self.release, self.pub)['releaseId'], 'test-1')

    def test_unsigned_candidate_cannot_be_signed_as_reviewed_release(self):
        for evidence in [{'sourceState': 'UNCOMMITTED_CANDIDATE'}, {'releaseAuthorized': False}]:
            (self.release / 'source-build.json').write_text(json.dumps(evidence))
            with self.assertRaisesRegex(ValueError, 'unsigned source rehearsal'):
                a.make_manifest(SimpleNamespace(release=self.release, release_id='test-2', app_version='0.1.0', source_commit='a'*40, schema_version=6, signing_key=self.key))

    def test_incomplete_mismatched_and_unprobed_builds_are_not_signable(self):
        for updates in [{'buildCompleted': False}, {'sourceState': 'UNVERIFIED'}, {'sourceCommit': 'c'*40},
                        {'nodeArchiveSha256': 'd'*64}, {'nativeProbe': {**self.provenance['nativeProbe'], 'wal': False}}]:
            (self.release / 'source-build.json').write_text(json.dumps({**self.provenance, **updates}))
            with patch.object(a, 'run', side_effect=AssertionError('Invalid build must not invoke signing')):
                with self.assertRaises(ValueError): a.completed_build(self.release, 'a'*40)
        (self.release / 'source-build.json').unlink()
        with self.assertRaisesRegex(ValueError, 'Completed clean'): a.completed_build(self.release, 'a'*40)

    def test_tampered_payload_rejected(self):
        (self.release / 'runtime/bin/node').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'mismatch'): a.verify(self.release, self.pub)

    def test_signature_tampering_rejected(self):
        (self.release / 'release.json').write_text((self.release / 'release.json').read_text() + ' ')
        with self.assertRaises(subprocess.CalledProcessError): a.verify(self.release, self.pub)

    def test_foreign_signing_key_rejected(self):
        second = self.root / 'other.pem'; second_pub = self.root / 'other-public.pem'
        a.run(['openssl', 'genpkey', '-algorithm', 'Ed25519', '-out', second]); a.run(['openssl', 'pkey', '-in', second, '-pubout', '-out', second_pub])
        with self.assertRaises(subprocess.CalledProcessError): a.verify(self.release, second_pub)

    def test_extra_file_and_symlink_rejected(self):
        other = self.release / 'unexpected'; other.write_text('secret')
        with self.assertRaises(ValueError): a.verify(self.release, self.pub)
        other.unlink(); other.symlink_to(self.key)
        with self.assertRaisesRegex(ValueError, 'symlink'): a.verify(self.release, self.pub)

    def test_manifest_symlink_rejected_before_crypto(self):
        manifest = self.release / 'release.json'; copy = self.root / 'manifest.json'
        manifest.rename(copy); manifest.symlink_to(copy)
        with self.assertRaises((ValueError, OSError)): a.verify(self.release, self.pub)

    def test_paths_reject_traversal_and_config_injection(self):
        for path in ['../x', '/x', 'a//b', 'a/../b', 'a\\b', 'a\nx', 'a;$HOME']:
            with self.assertRaises(ValueError): a.safe_path(path)
        self.assertEqual(a.safe_path('node_modules/@tenkings/vault-contracts/index.js'), 'node_modules/@tenkings/vault-contracts/index.js')

    def test_missing_partial_and_blocked_maintenance_refuse_restart(self):
        for state in [{}, {'restartAllowed': True}, {'maintenanceActive': True, 'restartAllowed': True, 'blockers': ['UNKNOWN']}, {'maintenanceActive': True, 'restartAllowed': 1, 'blockers': []}]:
            with self.assertRaises(ValueError): a.allow_restart(state)
        a.allow_restart({'maintenanceActive': True, 'restartAllowed': True, 'blockers': []})

    def test_serial_rule_requires_unique_identity_and_no_substitution(self):
        props = {'ID_VENDOR_ID': '0403', 'ID_MODEL_ID': '6001', 'ID_SERIAL_SHORT': 'local-test-123'}
        rule = a.serial_rule(props, 'locks')
        self.assertIn('GROUP="vault-serial", MODE="0660"', rule)
        self.assertIn('ID_SERIAL_SHORT', rule)
        for invalid in ['', '*', '"; RUN+="evil', 'same\nline']:
            with self.assertRaises(ValueError): a.serial_rule({**props, 'ID_SERIAL_SHORT': invalid}, 'locks')

    def test_native_probe_failure_leaves_current_pointer_unchanged(self):
        base = self.root / 'install'; base.mkdir()
        old = base / 'old'; old.mkdir(); (base / 'current').symlink_to(old)
        original_run = a.run
        def command(argv, **kwargs):
            if str(argv[0]).endswith('/runtime/bin/node'): raise ValueError('Native ABI probe failed')
            return original_run(argv, **kwargs)
        with patch.object(a, 'BASE', base), patch.object(a, 'run', command):
            with self.assertRaisesRegex(ValueError, 'ABI'): a.stage(self.release, self.pub)
        self.assertEqual((base / 'current').resolve(), old.resolve())

    def test_backup_keeps_wal_state_and_payment_controller_journals_without_restore(self):
        state = self.root / 'state'; state.mkdir()
        connections = []
        try:
            for file in ['vault.sqlite', 'vault.sqlite.controller.sqlite', 'vault.sqlite.spark-provider.sqlite']:
                db = sqlite3.connect(state / file); connections.append(db)
                db.execute('PRAGMA journal_mode=WAL'); db.execute('CREATE TABLE test(id INTEGER)'); db.execute('INSERT INTO test VALUES(7)'); db.commit()
            with patch.object(a, 'STATE', state): folder = a.snapshot_databases()
            manifest = json.loads((folder / 'manifest.json').read_text())
            self.assertFalse(manifest['automaticRestore']); self.assertEqual(len(manifest['files']), 3)
            for item in manifest['files']:
                with sqlite3.connect(folder / item['file']) as db: self.assertEqual(db.execute('SELECT id FROM test').fetchone(), (7,))
                self.assertEqual((folder / item['file']).stat().st_mode & 0o777, 0o600)
        finally:
            for db in connections: db.close()

    def test_backup_rejects_missing_spark_journal_from_payment_history(self):
        state = self.root / 'history-state'; state.mkdir()
        with sqlite3.connect(state / 'vault.sqlite') as db:
            db.execute('CREATE TABLE sale_payment_binding(provider TEXT)')
            db.execute("INSERT INTO sale_payment_binding VALUES('NAYAX_SPARK')")
        with patch.object(a, 'STATE', state), patch.object(a, 'ETC', self.root / 'no-config'):
            with self.assertRaisesRegex(ValueError, 'Required coordinated journal missing'):
                a.snapshot_databases()
        self.assertFalse((state / 'backups').exists())

    def test_coordinated_backup_records_identity_required_members_and_provider_anchor(self):
        state = self.root / 'coordinated-state'; state.mkdir()
        with sqlite3.connect(state / 'vault.sqlite') as db:
            db.execute('CREATE TABLE machine_meta(singleton INTEGER,machine_id TEXT,schema_version INTEGER)')
            db.execute("INSERT INTO machine_meta VALUES(1,'machine-fixture',5)")
            db.execute('CREATE TABLE sale_payment_binding(provider TEXT)')
            db.execute("INSERT INTO sale_payment_binding VALUES('NAYAX_SPARK')")
        with sqlite3.connect(state / 'vault.sqlite.spark-provider.sqlite') as db:
            db.execute('CREATE TABLE spark_binding(binding_digest TEXT)')
        anchor = state / 'vault.sqlite.spark-provider.sqlite.anchor'; anchor.write_text('a' * 64)
        with patch.object(a, 'STATE', state), patch.object(a, 'ETC', self.root / 'no-config'):
            folder = a.snapshot_databases()
        manifest = json.loads((folder / 'manifest.json').read_text())
        self.assertEqual(manifest['schemaVersion'], 2)
        self.assertEqual(manifest['machine'], {'machineId': 'machine-fixture', 'localSchemaVersion': 5})
        self.assertIn(anchor.name, manifest['requiredFiles'])
        self.assertIn('vault.sqlite.spark-provider.sqlite', manifest['requiredFiles'])
        self.assertEqual((folder / anchor.name).read_text(), 'a' * 64)
        self.assertTrue(manifest['snapshotId']); self.assertFalse(manifest['automaticRestore'])

    def test_diagnostics_omits_private_provider_and_cookie_fields(self):
        secret = 'NEVER-IN-SUPPORT'
        responses = [({}, {'Set-Cookie': 'session=' + secret + '; HttpOnly'}), ({'data': {'buildIdentity': {'appVersion': '0.1.0', 'sourceCommit': 'a'*40, 'secret': secret}, 'provider': {'serial': secret}, 'integrity': {'ok': True}, 'serviceLock': {'service_locked': 1}}}, {})]
        with patch.object(a, 'api', side_effect=responses): report = a.diagnostics()
        self.assertTrue(report['service']['integrityOk']); self.assertNotIn(secret, json.dumps(report))

    def test_schema_change_never_stages_or_stops_service(self):
        args = SimpleNamespace(command='update', release=self.release, apply=True)
        with patch.object(a, 'require_host'), patch.object(a, 'safe_install_parents'), patch.object(a, 'protected_reference'), patch.object(a, 'verify', return_value={'localSchemaVersion': 4}), patch.object(a, 'maintenance', return_value={'localSchemaVersion': 3}), patch.object(a, 'stage') as stage, patch.object(a, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'migration'): a.operate(args)
            stage.assert_not_called(); run.assert_not_called()

    def test_blocked_authority_never_stops_service(self):
        args = SimpleNamespace(command='restart', apply=True)
        with patch.object(a, 'require_host'), patch.object(a, 'safe_install_parents'), patch.object(a, 'protected_reference'), patch.object(a.os, 'geteuid', return_value=0), patch.object(a, 'private_json', return_value={}), patch.object(a, 'service_read_preflight'), patch.object(a, 'maintenance', return_value={'maintenanceActive': False, 'restartAllowed': False, 'blockers': ['PAYMENT_UNKNOWN']}), patch.object(a, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Restart blocked'): a.operate(args)
            run.assert_not_called()

    def test_failed_backup_never_switches_or_starts_service(self):
        args = SimpleNamespace(command='update', release=self.release, apply=True)
        commands = []
        def run(argv): commands.append(argv); return 'inactive'
        status = {'localSchemaVersion': 3, 'maintenanceActive': True, 'restartAllowed': True, 'blockers': []}
        with patch.object(a, 'require_host'), patch.object(a, 'safe_install_parents'), patch.object(a, 'protected_reference'), patch.object(a.os, 'geteuid', return_value=0), patch.object(a, 'private_json', return_value={}), patch.object(a, 'service_read_preflight'), patch.object(a, 'verify', return_value={'localSchemaVersion': 3}), patch.object(a, 'maintenance', return_value=status), patch.object(a, 'stage', return_value=(self.release, {})), patch.object(a, 'run', side_effect=run), patch.object(a, 'snapshot_databases', side_effect=ValueError('Backup integrity failed')), patch.object(a, 'switch_pointer') as switch:
            with self.assertRaisesRegex(ValueError, 'Backup'): a.operate(args)
            switch.assert_not_called(); self.assertFalse(any('start' in command for command in commands))

    def test_pnpm_transitive_sibling_materialized_without_links(self):
        spec = importlib.util.spec_from_file_location('runtime_dependencies', FILE.with_name('runtime-dependencies.py'))
        deps = importlib.util.module_from_spec(spec); spec.loader.exec_module(deps)
        source = self.root / 'workspace'; source.mkdir()
        (source / 'package.json').write_text(json.dumps({'dependencies': {'first': '1.0.0'}}))
        first = source / 'node_modules/.pnpm/first@1.0.0/node_modules/first'; first.mkdir(parents=True)
        (first / 'package.json').write_text(json.dumps({'name': 'first', 'dependencies': {'second': '1.0.0'}}))
        second = source / 'node_modules/.pnpm/second@1.0.0/node_modules/second'; second.mkdir(parents=True)
        (second / 'package.json').write_text(json.dumps({'name': 'second'})); (second / 'index.js').write_text('module.exports=42;')
        (source / 'node_modules/first').symlink_to(first)
        (first.parent / 'second').symlink_to(second)
        output = self.root / 'relocated'; output.mkdir()
        deps.copy_dependencies(source, output)
        relocated = output / 'node_modules/first/node_modules/second/index.js'
        self.assertEqual(relocated.read_text(), 'module.exports=42;')
        self.assertFalse(any(p.is_symlink() for p in output.rglob('*')))

    def test_source_symlink_swap_never_copies_private_bytes(self):
        base = self.root / 'install'; base.mkdir()
        secret = self.root / 'private-fixture'; secret.write_text('DO-NOT-COPY-PRIVATE-FIXTURE'); secret.chmod(0o600)
        member = self.release / 'frontend/vault-kiosk/dist/index.html'
        original_verify = a.verify
        def swap(directory, key):
            manifest = original_verify(directory, key)
            member.unlink(); member.symlink_to(secret)
            return manifest
        with patch.object(a, 'BASE', base), patch.object(a, 'verify', side_effect=swap):
            with self.assertRaises(OSError): a.stage(self.release, self.pub)
        staged = base / 'releases/test-1'
        self.assertEqual(staged.stat().st_mode & 0o777, 0o700)
        self.assertFalse((staged / 'frontend/vault-kiosk/dist/index.html').exists())

    def test_service_writable_reference_is_not_a_trust_anchor(self):
        public = self.root / 'writable-key.pem'; public.write_text('public'); public.chmod(0o666)
        with self.assertRaisesRegex(ValueError, 'Root-owned'): a.protected_reference(public)

    @contextlib.contextmanager
    def production_install_fixture(self):
        """Real signed payload/config files; host/account/probe effects are fake."""
        import pwd
        import grp
        self.root.chmod(0o755)
        base, etc, state = (self.root / name for name in ['production-base', 'production-etc', 'production-state'])
        etc.mkdir(); etc.chmod(0o755)
        systemd = self.root / 'production-systemd'; systemd.mkdir()
        references = {}
        for field in ['VAULT_CONFIG_PUBLIC_KEY_PATH', 'VAULT_WAVESHARE_CONFIG_PATH', 'VAULT_SPARK_CONFIG_PATH', 'VAULT_SPARK_PROVISIONING_PATH', 'VAULT_SPARK_ACTIVATION_PATH']:
            file = self.root / (field + '.fixture'); file.write_text('SYNTHETIC_ONLY'); file.chmod(0o644); references[field] = str(file)
        (etc / 'spark-activation-public.pem').write_bytes(self.pub.read_bytes())
        (etc / 'spark-activation-public.pem').chmod(0o644)
        evidence = self.root / 'production-evidence'; evidence.mkdir(); evidence.chmod(0o755)
        for kind in ['NAYAX_CERTIFICATION', 'TERMINAL_SANDBOX', 'CABINET_ACCEPTANCE', 'LINUX_RELEASE', 'PRODUCTION_ACCOUNT']:
            for suffix in ['evidence', 'artifact']:
                file = evidence / (kind + '.' + suffix); file.write_text('SYNTHETIC_ONLY'); file.chmod(0o644)
        config = self.root / 'initial-production.json'
        value = {**references, 'VAULT_MACHINE_ID': '00000000-0000-4000-8000-000000000001', 'VAULT_CLOUD_ORIGIN': 'https://synthetic.invalid',
                 'VAULT_MACHINE_CREDENTIAL': 'synthetic-machine-credential', 'VAULT_ADAPTER_CALLBACK_TOKEN': 'synthetic-callback-token',
                 'VAULT_MAINTENANCE_TOKEN': 'synthetic-maintenance-token-' + '0' * 32, 'VAULT_CONFIG_KEY_ID': 'synthetic-key',
                 'VAULT_PAYMENT_ADAPTER': 'NAYAX_SPARK_PRODUCTION', 'VAULT_CONTROLLER_ADAPTER': 'WAVESHARE',
                 'VAULT_SPARK_EVIDENCE_PATH': str(evidence), 'VAULT_SPARK_PRODUCTION_TOKEN_SECRET': 'synthetic-token-secret',
                 'VAULT_SPARK_PRODUCTION_SIGN_KEY': 'synthetic-sign-key'}
        config.write_text(json.dumps(value)); config.chmod(0o600)
        args = SimpleNamespace(release=self.release, public_key=self.pub, config=config, apply=True)
        commands, protected_paths, service_reads = [], [], []
        original_run = a.run
        def command(argv, **kwargs):
            argv = [str(item) for item in argv]
            if argv[0] == 'openssl': return original_run(argv, **kwargs)
            if argv[1:4] == ['-I', '-B', '-c'] and argv[4] == a.SERVICE_READ_PROBE:
                self.assertEqual((kwargs['user'], kwargs['group'], kwargs['extra_groups']), (4242, 4343, [4343, 4444]))
                self.assertEqual(kwargs['cwd'], '/'); self.assertNotIn('VAULT_MACHINE_CREDENTIAL', kwargs['env'])
                selected = [Path(file) for file in json.loads(kwargs['input'])]
                self.assertNotIn(config, selected); self.assertNotIn(etc / 'machine.env.json', selected)
                for file in selected:
                    a.regular(file)
                    if not file.stat().st_mode & stat.S_IROTH or any(not parent.stat().st_mode & stat.S_IXOTH for parent in file.parents if parent.is_relative_to(self.root)):
                        raise subprocess.CalledProcessError(1, argv)
                service_reads.append(selected)
                return ''
            commands.append(argv)
            if argv[:2] == ['getent', 'group'] or argv == ['systemctl', 'daemon-reload'] or argv[0].endswith('/runtime/bin/node'): return ''
            raise AssertionError('Unexpected host mutation in synthetic install test')
        def protect(file):
            # Model only root ownership: these macOS temporary files retain
            # their actual uid. Real regular-file/mode/existence checks remain.
            file = Path(file); self.assertTrue(file.is_relative_to(self.root))
            info = a.regular(file)
            a.need(not info.st_mode & 0o022, 'Root-owned non-writable trust/config required')
            protected_paths.append(file)
            return file
        def local_path(value):
            return {'/etc/systemd/system': systemd, '/var/log/tenkings-vault': self.root / 'production-log',
                    '/var/lib/ten-kings-vault-bench': self.root / 'production-bench'}.get(str(value), Path(value))
        with contextlib.ExitStack() as stack:
            for name, replacement in [('BASE', base), ('ETC', etc), ('STATE', state), ('Path', local_path), ('run', command), ('protected_reference', protect)]:
                stack.enter_context(patch.object(a, name, replacement))
            stack.enter_context(patch.object(a, 'require_host'))
            stack.enter_context(patch.object(a, 'safe_install_parents'))
            stack.enter_context(patch.object(a.os, 'geteuid', return_value=0))
            stack.enter_context(patch.object(a.os, 'getgrouplist', return_value=[4343]))
            stack.enter_context(patch.object(grp, 'getgrnam', side_effect=lambda name: SimpleNamespace(gr_gid=4343 if name == 'vault' else 4444)))
            stack.enter_context(patch.object(pwd, 'getpwnam', return_value=SimpleNamespace(pw_dir=str(state), pw_shell='/usr/bin/nologin', pw_uid=4242)))
            yield SimpleNamespace(args=args, base=base, etc=etc, config=config, value=value, commands=commands, protected_paths=protected_paths, service_reads=service_reads, systemd=systemd)

    def test_first_production_install_uses_verified_input_key_then_pins_it_without_starting(self):
        with self.production_install_fixture() as fixture:
            self.assertFalse((fixture.etc / 'release-public.pem').exists())
            fixture.args.apply = False
            plan = a.install(fixture.args)
            self.assertFalse(plan['startsService']); self.assertEqual(fixture.commands, [])
            self.assertFalse((fixture.etc / 'release-public.pem').exists())
            fixture.args.apply = True
            result = a.install(fixture.args)
            self.assertTrue(result['installed']); self.assertFalse(result['serviceEnabled']); self.assertFalse(result['serviceStarted'])
            self.assertEqual((fixture.etc / 'release-public.pem').read_bytes(), self.pub.read_bytes())
            self.assertEqual((fixture.etc / 'machine.env.json').read_bytes(), fixture.config.read_bytes())
            self.assertEqual((fixture.etc / 'machine.env.json').stat().st_mode & 0o777, 0o600)
            self.assertEqual((fixture.etc / 'release-public.pem').stat().st_mode & 0o777, 0o644)
            self.assertEqual((fixture.base / 'current').resolve(), fixture.base / 'releases/test-1')
            self.assertEqual([c for c in fixture.commands if c[0] == 'systemctl'], [['systemctl', 'daemon-reload']])
            self.assertIn(fixture.etc / 'spark-activation-public.pem', fixture.protected_paths)
            self.assertEqual(len(fixture.service_reads), 2)
            self.assertNotIn(fixture.etc / 'release-public.pem', fixture.service_reads[0])
            self.assertIn(fixture.etc / 'release-public.pem', fixture.service_reads[1])
            self.assertEqual(a.private_json(fixture.etc / 'machine.env.json')['VAULT_PAYMENT_ADAPTER'], 'NAYAX_SPARK_PRODUCTION')

    def test_first_install_existing_destinations_refuse_before_account_changes(self):
        for destination in ['release-public.pem', 'machine.env.json', 'release', 'pointer', 'unit']:
            with self.subTest(destination=destination), self.production_install_fixture() as fixture:
                target = (fixture.etc / destination if destination.endswith(('.pem', '.json')) else
                          fixture.base / 'releases/test-1' if destination == 'release' else
                          fixture.base / ('.current-' + str(os.getpid())) if destination == 'pointer' else fixture.systemd / a.UNIT)
                original = self.pub.read_bytes() if destination == 'release-public.pem' else b'PRESERVE_EXISTING'
                target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(original)
                with self.assertRaises(ValueError): a.install(fixture.args)
                self.assertEqual(fixture.commands, []); self.assertEqual(target.read_bytes(), original)
            # Each subtest uses the same signed fixture but a fresh config tree.
            for name in ['production-base', 'production-etc', 'production-evidence', 'production-systemd']:
                if (self.root / name).exists(): shutil.rmtree(self.root / name)

    def test_config_release_key_override_cannot_replace_fixed_trust_for_ordinary_reads(self):
        with self.production_install_fixture() as fixture:
            fixture.value['VAULT_RELEASE_PUBLIC_KEY_PATH'] = str(self.pub)
            fixture.config.write_text(json.dumps(fixture.value))
            with self.assertRaises(FileNotFoundError): a.private_json(fixture.config)
            self.assertEqual(fixture.commands, [])
            installed = fixture.etc / 'machine.env.json'; installed.write_bytes(fixture.config.read_bytes()); installed.chmod(0o600)
            with patch.object(a, 'api') as api:
                with self.assertRaises(FileNotFoundError): a.maintenance('status')
                api.assert_not_called()

    def test_first_install_still_requires_protected_activation_key_and_verified_release(self):
        with self.production_install_fixture() as fixture:
            self.pub.chmod(0o666)
            with self.assertRaisesRegex(ValueError, 'Root-owned'): a.install(fixture.args)
            self.assertEqual(fixture.commands, []); self.assertFalse((fixture.etc / 'release-public.pem').exists())
            self.pub.chmod(0o644)
            activation_key = fixture.etc / 'spark-activation-public.pem'
            activation_key.chmod(0o666)
            with self.assertRaisesRegex(ValueError, 'Root-owned'): a.install(fixture.args)
            self.assertEqual(fixture.commands, []); self.assertFalse((fixture.etc / 'release-public.pem').exists())
            activation_key.chmod(0o644)
            (self.release / 'runtime/bin/node').write_text('TAMPERED_SYNTHETIC_PAYLOAD')
            with self.assertRaisesRegex(ValueError, 'mismatch'): a.install(fixture.args)
            self.assertEqual(fixture.commands, []); self.assertFalse((fixture.etc / 'release-public.pem').exists())

    def test_install_refuses_private_runtime_references_before_publishing_release(self):
        with self.production_install_fixture() as fixture:
            evidence = Path(fixture.value['VAULT_SPARK_EVIDENCE_PATH'])
            for file, private_mode, normal_mode in [(Path(fixture.value['VAULT_SPARK_CONFIG_PATH']), 0o600, 0o644),
                                                    (evidence, 0o700, 0o755), (evidence / 'CABINET_ACCEPTANCE.artifact', 0o600, 0o644)]:
                with self.subTest(file=file.name):
                    file.chmod(private_mode)
                    try:
                        with self.assertRaisesRegex(ValueError, 'read/traverse'): a.install(fixture.args)
                        self.assertFalse((fixture.etc / 'release-public.pem').exists())
                        self.assertFalse((fixture.base / 'current').exists())
                        self.assertFalse((fixture.systemd / a.UNIT).exists())
                        self.assertFalse(any(command[0] == 'systemctl' for command in fixture.commands))
                    finally: file.chmod(normal_mode)

    def test_real_service_read_probe_checks_access_without_printing_contents(self):
        # Linux root build jobs drop to an unprivileged numeric uid. Non-root
        # developer jobs exercise the identical reader as their existing uid.
        uid = 65534 if os.geteuid() == 0 else os.geteuid()
        identity = {'user': uid, 'group': 65534, 'extra_groups': []} if os.geteuid() == 0 else {}
        with tempfile.TemporaryDirectory(prefix='vault-read-probe-', dir='/tmp') as temp:
            root = Path(temp).resolve(); root.chmod(0o755)
            folder = root / 'references'; folder.mkdir(); folder.chmod(0o755)
            file = folder / 'profile.json'; file.write_text('SYNTHETIC_BYTES_MUST_NOT_BE_PRINTED'); file.chmod(0o644)
            def probe(selected=file):
                result = subprocess.run([sys.executable, '-I', '-B', '-c', a.SERVICE_READ_PROBE, str(uid)], input=json.dumps([str(selected)]),
                                        text=True, capture_output=True, cwd='/', timeout=5, **identity)
                self.assertEqual(result.stdout, ''); self.assertNotIn('SYNTHETIC_BYTES', result.stderr)
                return result.returncode
            self.assertEqual(probe(), 0)
            if os.geteuid() == 0:
                os.chown(file, 0, 65534); file.chmod(0o640)
                os.chown(folder, 0, 65534); folder.chmod(0o750)
                self.assertEqual(probe(), 0)
            try:
                file.chmod(0); self.assertNotEqual(probe(), 0)
            finally: file.chmod(0o644)
            try:
                folder.chmod(0); self.assertNotEqual(probe(), 0)
            finally: folder.chmod(0o755)
            linked = folder / 'linked'; linked.symlink_to(file)
            self.assertNotEqual(probe(linked), 0)

    def test_preflight_rejects_systemd_hidden_home_reference_before_reader(self):
        import grp
        import pwd
        value = {'VAULT_CONFIG_PUBLIC_KEY_PATH': '/root/otherwise-readable-key.pem'}
        with patch.object(a.os, 'geteuid', return_value=0), patch.object(a.os, 'getgrouplist', return_value=[4343]), patch.object(pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=4242)), patch.object(grp, 'getgrnam', return_value=SimpleNamespace(gr_gid=4343)), patch.object(a, 'protected_reference'), patch.object(a, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'sandbox hides home'): a.service_read_preflight(value)
            run.assert_not_called()

    def test_unreadable_runtime_config_prevents_service_stop_and_staging(self):
        args = SimpleNamespace(command='update', release=self.release, apply=True)
        with patch.object(a, 'require_host'), patch.object(a, 'safe_install_parents'), patch.object(a, 'protected_reference'), patch.object(a.os, 'geteuid', return_value=0), patch.object(a, 'private_json', return_value={}), patch.object(a, 'service_read_preflight', side_effect=ValueError('read/traverse blocked')), patch.object(a, 'verify', return_value={'localSchemaVersion': 3}), patch.object(a, 'maintenance', return_value={'localSchemaVersion': 3}) as maintenance, patch.object(a, 'stage') as stage, patch.object(a, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'read/traverse'): a.operate(args)
            stage.assert_not_called(); run.assert_not_called(); maintenance.assert_called_once_with('status')

    def test_snapshot_entrypoints_do_not_create_bytecode_in_signed_tree(self):
        package = self.root / 'packaged-python'; package.mkdir()
        for name in ['appliance.py', 'snapshot-tools.py', 'runtime.json']:
            shutil.copyfile(FILE.with_name(name), package / name)
        before = {file.name: file.read_bytes() for file in package.iterdir()}
        env = {key: value for key, value in os.environ.items() if key not in ['PYTHONDONTWRITEBYTECODE', 'PYTHONPYCACHEPREFIX']}
        for script, command in [('appliance.py', 'verify-snapshot'), ('snapshot-tools.py', 'verify')]:
            result = subprocess.run([sys.executable, str(package / script), command, '--snapshot', str(self.root / 'missing-synthetic-snapshot')],
                                    env=env, capture_output=True, text=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual({file.name: file.read_bytes() for file in package.iterdir()}, before)

    def test_fifo_member_is_rejected_without_waiting_for_writer(self):
        fifo = self.root / 'pipe'; os.mkfifo(fifo)
        code = "import importlib.util,sys; s=importlib.util.spec_from_file_location('a',sys.argv[1]); a=importlib.util.module_from_spec(s); s.loader.exec_module(a); fd=a.os.open(sys.argv[2],a.os.O_RDONLY|a.os.O_DIRECTORY); a.read_member(fd,'pipe',16)"
        result = subprocess.run([sys.executable, '-c', code, str(FILE), str(self.root)], capture_output=True, text=True, timeout=2)
        self.assertNotEqual(result.returncode, 0); self.assertIn('Unsafe or oversized', result.stderr)

    def test_concurrent_deployment_is_excluded_and_lock_inode_retained(self):
        lock = self.root / 'operation.lock'
        with a.operation_guard(lock):
            inode = lock.stat().st_ino
            with self.assertRaisesRegex(ValueError, 'Another Vault'):
                with a.operation_guard(lock): self.fail('overlapping deployment')
        with a.operation_guard(lock): self.assertEqual(lock.stat().st_ino, inode)

if __name__ == '__main__': unittest.main()
