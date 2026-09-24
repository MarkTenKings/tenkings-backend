#!/usr/bin/env python3
"""Copy only missing, platform-independent installed registry packages to RAM."""
import hashlib
import io
import json
import os
import pathlib
import posixpath
import subprocess
import sys
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
container = sys.argv[1]
info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
assert info['Id'] == container
assert info['Config']['Labels']['atlas.validation.nonce'] == '7e8bf109-13ad-4c69-88d5-68b7bca2f931'
assert info['HostConfig']['ReadonlyRootfs'] and info['HostConfig']['NetworkMode'] == 'none'
present = set(json.loads(subprocess.check_output(['docker', 'exec', container, 'node', '-e', 'console.log(JSON.stringify(require("fs").readdirSync("/build/node_modules/.pnpm")))'])))
base = ROOT / 'node_modules/.pnpm'
selected = set()
files = {}
links = {}

def registry_relative(path):
    text = str(path.resolve())
    assert '/node_modules/.pnpm/' in text, text
    return text.split('/node_modules/.pnpm/')[-1]

def visit(name):
    if name in selected or name in present:
        return
    selected.add(name)
    package = (base / name).resolve()
    for directory, directories, names in os.walk(package, followlinks=False):
        for item in directories + names:
            source = pathlib.Path(directory) / item
            destination = 'node_modules/.pnpm/' + name + '/' + str(source.relative_to(package))
            if source.is_symlink():
                target = registry_relative(source)
                visit(target.split('/')[0])
                links[destination] = posixpath.relpath('node_modules/.pnpm/' + target, posixpath.dirname(destination))
            elif source.is_file():
                assert source.suffix not in ['.node', '.so', '.dylib', '.dll', '.exe'], source
                assert not source.name.startswith('.env'), source
                files[destination] = (source.read_bytes(), source.stat().st_mode & 0o777)

for name in ['pdfkit@0.17.2', 'svg-to-pdfkit@0.1.8', 'typescript@5.5.4']:
    visit(name)
manifest = {'packages': sorted(selected), 'nativeFiles': 0,
            'files': [{'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'byteCount': len(data)} for path, (data, _) in sorted(files.items())],
            'symlinks': links}
proc = subprocess.Popen(['docker', 'exec', '-i', container, 'tar', '-xf', '-', '-C', '/build'], stdin=subprocess.PIPE)
with tarfile.open(fileobj=proc.stdin, mode='w|') as archive:
    for path, (data, mode) in files.items():
        entry = tarfile.TarInfo(path); entry.size = len(data); entry.mode = mode
        archive.addfile(entry, io.BytesIO(data))
    for path, target in links.items():
        entry = tarfile.TarInfo(path); entry.type = tarfile.SYMTYPE; entry.linkname = target
        archive.addfile(entry)
proc.stdin.close()
assert proc.wait() == 0
(ROOT / 'validation/atlas-build-20260924/dependency-source-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps({'packages': sorted(selected), 'fileCount': len(files), 'bytes': sum(len(data) for data, _ in files.values()), 'nativeFiles': 0}))
