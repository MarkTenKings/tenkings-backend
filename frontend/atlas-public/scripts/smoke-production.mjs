import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) assert(!existsSync(resolve(root, name)), 'Refusing app environment files in production denial fixture');
const port = await new Promise((done, reject) => {
  const probe = createServer().once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(error => error ? reject(error) : done(value)); });
});
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', root, '-H', '127.0.0.1', '-p', String(port)], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', ATLAS_LOCAL_PUBLIC: '1', ATLAS_LOCAL_PUBLIC_FILE: '/private/tmp/not-an-owned-fixture/public-config.json' }
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
  const token = 'ar_abcdefghijklmnopqrstuvwx';
  for (const [path, options, expected] of [
      ['/', {}, 503], [`/reports/${token}?v=1`, {}, 503], [`/reports/${token}?v=2`, {}, 503],
      [`/reports/${token}?v=1`, { method: 'POST' }, 503],
      [`/reports/${token}?v=1`, { headers: { 'x-forwarded-host': 'app.atlasgrading.com' } }, 503],
      ['/grading', {}, 404], ['/api/staff/session', {}, 404],
  ]) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual', ...options });
    assert.equal(response.status, expected, path); assert.equal(response.headers.get('set-cookie'), null);
    if (expected === 503) assert.match(response.headers.get('cache-control'), /no-store/);
    assert(!(await response.text()).includes('Synthetic illustration')); checks++;
  }
  console.log(JSON.stringify({ status: 'BUILT_PUBLIC_PRODUCTION_DENIAL_PASS', checks, fixtureFlagPresent: true, sessionCookiesIssued: 0 }));
} finally {
  server.kill('SIGTERM');
  await Promise.race([ended, delay(5000).then(() => { if (server.exitCode === null) server.kill('SIGKILL'); })]);
}
