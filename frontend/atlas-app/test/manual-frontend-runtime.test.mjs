import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { parseBody } from 'next/dist/server/api-utils/node/parse-body.js';
import { signRoute } from '@atlas/site-router/proof';
import { assertPrivateManualRequest, createPrivateManualNonceStore } from '@atlas/connected-manual/transport';
import { createConnectedHandler } from '@atlas/connected-manual/http';
import { createFrontendManualRuntime } from '../lib/server/manual-frontend-runtime.mjs';
import { productionAccessConfig, assertProductionStaffRequest } from '../lib/server/access/config.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { isBoundaryError } from '../lib/server/policy.mjs';

const serviceKey = Buffer.alloc(32, 4);
const env = { ATLAS_MANUAL_ENABLED: 'true', ATLAS_MANUAL_SERVICE_ORIGIN: 'https://manual-private.atlasgrading.com',
  ATLAS_MANUAL_UPLOAD_ORIGIN: 'https://manual-fixture.nyc3.digitaloceanspaces.com', ATLAS_MANUAL_SERVICE_KEY: serviceKey.toString('base64') };
const staffConfig = productionAccessConfig({ NODE_ENV: 'production', ATLAS_STAFF_RUNTIME: 'postgres',
  VERCEL_ENV: 'production', VERCEL_URL: 'manual-fixture.vercel.app', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  ATLAS_STAFF_ORIGIN: 'https://atlasgrading.com', ATLAS_STAFF_BASE_PATH: '/admin',
  ATLAS_DATABASE_URL: 'postgresql://staff:fictional@db.example.test:5432/atlas?schema=atlas_staff&sslmode=require',
  ATLAS_AUTH_TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`, ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID: `VA${'2'.repeat(32)}`,
  ATLAS_AUTH_SESSION_KEY: Buffer.alloc(32, 1).toString('base64'), ATLAS_AUTH_PHONE_KEY: Buffer.alloc(32, 2).toString('base64'),
  ATLAS_STAFF_ROUTER_KEY: Buffer.alloc(32, 3).toString('base64'), ATLAS_ADMIN_PHONES: '+12025550141' });
const id = 'cd960992-513b-4904-ae56-c10e70783ef1';
const intakePath = '/api/staff/manual-intake/cards';
const digest = value => createHash('sha256').update(value).digest('hex');
// Load the actual catchall export with its real handler and a fixture runtime;
// importing the production runtime would construct unrelated database clients.
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core');
const compiledApi = babel.transformSync(readFileSync(new URL('../pages/api/staff/[...path].js', import.meta.url), 'utf8'), {
  filename: '[...path].js', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]],
  babelrc: false, configFile: false,
}).code;
function staffApi(state) {
  const exports = {};
  vm.runInNewContext(compiledApi, { exports, require(name) {
    if (name === '../../../lib/server/http.mjs') return { createHandler };
    if (name === '../../../lib/server/runtime.mjs') return { runtime: () => state };
    throw new Error(`Unexpected API import: ${name}`);
  } });
  return exports;
}
async function parseNextBody(req, text, config) {
  const socket = new Socket(), raw = new IncomingMessage(socket);
  try {
    raw.method = req.method;
    raw.headers = { ...req.headers, 'content-length': String(Buffer.byteLength(text)) };
    raw.push(Buffer.from(text)); raw.push(null);
    return await parseBody(raw, config.api.bodyParser.sizeLimit);
  } finally { raw.destroy(); socket.destroy(); }
}
function response() {
  return { headers: {}, statusCode: null, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.value = value; },
    send(bytes) { this.bytes = bytes; this.value = JSON.parse(bytes); } };
}
function fixture({ privateHandler } = {}) {
  const events = [], requests = [], now = new Date(); let providerCalls = 0;
  const sessionToken = Buffer.alloc(32, 11).toString('base64url'), browserToken = Buffer.alloc(32, 12).toString('base64url');
  const identity = { id, name: 'Ordinary staff fixture', role: 'REVIEWER', accessVersion: 1,
    phoneHash: staffConfig.phoneHash('+12025550141'), revokedAt: null };
  const session = { tokenHash: digest(sessionToken), browserHash: digest(browserToken), identityId: id, identity,
    revokedAt: null, expiresAt: new Date(+now + 60000), accessVersion: 1, controlRevision: 1,
    browser: { expiresAt: new Date(+now + 60000), controlRevision: 1 } };
  const tx = { staffSession: { async findUnique({ where }) { return where.tokenHash === session.tokenHash ? session : null; } },
    async $queryRaw() { return [identity]; } };
  const auth = new DurableStaffAuth({ config: staffConfig,
    database: { async transaction(work) { events.push('staff-auth'); return work({ tx, now, control: { revision: 1 } }); } },
    provider: { start() { providerCalls++; throw Error('Provider must not run'); }, check() { providerCalls++; throw Error('Provider must not run'); } } });
  const cookie = `${staffConfig.cookies.session}=${sessionToken}; ${staffConfig.cookies.browser}=${browserToken}`;
  const csrf = auth.digest(`session:${sessionToken}`), nonces = createPrivateManualNonceStore();
  const assertRequest = async req => { events.push(`ingress:${req.url}`); assertProductionStaffRequest(req, staffConfig); };
  const fetchImpl = async (url, init) => {
    events.push('private-dispatch'); requests.push({ url, init });
    assert.equal(new URL(url).origin, env.ATLAS_MANUAL_SERVICE_ORIGIN);
    await assertPrivateManualRequest({ url: new URL(url).pathname + new URL(url).search, method: init.method,
      headers: init.headers, rawBody: Buffer.from(init.body ?? '') }, { key: serviceKey, origin: staffConfig.origin, nonceStore: nonces });
    if (privateHandler) {
      const res = response();
      await privateHandler({ url: new URL(url).pathname + new URL(url).search, method: init.method,
        headers: init.headers, body: init.body ? JSON.parse(init.body.toString()) : undefined }, res);
      return Response.json(res.value, { status: res.statusCode });
    }
    return Response.json({ ok: true });
  };
  const runtime = createFrontendManualRuntime({ env, auth, staffConfig, assertRequest, fetchImpl });
  async function request({ method = 'POST', url = intakePath, headers = {}, body = method === 'POST' ? { requestId: id, label: 'Fixture' } : undefined } = {}) {
    const target = url.startsWith('/admin/') ? url : `/admin${url}`;
    const proof = await signRoute({ zone: 'staff', deployment: `https://${staffConfig.deploymentId}`, method, target,
      issuedAt: Date.now() }, staffConfig.routerKey.toString('base64'));
    return Object.assign(new EventEmitter(), { method, url, body, headers: { host: staffConfig.deploymentId,
      'x-forwarded-proto': 'https', 'x-forwarded-host': 'atlasgrading.com', ...proof, cookie,
      'content-type': 'application/json', origin: staffConfig.origin, 'x-atlas-csrf': csrf, 'sec-fetch-site': 'same-origin', ...headers } });
  }
  return { runtime, request, auth, assertRequest, events, requests, identity, session, cookie, csrf,
    providerCalls: () => providerCalls };
}

