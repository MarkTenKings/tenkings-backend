#!/usr/bin/python3
"""Boot one owned Arch VM on a GitHub Linux x64 runner; export synthetic receipts.

Only public, hash-pinned release inputs enter the guest. Repository tokens,
signing keys, host mounts, provider configuration and serial devices do not.
"""
import sys
sys.dont_write_bytecode = True
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shlex
import shutil
import signal
import socket
import stat
import subprocess
import tarfile
import time
import urllib.request
import uuid

ACK = 'SYNTHETIC_ONLY_DISPOSABLE_VM'
RELEASE_ID = 'ten-kings-vault-20261008-5f759355'
SOURCE = '5f75935590508cc0f7f3e75083dcb63847ccce04'
IMAGE = 'Arch-Linux-x86_64-cloudimg-20261001.604814.qcow2'
IMAGE_URL = 'https://geo.mirror.pkgbuild.com/images/v20261001.604814/' + IMAGE
IMAGE_SHA = '360f0fa49db6813bdc8e35bed230a2dc2ae3567b7b5ab74719c0a706e4e34e87'
IMAGE_BYTES = 578080256
AUTHORITY_IMAGE = 'python@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a'
INPUTS = {
    RELEASE_ID + '.tar.gz': '54c150d31c49f6525a36ac2bcc75af8614edf4317daf05458eabdde4c404dc7e',
    'release-public.pem': '2026d905de987d8d5661d4f49ffcfd23fb07595a40c72391d02a42981eec66dd',
    'lifecycle-update-metadata-5f759355.tar.gz': 'c6c1f0cf8d5993b3cae048029d93f1ef562b6278e8226e189b06c0d53256e843',
}
RECEIPTS = ('started', 'install-plan', 'install-result', 'preflight', 'initial-start', 'canary-staged',
            'restart-plan', 'restart-result', 'restart-health', 'restart-snapshot', 'update-plan',
            'update-result', 'update-health', 'update-snapshot', 'held-restore', 'awaiting-reboot', 'completed')
ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}


def need(condition, message):
    if not condition: raise ValueError(message)


def run(argv, *, timeout=240, check=True, **kwargs):
    result = subprocess.run([str(value) for value in argv], env=ENV, capture_output=True,
                            text=True, timeout=timeout, **kwargs)
    if check: need(result.returncode == 0, 'Command failed: ' + str(argv[0]))
    return result


def digest(path):
    need(stat.S_ISREG(path.lstat().st_mode), 'Regular non-symlink input required')
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): value.update(block)
    return value.hexdigest()


def extract(archive, destination, prefix):
    """Never trust archive paths, special members or links, even with a pinned hash."""
    destination.mkdir(mode=0o700)
    with tarfile.open(archive, 'r:gz') as stream:
        members = stream.getmembers(); total = 0; seen = set()
        need(len(members) <= 10000, 'Archive membership limit exceeded')
        for member in members:
            path = PurePosixPath(member.name)
            need(not path.is_absolute() and '..' not in path.parts and path.parts
                 and path.parts[0] == prefix and member.name not in seen,
                 'Unsafe or duplicate archive member')
            seen.add(member.name)
            need(member.isdir() or member.isfile(), 'Archive links/devices are forbidden')
            need(not member.mode & 0o7022, 'Archive privileged/writable mode forbidden')
            total += member.size
            need(total <= 512 * 1024**2, 'Archive expanded size exceeds limit')
        for member in members:
            target = destination / member.name
            if member.isdir(): target.mkdir(parents=True, exist_ok=True, mode=0o755)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                with target.open('xb') as output, stream.extractfile(member) as source:
                    shutil.copyfileobj(source, output)
                target.chmod(member.mode & 0o777)
        # These verified archives contain public release inputs. Explicitly set
        # traversal modes: the caller's private umask must not turn 0755 into
        # runner-owned 0700 directories unreadable by a capability-free container.
        for target in destination.rglob('*'):
            if target.is_dir(): target.chmod(0o755)


