#!/usr/bin/python3
"""SYNTHETIC_ONLY installed-service rehearsal on an explicitly disposable Arch VM.

Run from a protected copy of deploy/vault-linux, outside the signed release.
Never reboots, restores installed state, contacts a provider, or opens serial.
Failure preserves all evidence and partially installed state for inspection.
"""
import sys
sys.dont_write_bytecode = True
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import sqlite3
import stat
import subprocess
import time
import uuid

ROOT = Path('/var/lib/vault-lifecycle-rehearsal')
BASE = Path('/opt/tenkings-vault')
ETC = Path('/etc/tenkings-vault')
STATE = Path('/var/lib/tenkings-vault')
UNIT = 'tenkings-vault.service'
UNIT_FILE = Path('/etc/systemd/system') / UNIT
DATABASES = ('vault.sqlite', 'vault.sqlite.mock-provider.sqlite')
ACK = 'SYNTHETIC_ONLY_DISPOSABLE_VM'
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def need(condition, message):
    if not condition: raise ValueError(message)


def protected(path, *, directory=False):
    path = Path(path)
    need(path.is_absolute() and '..' not in path.parts, 'Absolute protected paths required')
    for current in (path, *path.parents):
        info = current.lstat()
        folder = directory if current == path else True
        need((stat.S_ISDIR if folder else stat.S_ISREG)(info.st_mode)
             and info.st_uid == 0 and not info.st_mode & 0o022,
             'Root-owned, non-writable, non-symlink inputs and ancestors required')
    return path


def command(argv, *, check=True):
    result = subprocess.run([str(arg) for arg in argv], check=False, capture_output=True,
                            text=True, timeout=240, env=ENV, cwd='/')
    if check and result.returncode:
        # Never copy subprocess output into a public error or journal.
        raise ValueError('Rehearsal command failed: ' + str(argv[0]) + '; inspect this disposable VM')
    return result


def write_new(path, value):
    data = (json.dumps(value, indent=2, sort_keys=True) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())


def evidence(name, value):
    write_new(ROOT / 'evidence' / (name + '.json'), {'classification': 'SYNTHETIC_ONLY', **value})


def load_validator():
    source = protected(Path(__file__).resolve().parents[1] / 'appliance.py')
    protected(source.parent / 'runtime.json')
    spec = importlib.util.spec_from_file_location('rehearsal_validator', source)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def host_guard(args, validator):
    need(args.acknowledge == ACK and os.geteuid() == 0, 'Explicit disposable-VM acknowledgement and root required')
    validator.require_host()  # Keep the actual Linux/x86_64/Arch/tool checks.
    host_id = Path('/etc/machine-id').read_text().strip()
    need(len(host_id) == 32 and host_id != '0' * 32 and args.disposable_machine_id == host_id,
         'Acknowledge this exact disposable VM machine-id')
    need(Path('/proc/1/comm').read_text().strip() == 'systemd'
         and Path('/run/systemd/system').is_dir(), 'Real systemd must be PID1')
    container = command(['systemd-detect-virt', '--container'], check=False)
    need(container.returncode == 1 and container.stdout.strip() in ('', 'none'),
         'Containers are refused even when an underlying virtual machine is detected')
    virtualization = command(['systemd-detect-virt', '--vm'], check=False)
    need(virtualization.returncode == 0 and virtualization.stdout.strip() not in ('', 'none'),
         'A disposable virtual machine is required; a container or physical cabinet is insufficient')
    need(command(['systemctl', 'show', '--property=Version', '--value']).stdout.strip(), 'The system manager must respond')
    return host_id


def fresh_guard():
    for path in [ROOT, BASE, ETC, STATE, Path('/var/log/tenkings-vault'),
                 Path('/var/lib/ten-kings-vault-bench'), UNIT_FILE,
                 Path('/etc/systemd/system') / (UNIT + '.d')]:
        need(not path.exists() and not path.is_symlink(), 'Fresh VM required; existing Vault paths are preserved')
        protected(path.parent, directory=True)
    try: pwd.getpwnam('vault')
    except KeyError: pass
    else: raise ValueError('Existing vault account is not a fresh rehearsal VM')
    need(not command(['systemctl', 'show', UNIT, '--property=FragmentPath', '--value'], check=False).stdout.strip(),
         'Existing Vault unit is not a fresh rehearsal VM')


def equivalent_update(original, update):
    need(original['releaseId'] != update['releaseId'], 'Update must have a distinct signed release ID')
    need({k: v for k, v in original.items() if k != 'releaseId'} ==
         {k: v for k, v in update.items() if k != 'releaseId'},
         'This rehearsal requires identical payload/source/schema with separately signed release ID')