test('disabled runtime is inert; enabled configuration requires fixed canonical owned HTTPS origins and a distinct canonical key', () => {
  assert.equal(createFrontendManualRuntime({ env: {} }), null);
  assert.equal(createFrontendManualRuntime({ env: { ATLAS_MANUAL_ENABLED: 'TRUE' } }), null);
  let calls = 0;
  const dependencies = { auth: { authenticate() { calls++; } }, staffConfig, assertRequest() { calls++; }, fetchImpl() { calls++; } };
  assert.equal(createFrontendManualRuntime({ env, ...dependencies }).uploadOrigin, env.ATLAS_MANUAL_UPLOAD_ORIGIN);
  for (const change of [
    { ATLAS_MANUAL_SERVICE_ORIGIN: 'http://manual-private.atlasgrading.com' },
    { ATLAS_MANUAL_SERVICE_ORIGIN: 'https://private.example.com' },
    { ATLAS_MANUAL_SERVICE_ORIGIN: 'https://atlasgrading.com.attacker.test' },
    { ATLAS_MANUAL_SERVICE_ORIGIN: 'https://manual-private.atlasgrading.com/' },
    { ATLAS_MANUAL_SERVICE_ORIGIN: 'https://user:secret@manual-private.atlasgrading.com' },
    { ATLAS_MANUAL_SERVICE_ORIGIN: 'https://manual-private.atlasgrading.com/path' },
    { ATLAS_MANUAL_SERVICE_ORIGIN: 'https://manual-private.atlasgrading.com?query=1' },
    { ATLAS_MANUAL_SERVICE_ORIGIN: 'https://manual-private.atlasgrading.com#fragment' },
    { ATLAS_MANUAL_SERVICE_ORIGIN: 'https://manual-private.atlasgrading.com:443' },
    { ATLAS_MANUAL_UPLOAD_ORIGIN: 'http://objects.example.com' },
    { ATLAS_MANUAL_UPLOAD_ORIGIN: 'https://objects.example.com/path' },
    { ATLAS_MANUAL_UPLOAD_ORIGIN: 'https://user:secret@objects.example.com' },
    { ATLAS_MANUAL_SERVICE_KEY: undefined }, { ATLAS_MANUAL_SERVICE_KEY: 42 },
    { ATLAS_MANUAL_SERVICE_KEY: Buffer.alloc(31).toString('base64') },
    { ATLAS_MANUAL_SERVICE_KEY: `${env.ATLAS_MANUAL_SERVICE_KEY}\n` },
    { ATLAS_MANUAL_SERVICE_KEY: env.ATLAS_MANUAL_SERVICE_KEY.slice(0, -1) },
    ...[staffConfig.sessionKey, staffConfig.phoneKey, staffConfig.routerKey].map(key => ({ ATLAS_MANUAL_SERVICE_KEY: key.toString('base64') })),
  ]) assert.throws(() => createFrontendManualRuntime({ ...dependencies, env: { ...env, ...change } }),
    error => isBoundaryError(error) && error.status === 503 && error.code === 'MANUAL_CONFIGURATION_INVALID');
  for (const change of [{ origin: env.ATLAS_MANUAL_SERVICE_ORIGIN }, { origin: 'http://atlasgrading.com' }, { routerKey: undefined }])
    assert.throws(() => createFrontendManualRuntime({ env, ...dependencies, staffConfig: { ...staffConfig, ...change } }));
  assert.throws(() => createFrontendManualRuntime({ env, ...dependencies, auth: {} }));
  assert.throws(() => createFrontendManualRuntime({ env, ...dependencies, assertRequest: undefined }));
  assert.equal(calls, 0);
});