def save(evidence, name, value):
    with (evidence / (name + '.json')).open('x') as stream:
        json.dump({'classification': 'SYNTHETIC_ONLY', **value}, stream, indent=2); stream.write('\n')


def public_envelope_modes(release):
    # The verified public signature envelope is excluded from payload mode
    # inventory. Match appliance.stage without changing any signed file mode.
    for name in ('release.json', 'release.sig'):
        (release / name).chmod(0o644)


def download_image(path):
    request = urllib.request.Request(IMAGE_URL, headers={'User-Agent': 'Vault-disposable-VM-rehearsal'})
    with urllib.request.urlopen(request, timeout=60) as response, path.open('xb') as output:
        size = 0
        while True:
            block = response.read(1024 * 1024)
            if not block: break
            size += len(block); need(size <= IMAGE_BYTES, 'Arch image exceeds pinned size')
            output.write(block)
    need(size == IMAGE_BYTES and digest(path) == IMAGE_SHA, 'Arch image hash/size mismatch')


def prepare_inputs(inputs, work, source):
    for name, expected in INPUTS.items(): need(digest(inputs / name) == expected, 'Signed input hash mismatch: ' + name)
    staged = work / 'staged'; staged.mkdir(mode=0o700)
    extract(inputs / (RELEASE_ID + '.tar.gz'), work / 'release-unpacked', RELEASE_ID)
    extract(inputs / 'lifecycle-update-metadata-5f759355.tar.gz', work / 'metadata-unpacked', 'lifecycle-update-metadata')
    shutil.move(str(work / 'release-unpacked' / RELEASE_ID), staged / RELEASE_ID)
    shutil.move(str(work / 'metadata-unpacked/lifecycle-update-metadata'), staged / 'lifecycle-update-metadata')
    shutil.copyfile(inputs / 'release-public.pem', staged / 'release-public.pem')
    (staged / 'release-public.pem').chmod(0o644)
    release = staged / RELEASE_ID; key = staged / 'release-public.pem'
    result = json.loads(run(['python3', '-B', source / 'appliance.py', 'verify', '--release', release, '--public-key', key]).stdout)
    need(result['sourceCommit'] == SOURCE and result['releaseId'] == RELEASE_ID, 'Signed application identity differs')
    original = json.loads((release / 'release.json').read_text())
    metadata = staged / 'lifecycle-update-metadata'
    replacement = json.loads((metadata / 'release.json').read_text())
    need(replacement['releaseId'] == RELEASE_ID + '-rehearsal'
         and {k: v for k, v in original.items() if k != 'releaseId'} ==
             {k: v for k, v in replacement.items() if k != 'releaseId'}, 'Rehearsal metadata changes payload')
    run(['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', key, '-rawin',
         '-in', metadata / 'release.json', '-sigfile', metadata / 'release.sig'])
    public_envelope_modes(release)
    public_envelope_modes(metadata)
    tooling = staged / 'tooling'; (tooling / 'tests').mkdir(parents=True)
    for name in ('appliance.py', 'runtime.json', 'tests/installed-service-rehearsal.py'):
        shutil.copyfile(source / name, tooling / name)
    bundle = work / 'public-inputs.tar.gz'
    with tarfile.open(bundle, 'w:gz') as stream:
        for child in sorted(staged.iterdir()): stream.add(child, arcname=child.name, recursive=True)
    return bundle


def authority_report_valid(report, manifest_digest):
    checks = report.get('checks', [])
    return (report.get('classification') == 'SYNTHETIC_ONLY' and report.get('passed') is True
            and report.get('sourceCommit') == SOURCE and report.get('releaseManifestSha256') == manifest_digest
            and len(checks) == 34 and len({check.get('name') for check in checks}) == 34
            and all(check.get('result') == 'PASS' for check in checks)
            and report.get('nodeVersion') == '22.23.2' and report.get('platform') == 'linux'
            and report.get('architecture') == 'x64' and report.get('providerNetworkAttempts') == 0
            and all(report.get(key) is False for key in ('externalAcceptance', 'installedProductionActivation',
                                                       'serialComposed', 'syntheticPrivateKeysWritten'))
            and all(report.get(key) is True for key in ('sourceReleaseMountedReadOnly', 'sourceManifestUnchanged',
                                                      'containerTrustCleaned', 'containerReleaseCopyCleaned')))


