import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDemoServer } from '../scripts/demo-server.mjs';
import { get } from 'node:http';

test('local HTTP cannot enable by default or bypass origin/CSRF; exact asset hashes and typed filters survive transport', async () => {
  await assert.rejects(() => startDemoServer(), { code: 'SYNTHETIC_DEMO_DISABLED' });
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-r2-http-')));
  const app = await startDemoServer({ directory, enabled: true });
  try {
    const stateResponse = await fetch(`${app.origin}/api/demo`);
    const state = await stateResponse.json();
    assert.equal(state.mode, 'SYNTHETIC_LOCAL');
    assert.equal(state.gates.ownershipClaimsEnabled, false);
    assert.equal(state.gates.ownershipHistoryEnabled, false);
    assert.equal(state.operationalMetrics.productionEvents, 0);
    assert.equal(stateResponse.headers.get('cache-control'), 'no-store');
    const sha = value => createHash('sha256').update(value).digest('hex');
    for (const side of ['front', 'back']) {
      const bytes = await (await fetch(`${app.origin}/demo/${side}.svg`)).arrayBuffer();
      assert.equal(sha(Buffer.from(bytes)), state.eligibilityCards[0].media[side].sha256);
    }
    assert.equal(sha(await (await fetch(`${app.origin}/demo/report`)).text()), state.eligibilityCards[0].reportHash);
    const post = (headers = {}) => fetch(`${app.origin}/api/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ requestId: 'demo_http_consent', cardId: 'demo_card', choice: 'HOLD_AND_LIST', actor: { id: 'intruder', role: 'STAFF' } }) });
    assert.equal((await post()).status, 403);
    assert.equal((await post({ Origin: 'https://untrusted.invalid', 'x-atlas-demo-csrf': state.csrfToken })).status, 403);
    const wrongHostStatus = await new Promise((resolve, reject) => get(`${app.origin}/api/demo`, { headers: { Host: 'untrusted.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
    assert.equal(wrongHostStatus, 403);
    assert.equal((await fetch(app.origin, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'document' } })).status, 403);
    assert.equal((await fetch(`${app.origin}/api/demo`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const accepted = await post({ Origin: app.origin, 'x-atlas-demo-csrf': state.csrfToken });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).sellerId, 'demo_seller');
    assert.equal((await fetch(`${app.origin}/api/catalog?autograph=false&grade=9&numberedDenominator=99`)).status, 200);
    assert.equal((await fetch(`${app.origin}/api/catalog?grade=8.5`)).status, 200);
    assert.equal((await fetch(`${app.origin}/api/catalog?grade=9e0`)).status, 409);
    assert.equal((await fetch(`${app.origin}/api/catalog?autograph=0`)).status, 409);
    assert.equal((await fetch(`${app.origin}/api/catalog?grade=9&grade=8`)).status, 409);
    assert.equal((await fetch(`${app.origin}/api/ownership/claims`)).status, 404);
    const home = await (await fetch(app.origin)).text();
    assert.ok(home.includes('app.mjs'));
    for (const [, assetPath] of home.matchAll(/(?:href|src)="(\/[^\"]+\.(?:css|mjs))"/g)) {
      assert.equal((await fetch(`${app.origin}${assetPath}`)).status, 200, assetPath);
    }
    const appBytes = await (await fetch(`${app.origin}/app.mjs`)).text();
    assert.equal(appBytes, readFileSync(new URL('../ui/app.mjs', import.meta.url), 'utf8'));
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
