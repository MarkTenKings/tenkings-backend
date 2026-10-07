#!/usr/bin/env python3
"""Export/verify an unsigned source candidate for native SER development.

This proves only consistency with a local manifest, never release authorization,
review, hardware certification, or a clean commit. No dependencies are copied.
"""
import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
from pathlib import Path, PurePosixPath

MANIFEST = 'candidate-source.json'
TREES = ('packages/vault-contracts', 'packages/vault-machine', 'frontend/vault-kiosk', 'deploy/vault-linux')
FIXED = (
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json',
    'scripts/test-vault-node.mjs', 'scripts/run-vault-simulator.mjs', 'scripts/vault-simulator-source.mjs',
    'scripts/vault-stripe-sandbox.mjs', 'scripts/vault-stripe-tenkings-touchscreen-bench.sh',
    'docs/vault-v1/STRIPE_TOUCHSCREEN_BENCH_2026-09-28.md',
    'docs/vault-v1/NAYAX_SPARK_V3_REVIEW_2026-10-07.md',
    'docs/vault-v1/SPARK_OPERATIONS_AND_ACCEPTANCE.md',
    'docs/vault-v1/SPARK_PRODUCTION_ACTIVATION.md',
    'docs/vault-v1/NAYAX_MEETING_AND_GO_LIVE_2026-10-08.md',
    'docs/vault-v1/SER_BRINGUP_2026-09-16.md', 'docs/vault-v1/LINUX_APPLIANCE_2026-09-16.md',
    'docs/vault-v1/BENCH_PROGRESS_2026-09-16.md', 'docs/vault-v1/WAVESHARE_INTEGRATION_2026-09-16.md',
)
GENERATED = frozenset(('node_modules', 'dist', '__pycache__', '.pytest_cache', '.vite', 'coverage', 'test-results', 'playwright-report'))
EXCLUDED = GENERATED | frozenset(('.git', '.next', 'outputs', 'output', 'private', 'secrets', 'credentials'))
EXTENSIONS = frozenset(('.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.css', '.html', '.png', '.svg', '.md', '.sh', '.ps1', '.xml', '.lua', '.service'))
JSON_FILES = frozenset((
    *(tree + '/package.json' for tree in TREES[:3]),
    *(tree + '/tsconfig.json' for tree in TREES[:3]),
    'deploy/vault-linux/runtime.json', 'deploy/vault-linux/templates/machine.env.example.json',
    'deploy/vault-linux/templates/machine.spark.env.example.json',
    'deploy/vault-linux/templates/nayax-spark.test.example.json',
))
MAX_FILE = 16 * 1024 * 1024
MAX_TOTAL = 40 * 1024 * 1024
MAX_MANIFEST = 1024 * 1024
MAX_FILES = 2000


def need(condition, message):
    if not condition:
        raise ValueError(message)


def safe_path(value):
    need(isinstance(value, str) and 0 < len(value) <= 512 and re.fullmatch(r'[A-Za-z0-9_@./-]+', value), 'Unsafe candidate path')
    parts = value.split('/')
    need(all(part not in ('', '.', '..') for part in parts), 'Unsafe candidate path')
    need(not PurePosixPath(value).is_absolute(), 'Unsafe candidate path')
    return value


def allowed(value):
    value = safe_path(value)
    parts = value.split('/')
    if any(part.lower() in EXCLUDED or part.lower().startswith('.env') for part in parts):
        return False
    if value in FIXED:
        return True
    if not any(value.startswith(tree + '/') for tree in TREES):
        return False
    name = parts[-1].lower()
    if any(word in name for word in ('credential', 'secret', 'private-key', 'access-token')):
        return False
    if name.endswith('.json'):
        return value in JSON_FILES
    return PurePosixPath(value).suffix in EXTENSIONS


