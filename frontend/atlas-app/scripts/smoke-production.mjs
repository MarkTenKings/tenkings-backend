import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const origin = 'http://127.0.0.1:4318';
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', root, '-H', '127.0.0.1', '-p', '4318'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', ATLAS_LOCAL_SYNTHETIC: '1' }
});
let serverOutput = '';
server.stdout.on('data', data => { serverOutput += data; });
server.stderr.on('data', data => { serverOutput += data; });
const ended = new Promise(resolve => server.once('exit', resolve));
try {
  const deadline = Date.now() + 15_000;
  while (!serverOutput.includes('Ready in')) {
    if (server.exitCode !== null || Date.now() > deadline) throw new Error('Owned production fixture failed to start (possibly port in use).');
    await delay(50);
  }
  let checks = 0;
  for (const path of ['/', '/grading', '/cards/sample-001', '/api/staff/session', '/api/staff/cards', '/api/staff/cards/sample-001', '/api/staff/evidence/sample-001/FRONT']) {
    const result = await fetch(`${origin}${path}`, { redirect: 'manual' });
    assert.equal(result.status, 503, path);
    assert.match(result.headers.get('cache-control'), /no-store/);
    assert.equal(result.headers.get('set-cookie'), null);
    const text = await result.text();
    if (path.startsWith('/api/')) assert.deepEqual(JSON.parse(text), { error: 'STAFF_ACCESS_NOT_ENABLED' });
    else assert.match(text, /Staff access is not enabled here/);
    checks++;
  }
  const send = await fetch(`${origin}/api/staff/auth/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ phone: '+12025550141', requestId: 'production_probe_001' }) });
  assert.equal(send.status, 503); assert.deepEqual(await send.json(), { error: 'STAFF_ACCESS_NOT_ENABLED' }); checks++;
  console.log(JSON.stringify({ status: 'BUILT_PRODUCTION_DENIAL_PASS', checks, fixtureFlagPresent: true, sessionCookiesIssued: 0, providerRequests: 0 }));
} finally {
  server.kill('SIGTERM');
  await Promise.race([ended, delay(5000).then(() => { if (server.exitCode === null) server.kill('SIGKILL'); })]);
}
