import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';

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
  let pageHtml;
  for (const path of ['/', '/grading', '/operations', '/cards/sample-001', '/api/staff/session', '/api/staff/cards', '/api/staff/cards/sample-001', '/api/staff/evidence/sample-001/FRONT']) {
    const result = await fetch(`${origin}/admin${path === '/' ? '' : path}`, { redirect: 'manual' });
    assert.equal(result.status, 503, path);
    assert.match(result.headers.get('cache-control'), /no-store/);
    assert.equal(result.headers.get('set-cookie'), null);
    const text = await result.text();
    if (path.startsWith('/api/')) assert.deepEqual(JSON.parse(text), { error: 'STAFF_ACCESS_NOT_ENABLED' });
    else { assert.match(text, /Staff access is not enabled here/); pageHtml = text; }
    checks++;
  }
  for (const path of ['/', '/grading', '/operations', '/cards/sample-001', '/api/staff/session',
      '/administrator', '/administrator/api/staff/session', '/account', '/reports/unknown']) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual' });
    assert.equal(response.status, 404, `Unlisted staff mount: ${path}`);
    assert.equal(response.headers.get('set-cookie'), null); checks++;
  }
  const assets = [...pageHtml.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert(assets.length > 0, 'Built staff page must contain its script assets');
  for (const asset of assets) {
    assert(asset.startsWith('/admin/_next/'), `Staff asset escaped its mount: ${asset}`);
    const response = await fetch(`${origin}${asset}`, { redirect: 'manual' });
    assert.equal(response.status, 200, asset); assert.equal(response.headers.get('set-cookie'), null); checks++;
  }
  const buildId = readFileSync(resolve(root, '.next/BUILD_ID'), 'utf8').trim();
  const data = await fetch(`${origin}/admin/_next/data/${buildId}/grading.json`, { redirect: 'manual' });
  assert.equal(data.status, 503); assert.equal(data.headers.get('set-cookie'), null);
  assert.equal((await data.json()).pageProps.unavailable, true); checks++;
  const send = await fetch(`${origin}/admin/api/staff/auth/request`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ phone: '+12025550141', requestId: 'production_probe_001' }) });
  assert.equal(send.status, 503); assert.deepEqual(await send.json(), { error: 'STAFF_ACCESS_NOT_ENABLED' }); checks++;
  const approve = await fetch(`${origin}/admin/api/staff/cards/00000000-0000-4000-8000-000000000000/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' });
  assert.equal(approve.status, 503); assert.equal(approve.headers.get('set-cookie'), null); checks++;
  for (const suffix of ['grade', 'trace', 'operations/00000000-0000-4000-8000-000000000000']) {
    const response = await fetch(`${origin}/admin/api/staff/cards/00000000-0000-4000-8000-000000000000/${suffix}`,
      suffix.startsWith('operations/') ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: '{}' });
    assert.equal(response.status, 503); assert.equal(response.headers.get('set-cookie'), null); checks++;
    assert.equal(response.headers.get('x-atlas-grading-stream'), null);
    assert.deepEqual(await response.json(), { error: 'STAFF_ACCESS_NOT_ENABLED' });
  }
  const card = '00000000-0000-4000-8000-000000000000';
  for (const path of [`cards/${card}/identity-correction`, `cards/${card}/learning/preview`, `cards/${card}/learning/decisions`,
      ...['label', 'nfc-job', 'nfc-verify', 'physical'].map(action => `cards/${card}/finishing/${action}`),
      'operations/machine/admit', 'operations/resolution/inspect', 'operations/resolution/cancel-initialization',
      'operations/resolution/abandon', 'operations/intake/admit', 'operations/roster/update', 'operations/invoices/reconcile']) {
    const response = await fetch(`${origin}/admin/api/staff/${path}`, { method:'POST', headers:{'Content-Type':'application/json',Origin:origin},body:'{}' });
    assert.equal(response.status,503,path);assert.equal(response.headers.get('set-cookie'),null);
    assert.deepEqual(await response.json(),{error:'STAFF_ACCESS_NOT_ENABLED'});checks++;
  }
  console.log(JSON.stringify({ status: 'BUILT_PRODUCTION_DENIAL_PASS', checks, fixtureFlagPresent: true, sessionCookiesIssued: 0, providerRequests: 0 }));
} finally {
  server.kill('SIGTERM');
  await Promise.race([ended, delay(5000).then(() => { if (server.exitCode === null) server.kill('SIGKILL'); })]);
}
