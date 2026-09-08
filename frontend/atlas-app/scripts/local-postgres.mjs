#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { disposablePostgres } from './disposable-postgres.mjs';
import { localAccessConfig, seedLocalStaff } from '../lib/server/access/fixture.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url), origin = 'http://127.0.0.1:4318';
for (const name of ['.env', '.env.local', '.env.development', '.env.development.local'])
    assert(!existsSync(join(root, name)), 'Remove app env files before running the synthetic fixture');
const fixture = await disposablePostgres(process.argv.slice(2));
let server, stopped = false, checks = 0;
const jar = new Map();
async function call(path, body, csrf) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual', method: body === undefined ? 'GET' : 'POST',
        headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(body === undefined ? {} : {
            Origin: origin, 'Content-Type': 'application/json', 'X-Atlas-Csrf': csrf ?? '' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const cookie of response.headers.getSetCookie()) {
        const [key, value] = cookie.split(';')[0].split('='); if (value) jar.set(key, value); else jar.delete(key);
    }
    return response;
}
async function stopWeb() {
    if (!server || server.exitCode !== null) return;
    const child = server, end = new Promise(done => child.once('exit', done));
    child.kill('SIGTERM');
    await Promise.race([end, delay(5000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); })]);
    await end;
}
async function stop() { if (stopped) return; stopped = true; await stopWeb(); await fixture.stop(); }
async function startWeb(path) {
    let output = '';
    server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', root, '-H', '127.0.0.1', '-p', '4318'], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME,
            NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', ATLAS_LOCAL_POSTGRES: '1', ATLAS_LOCAL_POSTGRES_FILE: path } });
    const record = bytes => { output += fixture.safe(bytes); writeFileSync(join(fixture.directory, 'web.log'), output, { mode: 0o600 }); };
    server.stdout.on('data', record); server.stderr.on('data', record);
    const deadline = Date.now() + 30_000;
    while (!output.includes('Ready in')) {
        assert(server.exitCode === null && Date.now() < deadline, 'Owned staff web fixture failed to start; retained web.log'); await delay(100);
    }
}
try {
    const db = await fixture.database(), sessionKey = randomBytes(32), phoneKey = randomBytes(32);
    const config = localAccessConfig({ databaseUrl: db.staffUrl, sessionKey, phoneKey });
    const admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } });
    try { await seedLocalStaff(admin, config, { analyses: true, trained: true }); } finally { await admin.$disconnect(); }
    const ownership = JSON.parse(readFileSync(join(fixture.directory, 'ownership.json'), 'utf8'));
    const path = join(fixture.directory, 'web-config.json');
    writeFileSync(path, JSON.stringify({ nonce: ownership.nonce, databaseUrl: db.staffUrl, sessionKey: sessionKey.toString('hex'), phoneKey: phoneKey.toString('hex') }), { mode: 0o600 });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().finally(() => process.exit()); });
    await startWeb(path);
    const page = await call('/'); assert.equal(page.status, 200); assert.match(await page.text(), /Persistent local preview/); checks++;
    let response = await call('/api/staff/session'); assert.equal(response.status, 200);
    const boot = await response.json(); assert.equal(boot.mode, 'LOCAL_FIXTURE'); checks++;
    response = await call('/api/staff/auth/request', { phone: '+12025550141', requestId: randomUUID() }, boot.csrf);
    assert.equal(response.status, 200, await response.clone().text()); const challenge = await response.json(); checks++;
    response = await call('/api/staff/auth/verify', { challengeId: challenge.challengeId, code: '424242' }, boot.csrf);
    assert.equal(response.status, 200, await response.clone().text()); const signed = await response.json(); checks++;
    response = await call('/grading'); assert.equal(response.status, 200); assert.match(await response.text(), /survive app restarts/); checks++;
    response = await call('/api/staff/cards'); assert.equal(response.status, 200); const { cards } = await response.json(); assert.equal(cards.length, 3); checks++;
    const id = cards.find(c => c.evidenceComplete).id;
    response = await call(`/cards/${id}`); assert.equal(response.status, 200); checks++;
    response = await call(`/api/staff/cards/${id}`); assert.equal(response.status, 200); const { card } = await response.json();
    response = await call(`/api/staff/evidence/${id}/FRONT`); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/svg\+xml/); checks++;
    const input = { operationId: randomUUID(), expectedRevision: card.draft.revision, evidenceRevision: card.evidenceRevision,
        evidenceHash: card.evidenceHash, observations: { FRONT: 'Saved before the web process restarted.', BACK: '' }, reviewedSides: ['FRONT', 'BACK'], identityReviewed: true, disposition: 'READY_FOR_HUMAN' };
    response = await call(`/api/staff/cards/${id}/draft`, input, signed.csrf); assert.equal(response.status, 200, await response.clone().text()); checks++;
    const ready = (await response.json()).card;
    assert.equal(ready.grading.approvalBlock, null); assert.equal(ready.grading.report.version, 'atlas-graded-report-v1');
    const approvalInput = { operationId: randomUUID(), expectedAnalysisRevision: ready.grading.analysisRevision,
        analysisHash: ready.grading.analysisHash, expectedReviewRevision: ready.draft.revision, reviewHash: ready.reviewHash, evidenceHash: ready.evidenceHash };
    response = await call(`/api/staff/cards/${id}/approve`, approvalInput, signed.csrf);
    assert.equal(response.status, 200, await response.clone().text());
    const approval = (await response.json()).approval; assert.equal(approval.version, 1); checks++;
    response = await call('/api/staff/cards'); assert.equal((await response.json()).cards.find(c => c.id === id).disposition, 'HUMAN_APPROVED'); checks++;
    await stopWeb(); await startWeb(path);
    response = await call(`/api/staff/cards/${id}`); assert.equal(response.status, 200, await response.clone().text());
    const restored = (await response.json()).card; assert.equal(restored.draft.revision, 2); assert.deepEqual(restored.draft.observations, input.observations); checks++;
    response = await call(`/api/staff/cards/${id}/draft`, input, signed.csrf); assert.equal(response.status, 200); assert.equal((await response.json()).card.draft.revision, 2); checks++;
    assert.equal(restored.grading.published.matchesCurrent, true); assert.equal(restored.grading.published.version, 1); checks++;
    response = await call(`/api/staff/cards/${id}/approve`, approvalInput, signed.csrf);
    assert.equal(response.status, 200, await response.clone().text()); assert.deepEqual((await response.json()).approval, approval); checks++;
    response = await call('/api/staff/auth/logout', {}, signed.csrf); assert.equal(response.status, 200);
    response = await call('/api/staff/cards'); assert.equal(response.status, 401); checks++;
    writeFileSync(join(fixture.directory, 'web-result.json'), JSON.stringify({ ok: true, checks, actualWebProcessRestart: true, mode: 'LOCAL_FIXTURE' }, null, 2));
    console.log(JSON.stringify({ status: 'PERSISTENT_STAFF_WEB_PASS', checks, directory: fixture.directory, actualWebProcessRestart: true }));
    if (process.argv.includes('--serve')) {
        console.log(`Persistent synthetic ATLAS preview: ${origin}`);
        await new Promise(done => server.once('exit', done));
    }
} finally { await stop(); }
