import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createWorkflowHandler } from '@atlas/manual-workflow/http';
import { createManualServiceProxy, assertPrivateManualRequest, createPrivateManualNonceStore } from '../src/transport.mjs';

const key = Buffer.alloc(32, 73), origin = 'https://staff.atlasgrading.test';
const cardId = '11111111-1111-4111-8111-111111111111', actionId = '22222222-2222-4222-8222-222222222222';
const path = `/api/staff/manual/cards/${cardId}/actions`, header = 'x-atlas-workspace';
const command = { actionId, expectedRevision: 1, action: { type: 'INSPECT_SIDE', side: 'FRONT', inspected: true } };
function request(scope) {
  return { method: 'POST', url: path, body: command, headers: { cookie: 'fixture-session', origin,
    'content-type': 'application/json', 'x-atlas-csrf': 'fixture-csrf', ...(scope === undefined ? {} : { [header]: scope }) } };
}
function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; }, send(bytes) { this.bytes = bytes; } };
}
const verify = req => assertPrivateManualRequest(req, { key, origin, nonceStore: createPrivateManualNonceStore() });
async function capture(scope) {
  let signed;
  const proxy = createManualServiceProxy({ origin: 'https://private.atlasgrading.test', key, fetchImpl: async (url, init) => {
    signed = { method: init.method, url: new URL(url).pathname + new URL(url).search,
      headers: init.headers, rawBody: Buffer.from(init.body ?? '') };
    return Response.json({ ok: true });
  } });
  const res = response(); await proxy(request(scope), res); assert.equal(res.statusCode, 200); return signed;
}

test('absent workspace scope preserves the exact legacy signing contract', async () => {
  const signed = await capture();
  const sha = value => createHash('sha256').update(value).digest('hex');
  const h = signed.headers;
  const legacyParts = ['atlas-manual-private-v1', signed.method, signed.url, sha(signed.rawBody), sha(h.cookie),
    sha(h['x-atlas-csrf']), h.origin, h['content-type'], h['x-atlas-manual-timestamp'], h['x-atlas-manual-nonce']];
  const legacySignature = createHmac('sha256', key).update(JSON.stringify(legacyParts)).digest('hex');
  assert.equal(h[header], undefined); assert.equal(h['x-atlas-manual-signature'], legacySignature);
  assert.equal(await verify({ ...signed, headers: { ...h, 'x-atlas-manual-signature': legacySignature } }), true);
});

test('workspace scope is signed and stripping, injecting, tampering or duplicating it is refused', async () => {
  const signed = await capture('all'); assert.equal(signed.headers[header], 'all'); assert.equal(await verify(signed), true);
  const stripped = { ...signed.headers }; delete stripped[header];
  await assert.rejects(verify({ ...signed, headers: stripped }), { code: 'MANUAL_PRIVATE_SIGNATURE_INVALID' });
  await assert.rejects(verify({ ...signed, headers: { ...signed.headers, [header]: 'inspection' } }), { code: 'MANUAL_PRIVATE_SIGNATURE_INVALID' });
  const legacy = await capture();
  await assert.rejects(verify({ ...legacy, headers: { ...legacy.headers, [header]: 'all' } }), { code: 'MANUAL_PRIVATE_SIGNATURE_INVALID' });
  await assert.rejects(verify({ ...signed, rawHeaders: ['X-Atlas-Workspace', 'all', header, 'all'] }), { code: 'MANUAL_TRANSPORT_HEADER_INVALID' });
  await assert.rejects(verify({ ...signed, headers: { ...signed.headers, [header]: ['all', 'inspection'] } }), { code: 'MANUAL_TRANSPORT_HEADER_INVALID' });
});

test('only exact action POSTs may request an all or inspection workspace before dispatch', async () => {
  let dispatches = 0;
  const proxy = createManualServiceProxy({ origin: 'https://private.atlasgrading.test', key,
    fetchImpl: async () => { dispatches++; return Response.json({ ok: true }); } });
  const invalid = [
    ...['', 'ALL', 'all, inspection', 'other', ['all', 'inspection']].map(scope => request(scope)),
    { ...request('all'), method: 'GET', body: undefined },
    ...[`${path}?scope=all`, `${path}/${actionId}`, `/api/staff/manual/cards/${cardId}/trace`,
      `/api/staff/manual/cards/${cardId}/view`, '/api/staff/manual-connected/cards',
      '/api/staff/manual/cards/not-a-uuid/actions'].map(url => ({ ...request('all'), url })),
  ];
  for (const req of invalid) {
    const res = response(); assert.equal(await proxy(req, res), true);
    assert.equal(res.statusCode, 400); assert.equal(res.value.error, 'MANUAL_TRANSPORT_HEADER_INVALID');
  }
  assert.equal(dispatches, 0);
});

for (const scope of ['all', 'inspection']) test(`signed ${scope} scope reaches the actual workflow HTTP action handler`, async () => {
  const staff = { id: 'fixture-staff' }, calls = [];
  const card = { cardId, revision: 2, contentHash: 'a'.repeat(64), draft: {} };
  const result = { card, receipt: { actionId, actorId: staff.id, actorKind: 'HUMAN', expectedRevision: 1, revision: 2 } };
  const handler = createWorkflowHandler({ origin, assertRequest: verify,
    boundary: { async authenticate(cookie, csrf) { assert.equal(cookie, 'fixture-session'); assert.equal(csrf, 'fixture-csrf'); return staff; } },
    workflow: { service: {
      async execute(actor, id, input) { assert.equal(actor, staff); assert.equal(id, cardId); assert.deepEqual(input, command); calls.push('execute'); return result; },
      async latestApproval() { return null; },
    }, async hydrate(value) { assert.deepEqual(value, card); return { identity: {}, geometry: { cardId }, defects: { cardId } }; },
    async assertViewCurrent(actor, value) { assert.equal(actor, staff); assert.deepEqual(value, card); calls.push('fence'); } },
    async imageDescriptors({ imageScope }) { assert.equal(imageScope, scope); calls.push(imageScope); return { FRONT: {}, BACK: {} }; },
    async workspaceExtras() { return { publication: { state: 'NONE' } }; },
  });
  const proxy = createManualServiceProxy({ origin: 'https://private.atlasgrading.test', key, fetchImpl: async (url, init) => {
    const res = response();
    await handler({ method: init.method, url: new URL(url).pathname, headers: init.headers,
      rawBody: Buffer.from(init.body), body: JSON.parse(init.body.toString()) }, res);
    return Response.json(res.value, { status: res.statusCode });
  } });
  const res = response(); await proxy(request(scope), res);
  assert.equal(res.statusCode, 200);
  const actual = JSON.parse(res.bytes.toString());
  assert.equal(actual.receipt.actionId, actionId); assert.equal(actual.workspace.imageScope, scope);
  assert.deepEqual(actual.workspace.view.card, card); assert.deepEqual(calls, ['execute', scope, 'fence']);
});
