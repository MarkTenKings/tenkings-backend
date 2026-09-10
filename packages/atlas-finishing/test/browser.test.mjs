import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { ATLAS_HELPER, createAtlasNfcBrowser, createFinishingRequests, approvedReportUrl } from '../browser.mjs';
import { ATLAS_NFC, nfcJobEnvelopeSha256 } from '../src/nfc.mjs';
const vector = JSON.parse(await readFile(new URL('./nfc-vector.json', import.meta.url)));
const canonical = v => v && typeof v === 'object' ? Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
    : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v);
const sha = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value), TOKEN = 'synthetic_atlas_token_'.padEnd(50, 'a');
const job = { id: 'job-synthetic-1', job: vector.job, jobEnvelopeSha256: nfcJobEnvelopeSha256(vector.job), expiresAt: vector.job.expiresAt };
const caps = { helperCapability: ATLAS_NFC.helperCapability, workstationKeyId: vector.result.workstationKeyId, trustedJobSigningKeyIds: [vector.job.signingKeyId] };
function operation(phase = 'completed') { return { helperProtocolVersion: ATLAS_HELPER.protocol, helperVersion: 'tenkings-ai-grader-nfc-helper-v4', helperCapability: ATLAS_NFC.helperCapability,
    jobEnvelopeSha256: job.jobEnvelopeSha256, ...vector.approvedReport, url: vector.job.url, phase,
    terminal: !['preparing', 'awaiting_manual_start'].includes(phase), errorCode: null,
    discardAcknowledgementNonce: 'a'.repeat(32), result: ['completed', 'closing_success'].includes(phase) ? copy(vector.result) : null }; }
const receipt = { id: 'verified-1', approvalId: vector.job.approvalId, jobId: job.id, resultHash: sha(canonical(vector.result)), status: 'URL_AND_PERMANENT_LOCK_VERIFIED' };
function response(data, status = 200) { return new Response(JSON.stringify(data), { status }); }
function fixture(handler = () => null) {
    const calls = [];
    const client = createAtlasNfcBrowser({ cryptoImpl: webcrypto, now: () => Date.parse(vector.now), fetchImpl: async (url, init) => {
        const call = { url, ...init, body: init.body ? JSON.parse(init.body) : null }; calls.push(call);
        const handled = await handler(call, calls.length); if (handled) return handled;
        return response({ ok: true, result: url.endsWith('/capabilities') ? caps : operation(), error: null });
    } });
    client.setToken(TOKEN); return { client, calls };
}
async function prepared(f = fixture()) { await f.client.connect(); await f.client.prepare(job, { freshTagConfirmed: true }); return f; }

test('helper streaming overflow cancels and releases at the byte limit without draining the body', async () => {
    let reads = 0, cancelled = 0, released = 0;
    const client = createAtlasNfcBrowser({ fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers(), body: {
        getReader: () => ({ read: async () => { reads++; return { done: false, value: new Uint8Array(40000) }; },
            cancel: () => { cancelled++; }, releaseLock: () => { released++; } }),
    } }) });
    client.setToken(TOKEN);
    await assert.rejects(client.connect(), { code: 'RESPONSE_UNCONFIRMED', uncertain: true });
    assert.equal(reads, 2); assert.equal(cancelled, 1); assert.equal(released, 1);
});

test('oversized or invalid declared response length is rejected before obtaining a reader', async () => {
    for (const length of ['65537', '-1', 'bad', '9007199254740992']) {
        let cancelled = 0;
        const client = createAtlasNfcBrowser({ fetchImpl: async () => ({ ok: true, status: 200,
            headers: new Headers({ 'Content-Length': length }), body: {
                getReader: () => assert.fail('must reject before reading'), cancel: () => { cancelled++; },
            } }) });
        client.setToken(TOKEN); await assert.rejects(client.connect(), { code: 'RESPONSE_UNCONFIRMED', uncertain: true });
        assert.equal(cancelled, 1);
    }
});

