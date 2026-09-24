#!/usr/bin/env python3
"""Run final frontend checks in the already owned offline build fixture."""
import hashlib
import json
import pathlib
import subprocess
import sys
import time

folder = pathlib.Path(__file__).resolve().parent
container = sys.argv[1]
fixture = json.loads((folder / 'fixture.json').read_text())
info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
assert info['Id'] == container == fixture['id']
assert info['Image'] == fixture['image']
assert info['Config']['Labels']['atlas.validation.nonce'] == fixture['nonce']
assert info['HostConfig']['ReadonlyRootfs'] and info['HostConfig']['NetworkMode'] == 'none'
assert not info['HostConfig']['Binds']
manifest_bytes = (folder / 'source-manifest.json').read_bytes()
manifest = json.loads(manifest_bytes)
selected_staff = {'page-access', 'customer-operations', 'batch-finishing', 'connected-manual-runtime', 'routes', 'access', 'staff-unavailable'}
tests = sorted(item['path'] for item in manifest['files'] if item['path'].endswith('.test.mjs') and (
    item['path'].startswith(('frontend/atlas-customer/test/', 'frontend/atlas-public/test/')) or
    (item['path'].startswith('frontend/atlas-app/test/') and pathlib.Path(item['path']).name.removesuffix('.test.mjs') in selected_staff)))
command = ['docker', 'exec', '--workdir', '/build', '--env', 'NODE_OPTIONS=--max-old-space-size=2048', container, 'node', '--test', '--test-concurrency=2', *tests]
started = time.time()
with (folder / 'frontend-tests.log').open('w') as log:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    context = 0
    for line in process.stdout:
        log.write(line)
        log.flush()
        if line.startswith('not ok'):
            context = 20
        if context or line.startswith(('# tests ', '# pass ', '# fail ', '# cancelled ', '# skipped ', '# duration_ms ')):
            print(line, end='', flush=True)
            context = max(0, context - 1)
    code = process.wait()
result = {'container': container, 'testFileCount': len(tests), 'tests': tests, 'sourceManifestSha256': hashlib.sha256(manifest_bytes).hexdigest(), 'exitCode': code, 'durationSeconds': round(time.time() - started, 2)}
(folder / 'frontend-result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
sys.exit(code)