def read_member(root, relative, limit=MAX_FILE):
    """Reject replaced links/FIFOs before reading; never follow source members."""
    parts = safe_path(relative).split('/')
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(descriptor, 'rb') as file:
            before = os.fstat(file.fileno())
            need(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'Candidate member must be a bounded regular file')
            data = file.read(limit + 1)
            after = os.fstat(file.fileno())
            need(len(data) <= limit and len(data) == before.st_size and (before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Candidate member changed while reading')
            return data
    finally:
        os.close(directory)


def entry(path, data):
    return {'path': path, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def git(source, *args):
    return subprocess.check_output(['git', *args], cwd=source, stderr=subprocess.PIPE)


def source_paths(source):
    paths = git(source, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', *FIXED, *TREES).decode('utf-8').split('\0')
    deleted = set(git(source, 'ls-files', '-z', '--deleted', '--', *FIXED, *TREES).decode('utf-8').split('\0'))
    selected = sorted({path for path in paths if path and path not in deleted and allowed(path)})
    need(set(FIXED).issubset(selected), 'Required source file missing from candidate allowlist')
    need(all(any(path.startswith(tree + '/') for path in selected) for tree in TREES), 'Required source tree missing')
    need(0 < len(selected) <= MAX_FILES, 'Candidate file count out of bounds')
    return selected


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, 'Duplicate manifest property')
        result[key] = value
    return result


def manifest_entries(data):
    doc = json.loads(data, object_pairs_hook=no_duplicate_keys)
    need(isinstance(doc, dict) and set(doc) == {'schemaVersion', 'sourceState', 'baseCommit', 'files'}, 'Invalid candidate manifest fields')
    need(type(doc['schemaVersion']) is int and doc['schemaVersion'] == 1 and doc['sourceState'] == 'UNCOMMITTED_CANDIDATE', 'Invalid candidate manifest state')
    need(isinstance(doc['baseCommit'], str) and re.fullmatch('[a-f0-9]{40}', doc['baseCommit']), 'Invalid base commit')
    need(isinstance(doc['files'], list) and 0 < len(doc['files']) <= MAX_FILES, 'Invalid candidate files')
    seen = set()
    total = 0
    for file in doc['files']:
        need(isinstance(file, dict) and set(file) == {'path', 'size', 'sha256'}, 'Invalid candidate file fields')
        path = safe_path(file['path'])
        need(allowed(path), 'Candidate file outside source allowlist')
        need(path not in seen, 'Duplicate candidate path')
        seen.add(path)
        need(type(file['size']) is int and 0 <= file['size'] <= MAX_FILE, 'Invalid candidate size')
        need(isinstance(file['sha256'], str) and re.fullmatch('[a-f0-9]{64}', file['sha256']), 'Invalid candidate hash')
        total += file['size']
    need(total <= MAX_TOTAL, 'Candidate exceeds source transfer limit')
    need(set(FIXED).issubset(seen), 'Required source file missing from manifest')
    need(all(any(path.startswith(tree + '/') for path in seen) for tree in TREES), 'Required source tree missing from manifest')
    return doc


def bundle_paths(root, allow_build_output):
    found = set()
    for directory, children, files in os.walk(root, followlinks=False):
        for name in list(children):
            path = Path(directory) / name
            if allow_build_output and name in GENERATED:
                children.remove(name)
                continue
            need(not path.is_symlink(), 'Candidate bundle contains a directory symlink')
        for name in files:
            relative = (Path(directory) / name).relative_to(root).as_posix()
            if relative == MANIFEST:
                continue
            if allow_build_output and name.endswith(('.pyc', '.tsbuildinfo')):
                continue
            need(allowed(relative), 'Unexpected file outside candidate source allowlist')
            found.add(relative)
    return found


def verify_bundle(root, allow_build_output=False):
    root = Path(root).resolve(strict=True)
    data = read_member(root, MANIFEST, MAX_MANIFEST)
    manifest = manifest_entries(data)
    expected = {file['path'] for file in manifest['files']}
    need(bundle_paths(root, allow_build_output) == expected, 'Candidate membership mismatch')
    for file in manifest['files']:
        need(entry(file['path'], read_member(root, file['path'])) == file, 'Candidate size/hash mismatch: ' + file['path'])
    digest = hashlib.sha256(data).hexdigest()
    return {
        'sourceState': manifest['sourceState'], 'baseCommit': manifest['baseCommit'],
        'sourceManifestSha256': digest, 'sourceCommit': 'CANDIDATE_SHA256:' + digest,
        'files': len(expected), 'sourceBytes': sum(file['size'] for file in manifest['files']),
        'generatedOutputsExcluded': allow_build_output, 'signedRelease': False,
        'hardwareCertificationEligible': False,
    }


def export_bundle(source, output):
    source = Path(source).resolve(strict=True)
    # lexists catches a dangling output symlink; resolved containment catches a
    # parent link leading into the checkout. Partial failures remain private.
    raw_output = Path(output).absolute()
    need(not os.path.lexists(raw_output), 'Output must be new')
    output = raw_output.resolve()
    need(output != source and source not in output.parents, 'Output must be outside source')
    need(output.parent.is_dir(), 'Output parent must already exist')
    base = git(source, 'rev-parse', 'HEAD').decode().strip()
    need(re.fullmatch('[a-f0-9]{40}', base), 'Source must have a real base commit')
    paths = source_paths(source)
    output.mkdir(mode=0o700)
    files = []
    total = 0
    for path in paths:
        data = read_member(source, path)
        total += len(data)
        need(total <= MAX_TOTAL, 'Candidate exceeds source transfer limit')
        destination = output / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('xb') as file:
            file.write(data)
        destination.chmod(0o644)
        files.append(entry(path, data))
    manifest = {'schemaVersion': 1, 'sourceState': 'UNCOMMITTED_CANDIDATE', 'baseCommit': base, 'files': files}
    data = (json.dumps(manifest, sort_keys=True, separators=(',', ':')) + '\n').encode()
    need(len(data) <= MAX_MANIFEST, 'Candidate manifest too large')
    with (output / MANIFEST).open('xb') as file:
        file.write(data)
    need(git(source, 'rev-parse', 'HEAD').decode().strip() == base and source_paths(source) == paths, 'Source changed during export; discard this incomplete candidate')
    for file in files:
        need(entry(file['path'], read_member(source, file['path'])) == file, 'Source changed during export; discard this incomplete candidate')
    return {'bundle': str(output), **verify_bundle(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    export = actions.add_parser('export')
    export.add_argument('--source', required=True)
    export.add_argument('--output', required=True)
    verify = actions.add_parser('verify')
    verify.add_argument('--bundle', required=True)
    verify.add_argument('--allow-build-output', action='store_true', help='Ignore known generated directories after a native build; their bytes are not verified')
    args = parser.parse_args()
    try:
        result = export_bundle(args.source, args.output) if args.action == 'export' else verify_bundle(args.bundle, args.allow_build_output)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit('Candidate source operation failed: ' + str(error))


if __name__ == '__main__':
    main()