test('only new card paths are owned; unrelated and ambiguous routes do not authenticate, dispatch or mutate the request', async () => {
  const f = fixture();
  for (const url of ['/api/staff/session', '/admin/api/staff/session', '/api/staff/workspace/cards', '/admin/api/staff/operations/roster',
    '/api/staff/manual', '/api/staff/manual/not-cards', '/api/staff/manualoperator/cards', '/api/staff/manual-intake/cards-malformed',
    '/administer/api/staff/manual-intake/cards', '/admin/admin/api/staff/manual-intake/cards',
    '/admin//api/staff/manual-intake/cards', '/admin/api/staff/manual-intake/cards/../cards', '/admin/api/staff/manual-intake/cards/%2fescape',
    '//foreign.test/api/staff/manual-intake/cards', 'https://foreign.test/api/staff/manual-intake/cards', `${intakePath}#fragment`]) {
    const req = { url, method: 'GET', headers: {} };
    assert.equal(await f.runtime.handler(req, response()), false, url); assert.equal(req.url, url);
  }
  assert.deepEqual(f.events, []); assert.equal(f.requests.length, 0); assert.equal(f.providerCalls(), 0);
});

test('ordinary durable auth and ingress proof run before proxy; mounted and normalized URLs sign the same exact private path without mutating ingress', async () => {
  const f = fixture();
  const cases = [
    { method: 'POST', url: intakePath },
    { method: 'GET', url: `/admin${intakePath}?limit=30&cursor=cursor_1` },
    { method: 'POST', url: `/admin/api/staff/manual/cards/${id}/actions` },
    { method: 'POST', url: `/admin/api/staff/manual-connected/cards/${id}/details` },
  ];
  for (const input of cases) {
    f.events.length = 0;
    const req = await f.request({ ...input, headers: { 'x-browser-principal': 'REVIEWER', 'x-atlas-manual-signature': 'forged-browser-signature' } });
    Object.defineProperty(req, 'url', { value: input.url, writable: false });
    const res = response(); assert.equal(await f.runtime.handler(req, res), true); assert.equal(res.statusCode, 200);
    assert.deepEqual(f.events, [`ingress:${input.url}`, 'staff-auth', 'private-dispatch']);
    assert.equal(req.url, input.url); assert.equal(req.listenerCount('aborted'), 0);
    const forwarded = f.requests.at(-1), normalized = input.url.startsWith('/admin/') ? input.url.slice(6) : input.url;
    assert.equal(forwarded.url, env.ATLAS_MANUAL_SERVICE_ORIGIN + normalized);
    assert.equal(forwarded.init.headers.cookie, f.cookie); assert.equal(forwarded.init.headers['x-atlas-csrf'], f.csrf);
    assert.equal(forwarded.init.headers['x-browser-principal'], undefined);
    assert.equal(forwarded.init.headers['x-atlas-route-proof'], undefined);
    assert.notEqual(forwarded.init.headers['x-atlas-manual-signature'], 'forged-browser-signature');
    if (req.body) assert.equal(forwarded.init.body.toString(), JSON.stringify(req.body));
  }
  assert.equal(f.providerCalls(), 0);
});

