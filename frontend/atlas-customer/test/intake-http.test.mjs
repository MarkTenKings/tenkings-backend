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
  assert.equal((await f.run('/api/customer/intake/locations?query=Roseville&lat=38.7521&lng=-121.288&entry=authorized-entry')).statusCode, 200);
  assert.deepEqual(f.calls[1], { directory: { query: 'Roseville', lat: '38.7521', lng: '-121.288', entry: 'authorized-entry' } });
  assert.equal((await f.run('/api/customer/intake/locations?lat=1&lat=2&lng=0')).statusCode, 400);
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


test('private directory filters ZIP and city, sorts by location, and preserves only returned registry entries', async t => {
  const locations = [
    { id: 'north-fixture', name: 'Northern fixture kiosk', address: { line1: '1 Fixture St', city: 'Roseville', region: 'CA', postalCode: '95678', country: 'US' }, position: { lat: 38.75, lng: -121.28 } },
    { id: 'south-fixture', name: 'Southern fixture kiosk', address: { line1: '2 Fixture St', city: 'Los Angeles', region: 'CA', postalCode: '90001', country: 'US' }, position: { lat: 34.05, lng: -118.24 } },
  ];
  const calls = []; let returned = locations;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://private.example/internal/customer-service/v1/dealer-locations');
    assert.equal(options.method, 'POST');
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ locations: returned, resolvedLocationId: 'north-fixture' }), { status: 200 });
  });
  const services = privateCustomerServices({ ATLAS_CUSTOMER_SERVICE_URL: 'https://private.example', ATLAS_CUSTOMER_SERVICE_KEY: Buffer.alloc(32, 7).toString('base64') });
  const zip = await services.directory({ query: ' 95678 ' });
  assert.deepEqual(zip.locations.map(row => row.id), ['north-fixture']);
  assert.deepEqual(zip.dealerContacts.map(row => row.name), ['CenterCourt Cards']);
  assert.equal(zip.dealerContacts[0].address.line1, '307 Lincoln St');
  assert.equal(zip.dealerContacts[0].address.postalCode, '95678');
  assert.equal(zip.dealerContacts[0].website, 'https://www.centercourtcardsroseville.com/');
  assert.equal(zip.dealerContacts[0].position, null);
  assert.equal(zip.dealerContacts[0].distanceMiles, null);
  for (const field of ['schedule', 'nextCollection', 'projectedReturn', 'entryUrl', 'terminalId', 'packagePrinterId', 'authorizationExpiresAt']) assert.equal(Object.hasOwn(zip.dealerContacts[0], field), false);
  assert.equal(zip.resolvedLocationId, 'north-fixture');
  const city = await services.directory({ query: 'los angeles' });
  assert.deepEqual(city.locations.map(row => row.id), ['south-fixture']);
  assert.deepEqual(city.dealerContacts, []);
  const nearby = await services.directory({ lat: '34.05', lng: '-118.24', entry: 'authorized-entry' });
  assert.deepEqual(nearby.locations.map(row => row.id), ['south-fixture', 'north-fixture']);
  assert.equal(nearby.locations[0].distanceMiles, 0);
  assert.ok(nearby.locations[1].distanceMiles > 300);
  assert.deepEqual((await services.directory({ query: 'unconfigured place' })).locations, []);
  assert.deepEqual(calls[0], { input: { query: ' 95678 ' } });
  assert.deepEqual(calls[2], { input: { lat: '34.05', lng: '-118.24', entry: 'authorized-entry' } });
  returned = [];
  const emptyRegistry = await services.directory({ lat: '34.05', lng: '-118.24' });
  assert.deepEqual(emptyRegistry.locations, []);
  assert.equal(emptyRegistry.dealerContacts.length, 1, 'An empty operational directory must not hide an approved dealer contact');
  assert.equal(emptyRegistry.dealerContacts[0].distanceMiles, null, 'Unverified coordinates must not become a fabricated distance');
  assert.equal((await services.directory({ query: 'roseville' })).dealerContacts.length, 1);
  assert.deepEqual(locations.map(row => row.id), ['north-fixture', 'south-fixture']);
});
