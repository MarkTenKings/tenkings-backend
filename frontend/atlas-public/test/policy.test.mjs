import assert from 'node:assert/strict';
import test from 'node:test';
import { productionConfig, assertPublicRequest, reportSelector, PUBLIC_ORIGIN } from '../lib/server/policy.mjs';
const env = { NODE_ENV: 'production', VERCEL_ENV: 'production', ATLAS_PUBLIC_RUNTIME: 'postgres', ATLAS_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    VERCEL_URL: 'atlas-public-release.vercel.app', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    ATLAS_PUBLIC_DATABASE_URL: 'postgresql://public:fixture@db.example/report?schema=atlas_staff&sslmode=require',
    ATLAS_PUBLIC_MEDIA_ORIGIN: 'https://bridge.example.test', ATLAS_PUBLIC_MEDIA_KEY: Buffer.alloc(32, 4).toString('base64') };
const request = () => ({ method: 'GET', headers: { host: 'atlasgrading.com', 'x-forwarded-host': 'atlasgrading.com', 'x-forwarded-proto': 'https' } });
test('public deployment configuration requires exact host, environment, release and dedicated DB', () => {
    const config = productionConfig(env); assert.equal(config.mode, 'PRODUCTION');
    for (const change of [{ NODE_ENV: 'development' }, { VERCEL_ENV: 'preview' }, { ATLAS_LOCAL_PUBLIC: '1' },
        { ATLAS_LOCAL_POSTGRES_FILE: '/tmp/config' }, { ATLAS_PUBLIC_ORIGIN: 'https://app.atlasgrading.com' },
        { VERCEL_URL: 'unknown.example' }, { VERCEL_GIT_COMMIT_SHA: '' }, { ATLAS_PUBLIC_DATABASE_URL: 'postgresql://a:b@db.example/public' },
        { ATLAS_PUBLIC_MEDIA_ORIGIN: 'http://bridge.example.test' }, { ATLAS_PUBLIC_MEDIA_KEY: '' }])
        assert.throws(() => productionConfig({ ...env, ...change }));
    assert.notEqual(productionConfig({ ...env, ATLAS_PUBLIC_DATABASE_URL: env.ATLAS_PUBLIC_DATABASE_URL.replace('fixture', 'rotated') }).configHash, config.configHash);
    assert.notEqual(productionConfig({ ...env, ATLAS_PUBLIC_MEDIA_KEY: Buffer.alloc(32, 5).toString('base64') }).configHash, config.configHash);
});
test('only exact apex GET/HEAD requests can read; machine headers and writes never borrow public authority', () => {
    const config = productionConfig(env); assert.doesNotThrow(() => assertPublicRequest(request(), config));
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.throws(() => assertPublicRequest({ ...request(), method }, config));
    for (const change of [{ host: 'app.atlasgrading.com' }, { 'x-forwarded-host': 'atlas-public-release.vercel.app' },
        { 'x-forwarded-proto': 'http' }, { authorization: 'Bearer fixture' }])
        assert.throws(() => assertPublicRequest({ ...request(), headers: { ...request().headers, ...change } }, config));
});
test('public selectors preserve exact versions and reject arrays, loose numbers and foreign tokens', () => {
    const token = 'ar_abcdefghijklmnopqrstuvwx';
    assert.deepEqual(reportSelector(token), { token, version: null });
    assert.deepEqual(reportSelector(token, '2'), { token, version: 2 });
    for (const version of ['0', '-1', '01', '2.0', '1e0', '2147483648', ['1'], null]) assert.throws(() => reportSelector(token, version));
    for (const invalid of ['tk2c_abcdefghijklmnopqrstuvwx', 'ar_x', [token], undefined]) assert.throws(() => reportSelector(invalid));
});

test('owned local requests accept Next forwarding normalization but reject a substituted host', () => {
    const config = { mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4319' };
    const req = { method: 'GET', headers: { host: '127.0.0.1:4319', 'x-forwarded-host': '127.0.0.1:4319', 'x-forwarded-proto': 'http' }, socket: { remoteAddress: '127.0.0.1' } };
    assert.doesNotThrow(() => assertPublicRequest(req, config));
    assert.throws(() => assertPublicRequest({ ...req, headers: { ...req.headers, 'x-forwarded-host': 'app.atlasgrading.com' } }, config));
    assert.throws(() => assertPublicRequest({ ...req, socket: { remoteAddress: '203.0.113.1' } }, config));
});

test('dedicated manual bridge is paired, fixed-host, separately keyed and included in configuration binding', () => {
    const base=productionConfig(env),key=Buffer.alloc(32,8).toString('base64');
    const configured=productionConfig({...env,ATLAS_PUBLIC_MANUAL_ORIGIN:'https://private.atlasgrading.com',ATLAS_PUBLIC_MANUAL_KEY:key});
    assert.notEqual(configured.configHash,base.configHash);assert.deepEqual(configured.manualKey,Buffer.alloc(32,8));
    for(const change of [{ATLAS_PUBLIC_MANUAL_ORIGIN:'https://private.atlasgrading.com'},{ATLAS_PUBLIC_MANUAL_KEY:key},{ATLAS_PUBLIC_MANUAL_ORIGIN:'https://attacker.invalid',ATLAS_PUBLIC_MANUAL_KEY:key},{ATLAS_PUBLIC_MANUAL_ORIGIN:'https://private.atlasgrading.com',ATLAS_PUBLIC_MANUAL_KEY:env.ATLAS_PUBLIC_MEDIA_KEY}])assert.throws(()=>productionConfig({...env,...change}));
    assert.equal(productionConfig({...env}).configHash,base.configHash);
});

test('manual-only public runtime needs no legacy credential, has a distinct binding and rejects every partial legacy tuple',()=>{
    const manual={...env,ATLAS_PUBLIC_RUNTIME:'manual',ATLAS_PUBLIC_MANUAL_ORIGIN:'https://private.atlasgrading.com',ATLAS_PUBLIC_MANUAL_KEY:Buffer.alloc(32,8).toString('base64')};
    const keys=['ATLAS_PUBLIC_DATABASE_URL','ATLAS_PUBLIC_MEDIA_ORIGIN','ATLAS_PUBLIC_MEDIA_KEY'];for(const key of keys)delete manual[key];
    const config=productionConfig(manual);assert.equal(config.databaseUrl,undefined);assert.equal(config.mediaKey,undefined);assert.ok(config.manualKey);
    for(let mask=1;mask<7;mask++){const partial={...manual};keys.forEach((key,index)=>{if(mask&(1<<index))partial[key]=env[key];});assert.throws(()=>productionConfig(partial));}
    assert.throws(()=>productionConfig({...manual,ATLAS_PUBLIC_RUNTIME:'postgres'}));
    const changed=productionConfig({...manual,ATLAS_PUBLIC_MANUAL_KEY:Buffer.alloc(32,9).toString('base64')});assert.notEqual(changed.configHash,config.configHash);
});
test('fully configured legacy public hash retains the exact pre-manual serialization',async()=>{
    const {digest}=await import('../lib/server/policy.mjs');const config=productionConfig(env);
    const old=digest(JSON.stringify({version:'atlas-public-reader-v1',mode:'PRODUCTION',origin:PUBLIC_ORIGIN,databaseBindingHash:digest(new URL(env.ATLAS_PUBLIC_DATABASE_URL).href),mediaOrigin:env.ATLAS_PUBLIC_MEDIA_ORIGIN,mediaKeyHash:digest(Buffer.from(env.ATLAS_PUBLIC_MEDIA_KEY,'base64'))}));
    assert.equal(config.configHash,old);
});
