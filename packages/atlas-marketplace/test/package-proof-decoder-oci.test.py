"""Synthetic archive tests only; no real image, runtime, network or daemon."""
import base64
import copy
import gzip
import hashlib
import importlib.util
import io
import json
import lzma
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / 'packages/atlas-marketplace/scripts/package-proof-decoder-oci.py'
loader = importlib.util.spec_from_file_location('image_assembler', SCRIPT)
a = importlib.util.module_from_spec(loader); loader.loader.exec_module(a)


def elf(machine=62):
    data = bytearray(64); data[:7] = b'\x7fELF\x02\x01\x01'
    data[16:18] = (3).to_bytes(2, 'little'); data[18:20] = machine.to_bytes(2, 'little')
    return bytes(data)


def archive_bytes(rows, node=False):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.PAX_FORMAT) as tar:
        for name, data, kind in rows:
            info = tarfile.TarInfo(name); info.mode = 0o644; info.mtime = 0
            if kind in ('symlink', 'hardlink'):
                info.type = tarfile.SYMTYPE if kind == 'symlink' else tarfile.LNKTYPE
                info.linkname = data; tar.addfile(info)
            elif kind == 'fifo':
                info.type = tarfile.FIFOTYPE; tar.addfile(info)
            else:
                info.size = len(data); tar.addfile(info, io.BytesIO(data))
    return lzma.compress(output.getvalue()) if node else gzip.compress(output.getvalue(), mtime=0)


class Fixture:
    def __init__(self, parent):
        self.base = parent
        self.root = parent / 'rootfs'; self.root.mkdir()
        self.archives = parent / 'archives'; self.archives.mkdir()
        self.inventory = parent / 'inventory.json'
        self.spec = copy.deepcopy(a.load_spec())
        self.rows = {}
        def write(name, data, mode=0o644):
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data); path.chmod(mode)
            for ancestor in path.parents:
                if ancestor == self.root:
                    break
                ancestor.chmod(0o755)
            self.rows[name] = {'path': name, 'size': len(data), 'sha256': a.sha(data), 'mode': mode}
        for source in self.spec['sources']:
            write(source['path'], (REPO / source['source']).read_bytes())
        node = self.spec['node']
        node_data = {node['members'][0]['member']: elf(), node['members'][1]['member']: b'SYNTHETIC license\n'}
        packed = archive_bytes([(name, data, 'file') for name, data in node_data.items()], True)
        (self.archives / node['archive']).write_bytes(packed); node['sha256'] = a.sha(packed)
        for member in node['members']:
            write(member['path'], node_data[member['member']], 0o755 if member['path'].endswith('/node') else 0o644)
        for package in self.spec['packages']:
            data = {'package.json': a.canonical({'name': package['name'], 'version': package['version']}), 'LICENSE': b'SYNTHETIC license\n'}
            if package['name'].startswith('@img/sharp-'):
                data['lib/synthetic.so'] = elf()
            else:
                data['index.js'] = b'// SYNTHETIC: never executed\n'
            packed = archive_bytes([('package/' + name, value, 'file') for name, value in data.items()])
            (self.archives / package['archive']).write_bytes(packed)
            package['integrity'] = 'sha512-' + base64.b64encode(hashlib.sha512(packed).digest()).decode()
            for name, value in data.items():
                write(a.BASE + '/node_modules/' + package['name'] + '/' + name, value)
        self.native_name = 'lib/x86_64-linux-gnu/ld-linux-x86-64.so.2'
        write(self.native_name, elf(), 0o755)
        link = self.root / 'lib64/ld-linux-x86-64.so.2'; link.parent.mkdir()
        link.symlink_to('../lib/x86_64-linux-gnu/ld-linux-x86-64.so.2')
        self.value = {'schema': 'atlas-proof-decoder-rootfs-inventory-v1', 'platform': 'linux/amd64',
                      'nativeObservationSha256': '1' * 64,
                      'native': [{'path': self.native_name, 'package': 'synthetic-libc', 'version': '0-test', 'archiveSha256': '2' * 64}],
                      'files': [self.rows[name] for name in sorted(self.rows)],
                      'symlinks': [{'path': 'lib64/ld-linux-x86-64.so.2', 'target': '../lib/x86_64-linux-gnu/ld-linux-x86-64.so.2'}]}
        self.save()
    def save(self):
        self.inventory.write_bytes(a.canonical(self.value))
    def run(self, name='image'):
        with patch.object(a, 'load_spec', return_value=self.spec):
            return a.assemble(self.root, self.inventory, self.archives, self.base / name)


class ImageAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.f = Fixture(self.base)
    def test_fixed_spec_matches_existing_code_lock_and_exact_versions(self):
        spec = a.load_spec()
        self.assertEqual(spec['node']['sha256'], 'f4cb75bb036f0d0eddf6b79d9596df1aaab9ddccd6a20bf489be5abe9467e84e')
        self.assertEqual((spec['nodeVersion'], spec['sharpVersion'], spec['libvipsVersion']), ('22.16.0', '0.33.5', '8.15.3'))
        self.assertEqual(len(spec['sources']), 5); self.assertEqual(len(spec['packages']), 11)
        lock = (REPO / spec['lock']['path']).read_bytes()
        self.assertEqual(a.sha(lock), spec['lock']['sha256'])
        for row in spec['sources']:
            self.assertEqual(a.sha((REPO / row['source']).read_bytes()), row['sha256'])
        for row in spec['packages']:
            self.assertIn(row['integrity'], lock.decode())
    def test_reproducible_oci_has_empty_config_and_complete_normalized_inventory(self):
        first = self.f.run('one')
        for row in self.f.value['files']:
            os.utime(self.f.root / row['path'], (42, 42))
        second = self.f.run('two')
        self.assertEqual(first, second)
        for path in (self.base / 'one').rglob('*'):
            if path.is_file():
                self.assertEqual(path.read_bytes(), (self.base / 'two' / path.relative_to(self.base / 'one')).read_bytes())
        blobs = self.base / 'one/blobs/sha256'
        config = json.loads((blobs / first['configDigest'][7:]).read_bytes())
        self.assertEqual(config['config'], {'Env': [], 'Volumes': {}})
        self.assertEqual(first['classification'], 'UNQUALIFIED_ASSEMBLY'); self.assertFalse(first['executionAllowed'])
        self.assertIsNone(first['engineRepoDigest']); self.assertFalse(first['nativeClosureComplete']); self.assertFalse(first['runtimeVersionsObserved'])
        with tarfile.open(blobs / first['layerDigest'][7:]) as layer:
            members = layer.getmembers(); self.assertEqual([m.name for m in members], sorted(m.name for m in members))
            for member in members:
                self.assertEqual((member.uid, member.gid, member.mtime, member.uname, member.gname), (0, 0, 0, '', ''))
                if member.isfile():
                    row = self.f.rows[member.name]
                    self.assertEqual(member.mode, row['mode']); self.assertEqual(a.sha(layer.extractfile(member).read()), row['sha256'])
                else:
                    self.assertEqual(member.mode, 0o777 if member.issym() else 0o755)
        for blob in blobs.iterdir():
            self.assertEqual(a.sha(blob.read_bytes()), blob.name)
    def test_archive_integrity_and_rootfs_substitution_refuse(self):
        archive = self.f.archives / self.f.spec['packages'][0]['archive']
        old = archive.read_bytes(); archive.write_bytes(old + b'altered')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            self.f.run()
        archive.write_bytes(old)
        node = self.f.root / a.BASE / 'bin/node'; node.write_bytes(elf() + b'changed')
        with self.assertRaises(ValueError):
            self.f.run()
        self.assertFalse((self.base / 'image/assembly-receipt.json').exists())
    def test_unexpected_files_and_elf_in_source_positions_refuse(self):
        rogue = self.f.root / 'shell'; rogue.write_bytes(elf())
        with self.assertRaisesRegex(ValueError, 'unexpected'):
            self.f.run()
        rogue.unlink()
        source = self.f.spec['sources'][0]
        (self.f.root / source['path']).write_bytes(elf())
        # Even synthetic matching pins cannot classify an ELF as JavaScript.
        source['sha256'] = a.sha(elf()); self.f.rows[source['path']].update(sha256=a.sha(elf()), size=64)
        self.f.save()
        with self.assertRaisesRegex(ValueError, 'ELF source substitution'):
            self.f.run()
    def test_hardlinks_setid_and_symlink_ancestors_refuse(self):
        source = self.f.root / self.f.spec['sources'][0]['path']
        duplicate = self.base / 'hardlink'; os.link(source, duplicate)
        with self.assertRaisesRegex(ValueError, 'hardlink'):
            self.f.run()
        duplicate.unlink(); source.chmod(0o4644)
        with self.assertRaisesRegex(ValueError, 'mode'):
            self.f.run()
        source.chmod(0o644)
        actual = self.f.root / 'opt'; moved = self.base / 'moved-opt'; actual.rename(moved); actual.symlink_to(moved)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            self.f.run()
        with self.assertRaises(OSError):
            a.read_regular(actual / 'atlas-proof-decoder/worker.mjs', a.MAX_FILE)
    def test_fifo_inventory_archive_and_post_scan_staged_file_refuse_without_blocking(self):
        # A subprocess deadline makes regression failure bounded even if open()
        # blocks again. No writer is attached to any of these real FIFO paths.
        child = r'''
import os, runpy, sys
from pathlib import Path
module = runpy.run_path(sys.argv[1])
a = module['a']; f = module['Fixture'](Path(sys.argv[2]))
mode = sys.argv[3]
def fifo(path):
    path.unlink(); os.mkfifo(path)
if mode == 'inventory':
    fifo(f.inventory)
elif mode == 'archive':
    fifo(f.archives / f.spec['node']['archive'])
else:
    scan = a.scan
    def replace_after_scan(root, files, links):
        directories = scan(root, files, links)
        fifo(root / f.spec['sources'][0]['path'])
        return directories
    a.scan = replace_after_scan
try:
    f.run()
except ValueError as error:
    assert str(error) == 'regular bounded nonlinked file required', str(error)
else:
    raise AssertionError('FIFO was accepted')
assert not (f.base / 'image/assembly-receipt.json').exists()
'''
        for mode in ('inventory', 'archive', 'post-scan-staged'):
            with self.subTest(mode=mode):
                directory = self.base / mode; directory.mkdir()
                result = subprocess.run([sys.executable, '-B', '-c', child, str(Path(__file__).resolve()), str(directory), mode],
                                        capture_output=True, text=True, timeout=3)
                self.assertEqual(result.returncode, 0, result.stderr)
    def test_native_architecture_and_link_escape_refuse(self):
        native = self.f.root / self.f.native_name; native.write_bytes(elf(183))
        self.f.rows[self.f.native_name]['sha256'] = a.sha(elf(183)); self.f.save()
        with self.assertRaisesRegex(ValueError, 'ELF kind'):
            self.f.run()
        for target in ('/etc/passwd', '../../outside', '../lib/../lib/x86_64-linux-gnu/ld-linux-x86-64.so.2', '../lib64/ld-linux-x86-64.so.2'):
            value = copy.deepcopy(self.f.value); value['symlinks'][0]['target'] = target
            with self.assertRaises(ValueError):
                a.inventory_data(a.canonical(value))
    def test_closed_inventory_duplicates_counts_and_portable_paths(self):
        for path in ('/absolute', '../outside', 'a//b', 'a/./b', 'a\\b', 'a:b', 'a/space name', 'a/' + 'x' * 129, 'a/.npmrc'):
            with self.assertRaises(ValueError):
                a.path_name(path)
        for mutate in (lambda v: v.update(qualified=True), lambda v: v['files'].append(v['files'][0]),
                       lambda v: v['files'].reverse(), lambda v: v['files'][0].update(size=True),
                       lambda v: v['files'][0].update(size=a.MAX_FILE + 1), lambda v: v['native'][0].update(path='bin/sh')):
            value = copy.deepcopy(self.f.value); mutate(value)
            with self.assertRaises(ValueError):
                a.inventory_data(a.canonical(value))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            a.parse_json(b'{"x":1,"x":2}')
        with patch.object(a, 'MAX_TOTAL', 1), self.assertRaisesRegex(ValueError, 'total'):
            a.inventory_data(a.canonical(self.f.value))
        with patch.object(a, 'MAX_FILES', 1), self.assertRaisesRegex(ValueError, 'counts'):
            a.inventory_data(a.canonical(self.f.value))
    def test_output_never_overwrites_or_enters_input_trees(self):
        sentinel = self.base / 'image'; sentinel.mkdir(); (sentinel / 'keep').write_text('keep')
        with self.assertRaisesRegex(ValueError, 'new output'):
            self.f.run()
        self.assertEqual((sentinel / 'keep').read_text(), 'keep')
        (self.base / 'alias').symlink_to(sentinel, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'new output'):
            self.f.run('alias')
        for output in (self.f.root / 'new', self.f.archives / 'new', self.base / 'alias/new'):
            with patch.object(a, 'load_spec', return_value=self.f.spec), self.assertRaises(ValueError):
                a.assemble(self.f.root, self.f.inventory, self.f.archives, output)
    def test_tar_duplicate_escape_special_links_and_decompression_bounds(self):
        cases = [ [('package/a', b'a', 'file'), ('package/a', b'b', 'file')],
                  [('package/../outside', b'a', 'file')], [('package/a', 'package/b', 'hardlink')],
                  [('package/a', '../outside', 'symlink')], [('package/a', b'', 'fifo')] ]
        for rows in cases:
            packed = archive_bytes(rows); path = self.base / 'case.tgz'; path.write_bytes(packed)
            with self.assertRaises((ValueError, tarfile.TarError)):
                a.archive_entries(path, hashlib.sha512(packed).digest(), 'sha512', 'package')
        packed = archive_bytes([('package/a', b'x' * 128, 'file')]); path.write_bytes(packed)
        for limit, amount in [('MAX_FILE', 1), ('MAX_MEMBERS', 0), ('MAX_EXPANDED', 512), ('MAX_ARCHIVE', 1)]:
            with patch.object(a, limit, amount), self.assertRaises(ValueError):
                a.archive_entries(path, hashlib.sha512(packed).digest(), 'sha512', 'package')
    def test_node_links_are_validated_but_never_packaged(self):
        prefix = 'node-v22.16.0-linux-x64'
        valid = [(prefix + '/lib/tool.js', b'// fixture', 'file'), (prefix + '/bin/tool', '../lib/tool.js', 'symlink')]
        packed = archive_bytes(valid, True); path = self.base / 'node.tar.xz'; path.write_bytes(packed)
        entries, _ = a.archive_entries(path, hashlib.sha256(packed).digest(), 'sha256', prefix, True)
        self.assertNotIn(prefix + '/bin/tool', entries)
        for target in ('../../outside', '/etc/passwd', '../bin/tool', '../missing'):
            packed = archive_bytes([valid[0], (prefix + '/bin/tool', target, 'symlink')], True); path.write_bytes(packed)
            with self.assertRaises(ValueError):
                a.archive_entries(path, hashlib.sha256(packed).digest(), 'sha256', prefix, True)
    def test_unselected_node_config_is_omitted_and_selected_config_still_refuses(self):
        node = self.f.spec['node']; prefix = 'node-v22.16.0-linux-x64'
        config = prefix + '/lib/node_modules/npm/.npmrc'
        rows = [(member['member'], (self.f.root / member['path']).read_bytes(), 'file') for member in node['members']]
        rows += [(config, b'# public synthetic package config\n', 'file'),
                 (prefix + '/lib/node_modules/npm/bin/npm-cli.js', b'// unused tool\n', 'file'),
                 (prefix + '/bin/npm', '../lib/node_modules/npm/bin/npm-cli.js', 'symlink')]
        packed = archive_bytes(rows, True); (self.f.archives / node['archive']).write_bytes(packed); node['sha256'] = a.sha(packed)
        receipt = self.f.run()
        with tarfile.open(self.base / 'image/blobs/sha256' / receipt['layerDigest'][7:]) as layer:
            self.assertEqual({member.name for member in layer if member.isfile()}, set(self.f.rows))
        # Neither renaming a selected config member nor staging its original
        # name can bring it into the closure; all npm members remain selected.
        node['members'].append({'member': config, 'path': a.BASE + '/licenses/renamed-config'})
        with self.assertRaisesRegex(ValueError, 'credential/config'):
            a.expected_files(self.f.spec, self.f.archives)
        node['members'].pop()
        value = copy.deepcopy(self.f.value); value['files'][0]['path'] = a.BASE + '/.npmrc'
        with self.assertRaisesRegex(ValueError, 'credential/config'):
            a.inventory_data(a.canonical(value))
        staged = self.f.root / a.BASE / '.npmrc'; staged.write_bytes(b'# synthetic\n')
        with self.assertRaisesRegex(ValueError, 'credential/config'):
            self.f.run('staged-config')
        npm = archive_bytes([('package/.npmrc', b'# synthetic\n', 'file')]); path = self.base / 'config.tgz'; path.write_bytes(npm)
        with self.assertRaisesRegex(ValueError, 'credential/config'):
            a.archive_entries(path, hashlib.sha512(npm).digest(), 'sha512', 'package')
    def test_missing_extra_archives_package_identity_and_native_inventory_refuse(self):
        extra = self.f.archives / 'extra.tgz'; extra.write_bytes(b'no')
        with self.assertRaisesRegex(ValueError, 'unexpected archive'):
            self.f.run()
        extra.unlink()
        self.f.spec['packages'][0]['version'] = '9.9.9'
        with self.assertRaisesRegex(ValueError, 'package identity'):
            self.f.run()
        self.f.spec['packages'][0]['version'] = '0.33.5'
        value = copy.deepcopy(self.f.value); value['native'] = []; self.f.inventory.write_bytes(a.canonical(value))
        with self.assertRaisesRegex(ValueError, 'counts'):
            self.f.run()


if __name__ == '__main__':
    unittest.main(verbosity=2)
