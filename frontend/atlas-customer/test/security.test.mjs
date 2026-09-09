import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { normalizePhone, profile, submission, BoundaryError, cookies, hash } from '../lib/server/policy.mjs';
import { makeConfig, productionConfig, cookie, COOKIE_NAMES, LOCAL_COOKIES } from '../lib/server/config.mjs';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { summary, milestones } from '../lib/progress.mjs';
import { twilioVerifyTransport } from '../lib/server/twilio.mjs';
import { retainSubmission, readRetainedSubmission, clearRetainedSubmission } from '../lib/pending-submission.mjs';
import { customerPage } from '../lib/server/page.mjs';
import { acceptsSiteRequest } from '@atlas/site-router/server';
import { signRoute } from '@atlas/site-router/proof';
const returns = { name: 'Alex Customer', address1: '1 Example Road', address2: '', city: 'Example', region: 'CA', postalCode: '90001', country: 'US' };
const cfg = () => makeConfig({ mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318', deploymentId: 'local-customer-fixture',
    releaseSha: '0'.repeat(40), sessionKey: randomBytes(32), phoneKey: randomBytes(32), cookies: LOCAL_COOKIES,
    accountSid: `AC${'1'.repeat(32)}`, serviceSid: `VA${'2'.repeat(32)}` });
const fails = (fn, code) => assert.throws(fn, error => error instanceof BoundaryError && error.code === code);

