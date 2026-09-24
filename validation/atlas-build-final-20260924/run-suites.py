#!/usr/bin/env python3
"""Run requested changed-package suites against the current copied source."""
import hashlib
import json
import pathlib
import subprocess
import sys
import time

folder = pathlib.Path(__file__).resolve().parent
container = sys.argv[1]
focus = sys.argv[2] if len(sys.argv) > 2 else 'all'
assert focus in ['all','commerce','native']
info = json.loads(subprocess.check_output(['docker','inspect',container]))[0]
assert info['Id'] == container
assert info['Config']['Labels']['atlas.validation.nonce'] == '80a0f43f-d5c5-4412-a505-be6807a067f8'
assert info['HostConfig']['ReadonlyRootfs'] and info['HostConfig']['NetworkMode'] == 'none'
manifest_bytes = (folder/'source-manifest.json').read_bytes()
manifest = json.loads(manifest_bytes)
packages = ['atlas-customer-intake','atlas-commerce','atlas-dealer-operations','atlas-service-bridge','atlas-connected-manual','atlas-batch-grading']
tests = sorted(item['path'] for item in manifest['files'] if item['path'].endswith('.test.mjs') and any(item['path'].startswith('packages/'+package+'/test/') for package in packages))
assert 'packages/atlas-connected-manual/test/customer-runtime.test.mjs' in tests
if focus == 'commerce':
    tests = [path for path in tests if path.startswith('packages/atlas-commerce/') or path == 'packages/atlas-connected-manual/test/customer-runtime.test.mjs']
elif focus == 'native':
    tests = ['packages/atlas-connected-manual/test/batch-review.test.mjs']
command = ['docker','exec','--workdir','/build','--env','NODE_OPTIONS=--max-old-space-size=2048']
if focus == 'native':
    command += ['--env','ATLAS_MEASUREMENT_PYTHON=/opt/atlas-python/bin/python']
command += [container,'node','--test','--test-concurrency=2']
if focus == 'native':
    command += ['--test-name-pattern=checked native CPU yields']
command += tests
prefix = 'integration' if focus == 'all' else 'integration-'+focus
print(json.dumps({'status':'STARTING_CHANGED_PACKAGE_SUITES','focus':focus,'testFiles':len(tests),'packages':packages}),flush=True)
started = time.time()
with (folder/(prefix+'-tests.log')).open('w') as log:
    proc = subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    context = 0
    for line in proc.stdout:
        log.write(line);log.flush()
        if line.startswith('not ok'):
            context = 18
        if context or line.startswith(('# tests ','# suites ','# pass ','# fail ','# cancelled ','# skipped ','# todo ','# duration_ms ')):
            print(line,end='',flush=True)
            context = max(0,context-1)
    code = proc.wait()
result = {'packages':packages,'focus':focus,'testFileCount':len(tests),'sourceManifestSha256':hashlib.sha256(manifest_bytes).hexdigest(),
          'container':container,'command':command,'exitCode':code,'durationSeconds':round(time.time()-started,2)}
(folder/(prefix+'-result.json')).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({key:value for key,value in result.items() if key != 'command'}))
sys.exit(code)
