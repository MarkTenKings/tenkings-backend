#!/usr/bin/python3
"""Verify and stage coordinated Vault snapshots without replacing installed state.

Restore and schema upgrade are create-only. Every restored machine retains a
technical recovery hold. No service, payment provider, or controller is started.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import stat
import subprocess
import sys
sys.dont_write_bytecode = True
import tempfile
from pathlib import Path
import appliance as a

DATABASES = {'vault.sqlite', 'vault.sqlite.mock-provider.sqlite', 'vault.sqlite.controller.sqlite', 'vault.sqlite.spark-provider.sqlite'}
MEMBERS = DATABASES | {name + '.anchor' for name in DATABASES}
PENDING = 'state-operation.pending.json'
RECEIPT = 'state-operation.completed.json'
MAX_DB = 256 * 1024 * 1024
SHA = re.compile(r'[a-f0-9]{64}')

def allowed_member(name):
    return isinstance(name, str) and a.journal_database_name(name[:-7] if name.endswith('.anchor') else name)

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        a.need(key not in result, 'Duplicate JSON member')
        result[key] = value
    return result

def parse(data):
    return json.loads(data, object_pairs_hook=unique_object)

def flush_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def write_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as stream: stream.write(data); stream.flush(); os.fsync(fd)
    finally: os.close(fd)

def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()

def trusted_staging_parent(path):
    # Privileged staging cannot use a parent that another account may rename.
    # A root-owned sticky temporary root is safe only above our owned directories.
    with a.tree_handle(path):
        for ancestor in [path, *path.parents]:
            info = ancestor.lstat()
            a.need(stat.S_ISDIR(info.st_mode) and info.st_uid in {0, os.geteuid()}, 'Staging parent must belong to the caller or root')
            sticky_root = info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)
            a.need(not info.st_mode & 0o022 or sticky_root, 'Staging parent must not be writable by another account')

def read_snapshot(directory, expected_digest=None):
    with a.tree_handle(directory) as root:
        raw = a.read_member(root, 'manifest.json', 65536)
        manifest_digest = hashlib.sha256(raw).hexdigest()
        if expected_digest is not None:
            a.need(isinstance(expected_digest, str) and SHA.fullmatch(expected_digest) and manifest_digest == expected_digest, 'Snapshot manifest digest mismatch')
        manifest = parse(raw)
        a.need(isinstance(manifest, dict) and manifest.get('schemaVersion') == 2 and manifest.get('automaticRestore') is False, 'Unsupported coordinated snapshot')
        a.need(re.fullmatch(r'[a-f0-9-]{36}', manifest.get('snapshotId', '')), 'Snapshot identity invalid')
        identity = manifest.get('machine')
        a.need(isinstance(identity, dict) and re.fullmatch(r'[a-f0-9-]{36}', identity.get('machineId', ''))
               and type(identity.get('localSchemaVersion')) is int and identity['localSchemaVersion'] > 0, 'Snapshot machine identity invalid')
        required = manifest.get('requiredFiles'); files = manifest.get('files')
        a.need(isinstance(required, list) and all(allowed_member(name) for name in required) and len(required) == len(set(required)) and 'vault.sqlite' in required, 'Snapshot required members invalid')
        a.need(isinstance(files, list) and 1 <= len(files) <= 256, 'Snapshot member ledger invalid')
        blobs = {}; total = 0
        for member in files:
            a.need(isinstance(member, dict) and set(member) == {'file', 'sha256'} and allowed_member(member['file'])
                   and member['file'] not in blobs and isinstance(member['sha256'], str) and SHA.fullmatch(member['sha256']), 'Snapshot member invalid')
            limit = 256 if member['file'].endswith('.anchor') else MAX_DB
            data = a.read_member(root, member['file'], limit)
            total += len(data); a.need(total <= 512 * 1024 * 1024, 'Snapshot set exceeds bounded staging limit')
            a.need(hashlib.sha256(data).hexdigest() == member['sha256'], 'Snapshot member digest mismatch')
            blobs[member['file']] = data
        a.need(set(required) <= set(blobs), 'Required coordinated member is missing')
        actual = {entry.name for entry in Path(directory).iterdir()}
        a.need(actual == set(blobs) | {'manifest.json'}, 'Unmanifested snapshot member')
    return manifest, manifest_digest, blobs

def database_facts(directory, manifest):
    facts = {}
    spark_bindings = {}; controller_bindings = {}; required_journals = set(); expected_spark = {}
    for name in sorted(member['file'] for member in manifest['files'] if a.journal_database_name(member['file'])):
        file = directory / name
        if not file.exists(): continue
        with sqlite3.connect(file.as_uri() + '?mode=ro&immutable=1', uri=True) as db:
            db.execute('PRAGMA trusted_schema=OFF')
            a.need(db.execute('PRAGMA integrity_check').fetchall() == [('ok',)] and not db.execute('PRAGMA foreign_key_check').fetchall(), 'Snapshot database integrity failed')
            if name == 'vault.sqlite':
                row = db.execute('SELECT machine_id,schema_version FROM machine_meta WHERE singleton=1').fetchone()
                a.need(row == (manifest['machine']['machineId'], manifest['machine']['localSchemaVersion']), 'Snapshot machine/schema mismatch')
                versions = [row[0] for row in db.execute('SELECT version FROM schema_migration ORDER BY version')]
                a.need(versions == list(range(1, row[1] + 1)), 'Snapshot migration ledger incomplete')
                facts['machineId'], facts['localSchemaVersion'] = row
                tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                required_journals.update(a.history_journals(db, tables))
                if 'machine_event' in tables:
                    facts['eventSequence'] = db.execute('SELECT COALESCE(MAX(sequence),0) FROM machine_event').fetchone()[0]
                    a.need(manifest['machine'].get('eventSequence') == facts['eventSequence'], 'Snapshot event watermark mismatch')
                if 'sale_payment_binding' in tables:
                    facts['sparkHistory'] = bool(db.execute("SELECT 1 FROM sale_payment_binding WHERE provider='NAYAX_SPARK' LIMIT 1").fetchone())
                    if facts['sparkHistory']:
                        facts['sparkHistoryBindings'] = [r[0] for r in db.execute("SELECT DISTINCT binding_digest FROM sale_payment_binding WHERE provider='NAYAX_SPARK' ORDER BY binding_digest")]
                        columns = {r[1] for r in db.execute('PRAGMA table_info(sale_payment_binding)')}
                        mode = 'adapter_mode' if 'adapter_mode' in columns else "'OFFICIAL_TEST'"
                        for stage, binding in db.execute("SELECT DISTINCT " + mode + ",binding_digest FROM sale_payment_binding WHERE provider='NAYAX_SPARK'"):
                            journal = 'vault.sqlite.spark-production-' + binding + '.sqlite' if stage == 'LIVE' else 'vault.sqlite.spark-provider.sqlite'
                            expected_spark.setdefault(journal, set()).add(binding)
            production = a.PRODUCTION_DATABASE.fullmatch(name)
            if name == 'vault.sqlite.spark-provider.sqlite' or production and production[1] == 'spark':
                row = db.execute('SELECT binding_digest FROM spark_binding WHERE singleton=1').fetchone()
                a.need(row and SHA.fullmatch(row[0]), 'Spark journal binding missing')
                anchor = directory / (name + '.anchor')
                a.need(anchor.is_file() and anchor.read_text() == row[0], 'Spark journal anchor mismatch')
                a.need(not production or production[2] == row[0], 'Production Spark journal filename binding mismatch')
                spark_bindings[name] = row[0]
                if not production: facts['sparkBindingDigest'] = row[0]
            if production and production[1] == 'controller':
                row = db.execute('SELECT binding_digest FROM waveshare_state WHERE singleton=1').fetchone()
                a.need(row and row[0] == production[2], 'Production controller journal filename binding mismatch')
                controller_bindings[name] = row[0]
    a.need(required_journals <= set(spark_bindings) | set(controller_bindings), 'Main history requires every matching provider/controller journal and anchor')
    a.need(all(bindings == {spark_bindings.get(name)} for name, bindings in expected_spark.items()), 'Main history and Spark journal binding mismatch; stage and generation must match exactly')
    a.need(not facts.get('sparkHistory') or set(facts.get('sparkHistoryBindings', [])) <= set(spark_bindings.values()), 'Main history and Spark journal binding mismatch; preserve and review the complete provider history')
    facts['sparkJournalBindings'] = spark_bindings
    facts['controllerJournalBindings'] = controller_bindings
    return facts

def verify_snapshot(directory, expected_digest=None):
    manifest, manifest_digest, blobs = read_snapshot(directory, expected_digest)
    with tempfile.TemporaryDirectory(prefix='vault-snapshot-verify-') as temp:
        root = Path(temp)
        for name, data in blobs.items(): write_new(root / name, data)
        facts = database_facts(root, manifest)
    return {'verified': True, 'snapshotId': manifest['snapshotId'], 'manifestSha256': manifest_digest,
            'memberCount': len(blobs), **facts, 'activationAllowed': False}

def stage_snapshot(directory, destination, expected_digest, expected_machine, upgrade=None):
    manifest, manifest_digest, blobs = read_snapshot(directory, expected_digest)
    a.need(manifest['machine']['machineId'] == expected_machine, 'Snapshot belongs to another machine')
    destination = Path(os.path.abspath(destination))
    # Trusted parent handles reject symlink ancestors. Existing state is never overwritten.
    trusted_staging_parent(destination.parent)
    a.need(not destination.exists() and not destination.is_symlink(), 'Destination must be new; existing state is preserved')
    destination.mkdir(mode=0o700)
    operation = {'schemaVersion': 1, 'operation': 'UPGRADE' if upgrade else 'RESTORE', 'snapshotId': manifest['snapshotId'],
                 'sourceManifestSha256': manifest_digest, 'machineId': expected_machine,
                 'sourceSchemaVersion': manifest['machine']['localSchemaVersion'], 'activationAllowed': False}
    write_new(destination / PENDING, encoded(operation)); flush_directory(destination); flush_directory(destination.parent)
    # On any exception preserve the incomplete output and pending marker. It cannot boot.
    for name, data in sorted(blobs.items(), key=lambda item: item[0] == 'vault.sqlite'):
        write_new(destination / name, data)
    facts = database_facts(destination, manifest)
    with sqlite3.connect(destination / 'vault.sqlite') as db:
        db.execute('PRAGMA trusted_schema=OFF')
        db.execute('UPDATE machine_meta SET service_locked=1,automation_halted=1,recovery_required=1,last_cloud_success_at=NULL WHERE singleton=1')
        db.commit()
    if upgrade:
        release, public_key = upgrade
        candidate = a.verify(release, public_key)
        a.need(candidate['localSchemaVersion'] > facts['localSchemaVersion'], 'Upgrade requires a newer schema, never a downgrade')
        runner = Path(release) / 'deploy/vault-linux/upgrade-snapshot.cjs'
        a.need(any(member['path'] == 'deploy/vault-linux/upgrade-snapshot.cjs' for member in candidate['files']), 'Signed release lacks offline migration runner')
        env = {'PATH': str(Path(release) / 'runtime/bin') + ':/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
        result = subprocess.run([str(Path(release) / 'runtime/bin/node'), str(runner), str(destination), expected_machine,
                                 str(facts['localSchemaVersion']), str(candidate['localSchemaVersion']), candidate['sourceCommit'], candidate['appVersion']],
                                check=True, capture_output=True, text=True, timeout=120, env=env)
        receipt = parse(result.stdout)
        a.need(receipt.get('upgraded') is True and receipt.get('toSchema') == candidate['localSchemaVersion'], 'Offline migration did not confirm target schema')
        operation['releaseId'] = candidate['releaseId']; operation['sourceCommit'] = candidate['sourceCommit']
        operation['targetSchemaVersion'] = candidate['localSchemaVersion']
    else: operation['targetSchemaVersion'] = facts['localSchemaVersion']
    with sqlite3.connect((destination / 'vault.sqlite').as_uri() + '?mode=ro', uri=True) as db:
        a.need(db.execute('PRAGMA integrity_check').fetchall() == [('ok',)] and not db.execute('PRAGMA foreign_key_check').fetchall(), 'Staged database integrity failed')
        row = db.execute('SELECT schema_version,service_locked,automation_halted,recovery_required,last_cloud_success_at FROM machine_meta WHERE singleton=1').fetchone()
        a.need(row == (operation['targetSchemaVersion'], 1, 1, 1, None), 'Staged recovery hold missing')
    operation['files'] = [{'file': name, 'sha256': a.sha(destination / name)} for name in sorted(blobs)]
    for name in blobs:
        with (destination / name).open('rb') as file: os.fsync(file.fileno())
    write_new(destination / RECEIPT, encoded(operation)); flush_directory(destination)
    (destination / PENDING).unlink(); flush_directory(destination)
    return {'staged': True, 'destination': str(destination), **operation, 'providerCalls': 0, 'serviceStarted': False,
            'next': 'Review staged evidence and technical recovery before separately authorized installation; original state remains unchanged'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['verify', 'restore', 'upgrade'])
    parser.add_argument('--snapshot', required=True); parser.add_argument('--expected-manifest-sha256')
    parser.add_argument('--destination'); parser.add_argument('--machine-id')
    parser.add_argument('--release'); parser.add_argument('--public-key')
    args = parser.parse_args(); os.umask(0o077)
    if args.command == 'verify': result = verify_snapshot(args.snapshot, args.expected_manifest_sha256)
    else:
        a.need(args.expected_manifest_sha256 and args.destination and args.machine_id, 'Staging requires reviewed manifest digest, exact machine ID and new destination')
        a.need(args.command != 'upgrade' or args.release and args.public_key, 'Upgrade requires a signed release and trusted public key')
        result = stage_snapshot(args.snapshot, args.destination, args.expected_manifest_sha256, args.machine_id,
                                (args.release, args.public_key) if args.command == 'upgrade' else None)
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Snapshot operation failed; preserve source and incomplete staged output', file=__import__('sys').stderr)
        raise SystemExit(1)