test('gateway, cookie, public origin, same-origin fetch, JSON and actual session CSRF failures never reach the service', async () => {
  const f = fixture();
  for (const [change, code, status] of [
    [{ headers: { 'x-atlas-route-proof': '0'.repeat(64) } }, 'HOST_NOT_ALLOWED', 403],
    [{ headers: { authorization: 'Bearer browser-claim' } }, 'STAFF_COOKIE_REQUIRED', 403],
    [{ headers: { cookie: 'forged', 'x-browser-principal': 'REVIEWER' } }, 'SIGN_IN_REQUIRED', 401],
    [{ headers: { origin: 'https://foreign.test' } }, 'ORIGIN_NOT_ALLOWED', 403],
    [{ headers: { 'sec-fetch-site': 'cross-site' } }, 'ORIGIN_NOT_ALLOWED', 403],
    [{ headers: { 'content-type': 'text/plain' } }, 'JSON_REQUIRED', 415],
    [{ headers: { 'x-atlas-csrf': '' } }, 'CSRF_REQUIRED', 403],
    [{ headers: { 'x-atlas-csrf': undefined } }, 'CSRF_REQUIRED', 403],
    [{ headers: { 'x-atlas-csrf': 'wrong-but-nonempty' } }, 'CSRF_REQUIRED', 403],
    [{ method: 'DELETE' }, 'METHOD_NOT_ALLOWED', 405],
  ]) {
    const req = await f.request(change);
    const res = response(); let streamed = false;
    res.write = () => { streamed = true; };
    await assert.rejects(f.runtime.handler(req, res), error => isBoundaryError(error) && error.code === code && error.status === status);
    assert.equal(streamed, false); assert.equal(res.headers['x-atlas-manual-stream'], undefined);
  }
  f.session.revokedAt = new Date();
  await assert.rejects(f.runtime.handler(await f.request(), response()), { code: 'SIGN_IN_REQUIRED', status: 401 });
  assert.equal(f.requests.length, 0); assert.equal(f.providerCalls(), 0);
});

test('actual staff HTTP error mapping retains frontend CSRF403 and missing-session401', async () => {
  const f = fixture();
  const handler = createHandler({ connectedManual: f.runtime, auth: f.auth, review: {}, origin: staffConfig.origin,
    assertRequest: req => assertProductionStaffRequest(req, staffConfig) });
  for (const [headers, code, status] of [[{ 'x-atlas-csrf': '' }, 'CSRF_REQUIRED', 403],
    [{ origin: 'https://foreign.test' }, 'ORIGIN_NOT_ALLOWED', 403], [{ cookie: '' }, 'SIGN_IN_REQUIRED', 401]]) {
    const res = response(); await handler(await f.request({ headers }), res);
    assert.equal(res.statusCode, status); assert.equal(res.value.error, code);
  }
  assert.equal(f.requests.length, 0);
});

