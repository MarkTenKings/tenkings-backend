import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createRemotePostgresTransport, remoteCommand, REMOTE_POSTGRES_IMAGE } from '../scripts/remote-disposable-postgres.mjs';
import { DISPOSABLE_POSTGRES_IMAGE, disposableDockerArgs, disposablePostgres, verifyDisposableDocker } from '../scripts/disposable-postgres.mjs';

const scope = { id: 'b'.repeat(64), nonce: 'a'.repeat(32), port: 54321, remote: true };

test('remote image requires explicit remote scope and retains every container bound', () => {
    assert.throws(() => disposableDockerArgs({ image: REMOTE_POSTGRES_IMAGE, ...scope, remote: false, envFile: '/tmp/env' }));
    assert.throws(() => disposableDockerArgs({ image: DISPOSABLE_POSTGRES_IMAGE, ...scope, envFile: '/tmp/env' }));
    const args = disposableDockerArgs({ image: REMOTE_POSTGRES_IMAGE, ...scope, envFile: '/tmp/env' });
    for (const required of ['--pull=never', '--read-only', '--memory=2g', '--memory-swap=2g', '--pids-limit=256', '--cpus=2', '--restart=no', `127.0.0.1:${scope.port}:5432`]) assert(args.includes(required));
    const container = { Id: scope.id, Image: REMOTE_POSTGRES_IMAGE, Name: `/atlas-fixture-${scope.nonce}`,
        Config: { Labels: { 'com.atlas.disposable-postgres.nonce': scope.nonce } },
        HostConfig: { ReadonlyRootfs: true, Memory: 2 * 1024 ** 3, MemorySwap: 2 * 1024 ** 3,
            Privileged: false, NetworkMode: 'bridge', PidsLimit: 256, NanoCpus: 2 * 10 ** 9, ShmSize: 64 * 1024 ** 2, RestartPolicy: { Name: 'no' },
            LogConfig: { Type: 'local', Config: { 'max-size': '1m', 'max-file': '1', compress: 'false' } },
            PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(scope.port) }] },
            Tmpfs: { '/var/lib/postgresql/data': 'rw,nosuid,nodev,size=1200m', '/tmp': 'rw,nosuid,nodev,size=64m', '/run': 'rw,nosuid,nodev,size=16m' } }, Mounts: [] };
    assert(verifyDisposableDocker(container, scope));
    assert.throws(() => verifyDisposableDocker(container, { ...scope, remote: false }));
    container.Config.Labels['com.atlas.disposable-postgres.nonce'] = 'c'.repeat(32);
    assert.throws(() => verifyDisposableDocker(container, scope));
});

test('remote transport refuses existing IDs, arbitrary commands and mutable images before SSH', () => {
    for (const args of [['rm', scope.id], ['stop', '--time=10', scope.id], ['inspect', scope.id],
        ['start', scope.id], ['exec', scope.id, 'psql'], ['system', 'prune'], ['image', 'inspect', 'postgres:17'],
        ['context', 'use', 'production']]) assert.throws(() => createRemotePostgresTransport().execute(args, {}));
});

test('SSH argument quoting preserves metacharacters as literal data', () => {
    const values = ['single\'quote', '$(printf unexpected)', '`printf unexpected`', 'spaces and\nnewline', '; exit 9'];
    const result = spawnSync('/bin/sh', ['-c', `printf '%s\\0' ${remoteCommand(values)}`], { encoding: 'utf8' });
    assert.equal(result.status, 0); assert.deepEqual(result.stdout.split('\0').slice(0, -1), values);
});

test('remote mode rejects native binaries, local image, absent acknowledgement and persistent serve before effects', async () => {
    const common = ['--ack-disposable-local-postgres', '--ack-disposable-remote-pg17'];
    for (const args of [[...common, '--postgres-bin', '/tmp/bin'], [...common, '--docker-image', DISPOSABLE_POSTGRES_IMAGE],
        ['--ack-disposable-local-postgres', '--docker-image', REMOTE_POSTGRES_IMAGE],
        [...common, '--docker-image', REMOTE_POSTGRES_IMAGE, '--serve']]) await assert.rejects(disposablePostgres(args));
});
