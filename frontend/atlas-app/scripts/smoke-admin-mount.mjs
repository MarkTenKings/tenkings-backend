import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

// Exercise the actual production artifact with the explicitly development-only
// loopback fixture. This is synthetic route acceptance, never production auth,
// provider, database or hardware acceptance. Logical Host is the local router's
// fixed origin; the owned upstream listens on a temporary port.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url), logicalOrigin = 'http://127.0.0.1:4318';
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local'])
    assert(!existsSync(resolve(root, name)), 'Refusing app environment files in the synthetic mount fixture');
const port = await new Promise((done, reject) => {
    const probe = createServer().once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(error => error ? reject(error) : done(port)); });
});
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', root, '-H', '127.0.0.1', '-p', String(port)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1', ATLAS_LOCAL_SYNTHETIC: '1' }
});
let output = '', checks = 0;
server.stdout.on('data', value => { output += value; }); server.stderr.on('data', value => { output += value; });
const ended = new Promise(resolve => server.once('exit', resolve)), jar = new Map();
async function call(path, { body, csrf, headers = {}, sendCookies = true } = {}) {
    const response = await new Promise((resolve, reject) => {
        const request = httpRequest(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST',
            headers: { Host: '127.0.0.1:4318', 'X-Forwarded-Host': '127.0.0.1:4318', 'X-Forwarded-Proto': 'http',
            ...(sendCookies ? { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
            ...(body === undefined ? {} : { Origin: logicalOrigin, 'Content-Type': 'application/json', 'X-Atlas-Csrf': csrf ?? '' }), ...headers }
        }, response => {
            const chunks = []; let length = 0;
            response.on('data', chunk => { length += chunk.length; if (length > 4_000_000) request.destroy(new Error('Oversized fixture response')); else chunks.push(chunk); });
            response.on('error', reject);
            response.on('end', () => {
                const headers = new Headers();
                for (let i = 0; i < response.rawHeaders.length; i += 2) headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
                resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers }));
            });
        });
        request.setTimeout(15_000, () => request.destroy(new Error('Fixture request timed out')));
        request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
    });
    for (const cookie of response.headers.getSetCookie()) {
        assert.match(cookie, /^atlas_local_(browser|staff)=[A-Za-z0-9_-]*; HttpOnly; Path=\/admin; SameSite=Lax;/);
        const [key, value] = cookie.split(';')[0].split('='); if (value) jar.set(key, value); else jar.delete(key);
    }
    return response;
}
try {
    const deadline = Date.now() + 15_000;
    while (!output.includes('Ready in')) {
        assert(server.exitCode === null && Date.now() < deadline, 'Owned built synthetic server did not start'); await delay(50);
    }
    let response = await call('/admin');
    if (response.status !== 200) {
        const diagnostic = await call('/admin/api/staff/session');
        throw new Error(`Built loopback fixture refused: ${(await diagnostic.json()).error ?? diagnostic.status}`);
    }
    assert.match(await response.text(), /Local preview/); checks++;
    response = await call('/admin/grading'); assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get('location'), logicalOrigin).pathname.replace(/\/$/, ''), '/admin'); checks++;
    response = await call('/admin/api/staff/session'); assert.equal(response.status, 200);
    const boot = await response.json(); assert.equal(boot.staff, null); checks++;
    response = await call('/admin/api/staff/auth/request', { body: { phone: '+12025550141', requestId: 'mounted-login-fixture' }, csrf: boot.csrf });
    assert.equal(response.status, 200); const challenge = await response.json(); checks++;
    response = await call('/admin/api/staff/auth/verify', { body: { challengeId: challenge.challengeId, code: '424242' }, csrf: boot.csrf });
    assert.equal(response.status, 200); const signed = await response.json(); assert.equal(signed.staff.role, 'REVIEWER'); checks++;
    response = await call('/admin/grading'); assert.equal(response.status, 200); const queue = await response.text();
    assert.match(queue, /href="\/admin\/grading"/); assert.match(queue, /href="\/admin\/operations"/); checks++;
    response = await call('/admin/cards/sample-001'); assert.equal(response.status, 200); checks++;
    response = await call('/admin/api/staff/cards/sample-001'); assert.equal(response.status, 200); assert.equal((await response.json()).card.id, 'sample-001'); checks++;
    response = await call('/admin/api/staff/evidence/sample-001/FRONT'); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/svg\+xml/); checks++;
    const buildId = readFileSync(resolve(root, '.next/BUILD_ID'), 'utf8').trim();
    response = await call(`/admin/_next/data/${buildId}/cards/sample-001.json`); assert.equal(response.status, 200); assert((await response.json()).pageProps.staff); checks++;
    response = await call('/admin/api/staff/auth/logout', { body: {}, csrf: boot.csrf }); assert.equal(response.status, 403); checks++;
    response = await call('/admin/api/staff/auth/logout', { body: {}, csrf: signed.csrf, headers: { Origin: 'https://app.atlasgrading.com' } }); assert.equal(response.status, 403); checks++;
    response = await call('/admin/api/staff/auth/logout', { body: {}, csrf: signed.csrf }); assert.equal(response.status, 200); assert.equal(jar.has('atlas_local_staff'), false); checks++;
    response = await call('/admin/api/staff/cards'); assert.equal(response.status, 401); checks++;
    for (const path of ['/api/staff/session', '/grading', '/administrator', '/account']) {
        response = await call(path, { sendCookies: false }); assert.equal(response.status, 404, path); assert.equal(response.headers.get('set-cookie'), null); checks++;
    }
    console.log(JSON.stringify({ status: 'BUILT_ADMIN_SYNTHETIC_MOUNT_PASS', checks, basePath: '/admin',
        productionAuthentication: false, externalProviderCalls: 0, databaseWrites: 0, hardwareOperations: 0 }));
} finally {
    server.kill('SIGTERM');
    await Promise.race([ended, delay(5000).then(() => { if (server.exitCode === null) server.kill('SIGKILL'); })]);
}
