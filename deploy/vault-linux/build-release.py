#!/usr/bin/python3
"""Build on Linux x86_64 using a verified exact Node archive and pnpm lockfile.

Outputs a create-only unsigned directory; signing is a separate reviewed action.
No downloaded installer is executed and no existing machine state is accessed.
"""
import argparse
import importlib.util
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path
sys.dont_write_bytecode = True
from appliance import PIN, need, sha
dependency_spec = importlib.util.spec_from_file_location('runtime_dependencies', Path(__file__).with_name('runtime-dependencies.py'))
runtime_dependencies = importlib.util.module_from_spec(dependency_spec)
dependency_spec.loader.exec_module(runtime_dependencies)

def build(args):
    need(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'Build native SQLite on Linux x86_64, never copy Mac/Windows node_modules')
    source = Path(args.source).resolve(); output = Path(args.output).resolve(); archive = Path(args.node_archive).resolve()
    need(not output.exists() and source not in output.parents, 'Output must be new and outside source')
    need(sha(archive) == PIN['nodeArchiveSha256'], 'Official Node archive SHA-256 mismatch')
    status = subprocess.check_output(['git', 'status', '--porcelain'], cwd=source, text=True)
    need(not status.strip(), 'Release source must be clean, reviewed and committed; do not fabricate a commit identity for dirty work')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    output.mkdir(parents=True, mode=0o700)
    evidence = {'schemaVersion': 1, 'sourceState': 'CLEAN_COMMITTED', 'sourceCommit': commit,
                'releaseAuthorized': False, 'buildCompleted': False}
    # An interrupted build must never be mistaken for a completed signable one.
    with (output / 'source-build.json').open('x') as marker:
        marker.write(json.dumps(evidence) + '\n'); marker.flush(); os.fsync(marker.fileno())
    directory_fd = os.open(output, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(directory_fd)
    finally: os.close(directory_fd)
    runtime = output / 'runtime/bin'; runtime.mkdir(parents=True)
    with tarfile.open(archive, 'r:xz') as bundle:
        member = bundle.getmember('node-v' + PIN['nodeVersion'] + '-linux-x64/bin/node')
        need(member.isfile(), 'Node archive executable is not a regular file')
        with (runtime / 'node').open('xb') as dest: shutil.copyfileobj(bundle.extractfile(member), dest)
    (runtime / 'node').chmod(0o755)
    env = {**os.environ, 'PATH': str(runtime) + ':' + os.environ.get('PATH', ''), 'npm_config_build_from_source': 'true',
           'CI': 'true', 'VAULT_NODE_TEST_CONCURRENCY': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
    need(subprocess.check_output(['pnpm', '--version'], env=env, text=True).strip() == PIN['pnpmVersion'], 'Pinned pnpm required')
    def run(argv, overrides=None): subprocess.run(argv, cwd=source, env={**env, **(overrides or {})}, check=True)
    run(['pnpm', '--filter', '@tenkings/vault-machine...', '--filter', '@tenkings/vault-kiosk...', 'install', '--frozen-lockfile'])
    for package in ['@tenkings/vault-contracts', '@tenkings/vault-machine', '@tenkings/vault-kiosk']:
        run(['pnpm', '--filter', package, 'build'])
    run(['pnpm', '--filter', '@tenkings/vault-contracts', 'test'])
    run(['pnpm', '--filter', '@tenkings/vault-machine', 'test'])
    run(['pnpm', '--filter', '@tenkings/vault-kiosk', 'run', 'test', '--pool=forks', '--maxWorkers=1', '--minWorkers=1'], {'NODE_OPTIONS': '--max-old-space-size=512'})
    run(['python3', '-m', 'unittest', 'discover', '-s', 'deploy/vault-linux/tests'])
    need(subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip() == commit,
         'Release source commit changed while building')
    need(not subprocess.check_output(['git', 'status', '--porcelain'], cwd=source, text=True).strip(),
         'Release source changed while building')
    for package in ['vault-machine', 'vault-contracts']:
        target = output / 'packages' / package
        target.mkdir(parents=True)
        shutil.copy2(source / 'packages' / package / 'package.json', target / 'package.json')
        shutil.copytree(source / 'packages' / package / 'dist', target / 'dist')
        # Existing code has relative sibling imports; preserve that layout.
        runtime_dependencies.copy_dependencies(source / 'packages' / package, target)
    shutil.copytree(source / 'packages/vault-machine/scripts', output / 'packages/vault-machine/scripts', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(source / 'frontend/vault-kiosk/dist', output / 'frontend/vault-kiosk/dist')
    shutil.copytree(source / 'deploy/vault-linux', output / 'deploy/vault-linux', ignore=shutil.ignore_patterns('__pycache__'))
    for file in output.rglob('*'):
        if file.is_dir(): file.chmod(0o755)
        elif file.is_file(): file.chmod(0o755 if file.name in ['node', 'kiosk-session.sh'] else 0o644)
    probe = subprocess.check_output([str(runtime / 'node'), str(output / 'deploy/vault-linux/probe.cjs'), str(output)], text=True)
    (output / 'native-runtime-evidence.json').write_text(probe)
    evidence.update({'pnpmVersion': PIN['pnpmVersion'], 'nodeArchiveSha256': PIN['nodeArchiveSha256'],
                     'lockfileSha256': sha(source / 'pnpm-lock.yaml'), 'nativeBuild': 'linux-x64',
                     'nativeProbe': json.loads(probe), 'releaseAuthorized': True, 'buildCompleted': True})
    with (output / 'source-build.json').open('w') as marker:
        marker.write(json.dumps(evidence) + '\n'); marker.flush(); os.fsync(marker.fileno())
    print(json.dumps({'unsignedRelease': str(output), 'sourceCommit': commit, 'nativeProbe': json.loads(probe)}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True); parser.add_argument('--output', required=True); parser.add_argument('--node-archive', required=True)
    try: build(parser.parse_args())
    except Exception as error: raise SystemExit(str(error) if isinstance(error, ValueError) else 'Linux release build failed; preserve output for inspection')