def safe_config(config, machine_id):
    need(config.get('VAULT_PAYMENT_ADAPTER') == 'MOCK'
         and config.get('VAULT_CONTROLLER_ADAPTER') == 'SIMULATOR'
         and config.get('VAULT_MACHINE_ID') == machine_id
         and config.get('VAULT_CLOUD_ORIGIN') == 'https://127.0.0.1:47839'
         and not any(key.startswith(('VAULT_SPARK_', 'VAULT_WAVESHARE_', 'VAULT_STRIPE_')) for key in config),
         'Rehearsal configuration changed; refuse effects')


def appliance(release, operation, *args):
    return json.loads(command(['/usr/bin/python3', '-B', release / 'deploy/vault-linux/appliance.py', operation, *args]).stdout)


def current_release(expected_id, validator):
    pointer = BASE / 'current'
    need(pointer.is_symlink() and pointer.resolve() == BASE / 'releases' / expected_id, 'Installed release pointer differs')
    release = protected(pointer.resolve(), directory=True)
    manifest = validator.verify(release, protected(ETC / 'release-public.pem'))
    need(manifest['releaseId'] == expected_id, 'Installed release identity differs')
    need(protected(UNIT_FILE).read_bytes() == (release / 'deploy/vault-linux/templates' / UNIT).read_bytes(), 'Installed unit differs from signed unit')
    need(not command(['systemctl', 'show', UNIT, '--property=DropInPaths', '--value']).stdout.strip(), 'Unit overrides invalidate this exact-unit rehearsal')
    return release, manifest


def wait_ready(release, manifest):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        report = appliance(release, 'diagnostics')
        service = report.get('service', {})
        if service.get('reachable') and service.get('integrityOk'):
            need(service.get('buildIdentity', {}).get('sourceCommit') == manifest['sourceCommit']
                 and service.get('localSchemaVersion') == manifest['localSchemaVersion'], 'Running identity/schema differs')
            need(command(['systemctl', 'is-active', UNIT]).stdout.strip() == 'active', 'Service must be active')
            pid = int(command(['systemctl', 'show', UNIT, '--property=MainPID', '--value']).stdout)
            uid = pwd.getpwnam('vault').pw_uid
            uid_line = next(line for line in Path('/proc', str(pid), 'status').read_text().splitlines() if line.startswith('Uid:'))
            need(uid > 0 and all(int(value) == uid for value in uid_line.split()[1:]), 'Actual service must run as vault')
            return {'service': service, 'mainPid': pid, 'serviceUid': uid}
        time.sleep(1)
    raise ValueError('Installed service did not become reachable with valid identity/integrity')


def database_facts(folder, token, event_watermark=None):
    facts = {}
    for name in DATABASES:
        path = folder / name
        need(path.is_file() and not path.is_symlink(), 'Coordinated database missing')
        with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
            need(db.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'Database integrity failed')
            need(db.execute('SELECT token FROM rehearsal_fixture').fetchall() == [(token,)], 'Synthetic preservation canary differs')
            if name == 'vault.sqlite':
                facts['machine'] = list(db.execute('SELECT machine_id,schema_version,service_locked,automation_halted,recovery_required FROM machine_meta WHERE singleton=1').fetchone())
                facts['eventSequence'] = db.execute('SELECT COALESCE(MAX(sequence),0) FROM machine_event').fetchone()[0]
                watermark = facts['eventSequence'] if event_watermark is None else event_watermark
                rows = db.execute('SELECT * FROM machine_event WHERE sequence<=? ORDER BY sequence', (watermark,)).fetchall()
                facts['eventPrefixSha256'] = hashlib.sha256(json.dumps(rows, separators=(',', ':')).encode()).hexdigest()
    return facts


def validate_snapshot(release, folder, checkpoint):
    need(folder.parent == STATE / 'backups', 'Snapshot is outside installed backup directory')
    for ancestor in (folder, *folder.parents):
        info = ancestor.lstat()
        owner = pwd.getpwnam('vault').pw_uid if ancestor == STATE else 0
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == owner and not info.st_mode & 0o022,
             'Snapshot ancestors must be protected without symlinks')
    verified = appliance(release, 'verify-snapshot', '--snapshot', folder)
    need(verified.get('verified') is True and verified.get('machineId') == checkpoint['machineId'], 'Snapshot verification/identity failed')
    facts = database_facts(folder, checkpoint['canary'])
    need(facts['machine'][:2] == [checkpoint['machineId'], checkpoint['schemaVersion']], 'Snapshot machine/schema differs')
    return verified


