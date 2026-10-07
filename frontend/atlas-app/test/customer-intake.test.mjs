import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { customerIntakeRequest, customerIntakeQueue, customerIntakeReceipt, retainCustomerIntakeRequest } from '../lib/customer-intake-contract.mjs';
import { StaffCustomerIntake } from '../lib/server/access/customer-intake.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { deny, LOCAL_HOST, LOCAL_ORIGIN } from '../lib/server/policy.mjs';

const now = '2026-09-09T09:00:00.123456+00:00';
const profile = { name: 'Fictional Collector', address1: '12 Sample Way', address2: '', city: 'Example', region: 'CA', postalCode: '90210', country: 'US' };
const card = (stage = 'SUBMITTED') => ({ id: randomUUID(), title: `Example ${stage}`, category: 'POKEMON',
    specimenId: stage === 'SUBMITTED' ? null : randomUUID(), stage,
    events: [...new Set(['SUBMITTED', stage])].map(kind => ({ kind, recordedAt: now })), actionNeeded: null,
    shipment: stage === 'SHIPPED' ? { carrier: 'USPS', trackingNumber: 'EXAMPLE123', recordedAt: now } : null,
    reportUrl: ['APPROVED', 'ENCAPSULATED', 'SHIPPED'].includes(stage) ? `/reports/ar_${'a'.repeat(24)}?v=1` : null });
const queue = () => ({ submissions: [{ id: randomUUID(), reference: 'ATLAS-123456ABCDEF', createdAt: now, intakeMethod: 'MAIL_IN',
    profileSnapshot: structuredClone(profile), cards: [card(), card('APPROVED'), card('SHIPPED')] }], nextCursor: null });
const bind = () => ({ operationId: randomUUID(), cardId: randomUUID(), specimenId: randomUUID(), physicalReceiptConfirmed: true });
const result = (request, kind = 'RECEIVED') => ({ receipt: { id: randomUUID(), operationId: request.operationId, cardId: request.cardId, kind, recordedAt: now } });

test('staff commands allow only exact physical or customer-message fields, with no caller authority or arbitrary status', () => {
    const request = bind(); assert.deepEqual(customerIntakeRequest('bind', request), request);
    assert.notEqual(customerIntakeRequest('bind', request), request);
    for (const change of [{ physicalReceiptConfirmed: false }, { physicalReceiptConfirmed: 'true' }, { specimenId: randomUUID().toUpperCase() },
        { operationId: 'not-a-request' }, { accountId: randomUUID() }, { actorId: randomUUID() }, { stage: 'SHIPPED' }, { privateNotes: 'private' }])
        assert.throws(() => customerIntakeRequest('bind', { ...request, ...change }), /CUSTOMER_INTAKE_REQUEST_INVALID/);
    assert.throws(() => customerIntakeRequest('approve', request));
    const { operationId, cardId } = request;
    const message = { operationId, cardId, reason: 'CARD_DETAILS_NEEDED', message: 'Please confirm the printed card number.', resolved: false };
    assert.deepEqual(customerIntakeRequest('action', message), message);
    for (const change of [{ message: '' }, { message: 'x'.repeat(501) }, { message: 'Private\nnotes' }, { reason: 'INTERNAL_ERROR' },
        { resolved: true }, { message: ' padded ' }]) assert.throws(() => customerIntakeRequest('action', { ...message, ...change }));
    assert.deepEqual(customerIntakeRequest('action', { ...message, resolved: true, message: null }), { ...message, resolved: true, message: null });
    const ship = { operationId, cardId, physicalDispatchConfirmed: true, carrier: 'USPS', trackingNumber: 'EXAMPLE123' };
    assert.deepEqual(customerIntakeRequest('ship', ship), ship);
    for (const change of [{ physicalDispatchConfirmed: false }, { carrier: '' }, { trackingNumber: 'ab' }, { shippedAt: now }, { reportApproved: true }])
        assert.throws(() => customerIntakeRequest('ship', { ...ship, ...change }));
    assert.deepEqual(customerIntakeRequest('list', { cursor: null }), { cursor: null });
    assert.throws(() => customerIntakeRequest('list', { cursor: '../account' }));
});

