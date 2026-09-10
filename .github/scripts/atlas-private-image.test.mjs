import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { cleanSource, assertImage, assertIsolation, imageIdentity } from './atlas-private-image.mjs';

async function repository(t) {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-private-ci-source-test-')));
    t.after(() => rm(root, { recursive: true }));
    const git = args => {
        const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8',
            env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
        assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
    };
    await writeFile(join(root, 'source.txt'), 'Owned synthetic source, no runtime action.\n');
    await writeFile(join(root, '.gitignore'), 'generated/\n');
    git(['init', '--quiet']); git(['add', '.']);
    git(['-c', 'user.name=ATLAS synthetic fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Owned source validation fixture']);
    return { root, git, commit: git(['rev-parse', 'HEAD']) };
}
test('CI source inventory binds committed bytes and permits only ignored generated outputs', async t => {
    const f = await repository(t), before = await cleanSource(f.root, f.commit);
    assert.equal(before.files.length, 2); assert.equal(before.sourceCommit, f.commit);
    await mkdir(join(f.root, 'generated')); await writeFile(join(f.root, 'generated/probe.txt'), 'Synthetic generated output.');
    assert.deepEqual(await cleanSource(f.root, f.commit), before);
    await assert.rejects(() => cleanSource(f.root, '1'.repeat(40)), /Wrong checkout commit/);
    await writeFile(join(f.root, 'unexpected.txt'), 'Untracked source.');
    await assert.rejects(() => cleanSource(f.root, f.commit), /Dirty checkout/);
});
test('CI byte comparison rejects changed tracked content even when Git status hides it', async t => {
    const f = await repository(t);
    f.git(['update-index', '--assume-unchanged', 'source.txt']);
    await writeFile(join(f.root, 'source.txt'), 'Changed source hidden from ordinary Git status.');
    assert.equal(f.git(['status', '--porcelain']), '');
    await assert.rejects(() => cleanSource(f.root, f.commit), /Source bytes differ from commit/);
});
function image() {
    return { Id: `sha256:${'1'.repeat(64)}`, Os: 'linux', Architecture: 'amd64', RootFS: { Type: 'layers', Layers: [`sha256:${'2'.repeat(64)}`] },
        Config: { User: '65532:65532', WorkingDir: '/app', Entrypoint: ['/app/container/entrypoint.sh'],
            Env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'NODE_VERSION=20.20.1', 'YARN_VERSION=1.22.22', 'NODE_ENV=production', 'ATLAS_PRIVATE_LISTEN_HOST=0.0.0.0', 'PORT=8091'],
            Labels: { 'org.opencontainers.image.revision': 'a'.repeat(40), 'io.atlas.source-tree': 'b'.repeat(40), 'io.atlas.container-manifest': 'c'.repeat(64) } } };
}
test('exact image configuration excludes provider credentials, entrypoint drift and wrong source', () => {
    const value = image(), manifest = { sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40) };
    assert.doesNotThrow(() => assertImage(value, manifest, 'c'.repeat(64)));
    for (const mutate of [x => x.Config.Env.push('OPENAI_API_KEY=synthetic-not-a-credential'), x => x.Config.User = '0',
        x => x.Config.Entrypoint = ['/bin/sh'], x => x.Config.Labels['io.atlas.source-tree'] = 'd'.repeat(40)]) {
        const changed = structuredClone(value); mutate(changed); assert.throws(() => assertImage(changed, manifest, 'c'.repeat(64)));
    }
    assert.deepEqual(imageIdentity(value), imageIdentity({ ...value, Id: `sha256:${'e'.repeat(64)}` }));
    const changed = structuredClone(value); changed.RootFS.Layers.push(`sha256:${'f'.repeat(64)}`);
    assert.notDeepEqual(imageIdentity(changed), imageIdentity(value));
});
test('actual-container inspection requires no host ports, mounts, privileges or writable filesystem', () => {
    const value = { Config: { User: '65532:65532' }, Mounts: [], HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true,
        Privileged: false, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], Binds: null, PortBindings: {} } };
    assert.doesNotThrow(() => assertIsolation(value));
    for (const mutate of [x => x.HostConfig.NetworkMode = 'bridge', x => x.HostConfig.ReadonlyRootfs = false,
        x => x.HostConfig.Privileged = true, x => x.HostConfig.PortBindings = { '8091/tcp': [{ HostPort: '8091' }] },
        x => x.Mounts.push({ Source: '/host', Destination: '/app' })]) {
        const changed = structuredClone(value); mutate(changed); assert.throws(() => assertIsolation(changed));
    }
});