def production_authority(work, source, evidence):
    """Run actual packaged factory checks in an owned network-none container."""
    release = work / 'staged' / RELEASE_ID
    public_key = work / 'staged/release-public.pem'
    script = source / 'tests/production-authority-linux.cjs'
    token = uuid.uuid4().hex; name = 'vault-authority-' + token
    label = 'tenkings.synthetic-authority-owner'; removed = False
    output = work / 'production-authority.json'; error = None
    run(['docker', 'pull', '--platform', 'linux/amd64', AUTHORITY_IMAGE], timeout=240)
    try:
        run(['docker', 'create', '--name', name, '--label', label + '=' + token,
             '--platform', 'linux/amd64', '--network', 'none', '--cpus', '2', '--memory', '2g', '--pids-limit', '128',
             '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
             '--mount', 'type=bind,src=' + str(release) + ',dst=/input/release,readonly',
             '--mount', 'type=bind,src=' + str(public_key) + ',dst=/input/release-public.pem,readonly',
             '--mount', 'type=bind,src=' + str(script) + ',dst=/source/production-authority-linux.cjs,readonly',
             '--env', 'VAULT_DISPOSABLE_REHEARSAL=1', '--env', 'VAULT_PRODUCTION_AUTHORITY_SYNTHETIC=1',
             '--entrypoint', '/input/release/runtime/bin/node', AUTHORITY_IMAGE,
             '/source/production-authority-linux.cjs', '--release', '/input/release',
             '--release-public-key', '/input/release-public.pem', '--output', '/tmp/production-authority.json',
             '--ack-synthetic-container'], timeout=30)
        result = run(['docker', 'start', '--attach', name], timeout=720, check=False)
        refusal = re.search(r'SYNTHETIC_ONLY validation refused: ([A-Z][A-Z0-9_]{1,100})', result.stderr)
        safe_code = refusal.group(1) if refusal else 'CONTAINER_PERMISSION_DENIED' if 'permission denied' in result.stderr.lower() else 'CONTAINER_PROCESS_FAILED' if result.returncode else None
        save(evidence, 'host-authority-execution', {'exitCode': result.returncode, 'refusalCode': safe_code})
        copied = run(['docker', 'cp', name + ':/tmp/production-authority.json', output], timeout=30, check=False)
        need(copied.returncode == 0, 'Packaged authority report missing')
        need(output.stat().st_size <= 1024 * 1024, 'Packaged authority report exceeds bound')
        report = json.loads(output.read_text())
        need(report.get('classification') == 'SYNTHETIC_ONLY', 'Unexpected authority report classification')
        save(evidence, 'production-authority', report)
        need(result.returncode == 0 and authority_report_valid(report, digest(release / 'release.json')),
             'Packaged production authority checks failed; no VM qualification')
    except Exception as failure:
        error = failure
    finally:
        # A create timeout can leave a container behind. Resolve only this random
        # name, then require our unpredictable ownership label before removal.
        found = run(['docker', 'inspect', name], timeout=30, check=False)
        if found.returncode == 0:
            info = json.loads(found.stdout)
            need(len(info) == 1 and info[0].get('Config', {}).get('Labels', {}).get(label) == token,
                 'Refuse cleanup of a container without this invocation ownership label')
            run(['docker', 'rm', '--force', info[0]['Id']], timeout=30)
        absent = run(['docker', 'ps', '--all', '--quiet', '--filter', 'name=^/' + name + '$'], timeout=30, check=False)
        removed = absent.returncode == 0 and not absent.stdout.strip()
        save(evidence, 'host-authority-container', {'image': AUTHORITY_IMAGE, 'network': 'none',
             'readOnlyInputMounts': True, 'hostTrustOrInstallMounted': False,
             'ownedContainerRemoved': removed, 'passed': error is None and removed})
    need(removed, 'Owned authority container cleanup unconfirmed')
    if error: raise error


