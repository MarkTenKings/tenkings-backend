"""Local safety tests; they do not boot a VM or claim lifecycle acceptance."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('service_vm', Path(__file__).with_name('run-installed-service-vm.py'))
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)


class ServiceVMTests(unittest.TestCase):
    def archive(self, root, members):
        path = root / 'input.tar.gz'
        with tarfile.open(path, 'w:gz') as stream:
            for member in members:
                stream.addfile(member, io.BytesIO(b'hello') if member.isfile() else None)
        return path

    def member(self, name, kind=tarfile.REGTYPE, mode=0o644):
        value = tarfile.TarInfo(name); value.type = kind; value.mode = mode
        value.size = 5 if value.isfile() else 0
        if value.issym() or value.islnk(): value.linkname = '/outside'
        return value

    def test_signed_archive_extraction_preserves_bytes_and_executable_mode(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); path = self.archive(root, [self.member('release/node', mode=0o755)])
            v.extract(path, root / 'out', 'release')
            self.assertEqual((root / 'out/release/node').read_bytes(), b'hello')
            self.assertEqual((root / 'out/release/node').stat().st_mode & 0o777, 0o755)

    def test_archive_rejects_traversal_links_duplicates_and_privileged_modes(self):
        cases = [[self.member('../outside')], [self.member('/release/file')], [self.member('other/file')],
                 [self.member('release/file', tarfile.SYMTYPE)], [self.member('release/file', tarfile.LNKTYPE)],
                 [self.member('release/file', tarfile.FIFOTYPE)], [self.member('release/file', mode=0o4755)],
                 [self.member('release/file', mode=0o666)], [self.member('release/file'), self.member('release/file')]]
        for members in cases:
            with self.subTest(members=members), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); path = self.archive(root, members)
                with self.assertRaises(ValueError): v.extract(path, root / 'out', 'release')
                self.assertFalse((root / 'outside').exists())
                self.assertEqual(list((root / 'out').iterdir()), [])

    def test_download_requires_exact_image_size_and_digest(self):
        for content, size, expected in [(b'hello', 4, 'unused'), (b'hello', 6, 'unused'), (b'hello', 5, '0' * 64)]:
            with self.subTest(size=size), tempfile.TemporaryDirectory() as folder:
                with patch.object(v.urllib.request, 'urlopen', return_value=io.BytesIO(content)), \
                     patch.object(v, 'IMAGE_BYTES', size), patch.object(v, 'IMAGE_SHA', expected):
                    with self.assertRaises(ValueError): v.download_image(Path(folder) / 'image')

    def test_public_input_mismatch_stops_before_extract_or_commands(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / next(iter(v.INPUTS))).write_bytes(b'changed')
            with patch.object(v, 'run') as run, patch.object(v, 'extract') as extract:
                with self.assertRaisesRegex(ValueError, 'hash mismatch'): v.prepare_inputs(root, root, root)
                run.assert_not_called(); extract.assert_not_called()

    def test_receipts_are_create_only_and_synthetic(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); v.save(root, 'test', {'success': False})
            with self.assertRaises(FileExistsError): v.save(root, 'test', {'success': True})
            self.assertEqual(json.loads((root / 'test.json').read_text()), {'classification': 'SYNTHETIC_ONLY', 'success': False})

    def test_seed_keeps_network_offline_and_unblocks_only_fixture_time_wait(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ('user-key', 'host-key', 'user-key.pub', 'host-key.pub'):
                (root / name).write_text('synthetic-key')
            with patch.object(v, 'run'):
                v.cloud_seed(root)
            config = json.loads((root / 'user-data').read_text().split('\n', 1)[1])
            self.assertFalse(config['package_update']); self.assertFalse(config['package_upgrade'])
            self.assertEqual(config['bootcmd'], [['systemctl', 'mask', '--now', 'systemd-time-wait-sync.service']])
            self.assertEqual(config['growpart'], {'mode': 'auto', 'devices': ['/']})
            self.assertTrue(config['disable_root']); self.assertFalse(config['ssh_pwauth'])

    def test_authority_receipt_requires_all_checks_identity_no_effects_and_cleanup(self):
        report = {'classification': 'SYNTHETIC_ONLY', 'passed': True, 'sourceCommit': v.SOURCE,
                  'releaseManifestSha256': 'a' * 64, 'checks': [{'name': str(n), 'result': 'PASS'} for n in range(34)],
                  'nodeVersion': '22.23.2', 'platform': 'linux', 'architecture': 'x64', 'providerNetworkAttempts': 0}
        for key in ('externalAcceptance', 'installedProductionActivation', 'serialComposed', 'syntheticPrivateKeysWritten'): report[key] = False
        for key in ('sourceReleaseMountedReadOnly', 'sourceManifestUnchanged', 'containerTrustCleaned', 'containerReleaseCopyCleaned'): report[key] = True
        self.assertTrue(v.authority_report_valid(report, 'a' * 64))
        for mutation in ({'passed': False}, {'sourceCommit': 'b' * 40}, {'checks': report['checks'][:-1]},
                         {'checks': [report['checks'][0]] * 34}, {'providerNetworkAttempts': 1},
                         {'serialComposed': True}, {'containerTrustCleaned': False}, {'externalAcceptance': True}):
            self.assertFalse(v.authority_report_valid({**report, **mutation}, 'a' * 64))
        self.assertFalse(v.authority_report_valid(report, 'b' * 64))

    def test_authority_timeout_removes_only_owned_container_with_safe_mounts(self):
        for foreign in (False, True):
            with self.subTest(foreign=foreign), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); evidence = root / 'evidence'; evidence.mkdir(); calls = []; inspections = 0
                token = 'a' * 32; container_id = 'b' * 64
                def command(argv, **kwargs):
                    nonlocal inspections
                    calls.append(argv)
                    if argv[1] == 'start': raise subprocess.TimeoutExpired(argv, 720)
                    if argv[1] == 'inspect':
                        inspections += 1
                        return SimpleNamespace(returncode=0 if inspections == 1 else 1,
                            stdout=json.dumps([{'Id': container_id, 'Config': {'Labels': {
                                'tenkings.synthetic-authority-owner': 'foreign' if foreign else token}}}]))
                    return SimpleNamespace(returncode=0, stdout='')
                with patch.object(v.uuid, 'uuid4', return_value=SimpleNamespace(hex=token)), patch.object(v, 'run', side_effect=command):
                    with self.assertRaises(ValueError if foreign else subprocess.TimeoutExpired):
                        v.production_authority(root, root / 'source', evidence)
                create = next(argv for argv in calls if argv[1] == 'create')
                self.assertEqual(create[create.index('--network') + 1], 'none')
                mounts = [create[n + 1] for n, arg in enumerate(create) if arg == '--mount']
                self.assertEqual(len(mounts), 3); self.assertTrue(all(mount.endswith(',readonly') for mount in mounts))
                self.assertTrue(all('dst=/etc' not in mount and 'dst=/opt' not in mount for mount in mounts))
                removals = [argv for argv in calls if argv[1] == 'rm']
                self.assertEqual(removals, [] if foreign else [['docker', 'rm', '--force', container_id]])
                if not foreign:
                    receipt = json.loads((evidence / 'host-authority-container.json').read_text())
                    self.assertTrue(receipt['ownedContainerRemoved']); self.assertFalse(receipt['passed'])


if __name__ == '__main__': unittest.main()
