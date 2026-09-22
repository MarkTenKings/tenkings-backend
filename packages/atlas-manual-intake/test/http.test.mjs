import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntakeHandler } from '../src/http.mjs';
const origin = 'https://atlas.invalid', id = '00000000-0000-4000-8000-000000000001';
function response() { return { headers: {}, setHeader(key, value) { this.headers[key] = value; },
  status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } }; }
test('private intake route rejects cross-origin/CSRF before authentication and has no public original write body', async () => {
  const calls = [], boundary = { authenticate: async (...args) => { calls.push(args); return { opaque: true }; } };
  const service = { create: async (_staff, body) => ({ request: body }), read: async () => ({ card: 'synthetic' }) };
  const handler = createIntakeHandler({ service, boundary, origin, assertRequest: async req => { assert(req.hostChecked); } });
  const base = { hostChecked: true, method: 'POST', url: '/api/staff/manual-intake/cards', body: { requestId: id, label: '' },
    headers: { origin, 'content-type': 'application/json', 'x-atlas-csrf': 'csrf', cookie: 'ordinary-cookie' } };
  for (const headers of [{ ...base.headers, origin: 'https://foreign.invalid' }, { ...base.headers, 'x-atlas-csrf': '' }]) {
    const res = response(); await handler({ ...base, headers }, res); assert.equal(res.statusCode, 403);
  }
  assert.equal(calls.length, 0);
  const res = response(); assert.equal(await handler(base, res), true); assert.equal(res.statusCode, 200);
  assert.deepEqual(calls[0], ['ordinary-cookie', 'csrf']); assert.equal(res.headers['Cache-Control'], 'private, no-store');
  const badBody = response(); await handler({ ...base, url: `${base.url}/${id}/uploads/${id}/complete`, body: { bytes: 'forbidden' } }, badBody);
  assert.equal(badBody.statusCode, 400); assert.equal(calls.length, 1);
  assert.equal(await handler({ url: '/unrelated' }, response()), false);
});
test('list pagination and exact upload/source routes do not bypass method or query validation', async () => {
  const service = { list: async (_staff, query) => query, readSource: async () => ({ source: true }) };
  const handler = createIntakeHandler({ service, boundary: { authenticate: async () => ({}) }, origin, assertRequest: async () => {} });
  for (const url of ['/api/staff/manual-intake/cards?cursor=one&cursor=two',
    `/api/staff/manual-intake/cards/${id}?limit=1`, `/api/staff/manual-intake/cards/${id}/uploads`]) {
    const res = response(); await handler({ method: 'GET', url, headers: {} }, res); assert([400, 405].includes(res.statusCode));
  }
  const res = response(); await handler({ method: 'GET', url: `/api/staff/manual-intake/cards/${id}/uploads/${id}/source`, headers: {} }, res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, { source: true });
});

test('known photo refusals reach the browser as exact422 codes while conflicts and unknown internals stay distinct',async()=>{
  let error;
  const handler=createIntakeHandler({service:{prepare:async()=>{throw error;}},boundary:{authenticate:async()=>({})},origin,assertRequest:async()=>{}});
  const request={method:'POST',url:`/api/staff/manual-intake/cards/${id}/uploads/${id}/prepare`,body:{},
    headers:{origin,'content-type':'application/json','x-atlas-csrf':'csrf'}};
  for(const code of ['PHOTO_MULTIFRAME_UNSUPPORTED','PHOTO_FORMAT_UNSUPPORTED','PHOTO_GEOMETRY_UNSUPPORTED','PHOTO_BIT_DEPTH_UNSUPPORTED',
    'PHOTO_HEIC_UNSUPPORTED','PHOTO_HDR_UNSUPPORTED','PHOTO_COLOR_UNSUPPORTED','PHOTO_DECODE_INVALID','PHOTO_DECODE_LIMIT',
    'PHOTO_DECODE_TIMEOUT','PHOTO_DECODE_CANCELLED','PHOTO_DECODER_FAILED','PHOTO_DECODER_PROTOCOL','PHOTO_DECODER_UNAVAILABLE']){
    error={code};const res=response();await handler(request,res);assert.equal(res.statusCode,422,code);assert.deepEqual(res.body,{error:code});
  }
  for(const code of ['PHOTO_STORAGE_CONFLICT','PHOTO_SOURCE_MISMATCH','PHOTO_UPLOAD_CONFLICT']){
    error={code};const res=response();await handler(request,res);assert.equal(res.statusCode,409);assert.deepEqual(res.body,{error:code});
  }
  error={code:'PHOTO_DECODE_INTERNAL_SECRET',message:'private diagnostic'};const unavailable=response();await handler(request,unavailable);
  assert.equal(unavailable.statusCode,503);assert.deepEqual(unavailable.body,{error:'INTAKE_TEMPORARILY_UNAVAILABLE'});
  error={code:'SIGN_IN_REQUIRED',status:401};const expired=response();await handler(request,expired);assert.equal(expired.statusCode,401);assert.deepEqual(expired.body,{error:'SIGN_IN_REQUIRED'});
});
