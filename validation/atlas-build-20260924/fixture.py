#!/usr/bin/env python3
"""Lifecycle for this one isolated build fixture; no host mounts or cleanup."""
import json
import pathlib
import subprocess
import sys

folder = pathlib.Path(__file__).resolve().parent
image = 'sha256:315bae6df16bf090faa0c1d23682eb88fb113b79dc793f61680da5a1b5e10bcc'
nonce = '7e8bf109-13ad-4c69-88d5-68b7bca2f931'
name = 'atlas-build-20260924-customer-intake-7e8bf109'
if sys.argv[1] == 'create':
    command = ['docker', 'run', '-d', '--pull=never', '--platform=linux/amd64', '--name', name,
               '--label', 'atlas.validation.owner=customer-intake', '--label', 'atlas.validation.nonce='+nonce,
               '--network=none', '--read-only', '--memory=5g', '--memory-swap=5g', '--cpus=4', '--pids-limit=256',
               '--tmpfs', '/build:rw,exec,nosuid,nodev,size=3g,uid=1000,gid=1000',
               '--tmpfs', '/tmp:rw,exec,nosuid,nodev,size=512m,uid=1000,gid=1000',
               '--env', 'NEXT_TELEMETRY_DISABLED=1', '--env', 'CI=1', '--env', 'HOME=/tmp',
               '--entrypoint', '/bin/sh', image, '-c', 'exec sleep 21600']
    container = subprocess.check_output(command).decode().strip()
    info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
    (folder/'fixture.json').write_text(json.dumps({'id':container,'image':image,'nonce':nonce,'command':command,'hostConfig':info['HostConfig']},indent=2)+'\n')
    print(container)
elif sys.argv[1] == 'remove':
    container = sys.argv[2]
    assert len(container) == 64 and all(c in '0123456789abcdef' for c in container)
    info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
    assert info['Id'] == container and info['Image'] == image and info['Name'] == '/'+name
    assert info['Config']['Labels']['atlas.validation.nonce'] == nonce
    assert info['Config']['Labels']['atlas.validation.owner'] == 'customer-intake'
    assert info['HostConfig']['ReadonlyRootfs'] and info['HostConfig']['NetworkMode'] == 'none'
    assert not info['HostConfig']['Binds']
    subprocess.run(['docker','rm','-f',container],check=True)
else:
    raise ValueError('Expected create or remove <captured full container ID>')
