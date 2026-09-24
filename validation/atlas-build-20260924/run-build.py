#!/usr/bin/env python3
"""Run an app's unchanged production-build command in the owned fixture."""
import json
import pathlib
import subprocess
import sys
import time

folder = pathlib.Path(__file__).resolve().parent
container, name = sys.argv[1:]
assert name in ['customer', 'public', 'staff']
app = {'customer':'atlas-customer', 'public':'atlas-public', 'staff':'atlas-app'}[name]
info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
assert info['Id'] == container
assert info['Config']['Labels']['atlas.validation.nonce'] == '7e8bf109-13ad-4c69-88d5-68b7bca2f931'
assert info['HostConfig']['ReadonlyRootfs'] and info['HostConfig']['NetworkMode'] == 'none'
command = ['docker', 'exec', '--workdir', '/build/frontend/'+app,
           '--env', 'PATH=/tmp/bin:/opt/atlas-python/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
           '--env', 'NODE_OPTIONS=--max-old-space-size=2048', container,
           'node', '/tmp/pnpm/bin/pnpm.cjs', 'run', 'build']
started = time.time()
with (folder / (name+'-build.log')).open('w') as log:
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in proc.stdout:
        log.write(line); log.flush(); print(line, end='', flush=True)
    code = proc.wait()
result = {'app':name, 'container':container, 'command':command, 'exitCode':code, 'durationSeconds':round(time.time()-started,2)}
(folder/(name+'-result.json')).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
sys.exit(code)