def prepare(args, validator, host_id):
    fresh_guard()
    release = protected(args.release, directory=True)
    public_key = protected(args.public_key)
    metadata = protected(args.update_metadata, directory=True)
    original = validator.verify(release, public_key)
    protected(metadata / 'release.json'); protected(metadata / 'release.sig')
    update = json.loads((metadata / 'release.json').read_text())
    equivalent_update(original, update)
    # Verify replacement metadata before any installed path/account changes.
    command(['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', public_key, '-rawin',
             '-in', metadata / 'release.json', '-sigfile', metadata / 'release.sig'])
    need(shutil.disk_usage('/var/lib').free > 2 * 1024**3, 'At least 2 GiB free required for isolated rehearsal')
    ROOT.mkdir(mode=0o700)
    (ROOT / 'evidence').mkdir(mode=0o700)
    checkpoint = {'hostId': host_id, 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                  'machineId': str(uuid.uuid4()), 'schemaVersion': original['localSchemaVersion'],
                  'sourceCommit': original['sourceCommit'], 'initialReleaseId': original['releaseId'],
                  'updateReleaseId': update['releaseId'], 'canary': secrets.token_hex(24)}
    evidence('started', checkpoint)
    # Signed payload is copied, never altered; only the separately signed metadata differs.
    replacement = ROOT / 'update-release'
    shutil.copytree(release, replacement)
    for name in ('release.json', 'release.sig'): shutil.copyfile(metadata / name, replacement / name)
    validator.verify(replacement, public_key)
    ETC.mkdir(mode=0o755); ETC.chmod(0o755)
    private = ROOT / 'synthetic-config-private.pem'
    command(['openssl', 'genpkey', '-algorithm', 'Ed25519', '-out', private])
    command(['openssl', 'pkey', '-in', private, '-pubout', '-out', ETC / 'config-public.pem'])
    (ETC / 'config-public.pem').chmod(0o644); private.unlink()
    config = {'VAULT_MACHINE_ID': checkpoint['machineId'], 'VAULT_CLOUD_ORIGIN': 'https://127.0.0.1:47839',
              'VAULT_MACHINE_CREDENTIAL': secrets.token_hex(32), 'VAULT_ADAPTER_CALLBACK_TOKEN': secrets.token_hex(32),
              'VAULT_MAINTENANCE_TOKEN': secrets.token_hex(32), 'VAULT_CONFIG_KEY_ID': 'synthetic-lifecycle-only',
              'VAULT_CONFIG_PUBLIC_KEY_PATH': str(ETC / 'config-public.pem'),
              'VAULT_PAYMENT_ADAPTER': 'MOCK', 'VAULT_CONTROLLER_ADAPTER': 'SIMULATOR'}
    safe_config(config, checkpoint['machineId']); write_new(ROOT / 'machine.env.json', config)
    evidence('install-plan', appliance(release, 'install', '--release', release, '--public-key', public_key))
    evidence('install-result', appliance(release, 'install', '--release', release, '--public-key', public_key,
                                       '--config', ROOT / 'machine.env.json', '--apply'))
    installed, _ = current_release(original['releaseId'], validator)
    need(command(['systemctl', 'is-active', UNIT], check=False).stdout.strip() == 'inactive', 'Install unexpectedly started service')
    need(command(['systemctl', 'is-enabled', UNIT], check=False).stdout.strip() == 'disabled', 'Install unexpectedly enabled service')
    evidence('preflight', appliance(installed, 'preflight-config'))
    command(['systemctl', 'enable', '--now', UNIT])
    evidence('initial-start', wait_ready(installed, original))
    # A test-only table in each real initialized database proves coordinated preservation.
    # No fabricated sale, receipt, provider state, entitlement or controller row is inserted.
    barrier = validator.maintenance('enter'); validator.allow_restart(barrier)
    command(['systemctl', 'stop', UNIT])
    need(command(['systemctl', 'is-active', UNIT], check=False).stdout.strip() == 'inactive', 'Writer did not stop')
    for name in DATABASES:
        need((STATE / name).is_file(), 'Runtime did not initialize coordinated journal')
        with sqlite3.connect(STATE / name) as db:
            db.execute('CREATE TABLE rehearsal_fixture(token TEXT NOT NULL)')
            db.execute('INSERT INTO rehearsal_fixture VALUES (?)', (checkpoint['canary'],))
    evidence('canary-staged', {'maintenance': barrier, 'facts': database_facts(STATE, checkpoint['canary'])})
    command(['systemctl', 'start', UNIT]); wait_ready(installed, original)
    for operation in ('restart', 'update'):
        safe_config(validator.private_json(ETC / 'machine.env.json'), checkpoint['machineId'])
        extra = ['--release', replacement] if operation == 'update' else []
        evidence(operation + '-plan', appliance(installed, operation, *extra))
        result = appliance(installed, operation, *extra, '--apply')
        evidence(operation + '-result', result)
        installed, manifest = current_release(update['releaseId'] if operation == 'update' else original['releaseId'], validator)
        evidence(operation + '-health', wait_ready(installed, manifest))
        verified = validate_snapshot(installed, Path(result['backup']), checkpoint)
        evidence(operation + '-snapshot', verified)
    before = database_facts(STATE, checkpoint['canary'])
    destination = ROOT / 'held-restore'
    evidence('held-restore', appliance(installed, 'stage-restore', '--snapshot', result['backup'],
             '--manifest-sha256', verified['manifestSha256'], '--machine-id', checkpoint['machineId'],
             '--destination', destination, '--apply'))
    restored = database_facts(destination, checkpoint['canary'])
    need(restored['machine'][2:] == [1, 1, 1], 'Restored state lacks technical recovery hold')
    need(database_facts(STATE, checkpoint['canary'])['machine'] == before['machine'], 'Held restore changed installed authority')
    for name in DATABASES[1:]:
        need((destination / name).read_bytes() == (Path(result['backup']) / name).read_bytes(), 'Restore changed provider journal')
    final_facts = database_facts(STATE, checkpoint['canary'])
    checkpoint['eventSequence'] = final_facts['eventSequence']
    checkpoint['eventPrefixSha256'] = final_facts['eventPrefixSha256']
    need(validator.verify(BASE / 'releases' / original['releaseId'], ETC / 'release-public.pem') == original,
         'Previous signed release was not preserved')
    evidence('awaiting-reboot', checkpoint)
    print('SYNTHETIC_ONLY: install/start/restart/update/backup/held restore passed. Evidence: ' + str(ROOT))
    print('Reboot this disposable VM separately, then run after-reboot with the same acknowledgement and machine-id.')


