#!/usr/bin/env python3
"""Create or inspect an offline Ed25519 key pair. Never prints private material.

Keys stay outside the repository and appliance. Creating a key establishes no
Nayax, hardware or production acceptance; trust installation is a separate step.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess


def need(value, message):
    if not value:
        raise ValueError(message)


def trusted_parent(path):
    path = Path(os.path.abspath(path))
    for parent in [path, *path.parents]:
        info = parent.lstat()
        need(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode), 'Key ancestors must be real directories')
        need(info.st_uid in [0, os.geteuid()], 'Key ancestor has another owner')
        sticky_root = info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)
        need(not info.st_mode & 0o022 or sticky_root, 'Key ancestor is writable by another account')
    return path


def command(argv):
    return subprocess.check_output(argv, stderr=subprocess.PIPE, timeout=30)


def inspect(directory):
    directory = trusted_parent(directory)
    need(not (directory / 'initialization.pending').exists(), 'Key initialization is incomplete')
    need(not directory.stat().st_mode & 0o077, 'Key directory must be owner-only')
    for name in ['private.pem', 'public.pem', 'key.json']:
        info = (directory / name).lstat()
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1,
             'Key material must be an owner-held regular file')
        need(not info.st_mode & 0o077, 'Key files must be owner-only')
    derived = command(['openssl', 'pkey', '-in', str(directory / 'private.pem'), '-pubout', '-outform', 'DER'])
    public = command(['openssl', 'pkey', '-pubin', '-in', str(directory / 'public.pem'), '-outform', 'DER'])
    need(public == derived and public.startswith(bytes.fromhex('302a300506032b6570032100')) and len(public) == 44,
         'Matching Ed25519 keys required')
    metadata = json.loads((directory / 'key.json').read_text())
    fingerprint = hashlib.sha256(public).hexdigest()
    need(metadata.get('schemaVersion') == 1 and metadata.get('purpose') in ['RELEASE_SIGNING', 'SPARK_ACTIVATION']
         and metadata.get('productionAcceptanceGranted') is False
         and metadata.get('publicKeySha256') == fingerprint and metadata.get('algorithm') == 'Ed25519', 'Key metadata mismatch')
    return {'verified': True, 'purpose': metadata['purpose'], 'publicKeySha256': fingerprint,
            'publicKeyPath': str(directory / 'public.pem'), 'privateKeyPrinted': False,
            'productionAcceptanceGranted': False}


def initialize(directory, purpose, apply=False):
    directory = Path(os.path.abspath(directory))
    trusted_parent(directory.parent)
    need(not directory.exists() and not directory.is_symlink(), 'Key creation is create-only')
    need(purpose in ['RELEASE_SIGNING', 'SPARK_ACTIVATION'], 'Unknown key purpose')
    if not apply:
        return {'plan': 'CREATE_OFFLINE_ED25519_KEY', 'directory': str(directory), 'purpose': purpose, 'applied': False}
    directory.mkdir(mode=0o700)
    marker = directory / 'initialization.pending'
    with marker.open('x') as file:
        file.write('Retain for diagnosis if initialization fails.\n'); file.flush(); os.fsync(file.fileno())
    previous = os.umask(0o077)
    try:
        command(['openssl', 'genpkey', '-algorithm', 'Ed25519', '-out', str(directory / 'private.pem')])
        command(['openssl', 'pkey', '-in', str(directory / 'private.pem'), '-pubout', '-out', str(directory / 'public.pem')])
        public = command(['openssl', 'pkey', '-pubin', '-in', str(directory / 'public.pem'), '-outform', 'DER'])
        metadata = {'schemaVersion': 1, 'algorithm': 'Ed25519', 'purpose': purpose,
                    'publicKeySha256': hashlib.sha256(public).hexdigest(), 'productionAcceptanceGranted': False}
        with (directory / 'key.json').open('x') as file:
            file.write(json.dumps(metadata, indent=2) + '\n'); file.flush(); os.fsync(file.fileno())
        for name in ['private.pem', 'public.pem']:
            (directory / name).chmod(0o600)
            with (directory / name).open('rb') as file: os.fsync(file.fileno())
        marker.unlink()
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        os.umask(previous)
    return inspect(directory)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['initialize', 'inspect'])
    parser.add_argument('--directory', required=True)
    parser.add_argument('--purpose', choices=['RELEASE_SIGNING', 'SPARK_ACTIVATION'])
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        result = inspect(args.directory) if args.command == 'inspect' else initialize(args.directory, args.purpose, args.apply)
        print(json.dumps(result))
    except Exception:
        raise SystemExit('Offline key operation failed; verify protected paths, key ownership and initialization status')
