#!/usr/bin/env python3
"""Offline, unqualified OCI assembly. Never extracts, executes or downloads inputs."""
import argparse
import base64
from contextlib import ExitStack
import gzip
import hashlib
import io
import json
import lzma
import os
from pathlib import Path
import posixpath
import re
import stat
import tarfile

SPEC = Path(__file__).resolve().parents[1] / 'images/proof-decoder/closure-spec.json'
MAX_JSON = 2 * 1024 * 1024
MAX_FILE = 128 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
MAX_MEMBERS = 20000
MAX_FILES = 4096
MAX_NATIVE = 64
MAX_LAYER = MAX_TOTAL + MAX_FILES * 4096 + 10240
BASE = 'opt/atlas-proof-decoder'
EMPTY_DIRS = {'dev', 'proc', 'sys', 'tmp'}
NATIVE = re.compile(r'(?:lib64|(?:usr/)?lib/x86_64-linux-gnu)/(?:ld-linux-x86-64\.so\.[0-9]+|lib[A-Za-z0-9_+.-]+\.so(?:\.[0-9]+)*)\Z')


def check(condition, reason):
    if not condition:
        raise ValueError(reason)


def exact(value, keys):
    check(type(value) is dict and set(value) == set(keys), 'closed shape required')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(value):
    check(type(value) is str and re.fullmatch('[a-f0-9]{64}', value), 'invalid digest')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def parse_json(data):
    check(len(data) <= MAX_JSON, 'JSON bound')
    def pairs(items):
        result = {}
        for key, value in items:
            check(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    def reject(_):
        raise ValueError('noninteger JSON number')
    return json.loads(data, object_pairs_hook=pairs, parse_float=reject, parse_constant=reject)


def structural_path(value):
    check(type(value) is str and 0 < len(value) <= 512, 'path bound')
    parts = value.split('/')
    check(len(parts) <= 20 and all(part not in ('', '.', '..') and len(part) <= 128 and
          re.fullmatch('[A-Za-z0-9_@.+-]+', part) for part in parts), 'noncanonical path')
    return value


def path_name(value):
    structural_path(value)
    check(not any(part in ('.git', '.ssh', '.npmrc', '.netrc', '.env') or part.startswith('.env.') for part in value.split('/')), 'credential/config path')
    return value


def structural_link_destination(path, target):
    check(type(target) is str and 0 < len(target) <= 512 and not target.startswith('/') and
          posixpath.normpath(target) == target, 'noncanonical link')
    check(all(part == '..' or re.fullmatch('[A-Za-z0-9_@.+-]+', part) for part in target.split('/')), 'invalid link')
    return structural_path(posixpath.normpath(posixpath.join(posixpath.dirname(path), target)))


def link_destination(path, target):
    return path_name(structural_link_destination(path, target))


def real_directory(value):
    path = Path(os.path.abspath(value))
    check(path.is_dir() and path.resolve(strict=True) == path, 'real directory required')
    return path


def directory_fd(path):
    # Walk from / with openat + O_NOFOLLOW; never follow a replaced ancestor.
    absolute = Path(os.path.abspath(path))
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in absolute.parts[1:]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd); fd = next_fd
        return fd
    except BaseException:
        os.close(fd); raise