test('Next empty GET parser representations normalize to no body, while declared/raw/nonempty GET bytes are never dropped', async () => {
  const f = fixture();
  for (const body of [{}, '', undefined, null, Buffer.alloc(0)]) {
    const req = await f.request({ method: 'GET', url: `/admin${intakePath}`, body });
    req.rawBody = Buffer.alloc(0);
    const res = response(); await f.runtime.handler(req, res);
    assert.equal(res.statusCode, 200); assert.equal(f.requests.at(-1).init.body, undefined);
    assert.equal(req.body, body); assert.equal(req.url, `/admin${intakePath}`);
  }
  const zeroDeclared = await f.request({ method: 'GET', body: {}, headers: { 'content-length': '0' } });
  await f.runtime.handler(zeroDeclared, response());
  const count = f.requests.length;
  for (const change of [
    { headers: { 'content-length': '2' }, body: {} }, { headers: { 'content-length': '' }, body: {} },
    { headers: { 'transfer-encoding': 'chunked' }, body: {} }, { body: { unexpected: true } },
    { body: '{}' }, { body: Buffer.from('{}') }, { body: [] },
    { body: {}, rawBody: Buffer.from('{}') }, { body: {}, readableLength: 2 },
  ]) {
    const req = await f.request({ method: 'GET', body: change.body, headers: change.headers });
    if (change.rawBody) req.rawBody = change.rawBody;
    if (change.readableLength) req.readableLength = change.readableLength;
    await assert.rejects(f.runtime.handler(req, response()), { status: 400, code: 'MANUAL_REQUEST_INVALID' });
  }
  assert.equal(f.requests.length, count);
});

test('actual Next parseBody default for a bodyless IncomingMessage produces an empty string accepted by the proxy wrapper', async () => {
  const socket = new Socket(), raw = new IncomingMessage(socket);
  try {
    raw.method = 'GET'; raw.headers = {}; raw.push(null);
    const body = await parseBody(raw, staffApi({}).config.api.bodyParser.sizeLimit); assert.equal(body, '');
    const f = fixture(), req = await f.request({ method: 'GET', url: `/admin${intakePath}`, body });
    const res = response(); await f.runtime.handler(req, res);
    assert.equal(res.statusCode, 200); assert.equal(f.requests[0].init.body, undefined); assert.equal(req.body, '');
  } finally { raw.destroy(); socket.destroy(); }
});

test('actual catchall parser accepts valid manual intake JSON above 1 MiB through 2 MiB on the wire and the signed proxy/private handler', async () => {
  const received = [], input = { requestId: id, label: 'Fixture' };
  const privateHandler = createConnectedHandler({ origin: staffConfig.origin, assertRequest() {},
    boundary: { authenticate: async () => ({ id }) },
    connected: { workflow: { service: {} }, intake: { async create(_staff, body) {
      assert.deepEqual(body, input); received.push(body); return { ok: true };
    } } },
  });
  const f = fixture({ privateHandler }), api = staffApi({ connectedManual: f.runtime, auth: f.auth, review: {},
    origin: staffConfig.origin, assertRequest: f.assertRequest });
  assert.equal(api.config.api.bodyParser.sizeLimit, '2mb');
  const json = JSON.stringify(input);
  for (const bytes of [1024 * 1024 + 1, 2 * 1024 * 1024]) {
    // Whitespace is valid JSON, not extra business data or a larger route schema.
    const text = json + ' '.repeat(bytes - Buffer.byteLength(json));
    const req = await f.request(); req.body = await parseNextBody(req, text, api.config);
    const res = response(); await api.default(req, res);
    assert.equal(res.statusCode, 200); assert.deepEqual(res.value, { ok: true });
    assert.equal(f.requests.at(-1).init.body.toString(), json);
  }
  assert.equal(received.length, 2); assert.equal(f.providerCalls(), 0);
});

test('actual configured Next parser rejects more than 2 MiB before runtime, auth, proxy or mutation', async () => {
  const f = fixture(), api = staffApi({ connectedManual: f.runtime, auth: f.auth, review: {},
    origin: staffConfig.origin, assertRequest: f.assertRequest });
  const req = await f.request(), json = JSON.stringify(req.body);
  const text = json + ' '.repeat(2 * 1024 * 1024 + 1 - Buffer.byteLength(json));
  await assert.rejects(async () => {
    req.body = await parseNextBody(req, text, api.config);
    await api.default(req, response());
  }, error => error.statusCode === 413);
  assert.deepEqual(f.events, []); assert.equal(f.requests.length, 0); assert.equal(f.providerCalls(), 0);
});

