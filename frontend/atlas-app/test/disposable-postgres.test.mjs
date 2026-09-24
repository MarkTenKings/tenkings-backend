import assert from 'node:assert/strict';
import test from 'node:test';
import { DISPOSABLE_POSTGRES_IMAGE, disposableDockerArgs, disposablePostgres, verifyDisposableDocker } from '../scripts/disposable-postgres.mjs';

const scope = { id: 'b'.repeat(64), nonce: 'a'.repeat(32), port: 54321 };
function inspected() {
    return { Id: scope.id, Image: DISPOSABLE_POSTGRES_IMAGE, Name: `/atlas-fixture-${scope.nonce}`,
        Config: { Labels: { 'com.atlas.disposable-postgres.nonce': scope.nonce } },
        HostConfig: { ReadonlyRootfs: true, Memory: 2 * 1024 ** 3, MemorySwap: 2 * 1024 ** 3,
            PidsLimit: 256, NanoCpus: 2 * 10 ** 9, ShmSize: 64 * 1024 ** 2, RestartPolicy: { Name: 'no' },
            Privileged: false, NetworkMode: 'bridge', LogConfig: { Type: 'local', Config: { 'max-size': '1m', 'max-file': '1', compress: 'false' } },
            PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: String(scope.port) }] },
            Tmpfs: { '/var/lib/postgresql/data': 'rw,nosuid,nodev,size=1200m', '/tmp': 'rw,nosuid,nodev,size=64m', '/run': 'rw,nosuid,nodev,size=16m' } }, Mounts: [] };
}

test('Docker fixture uses only immutable local image, tmpfs, generated env file and loopback publication', () => {
    const args = disposableDockerArgs({ image: DISPOSABLE_POSTGRES_IMAGE, ...scope, envFile: '/tmp/owned-fixture/container.env' });
    assert(args.includes('--pull=never')); assert(args.includes('--read-only')); assert(args.includes('--memory=2g'));
    assert(args.includes('--log-opt=compress=false')); assert(args.includes('--log-opt=max-file=1')); assert(args.includes('--log-opt=max-size=1m'));
    assert(args.includes(`127.0.0.1:${scope.port}:5432`)); assert(args.includes('--env-file'));
    assert(!args.some(arg => /POSTGRES_PASSWORD|--volume|--mount|--privileged|--network=host/.test(arg)));
    assert.equal(verifyDisposableDocker(inspected(), scope), true);
    assert.throws(() => disposableDockerArgs({ image: 'postgres:15', ...scope, envFile: '/tmp/env' }));
});

test('cleanup refuses changed identity, ownership, network, memory or existing volume', () => {
    const changes = [
        c => { c.Id = 'c'.repeat(64); }, c => { c.Image = 'sha256:' + 'c'.repeat(64); },
        c => { c.Name = '/some-existing-database'; }, c => { c.Config.Labels = {}; },
        c => { c.HostConfig.ReadonlyRootfs = false; }, c => { c.HostConfig.Memory = 0; },
        c => { c.HostConfig.MemorySwap = -1; }, c => { c.HostConfig.Privileged = true; },
        c => { c.HostConfig.PidsLimit = 0; }, c => { c.HostConfig.NanoCpus = 0; }, c => { c.HostConfig.ShmSize = 2 ** 30; },
        c => { c.HostConfig.RestartPolicy.Name = 'always'; }, c => { c.HostConfig.CapAdd = ['SYS_ADMIN']; }, c => { c.HostConfig.Devices = ['/dev/sda']; },
        c => { c.HostConfig.LogConfig.Config['max-size'] = '100m'; }, c => { c.HostConfig.LogConfig.Config.compress = 'true'; },
        c => { c.HostConfig.NetworkMode = 'host'; }, c => { c.HostConfig.PortBindings['5432/tcp'][0].HostIp = '0.0.0.0'; },
        c => { c.HostConfig.Tmpfs = {}; }, c => { c.HostConfig.Binds = ['/existing:/data']; },
        c => { c.HostConfig.VolumesFrom = ['existing']; }, c => { c.Mounts = [{ Type: 'volume', Destination: '/var/lib/postgresql/data' }]; },
    ];
    for (const change of changes) { const container = inspected(); change(container); assert.throws(() => verifyDisposableDocker(container, scope)); }
});

test('fixture rejects missing acknowledgement, ambiguous modes and external database options before effects', async () => {
    for (const args of [[], ['--ack-disposable-local-postgres'],
        ['--ack-disposable-local-postgres', '--docker-image', 'postgres:15'],
        ['--ack-disposable-local-postgres', '--docker-image', DISPOSABLE_POSTGRES_IMAGE, '--postgres-bin', '/tmp/bin'],
        ['--ack-disposable-local-postgres', '--database-url', 'postgresql://existing'],
        ['--ack-disposable-local-postgres', '--docker-image', DISPOSABLE_POSTGRES_IMAGE, '--docker-image', DISPOSABLE_POSTGRES_IMAGE]]) {
        await assert.rejects(disposablePostgres(args));
    }
});

test('upgrade checkpoint rejects non-callable configuration before creating a fixture', async () => {
    for (const beforeUpgradeFrom48 of [null, true, 48, 'postgresql://existing', {}])
        await assert.rejects(disposablePostgres([], { beforeUpgradeFrom48 }), /explicit fixture callback/);
});
