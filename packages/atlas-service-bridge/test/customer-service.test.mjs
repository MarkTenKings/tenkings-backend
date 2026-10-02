import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createCustomerServiceClient, createCustomerServiceHandler } from '../src/customer-service.mjs';

const authority = { binding: { mode: 'LOCAL_FIXTURE' }, sessionHash: 'a'.repeat(64), browserHash: 'b'.repeat(64) };
async function fixture(t, handlers) {
  const key = randomBytes(32), directoryKey = randomBytes(32);
  const handler = createCustomerServiceHandler({ key, directoryKey, handlers });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.statusCode = 404; res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, key, directoryKey, client: extra => createCustomerServiceClient({ url, key, allowLoopbackForTests: true, ...extra }) };
}
test('private customer transport preserves original session authority and server denial', async t => {
  const f = await fixture(t, { 'intake-sign': value => { assert.deepEqual(value.authority, authority); return { state: 'UPLOAD' }; },
    'intake-complete': () => { throw Object.assign(new Error('do not leak'), { status: 401, code: 'SIGN_IN_REQUIRED' }); } });
  assert.deepEqual(await f.client().call('intake-sign', { authority, input: { id: 'original' } }), { state: 'UPLOAD' });
  await assert.rejects(f.client().call('intake-complete', { authority, input: {} }), { status: 401, code: 'SIGN_IN_REQUIRED' });
  await assert.rejects(f.client().call('intake-sign', { authority: { ...authority, accountId: 'forged' }, input: {} }), { code: 'SIGN_IN_REQUIRED' });
});
test('directory key cannot admit customer mutations and unconfigured operations fail closed', async t => {
  let effects = 0;
  const f = await fixture(t, { 'dealer-locations': () => ({ locations: [] }), 'weekly-capacity': () => ({ unit: 'CARDS' }), 'commerce-pay': () => { effects++; return {}; } });
  const directory = f.client({ key: f.directoryKey });
  assert.deepEqual(await directory.call('dealer-locations', { input: {} }), { locations: [] });
  assert.deepEqual(await directory.call('weekly-capacity', { input: {} }), { unit: 'CARDS' });
  await assert.rejects(directory.call('weekly-capacity', { input: {}, authority }), { status: 400 });
  await assert.rejects(directory.call('commerce-pay', { authority, input: {} }), { status: 401 });
  await assert.rejects(f.client().call('intake-complete', { authority, input: {} }), { status: 503, code: 'CUSTOMER_SERVICE_NOT_ENABLED' });
  assert.equal(effects, 0);
});
test('replay, changed body and stale signatures cannot dispatch an effect', async t => {
  let effects = 0, captured;
  const f = await fixture(t, { 'commerce-pay': () => { effects++; return { accepted: true }; } });
  const recording = f.client({ fetchImpl: (url, init) => { captured = { url, init }; return fetch(url, init); } });
  await recording.call('commerce-pay', { authority, input: { requestId: 'stable-action' } });
  assert.equal((await fetch(captured.url, captured.init)).status, 409);
  assert.equal((await fetch(captured.url, { ...captured.init, body: Buffer.from(JSON.stringify({ authority, input: { requestId: 'different' } })) })).status, 401);
  await assert.rejects(f.client({ now: () => Date.now() - 120000 }).call('commerce-pay', { authority, input: {} }), { status: 401 });
  assert.equal(effects, 1);
});
test('transport rejects arbitrary destinations, fields and redirects', async t => {
  const f = await fixture(t, {});
  for (const url of ['http://example.test', 'https://example.test/path', 'https://user:password@example.test', 'https://example.test/?x=1'])
    assert.throws(() => createCustomerServiceClient({ url, key: f.key }), { code: 'CUSTOMER_SERVICE_CONFIGURATION_REQUIRED' });
  await assert.rejects(f.client().call('arbitrary', { input: {} }), { status: 400 });
  await assert.rejects(f.client().call('dealer-locations', { input: {}, authority }), { status: 400 });
  let observed;
  const client = f.client({ fetchImpl: async (url, init) => { observed = init; throw new Error('network'); } });
  await assert.rejects(client.call('dealer-locations', { input: {} }), { code: 'CUSTOMER_SERVICE_UNAVAILABLE' });
  assert.equal(observed.redirect, 'error');
});
test('verification email operation requires full service signature and original customer authority', async t => {
  let admitted = 0, captured;
  const f = await fixture(t, { 'email-request': envelope => {
    assert.deepEqual(envelope.authority, authority); admitted++; return { state: 'UNSENT', verified: false };
  } });
  await assert.rejects(f.client({ key: f.directoryKey }).call('email-request', { authority, input: {} }), { status: 401 });
  await assert.rejects(f.client().call('email-request', { input: {} }), { status: 400 });
  await assert.rejects(f.client().call('email-request', { authority: { ...authority, accountId: 'forged' }, input: {} }), { status: 401 });
  assert.equal(admitted, 0);
  const signed = f.client({ fetchImpl: (url, init) => { captured = { url, init }; return fetch(url, init); } });
  assert.deepEqual(await signed.call('email-request', { authority, input: {} }), { state: 'UNSENT', verified: false });
  assert.equal((await fetch(captured.url, captured.init)).status, 409); assert.equal(admitted, 1);
  // The fixture handler records admission only. It constructs no sender and
  // makes no provider request; authoritative account checks remain in SQL.
});