def cloud_seed(work):
    for name in ('user-key', 'host-key'): run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', work / name])
    config = {
        'users': [{'name': 'rehearsal', 'groups': ['wheel'], 'shell': '/bin/bash', 'lock_passwd': True,
                   'sudo': ['ALL=(ALL) NOPASSWD:ALL'], 'ssh_authorized_keys': [(work / 'user-key.pub').read_text().strip()]}],
        'disable_root': True, 'ssh_pwauth': False, 'ssh_deletekeys': True,
        'ssh_keys': {'ed25519_private': (work / 'host-key').read_text(), 'ed25519_public': (work / 'host-key.pub').read_text()},
        'package_update': False, 'package_upgrade': False,
        'growpart': {'mode': 'auto', 'devices': ['/']}, 'resize_rootfs': True,
        # The offline guest cannot reach NTP. Arch otherwise holds pacman-init,
        # sshd and cloud-final behind time-sync.target. QEMU supplies host UTC;
        # validate it explicitly below, without changing appliance clock guards.
        'bootcmd': [['systemctl', 'mask', '--now', 'systemd-time-wait-sync.service']],
    }
    (work / 'user-data').write_text('#cloud-config\n' + json.dumps(config))
    (work / 'meta-data').write_text(json.dumps({'instance-id': 'vault-' + str(uuid.uuid4()), 'local-hostname': 'vault-synthetic-rehearsal'}))
    run(['cloud-localds', work / 'seed.img', work / 'user-data', work / 'meta-data'])


def wait_guest(ssh, qemu, *, previous_boot=None, timeout=480):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        need(qemu.poll() is None, 'QEMU exited before guest readiness')
        result = run([*ssh, 'cat /proc/sys/kernel/random/boot_id'], check=False, timeout=15)
        value = result.stdout.strip()
        if result.returncode == 0 and len(value) == 36 and value != previous_boot: return value
        time.sleep(2)
    raise ValueError('Guest SSH/boot readiness timed out')


