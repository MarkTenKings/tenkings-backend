import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Start only the existing production artifact in a scrubbed, owned process.
// Deliberate local flags must not enable a fixture, database or SMS provider.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local'])
    assert(!existsSync(resolve(root, name)), 'Refusing app environment files in the production denial fixture');
const buildId = readFileSync(resolve(root, '.next/BUILD_ID'), 'utf8').trim();
assert(/^[A-Za-z0-9_-]+$/.test(buildId), 'A completed customer production build is required');
const port = await new Promise((done, reject) => {
    const probe = createServer().once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
        const value = probe.address().port;
        probe.close(error => error ? reject(error) : done(value));
    });
});
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', root, '-H', '127.0.0.1', '-p', String(port)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
        VERCEL_ENV: 'production', VERCEL_URL: 'atlas-customer-denial-fixture.vercel.app', VERCEL_GIT_COMMIT_SHA: '0'.repeat(40),
        ATLAS_CUSTOMER_RUNTIME: 'postgres', ATLAS_CUSTOMER_ORIGIN: 'https://atlasgrading.com',
        ATLAS_LOCAL_CUSTOMER: '1', ATLAS_LOCAL_CUSTOMER_FILE: '/private/tmp/not-an-owned-fixture/customer-web-config.json',
        ATLAS_LOCAL_SYNTHETIC: '1', ATLAS_LOCAL_POSTGRES: '1', ATLAS_LOCAL_PUBLIC: '1' }
});
let output = '', startError, checks = 0;
const record = value => { output = (output + value).slice(-65536); };
server.stdout.on('data', record); server.stderr.on('data', record);
server.once('error', error => { startError = error; });
const ended = new Promise(done => server.once('close', done));
const id = '00000000-0000-4000-8000-000000000001';
const forbidden = /Local demonstration|Synthetic SMS|LOCAL_FIXTURE|424242|\+1(?:[ ()-]*202)[ ()-]*555|Send verification code|Signed in with|Your next chapter starts here/;
async function check(path, expected, options = {}, type = 'page') {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000), ...options });
    assert.equal(response.status, expected, path);
    assert.equal(response.headers.get('set-cookie'), null, `${path} must not issue cookies`);
    const text = await response.text();
    assert(!forbidden.test(text), `${path} exposed fixture or sign-in content while disabled`);
    if (expected === 503) {
        for (const header of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control'])
            assert.match(response.headers.get(header) ?? '', /no-store/, `${path} must be private at ${header}`);
        if (type === 'data') {
            assert.match(response.headers.get('content-type') ?? '', /application\/json/);
            assert.deepEqual(JSON.parse(text).pageProps, { unavailable: true });
        } else if (type === 'api') {
            assert.match(response.headers.get('content-type') ?? '', /application\/json/);
            assert.deepEqual(JSON.parse(text), { error: 'CUSTOMER_ACCESS_NOT_ENABLED' });
        } else if (options.method !== 'HEAD') assert.match(text, /Account access is unavailable/);
    }
    checks++;
    return text;
}
try {
    const deadline = Date.now() + 15_000;
    while (!output.includes('Ready in')) {
        assert(!startError && server.exitCode === null && Date.now() < deadline, 'Owned customer production server did not start');
        await delay(50);
    }
    const pageHtml = await check('/account', 503);
    for (const path of ['/account/submit', '/account/profile', `/account/submissions/${id}`]) await check(path, 503);
    await check('/account', 503, { method: 'HEAD' });
    for (const page of ['index', 'submit', 'profile', `submissions/${id}`])
        await check(`/account/_next/data/${buildId}/${page}.json`, 503, {}, 'data');
    for (const path of ['session', 'submissions', `submissions/${id}`, `cards/${id}`, `submission-requests/${id}`])
        await check(`/account/api/customer/${path}`, 503, {}, 'api');
    const body = path => JSON.stringify(path === 'auth/request' ? { phone: '+12025550141', requestId: id }
        : path === 'auth/verify' ? { challengeId: id, code: '424242' } : {});
    for (const path of ['auth/request', 'auth/verify', 'auth/logout', 'profile', 'submissions'])
        await check(`/account/api/customer/${path}`, 503, { method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://atlasgrading.com', 'Sec-Fetch-Site': 'same-origin' },
            body: body(path) }, 'api');
    for (const path of ['/account', `/account/_next/data/${buildId}/submit.json`, '/account/api/customer/session'])
        await check(path, 503, { headers: { Host: 'atlasgrading.com', 'X-Forwarded-Host': 'atlasgrading.com',
            'X-Forwarded-Proto': 'https', 'X-Atlas-Route-Proof': 'untrusted' } },
        path.includes('/api/') ? 'api' : path.includes('/_next/data/') ? 'data' : 'page');
    for (const path of ['/', '/index', '/submit', '/profile', `/submissions/${id}`, '/api/customer/session',
        '/account/index', '/accounting', '/accounting/api/customer/session', '/accountant',
        '/account/api/staff/session', '/admin', '/admin/api/staff/session', `/_next/data/${buildId}/index.json`])
        await check(path, 404);
    const assets = [...pageHtml.matchAll(/<script[^>]*src="([^"]+)"/g)].map(match => match[1]);
    assert(assets.length > 0, 'Built unavailable page must reference its own script assets');
    for (const asset of assets) {
        assert(asset.startsWith('/account/_next/'), `Customer asset escaped /account: ${asset}`);
        const response = await fetch(`${origin}${asset}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
        assert.equal(response.status, 200, asset); assert.equal(response.headers.get('set-cookie'), null);
        await response.body?.cancel(); checks++;
    }
    console.log(JSON.stringify({ status: 'BUILT_CUSTOMER_PRODUCTION_DENIAL_PASS', checks, basePath: '/account',
        fixtureFlagsPresent: true, sessionCookiesIssued: 0, liveCredentialsProvided: false }));
} finally {
    server.kill('SIGTERM');
    await Promise.race([ended, delay(5000).then(() => { if (server.exitCode === null) server.kill('SIGKILL'); })]);
    await ended;
}