test('larger catchall parser preserves ordinary 16 KiB, learning 32 KiB and legacy grading handler caps before side effects', async () => {
  const f = fixture(), effects = [];
  const api = staffApi({ connectedManual: f.runtime, auth: f.auth, review: { save() { effects.push('draft'); } },
    learning: { decide() { effects.push('learning'); } }, grading: { run() { effects.push('grade'); } },
    origin: staffConfig.origin, clientAddress: () => '127.0.0.1', assertRequest: f.assertRequest });
  for (const [path, limit] of [[`/api/staff/cards/${id}/draft`, 16384],
    [`/api/staff/cards/${id}/learning/decisions`, 32768], [`/api/staff/cards/${id}/grade`, 1_040_000]]) {
    const req = await f.request({ url: path }), body = { padding: 'x'.repeat(limit + 1 - Buffer.byteLength(JSON.stringify({ padding: '' }))) };
    req.body = await parseNextBody(req, JSON.stringify(body), api.config);
    const res = response(); await api.default(req, res);
    assert.equal(res.statusCode, 413); assert.deepEqual(res.value, { error: 'REQUEST_TOO_LARGE' });
  }
  assert.deepEqual(effects, []); assert(!f.events.includes('staff-auth'));
  assert.equal(f.requests.length, 0); assert.equal(f.providerCalls(), 0);
});

test('private manual handlers retain their compact intake, action and trace caps behind the larger wire parser', async () => {
  let privateAuth = 0;
  const privateHandler = createConnectedHandler({ origin: staffConfig.origin, assertRequest() {},
    boundary: { authenticate() { privateAuth++; throw Error('Oversized routes must not authenticate'); } },
    connected: { workflow: { service: {} }, intake: {} },
  });
  const f = fixture({ privateHandler }), api = staffApi({ connectedManual: f.runtime, auth: f.auth, review: {},
    origin: staffConfig.origin, assertRequest: f.assertRequest });
  for (const [path, limit] of [[intakePath, 8192], [`/api/staff/manual/cards/${id}/actions`, 65536],
    [`/api/staff/manual/cards/${id}/trace`, 1048576], [`/api/staff/manual/cards/${id}/proposal-trace`, 1048576]]) {
    const req = await f.request({ url: path }), body = { padding: 'x'.repeat(limit + 1 - Buffer.byteLength(JSON.stringify({ padding: '' }))) };
    req.body = await parseNextBody(req, JSON.stringify(body), api.config);
    const res = response(); await api.default(req, res);
    assert.equal(res.statusCode, 413); assert.deepEqual(res.value, { error: 'REQUEST_TOO_LARGE' });
  }
  assert.equal(privateAuth, 0); assert.equal(f.requests.length, 4); assert.equal(f.providerCalls(), 0);
});

test('cold Vercel construction imports no native/provider/persistence modules and makes no network or auth calls', () => {
  const moduleUrl = new URL('../lib/server/manual-frontend-runtime.mjs', import.meta.url).href;
  const loader = String.raw`export async function resolve(specifier, context, next) {
    if (/^(?:node:)?(?:child_process|worker_threads|http|https|net|tls)$/.test(specifier)
      || /^(?:sharp|libheif|@aws-sdk\/|@prisma\/|@atlas\/(?:photo|preparation|measurement|manual-workflow|manual-intake)|@tenkings\/card-identification)/.test(specifier)
      || specifier === '@atlas/connected-manual') throw new Error('FORBIDDEN_WEB_RUNTIME_IMPORT:' + specifier);
    const result = await next(specifier, context);
    if (/\.node(?:$|\?)/.test(result.url) || /atlas-connected-manual\/src\/(?:index|identification)\.mjs/.test(result.url))
      throw new Error('FORBIDDEN_WEB_RUNTIME_IMPORT:' + result.url);
    return result;
  }`;
  const script = `let network=0,authCalls=0,ingress=0;
    globalThis.fetch=async()=>{network++;throw new Error('Network must not run');};
    const {createFrontendManualRuntime}=await import(${JSON.stringify(moduleUrl)});
    const runtime=createFrontendManualRuntime({env:${JSON.stringify(env)},
      staffConfig:{origin:'https://atlasgrading.com',sessionKey:Buffer.alloc(32,1),phoneKey:Buffer.alloc(32,2),routerKey:Buffer.alloc(32,3)},
      auth:{authenticate(){authCalls++;}},assertRequest(){ingress++;}});
    process.stdout.write(JSON.stringify({enabled:typeof runtime.handler==='function',network,authCalls,ingress}));`;
  const result = execFileSync(process.execPath, ['--experimental-loader', `data:text/javascript,${encodeURIComponent(loader)}`,
    '--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 10000, env: { NODE_NO_WARNINGS: '1', PATH: process.env.PATH } });
  assert.deepEqual(JSON.parse(result), { enabled: true, network: 0, authCalls: 0, ingress: 0 });
});