def collect(ssh, evidence):
    for name in RECEIPTS:
        target = evidence / (name + '.json')
        if target.exists(): continue
        result = run([*ssh, 'sudo cat /var/lib/vault-lifecycle-rehearsal/evidence/' + name + '.json'], check=False, timeout=15)
        if result.returncode: continue
        need(len(result.stdout) <= 1024 * 1024, 'Receipt exceeds bound')
        value = json.loads(result.stdout)
        need(value.get('classification') == 'SYNTHETIC_ONLY', 'Unexpected receipt classification')
        save(evidence, name, value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--acknowledge', required=True)
    for name in ('inputs', 'work', 'evidence'): parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args(); os.umask(0o077)
    need(args.acknowledge == ACK and os.environ.get('GITHUB_ACTIONS') == 'true'
         and platform.system() == 'Linux' and platform.machine() == 'x86_64', 'Explicit GitHub Linux x64 rehearsal required')
    runner_temp = Path(os.environ['RUNNER_TEMP']).resolve()
    workspace = Path(os.environ['GITHUB_WORKSPACE']).resolve()
    need(args.work.parent.resolve() == runner_temp and args.inputs.resolve().parent == runner_temp,
         'Task inputs/work must be direct children of this runner temporary directory')
    need(args.evidence.absolute() == workspace / 'outputs/vault-installed-service-ci', 'Fixed evidence destination required')
    need(not args.work.exists() and not args.work.is_symlink() and not args.evidence.exists() and not args.evidence.is_symlink(), 'Create-only task directories required')
    need(shutil.disk_usage(runner_temp).free >= 5 * 1024**3, 'At least 5 GiB free runner disk required')
    args.work.mkdir(mode=0o700); args.evidence.mkdir(parents=True, mode=0o700)
    source = workspace / 'deploy/vault-linux'
    qemu = None; ssh = None; error = None; phase = 'inputs'
    def interrupted(*_): raise InterruptedError('Workflow interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        bundle = prepare_inputs(args.inputs, args.work, source)
        save(args.evidence, 'host-inputs', {'sourceCommit': run(['git', '-C', workspace, 'rev-parse', 'HEAD']).stdout.strip(),
             'applicationSourceCommit': SOURCE, 'inputSha256': INPUTS, 'archImageUrl': IMAGE_URL,
             'archImageSha256': IMAGE_SHA, 'providerCalls': 0, 'serialDevicesAttached': False})
        phase = 'packaged-production-authority'
        production_authority(args.work, source, args.evidence)
        phase = 'image'; image = args.work / IMAGE; download_image(image)
        info = json.loads(run(['qemu-img', 'info', '--output=json', image]).stdout)
        need(info['format'] == 'qcow2' and info['virtual-size'] <= 8 * 1024**3 and not info.get('backing-filename'), 'Unexpected Arch image layout')
        overlay = args.work / 'guest.qcow2'
        run(['qemu-img', 'create', '-f', 'qcow2', '-F', 'qcow2', '-b', image, overlay, '8G'])
        cloud_seed(args.work)
        with socket.socket() as port_socket:
            port_socket.bind(('127.0.0.1', 0)); port = port_socket.getsockname()[1]
        (args.work / 'known_hosts').write_text('[127.0.0.1]:' + str(port) + ' ' + (args.work / 'host-key.pub').read_text())
        ssh_options = ['-F', '/dev/null', '-i', str(args.work / 'user-key'), '-o', 'BatchMode=yes',
                       '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
                       '-o', 'UserKnownHostsFile=' + str(args.work / 'known_hosts'), '-o', 'GlobalKnownHostsFile=/dev/null',
                       '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3']
        ssh = ['ssh', *ssh_options, '-p', str(port), 'rehearsal@127.0.0.1']
        acceleration = 'kvm' if os.access('/dev/kvm', os.R_OK | os.W_OK) else 'tcg'
        phase = 'boot'
        with (args.work / 'qemu.stderr').open('w') as stderr:
            qemu = subprocess.Popen(['qemu-system-x86_64', '-machine', 'q35', '-accel', acceleration,
                '-cpu', 'host' if acceleration == 'kvm' else 'max',
                '-rtc', 'base=utc,clock=host',
                '-smp', '2', '-m', '2048', '-display', 'none', '-monitor', 'none',
                '-serial', 'file:' + str(args.work / 'console.log'),
                '-drive', 'file=' + str(overlay) + ',format=qcow2,if=virtio',
                '-drive', 'file=' + str(args.work / 'seed.img') + ',format=raw,if=virtio,readonly=on',
                '-netdev', 'user,id=net0,restrict=on,hostfwd=tcp:127.0.0.1:' + str(port) + '-:22',
                '-device', 'virtio-net-pci,netdev=net0'], env=ENV, stdout=subprocess.DEVNULL, stderr=stderr)
        boot = wait_guest(ssh, qemu)
        run([*ssh, 'sudo cloud-init status --wait'], timeout=300)
        clock_start = time.time()
        guest_utc = int(run([*ssh, 'date -u +%s']).stdout.strip())
        clock_end = time.time()
        need(clock_start - 30 <= guest_utc <= clock_end + 30, 'Guest UTC differs from hosted runner clock')
        host_id = run([*ssh, 'cat /etc/machine-id']).stdout.strip()
        need(len(host_id) == 32 and all(c in '0123456789abcdef' for c in host_id), 'Guest machine ID invalid')
        save(args.evidence, 'host-guest', {'accelerator': acceleration, 'bootId': boot, 'guestMachineId': host_id,
             'network': 'QEMU restrict=on; loopback SSH forward only', 'virtualDiskBytes': 8 * 1024**3,
             'offlineFixtureTimeWaitMasked': True, 'rtc': 'host UTC', 'guestUtcEpoch': guest_utc,
             'clockComparedToHostedRunner': True, 'providerClockQualification': False,
             'qemuVersion': run(['qemu-system-x86_64', '--version']).stdout.splitlines()[0]})
        phase = 'copy-inputs'
        run(['scp', *ssh_options, '-P', str(port), bundle, 'rehearsal@127.0.0.1:/home/rehearsal/public-inputs.tar.gz'])
        run([*ssh, 'sudo mkdir -m 0755 /opt/vault-rehearsal-input && sudo tar --no-same-owner -xzf /home/rehearsal/public-inputs.tar.gz -C /opt/vault-rehearsal-input'])
        doctor = run([*ssh, 'sudo python3 -B /opt/vault-rehearsal-input/tooling/appliance.py doctor'])
        save(args.evidence, 'host-doctor', json.loads(doctor.stdout))
        runner = '/opt/vault-rehearsal-input/tooling/tests/installed-service-rehearsal.py'
        common = ['sudo', 'python3', '-B', runner]
        options = ['--acknowledge', ACK, '--disposable-machine-id', host_id]
        phase = 'prepare'
        prepare = run([*ssh, shlex.join([*common, 'prepare', *options,
            '--release', '/opt/vault-rehearsal-input/' + RELEASE_ID,
            '--public-key', '/opt/vault-rehearsal-input/release-public.pem',
            '--update-metadata', '/opt/vault-rehearsal-input/lifecycle-update-metadata'])], timeout=900, check=False)
        save(args.evidence, 'host-prepare', {'exitCode': prepare.returncode, 'stdout': prepare.stdout, 'stderr': prepare.stderr})
        collect(ssh, args.evidence)
        need(prepare.returncode == 0 and (args.evidence / 'awaiting-reboot.json').exists(), 'Prepare phase failed; no lifecycle acceptance')
        phase = 'explicit-guest-reboot'
        reboot = run([*ssh, 'sudo systemctl reboot'], check=False)
        need(reboot.returncode in (0, 255), 'Disposable guest reboot refused')
        next_boot = wait_guest(ssh, qemu, previous_boot=boot)
        phase = 'after-reboot'
        resumed = run([*ssh, shlex.join([*common, 'after-reboot', *options])], timeout=300, check=False)
        save(args.evidence, 'host-after-reboot', {'exitCode': resumed.returncode, 'stdout': resumed.stdout,
             'stderr': resumed.stderr, 'beforeBootId': boot, 'afterBootId': next_boot})
        collect(ssh, args.evidence)
        need(resumed.returncode == 0 and (args.evidence / 'completed.json').exists(), 'Post-reboot phase failed; no lifecycle acceptance')
        phase = 'complete'
    except Exception as failure:
        error = failure
        if ssh and qemu and qemu.poll() is None:
            try: collect(ssh, args.evidence)
            except Exception: pass
    finally:
        if qemu and qemu.poll() is None:
            qemu.terminate()
            try: qemu.wait(timeout=30)
            except subprocess.TimeoutExpired: qemu.kill(); qemu.wait(timeout=10)
        try:
            save(args.evidence, 'host-result', {'phase': phase, 'success': error is None,
                 'error': str(error) if isinstance(error, ValueError) else type(error).__name__ if error else None,
                 'guestStopped': qemu is None or qemu.poll() is not None, 'cabinetAcceptance': False,
                 'providerAcceptance': False, 'productionActivation': False})
        finally:
            # Exclusively created by this invocation; includes all ephemeral keys/seed/state.
            shutil.rmtree(args.work)
    if error: raise ValueError('Synthetic VM rehearsal failed in phase ' + phase)
    print('SYNTHETIC_ONLY installed Arch lifecycle and reboot passed; receipts retained, guest removed.')


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'VM rehearsal failed; inspect synthetic receipts', file=sys.stderr)
        sys.exit(1)