test('mixed-card queue retains per-card evidence and explicit intake method, and rejects private data or invented report URLs', () => {
    const value = queue(); assert.equal(customerIntakeQueue(value), value);
    assert.deepEqual(value.submissions[0].cards.map(card => card.stage), ['SUBMITTED', 'APPROVED', 'SHIPPED']);
    const mutations = [
        value => { value.privateNotes = 'private'; }, value => { value.submissions[0].cards[0].draft = {}; },
        value => { value.submissions[0].profileSnapshot.phone = '+12025550141'; }, value => { value.submissions[0].intakeMethod = 'AUTOMATIC'; },
        value => { value.submissions[0].cards[0].reportUrl = 'https://storage.invalid/private'; },
        value => { value.submissions[0].cards[0].reportUrl = '/admin/cards/private'; },
        value => { value.submissions[0].cards[0].stage = 'SHIPPED'; }, value => { value.submissions[0].cards[2].shipment = null; },
        value => { value.submissions[0].cards[2].specimenId = null; }, value => { value.submissions[0].cards[0].events.push({ kind: 'SUBMITTED', recordedAt: now }); },
        value => { value.submissions[0].cards[0].events[0].recordedAt = 'yesterday'; },
        value => { value.submissions[0].cards.push(value.submissions[0].cards[0]); }, value => { value.submissions[0].profileSnapshot.country = ['US']; },
        value => { value.nextCursor = randomUUID(); },
    ];
    for (const mutate of mutations) { const changed = structuredClone(value); mutate(changed); assert.throws(() => customerIntakeQueue(changed)); }
    value.submissions[0].intakeMethod = 'DEALER_DROP_OFF'; value.nextCursor = value.submissions[0].id;
    assert.equal(customerIntakeQueue(value), value);
});

test('receipt must match the retained exact operation, customer card and requested kind', () => {
    const request = bind(), value = result(request); assert.equal(customerIntakeReceipt(value, 'bind', request), value.receipt);
    for (const change of [{ operationId: randomUUID() }, { cardId: randomUUID() }, { kind: 'SHIPPED' }, { recordedAt: 'soon' }, { private: 'note' }])
        assert.throws(() => customerIntakeReceipt({ receipt: { ...value.receipt, ...change } }, 'bind', request));
    for (const [resolved, kind] of [[false, 'ACTION_NEEDED'], [true, 'ACTION_RESOLVED']])
        assert.equal(customerIntakeReceipt(result(request, kind), 'action', { ...request, resolved }).kind, kind);
});

test('PostgreSQL JSON timestamps retain valid session timezone offsets while malformed offsets are rejected', () => {
    for (const offset of ['-07:00', '+05:30', 'Z', '+00:00']) {
        const timestamp = `2026-09-09T09:00:00.123456${offset}`;
        const value = JSON.parse(JSON.stringify(queue()).replaceAll(now, timestamp));
        value.submissions[0].cards[0].actionNeeded = { reason: 'CONTACT_SUPPORT', message: 'Please contact ATLAS.', recordedAt: timestamp };
        assert.equal(customerIntakeQueue(value), value);
        const request = bind(), receipt = result(request); receipt.receipt.recordedAt = timestamp;
        assert.equal(customerIntakeReceipt(receipt, 'bind', request).recordedAt, timestamp);
    }
    for (const offset of ['+24:00', '-24:00', '+05:60', '-07:99', '+0530', '-7:00', 'PDT', '']) {
        const timestamp = `2026-09-09T09:00:00.123456${offset}`, value = queue();
        value.submissions[0].createdAt = timestamp;
        assert.throws(() => customerIntakeQueue(value), /CUSTOMER_INTAKE_RESPONSE_INVALID/);
        const request = bind(), receipt = result(request); receipt.receipt.recordedAt = timestamp;
        assert.throws(() => customerIntakeReceipt(receipt, 'bind', request), /CUSTOMER_INTAKE_RESPONSE_INVALID/);
    }
});

test('first definitive refusal clears; lost, invalid or delayed replies stay retained through later denials', () => {
    for (const [status, retained] of [[400, false], [401, false], [403, false], [409, false], [408, true], [503, true], [0, true]]) {
        const request = { uncertain: false };
        assert.equal(retainCustomerIntakeRequest(request, { status }), retained);
    }
    const request = { uncertain: false };
    assert.equal(retainCustomerIntakeRequest(request, {}), true);
    assert.equal(retainCustomerIntakeRequest(request, { status: 403 }), true);
    assert.equal(retainCustomerIntakeRequest(request, { status: 401 }, false), true);
});

