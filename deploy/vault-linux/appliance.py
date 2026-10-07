#!/usr/bin/python3
"""Vault Linux deployment tooling. No OS installer, disk writer or serial command.

All mutating subcommands require --apply; signed app activation additionally
requires the running authority's maintenance barrier. No schema downgrade or
database restore is automatic. Python/OpenSSL belong to the trusted target OS.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import platform
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

BASE = Path('/opt/tenkings-vault')
ETC = Path('/etc/tenkings-vault')
STATE = Path('/var/lib/tenkings-vault')
UNIT = 'tenkings-vault.service'
ORIGIN = 'http://127.0.0.1:47831'
HERE = Path(__file__).resolve().parent
PIN = json.loads((HERE / 'runtime.json').read_text())
META = {'release.json', 'release.sig'}

@contextlib.contextmanager
def operation_guard(file=Path('/run/tenkings-vault-deploy.lock')):
    # Keep the inode after unlock: unlinking permits a concurrent split lock.
    fd = os.open(file, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1 and not info.st_mode & 0o077, 'Unsafe deployment lock')
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('Another Vault deployment operation is running')
        yield
    finally: os.close(fd)

def need(condition, message):
    if not condition:
        raise ValueError(message)

def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True, timeout=120, **kwargs).stdout.strip()

def sha(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def regular(file):
    value = Path(file).lstat()
    need(stat.S_ISREG(value.st_mode) and not stat.S_ISLNK(value.st_mode), 'Regular files required')
    return value

def safe_path(value):
    need(isinstance(value, str) and 0 < len(value) <= 300 and not value.startswith('/'), 'Invalid release path')
    need(all(re.fullmatch(r'[A-Za-z0-9_@.+-]+', p) and p not in ('.', '..') for p in value.split('/')), 'Unsafe release path')
    return value

@contextlib.contextmanager
def tree_handle(directory):
    # Resolve components using directory FDs, so no swapped ancestor can redirect
    # a privileged read after validation. Never follow source links.
    absolute = Path(os.path.abspath(directory))
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in absolute.parts[1:]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = next_fd
        yield fd
    finally: os.close(fd)

def read_member(root_fd, member, limit):
    parts = safe_path(member).split('/')
    fd = os.dup(root_fd)
    try:
        for part in parts[:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = next_fd
        file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            info = os.fstat(file_fd)
            need(stat.S_ISREG(info.st_mode) and info.st_size <= limit, 'Unsafe or oversized release member')
            with os.fdopen(file_fd, 'rb', closefd=False) as stream: data = stream.read(limit + 1)
            need(len(data) <= limit, 'Release member grew while reading')
            return data
        finally: os.close(file_fd)
    finally: os.close(fd)

def payload_files(directory):
    directory = Path(directory)
    need(directory.is_dir() and not directory.is_symlink(), 'Release must be a real directory')
    files = {}
    with tree_handle(directory) as root_fd:
        for entry in directory.rglob('*'):
            need(not entry.is_symlink(), 'Release symlinks are forbidden; dereference build dependencies before signing')
            rel = entry.relative_to(directory).as_posix()
            safe_path(rel)
            if entry.is_dir():
                continue
            info = regular(entry)
            need(info.st_size <= 512 * 1024 * 1024, 'Release member too large')
            if rel not in META:
                data = read_member(root_fd, rel, info.st_size)
                need(len(data) == info.st_size, 'Release member changed while hashing')
                files[rel] = {'path': rel, 'size': info.st_size, 'mode': 0o755 if info.st_mode & 0o111 else 0o644, 'sha256': hashlib.sha256(data).hexdigest()}
                need(len(files) <= 20000, 'Release member count invalid')
    need(1 <= len(files) <= 20000, 'Release member count invalid')
    return dict(sorted(files.items()))

def verify(directory, public_key):
    directory, public_key = Path(directory), Path(public_key)
    regular(public_key)
    with tree_handle(directory) as fd:
        manifest_bytes = read_member(fd, 'release.json', 4 * 1024 * 1024)
        signature_bytes = read_member(fd, 'release.sig', 64)
    need(len(signature_bytes) == 64, 'Ed25519 signature required')
    # Verify the exact snapshot that is parsed, not a mutable source pathname.
    with tempfile.TemporaryDirectory(prefix='vault-signature-') as temp:
        signed = Path(temp) / 'release.json'; signature = Path(temp) / 'release.sig'
        signed.write_bytes(manifest_bytes); signature.write_bytes(signature_bytes)
        run(['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', public_key, '-rawin', '-in', signed, '-sigfile', signature])
    manifest = json.loads(manifest_bytes)
    need(manifest.get('schemaVersion') == 1 and manifest.get('platform') == 'linux-x64', 'Unsupported release platform')
    need(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', manifest.get('releaseId', '')), 'Invalid release ID')
    need(re.fullmatch(r'[a-f0-9]{40}', manifest.get('sourceCommit', '')), 'Exact source commit required')
    need(re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', manifest.get('appVersion', '')), 'Invalid app version')
    need(type(manifest.get('localSchemaVersion')) is int and manifest['localSchemaVersion'] >= 1, 'Schema version required')
    need(manifest.get('nodeVersion') == PIN['nodeVersion'], 'Pinned Node version differs')
    actual = payload_files(directory)
    expected = manifest.get('files')
    need(isinstance(expected, list) and len(expected) == len(actual), 'Incomplete release manifest')
    seen = set()
    for entry in expected:
        member = safe_path(entry.get('path'))
        need(member not in seen and actual.get(member) == entry, 'Release digest, mode or size mismatch')
        seen.add(member)
    for member in ['runtime/bin/node', 'packages/vault-machine/dist/cli.js', 'packages/vault-machine/package.json', 'packages/vault-contracts/dist/index.js', 'frontend/vault-kiosk/dist/index.html', 'deploy/vault-linux/launch.py', 'deploy/vault-linux/probe.cjs']:
        need(member in seen, 'Missing required runtime payload')
    need(json.loads((directory / 'deploy/vault-linux/runtime.json').read_text()) == PIN, 'Release runtime pin differs')
    return manifest

def completed_build(directory, source_commit):
    """A signing request must refer to a completed clean-commit build, not a label."""
    root = Path(directory)
    need((root / 'source-build.json').is_file(), 'Completed clean release build evidence required')
    with tree_handle(root) as fd:
        provenance = json.loads(read_member(fd, 'source-build.json', 65536))
        need(isinstance(provenance, dict), 'Invalid release build evidence')
        need(provenance.get('sourceState') != 'UNCOMMITTED_CANDIDATE' and provenance.get('releaseAuthorized') is not False,
             'An unsigned source rehearsal is not a clean reviewed release; rebuild from the committed source')
        need(provenance.get('sourceState') == 'CLEAN_COMMITTED' and provenance.get('buildCompleted') is True
             and provenance.get('releaseAuthorized') is True, 'Completed clean release build evidence required')
        need(provenance.get('sourceCommit') == source_commit and re.fullmatch(r'[a-f0-9]{40}', source_commit or ''),
             'Signing source commit differs from the completed build')
        need(provenance.get('nativeBuild') == 'linux-x64' and provenance.get('pnpmVersion') == PIN['pnpmVersion']
             and provenance.get('nodeArchiveSha256') == PIN['nodeArchiveSha256']
             and re.fullmatch(r'[a-f0-9]{64}', provenance.get('lockfileSha256', '')), 'Pinned build identity required')
        probe = json.loads(read_member(fd, 'native-runtime-evidence.json', 65536))
        need(probe == provenance.get('nativeProbe') and isinstance(probe, dict), 'Native probe evidence differs')
        need(probe.get('nodeVersion') == PIN['nodeVersion'] and probe.get('platform') == 'linux'
             and probe.get('architecture') == 'x64' and probe.get('betterSqlite3Version') == PIN['betterSqlite3Version']
             and all(probe.get(field) is True for field in ['wal', 'transactionRollback', 'integrity']),
             'Successful pinned native probe required')
    return provenance

def make_manifest(args):
    root = Path(args.release)
    completed_build(root, args.source_commit)
    need(not (root / 'release.json').exists() and not (root / 'release.sig').exists(), 'Signing is create-only')
    need(re.fullmatch(r'[a-f0-9]{40}', args.source_commit or ''), 'Exact source commit required')
    need(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', args.release_id or ''), 'Invalid release ID')
    need(re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', args.app_version or ''), 'Invalid app version')
    need(type(args.schema_version) is int and args.schema_version >= 1, 'Schema version required')
    key_info = regular(args.signing_key)
    need(key_info.st_uid == os.geteuid() and not key_info.st_mode & 0o077, 'Signing key must be owner-only')
    manifest = {'schemaVersion': 1, 'platform': 'linux-x64', 'nodeVersion': PIN['nodeVersion'], 'releaseId': args.release_id,
                'appVersion': args.app_version, 'sourceCommit': args.source_commit, 'localSchemaVersion': args.schema_version,
                'files': list(payload_files(root).values())}
    with (root / 'release.json').open('x') as file:
        file.write(json.dumps(manifest, sort_keys=True, separators=(',', ':')) + '\n')
        file.flush(); os.fsync(file.fileno())
    run(['openssl', 'pkeyutl', '-sign', '-inkey', args.signing_key, '-rawin', '-in', root / 'release.json', '-out', root / 'release.sig'])
    return {'signed': True, 'manifestSha256': sha(root / 'release.json')}

def host_report():
    os_release = {}
    if Path('/etc/os-release').exists():
        for line in Path('/etc/os-release').read_text().splitlines():
            if '=' in line:
                key, val = line.split('=', 1); os_release[key] = val.strip('"')
    return {'platform': platform.system(), 'architecture': platform.machine(), 'distribution': os_release.get('ID'),
            'kernel': platform.release(), 'requiredTools': {p: bool(shutil.which(p)) for p in ['systemctl', 'udevadm', 'openssl', 'python3', 'chromium', 'hyprctl', 'flock']},
            'stateFilesystemFreeBytes': shutil.disk_usage(STATE if STATE.exists() else Path('/')).free,
            'serialByIdCount': len(list(Path('/dev/serial/by-id').glob('*'))), 'serialByPathCount': len(list(Path('/dev/serial/by-path').glob('*'))),
            'credentialsPresent': (ETC / 'machine.env.json').is_file(), 'installed': (BASE / 'current').is_symlink(),
            'diskInstallPerformed': False}

def require_host():
    host = host_report()
    need(host['platform'] == 'Linux' and host['architecture'] == 'x86_64', 'Linux x86_64 target required')
    need(host['distribution'] == 'arch', 'This candidate targets Omarchy on Arch; other distributions require qualification')
    need(all(host['requiredTools'][p] for p in ['systemctl', 'udevadm', 'openssl', 'python3', 'flock']), 'Required target tools missing')
    return host

def protected(file):
    info = regular(file)
    need(info.st_uid == 0 and not info.st_mode & 0o022, 'Root-owned non-writable trust/config required')
    return file

def protected_reference(file):
    file = Path(file)
    need(file.is_absolute(), 'Referenced configuration requires an absolute path')
    protected(file)
    for ancestor in file.parents:
        info = ancestor.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'Referenced configuration ancestors must be protected root directories')
    return file

def safe_install_parents():
    import pwd
    try: allowed_owners = {0, pwd.getpwnam('vault').pw_uid}
    except KeyError: allowed_owners = {0}
    for selected in [BASE, BASE / 'releases', ETC, STATE, Path('/var/log/tenkings-vault')]:
        for ancestor in [selected, *selected.parents]:
            if ancestor.exists() or ancestor.is_symlink():
                info = ancestor.lstat()
                need(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), 'Installation ancestors cannot be symlinks')
                need(info.st_uid == 0 or (ancestor in [STATE, Path('/var/log/tenkings-vault')] and info.st_uid in allowed_owners), 'Installation ancestors must belong to root or the dedicated state owner')
                need(not info.st_mode & 0o022, 'Installation ancestors cannot be group/world writable')

def stage(directory, key):
    manifest = verify(directory, key)
    target = BASE / 'releases' / manifest['releaseId']
    need(not target.exists() and not target.is_symlink(), 'Release ID already exists; staging is create-only')
    target.mkdir(parents=True, mode=0o700)
    (BASE / 'releases').chmod(0o755)
    target.chmod(0o700)  # retain failed stages privately, never publish partial bytes
    with tree_handle(directory) as fd:
        for member in manifest['files']:
            data = read_member(fd, member['path'], member['size'])
            need(len(data) == member['size'] and hashlib.sha256(data).hexdigest() == member['sha256'], 'Release changed during copy')
            dest = target / member['path']; dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open('xb') as stream: stream.write(data)
            dest.chmod(member['mode'])
        # Reverification below binds these copied metadata snapshots to payload.
        for name, limit in [('release.json', 4 * 1024 * 1024), ('release.sig', 64)]:
            with (target / name).open('xb') as stream: stream.write(read_member(fd, name, limit))
            (target / name).chmod(0o644)
    need(verify(target, key) == manifest, 'Release metadata changed during copy')
    run([target / 'runtime/bin/node', target / 'deploy/vault-linux/probe.cjs', target])
    for folder in target.rglob('*'):
        if folder.is_dir(): folder.chmod(0o755)
    target.chmod(0o755)
    return target, manifest

def switch_pointer(target):
    need(target.parent == BASE / 'releases' and target.is_dir(), 'Invalid staged target')
    temporary = BASE / ('.current-' + str(os.getpid()))
    need(not temporary.exists() and not temporary.is_symlink(), 'Pointer staging collision')
    temporary.symlink_to(target); temporary.replace(BASE / 'current')
    handle = os.open(BASE, os.O_RDONLY)
    try: os.fsync(handle)
    finally: os.close(handle)

def private_json(file):
    info = regular(protected_reference(file))
    need(not info.st_mode & 0o077, 'Secrets must be root-only mode 0600')
    value = json.loads(Path(file).read_text())
    need(isinstance(value, dict) and all(isinstance(k, str) and k.startswith('VAULT_') and isinstance(v, str) and '\x00' not in v for k, v in value.items()), 'Invalid protected configuration')
    for field in ['VAULT_MACHINE_ID', 'VAULT_CLOUD_ORIGIN', 'VAULT_MACHINE_CREDENTIAL', 'VAULT_ADAPTER_CALLBACK_TOKEN', 'VAULT_MAINTENANCE_TOKEN', 'VAULT_CONFIG_KEY_ID', 'VAULT_CONFIG_PUBLIC_KEY_PATH', 'VAULT_PAYMENT_ADAPTER', 'VAULT_CONTROLLER_ADAPTER']:
        need(bool(value.get(field)) and not value[field].startswith('REPLACE_'), 'Required machine configuration missing')
    need(len(value['VAULT_MAINTENANCE_TOKEN']) >= 32, 'Maintenance token must contain at least 32 characters')
    need(value['VAULT_MAINTENANCE_TOKEN'] != value['VAULT_ADAPTER_CALLBACK_TOKEN'], 'Maintenance and callback tokens must differ')
    protected_reference(value['VAULT_CONFIG_PUBLIC_KEY_PATH'])
    if value['VAULT_CONTROLLER_ADAPTER'] == 'WAVESHARE':
        protected_reference(value.get('VAULT_WAVESHARE_CONFIG_PATH', ''))
    if value['VAULT_PAYMENT_ADAPTER'] in ['NAYAX_SPARK_TEST', 'NAYAX_SPARK_PRODUCTION']:
        protected_reference(value.get('VAULT_SPARK_CONFIG_PATH', ''))
    if value['VAULT_PAYMENT_ADAPTER'] == 'NAYAX_SPARK_PRODUCTION':
        for field in ['VAULT_SPARK_PROVISIONING_PATH', 'VAULT_SPARK_ACTIVATION_PATH']:
            protected_reference(value.get(field, ''))
        for name in ['release-public.pem', 'spark-activation-public.pem']:
            protected_reference(ETC / name)
        evidence = Path(value.get('VAULT_SPARK_EVIDENCE_PATH', ''))
        for kind in ['NAYAX_CERTIFICATION', 'TERMINAL_SANDBOX', 'CABINET_ACCEPTANCE', 'LINUX_RELEASE', 'PRODUCTION_ACCOUNT']:
            for suffix in ['evidence', 'artifact']:
                protected_reference(evidence / (kind + '.' + suffix))
        for field in ['VAULT_SPARK_PRODUCTION_TOKEN_SECRET', 'VAULT_SPARK_PRODUCTION_SIGN_KEY']:
            need(bool(value.get(field)) and not value[field].startswith('REPLACE_'), 'Production Spark credentials missing')
    return value

def api(route, body=None, token=None, cookie=None):
    headers = {'X-Vault-Contract-Version': '1', 'Origin': ORIGIN}
    if token: headers['X-Vault-Maintenance-Token'] = token
    if cookie: headers['Cookie'] = cookie
    if body is not None: headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(ORIGIN + route, data=None if body is None else json.dumps(body).encode(), headers=headers)
    # A loopback request never uses a proxy or follows an unexpected redirect.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=30) as response:
        raw = response.read(1024 * 1024 + 1)
        need(len(raw) <= 1024 * 1024, 'Response too large')
        return json.loads(raw), response.headers

def maintenance(action):
    config = private_json(ETC / 'machine.env.json')
    value, _ = api('/api/v1/internal/maintenance', {'action': action}, config['VAULT_MAINTENANCE_TOKEN'])
    status = value.get('data')
    need(isinstance(status, dict) and status.get('schemaVersion') == 1, 'Maintenance endpoint unavailable')
    return status

def allow_restart(status):
    need(status.get('maintenanceActive') is True and status.get('restartAllowed') is True and status.get('blockers') == [], 'Restart blocked by machine authority; resolve existing work through staff flow')

LEGACY_DATABASES = {'vault.sqlite', 'vault.sqlite.mock-provider.sqlite', 'vault.sqlite.controller.sqlite', 'vault.sqlite.spark-provider.sqlite'}
PRODUCTION_DATABASE = re.compile(r'vault\.sqlite\.(spark|controller)-production-([a-f0-9]{64})\.sqlite')

def journal_database_name(name):
    return isinstance(name, str) and (name in LEGACY_DATABASES or PRODUCTION_DATABASE.fullmatch(name) is not None)

def history_journals(db, tables):
    required = set()
    if 'sale_payment_binding' in tables:
        columns = {row[1] for row in db.execute('PRAGMA table_info(sale_payment_binding)')}
        if {'adapter_mode', 'binding_digest'} <= columns:
            for mode, binding in db.execute("SELECT DISTINCT adapter_mode,binding_digest FROM sale_payment_binding WHERE provider='NAYAX_SPARK'"):
                need(re.fullmatch(r'[a-f0-9]{64}', binding or ''), 'Historical payment binding invalid')
                required.add('vault.sqlite.spark-production-' + binding + '.sqlite' if mode == 'LIVE' else 'vault.sqlite.spark-provider.sqlite')
        elif db.execute("SELECT 1 FROM sale_payment_binding WHERE provider='NAYAX_SPARK' LIMIT 1").fetchone():
            required.add('vault.sqlite.spark-provider.sqlite')
    for table in ['sale_controller_binding', 'command_controller_binding']:
        if table in tables:
            for (binding,) in db.execute('SELECT DISTINCT binding_digest FROM ' + table):
                need(re.fullmatch(r'[a-f0-9]{64}', binding or ''), 'Historical controller binding invalid')
                required.add('vault.sqlite.controller-production-' + binding + '.sqlite')
    return required

def snapshot_databases():
    # The caller stopped the single writer. Every selected/history-bound provider
    # belongs to this one snapshot; a missing journal must never look like success.
    main = STATE / 'vault.sqlite'
    need(main.exists(), 'Machine database missing'); regular(main)
    required = {'vault.sqlite'}
    identity = {}
    with sqlite3.connect(main.as_uri() + '?mode=ro', uri=True) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'machine_meta' in tables:
            row = db.execute('SELECT machine_id,schema_version FROM machine_meta WHERE singleton=1').fetchone()
            need(row is not None, 'Machine identity missing')
            identity = {'machineId': row[0], 'localSchemaVersion': row[1]}
        required.update(history_journals(db, tables))
        if 'machine_event' in tables:
            identity['eventSequence'] = db.execute('SELECT COALESCE(MAX(sequence),0) FROM machine_event').fetchone()[0]
    config_path = ETC / 'machine.env.json'
    if config_path.exists():
        config = private_json(config_path)
        if config.get('VAULT_PAYMENT_ADAPTER') == 'NAYAX_SPARK_TEST': required.add('vault.sqlite.spark-provider.sqlite')
        if config.get('VAULT_PAYMENT_ADAPTER') == 'NAYAX_SPARK_PRODUCTION':
            activation = json.loads(Path(config['VAULT_SPARK_ACTIVATION_PATH']).read_text())
            for kind, field in [('spark', 'paymentBindingDigest'), ('controller', 'controllerBindingDigest')]:
                binding = activation.get('payload', {}).get(field)
                need(isinstance(binding, str) and re.fullmatch(r'[a-f0-9]{64}', binding), 'Production journal binding invalid')
                required.add('vault.sqlite.' + kind + '-production-' + binding + '.sqlite')
        if config.get('VAULT_PAYMENT_ADAPTER') == 'MOCK': required.add('vault.sqlite.mock-provider.sqlite')
        if config.get('VAULT_CONTROLLER_ADAPTER') == 'WAVESHARE' and config.get('VAULT_PAYMENT_ADAPTER') != 'NAYAX_SPARK_PRODUCTION': required.add('vault.sqlite.controller.sqlite')
    for file in required:
        need((STATE / file).exists(), 'Required coordinated journal missing: ' + file)
    sources = sorted(path for path in STATE.iterdir() if journal_database_name(path.name))
    need(1 <= len(sources) <= 128, 'Coordinated database count exceeds supported bound')
    snapshot_id = str(uuid.uuid4())
    folder = STATE / 'backups' / ('pre-update-' + time.strftime('%Y%m%dT%H%M%SZ') + '-' + snapshot_id)
    folder.mkdir(parents=True, mode=0o700)
    members = []
    for source in sources:
        regular(source)
        target = folder / source.name
        with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src, sqlite3.connect(target) as dst:
            need(src.execute('PRAGMA integrity_check').fetchone() == ('ok',), 'Source database integrity failed')
            src.backup(dst)
            need(dst.execute('PRAGMA integrity_check').fetchone() == ('ok',), 'Backup integrity failed')
        target.chmod(0o600)
        members.append({'file': source.name, 'sha256': sha(target)})
        anchor = Path(str(source) + '.anchor')
        if anchor.exists():
            regular(anchor)
            need(anchor.stat().st_size <= 256, 'Provider anchor is invalid')
            target_anchor = folder / anchor.name
            target_anchor.write_bytes(anchor.read_bytes()); target_anchor.chmod(0o600)
            members.append({'file': anchor.name, 'sha256': sha(target_anchor)})
            required.add(anchor.name)
    manifest = {'schemaVersion': 2, 'snapshotId': snapshot_id, 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'machine': identity, 'requiredFiles': sorted(required), 'files': members, 'automaticRestore': False}
    manifest_path = folder / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest) + '\n'); manifest_path.chmod(0o600)
    # Flush every member and the directory before reporting a recoverable snapshot.
    for path in folder.iterdir():
        with path.open('rb') as handle: os.fsync(handle.fileno())
    descriptor = os.open(folder, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)
    return folder

def install(args):
    require_host(); safe_install_parents()
    key = Path(args.public_key)
    manifest = verify(args.release, key)
    need(not (BASE / 'current').exists() and not (BASE / 'current').is_symlink() and not (STATE / 'vault.sqlite').exists(), 'Existing installation must use guarded update')
    need(not Path('/etc/systemd/system/' + UNIT).exists(), 'Existing service unit requires operator review')
    if not args.apply:
        return {'plan': 'create dedicated service account, copy signed release, register disabled unit', 'releaseId': manifest['releaseId'], 'startsService': False, 'installsOS': False}
    need(os.geteuid() == 0, 'Root required for install')
    protected_reference(key)
    for folder in [STATE, Path('/var/log/tenkings-vault')]:
        need(not folder.exists() or not any(folder.iterdir()), 'First install cannot repurpose existing state/log contents')
    config = private_json(Path(args.config))
    for group in ['vault', 'vault-serial']:
        try: run(['getent', 'group', group])
        except subprocess.CalledProcessError: run(['groupadd', '--system', group])
    # Refuse to repurpose an existing account with unknown privileges/home.
    import pwd
    try:
        account = pwd.getpwnam('vault')
        need(account.pw_dir == str(STATE) and account.pw_shell in ['/usr/bin/nologin', '/sbin/nologin'], 'Existing vault account is not the appliance account')
    except KeyError:
        run(['useradd', '--system', '--gid', 'vault', '--groups', 'vault-serial', '--home-dir', STATE, '--shell', '/usr/bin/nologin', 'vault'])
    bench = Path('/var/lib/ten-kings-vault-bench')
    if bench.exists() or bench.is_symlink():
        info = bench.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == pwd.getpwnam('vault').pw_uid and not info.st_mode & 0o077, 'Existing bench evidence has different ownership; preserve it and review migration explicitly')
    ETC.mkdir(mode=0o755, parents=True, exist_ok=True)
    BASE.mkdir(mode=0o755, parents=True, exist_ok=True)
    BASE.chmod(0o755)
    for source, name, mode in [(key, 'release-public.pem', 0o644), (Path(args.config), 'machine.env.json', 0o600)]:
        target = ETC / name
        need(not target.exists(), 'Existing protected configuration is never overwritten')
        with target.open('xb') as stream: stream.write(source.read_bytes())
        target.chmod(mode)
    target, _ = stage(args.release, ETC / 'release-public.pem')
    switch_pointer(target)
    unit = Path('/etc/systemd/system') / UNIT
    unit.write_bytes((target / 'deploy/vault-linux/templates' / UNIT).read_bytes()); unit.chmod(0o644)
    run(['systemctl', 'daemon-reload'])
    return {'installed': True, 'releaseId': manifest['releaseId'], 'serviceEnabled': False, 'serviceStarted': False, 'next': 'qualify config/serial/display, then explicitly enable and start'}

def operate(args):
    require_host(); safe_install_parents(); protected_reference(ETC / 'release-public.pem')
    target = None; candidate = None
    if args.command == 'update':
        candidate = verify(args.release, ETC / 'release-public.pem')
    before = maintenance('status')
    if candidate:
        need(candidate['localSchemaVersion'] == before.get('localSchemaVersion'), 'Automatic schema migration/downgrade is forbidden')
    if not args.apply:
        return {'plan': args.command, 'maintenance': before, 'releaseId': candidate['releaseId'] if candidate else None}
    need(os.geteuid() == 0, 'Root required')
    # Stage and probe before asking the running process to quiesce.
    if candidate: target, _ = stage(args.release, ETC / 'release-public.pem')
    allow_restart(maintenance('enter'))
    run(['systemctl', 'stop', UNIT])
    need(run(['systemctl', 'show', UNIT, '--property=ActiveState', '--value']) == 'inactive', 'Service did not stop cleanly')
    backup = snapshot_databases()
    if target: switch_pointer(target)
    run(['systemctl', 'start', UNIT])
    return {'action': args.command, 'started': True, 'backup': str(backup), 'serviceLockRetained': True, 'acceptance': 'Run diagnostics and explicit staff safe exit; no automatic database restore'}

def diagnostics():
    report = host_report()
    try:
        _, headers = api('/api/v1/session/bootstrap', {})
        cookie = headers['Set-Cookie'].split(';', 1)[0]
        response, _ = api('/api/v1/health', cookie=cookie)
        health = response.get('data', {})
        # Allowlist rather than recursively copying provider identities or logs.
        identity = health.get('buildIdentity') or {}
        report['service'] = {'reachable': True, 'buildIdentity': {key: val for key, val in identity.items() if key in ['sourceCommit', 'appVersion'] and isinstance(val, str) and re.fullmatch(r'[A-Za-z0-9.-]{1,80}', val)}, 'localSchemaVersion': health.get('localSchemaVersion'),
                             'configVersion': health.get('configVersion'), 'outboxPendingCount': health.get('outboxPendingCount'),
                             'integrityOk': health.get('integrity', {}).get('ok') is True,
                             'serviceLocked': health.get('serviceLock', {}).get('service_locked') == 1}
    except Exception:
        report['service'] = {'reachable': False}
    report['excluded'] = ['configuration contents', 'credentials', 'provider identities', 'serial/SIM identifiers', 'database bytes', 'journal text', 'sale records']
    return report

def serial_rule(properties, role):
    need(role in ['locks'], 'Serial role invalid')
    for field in ['ID_VENDOR_ID', 'ID_MODEL_ID', 'ID_SERIAL_SHORT']:
        need(re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', properties.get(field, '')), 'Unique USB serial identity missing; use a reviewed by-path binding instead')
    return ('SUBSYSTEM=="tty", ENV{ID_VENDOR_ID}=="' + properties['ID_VENDOR_ID'] + '", ENV{ID_MODEL_ID}=="' + properties['ID_MODEL_ID'] + '", ENV{ID_SERIAL_SHORT}=="' + properties['ID_SERIAL_SHORT'] + '", GROUP="vault-serial", MODE="0660", SYMLINK+="vault-' + role + '"\n')

def bind_serial(args):
    require_host()
    device = Path(args.device)
    need(str(device).startswith('/dev/serial/by-id/') and device.is_symlink() and device.resolve().is_char_device(), 'Choose an observed /dev/serial/by-id device')
    properties = dict(line.split('=', 1) for line in run(['udevadm', 'info', '--query=property', '--name', device]).splitlines() if '=' in line)
    rule = serial_rule(properties, args.role)
    if not args.apply:
        return {'plan': 'bind exact observed USB serial', 'alias': '/dev/vault-' + args.role, 'identityPresent': True, 'deviceOpened': False}
    need(os.geteuid() == 0, 'Root required')
    destination = Path('/etc/udev/rules.d/99-tenkings-vault-' + args.role + '.rules')
    with destination.open('x') as stream: stream.write(rule)
    destination.chmod(0o644)
    run(['udevadm', 'control', '--reload-rules'])
    return {'installed': True, 'alias': '/dev/vault-' + args.role, 'next': 'Reconnect this adapter, verify alias and permissions; no serial command was sent'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['doctor', 'diagnostics', 'verify', 'manifest', 'install', 'restart', 'update', 'bind-serial', 'verify-snapshot', 'stage-restore', 'stage-upgrade'])
    parser.add_argument('--release'); parser.add_argument('--public-key'); parser.add_argument('--config')
    parser.add_argument('--signing-key'); parser.add_argument('--release-id'); parser.add_argument('--source-commit'); parser.add_argument('--app-version')
    parser.add_argument('--schema-version', type=int); parser.add_argument('--device'); parser.add_argument('--role', choices=['locks'])
    parser.add_argument('--snapshot'); parser.add_argument('--destination'); parser.add_argument('--manifest-sha256'); parser.add_argument('--machine-id')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == 'doctor': result = host_report()
    elif args.command == 'diagnostics': result = diagnostics()
    elif args.command == 'verify':
        manifest = verify(args.release, args.public_key); result = {k: manifest[k] for k in ['releaseId', 'sourceCommit', 'nodeVersion', 'localSchemaVersion']}
    elif args.command == 'manifest': result = make_manifest(args)
    elif args.command in ['verify-snapshot', 'stage-restore', 'stage-upgrade']:
        import importlib.util
        spec = importlib.util.spec_from_file_location('vault_snapshot_tools', HERE / 'snapshot-tools.py')
        snapshots = importlib.util.module_from_spec(spec); spec.loader.exec_module(snapshots)
        need(args.snapshot, 'Snapshot path required')
        if args.command == 'verify-snapshot' or not args.apply:
            result = snapshots.verify_snapshot(args.snapshot, args.manifest_sha256)
            if args.command != 'verify-snapshot': result['plan'] = args.command; result['writesInstalledState'] = False
        else:
            need(args.destination and args.manifest_sha256 and args.machine_id, 'Reviewed digest, exact machine ID and new destination required')
            need(args.command != 'stage-upgrade' or args.release and args.public_key, 'Signed release and trusted public key required')
            result = snapshots.stage_snapshot(args.snapshot, args.destination, args.manifest_sha256, args.machine_id,
                (args.release, args.public_key) if args.command == 'stage-upgrade' else None)
    else:
        def dispatch():
            if args.command == 'install': return install(args)
            if args.command == 'bind-serial': return bind_serial(args)
            return operate(args)
        if args.apply:
            need(os.geteuid() == 0, 'Root required for installed-host changes')
            require_host()
            with operation_guard(): result = dispatch()
        else: result = dispatch()
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        # Subprocess output and URL errors can carry secrets; do not print them.
        print(str(error) if isinstance(error, ValueError) else 'Vault operation failed; preserve installation and inspect locally', file=sys.stderr)
        sys.exit(1)
