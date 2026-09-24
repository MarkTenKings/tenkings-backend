#!/usr/bin/env python3
"""Stream an explicit current-source closure into the owned tmpfs fixture.

No host archive is created; environment files, outputs and dependencies are
excluded. The in-memory manifest records the exact bytes used for each build.
"""
import hashlib
import io
import json
import pathlib
import re
import subprocess
import sys
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
NONCE = 'c51c6b44-cdee-46c2-831e-35806623aafb'
IMAGE = 'sha256:315bae6df16bf090faa0c1d23682eb88fb113b79dc793f61680da5a1b5e10bcc'
paths = set(subprocess.check_output(['git', 'ls-files', '-co', '--exclude-standard', '-z'], cwd=ROOT).decode().split('\0'))
packages = {}
for path in paths:
    if re.fullmatch(r'(packages|frontend)/[^/]+/package.json', path):
        value = json.loads((ROOT / path).read_text())
        packages[value['name']] = (str(pathlib.Path(path).parent), value)
allowed = set()
cpu_files = {'backend/ai-grader-speedster-service/' + name for name in [
    'manual_preparation_worker.py', 'atlas_photo_geometry.py', 'test_atlas_photo_geometry.py',
    'manual_measurement_worker.py', 'manual_measurement.py', 'card_geometry.py', 'color_geometry.py',
    'preparation_pixels.py', 'defect_math.py', 'trace_rle.py',
]}

def visit(name):
    directory, value = packages[name]
    if directory in allowed:
        return
    allowed.add(directory)
    for dependency, version in (value.get('dependencies', {}) | value.get('devDependencies', {})).items():
        if version.startswith('workspace:'):
            visit(dependency)

for name in ['@atlas/staff-app', '@atlas/customer-app', '@atlas/public-app']:
    visit(name)

files = {}
test_files = {'packages/database/prisma/schema.prisma'}
for path in sorted(paths):
    if path not in ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json'] and path not in cpu_files and path not in test_files and not any(path.startswith(directory + '/') for directory in allowed):
        continue
    if re.search(r'(^|/)(node_modules|\.next|\.generated|dist|coverage|logs?|\.env[^/]*|\.git)(/|$)', path) or re.search(r'\.(log|pem|key|crt|p12|pfx)$', path):
        continue
    source = ROOT / path
    if source.is_symlink() or not source.is_file():
        raise RuntimeError('Source closure contains a non-file: ' + path)
    files[path] = source.read_bytes()
manifest = {'image': IMAGE, 'gitHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
            'packages': sorted(allowed), 'files': [{'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'byteCount': len(data)} for path, data in files.items()]}
manifest_bytes = json.dumps(manifest, indent=2).encode() + b'\n'
digest = hashlib.sha256(manifest_bytes).hexdigest()
if len(sys.argv) == 2:
    container = sys.argv[1]
    info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
    assert info['Id'] == container and info['Image'] == IMAGE
    assert info['Config']['Labels']['atlas.validation.nonce'] == NONCE
    assert info['HostConfig']['ReadonlyRootfs'] and info['HostConfig']['NetworkMode'] == 'none'
    assert info['State']['Running']
    proc = subprocess.Popen(['docker', 'exec', '-i', container, 'tar', '-xf', '-', '-C', '/build'], stdin=subprocess.PIPE)
    with tarfile.open(fileobj=proc.stdin, mode='w|') as archive:
        for path, data in files.items():
            entry = tarfile.TarInfo(path); entry.size = len(data); entry.mode = 0o644
            archive.addfile(entry, io.BytesIO(data))
        entry = tarfile.TarInfo('source-manifest.json'); entry.size = len(manifest_bytes); entry.mode = 0o644
        archive.addfile(entry, io.BytesIO(manifest_bytes))
    proc.stdin.close()
    assert proc.wait() == 0
    (ROOT / 'validation/atlas-build-20260924-timing/source-manifest.json').write_bytes(manifest_bytes)
print(json.dumps({'fileCount': len(files), 'sourceBytes': sum(map(len, files.values())), 'manifestSha256': digest, 'packages': len(allowed), 'streamed': len(sys.argv) == 2}))
