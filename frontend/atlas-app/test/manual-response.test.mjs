import test from 'node:test';
import assert from 'node:assert/strict';
import { manualRequest } from '../lib/manual-client.mjs';
import { createManualClient } from '@atlas/manual-workflow/client';
import { MANUAL_STREAM_HEADER, MANUAL_STREAM_PROTOCOL } from '@atlas/manual-service/response';

const streamed = (status, body) => new Response(`\n${JSON.stringify({ protocol: MANUAL_STREAM_PROTOCOL, status, body })}`,
  { headers: { [MANUAL_STREAM_HEADER]: MANUAL_STREAM_PROTOCOL } });

test('actual staff manualRequest reader used by intake preserves streamed status, field errors and successful body', async t => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  for (const status of [200, 401, 403, 409, 422, 503, 504]) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/admin/api/staff/manual-intake/cards');
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.headers['x-atlas-csrf'], 'csrf');
      return streamed(status, status === 200 ? { card: 'saved' } : { error: 'ACTUAL_ERROR', fields: { side: 'Front' } });
    };
    const result = manualRequest('/api/staff/manual-intake/cards', { method: 'POST', body: {}, csrf: 'csrf' });
    if (status === 200) assert.deepEqual(await result, { card: 'saved' });
    else await assert.rejects(result, error => error.status === status && error.code === 'ACTUAL_ERROR' && error.fields.side === 'Front');
  }
});

test('actual workflow reader clears a definite streamed refusal but preserves unknown streamed failure for exact recovery', async () => {
  for (const status of [409, 503, 504]) {
    const values = new Map(), posted = [];
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    const client = createManualClient({ cardId: 'card', staffId: 'staff', csrf: 'csrf', storage, fetchImpl: async (url, options) => {
      if (url.endsWith('/view')) return Response.json({ card: { revision: 3 } });
      if (options.method === 'POST') posted.push(JSON.parse(options.body));
      return streamed(status, { error: 'EXACT_FAILURE' });
    } });
    await client.load(); await assert.rejects(client.execute({ type: 'INSPECT_SIDE', side: 'FRONT' }), { status, code: 'EXACT_FAILURE' });
    assert.equal(posted.length, 1); assert.equal(client.hasPending(), status !== 409);
    if (status !== 409) assert.equal(JSON.parse([...values.values()][0]).actionId, posted[0].actionId);
  }
});
