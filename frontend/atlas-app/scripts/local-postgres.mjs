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
import { makePublicConfig, LOCAL_ORIGIN as PUBLIC_LOCAL_ORIGIN } from '../../atlas-public/lib/server/policy.mjs';
import { localAccessConfig, seedLocalStaff } from '../lib/server/access/fixture.mjs';
import { hash } from '../lib/server/policy.mjs';
import { decodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(root, '../atlas-public');
const require = createRequire(import.meta.url), origin = 'http://127.0.0.1:4318';
for (const name of ['.env', '.env.local', '.env.development', '.env.development.local'])
    assert(!existsSync(join(root, name)) && !existsSync(join(publicRoot, name)), 'Remove app env files before running the synthetic fixture');
const fixture = await disposablePostgres(process.argv.slice(2));
let server, publicServer, stopped = false, checks = 0;
const jar = new Map();
async function call(path, body, csrf) {
    const response = await fetch(`${origin}/admin${path === '/' ? '' : path}`, { redirect: 'manual', method: body === undefined ? 'GET' : 'POST',
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
async function stopPublic() {
    if (!publicServer || publicServer.exitCode !== null) return;
    const child = publicServer, end = new Promise(done => child.once('exit', done));
    child.kill('SIGTERM');
    await Promise.race([end, delay(5000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); })]);
    await end;
}
async function stop() { if (stopped) return; stopped = true; await stopWeb(); await stopPublic(); await fixture.stop(); }
async function startPublic(path) {
    let output = '';
    publicServer = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', publicRoot, '-H', '127.0.0.1', '-p', '4319'], {
        cwd: publicRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME,
            NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', ATLAS_LOCAL_PUBLIC: '1', ATLAS_LOCAL_PUBLIC_FILE: path } });
    const record = bytes => { output += fixture.safe(bytes); writeFileSync(join(fixture.directory, 'public-web.log'), output, { mode: 0o600 }); };
    publicServer.stdout.on('data', record); publicServer.stderr.on('data', record);
    const deadline = Date.now() + 30_000;
    while (!output.includes('Ready in')) {
        assert(publicServer.exitCode === null && Date.now() < deadline, 'Owned public web fixture failed to start; retained public-web.log'); await delay(100);
    }
}
async function publicCall(path, options = {}) {
    const response = await fetch(`${PUBLIC_LOCAL_ORIGIN}${path}`, { redirect: 'manual', ...options });
    assert.equal(response.headers.get('set-cookie'), null, 'Public app must never issue a staff cookie');
    return response;
}
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
    const publicConfig = makePublicConfig({ mode: 'LOCAL_FIXTURE', origin: PUBLIC_LOCAL_ORIGIN, deploymentId: 'local-public-fixture',
        releaseSha: '0'.repeat(40), databaseUrl: db.publicUrl });
    try {
        const identities=await seedLocalStaff(admin, config, { analyses: true, trained: true, traces: true });
        const reviewer=await admin.staffIdentity.update({where:{id:identities[0].id},data:{accessVersion:2,trustedLearningUntil:new Date(Date.now()+3600_000)}});
        await admin.staffOperationsGrant.create({data:{id:randomUUID(),identityId:reviewer.id,accessVersion:reviewer.accessVersion,
            controlRevision:1,mode:config.mode,origin:config.origin,deploymentId:config.deploymentId,releaseSha:config.releaseSha,
            configHash:config.configHash,authorizationEvidenceHash:'a'.repeat(64),createdAt:new Date(Date.now()-1000),expiresAt:new Date(Date.now()+3600_000)}});
        const { databaseUrl, ...activation } = publicConfig;
        await admin.publicReaderControl.create({ data: { ...activation, enabled: true } });
    } finally { await admin.$disconnect(); }
    const ownership = JSON.parse(readFileSync(join(fixture.directory, 'ownership.json'), 'utf8'));
    const path = join(fixture.directory, 'web-config.json');
    writeFileSync(path, JSON.stringify({ nonce: ownership.nonce, databaseUrl: db.staffUrl, operationsDatabaseUrl:db.operationsUrl,
        sessionKey: sessionKey.toString('hex'), phoneKey: phoneKey.toString('hex') }), { mode: 0o600 });
    const publicPath = join(fixture.directory, 'public-config.json');
    writeFileSync(publicPath, JSON.stringify({ nonce: ownership.nonce, databaseUrl: db.publicUrl }), { mode: 0o600 });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().finally(() => process.exit()); });
    await startWeb(path); await startPublic(publicPath);
    const page = await call('/'); assert.equal(page.status, 200); assert.match(await page.text(), /Persistent local preview/); checks++;
    let response = await call('/api/staff/session'); assert.equal(response.status, 200);
    const boot = await response.json(); assert.equal(boot.mode, 'LOCAL_FIXTURE'); checks++;
    response = await call('/api/staff/auth/request', { phone: '+12025550141', requestId: randomUUID() }, boot.csrf);
    assert.equal(response.status, 200, await response.clone().text()); const challenge = await response.json(); checks++;
    response = await call('/api/staff/auth/verify', { challengeId: challenge.challengeId, code: '424242' }, boot.csrf);
    assert.equal(response.status, 200, await response.clone().text()); let signed = await response.json(); checks++;
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
    response=await call(`/api/staff/cards/${id}/finishing`);assert.equal(response.status,200);
    const finishing=(await response.json()).finishing;assert.equal(finishing.nfcConfigured,false);assert.equal(finishing.stage,'READY_FOR_LABEL');checks++;
    const labelInput={operationId:randomUUID(),approvalId:finishing.approved.approvalId,
        approvalVersion:finishing.approved.approvalVersion,publicHash:finishing.approved.publicHash};
    response=await call(`/api/staff/cards/${id}/finishing/label`,labelInput,signed.csrf);assert.equal(response.status,200,await response.clone().text());
    const label=(await response.json()).receipt;assert.equal(label.approvalId,approval.approvalId);checks++;
    response=await call(`/api/staff/cards/${id}/finishing/nfc-job`,{...labelInput,operationId:randomUUID(),labelIssueId:label.id},signed.csrf);
    assert.equal(response.status,503);assert.equal((await response.json()).error,'NFC_NOT_CONFIGURED');checks++;
    response=await call(`/api/staff/cards/${id}/learning`);assert.equal(response.status,200,await response.clone().text());
    assert.deepEqual((await response.json()).learning,{decisions:[],olderDecisionsAvailable:false,applicationAvailable:false});checks++;
    response=await call(`/api/staff/cards/${id}/learning/preview`,{approvalId:approval.approvalId},signed.csrf);
    assert.equal(response.status,503);assert.equal((await response.json()).error,'LEARNING_NOT_CONFIGURED');checks++;
    response=await call('/operations');assert.equal(response.status,200);checks++;
    response=await call('/api/staff/operations/roster');assert.equal(response.status,200,await response.clone().text());
    const roster=(await response.json()).roster,observer=roster.find(row=>row.role==='OBSERVER');assert(observer);checks++;
    const rosterInput={operationId:randomUUID(),identityId:observer.id,expectedAccessVersion:observer.accessVersion,role:'OBSERVER',revoked:false,
        certificationUntil:null,trustedLearningUntil:null,reason:'Owned synthetic web access revision.',authorizationEvidenceHash:'a'.repeat(64)};
    response=await call('/api/staff/operations/roster/update',rosterInput,signed.csrf);assert.equal(response.status,200,await response.clone().text());
    const rosterReceipt=(await response.json()).receipt;assert.equal(rosterReceipt.accessVersion,observer.accessVersion+1);checks++;
    const emptyPilot=randomUUID();response=await call(`/api/staff/operations/pilots/${emptyPilot}`);assert.equal(response.status,200);
    const summary=(await response.json()).summary;assert.deepEqual(summary.initializations,[]);assert.deepEqual(summary.costs,[]);assert.deepEqual(summary.specimens,[]);checks++;
    response=await call('/api/staff/operations/machine/admit',{jobId:randomUUID(),specimenId:id,reason:'Owned synthetic disabled admission.',authorizationEvidenceHash:'a'.repeat(64)},signed.csrf);
    assert.equal(response.status,503);assert.equal((await response.json()).error,'MACHINE_ADMISSION_NOT_CONFIGURED');checks++;
    response = await call('/api/staff/cards'); assert.equal((await response.json()).cards.find(c => c.id === id).disposition, 'HUMAN_APPROVED'); checks++;
    response = await publicCall(approval.path); assert.equal(response.status, 200, await response.clone().text());
    const publicHtml = await response.text(); assert.match(publicHtml, /SYNTHETIC DEMONSTRATION/); assert.match(publicHtml, /Human-approved grade/);
    assert(!publicHtml.includes(input.observations.FRONT)); assert.match(response.headers.get('cache-control'), /no-store/); checks++;
    const publicData = JSON.parse(publicHtml.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)[1]).props.pageProps;
    assert(!publicHtml.includes('sourceRef')); assert(!publicHtml.includes('sample-00')); assert(!publicHtml.includes('fixture-private-removed'));
    const mediaBase = `/api/reports/${publicData.packet.publicToken}`, imageHashes = {};
    for (const side of ['FRONT', 'BACK']) {
        response = await publicCall(`${mediaBase}/images/${side}?v=1`); assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type').split(';')[0], 'image/svg+xml');
        assert.match(response.headers.get('cache-control'), /no-store/); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.length, publicData.packet.images[side].byteCount); assert.equal(hash(bytes), publicData.packet.images[side].sha256);
        imageHashes[side] = hash(bytes); checks++;
    }
    response = await publicCall(`${mediaBase}/images/FRONT?v=1`, { method: 'HEAD' });
    assert.equal(response.status, 200); assert.equal(Number(response.headers.get('content-length')), publicData.packet.images.FRONT.byteCount);
    assert.equal((await response.arrayBuffer()).byteLength, 0); checks++;
    response = await publicCall(`${mediaBase}/traces/${encodeURIComponent('FRONT:fixture-1:SURFACE')}?v=1`);
    assert.equal(response.status, 200); const publicTrace = await response.json();
    assert.equal(publicTrace.publicHash, publicData.publicHash);
    assert.equal(decodeSpeedsterTraceBitmapWireV1(publicTrace.traceWire).reduce((sum, p) => sum + p, 0), 400);
    assert.deepEqual(Object.keys(publicTrace).sort(), ['publicHash', 'side', 'traceWire']); checks++;
    for (const path of [`${mediaBase}/images/FRONT?v=2`, `${mediaBase}/images/FRONT`, `${mediaBase}/images/ORIGINAL?v=1`,
        `${mediaBase}/traces/unknown?v=1`, `${mediaBase}/traces/${encodeURIComponent('FRONT:fixture-private-removed:SURFACE')}?v=1`]) {
        response = await publicCall(path); assert.equal(response.status, 404); checks++;
    }
    response = await publicCall(`${mediaBase}/images/FRONT?v=1`, { method: 'POST' }); assert.equal(response.status, 405); checks++;
    response = await publicCall(approval.path.replace('?v=1', '?v=2')); assert.equal(response.status, 404); checks++;
    response = await publicCall('/api/staff/session'); assert.equal(response.status, 404); checks++;
    response = await publicCall(approval.path, { headers: { 'x-forwarded-host': 'app.atlasgrading.com' } }); assert.equal(response.status, 503); checks++;
    await stopWeb(); await stopPublic(); await startWeb(path); await startPublic(publicPath);
    response = await publicCall(approval.path); assert.equal(response.status, 200); assert.match(await response.text(), /Approved version <!-- -->1/); checks++;
    for (const side of ['FRONT', 'BACK']) {
        response = await publicCall(`${mediaBase}/images/${side}?v=1`); assert.equal(response.status, 200);
        assert.equal(hash(Buffer.from(await response.arrayBuffer())), imageHashes[side]); checks++;
    }
    response = await call(`/api/staff/cards/${id}`); assert.equal(response.status, 200, await response.clone().text());
    const restored = (await response.json()).card; assert.equal(restored.draft.revision, 2); assert.deepEqual(restored.draft.observations, input.observations); checks++;
    assert.equal(restored.grading.sourceRevision, 'local-illustration-v1'); checks++;
    response = await call(`/cards/${id}`); assert.equal(response.status, 200);
    assert.match(await response.text(), /Card review/); checks++;
    response = await call(`/api/staff/cards/${id}/identity-correction`, {}, signed.csrf);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'IDENTITY_REQUEST_INVALID' }); checks++;
    response = await call(`/api/staff/cards/${id}/draft`, input, signed.csrf); assert.equal(response.status, 200); assert.equal((await response.json()).card.draft.revision, 2); checks++;
    assert.equal(restored.grading.published.matchesCurrent, true); assert.equal(restored.grading.published.version, 1); checks++;
    response=await call(`/api/staff/cards/${id}/finishing/label`,labelInput,signed.csrf);assert.equal(response.status,200);
    assert.deepEqual((await response.json()).receipt,label);checks++;
    response=await call(`/api/staff/cards/${id}/finishing`);assert.equal(response.status,200);
    const recoveredFinishing=(await response.json()).finishing;assert.equal(recoveredFinishing.labels.length,1);
    assert.deepEqual(recoveredFinishing.jobs,[]);assert.deepEqual(recoveredFinishing.physical,[]);checks++;
    response=await call('/api/staff/operations/roster/update',rosterInput,signed.csrf);assert.equal(response.status,200);
    assert.deepEqual((await response.json()).receipt,rosterReceipt);checks++;
    response=await call(`/api/staff/cards/${id}/learning`);assert.equal(response.status,200);checks++;
    response = await call(`/api/staff/cards/${id}/approve`, approvalInput, signed.csrf);
    assert.equal(response.status, 200, await response.clone().text()); assert.deepEqual((await response.json()).approval, approval); checks++;
    response=await call('/?reauthenticate=1');assert.equal(response.status,200);assert.match(await response.text(),/Complete a fresh sign-in/);checks++;
    response=await call('/api/staff/session?reauthenticate=1');assert.equal(response.status,200);
    const reauth=await response.json();assert.equal(reauth.staff.id,signed.staff.id);assert.notEqual(reauth.csrf,signed.csrf);checks++;
    response=await call('/api/staff/auth/request',{phone:'+12025550141',requestId:randomUUID()},reauth.csrf);
    assert.equal(response.status,200,await response.clone().text());const freshChallenge=await response.json();checks++;
    response=await call('/api/staff/auth/verify',{challengeId:freshChallenge.challengeId,code:'424242'},reauth.csrf);
    assert.equal(response.status,200,await response.clone().text());signed=await response.json();checks++;
    response=await call('/api/staff/operations/roster');assert.equal(response.status,200);checks++;
    response = await call('/api/staff/auth/logout', {}, signed.csrf); assert.equal(response.status, 200);
    response = await call('/api/staff/cards'); assert.equal(response.status, 401); checks++;
    writeFileSync(join(fixture.directory, 'web-result.json'), JSON.stringify({ ok: true, checks, actualWebProcessRestart: true, publicAppRestart: true,
        publicPath: approval.path, imageHashes, mode: 'LOCAL_FIXTURE' }, null, 2));
    console.log(JSON.stringify({ status: 'PERSISTENT_STAFF_WEB_PASS', checks, directory: fixture.directory, actualWebProcessRestart: true, publicAppRestart: true }));
    if (process.argv.includes('--serve')) {
        console.log(`Persistent synthetic ATLAS preview: ${origin}/admin; public reports: ${PUBLIC_LOCAL_ORIGIN}`);
        await new Promise(done => server.once('exit', done));
    }
} finally { await stop(); }
