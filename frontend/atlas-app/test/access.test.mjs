import test from 'node:test';
import assert from 'node:assert/strict';
import { productionAccessConfig, assertProductionStaffRequest, secureStaffCookie, ACCESS_COOKIES } from '../lib/server/access/config.mjs';
import { twilioVerifyTransport } from '../lib/server/access/twilio.mjs';
import { assertWrite } from '../lib/server/policy.mjs';
const sid = prefix => `${prefix}${'1'.repeat(32)}`;
const environment = () => ({ ATLAS_STAFF_RUNTIME: 'postgres', NODE_ENV: 'production', VERCEL_ENV: 'production',
    ATLAS_STAFF_ORIGIN: 'https://app.atlasgrading.com', VERCEL_URL: 'atlas-release-123.vercel.app', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    ATLAS_AUTH_TWILIO_ACCOUNT_SID: sid('AC'), ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID: sid('VA'),
    ATLAS_DATABASE_URL: 'postgresql://staff:fixture@database.invalid/atlas?schema=atlas_staff&sslmode=require',
    ATLAS_AUTH_SESSION_KEY: Buffer.alloc(32, 1).toString('base64'), ATLAS_AUTH_PHONE_KEY: Buffer.alloc(32, 2).toString('base64'),
    ATLAS_ADMIN_PHONES: '+12025550141' });
const fields = () => ({ sid: sid('VE'), account_sid: sid('AC'), service_sid: sid('VA'), to: '+12025550141', channel: 'sms', status: 'approved' });
const transport = fetch => twilioVerifyTransport({ accountSid: sid('AC'), serviceSid: sid('VA'), apiKeySid: sid('SK'), apiKeySecret: 'fixture-secret-never-used-for-network', fetch });
const response = object => new Response(JSON.stringify(object), { headers: { 'Content-Type': 'application/json' } });
test('production configuration requires exact environment, host, schema and dedicated keys', () => {
    const env = environment(), config = productionAccessConfig(env);
    assert.equal(config.mode, 'PRODUCTION'); assert.equal(config.phoneByHash.size, 1);
    for (const change of [{ NODE_ENV: 'development' }, { VERCEL_ENV: 'preview' }, { ATLAS_LOCAL_SYNTHETIC: '1' },
        { ATLAS_LOCAL_POSTGRES: '1' }, { ATLAS_LOCAL_POSTGRES_FILE: '/tmp/copy' }, { VERCEL_GIT_COMMIT_SHA: '' },
        { ATLAS_STAFF_ORIGIN: 'https://atlasgrading.com' }, { ATLAS_AUTH_SESSION_KEY: 'short' }, { ATLAS_ADMIN_PHONES: '' },
        { ATLAS_DATABASE_URL: env.ATLAS_DATABASE_URL.replace('atlas_staff', 'public') },
        { ATLAS_DATABASE_URL: env.ATLAS_DATABASE_URL.replace('&sslmode=require', '') }, { ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID: sid('AC') }])
        assert.throws(() => productionAccessConfig({ ...env, ...change }));
    assert.notEqual(productionAccessConfig({ ...env, ATLAS_ADMIN_PHONES: '+12025550142' }).configHash, config.configHash);
    assert.notEqual(productionAccessConfig({ ...env, ATLAS_AUTH_SESSION_KEY: Buffer.alloc(32, 3).toString('base64') }).configHash, config.configHash);
});
test('production cookies, hosts, Origin and JSON cannot inherit local or legacy authority', () => {
    const config = productionAccessConfig(environment());
    const headers = { host: 'app.atlasgrading.com', 'x-forwarded-host': 'app.atlasgrading.com', 'x-forwarded-proto': 'https',
        origin: config.origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
    assertProductionStaffRequest({ headers }, config); assertWrite({ headers }, config.origin);
    for (const change of [{ host: 'atlasgrading.com' }, { host: 'old.vercel.app' }, { 'x-forwarded-host': 'old.vercel.app' },
        { 'x-forwarded-proto': 'http' }, { authorization: 'Bearer legacy' }])
        assert.throws(() => assertProductionStaffRequest({ headers: { ...headers, ...change } }, config));
    for (const change of [{ origin: 'http://127.0.0.1:4318' }, { origin: 'https://atlasgrading.com' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }])
        assert.throws(() => assertWrite({ headers: { ...headers, ...change } }, config.origin));
    const cookie = secureStaffCookie(ACCESS_COOKIES.session, 'opaque', 1800);
    assert.match(cookie, /^__Host-atlas_staff=opaque; HttpOnly; Secure; Path=\/; SameSite=Lax; Max-Age=1800$/);
    for (const args of [['atlas_local_staff', 'opaque', 1800], [ACCESS_COOKIES.session, 'value; Domain=.atlasgrading.com', 30], [ACCESS_COOKIES.session, 'opaque', 3601]])
        assert.throws(() => secureStaffCookie(...args));
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
