import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createPrivateManualServer } from '../scripts/private-server.mjs';
import { createManualServiceProxy, createPrivateManualNonceStore } from '../src/transport.mjs';
import { createStaffCompCurationPrivateAdapter } from '../../../frontend/atlas-app/lib/server/staff-comp-curation-private-adapter.mjs';
import { curationFixture } from '../../../frontend/atlas-app/test/staff-comp-curation-fixture.mjs';

const origin = 'https://atlasgrading.com', key = Buffer.alloc(32, 61);
const cardId = '0336918d-0204-47e0-acdf-6ef4b22b62c1';
const alias = `/api/staff/manual-connected/cards/${cardId}/comp-curation`;
function host(compHandler = null, extra = {}) {
  let genericAuth = 0, reads = 0;
  const server = createPrivateManualServer({ origin, key, compHandler,
    connected: { workflow: {}, intake: {}, dealerOperations: { async call() { reads++; return { retained: true }; } } },
    boundary: { async authenticate() { genericAuth++; return {}; } }, ...extra });
  assert.equal(server.listening, false);
  return { server, get genericAuth() { return genericAuth; }, get reads() { return reads; } };
}
// Exercise the real unstarted HTTP server callback; no socket or listener.
async function dispatch(server, { method = 'GET', url = alias, headers = {}, body = Buffer.alloc(0), chunks } = {}) {
  const req = Readable.from(chunks ?? [body], { objectMode: false });
  Object.assign(req, { method, url, headers, complete: false });
  req.once('end', () => { req.complete = true; });
  const res = new EventEmitter(); res.headers = new Map(); res.statusCode = 200;
  res.setHeader = (name, value) => res.headers.set(name.toLowerCase(), value);
  res.getHeader = name => res.headers.get(name.toLowerCase());
  res.end = bytes => { res.bytes = Buffer.from(bytes ?? ''); res.writableEnded = true; res.emit('finish'); };
  res.destroy = () => { res.destroyed = true; };
  await server.listeners('request')[0](req, res);
  return { req, res, status: res.statusCode, payload: res.bytes?.length ? JSON.parse(res.bytes) : null };
}
async function signed(server, path, method = 'GET', body) {
  let wire;
  const proxy = createManualServiceProxy({ origin: 'https://private.atlasgrading.com', key,
    async fetchImpl(url, init) {
      const u = new URL(url); wire = { method: init.method, url: u.pathname + u.search, headers: { ...init.headers }, body: Buffer.from(init.body ?? '') };
      const result = await dispatch(server, wire);
      return new Response(result.res.bytes, { status: result.status, headers: Object.fromEntries(result.res.headers) });
    } });
  let status, payload;
  await proxy({ method, url: path, body, headers: { cookie: 'synthetic=session', ...(method === 'POST'
    ? { origin, 'content-type': 'application/json', 'x-atlas-csrf': 'synthetic-csrf' } : {}) } },
  { setHeader() {}, status(value) { status = value; return this; }, send(bytes) { payload = JSON.parse(bytes); }, json(value) { payload = value; } });
  return { status, payload, wire };
}

test('disabled reserved comp family never authenticates or dispatches through grading', async () => {
  const f = host();
  for (const url of [alias, alias + '?malformed=1', alias + '/decision', alias + '/unknown', alias.replace(cardId, 'invalid')]) {
    const result = await dispatch(f.server, { url });
    assert.equal(result.status, 503); assert.equal(result.payload.error, 'COMP_NOT_CONFIGURED');
  }
  assert.equal(f.genericAuth, 0); assert.equal(f.reads, 0);
  assert.throws(() => host({}), { code: 'MANUAL_TRANSPORT_CONFIG_INVALID' });
});

test('reserved requests retain exact raw bytes and cannot fall back on false or failure', async () => {
  let calls = 0;
  const f = host(async (req, res) => { calls++; assert(req.rawBody.equals(Buffer.from(' { "test": 1 } '))); res.status(200).json({ ok: true }); return true; });
  const r = await dispatch(f.server, { method: 'POST', body: Buffer.from(' { "test": 1 } ') });
  assert.equal(r.status, 200); assert.equal(calls, 1); assert.equal(f.genericAuth, 0);
  for (const handler of [async () => false, async () => { throw Error('private detail'); }]) {
    const other = host(handler), denied = await dispatch(other.server);
    assert.notEqual(denied.status, 200); assert(!JSON.stringify(denied.payload).includes('private detail'));
    assert.equal(other.genericAuth, 0);
  }
});

test('comp body bound rejects claimed and streamed excess before any restricted handler call', async () => {
  let calls = 0; const f = host(async () => { calls++; return true; });
  for (const input of [{ headers: { 'content-length': '4097' } }, { headers: { 'content-length': 'invalid' } },
    { chunks: [Buffer.alloc(4096), Buffer.alloc(1)] }]) {
    const r = await dispatch(f.server, { method: 'POST', ...input }); assert.equal(r.status, 413);
  }
  assert.equal(calls, 0); assert.equal(f.genericAuth, 0);
});

test('real signer and private comp adapter consume nonce once; retained generic reads use their own verifier', async () => {
  const fixture = await curationFixture();
  const store = createPrivateManualNonceStore(); let consumed = 0;
  const nonceStore = { consume(...args) { consumed++; return store.consume(...args); } };
  const native = createStaffCompCurationPrivateAdapter({ enabled: true, key, origin, nonceStore,
    native: { environment: {}, auth: { async authenticate(cookie, csrf) {
      assert.equal(cookie, 'synthetic=session'); if (csrf !== undefined) assert.equal(csrf, 'synthetic-csrf'); return fixture.staff;
    } }, ...Object.fromEntries(['boundary', 'approved', 'artifacts', 'validateAccess'].map(name => [name, fixture.options[name]])) } });
  const f = host(native.handler, { nonceStore });
  const route = `/api/staff/manual-connected/cards/${fixture.cardId}/comp-curation`;
  const read = await signed(f.server, `${route}?approvalActionId=${fixture.actionId}&previewId=${fixture.previewId}`);
  assert.equal(read.status, 200); assert.equal(read.payload.result.availability, 'POLICY_REQUIRED'); assert.equal(consumed, 1);
  const input = fixture.input({ outcome: 'SKIP', selectedIds: [], reviewedIds: [], expectedPolicyHash: null });
  const write = await signed(f.server, route + '/decision', 'POST', input);
  assert.equal(write.status, 200); assert.equal(write.payload.result.outcome, 'SKIP'); assert.equal(consumed, 2); assert.equal(fixture.calls.insert, 1);
  const replay = await dispatch(f.server, write.wire);
  assert.equal(replay.status, 409); assert.equal(replay.payload.error, 'MANUAL_PRIVATE_REQUEST_REPLAYED'); assert.equal(fixture.calls.insert, 1);
  assert.equal(f.genericAuth, 0);
  const generic = await signed(f.server, '/api/staff/manual-connected/dealer-operations');
  assert.equal(generic.status, 200); assert.deepEqual(generic.payload, { retained: true }); assert.equal(f.genericAuth, 1); assert.equal(f.reads, 1);
  native.close();
});
