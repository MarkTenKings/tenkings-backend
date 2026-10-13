import assert from 'node:assert/strict';
import test from 'node:test';
import { productionConfig, assertPublicRequest, reportSelector, PUBLIC_ORIGIN, digest } from '../lib/server/policy.mjs';
const env = { NODE_ENV: 'production', VERCEL_ENV: 'production', ATLAS_PUBLIC_RUNTIME: 'manual', ATLAS_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    VERCEL_URL: 'atlas-public-release.vercel.app', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    ATLAS_PUBLIC_MANUAL_ORIGIN: 'https://private.atlasgrading.com', ATLAS_PUBLIC_MANUAL_KEY: Buffer.alloc(32, 8).toString('base64') };
const request = () => ({ method: 'GET', headers: { host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https' } });
test('public configuration requires the current manual transport, exact production host, environment and release', () => {
    const config = productionConfig(env); assert.equal(config.mode, 'PRODUCTION');
    for (const change of [{ NODE_ENV: 'development' }, { VERCEL_ENV: 'preview' }, { ATLAS_LOCAL_PUBLIC: '1' },
        { ATLAS_LOCAL_POSTGRES_FILE: '/tmp/config' }, { ATLAS_PUBLIC_ORIGIN: 'https://app.atlasgrading.com' },
        { VERCEL_URL: 'unknown.example' }, { VERCEL_GIT_COMMIT_SHA: '' }, { ATLAS_PUBLIC_RUNTIME: 'postgres' },
        { ATLAS_PUBLIC_RUNTIME: undefined }, { ATLAS_PUBLIC_MANUAL_ORIGIN: 'https://attacker.invalid' },
        { ATLAS_PUBLIC_MANUAL_ORIGIN: undefined }, { ATLAS_PUBLIC_MANUAL_KEY: '' }, { ATLAS_PUBLIC_MANUAL_KEY: undefined }])
        assert.throws(() => productionConfig({ ...env, ...change }), /PUBLIC_REPORTS_UNAVAILABLE|BRIDGE_CONFIGURATION_INVALID/);
    assert.equal(config.databaseUrl, undefined); assert.equal(config.mediaKey, undefined);
});
test('every stale database/media credential tuple is rejected, including a complete legacy tuple', () => {
    const legacy = { ATLAS_PUBLIC_DATABASE_URL: 'postgresql://public:fixture@db.example/report',
        ATLAS_PUBLIC_MEDIA_ORIGIN: 'https://bridge.example.test', ATLAS_PUBLIC_MEDIA_KEY: Buffer.alloc(32, 4).toString('base64') };
    const names = Object.keys(legacy);
    for (let mask = 1; mask < 8; mask++) {
        const stale = Object.fromEntries(names.filter((_, index) => mask & (1 << index)).map(name => [name, legacy[name]]));
        assert.throws(() => productionConfig({ ...env, ...stale }), /PUBLIC_REPORTS_UNAVAILABLE/);
    }
    for (const name of names) assert.throws(() => productionConfig({ ...env, [name]: '' }), /PUBLIC_REPORTS_UNAVAILABLE/);
});
test('manual binding preserves the deployed serialization and changes when its key rotates', () => {
    const config = productionConfig(env);
    const expected = digest(JSON.stringify({ version: 'atlas-public-manual-reader-v1', mode: 'PRODUCTION', origin: PUBLIC_ORIGIN,
        manualOrigin: env.ATLAS_PUBLIC_MANUAL_ORIGIN, manualKeyHash: digest(Buffer.from(env.ATLAS_PUBLIC_MANUAL_KEY, 'base64')) }));
    assert.equal(config.configHash, expected);
    assert.notEqual(productionConfig({ ...env, ATLAS_PUBLIC_MANUAL_KEY: Buffer.alloc(32, 9).toString('base64') }).configHash, expected);
});
test('only exact apex GET/HEAD requests read; writes, fixture mode and substituted hosts fail', () => {
    const config = productionConfig(env);
    for (const method of ['GET', 'HEAD']) assert.doesNotThrow(() => assertPublicRequest({ ...request(), method }, config));
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.throws(() => assertPublicRequest({ ...request(), method }, config));
    for (const change of [{ host: 'app.atlasgrading.com' }, { 'x-forwarded-host': 'atlas-public-release.vercel.app' },
        { 'x-forwarded-proto': 'http' }, { authorization: 'Bearer fixture' }])
        assert.throws(() => assertPublicRequest({ ...request(), headers: { ...request().headers, ...change } }, config));
    assert.throws(() => assertPublicRequest(request(), { ...config, mode: 'LOCAL_FIXTURE' }));
});
test('public selectors preserve exact versions and reject arrays, loose numbers and foreign tokens', () => {
    const token = 'ar_abcdefghijklmnopqrstuvwx';
    assert.deepEqual(reportSelector(token), { token, version: null });
    assert.deepEqual(reportSelector(token, '2'), { token, version: 2 });
    for (const version of ['0', '-1', '01', '2.0', '1e0', '2147483648', ['1'], null]) assert.throws(() => reportSelector(token, version));
    for (const invalid of ['tk2c_abcdefghijklmnopqrstuvwx', 'ar_x', [token], undefined]) assert.throws(() => reportSelector(invalid));
});