test('uncooperative body timeout cancels/releases and keeps the exact uncertain hosted save for retry', { timeout: 1000 }, async () => {
    let cancelled = 0, released = 0, signal;
    const bodies = [];
    const client = createFinishingRequests({ cardId: '10000000-0000-4000-8000-000000000001', csrf: 'synthetic', timeoutMs: 10,
        randomUUID: () => 'synthetic-operation-1', fetchImpl: async (_url, init) => {
            bodies.push(init.body); signal = init.signal;
            if (bodies.length > 1) return response({ receipt: { id: 'saved-label' } });
            return { ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({
                read: () => new Promise(() => {}), cancel: () => { cancelled++; return new Promise(() => {}); },
                releaseLock: () => { released++; },
            }) } };
        } });
    await assert.rejects(client.mutate('label', { approvalId: vector.job.approvalId }), { code: 'CONNECTION_UNCONFIRMED', uncertain: true });
    assert.equal(signal.aborted, true); assert.equal(cancelled, 1); assert.equal(released, 1);
    assert.deepEqual(client.pending(), { kind: 'label', operationId: 'synthetic-operation-1', uncertain: true, rejected: false });
    assert.deepEqual(await client.retry(), { id: 'saved-label' }); assert.equal(bodies[1], bodies[0]); assert.equal(client.pending(), null);
});

test('uncooperative fetch timeout returns and cancels a response arriving after the deadline', { timeout: 1000 }, async () => {
    let resolveFetch, cancelled = 0;
    const client = createAtlasNfcBrowser({ timeoutMs: 10, fetchImpl: () => new Promise(resolve => { resolveFetch = resolve; }) });
    client.setToken(TOKEN); await assert.rejects(client.connect(), { code: 'CONNECTION_UNCONFIRMED', uncertain: true });
    resolveFetch({ body: { cancel: () => { cancelled++; } } });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, 1);
});

test('browser uses exact separate ATLAS capability, profile, loopback boundary and public URL vector', async () => {
    const f = await prepared();
    assert.equal(ATLAS_HELPER.capability, ATLAS_NFC.helperCapability);
    assert.equal(approvedReportUrl(vector.job.publicToken, 2), vector.job.url);
    assert.deepEqual(f.client.verificationInput(), { jobId: job.id, result: vector.result });
    assert.equal(f.calls.length, 2);
    for (const c of f.calls) {
        assert.match(c.url, /^http:\/\/127\.0\.0\.1:47662\/atlas\/(capabilities|prepare)$/);
        assert.equal(c.credentials, 'omit'); assert.equal(c.redirect, 'error'); assert.equal(c.referrerPolicy, 'no-referrer');
        assert.equal(c.headers['x-tenkings-nfc-token'], TOKEN); assert.ok(!c.url.includes(TOKEN));
    }
    assert.deepEqual(f.calls[1].body, { job: vector.job, freshTagConfirmed: true });
    assert.doesNotMatch(JSON.stringify(f.client.summary()), new RegExp(`${TOKEN}|${vector.job.nonce}|${vector.result.workstationKeyId}`));
    const view = f.client.verificationInput(); view.result.url = 'substitution'; assert.equal(f.client.verificationInput().result.url, vector.job.url);
});

test('fresh human confirmation and exact separate key capability required before preparation', async () => {
    const f = fixture(); await assert.rejects(f.client.prepare(job), { code: 'FRESH_TAG_CONFIRMATION_REQUIRED' }); assert.equal(f.calls.length, 0);
    await f.client.connect();
    await assert.rejects(f.client.prepare({ ...job, job: { ...job.job, signingKeyId: 'b'.repeat(64) } }, { freshTagConfirmed: true }), { code: 'ATLAS_JOB_TRUST_MISMATCH' });
    assert.equal(f.calls.length, 1);
    const legacy = fixture(() => response({ ok: true, result: { ...caps, helperCapability: 'ten-kings-v2-report-f8215-v1' } }));
    await assert.rejects(legacy.client.connect(), { code: 'ATLAS_CAPABILITY_REQUIRED' });
});

