import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../lib/server/http.mjs';
import { BoundaryError } from '../lib/server/policy.mjs';
import { privateCustomerServices } from '../lib/server/runtime.mjs';

function fixture() {
  const calls = [], binding = { releaseSha: 'a'.repeat(40) }, authority = { browserHash: 'b'.repeat(64), sessionHash: 'c'.repeat(64) };
  const auth = { authority: (_cookie, csrf) => { if (csrf !== undefined && csrf !== 'csrf') throw new BoundaryError(403, 'CSRF_REQUIRED'); return authority; },
    call: async (_cookie, action, input, csrf) => { auth.authority('', csrf); calls.push({ action, input }); return { saved: true }; } };
  const effect = operation => async (actor, input) => { calls.push({ operation, actor, input }); return { saved: true }; };
  const handler = createHandler({ config: { origin: 'https://atlasgrading.com', binding }, assertRequest() {}, clientAddress: () => 'fixture', auth,
    intake: { sign: effect('sign'), complete: effect('complete') }, commerce: { checkout: effect('checkout'), quote: effect('quote'), pay: effect('pay'), reconcile: effect('reconcile') },
    directory: async input => { calls.push({ directory: input }); return { locations: [] }; } });
  const run = async (url, body, csrf = 'csrf') => {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    await handler({ url, method: body === undefined ? 'GET' : 'POST', body, headers: { origin: 'https://atlasgrading.com', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'x-atlas-customer-csrf': csrf } }, res); return res;
  };
  return { run, calls, binding, authority };
}
test('customer upload effects forward only server-derived session authority and exact owned IDs', async () => {
  const f = fixture(), id = randomUUID(), cardId = randomUUID(), uploadId = randomUUID();
  const response = await f.run(`/api/customer/intake/drafts/${id}/cards/${cardId}/uploads/${uploadId}/sign`, {});
  assert.equal(response.statusCode, 200); assert.deepEqual(f.calls, [{ operation: 'sign', actor: { ...f.authority, binding: f.binding }, input: { id, cardId, uploadId } }]);
  assert.equal((await f.run(`/api/customer/intake/drafts/${id}/cards/${cardId}/uploads/${uploadId}/complete`, { verification: {} })).statusCode, 400);
  assert.equal((await f.run(`/api/customer/intake/drafts/${id}/cards/${cardId}/uploads/${uploadId}/sign`, {}, 'bad')).statusCode, 403);
  assert.equal(f.calls.length, 1);
});
test('checkout refuses browser prices, account selectors and arbitrary reader IDs', async () => {
  const f = fixture(), draftId = randomUUID(), quoteId = randomUUID(), requestId = randomUUID();
  assert.equal((await f.run('/api/customer/commerce/quotes', { draftId, expectedRevision: 2 })).statusCode, 200);
  for (const field of ['total', 'accountId', 'terminalId']) assert.equal((await f.run('/api/customer/commerce/quotes', { draftId, expectedRevision: 2, [field]: 1 })).statusCode, 400);
  assert.equal((await f.run('/api/customer/commerce/payments', { quoteId, requestId })).statusCode, 200);
  assert.equal((await f.run('/api/customer/commerce/payments', { quoteId, requestId, amount: 1 })).statusCode, 400);
  assert.equal((await f.run(`/api/customer/commerce/checkout?draftId=${draftId}&draftId=${draftId}`)).statusCode, 400);
  assert.equal(f.calls.length, 2);
});
test('public location listing does not fabricate a customer and bounds location input', async () => {
  const f = fixture(); assert.equal((await f.run('/api/customer/intake/locations?query=90210')).statusCode, 200);
  assert.deepEqual(f.calls, [{ directory: { query: '90210' } }]);
  assert.equal((await f.run('/api/customer/intake/locations?lat=95&lng=0')).statusCode, 400);
  assert.equal((await f.run('/api/customer/intake/locations?lat=1')).statusCode, 400);
  assert.equal((await f.run('/api/customer/intake/locations?accountId=forged')).statusCode, 400);
});
test('saved label reads route only to owner-scoped gateway and reject path traversal', async () => {
  const f = fixture(), orderId = randomUUID();
  assert.equal((await f.run(`/api/customer/commerce/orders/${orderId}/labels/order%3Alabel`)).statusCode, 200);
  assert.deepEqual(f.calls, [{ action: 'commerce_label', input: { orderId, effectId: 'order:label' } }]);
  assert.equal((await f.run(`/api/customer/commerce/orders/${orderId}/labels/..%2Fprivate`)).statusCode, 400);
});
test('private runtime is disabled absent exact config and refuses partial or noncanonical authority', () => {
  assert.deepEqual(privateCustomerServices({}), {});
  for (const env of [{ ATLAS_CUSTOMER_SERVICE_URL: 'https://private.example' }, { ATLAS_CUSTOMER_SERVICE_KEY: 'wrong' },
    { ATLAS_CUSTOMER_SERVICE_URL: 'http://private.example', ATLAS_CUSTOMER_SERVICE_KEY: Buffer.alloc(32).toString('base64') },
    { ATLAS_CUSTOMER_SERVICE_URL: 'https://private.example', ATLAS_CUSTOMER_SERVICE_KEY: Buffer.alloc(32).toString('base64') + '\n' }]) assert.throws(() => privateCustomerServices(env));
});
test('paid order tracking and deposit declaration retain ownership gateway and exact order binding',async()=>{
 const f=fixture(),orderId=randomUUID(),cardId=randomUUID(),requestId=randomUUID();
 assert.equal((await f.run('/api/customer/orders')).statusCode,200);
 assert.equal((await f.run(`/api/customer/orders/${orderId}`)).statusCode,200);
 assert.equal((await f.run(`/api/customer/orders/${orderId}/deposit`,{cardId,requestId})).statusCode,200);
 assert.deepEqual(f.calls,[{action:'dealer_orders',input:{cursor:null}},{action:'dealer_tracking',input:{orderId}},{action:'dealer_deposit',input:{orderId,cardId,requestId}}]);
 assert.equal((await f.run(`/api/customer/orders/${orderId}/deposit`,{cardId,requestId,kind:'COLLECTED'})).statusCode,400);
 assert.equal((await f.run(`/api/customer/orders/${orderId}/deposit`,{cardId,requestId},'bad')).statusCode,403);
 assert.equal((await f.run('/api/customer/orders?accountId=forged')).statusCode,400);
 assert.equal((await f.run(`/api/customer/orders?cursor=${orderId}&cursor=${orderId}`)).statusCode,400);
});