function gateway() {
    const context = { actorKind: 'HUMAN', capability: 'OPERATIONS', session: { tokenHash: 'a'.repeat(64), browserHash: 'b'.repeat(64) },
        control: { enabled: true, mode: 'LOCAL_FIXTURE', origin: LOCAL_ORIGIN, deploymentId: 'fixture', releaseSha: '0'.repeat(40), configHash: 'c'.repeat(64) }, tx: {} };
    const f = { calls: [], actor: Object.freeze({}), allowed: true, reply: queue(), work: 0, committed: 0, rolledBack: 0, context };
    context.tx.$queryRaw = async (sql, ...values) => { f.calls.push({ sql: sql.join('?'), values }); return [{ result: f.reply }]; };
    f.service = new StaffCustomerIntake({ admin: { async transaction(actor, work) {
        assert.equal(actor, f.actor);
        if (!f.allowed) deny(403, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        f.work++;
        try { const value = await work(context); f.committed++; return value; } catch (error) { f.rolledBack++; throw error; }
    } } });
    return f;
}
test('adapter goes through current human operations authority and sends only bound session hashes and command to SQL', async () => {
    const f = gateway(), request = bind(); f.reply = result(request);
    assert.deepEqual(await f.service.bind(f.actor, request), f.reply);
    assert.equal(f.calls.length, 1); assert.match(f.calls[0].sql, /^SELECT atlas_staff\.customer_operations/);
    const [action, sessionHash, browserHash, binding, input] = f.calls[0].values;
    assert.equal(action, 'bind'); assert.equal(sessionHash, f.context.session.tokenHash); assert.equal(browserHash, f.context.session.browserHash);
    assert.deepEqual(JSON.parse(binding), { mode: 'LOCAL_FIXTURE', origin: LOCAL_ORIGIN, deploymentId: 'fixture', releaseSha: '0'.repeat(40), configHash: 'c'.repeat(64) });
    assert.deepEqual(JSON.parse(input), request); assert.equal(f.committed, 1);
    f.allowed = false;
    await assert.rejects(f.service.list(f.actor), /FRESH_HUMAN_OPERATIONS_REQUIRED/); assert.equal(f.calls.length, 1);
});
test('gateway shape errors, opaque database failures and incorrect reply linkage roll back before success', async () => {
    for (const reply of [{ error: { status: 409, code: 'SPECIMEN_ALREADY_LINKED' } }, { error: { status: 302, code: 'https://private.invalid' } },
        { submissions: [], nextCursor: null, privateDraft: {} }, result(bind())]) {
        const f = gateway(); f.reply = reply;
        await assert.rejects(f.service.list(f.actor)); assert.equal(f.committed, 0); assert.equal(f.rolledBack, 1);
    }
    const f = gateway(); f.context.actorKind = 'MACHINE';
    await assert.rejects(f.service.list(f.actor), /FRESH_HUMAN_OPERATIONS_REQUIRED/); assert.equal(f.calls.length, 0);
    await assert.rejects(f.service.bind(f.actor, { ...bind(), accountId: randomUUID() }), /CUSTOMER_INTAKE_REQUEST_INVALID/);
    assert.equal(f.work, 1);
});

test('customer intake HTTP routes require staff cookies, operations authority, CSRF, exact methods and bounded named inputs', async () => {
    const actor = Object.freeze({ id: randomUUID() }), calls = [];
    const state = { review: {}, auth: { async authenticate(cookie, csrf) {
        if (cookie !== 'staff-session') deny(401, 'SIGN_IN_REQUIRED');
        if (csrf !== undefined && csrf !== 'staff-csrf') deny(403, 'CSRF_REQUIRED');
        return actor;
    } }, customerIntake: Object.fromEntries(['list', 'bind', 'action', 'ship'].map(name => [name, async (staff, input) => {
        assert.equal(staff, actor); calls.push({ name, input }); return name === 'list' ? { submissions: [], nextCursor: null } : { receipt: name };
    }])) };
    const handler = createHandler(state, { NODE_ENV: 'development', ATLAS_LOCAL_SYNTHETIC: '1' });
    async function call(path = '', method = 'GET', body, headers = {}) {
        const out = { headers: {} }, res = { setHeader(key, value) { out.headers[key] = value; }, status(value) { out.status = value; return this; }, json(value) { out.body = value; return this; } };
        await handler({ url: `/api/staff/operations/customers${path}`, method, body, socket: { remoteAddress: '127.0.0.1' },
            headers: { host: LOCAL_HOST, origin: LOCAL_ORIGIN, cookie: 'staff-session', 'x-atlas-csrf': 'staff-csrf', 'content-type': 'application/json', ...headers } }, res);
        return out;
    }
    assert.equal((await call('', 'GET', undefined, { cookie: 'customer-session' })).status, 401);
    assert.equal((await call('/bind', 'POST', bind(), { 'x-atlas-csrf': '' })).status, 403);
    assert.equal((await call('/ship', 'POST', {}, { origin: 'https://another.invalid' })).status, 403);
    assert.equal((await call('/ship', 'POST', { value: 'x'.repeat(16384) })).status, 413);
    assert.equal((await call('/ship', 'GET')).status, 405);
    assert.equal((await call('/approve', 'POST', {})).status, 404);
    assert.equal((await call('?accountId=other')).status, 400);
    assert.equal((await call('?cursor=a&cursor=b')).status, 400);
    assert.equal((await call('/bind?actorId=other', 'POST', bind())).status, 400);
    assert.equal(calls.length, 0);
    const id = randomUUID(), list = await call(`?cursor=${id}`);
    assert.equal(list.status, 200); assert.deepEqual(calls[0], { name: 'list', input: { cursor: id } });
    assert.equal(list.headers['Cache-Control'], 'private, no-store, max-age=0');
    for (const name of ['bind', 'action', 'ship']) assert.equal((await call(`/${name}`, 'POST', { operationId: id })).status, 200);
    state.customerIntake = null; assert.equal((await call()).status, 404);
});