test('helper substitution of each approved binding/readback/lock/capability fails closed', async () => {
    const changes = { specimenId: 'other-specimen', approvalId: 'other-approval', approvalVersion: 3, publicToken: 'ar_BBBBBBBBBBBBBBBBBBBBBBBB', publicHash: 'b'.repeat(64),
        url: 'https://collect.tenkings.co/nfc/legacy', jobEnvelopeSha256: 'b'.repeat(64), helperCapability: 'legacy' };
    for (const [key, value] of Object.entries(changes)) {
        const f = fixture(c => c.url.endsWith('/prepare') ? response({ ok: true, result: { ...operation(), [key]: value } }) : null);
        await f.client.connect(); await assert.rejects(f.client.prepare(job, { freshTagConfirmed: true }), { code: 'HELPER_RESPONSE_INVALID' }, key);
    }
    for (const [key, value] of Object.entries({ writeProtectionState: 'read_only_claimed', readbackPayloadSha256: 'b'.repeat(64), workstationKeyId: 'b'.repeat(64), nonce: 'a'.repeat(43), observedAt: '2026-09-08T12:11:00.000Z' })) {
        const op = operation(); op.result[key] = value;
        const f = fixture(c => c.url.endsWith('/prepare') ? response({ ok: true, result: op }) : null);
        await f.client.connect(); await assert.rejects(f.client.prepare(job, { freshTagConfirmed: true }), { code: 'HELPER_RESPONSE_INVALID' }, key);
    }
});

test('lost prepare retains the same job; status retrieves result without repeating device preparation', async () => {
    let lose = true;
    const f = fixture(c => { if (c.url.endsWith('/prepare') && lose) { lose = false; throw new Error('synthetic lost reply'); } });
    await f.client.connect(); await assert.rejects(f.client.prepare(job, { freshTagConfirmed: true }), { code: 'CONNECTION_UNCONFIRMED' });
    assert.equal(f.client.summary().jobId, job.id);
    assert.equal((await f.client.status()).phase, 'completed');
    assert.equal(f.calls.filter(c => c.url.endsWith('/prepare')).length, 1);
    assert.deepEqual(f.calls.at(-1).body, { jobEnvelopeSha256: job.jobEnvelopeSha256 });
    await assert.rejects(f.client.prepare({ ...job, id: 'job-other' }, { freshTagConfirmed: true }), { code: 'HELPER_JOB_STILL_OPEN' });
});

test('success acknowledgement requires exact hosted receipt and explicit tag removal; lost reply retries exact cleanup', async () => {
    let attempts = 0;
    const f = await prepared(fixture(c => {
        if (!c.url.endsWith('/success-ack')) return null;
        if (++attempts === 1) throw new Error('lost ack response');
        return response({ ok: false, error: { code: 'atlas_nfc_job_not_found' } }, 404);
    }));
    await assert.rejects(f.client.acknowledgeSuccess({ receipt }), { code: 'TAG_REMOVAL_CONFIRMATION_REQUIRED' });
    await assert.rejects(f.client.acknowledgeSuccess({ receipt: { ...receipt, jobId: 'other' }, tagRemoved: true }), { code: 'HOSTED_VERIFICATION_REQUIRED' });
    await assert.rejects(f.client.acknowledgeSuccess({ receipt: { ...receipt, resultHash: 'a'.repeat(64) }, tagRemoved: true }), { code: 'HOSTED_VERIFICATION_REQUIRED' });
    assert.equal(attempts, 0);
    await assert.rejects(f.client.acknowledgeSuccess({ receipt, tagRemoved: true }), { code: 'CONNECTION_UNCONFIRMED' });
    assert.equal(f.client.summary().hostedVerified, true);
    await assert.rejects(f.client.acknowledgeDiscard({ tagRemoved: true }), { code: 'DISCARD_CONFIRMATION_UNAVAILABLE' });
    assert.deepEqual(await f.client.acknowledgeSuccess({ receipt, tagRemoved: true }), { state: 'NO_ACTIVE_OPERATION_AFTER_ACK_RETRY' });
    const acks = f.calls.filter(c => c.url.endsWith('/success-ack')); assert.deepEqual(acks[0].body, acks[1].body);
    assert.deepEqual(acks[0].body, { jobEnvelopeSha256: job.jobEnvelopeSha256, tagRemoved: true });
    assert.equal(f.client.summary().jobId, null);
});