def after_reboot(args, validator, host_id):
    checkpoint = json.loads(protected(ROOT / 'evidence/awaiting-reboot.json').read_text())
    need(checkpoint.get('classification') == 'SYNTHETIC_ONLY' and checkpoint['hostId'] == host_id, 'Rehearsal belongs to another VM')
    need(Path('/proc/sys/kernel/random/boot_id').read_text().strip() != checkpoint['bootId'], 'A real VM reboot has not occurred')
    config = validator.private_json(ETC / 'machine.env.json'); safe_config(config, checkpoint['machineId'])
    release, manifest = current_release(checkpoint['updateReleaseId'], validator)
    need(manifest['sourceCommit'] == checkpoint['sourceCommit'], 'Source changed across reboot')
    old = validator.verify(BASE / 'releases' / checkpoint['initialReleaseId'], ETC / 'release-public.pem')
    need(old['releaseId'] == checkpoint['initialReleaseId'] and old['sourceCommit'] == checkpoint['sourceCommit'], 'Previous signed release missing after reboot')
    health = wait_ready(release, manifest)
    need(command(['systemctl', 'is-enabled', UNIT]).stdout.strip() == 'enabled', 'Service boot enablement missing')
    facts = database_facts(STATE, checkpoint['canary'], checkpoint['eventSequence'])
    need(facts['machine'][:2] == [checkpoint['machineId'], checkpoint['schemaVersion']]
         and facts['eventSequence'] >= checkpoint['eventSequence']
         and facts['eventPrefixSha256'] == checkpoint['eventPrefixSha256'], 'Durable state regressed across reboot')
    evidence('completed', {'hostId': host_id, 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                          'health': health, 'facts': facts, 'releaseId': manifest['releaseId'],
                          'cabinetAcceptance': False, 'providerAcceptance': False, 'productionActivation': False})
    print('SYNTHETIC_ONLY: disposable Arch installed-service lifecycle and reboot checks passed. Evidence: ' + str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['prepare', 'after-reboot'])
    parser.add_argument('--acknowledge', required=True); parser.add_argument('--disposable-machine-id', required=True)
    parser.add_argument('--release', type=Path); parser.add_argument('--public-key', type=Path)
    parser.add_argument('--update-metadata', type=Path)
    args = parser.parse_args(); os.umask(0o077)
    protected(Path(__file__).absolute())
    validator = load_validator(); host_id = host_guard(args, validator)
    if args.phase == 'prepare': need(args.release and args.public_key and args.update_metadata, 'Signed release, trusted public key and signed update metadata required')
    # Kernel-released lock survives process failure without authorizing any replay.
    lock = Path('/run/vault-lifecycle-rehearsal.lock')
    protected(lock.parent, directory=True)
    fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and not info.st_mode & 0o077, 'Invalid rehearsal lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        (prepare if args.phase == 'prepare' else after_reboot)(args, validator, host_id)
    finally: os.close(fd)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Rehearsal failed; preserve this disposable VM for inspection', file=sys.stderr)
        sys.exit(1)