test('canonical phone formatting shares identity and refuses guessed countries, extensions and unsupported punctuation', () => {
    for (const raw of ['+1 (202) 555-0141', ' +1.202.555.0141 ', '+12025550141']) assert.equal(normalizePhone(raw), '+12025550141');
    for (const raw of ['2025550141', '0012025550141', '+1 202 555 0141 ext 2', '+01 202 555 0141', '+1/202/555/0141', '+1234', null, 12025550141]) fails(() => normalizePhone(raw), 'USE_INTERNATIONAL_PHONE');
});
test('profile is deferred; submission requires confirmed bounded details and a delivery method', () => {
    assert.equal(profile({ ...returns, name: ' Alex Customer ', country: 'us' }).name, 'Alex Customer');
    const input = { requestId: randomUUID(), profile: returns, cards: [{ title: '1999 Example card', category: 'SPORTS' }], confirmed: true, intakeMethod: 'MAIL_IN' };
    assert.equal(submission(input).intakeMethod, 'MAIL_IN');
    for (const changed of [{ profile: null }, { confirmed: false }, { intakeMethod: 'DIRECT' }, { cards: [] }, { cards: Array(26).fill(input.cards[0]) }]) assert.throws(() => submission({ ...input, ...changed }));
    fails(() => submission({ ...input, accountId: randomUUID() }), 'INVALID_REQUEST');
    fails(() => profile({ ...returns, phone: '+12025550141' }), 'INVALID_REQUEST');
    fails(() => profile({ ...returns, name: 'Alex\nCustomer' }), 'RETURN_DETAILS_REQUIRED');
});
test('separate cookie names, path and CSRF purpose deny staff or browser authority at customer session writes', () => {
    const config = cfg(), auth = new CustomerAuth({ config }), browser = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url');
    const header = `${config.cookies.browser}=${browser}; ${config.cookies.session}=${token}`;
    assert.equal(auth.authority(header, auth.digest(`session:${token}`)).sessionHash, hash(token));
    fails(() => auth.authority(header, auth.digest(`browser:${browser}`)), 'CSRF_REQUIRED');
    fails(() => auth.authority(`__Secure-atlas_staff=${token}; __Secure-atlas_browser=${browser}`), 'SIGN_IN_REQUIRED');
    assert.match(cookie({ ...config, mode: 'PRODUCTION', cookies: COOKIE_NAMES }, COOKIE_NAMES.session, token, 43200), /HttpOnly; Secure; Path=\/account; SameSite=Lax/);
    assert.doesNotMatch(COOKIE_NAMES.session, /^__Host-/);
    fails(() => cookies(`${config.cookies.browser}=${browser}; ${config.cookies.browser}=${token}`), 'INVALID_COOKIE');
});
test('deployment configuration cannot promote a local fixture or reuse staff verification purpose', () => {
    for (const env of [{}, { NODE_ENV: 'development', ATLAS_CUSTOMER_RUNTIME: 'postgres' }, { NODE_ENV: 'production', VERCEL_ENV: 'production', ATLAS_LOCAL_CUSTOMER: '1' }]) fails(() => productionConfig(env), 'CUSTOMER_ACCESS_NOT_ENABLED');
    const config = cfg(), changed = makeConfig({ ...config, phoneKey: randomBytes(32) });
    assert.notEqual(config.configHash, changed.configHash);
    assert.notEqual(config.phoneHash('+12025550141'), changed.phoneHash('+12025550141'));
});
test('account pages and Next data require signed customer ingress and remain private on denials', async () => {
    const key = randomBytes(32), deploymentId = 'customer-reviewed.vercel.app', target = '/account/submit';
    const signed = await signRoute({ zone: 'customer', deployment: `https://${deploymentId}`, method: 'GET', target, issuedAt: Date.now() }, key.toString('base64'));
    const req = { method: 'GET', url: '/submit', headers: { host: deploymentId, 'x-forwarded-proto': 'https', ...signed } };
    const resolve = async () => ({ assertRequest(request) { if (!acceptsSiteRequest(request, { zone: 'customer', deploymentId, routerKey: key })) throw new BoundaryError(403, 'HOST_NOT_ALLOWED'); } });
    const valid = mockResponse(); assert.deepEqual(await customerPage({ req, res: valid }, { initialView: 'submit' }, resolve), { props: { initialView: 'submit' } });
    for (const headers of [{ host: deploymentId, 'x-forwarded-proto': 'https' }, { ...req.headers, host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-atlas-route-proof': '0'.repeat(64) }]) {
        const res = mockResponse(); assert.deepEqual(await customerPage({ req: { ...req, headers }, res }, {}, resolve), { props: { unavailable: true } });
        assert.equal(res.statusCode, 403); assert.match(res.headers['Cache-Control'], /private, no-store/);
    }
    const res = mockResponse(); await customerPage({ req, res }, {}, async () => { throw new BoundaryError(503, 'CUSTOMER_ACCESS_NOT_ENABLED'); });
    assert.equal(res.statusCode, 503);
});
test('mixed-card progress does not advance sibling cards or fill unrecorded milestones', () => {
    const cards = [{ stage: 'SUBMITTED', events: [{ kind: 'SUBMITTED', recordedAt: '2026-09-09T00:00:00Z' }] },
        { stage: 'APPROVED', events: [{ kind: 'SUBMITTED', recordedAt: '2026-09-09T00:00:00Z' }, { kind: 'APPROVED', recordedAt: '2026-09-09T01:00:00Z' }] }];
    assert.deepEqual(summary(cards).map(row => [row.stage, row.count]), [['SUBMITTED', 1], ['APPROVED', 1]]);
    assert.equal(milestones(cards[1]).find(step => step.kind === 'ENCAPSULATED').recordedAt, null);
    assert.equal(milestones(cards[1]).find(step => step.kind === 'FINAL_REVIEW').recordedAt, null);
});
test('uncertain submission recovery survives a new page instance and remains customer-bound', () => {
    const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const customerId = randomUUID(), body = { requestId: randomUUID(), profile: returns, cards: [{ title: 'Example card', category: 'SPORTS' }], confirmed: true, intakeMethod: 'MAIL_IN' };
    retainSubmission(storage, customerId, body);
    const restored = readRetainedSubmission(storage, customerId);
    assert.deepEqual(restored.submission, body); assert.equal(restored.uncertain, true);
    assert.equal(readRetainedSubmission(storage, randomUUID()), null);
    retainSubmission(storage, customerId, restored.submission, restored.uncertain);
    assert.equal(readRetainedSubmission(storage, customerId).submission.requestId, body.requestId);
    clearRetainedSubmission(storage); assert.equal(readRetainedSubmission(storage, customerId), null);
    assert.throws(() => retainSubmission({ setItem() { throw Error('storage unavailable'); } }, customerId, body), /storage unavailable/);
});

function mockResponse() {
    return { headers: {}, code: null, body: null, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}
test('private HTTP boundaries refuse wrong origin, missing CSRF, foreign routes and caller identities', async () => {
    const config = cfg(), browser = randomBytes(32).toString('base64url'), token = randomBytes(32).toString('base64url'); let calls = 0;
    const auth = new CustomerAuth({ config, database: { async call() { calls++; return {}; } } });
    const handler = createHandler({ config, auth, assertRequest() {}, clientAddress() { return 'test'; } });
    const base = { method: 'POST', url: '/api/customer/submissions', headers: { origin: config.origin, 'content-type': 'application/json',
        cookie: `${config.cookies.browser}=${browser}; ${config.cookies.session}=${token}`, 'x-atlas-customer-csrf': auth.digest(`session:${token}`) },
        body: { requestId: randomUUID(), profile: returns, cards: [{ title: 'A card', category: 'SPORTS' }], confirmed: true, intakeMethod: 'MAIL_IN' } };
    for (const changed of [{ headers: { ...base.headers, origin: 'https://evil.example' } }, { headers: { ...base.headers, 'x-atlas-customer-csrf': '' } },
        { url: '/api/staff/cards' }, { url: '/api/customerish/submissions' }, { body: { ...base.body, accountId: randomUUID() } }, { headers: { ...base.headers, 'sec-fetch-site': 'cross-site' } }]) {
        const response = mockResponse(); await handler({ ...base, ...changed }, response); assert([400, 403, 404].includes(response.code));
        assert.match(response.headers['Cache-Control'], /private, no-store/); assert.equal(response.headers['Vercel-CDN-Cache-Control'], 'no-store');
    }
    assert.equal(calls, 0);
    const response = mockResponse(); await handler(base, response); assert.equal(response.code, 200); assert.equal(calls, 1);
});
test('durable provider claim commits before I/O; a timeout finalizes an unknown result without automatic resend', async () => {
    const config = cfg(), browser = randomBytes(32).toString('base64url'), calls = []; let sends = 0;
    const auth = new CustomerAuth({ config, database: { async call(action, data) { calls.push({ action, data }); return { existing: false }; } },
        provider: { async start() { sends++; assert.equal(calls[0].action, 'send_claim'); throw Error('secret provider body'); } } });
    await auth.send(`${config.cookies.browser}=${browser}`, auth.digest(`browser:${browser}`), { phone: '+1 (202) 555-0141', requestId: randomUUID() }, 'test');
    assert.equal(sends, 1); assert.deepEqual(calls.map(call => call.action), ['send_claim', 'send_finish']); assert.equal(calls[1].data.result, null);
});
test('SMS transport binds account/service/verification/phone, bounds body and does not follow redirects', async () => {
    const config = cfg(), sid = `VE${'3'.repeat(32)}`; let observed;
    const make = raw => twilioVerifyTransport({ ...config, apiKeySid: `SK${'4'.repeat(32)}`, apiKeySecret: 'synthetic-secret-value-12345', fetch: async (_url, options) => {
        observed = options; return new Response(JSON.stringify(raw), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
    const raw = { sid, account_sid: config.accountSid, service_sid: config.serviceSid, to: '+12025550141', channel: 'sms', status: 'pending' };
    assert.equal((await make(raw).start(raw.to)).verificationSid, sid); assert.equal(observed.redirect, 'error'); assert.equal(observed.cache, 'no-store');
    await assert.rejects(make({ ...raw, service_sid: `VA${'9'.repeat(32)}` }).start(raw.to), /VERIFY_OUTCOME_UNAVAILABLE/);
    await assert.rejects(make({ ...raw, huge: 'x'.repeat(40000) }).start(raw.to), /VERIFY_OUTCOME_UNAVAILABLE/);
});