test('fresh first cleanup 404 does not pretend an acknowledgement; disconnect erases usable credentials', async () => {
    const f = await prepared(fixture(c => c.url.endsWith('/success-ack') ? response({ ok: false, error: { code: 'atlas_nfc_job_not_found' } }, 404) : null));
    await assert.rejects(f.client.acknowledgeSuccess({ receipt, tagRemoved: true }), { code: 'atlas_nfc_job_not_found' });
    f.client.disconnect(); await assert.rejects(f.client.connect(), { code: 'ATLAS_WORKSTATION_TOKEN_REQUIRED' });
});

test('quarantine cleanup carries the exact failure phase/nonce and never accepts missing human removal', async () => {
    const f = await prepared(fixture(c => c.url.endsWith('/prepare') ? response({ ok: true, result: operation('uncertain') })
        : c.url.endsWith('/discard-ack') ? response({ ok: true, result: { cleaned: true } }) : null));
    await assert.rejects(f.client.acknowledgeDiscard(), { code: 'TAG_REMOVAL_CONFIRMATION_REQUIRED' });
    await f.client.acknowledgeDiscard({ tagRemoved: true });
    assert.deepEqual(f.calls.at(-1).body, { jobEnvelopeSha256: job.jobEnvelopeSha256, acknowledgementNonce: 'a'.repeat(32), phase: 'uncertain', tagRemoved: true });
});

const cardId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('hosted saves retain exact operation and body across loss, session rejection and expiry-safe retry', async () => {
    const calls = []; let sequence = 0;
    const c = createFinishingRequests({ cardId, csrf: 'synthetic-csrf', randomUUID: () => 'synthetic-operation-1', fetchImpl: async (url, init) => {
        calls.push({ url, ...init });
        if (++sequence === 1) throw new Error('lost after commit');
        if (sequence === 2) return response({ error: 'FRESH_SIGN_IN_REQUIRED' }, 403);
        return response({ receipt });
    } });
    const input = { jobId: job.id, result: copy(vector.result) };
    await assert.rejects(c.mutate('nfc-verify', input), { code: 'CONNECTION_UNCONFIRMED' }); input.result.url = 'changed outside pending request';
    assert.equal(c.pending().uncertain, true);
    assert.throws(() => c.mutate('label', {}), { code: 'SAVE_PENDING' });
    await assert.rejects(c.retry(), { code: 'FRESH_SIGN_IN_REQUIRED' });
    assert.throws(() => c.clearRejected(), { code: 'SAVE_PENDING' });
    c.setCsrf('renewed-synthetic-csrf'); assert.deepEqual(await c.retry(), receipt);
    assert.equal(new Set(calls.map(call => call.body)).size, 1); assert.equal(calls[2].headers['X-Atlas-Csrf'], 'renewed-synthetic-csrf');
    assert.deepEqual(JSON.parse(calls[0].body), { jobId: job.id, result: vector.result, operationId: 'synthetic-operation-1' });
    assert.equal(c.pending(), null); assert.equal(calls[0].url, `/admin/api/staff/cards/${cardId}/finishing/nfc-verify`);
    assert.equal(calls[0].credentials, 'same-origin'); assert.ok(!calls[0].headers['x-tenkings-nfc-token']);
});

