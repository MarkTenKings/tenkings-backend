import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../lib/server/http.mjs';
import { LOCAL_HOST, LOCAL_ORIGIN, deny } from '../lib/server/policy.mjs';

test('named finishing, recovery and machine routes enforce staff method/CSRF and preserve exact response envelopes', async () => {
    const actor = Object.freeze({ id: randomUUID() }), calls = [], card = randomUUID(), job = randomUUID();
    const method = name => async (staff, ...args) => { assert.equal(staff, actor); calls.push({ name, args }); return { received: name }; };
    const state = { auth: { async authenticate(cookie, csrf) {
        if (cookie !== 'synthetic-session') deny(401, 'SIGN_IN_REQUIRED');
        if (csrf !== undefined && csrf !== 'synthetic-csrf') deny(403, 'CSRF_REQUIRED'); return actor;
    } }, review: {}, finishing: Object.fromEntries(['read', 'retrieveNfcJob', 'issueLabel', 'createNfcJob', 'recordNfcVerification', 'recordPhysical'].map(name => [name, method(name)])),
        resolution: Object.fromEntries(['inspect', 'cancelUndispatchedInitialization', 'abandonUnknown'].map(name => [name, method(name)])),
        machine: { admit: method('admit'), status: method('status') },
        learning: { read: method('learningRead'), preview: method('learningPreview'), decide: method('learningDecide') },
        identityCorrection: { correct: method('identityCorrect') } };
    const handler = createHandler(state, { NODE_ENV: 'development', ATLAS_LOCAL_SYNTHETIC: '1' });
    async function call(path, requestMethod = 'POST', headers = {}, body = { exact: 'body' }) {
        const out = {}, response = { setHeader() {}, status(status) { out.status = status; return this; }, json(value) { out.body = value; return this; } };
        await handler({ url: `/api/staff/${path}`, method: requestMethod, body, socket: { remoteAddress: '127.0.0.1' },
            headers: { host: LOCAL_HOST, origin: LOCAL_ORIGIN, cookie: 'synthetic-session', 'content-type': 'application/json',
                'x-atlas-csrf': 'synthetic-csrf', ...headers } }, response); return out;
    }
    for (const path of [`cards/${card}/finishing/label`, `cards/${card}/learning/preview`, `cards/${card}/identity-correction`, 'operations/resolution/inspect', 'operations/machine/admit']) {
        assert.equal((await call(path, 'POST', { cookie: '' })).status, 401);
        assert.equal((await call(path, 'POST', { 'x-atlas-csrf': '' })).status, 403);
        assert.equal((await call(path, 'POST', { origin: 'https://evil.test' })).status, 403);
        assert.equal((await call(path, 'GET')).status, 405);
        assert.equal((await call(path, 'POST', {}, { huge: 'x'.repeat(16384) })).status, 413);
    }
    assert.equal(calls.length, 0);
    for (const [path, requestMethod, name, envelope] of [[`cards/${card}/finishing`, 'GET', 'read', 'finishing'],
        [`cards/${card}/finishing/nfc-job/${job}`, 'GET', 'retrieveNfcJob', null],
        ...[['label', 'issueLabel'], ['nfc-job', 'createNfcJob'], ['nfc-verify', 'recordNfcVerification'], ['physical', 'recordPhysical']]
            .map(([path, name]) => [`cards/${card}/finishing/${path}`, 'POST', name, 'receipt']),
        ['operations/resolution/inspect', 'POST', 'inspect', 'record'],
        ['operations/resolution/cancel-initialization', 'POST', 'cancelUndispatchedInitialization', 'receipt'],
        ['operations/resolution/abandon', 'POST', 'abandonUnknown', 'receipt'],
        ['operations/machine/admit', 'POST', 'admit', 'receipt'], [`operations/machine/${job}`, 'GET', 'status', 'receipt'],
        [`cards/${card}/learning`, 'GET', 'learningRead', 'learning'],
        [`cards/${card}/learning/preview`, 'POST', 'learningPreview', 'preview'],
        [`cards/${card}/learning/decisions`, 'POST', 'learningDecide', 'receipt'],
        [`cards/${card}/identity-correction`, 'POST', 'identityCorrect', 'correction']]) {
        const result = await call(path, requestMethod); assert.equal(result.status, 200, path);
        assert.deepEqual(result.body, envelope ? { [envelope]: { received: name } } : { received: name });
        if (name === 'retrieveNfcJob') assert.deepEqual(calls.at(-1).args, [card, job]);
    }
    assert.equal((await call('operations/machine/execute')).status, 404);
    assert.equal((await call(`cards/${card}/learning/decisions`, 'POST', {}, { candidateIds: Array(256).fill('a'.repeat(64)) })).status, 200);
    assert.equal((await call(`cards/${card}/learning/decisions`, 'POST', {}, { huge: 'x'.repeat(32768) })).status, 413);
});
