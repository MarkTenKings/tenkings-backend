import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { routeEnvelope } from '@atlas/site-router/routes';
import { productionAccessConfig, assertProductionStaffRequest, secureStaffCookie, ACCESS_COOKIES } from '../lib/server/access/config.mjs';
import { twilioVerifyTransport } from '../lib/server/access/twilio.mjs';
import { assertWrite } from '../lib/server/policy.mjs';
import { hash } from '../lib/server/policy.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
const sid = prefix => `${prefix}${'1'.repeat(32)}`;
const environment = () => ({ ATLAS_STAFF_RUNTIME: 'postgres', NODE_ENV: 'production', VERCEL_ENV: 'production',
    ATLAS_STAFF_ORIGIN: 'https://atlasgrading.com', ATLAS_STAFF_BASE_PATH: '/admin',
    ATLAS_STAFF_ROUTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    VERCEL_URL: 'atlas-release-123.vercel.app', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    ATLAS_AUTH_TWILIO_ACCOUNT_SID: sid('AC'), ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID: sid('VA'),
    ATLAS_DATABASE_URL: 'postgresql://staff:fixture@database.invalid/atlas?schema=atlas_staff&sslmode=require',
    ATLAS_AUTH_SESSION_KEY: Buffer.alloc(32, 1).toString('base64'), ATLAS_AUTH_PHONE_KEY: Buffer.alloc(32, 2).toString('base64'),
    ATLAS_ADMIN_PHONES: '+12025550141' });