test('hosted definitive rejection can be dismissed, and read requires matching specimen', async () => {
    let mode = 'reject', ids = 0;
    const c = createFinishingRequests({ cardId, randomUUID: () => `op-${++ids}`, fetchImpl: async (_url, init) => mode === 'reject'
        ? response({ error: 'APPROVAL_CHANGED' }, 409) : init.method === 'GET' ? response({ finishing: { specimenId: mode === 'read' ? cardId : 'other' } }) : response({ receipt }) });
    await assert.rejects(c.mutate('label', { approvalId: vector.job.approvalId }), { code: 'APPROVAL_CHANGED' });
    assert.equal(c.pending().rejected, true); c.clearRejected(); assert.equal(c.pending(), null);
    mode = 'read'; assert.equal((await c.read()).specimenId, cardId);
    mode = 'other'; await assert.rejects(c.read(), { code: 'FINISHING_UNAVAILABLE' });
});

test('exact discard retry preserves original nonce and phase through closing status and lost cleanup', async () => {
    let attempt = 0;
    const f = await prepared(fixture(c => c.url.endsWith('/prepare') ? response({ ok: true, result: operation('uncertain') })
        : c.url.endsWith('/status') ? response({ ok: true, result: { ...operation('closing_discard_uncertain'), errorCode: 'closing_from_uncertain' } })
        : c.url.endsWith('/discard-ack') ? (++attempt === 1 ? Promise.reject(new Error('lost cleanup')) : response({ ok: false, error: { code: 'atlas_nfc_job_not_found' } }, 404)) : null));
    await assert.rejects(f.client.acknowledgeDiscard({ tagRemoved: true }), { code: 'CONNECTION_UNCONFIRMED' });
    await f.client.status();
    assert.deepEqual(await f.client.acknowledgeDiscard({ tagRemoved: true }), { state: 'NO_ACTIVE_OPERATION_AFTER_DISCARD_RETRY' });
    const calls = f.calls.filter(c => c.url.endsWith('/discard-ack')); assert.deepEqual(calls[0].body, calls[1].body); assert.equal(calls[1].body.phase, 'uncertain');
});

test('expired preparation is rejected before transport while retained status remains retrievable', async () => {
    let now = Date.parse(vector.now), calls = 0;
    const c = createAtlasNfcBrowser({ cryptoImpl: webcrypto, now: () => now, fetchImpl: async url => { calls++; return response({ ok: true, result: url.endsWith('/capabilities') ? caps : operation() }); } });
    c.setToken(TOKEN); await c.connect(); await c.prepare(job, { freshTagConfirmed: true });
    now += 3_600_000;
    assert.equal((await c.status()).phase, 'completed'); const before = calls;
    await assert.rejects(c.prepare(job, { freshTagConfirmed: true }), { code: 'ATLAS_JOB_EXPIRED' }); assert.equal(calls, before);
});

test('browser default port/protocol/capability remain equal to reviewed helper source', async () => {
    const contracts = await readFile(new URL('../../ai-grader-nfc-helper/src/TenKings.AiGrader.NfcHelper/NfcContracts.cs', import.meta.url), 'utf8');
    assert.equal(ATLAS_HELPER.baseUrl, `http://127.0.0.1:${contracts.match(/DefaultPort = (\d+)/)[1]}`);
    assert.equal(ATLAS_HELPER.protocol, contracts.match(/ProtocolVersion = "([^"]+)"/)[1]);
    assert.equal(ATLAS_HELPER.jobSchema, ATLAS_NFC.jobSchema); assert.equal(ATLAS_HELPER.resultSchema, ATLAS_NFC.resultSchema);
});