def read_regular(path, limit):
    parent_fd = directory_fd(Path(path).parent)
    try:
        # A FIFO must reach fstat rejection without waiting for a writer.
        fd = os.open(Path(path).name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent_fd)
    finally:
        os.close(parent_fd)
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        check(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o7000 and info.st_size <= limit, 'regular bounded nonlinked file required')
        data = handle.read(limit + 1)
        check(len(data) == info.st_size and len(data) <= limit, 'file changed or exceeded bound')
        after = os.fstat(handle.fileno())
        check((info.st_size, info.st_mtime_ns, info.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'file changed while reading')
        return data, stat.S_IMODE(info.st_mode)


def elf(data, node=False):
    check(len(data) >= 64 and data[:7] == b'\x7fELF\x02\x01\x01' and
          int.from_bytes(data[18:20], 'little') == 62 and
          int.from_bytes(data[16:18], 'little') in ((2, 3) if node else (3,)), 'expected Linux x64 ELF kind')


class ExpandedReader:
    def __init__(self, handle):
        self.handle, self.used = handle, 0
    def read(self, amount):
        check(0 <= amount <= MAX_EXPANDED, 'archive read bound')
        data = self.handle.read(min(amount, MAX_EXPANDED - self.used + 1))
        self.used += len(data)
        check(self.used <= MAX_EXPANDED, 'expanded archive bound')
        return data


def archive_entries(path, expected, algorithm, prefix, node=False):
    data, _ = read_regular(path, MAX_ARCHIVE)
    actual = hashlib.new(algorithm, data).digest()
    check(actual == expected, 'archive integrity mismatch')
    source = lzma.LZMAFile(io.BytesIO(data)) if node else gzip.GzipFile(fileobj=io.BytesIO(data))
    entries, links, total = {}, {}, 0
    with source, tarfile.open(fileobj=ExpandedReader(source), mode='r|') as archive:
        for count, member in enumerate(archive, 1):
            check(count <= MAX_MEMBERS, 'archive member count')
            # The exact verified Node distribution has unselected public npm
            # config/tool files. Validate every member structurally; apply the
            # closure exclusions separately to selected Node source/dest paths.
            name = (structural_path if node else path_name)(member.name.rstrip('/') if member.isdir() else member.name)
            check(name == prefix or name.startswith(prefix + '/'), 'archive prefix escape')
            check(name not in entries and name not in links, 'duplicate archive member')
            check(not member.mode & 0o7000 and not member.islnk(), 'setid/sticky or hardlink member')
            if member.isdir():
                entries[name] = None
            elif member.issym():
                check(node, 'npm archive symlink unsupported')
                target = structural_link_destination(name, member.linkname)
                check(target.startswith(prefix + '/'), 'archive link escape')
                links[name] = target
            else:
                check(member.isfile() and 0 <= member.size <= MAX_FILE, 'unsupported or oversized archive member')
                total += member.size
                check(total <= MAX_EXPANDED, 'archive content bound')
                handle = archive.extractfile(member)  # Reads a member; never extracts to disk.
                hasher, first, content, size = hashlib.sha256(), b'', bytearray(), 0
                capture = name == prefix + '/package.json'
                while True:
                    chunk = handle.read(65536)
                    if not chunk:
                        break
                    size += len(chunk); hasher.update(chunk)
                    if len(first) < 64:
                        first += chunk[:64 - len(first)]
                    if capture:
                        check(size <= 65536, 'package metadata bound'); content.extend(chunk)
                check(size == member.size, 'truncated archive member')
                entries[name] = {'sha256': hasher.hexdigest(), 'size': size, 'first': first, 'metadata': bytes(content)}
    for name, target in links.items():
        seen = {name}
        while target in links:
            check(target not in seen, 'archive symlink cycle'); seen.add(target); target = links[target]
        check(target in entries, 'dangling archive symlink')
    for name in entries:
        check(not any(parent in links for parent in ancestors(name)), 'archive symlink ancestor')
    return entries, hashlib.sha256(data).hexdigest()


def ancestors(name):
    parts = name.split('/')
    return {'/'.join(parts[:i]) for i in range(1, len(parts))}


def load_spec():
    return parse_json(read_regular(SPEC, MAX_JSON)[0])


def expected_files(spec, archives):
    expected, archive_hashes = {}, {}
    def add(path, record, role):
        path_name(path); check(path not in expected, 'closure collision')
        expected[path] = {**record, 'role': role}
    for source in spec['sources']:
        add(source['path'], {'sha256': source['sha256']}, 'source')
    node = spec['node']
    files, archive_hashes[node['archive']] = archive_entries(archives / node['archive'], bytes.fromhex(node['sha256']), 'sha256', 'node-v22.16.0-linux-x64', True)
    for selection in node['members']:
        path_name(selection['member'])
        record = files.get(selection['member'])
        check(record is not None, 'required Node member absent')
        role = 'node' if selection['path'] == BASE + '/bin/node' else 'notice'
        if role == 'node':
            elf(record['first'], node=True)
        add(selection['path'], record, role)
    for package in spec['packages']:
        integrity = package['integrity']
        check(integrity.startswith('sha512-'), 'SRI algorithm')
        files, archive_hashes[package['archive']] = archive_entries(archives / package['archive'], base64.b64decode(integrity[7:], validate=True), 'sha512', 'package')
        metadata = files.get('package/package.json')
        check(metadata is not None, 'package metadata absent')
        value = parse_json(metadata['metadata'])
        check(value.get('name') == package['name'] and value.get('version') == package['version'], 'package identity mismatch')
        native_count = 0
        for name, record in files.items():
            if record is None:
                continue
            native = record['first'].startswith(b'\x7fELF')
            check(not native or package['name'].startswith('@img/sharp-'), 'unexpected npm ELF')
            if native:
                elf(record['first']); native_count += 1
            add(BASE + '/node_modules/' + package['name'] + '/' + name[len('package/'):], record, 'npm-native' if native else 'npm')
        check(not package['name'].startswith('@img/sharp-') or native_count > 0, 'native package has no ELF')
    names = {node['archive']} | {package['archive'] for package in spec['packages']}
    check({item.name for item in archives.iterdir()} == names, 'unexpected archive input')
    return expected, archive_hashes


def inventory_data(raw):
    value = parse_json(raw)
    exact(value, ['schema', 'platform', 'nativeObservationSha256', 'native', 'files', 'symlinks'])
    check(value['schema'] == 'atlas-proof-decoder-rootfs-inventory-v1' and value['platform'] == 'linux/amd64', 'inventory schema/platform')
    digest(value['nativeObservationSha256'])
    check(type(value['files']) is list and 0 < len(value['files']) <= MAX_FILES and type(value['symlinks']) is list and len(value['symlinks']) <= MAX_NATIVE and
          type(value['native']) is list and 0 < len(value['native']) <= MAX_NATIVE, 'inventory counts')
    files, links, native = {}, {}, {}
    for row in value['files']:
        exact(row, ['path', 'sha256', 'size', 'mode']); path_name(row['path']); digest(row['sha256'])
        check(type(row['size']) is int and 0 <= row['size'] <= MAX_FILE and type(row['mode']) is int and row['mode'] in (0o644, 0o755), 'file size/mode')
        check(row['path'] not in files, 'duplicate file'); files[row['path']] = row
    check(sum(row['size'] for row in files.values()) <= MAX_TOTAL, 'total byte bound')
    for row in value['native']:
        exact(row, ['path', 'package', 'version', 'archiveSha256']); path_name(row['path']); digest(row['archiveSha256'])
        check(NATIVE.fullmatch(row['path']) and row['path'] in files and row['path'] not in native, 'native path')
        check(all(type(row[key]) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9.+:~_-]{0,127}', row[key]) for key in ('package', 'version')), 'native source record')
        native[row['path']] = row
    for row in value['symlinks']:
        exact(row, ['path', 'target']); path_name(row['path'])
        check(NATIVE.fullmatch(row['path']) and row['path'] not in files and row['path'] not in links, 'symlink path')
        check(link_destination(row['path'], row['target']) in native, 'link must reach a declared regular native ELF')
        links[row['path']] = row['target']
    check(list(files) == sorted(files) and list(native) == sorted(native) and list(links) == sorted(links), 'inventory must be sorted')
    return value, files, links, native


def scan(root, files, links):
    directories = set(EMPTY_DIRS)
    for name in list(files) + list(links):
        directories.update(ancestors(name))
    check(not (set(files) | set(links)) & directories, 'file/parent collision')
    observed_files, observed_links, count = set(), set(), 0
    def walk(fd, prefix=''):
        nonlocal count
        with os.scandir(fd) as entries:
            for item in entries:
                count += 1; check(count <= MAX_FILES * 4, 'rootfs entry count')
                name = path_name(prefix + item.name)
                info = item.stat(follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    check(name in directories and stat.S_IMODE(info.st_mode) == 0o755, 'unexpected directory/mode')
                    child = os.open(item.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                    try:
                        walk(child, name + '/')
                    finally:
                        os.close(child)
                elif stat.S_ISLNK(info.st_mode):
                    check(name in links and os.readlink(item.name, dir_fd=fd) == links[name], 'unexpected symlink')
                    observed_links.add(name)
                else:
                    check(name in files and stat.S_ISREG(info.st_mode), 'unexpected/special file')
                    check(info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == files[name]['mode'], 'hardlink or mode mismatch')
                    observed_files.add(name)
    fd = directory_fd(root)
    try:
        walk(fd)
    finally:
        os.close(fd)
    check(observed_files == set(files) and observed_links == set(links), 'missing inventory paths')
    return directories


def assemble(rootfs, inventory, archives, output):
    spec = load_spec()
    root, archive_root = real_directory(rootfs), real_directory(archives)
    inventory_path = Path(os.path.abspath(inventory))
    check(inventory_path.parent == real_directory(inventory_path.parent), 'inventory parent')
    raw, _ = read_regular(inventory_path, MAX_JSON)
    value, files, links, native = inventory_data(raw)
    expected, archive_hashes = expected_files(spec, archive_root)
    for name in native:
        check(name not in expected, 'native substitution'); expected[name] = {'role': 'native'}
    check(set(expected) == set(files), 'unexpected/missing closure files')
    for name, row in files.items():
        record = expected[name]
        mode = 0o755 if record['role'] in ('node', 'native') else 0o644
        check(row['mode'] == mode and ('sha256' not in record or row['sha256'] == record['sha256']) and
              ('size' not in record or row['size'] == record['size']), 'closure pin/mode mismatch')
    directories = scan(root, files, links)
    # Rootfs must be quiescent. Rechecking contents on the same bytes passed to
    # tar prevents substitution between a prior inventory scan and archive write.
    destination = Path(os.path.abspath(output))
    parent = real_directory(destination.parent)
    check(destination.name not in ('', '.', '..') and destination.parent == parent and not destination.exists() and not destination.is_symlink(), 'new output required')
    check(not any(destination == base or base in destination.parents or destination in base.parents for base in (root, archive_root)), 'output/input overlap')
    with ExitStack() as handles:
        parent_fd = directory_fd(parent); handles.callback(os.close, parent_fd)
        os.mkdir(destination.name, 0o700, dir_fd=parent_fd)
        out_fd = os.open(destination.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent_fd); handles.callback(os.close, out_fd)
        os.mkdir('blobs', dir_fd=out_fd)
        blobs_parent_fd = os.open('blobs', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=out_fd); handles.callback(os.close, blobs_parent_fd)
        os.mkdir('sha256', dir_fd=blobs_parent_fd)
        blobs_fd = os.open('sha256', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=blobs_parent_fd); handles.callback(os.close, blobs_fd)
        def new_file(fd, name):
            return os.fdopen(os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o644, dir_fd=fd), 'wb')
        with new_file(out_fd, 'layer.pending') as handle, tarfile.open(fileobj=handle, mode='w', format=tarfile.PAX_FORMAT) as layer:
            for name in sorted(directories | set(files) | set(links)):
                header = tarfile.TarInfo(name); header.uid = header.gid = header.mtime = 0
                header.uname = header.gname = ''
                if name in directories:
                    header.type = tarfile.DIRTYPE; header.mode = 0o755; layer.addfile(header)
                elif name in links:
                    header.type = tarfile.SYMTYPE; header.mode = 0o777; header.linkname = links[name]; layer.addfile(header)
                else:
                    data, mode = read_regular(root / name, MAX_FILE)
                    row, role = files[name], expected[name]['role']
                    check(len(data) == row['size'] and sha(data) == row['sha256'] and mode == row['mode'], 'rootfs content changed')
                    if role in ('node', 'native', 'npm-native'):
                        elf(data, node=role == 'node')
                    else:
                        check(not data.startswith(b'\x7fELF'), 'ELF source substitution')
                    header.size = len(data); header.mode = mode; layer.addfile(header, io.BytesIO(data))
                check(handle.tell() <= MAX_LAYER, 'layer bound')
        check(os.stat('layer.pending', dir_fd=out_fd, follow_symlinks=False).st_size <= MAX_LAYER, 'layer bound')
        scan(root, files, links)
        def blob(data):
            digest_value = sha(data)
            with new_file(blobs_fd, digest_value) as handle:
                handle.write(data)
            return digest_value
        with os.fdopen(os.open('layer.pending', os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=out_fd), 'rb') as handle:
            hasher = hashlib.sha256()
            for chunk in iter(lambda: handle.read(65536), b''):
                hasher.update(chunk)
            layer_sha = hasher.hexdigest(); layer_size = os.fstat(handle.fileno()).st_size
        os.link('layer.pending', layer_sha, src_dir_fd=out_fd, dst_dir_fd=blobs_fd, follow_symlinks=False)
        os.unlink('layer.pending', dir_fd=out_fd)
        config = {'architecture': 'amd64', 'os': 'linux', 'config': {'Env': [], 'Volumes': {}},
                  'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + layer_sha]}}
        config_bytes = canonical(config); config_sha = blob(config_bytes)
        manifest = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                    'config': {'mediaType': 'application/vnd.oci.image.config.v1+json', 'digest': 'sha256:' + config_sha, 'size': len(config_bytes)},
                    'layers': [{'mediaType': 'application/vnd.oci.image.layer.v1.tar', 'digest': 'sha256:' + layer_sha, 'size': layer_size}]}
        manifest_bytes = canonical(manifest); manifest_sha = blob(manifest_bytes)
        index = {'schemaVersion': 2, 'manifests': [{'mediaType': manifest['mediaType'], 'digest': 'sha256:' + manifest_sha, 'size': len(manifest_bytes), 'platform': {'architecture': 'amd64', 'os': 'linux'}}]}
        receipt = {'schema': 'atlas-proof-decoder-oci-assembly-v1', 'classification': 'UNQUALIFIED_ASSEMBLY', 'executionAllowed': False,
                   'qualification': 'NOT_PERFORMED', 'nativeEvidence': 'CALLER_SUPPLIED_NOT_AUTHENTICATED', 'specSha256': sha(canonical(spec)),
                   'inventorySha256': sha(raw), 'archives': archive_hashes, 'manifestDigest': 'sha256:' + manifest_sha,
                   'configDigest': 'sha256:' + config_sha, 'layerDigest': 'sha256:' + layer_sha, 'inventory': value,
                   'engineRepoDigest': None, 'runtimeVersionsObserved': False, 'nativeClosureComplete': False}
        for name, content in [('oci-layout', {'imageLayoutVersion': '1.0.0'}), ('index.json', index), ('assembly-receipt.json', receipt)]:
            with new_file(out_fd, name) as handle:
                handle.write(canonical(content))
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('rootfs', 'inventory', 'archives', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    receipt = assemble(args.rootfs, args.inventory, args.archives, args.output)
    print(json.dumps({key: receipt[key] for key in ('classification', 'manifestDigest', 'engineRepoDigest')}))


if __name__ == '__main__':
    main()
