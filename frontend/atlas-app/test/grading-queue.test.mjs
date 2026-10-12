import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/server/http.mjs';
import { LOCAL_HOST, LOCAL_ORIGIN, deny } from '../lib/server/policy.mjs';
import { DurableReviewStore } from '../lib/server/access/review.mjs';

test('assigned-report reads remain available with no processing runtime and never convert a genuine failure to an empty success', async () => {
    const staff = Object.freeze({ id: 'reviewer' }); let failure = null, calls = 0;
    const context = { identity: staff, now: new Date(), tx: { staffAssignment: { async findMany({ where }) {
        calls++; assert.equal(where.identityId, staff.id); assert.equal(where.revokedAt, null); assert.equal(where.expiresAt.gt, context.now);
        if (failure) throw failure;
        return [];
    } } } };
    const auth = { async authenticate(cookie) { if (cookie !== 'fixture-session') deny(401, 'SIGN_IN_REQUIRED'); return staff; },
        async withStaff(actor, work) { assert.equal(actor, staff); return work(context); } };
    const review = new DurableReviewStore({ auth });
    const handler = createHandler({ auth, review }, { NODE_ENV: 'development', ATLAS_LOCAL_SYNTHETIC: '1' });
    async function get(cookie = 'fixture-session') {
        const out = {}, res = { setHeader() {}, status(status) { out.status = status; return this; }, json(body) { out.body = body; return this; } };
        await handler({ url: '/api/staff/cards', method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: LOCAL_HOST, origin: LOCAL_ORIGIN, cookie } }, res);
        return out;
    }
    assert.deepEqual(await get(), { status: 200, body: { cards: [] } });
    failure = new Error('Private database failure that must not reach the browser');
    const failed = await get();
    assert.match(failed.body.reference, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.deepEqual(failed, { status: 503, body: { error: 'TEMPORARILY_UNAVAILABLE', reference: failed.body.reference } });
    failure = null;
    assert.deepEqual(await get(), { status: 200, body: { cards: [] } });
    assert.deepEqual(await get('expired-session'), { status: 401, body: { error: 'SIGN_IN_REQUIRED' } });
    assert.equal(calls, 3);
});
