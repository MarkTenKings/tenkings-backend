import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(import.meta.url);
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local'])
    assert(!existsSync(resolve(root, name)), 'Refusing app environment files');
const port = await new Promise((done, reject) => {
    const probe = createServer().once('error', reject); probe.listen(0, '127.0.0.1', () => {
        const value = probe.address().port; probe.close(error => error ? reject(error) : done(value)); });
});
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', root, '-H', '127.0.0.1', '-p', String(port)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1', DATABASE_URL: 'postgresql://build:build@127.0.0.1:1/build',
        ATLAS_GRADING_BRIDGE_ENABLED: 'true', ATLAS_LOCAL_POSTGRES: '1' } });
let output = ''; server.stdout.on('data', data => { output += data; }); server.stderr.on('data', data => { output += data; });
const ended = new Promise(done => server.once('exit', done));
try {
    const deadline = Date.now() + 15_000;
    while (!output.includes('Ready in')) {
        assert(server.exitCode === null && Date.now() < deadline, 'Owned bridge denial server failed to start'); await delay(50);
    }
    let checks = 0;
    for (const request of [{ method: 'GET' }, { method: 'POST', body: '{}' },
        { method: 'POST', body: '{}', headers: { Cookie: 'adminSession=not-authority', Authorization: 'Bearer not-authority' } },
        { method: 'POST', body: '{}', headers: { 'x-atlas-signature': 'f'.repeat(64), Host: 'app.atlasgrading.com' } }]) {
        const response = await fetch(`http://127.0.0.1:${port}/api/internal/atlas/bridge`, { redirect: 'manual', ...request,
            headers: { 'Content-Type': 'application/json', ...request.headers } });
        assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'ATLAS_BRIDGE_UNAVAILABLE' });
        assert.match(response.headers.get('cache-control'), /no-store/); assert.equal(response.headers.get('set-cookie'), null); checks++;
    }
    console.log(JSON.stringify({ status: 'BUILT_ATLAS_BRIDGE_DENIAL_PASS', checks, cookiesIssued: 0, liveProviderConfiguration: false }));
} finally {
    server.kill('SIGTERM');
    await Promise.race([ended, delay(5000).then(() => { if (server.exitCode === null) server.kill('SIGKILL'); })]); await ended;
}
