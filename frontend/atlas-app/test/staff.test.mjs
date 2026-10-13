import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStaffAuth, syntheticVerifyProvider } from '../lib/server/auth.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { BROWSER_COOKIE, SESSION_COOKIE, FIXTURE_PHONE, FIXTURE_CODE, LOCAL_HOST, LOCAL_ORIGIN, parseApprovedPhones, hash } from '../lib/server/policy.mjs';
// All transports/stores are synthetic and dependency-free; no network/provider SDK.
const LOCAL = { NODE_ENV: 'development', ATLAS_LOCAL_SYNTHETIC: '1' };
function fixture(options = {}, env = LOCAL) {
    const auth = new LocalStaffAuth(options);
    const handler = createHandler({ auth }, env);
    function client() {
        const jar = {};
        let serial = 0;
        return {
            jar,
            async call(path, body, headers = {}) {
                const out = { status: 0, headers: {}, body: null };
                const req = { url: `/api/staff/${path}`, method: body === undefined ? 'GET' : 'POST', body,
                    socket: { remoteAddress: '127.0.0.1' },
                    headers: { host: LOCAL_HOST, origin: LOCAL_ORIGIN, 'content-type': 'application/json',
                        cookie: Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; '), ...headers } };
                const res = { setHeader(k, v) { out.headers[k] = v; }, status(s) { out.status = s; return this; }, json(v) { out.body = v; return this; }, send(v) { out.body = v; return this; } };
                await handler(req, res);
                const set = out.headers['Set-Cookie'];
                if (set) {
                    const [name, value] = set.split(';')[0].split('=');
                    if (value)
                        jar[name] = value;
                    else
                        delete jar[name];
                }
                return out;
            },
            async begin(phone = FIXTURE_PHONE) {
                const boot = await this.call('session');
                const requestId = `request_${++serial}`;
                const result = await this.call('auth/request', { phone, requestId }, { 'x-atlas-csrf': boot.body.csrf });
                return { ...result.body, csrf: boot.body.csrf, requestId };
            },
            async login(phone = FIXTURE_PHONE) {
                const challenge = await this.begin(phone);
                const response = await this.call('auth/verify', { challengeId: challenge.challengeId, code: FIXTURE_CODE }, { 'x-atlas-csrf': challenge.csrf });
                assert.equal(response.status, 200, JSON.stringify(response.body));
                return { ...response.body, challenge, cookie: response.headers['Set-Cookie'] };
            }
        };
    }
    return { auth, client, handler };
}
test('U.S. formatted staff input sends once and its canonical alias reuses the same sign-in request', async () => {
    const base = syntheticVerifyProvider(); let sends = 0;
    const f = fixture({ provider: { ...base, async start(phone) { sends++; assert.equal(phone, FIXTURE_PHONE); return base.start(phone); } } });
    const c = f.client(), first = await c.begin('(202) 555-0141');
    assert(first.challengeId);
    const repeat = await c.call('auth/request', { phone: '12025550141', requestId: first.requestId }, { 'x-atlas-csrf': first.csrf });
    assert.equal(repeat.status, 200); assert.equal(repeat.body.challengeId, first.challengeId); assert.equal(sends, 1);
    const verified = await c.call('auth/verify', { challengeId: first.challengeId, code: FIXTURE_CODE }, { 'x-atlas-csrf': first.csrf });
    assert.equal(verified.status, 200); assert.equal(verified.body.staff.id, 'fixture-reviewer');
});
test('explicit reauthentication returns browser CSRF without replacing or refreshing the existing signed-in session', async () => {
    let now = 1000;
    const f = fixture({ now: () => now }), c = f.client(), login = await c.login();
    const browser = c.jar[BROWSER_COOKIE], session = c.jar[SESSION_COOKIE], previous = structuredClone(f.auth.sessions.get(hash(session)));
    now += 6 * 60000;
    const normal = await c.call('session'), boot = await c.call('session?reauthenticate=1');
    assert.equal(normal.body.csrf, login.csrf); assert.equal(boot.body.staff.id, login.staff.id);
    assert.notEqual(boot.body.csrf, login.csrf); assert.equal(c.jar[BROWSER_COOKIE], browser); assert.equal(c.jar[SESSION_COOKIE], session);
    assert.deepEqual(f.auth.sessions.get(hash(session)), previous); assert.equal(f.auth.sessions.size, 1);
    assert.equal((await c.call('session')).body.staff.id, login.staff.id);
    // Neither CSRF purpose acquires the other purpose's mutation authority.
    assert.equal((await c.call('auth/request', { phone: FIXTURE_PHONE, requestId: 'reauth_request_001' }, { 'x-atlas-csrf': login.csrf })).status, 403);
    assert.equal((await c.call('auth/logout', {}, { 'x-atlas-csrf': boot.body.csrf })).status, 403);
    assert.equal(c.jar[SESSION_COOKIE], session);
});
test('session reauthentication mode requires one exact parsed query value and does not dispatch verification', async () => {
    let sends = 0;
    const original = syntheticVerifyProvider(), f = fixture({ provider: { ...original, async start(...args) { sends++; return original.start(...args); } } });
    const c = f.client(), login = await c.login(), count = sends;
    for (const query of ['', '?reauthenticate=', '?reauthenticate=0', '?reauthenticate=true', '?reauthenticate=01',
        '?reauthenticate=1&reauthenticate=1', '?reauthenticate=1&reauthenticate=0', '?reauthenticate[]=1']) {
        const response = await c.call(`session${query}`); assert.equal(response.status, 200); assert.equal(response.body.csrf, login.csrf, query);
    }
    assert.notEqual((await c.call('session?reauthenticate=1')).body.csrf, login.csrf);
    assert.equal(sends, count); assert.equal(f.auth.sessions.size, 1);
});
test('reauthentication mints one fresh session only after code verification; lost replies replay it and other-tab CSRF refresh is required', async () => {
    let now = 1000;
    const f = fixture({ now: () => now }), c = f.client(), first = await c.login(), oldToken = c.jar[SESSION_COOKIE], browser = c.jar[BROWSER_COOKIE];
    const oldSession = structuredClone(f.auth.sessions.get(hash(oldToken)));
    now += 6 * 60000;
    const boot = await c.call('session?reauthenticate=1'), headers = { 'x-atlas-csrf': boot.body.csrf };
    const input = { phone: FIXTURE_PHONE, requestId: 'reauth_request_002' }, sent = await c.call('auth/request', input, headers);
    assert.equal(sent.status, 200); assert.equal(c.jar[SESSION_COOKIE], oldToken);
    assert.equal((await c.call('auth/request', input, headers)).body.challengeId, sent.body.challengeId);
    assert.equal((await c.call('auth/verify', { challengeId: sent.body.challengeId, code: '000000' }, headers)).status, 400);
    assert.equal(c.jar[SESSION_COOKIE], oldToken); assert.deepEqual(f.auth.sessions.get(hash(oldToken)), oldSession);
    const check = { challengeId: sent.body.challengeId, code: FIXTURE_CODE }, verified = await c.call('auth/verify', check, headers);
    assert.equal(verified.status, 200); assert.notEqual(c.jar[SESSION_COOKIE], oldToken); assert.equal(c.jar[BROWSER_COOKIE], browser);
    assert.equal(f.auth.sessions.size, 2); assert.equal(f.auth.sessions.get(hash(c.jar[SESSION_COOKIE])).expiresAt, now + 30 * 60000);
    const retry = await c.call('auth/verify', check, headers);
    assert.equal(retry.status, 200); assert.equal(retry.headers['Set-Cookie'], verified.headers['Set-Cookie']); assert.equal(f.auth.sessions.size, 2);
    // Browsers share cookies across tabs; another tab retains its old in-memory
    // session CSRF and unsaved request until it explicitly refreshes access.
    const rejected = await c.call('auth/logout', {}, { 'x-atlas-csrf': first.csrf });
    assert.equal(rejected.status, 403); assert.equal(rejected.body.error, 'CSRF_REQUIRED');
    const refreshed = await c.call('session'); assert.equal(refreshed.body.csrf, verified.body.csrf);
    assert.equal((await c.call('auth/logout', {}, { 'x-atlas-csrf': refreshed.body.csrf })).status, 200);
});
test('reauthentication challenge remains browser-bound and expiry does not destroy or extend the previous session', async () => {
    let now = 1000;
    const f = fixture({ now: () => now }), a = f.client(), b = f.client();
    await a.login(); now += 6 * 60000;
    const oldToken = a.jar[SESSION_COOKIE], old = structuredClone(f.auth.sessions.get(hash(oldToken))), boot = await a.call('session?reauthenticate=1');
    const sent = await a.call('auth/request', { phone: FIXTURE_PHONE, requestId: 'reauth_request_003' }, { 'x-atlas-csrf': boot.body.csrf });
    const foreign = await b.call('session?reauthenticate=1'), input = { challengeId: sent.body.challengeId, code: FIXTURE_CODE };
    assert.equal((await b.call('auth/verify', input, { 'x-atlas-csrf': foreign.body.csrf })).status, 400);
    now += 5 * 60000;
    assert.equal((await a.call('auth/verify', input, { 'x-atlas-csrf': boot.body.csrf })).status, 400);
    assert.equal(a.jar[SESSION_COOKIE], oldToken); assert.deepEqual(f.auth.sessions.get(hash(oldToken)), old);
    assert((await a.call('session')).body.staff); assert.equal(f.auth.sessions.size, 1);
});
for (const env of [{}, { NODE_ENV: 'production', ATLAS_LOCAL_SYNTHETIC: '1' }, { ...LOCAL, VERCEL: '1' }, { ...LOCAL, VERCEL_ENV: 'preview' }, { ...LOCAL, AWS_LAMBDA_FUNCTION_NAME: 'staff' }]) {
    test(`production/deployment denial: ${JSON.stringify(env)}`, async () => {
        const f = fixture({}, env), c = f.client();
        for (const [path, body] of [['session', undefined], ['cards', undefined], ['auth/request', { phone: FIXTURE_PHONE, requestId: 'request_001' }]]) {
            const r = await c.call(path, body);
            assert.equal(r.status, 503);
            assert.equal(r.body.error, 'STAFF_ACCESS_NOT_ENABLED');
            assert.match(r.headers['Cache-Control'], /no-store/);
            assert.equal(f.auth.challenges.size, 0);
        }
    });
}
test('phone allowlist parses canonical E.164 and denies empty, duplicates and malformed configuration', () => {
    assert.deepEqual([...parseApprovedPhones(` ${FIXTURE_PHONE},+442079460123 `)], [FIXTURE_PHONE, '+442079460123']);
    for (const value of ['', ' ', '+1', '12025550141', '+1202 5550141', '+02025550141', `${FIXTURE_PHONE},`, `${FIXTURE_PHONE},${FIXTURE_PHONE}`, undefined])
        assert.throws(() => parseApprovedPhones(value));
});
test('exact host, forwarding and machine bearer cannot bypass staff boundary', async () => {
    const c = fixture().client();
    for (const headers of [{ host: 'atlasgrading.com' }, { host: 'app.atlasgrading.com' }, { host: 'preview.vercel.app' }, { host: 'localhost:4318' }, { 'x-forwarded-host': 'app.atlasgrading.com' }, { 'x-forwarded-proto': 'https' }, { authorization: 'Bearer machine-or-legacy-token' }]) {
        assert.equal((await c.call('session', undefined, headers)).status, 403);
    }
    assert.equal((await c.call('session', undefined, { 'x-forwarded-host': LOCAL_HOST, 'x-forwarded-proto': 'http' })).status, 200);
});
test('non-loopback socket cannot use fixture even with allowed host', async () => {
    const f = fixture();
    let status;
    await f.handler({ url: '/api/staff/session', method: 'GET', headers: { host: LOCAL_HOST }, socket: { remoteAddress: '192.168.1.20' } }, { setHeader() { }, status(s) { status = s; return this; }, json() { } });
    assert.equal(status, 403);
});
test('retired card/evidence endpoints are absent without private details', async () => {
    const c = fixture().client();
    for (const path of ['cards', 'cards/sample-001', 'evidence/sample-001/FRONT', 'cards/sample-001/draft']) {
        const r = await c.call(path, path.endsWith('/draft') ? {} : undefined);
        assert.equal(r.status, 404);
        assert.deepEqual(r.body, { error: 'NOT_FOUND' });
        assert.match(r.headers['Cache-Control'], /no-store/);
    }
});
test('unlisted paths, methods, certificate, learning, legacy and machine routes remain absent', async () => {
    const c = fixture().client();
    for (const path of ['certify', 'tools/submit_for_human_review', 'cards/sample-001/certify', 'cards/sample-001/learning', 'cards/../sample-001', 'cards/sample-001/extra', 'evidence/sample-001/%46RONT'])
        assert.equal((await c.call(path, {})).status, 404);
    const r = await c.call('cards', {});
    assert.equal(r.status, 404);
});
test('request requires exact Origin, JSON and browser-bound CSRF', async () => {
    const c = fixture().client();
    const boot = await c.call('session');
    const body = { phone: FIXTURE_PHONE, requestId: 'request_001' };
    for (const headers of [{}, { 'x-atlas-csrf': 'forged' }, { 'x-atlas-csrf': boot.body.csrf, origin: 'https://atlasgrading.com' }, { 'x-atlas-csrf': boot.body.csrf, origin: '' }, { 'x-atlas-csrf': boot.body.csrf, 'sec-fetch-site': 'cross-site' }])
        assert.equal((await c.call('auth/request', body, headers)).status, 403);
    assert.equal((await c.call('auth/request', body, { 'x-atlas-csrf': boot.body.csrf, 'content-type': 'text/plain' })).status, 415);
});
test('unapproved number and caller-selected role never dispatch provider', async () => {
    let sends = 0;
    const f = fixture({ provider: { start() { sends++; } } });
    const c = f.client();
    const boot = await c.call('session'), headers = { 'x-atlas-csrf': boot.body.csrf };
    assert.equal((await c.call('auth/request', { phone: '+12025550999', requestId: 'request_001' }, headers)).status, 403);
    assert.equal((await c.call('auth/request', { phone: FIXTURE_PHONE, requestId: 'request_002', role: 'ADMIN' }, headers)).status, 400);
    assert.equal(sends, 0);
});
test('correct login sets separate opaque HttpOnly fixture cookie and never exposes token/list/SID', async () => {
    const f = fixture(), c = f.client();
    const login = await c.login();
    assert.match(login.cookie, /^atlas_local_staff=[a-zA-Z0-9_-]+; HttpOnly; Path=\/admin; SameSite=Lax;/);
    assert.doesNotMatch(login.cookie, /Domain=|__Host-atlas_staff/);
    assert.equal(login.staff.id, 'fixture-reviewer');
    assert.equal(login.staff.mode, 'SYNTHETIC');
    const body = JSON.stringify((await c.call('session')).body);
    assert.doesNotMatch(body, /1202555|424242|VE_|VA_|token/);
    assert.equal(f.auth.sessions.size, 1);
    assert.ok(![...f.auth.sessions.keys()].includes(c.jar[SESSION_COOKIE]));
});
test('wrong/expired/replayed codes cannot create fresh authority', async () => {
    let now = 1000;
    const f = fixture({ now: () => now }), c = f.client();
    const challenge = await c.begin();
    const headers = { 'x-atlas-csrf': challenge.csrf };
    for (let i = 0; i < 5; i++)
        assert.equal((await c.call('auth/verify', { challengeId: challenge.challengeId, code: '000000' }, headers)).status, 400);
    assert.equal((await c.call('auth/verify', { challengeId: challenge.challengeId, code: FIXTURE_CODE }, headers)).status, 400);
    assert.equal(f.auth.sessions.size, 0);
    now += 6 * 60000;
    assert.equal((await c.call('auth/verify', { challengeId: challenge.challengeId, code: FIXTURE_CODE }, headers)).status, 400);
});
test('challenge is bound to its initiating browser', async () => {
    const f = fixture(), a = f.client(), b = f.client();
    const ch = await a.begin();
    const bootB = await b.call('session');
    assert.equal((await b.call('auth/verify', { challengeId: ch.challengeId, code: FIXTURE_CODE }, { 'x-atlas-csrf': bootB.body.csrf })).status, 400);
    assert.equal(f.auth.sessions.size, 0);
});
for (const [key, value] of [['accountSid', 'AC_OTHER'], ['serviceSid', 'VA_OTHER'], ['verificationSid', 'VE_OTHER'], ['phone', '+12025550142'], ['channel', 'email'], ['status', 'accepted']]) {
    test(`provider verification response must match exact ${key}`, async () => {
        const original = syntheticVerifyProvider();
        const provider = { start: original.start, async check(...args) { return { ...await original.check(...args), [key]: value }; } };
        const f = fixture({ provider }), c = f.client(), ch = await c.begin();
        const r = await c.call('auth/verify', { challengeId: ch.challengeId, code: FIXTURE_CODE }, { 'x-atlas-csrf': ch.csrf });
        assert.equal(r.status, 400);
        assert.equal(f.auth.sessions.size, 0);
    });
}
test('concurrent/lost verification responses replay one exact active session; logout defeats replay', async () => {
    const f = fixture(), c = f.client(), ch = await c.begin();
    const body = { challengeId: ch.challengeId, code: FIXTURE_CODE }, headers = { 'x-atlas-csrf': ch.csrf };
    const [a, b] = await Promise.all([c.call('auth/verify', body, headers), c.call('auth/verify', body, headers)]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.headers['Set-Cookie'], b.headers['Set-Cookie']);
    assert.equal(f.auth.sessions.size, 1);
    assert.equal((await c.call('auth/logout', {}, { 'x-atlas-csrf': a.body.csrf })).status, 200);
    assert.equal((await c.call('session')).body.staff, null);
    assert.equal((await c.call('auth/verify', body, headers)).status, 400);
});
test('lost send response is idempotent and changed request conflicts', async () => {
    let sends = 0;
    const original = syntheticVerifyProvider();
    const f = fixture({ provider: { ...original, async start(...args) { sends++; return original.start(...args); } } });
    const c = f.client(), ch = await c.begin();
    const r = await c.call('auth/request', { phone: FIXTURE_PHONE, requestId: ch.requestId }, { 'x-atlas-csrf': ch.csrf });
    assert.equal(r.body.challengeId, ch.challengeId);
    assert.equal(sends, 1);
    assert.equal((await c.call('auth/request', { phone: '+12025550142', requestId: ch.requestId }, { 'x-atlas-csrf': ch.csrf })).status, 409);
});
test('unknown send outcome cannot trigger an automatic second send', async () => {
    let sends = 0, now = 1000;
    const f = fixture({ now: () => now, provider: { async start() { sends++; throw new Error('lost response'); } } }), c = f.client();
    const boot = await c.call('session'), headers = { 'x-atlas-csrf': boot.body.csrf };
    assert.equal((await c.call('auth/request', { phone: FIXTURE_PHONE, requestId: 'request_001' }, headers)).status, 503);
    now += 61000;
    assert.equal((await c.call('auth/request', { phone: FIXTURE_PHONE, requestId: 'request_002' }, headers)).status, 409);
    assert.equal(sends, 1);
});
test('resend cooldown applies across browsers and unknown numbers consume global/client budget', async () => {
    const f = fixture(), a = f.client(), b = f.client();
    await a.begin();
    const boot = await b.call('session'), headers = { 'x-atlas-csrf': boot.body.csrf };
    assert.equal((await b.call('auth/request', { phone: FIXTURE_PHONE, requestId: 'request_001' }, headers)).status, 429);
    for (let i = 0; i < 12; i++)
        await b.call('auth/request', { phone: '+12025550999', requestId: `request_${100 + i}` }, headers);
    assert.equal((await b.call('auth/request', { phone: '+12025550142', requestId: 'request_900' }, headers)).status, 429);
});
test('allowlist removal revokes active reads and writes and late provider approval', async () => {
    const phones = new Set([FIXTURE_PHONE]);
    const f = fixture({ approvedPhones: () => phones });
    const c = f.client();
    const login = await c.login();
    phones.clear();
    assert.equal((await c.call('session')).body.staff, null);
    assert.equal((await c.call('auth/logout', {}, { 'x-atlas-csrf': login.csrf })).status, 401);
    const transport = syntheticVerifyProvider();
    const late = fixture({ approvedPhones: () => phones, provider: { start: transport.start, async check(...args) { const r = await transport.check(...args); phones.clear(); return r; } } });
    phones.add(FIXTURE_PHONE);
    const l = late.client(), ch = await l.begin();
    assert.equal((await l.call('auth/verify', { challengeId: ch.challengeId, code: FIXTURE_CODE }, { 'x-atlas-csrf': ch.csrf })).status, 403);
    assert.equal(late.auth.sessions.size, 0);
});
test('expiry during provider check and session expiry are enforced using server time', async () => {
    let now = 1000;
    const original = syntheticVerifyProvider();
    const f = fixture({ now: () => now, provider: { start: original.start, async check(...args) { const r = await original.check(...args); now += 6 * 60000; return r; } } });
    const c = f.client(), ch = await c.begin();
    assert.equal((await c.call('auth/verify', { challengeId: ch.challengeId, code: FIXTURE_CODE }, { 'x-atlas-csrf': ch.csrf })).status, 400);
    assert.equal(f.auth.sessions.size, 0);
    const g = fixture({ now: () => now }), d = g.client();
    await d.login();
    now += 31 * 60000;
    assert.equal((await d.call('session')).body.staff, null);
});