test('crash recovery restores an expired saved result with status only and exact hosted verification before cleanup', async () => {
    const calls = [];
    const c = createAtlasNfcBrowser({ cryptoImpl: webcrypto, now: () => Date.parse(vector.now) + 3600000, fetchImpl: async (url, init) => {
        calls.push({ url, ...init }); return response({ ok: true, result: url.endsWith('/capabilities') ? caps : url.endsWith('/success-ack') ? { cleaned: true } : operation() });
    } });
    c.setToken(TOKEN); await c.connect();
    const recovered = { receipt: job, recoveryOnly: true, verification: receipt };
    assert.equal((await c.resume(recovered)).phase, 'completed'); assert.deepEqual(c.hostedVerification(), receipt);
    await assert.rejects(c.prepare(job, { freshTagConfirmed: true }), { code: 'NFC_RECOVERY_STATUS_ONLY' });
    await assert.rejects(c.acknowledgeDiscard({ tagRemoved: true }), { code: 'DISCARD_CONFIRMATION_UNAVAILABLE' });
    await assert.rejects(c.acknowledgeSuccess({ receipt }), { code: 'TAG_REMOVAL_CONFIRMATION_REQUIRED' });
    await c.acknowledgeSuccess({ receipt, tagRemoved: true });
    assert.equal(calls.filter(call => call.url.endsWith('/prepare')).length, 0);
    assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/atlas/capabilities', '/atlas/status', '/atlas/success-ack']);
    await assert.rejects(c.prepare(job, { freshTagConfirmed: true }), { code: 'NFC_RECOVERY_STATUS_ONLY' });
});

test('unrecorded recovery cannot claim hosted completion, and can explicitly quarantine exact completed result', async () => {
    const f = fixture(c => c.url.endsWith('/discard-ack') ? response({ ok: true, result: { cleaned: true } }) : null);
    await f.client.connect(); await f.client.resume({ receipt: job, recoveryOnly: true, verification: null });
    assert.equal(f.client.hostedVerification(), null);
    await assert.rejects(f.client.acknowledgeSuccess({ tagRemoved: true }), { code: 'HOSTED_VERIFICATION_REQUIRED' });
    await f.client.acknowledgeDiscard({ tagRemoved: true });
    assert.equal(f.calls.at(-1).body.phase, 'completed_unrecorded');
    assert.equal(f.calls.filter(call => call.url.endsWith('/prepare')).length, 0);
});

test('fresh-browser recovery reconstructs exact previously closing quarantine phase and nonce', async () => {
    const f = fixture(c => c.url.endsWith('/status') ? response({ ok: true, result: { ...operation('closing_discard_uncertain'), errorCode: 'closing_from_uncertain' } })
        : c.url.endsWith('/discard-ack') ? response({ ok: true, result: { cleaned: true } }) : null);
    await f.client.connect(); await f.client.resume({ receipt: job, recoveryOnly: true, verification: null });
    await f.client.acknowledgeDiscard({ tagRemoved: true });
    assert.deepEqual(f.calls.at(-1).body, { jobEnvelopeSha256: job.jobEnvelopeSha256, acknowledgementNonce: 'a'.repeat(32), phase: 'uncertain', tagRemoved: true });
});

test('recovery rejects mismatched hosted proof and cannot escape status-only by closing the view', async () => {
    const f = fixture(); await f.client.connect();
    await assert.rejects(f.client.resume({ receipt: job, recoveryOnly: true, verification: { ...receipt, resultHash: 'f'.repeat(64) } }), { code: 'HOSTED_VERIFICATION_REQUIRED' });
    f.client.releaseRecovery();
    await assert.rejects(f.client.prepare(job, { freshTagConfirmed: true }), { code: 'NFC_RECOVERY_STATUS_ONLY' });
    assert.equal(f.client.summary().recoveryOutstanding, true);
    assert.equal(f.calls.filter(call => call.url.endsWith('/prepare')).length, 0);
});

test('recovery retrieval is a same-origin read with explicit recovery marker, not a signed-job mutation', async () => {
    const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', calls = [];
    const c = createFinishingRequests({ cardId, fetchImpl: async (url, init) => { calls.push({ url, ...init });
        return response({ receipt: { ...job, id: jobId, job: { ...job.job, specimenId: cardId } }, recoveryOnly: true, verification: null }); } });
    const recovered = await c.retrieveNfcJob(jobId);
    assert.equal(recovered.receipt.recoveryOnly, true); assert.equal(c.pending(), null);
    assert.equal(calls[0].url, `/admin/api/staff/cards/${cardId}/finishing/nfc-job/${jobId}`); assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].credentials, 'same-origin'); assert.equal(calls[0].body, undefined); assert.deepEqual(calls[0].headers, {});
});