const fields = () => ({ sid: sid('VE'), account_sid: sid('AC'), service_sid: sid('VA'), to: '+12025550141', channel: 'sms', status: 'approved' });
const transport = fetch => twilioVerifyTransport({ accountSid: sid('AC'), serviceSid: sid('VA'), apiKeySid: sid('SK'), apiKeySecret: 'fixture-secret-never-used-for-network', fetch });
const response = object => new Response(JSON.stringify(object), { headers: { 'Content-Type': 'application/json' } });
test('durable staff phone aliases use the approved canonical identity and replay one existing challenge', async () => {
    const f = durableBootstrapFixture(), transaction = f.database.transaction;
    const challenge = { id: 'retained-challenge', phoneHash: f.state.identity.phoneHash, state: 'PENDING',
        expiresAt: new Date(+f.state.now + 60000), controlRevision: 1 };
    f.database.transaction = work => transaction(context => {
        context.tx.staffIdentity = { findUnique: async ({ where }) => {
            assert.equal(where.phoneHash, f.state.identity.phoneHash); return f.state.identity;
        } };
        context.tx.staffChallenge = { findUnique: async () => challenge };
        return work(context);
    });
    for (const phone of ['2025550141', '(202) 555-0141', '1-202-555-0141', '+1 (202) 555-0141']) {
        const result = await f.auth.send(f.cookie, f.auth.digest(`browser:${f.browserToken}`),
            { phone, requestId: '00000000-0000-4000-8000-000000000002' }, 'phone-alias-test');
        assert.equal(result.challengeId, challenge.id);
    }
    for (const phone of ['202555014', '447700900123', '+1 202 555 0141 ext 2', '++12025550141'])
        await assert.rejects(() => f.auth.send(f.cookie, '', { phone, requestId: '00000000-0000-4000-8000-000000000002' }, 'bad-input'), { message: 'USE_INTERNATIONAL_PHONE' });
});
test('a new durable staff challenge sends canonical E.164 through the strict Verify transport and replays without another send', async () => {
    for (const phone of ['2025550141', '(202) 555-0141', '1-202-555-0141', '+1 (202) 555-0141']) {
        const f = durableBootstrapFixture(), transaction = f.database.transaction;
        let challenge = null, sends = 0;
        f.auth.provider = transport(async (_url, options) => {
            sends++;
            assert.equal(new URLSearchParams(options.body).get('To'), '+12025550141');
            return response({ ...fields(), status: 'pending' });
        });
        f.database.transaction = work => transaction(context => {
            context.tx.staffIdentity = { findUnique: async () => f.state.identity };
            context.tx.staffAudit = { create: async ({ data }) => data };
            context.tx.staffChallenge = {
                findUnique: async () => challenge,
                findFirst: async () => challenge,
                create: async ({ data }) => { challenge = structuredClone(data); return challenge; },
                update: async ({ data }) => { Object.assign(challenge, data); return challenge; }
            };
            return work(context);
        });
        const request = { phone, requestId: '00000000-0000-4000-8000-000000000002' };
        const csrf = f.auth.digest(`browser:${f.browserToken}`);
        const first = await f.auth.send(f.cookie, csrf, request, 'phone-send-test');
        const replay = await f.auth.send(f.cookie, csrf, { ...request, phone: '+12025550141' }, 'phone-send-test');
        assert.equal(first.challengeId, replay.challengeId);
        assert.equal(challenge.state, 'PENDING');
        assert.equal(challenge.phoneHash, f.state.identity.phoneHash);
        assert.equal(sends, 1);
        assert.equal(request.phone, phone);
    }
});
function productionRequest(config, { issuedAt = Date.now(), target = '/admin/api/staff/session', url = '/api/staff/session', method = 'GET' } = {}) {
    const proof = createHmac('sha256', config.routerKey).update(routeEnvelope({ zone: 'staff', deployment: `https://${config.deploymentId}`,
        method, target, issuedAt })).digest('hex');
    return { url, method, headers: { host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https',
        origin: config.origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin',
        'x-atlas-route-issued': String(issuedAt), 'x-atlas-route-target': target, 'x-atlas-route-proof': proof } };
}
function durableBootstrapFixture() {
    const config = productionAccessConfig(environment()), now = new Date('2026-09-08T18:00:00.000Z');
    const browserToken = Buffer.alloc(32, 7).toString('base64url'), sessionToken = Buffer.alloc(32, 8).toString('base64url');
    const state = { now, control: { revision: 1 }, identity: { id: '00000000-0000-4000-8000-000000000001', phoneHash: [...config.phoneByHash.keys()][0],
        name: 'Fixture human', role: 'REVIEWER', accessVersion: 1, revokedAt: null },
        session: { tokenHash: hash(sessionToken), identityId: '00000000-0000-4000-8000-000000000001', browserHash: hash(browserToken),
            accessVersion: 1, controlRevision: 1, createdAt: new Date(+now - 6 * 60000), expiresAt: new Date(+now + 24 * 60000), revokedAt: null } };
    const browsers = new Map([[hash(browserToken), { tokenHash: hash(browserToken), controlRevision: 1, createdAt: new Date(+now - 10 * 60000), expiresAt: new Date(+now + 50 * 60000) }]]);
    const rates = new Map(); let createdBrowsers = 0;
    const tx = { staffBrowser: { async findUnique({ where }) { return browsers.get(where.tokenHash) ?? null; },
        async create({ data }) { createdBrowsers++; browsers.set(data.tokenHash, structuredClone(data)); return data; } },
        staffSession: { async findUnique({ where }) { return where.tokenHash === state.session.tokenHash
            ? { ...structuredClone(state.session), browser: structuredClone(browsers.get(state.session.browserHash)) } : null; } },
        staffRateBucket: { async findUnique({ where }) { return rates.get(where.key) ?? null; },
            async upsert({ where, create, update }) { const row = rates.has(where.key) ? { ...rates.get(where.key), ...update } : create; rates.set(where.key, row); return row; } },
        async $queryRaw(strings, ...values) { assert.match(strings.join('?'), /StaffIdentity.*FOR SHARE/s);
            return values[0] === state.identity.id ? [structuredClone(state.identity)] : []; } };
    const database = { transaction: async work => work({ tx, now: state.now, control: state.control }) };
    const auth = new DurableStaffAuth({ database, config, provider: { start() { throw Error('No provider calls authorized'); }, check() { throw Error('No provider calls authorized'); } } });
    const cookie = `${config.cookies.browser}=${browserToken}; ${config.cookies.session}=${sessionToken}`;
    return { auth, config, state, browsers, cookie, browserToken, sessionToken, database, createdBrowsers: () => createdBrowsers };
}
test('durable reauthentication bootstrap changes CSRF purpose only and cannot rejuvenate current opaque human authority', async () => {
    const f = durableBootstrapFixture(), before = structuredClone(f.state.session);
    const normal = await f.auth.bootstrap(f.cookie), reauth = await f.auth.bootstrap(f.cookie, 'unit-client', { reauthenticate: true });
    assert.equal(normal.staff.id, reauth.staff.id); assert.equal(normal.csrf, f.auth.digest(`session:${f.sessionToken}`));
    assert.equal(reauth.csrf, f.auth.digest(`browser:${f.browserToken}`)); assert.equal(reauth.browserToken, f.browserToken); assert.equal(f.createdBrowsers(), 0);
    assert.deepEqual(f.state.session, before);
    await f.database.transaction(async context => {
        assert.equal(await f.auth.browser(context, f.cookie, normal.csrf), null);
        assert.equal((await f.auth.browser(context, f.cookie, reauth.csrf)).tokenHash, hash(f.browserToken));
    });
    await assert.rejects(() => f.auth.authenticate(f.cookie, reauth.csrf), { message: 'CSRF_REQUIRED' });
    const staff = await f.auth.authenticate(f.cookie, normal.csrf);
    await f.auth.withStaff(staff, context => { assert.equal(+context.session.createdAt, +before.createdAt); assert(+context.now - +context.session.createdAt > 5 * 60000); });
    await assert.rejects(() => f.auth.withStaff({ ...reauth.staff }, () => {}), { message: 'SIGN_IN_REQUIRED' });
});
test('durable reauthentication still enforces session/browser/control/access expiry and never revives an old session', async () => {
    for (const mutate of [f => { f.state.session.expiresAt = f.state.now; }, f => { f.state.session.revokedAt = f.state.now; },
        f => { f.state.identity.revokedAt = f.state.now; }, f => { f.state.identity.accessVersion++; },
        f => { f.browsers.get(hash(f.browserToken)).expiresAt = f.state.now; }, f => { f.state.control.revision++; }]) {
        const f = durableBootstrapFixture(); mutate(f); const before = structuredClone(f.state.session);
        const boot = await f.auth.bootstrap(f.cookie, 'unit-client', { reauthenticate: true });
        assert.equal(boot.staff, null); assert.equal(boot.csrf, f.auth.digest(`browser:${boot.browserToken}`)); assert.deepEqual(f.state.session, before);
        await assert.rejects(() => f.auth.authenticate(f.cookie), { message: 'SIGN_IN_REQUIRED' });
    }
});
test('production configuration requires exact environment, host, schema and dedicated keys', () => {
    const env = environment(), config = productionAccessConfig(env);
    assert.equal(config.mode, 'PRODUCTION'); assert.equal(config.phoneByHash.size, 1);
    assert.equal(config.application, 'atlas-staff'); assert.equal(config.basePath, '/admin');
    for (const change of [{ NODE_ENV: 'development' }, { VERCEL_ENV: 'preview' }, { ATLAS_LOCAL_SYNTHETIC: '1' },
        { ATLAS_LOCAL_POSTGRES: '1' }, { ATLAS_LOCAL_POSTGRES_FILE: '/tmp/copy' }, { VERCEL_GIT_COMMIT_SHA: '' },
        { ATLAS_STAFF_ORIGIN: 'https://app.atlasgrading.com' }, { ATLAS_STAFF_ORIGIN: 'https://atlasgrading.com/admin' },
        { ATLAS_STAFF_BASE_PATH: '' }, { ATLAS_STAFF_BASE_PATH: '/administrator' }, { ATLAS_STAFF_BASE_PATH: undefined },
        { ATLAS_STAFF_ROUTER_KEY: env.ATLAS_AUTH_SESSION_KEY }, { ATLAS_STAFF_ROUTER_KEY: env.ATLAS_AUTH_PHONE_KEY },
        { ATLAS_AUTH_PHONE_KEY: env.ATLAS_AUTH_SESSION_KEY },
        { ATLAS_STAFF_ROUTER_KEY: undefined }, { ATLAS_STAFF_ROUTER_KEY: 'short' }, { ATLAS_AUTH_SESSION_KEY: 'short' }, { ATLAS_ADMIN_PHONES: '' },
        { ATLAS_DATABASE_URL: env.ATLAS_DATABASE_URL.replace('atlas_staff', 'public') },
        { ATLAS_DATABASE_URL: env.ATLAS_DATABASE_URL.replace('&sslmode=require', '') }, { ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID: sid('AC') }])
        assert.throws(() => productionAccessConfig({ ...env, ...change }));
    assert.notEqual(productionAccessConfig({ ...env, ATLAS_ADMIN_PHONES: '+12025550142' }).configHash, config.configHash);
    assert.notEqual(productionAccessConfig({ ...env, ATLAS_AUTH_SESSION_KEY: Buffer.alloc(32, 3).toString('base64') }).configHash, config.configHash);
    assert.notEqual(productionAccessConfig({ ...env, ATLAS_STAFF_ROUTER_KEY: Buffer.alloc(32, 7).toString('base64') }).configHash, config.configHash);
    assert.notEqual(productionAccessConfig({ ...env, VERCEL_URL: 'different-release.vercel.app' }).configHash, config.configHash);
    assert.notEqual(productionAccessConfig({ ...env, VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) }).configHash, config.configHash);
});
test('production cookies, hosts, Origin and JSON cannot inherit local or legacy authority', () => {
    const config = productionAccessConfig(environment());
    const request = productionRequest(config), { headers } = request;
    assertProductionStaffRequest(request, config); assertWrite(request, config.origin);
    assertProductionStaffRequest({ ...request, headers: { ...headers, host: config.deploymentId } }, config);
    for (const change of [{ host: 'app.atlasgrading.com' }, { host: 'old.vercel.app' }, { 'x-forwarded-host': 'old.vercel.app' },
        { 'x-forwarded-proto': 'http' }, { authorization: 'Bearer legacy' }])
        assert.throws(() => assertProductionStaffRequest({ ...request, headers: { ...headers, ...change } }, config));
    for (const changed of [{ basePath: '/' }, { application: 'atlas-customer' }])
        assert.throws(() => assertProductionStaffRequest(request, { ...config, ...changed }));
    for (const change of [{ origin: 'http://127.0.0.1:4318' }, { origin: 'https://app.atlasgrading.com' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }])
        assert.throws(() => assertWrite({ headers: { ...headers, ...change } }, config.origin));
    const cookie = secureStaffCookie(ACCESS_COOKIES.session, 'opaque', 1800);
    assert.match(cookie, /^__Secure-atlas_staff=opaque; HttpOnly; Secure; Path=\/admin; SameSite=Lax; Max-Age=1800$/);
    assert.doesNotMatch(cookie, /Domain=/);
    assert.match(secureStaffCookie(ACCESS_COOKIES.session, '', 0), /Path=\/admin; SameSite=Lax; Max-Age=0$/);
    for (const args of [['atlas_local_staff', 'opaque', 1800], [ACCESS_COOKIES.session, 'value; Domain=.atlasgrading.com', 30], [ACCESS_COOKIES.session, 'opaque', 3601]])
        assert.throws(() => secureStaffCookie(...args));
});
test('every production ingress requires a fresh proof bound to method, path, deployment and dedicated key', () => {
    const env = environment(), config = productionAccessConfig(env), request = productionRequest(config);
    for (const host of ['atlasgrading.com', config.deploymentId]) {
        const headers = { ...request.headers, host };
        for (const name of ['x-atlas-route-issued', 'x-atlas-route-target', 'x-atlas-route-proof']) {
            const omitted = { ...headers }; delete omitted[name];
            assert.throws(() => assertProductionStaffRequest({ ...request, headers: omitted }, config), { message: 'HOST_NOT_ALLOWED' });
        }
        assert.throws(() => assertProductionStaffRequest({ ...request, headers: { ...headers, 'x-atlas-route-proof': '0'.repeat(64) } }, config));
    }
    for (const changed of [{ method: 'POST' }, { url: '/api/staff/cards' }, { url: '/api/staff/session?reauthenticate=1' }])
        assert.throws(() => assertProductionStaffRequest({ ...request, ...changed }, config));
    for (const issuedAt of [Date.now() - 31_000, Date.now() + 31_000])
        assert.throws(() => assertProductionStaffRequest(productionRequest(config, { issuedAt }), config));
    for (const changed of [{ ATLAS_STAFF_ROUTER_KEY: Buffer.alloc(32, 7).toString('base64') }, { VERCEL_URL: 'another-release.vercel.app' }])
        assert.throws(() => assertProductionStaffRequest(request, productionAccessConfig({ ...env, ...changed })));
    assertProductionStaffRequest(productionRequest(config, { target: '/admin/api/staff/session?reauthenticate=1', url: '/api/staff/session?reauthenticate=1' }), config);
});
test('customer and legacy host cookies never become a staff session', async () => {
    const f = durableBootstrapFixture();
    for (const cookie of [
        `__Host-atlas_browser=${f.browserToken}; __Host-atlas_staff=${f.sessionToken}`,
        `__Secure-atlas_customer_browser=${f.browserToken}; __Secure-atlas_customer=${f.sessionToken}`,
        `${f.cookie}; ${f.config.cookies.session}=${f.sessionToken}`
    ]) await assert.rejects(() => f.auth.authenticate(cookie), { message: 'SIGN_IN_REQUIRED' });
});
test('Verify transport uses one fixed origin, no redirects/retries and exact SID-based check', async () => {
    const calls = [];
    const provider = transport(async (url, options) => { calls.push({ url, options }); return response(fields()); });
    const result = await provider.check(sid('VE'), '424242');
    assert.equal(calls.length, 1); assert.equal(calls[0].url, `https://verify.twilio.com/v2/Services/${sid('VA')}/VerificationCheck`);
    assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[0].options.body, `VerificationSid=${sid('VE')}&Code=424242`); assert(calls[0].options.signal instanceof AbortSignal);
    assert.deepEqual(result, { accountSid: sid('AC'), serviceSid: sid('VA'), verificationSid: sid('VE'), phone: '+12025550141', channel: 'sms', status: 'approved' });
});
test('Verify send formats a canonical number and rejects invalid input before transport', async () => {
    let count = 0;
    const provider = transport(async (url, options) => {
        count++; assert(url.endsWith('/Verifications')); assert.equal(options.body, 'To=%2B12025550141&Channel=sms');
        return response({ ...fields(), status: 'pending' });
    });
    await provider.start('+12025550141');
    assert.throws(() => provider.start('+1 202 555 0141'));
    assert.throws(() => provider.check('bad-sid', '424242')); assert.equal(count, 1);
});
test('ambiguous, oversized and substituted provider responses never leak details or retry', async () => {
    const attempts = [
        () => { throw new Error('secret raw phone +12025550141 code 424242'); },
        () => new Response('private failure', { status: 404 }),
        () => new Response(JSON.stringify(fields()), { headers: { 'Content-Type': 'text/html' } }),
        () => new Response('x'.repeat(32769), { headers: { 'Content-Type': 'application/json' } }),
        () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '99999' } }),
        () => response({ ...fields(), account_sid: sid('ZZ') }), () => response({ ...fields(), service_sid: sid('ZZ') }),
        () => response({ ...fields(), sid: 'bad' }), () => response({ ...fields(), channel: 'email' }),
    ];
    for (const attempt of attempts) {
        let count = 0; const provider = transport(async () => { count++; return attempt(); });
        await assert.rejects(() => provider.check(sid('VE'), '424242'), { message: 'VERIFY_OUTCOME_UNAVAILABLE' });
        assert.equal(count, 1);
    }
});
