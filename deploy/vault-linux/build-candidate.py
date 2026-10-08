#!/usr/bin/python3
"""Rehearse a hashed unsigned source candidate on Linux x64.

This creates an unsigned, uncommitted-candidate artifact. It cannot be signed by
the ordinary release command or substituted for a reviewed clean-commit release.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import sys
sys.dont_write_bytecode = True
import appliance as a

def module(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result

def build(source, output, archive):
    a.need(platform.system() == 'Linux' and platform.machine() == 'x86_64', 'Linux x86_64 rehearsal required')
    source, output, archive = Path(source).resolve(), Path(output).resolve(), Path(archive).resolve()
    candidate = module('candidate_bundle', 'candidate-bundle.py')
    dependencies = module('runtime_dependencies', 'runtime-dependencies.py')
    verified = candidate.verify_bundle(source)
    source_manifest = json.loads((source / candidate.MANIFEST).read_text())
    manifest_sha = a.sha(source / candidate.MANIFEST)
    a.need(not output.exists() and source not in output.parents, 'Output must be new and outside source')
    a.need(a.sha(archive) == a.PIN['nodeArchiveSha256'], 'Pinned Node archive mismatch')
    output.mkdir(parents=True, mode=0o700)
    # Persist candidate identity before copying even one executable. A failed
    # rehearsal must never leave an apparently signable partial release.
    evidence = {'schemaVersion': 1, 'sourceState': 'UNCOMMITTED_CANDIDATE', 'baseCommit': source_manifest['baseCommit'],
                'candidateManifestSha256': manifest_sha, 'releaseAuthorized': False, 'buildCompleted': False}
    with (output / 'source-build.json').open('x') as marker:
        marker.write(json.dumps(evidence) + '\n'); marker.flush(); os.fsync(marker.fileno())
    directory_fd = os.open(output, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(directory_fd)
    finally: os.close(directory_fd)
    runtime = output / 'runtime/bin'; runtime.mkdir(parents=True)
    with tarfile.open(archive, 'r:xz') as bundle:
        member = bundle.getmember('node-v' + a.PIN['nodeVersion'] + '-linux-x64/bin/node')
        a.need(member.isfile(), 'Pinned runtime is not a regular file')
        with (runtime / 'node').open('xb') as out: shutil.copyfileobj(bundle.extractfile(member), out)
    (runtime / 'node').chmod(0o755)
    env = {**os.environ, 'PATH': str(runtime) + ':' + os.environ.get('PATH', ''), 'npm_config_build_from_source': 'true', 'CI': 'true', 'VAULT_NODE_TEST_CONCURRENCY': '1'}
    a.need(subprocess.check_output(['pnpm', '--version'], env=env, text=True).strip() == a.PIN['pnpmVersion'], 'Pinned pnpm required')
    def run(argv, overrides=None): subprocess.run(argv, cwd=source, env={**env, **(overrides or {})}, check=True)
    run(['pnpm', '--filter', '@tenkings/vault-machine...', '--filter', '@tenkings/vault-kiosk...', 'install', '--frozen-lockfile'])
    # Initial verification excludes node_modules. Installation uses the locked
    # Linux dependency graph, including any matching pnpm build cache. The final
    # probe verifies the assembled native module against the pinned runtime.
    for package in ['@tenkings/vault-contracts', '@tenkings/vault-machine', '@tenkings/vault-kiosk']:
        run(['pnpm', '--filter', package, 'build'])
    run(['pnpm', '--filter', '@tenkings/vault-contracts', 'test'])
    run(['pnpm', '--filter', '@tenkings/vault-machine', 'test'])
    run(['pnpm', '--filter', '@tenkings/vault-kiosk', 'run', 'test', '--pool=forks', '--maxWorkers=1', '--minWorkers=1'], {'NODE_OPTIONS': '--max-old-space-size=512'})
    run(['python3', '-m', 'unittest', 'discover', '-s', 'deploy/vault-linux/tests'])
    # Reject any source mutation by lifecycle scripts or tools after compilation.
    candidate.verify_bundle(source, allow_build_output=True)
    for package in ['vault-machine', 'vault-contracts']:
        target = output / 'packages' / package; target.mkdir(parents=True)
        shutil.copy2(source / 'packages' / package / 'package.json', target / 'package.json')
        shutil.copytree(source / 'packages' / package / 'dist', target / 'dist')
        dependencies.copy_dependencies(source / 'packages' / package, target)
    shutil.copytree(source / 'packages/vault-machine/scripts', output / 'packages/vault-machine/scripts', ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copytree(source / 'frontend/vault-kiosk/dist', output / 'frontend/vault-kiosk/dist')
    shutil.copytree(source / 'deploy/vault-linux', output / 'deploy/vault-linux', ignore=shutil.ignore_patterns('__pycache__'))
    for file in output.rglob('*'):
        if file.is_dir(): file.chmod(0o755)
        elif file.is_file(): file.chmod(0o755 if file.name in ['node', 'kiosk-session.sh'] else 0o644)
    probe = json.loads(subprocess.check_output([str(runtime / 'node'), str(output / 'deploy/vault-linux/probe.cjs'), str(output)], text=True))
    evidence = {'schemaVersion': 1, 'sourceState': 'UNCOMMITTED_CANDIDATE', 'baseCommit': source_manifest['baseCommit'],
                'candidateManifestSha256': manifest_sha, 'nodeArchiveSha256': a.PIN['nodeArchiveSha256'], 'pnpmVersion': a.PIN['pnpmVersion'],
                'lockfileSha256': a.sha(source / 'pnpm-lock.yaml'), 'nativeBuild': 'linux-x64', 'releaseAuthorized': False, 'buildCompleted': True, 'nativeProbe': probe}
    (output / 'native-runtime-evidence.json').write_text(json.dumps(probe) + '\n')
    (output / 'source-build.json').write_text(json.dumps(evidence) + '\n')
    print(json.dumps({'unsignedCandidate': str(output), 'sourceFileCount': verified['files'], **evidence}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True); parser.add_argument('--output', required=True); parser.add_argument('--node-archive', required=True)
    args = parser.parse_args()
    try: build(args.source, args.output, args.node_archive)
    except Exception as error: raise SystemExit(str(error) if isinstance(error, ValueError) else 'Unsigned candidate rehearsal failed; retain partial output and logs')
