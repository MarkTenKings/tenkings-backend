import test from 'node:test';
import assert from 'node:assert/strict';
import { readManualResponse, MANUAL_STREAM_HEADER, MANUAL_STREAM_PROTOCOL } from '../src/response.mjs';

test('authoritative access denial clears browser image grants but ordinary validation does not', async () => {
  const previous = globalThis.window, events = [];
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  try {
    for (const [status, error] of [[401, 'SIGN_IN_REQUIRED'], [403, 'STAFF_ACCESS_NOT_ENABLED'], [409, 'MANUAL_REPORT_STALE']])
      await assert.rejects(readManualResponse({ status, json: async () => ({ error }) }));
    assert.deepEqual(events, ['atlas:verified-image-access-ended', 'atlas:verified-image-access-ended']);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

const stream = (status, body) => new Response(`\n\n${JSON.stringify({ protocol: MANUAL_STREAM_PROTOCOL, status, body })}`,
  { headers: { [MANUAL_STREAM_HEADER]: MANUAL_STREAM_PROTOCOL } });

test('failure correlation preserves only an opaque UUID and never arbitrary provider detail', async () => {
  const id = 'ac7aba2c-94e7-4bd4-8b86-572606c2746b';
  for (const reference of [id, 'https://private.invalid/photo?secret=value', { token: 'private' }, 'private']) {
    const body = { error: 'TEMPORARILY_UNAVAILABLE', reference };
    for (const response of [Response.json(body, { status: 503 }), stream(503, body)])
      await assert.rejects(readManualResponse(response), error => error.status === 503
        && error.reference === (reference === id ? id : undefined));
  }
});

test('ordinary and streamed replies preserve actual success, refusal fields and uncertain failure status', async () => {
  assert.deepEqual(await readManualResponse(Response.json({ saved: true })), { saved: true });
  assert.deepEqual(await readManualResponse(stream(200, { saved: true })), { saved: true });
  for (const status of [400, 401, 403, 404, 409, 413, 422, 503, 504]) {
    const body = { error: `REFUSAL_${status}`, fields: { category: 'Choose category' } };
    for (const response of [Response.json(body, { status }), stream(status, body)])
      await assert.rejects(readManualResponse(response), error => error.status === status
        && error.code === body.error && error.fields.category === body.fields.category);
  }
});

test('heartbeat alone, truncated JSON and invalid terminal status never become completion or definite refusal', async () => {
  const headers = { [MANUAL_STREAM_HEADER]: MANUAL_STREAM_PROTOCOL };
  for (const body of ['\n\n', '\n{"protocol":', JSON.stringify({ protocol: MANUAL_STREAM_PROTOCOL, status: 409 }),
    JSON.stringify({ protocol: MANUAL_STREAM_PROTOCOL, status: 302, body: {} }),
    JSON.stringify({ protocol: MANUAL_STREAM_PROTOCOL, status: 999, body: {} }),
    JSON.stringify({ protocol: MANUAL_STREAM_PROTOCOL, status: 200, body: null }),
    JSON.stringify({ protocol: MANUAL_STREAM_PROTOCOL, status: 200, body: {}, extra: true })])
    await assert.rejects(readManualResponse(new Response(body, { headers })), error => error.status === undefined);
  await assert.rejects(readManualResponse(new Response('{}', { headers: { [MANUAL_STREAM_HEADER]: 'wrong-version' } })),
    { code: 'MANUAL_RESPONSE_INVALID' });
  await assert.rejects(readManualResponse(Response.json({ protocol: MANUAL_STREAM_PROTOCOL, status: 200, body: {} })),
    { code: 'MANUAL_RESPONSE_INVALID' });
});

test('empty or malformed HTTP401 clears evidence before parsing while non-auth response failures retain it',async()=>{
 const previous=globalThis.window,events=[];globalThis.window={dispatchEvent:event=>events.push(event.type)};
 try {
  for(const body of ['', '<html>Sign in required</html>'])await assert.rejects(readManualResponse(new Response(body,{status:401})));
  await assert.rejects(readManualResponse(new Response('',{status:503})));
  assert.deepEqual(events,['atlas:verified-image-access-ended','atlas:verified-image-access-ended']);
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
