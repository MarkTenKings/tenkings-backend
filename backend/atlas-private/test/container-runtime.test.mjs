import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertProcess, verifyExecutable } from '../container/verify.mjs';

const fixed = { env: { NODE_ENV: 'production' }, execArgv: [], version: 'v20.20.1', platform: 'linux', arch: 'x64' };
test('bootstrap admits only the pinned Linux amd64 Node runtime with no loader arguments', () => {
    assertProcess(fixed);
    for (const change of [{ version: 'v20.20.0' }, { platform: 'darwin' }, { arch: 'arm64' }, { execArgv: ['--import=fixture.mjs'] }])
        assert.throws(() => assertProcess({ ...fixed, ...change }));
});
test('bootstrap requires actual pinned Node bytes even when process version and platform match', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-private-node-test-'));
    t.after(() => rm(directory, { recursive: true }));
    const path = join(directory, 'node'); await writeFile(path, 'v20.20.1 fixture executable; must never run');
    assertProcess(fixed);
    await assert.rejects(verifyExecutable(path), { code: 'ATLAS_PRIVATE_CONTAINER_NODE_CHANGED' });
});
test('original process rejects loader, native, Prisma and CA overrides including remaining NODE_VERSION metadata', () => {
    for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_VERSION', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES',
        'PRISMA_QUERY_ENGINE_LIBRARY', 'OPENSSL_CONF', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'DEBUG']) {
        assert.throws(() => assertProcess({ ...fixed, env: { ...fixed.env, [name]: '' } }), { code: 'ATLAS_PRIVATE_CONTAINER_PROCESS' });
    }
});
test('real shell entrypoint denies invalid official metadata and loader overrides before reaching Node', () => {
    const shell = fileURLToPath(new URL('../container/entrypoint.sh', import.meta.url));
    const env = { PATH: '/usr/bin:/bin', NODE_VERSION: '20.20.1', YARN_VERSION: '1.22.22', NODE_ENV: 'production' };
    for (const change of [{ NODE_VERSION: '20.20.2' }, { YARN_VERSION: 'other' },
        { NODE_OPTIONS: '--import=data:text/javascript,console.log("LOADER_MUST_NOT_RUN")' },
        { NODE_PATH: '' }, { LD_PRELOAD: '' }, { PRISMA_QUERY_ENGINE_LIBRARY: '' }, { SSL_CERT_FILE: '' }]) {
        const result = spawnSync('/bin/sh', [shell], { env: { ...env, ...change }, encoding: 'utf8' });
        assert.equal(result.status, 78); assert.equal(result.stdout, '');
        assert.equal(result.stderr, 'ATLAS_PRIVATE_CONTAINER_STARTUP_REJECTED\n');
    }
});
