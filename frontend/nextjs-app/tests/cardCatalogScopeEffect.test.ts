import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { CARD_CATALOG_SCOPE_ENDPOINT, CARD_CATALOG_SCOPE_LIMITS, CardCatalogScopeEffectError, runCardCatalogScopeEffect,
  type CardCatalogScopeAcknowledgement, type CardCatalogScopeEffectInput, type CardCatalogScopeRawResponse } from '../lib/server/cardCatalogScopeEffect';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const signal = () => new AbortController().signal;
const raw = (text = '{"output":[]}', httpStatus = 200, contentType = 'application/json'): CardCatalogScopeRawResponse => ({ httpStatus, contentType, responseBytes: Buffer.from(text) });
function fixture(): CardCatalogScopeEffectInput {
  // Synthetic transmitted bytes only; storage/media validation belongs to callers.
  const bytes = [Buffer.from('synthetic transmitted front'), Buffer.from('synthetic transmitted back')];
  const images = bytes.map((value, index) => ({ side: index === 0 ? 'front' as const : 'back' as const,
    mimeType: index === 0 ? 'image/png' as const : 'image/webp' as const, transmittedSha256: hash(value), sourceSha256: index === 0 ? hash('synthetic upstream original') : null }));
  const settings = { store: false as const, reasoning: { effort: 'low' as const }, max_output_tokens: 1600 }, model = 'fixture-model';
  const requestBody = JSON.stringify({ model, ...settings, input: [{ role: 'user', content: images.map((image, index) => ({ type: 'input_image', image_url: `data:${image.mimeType};base64,${bytes[index].toString('base64')}` })) }] });
  return { schemaVersion: 1, engineVersion: 'staff-inventory-research-v4', stage: 'printing_scope', attemptId: 'atlas-attempt:fixture', invocationId: 'scope-invocation:fixture',
    endpoint: CARD_CATALOG_SCOPE_ENDPOINT, model, settings, requestBody, requestSha256: hash(requestBody), images };
}
const isError = (code: CardCatalogScopeEffectError['code']) => (error: unknown) => error instanceof CardCatalogScopeEffectError && error.code === code;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('custom dispatch receives immutable exact request and adoption waits for acknowledged bytes and hashes', async () => {
  const input = fixture(), acknowledged = deferred<{ receiptRef: string }>(), entered = deferred<void>();
  let dispatches = 0, complete = false, observed: CardCatalogScopeAcknowledgement | undefined;
  const pending = runCardCatalogScopeEffect(input, {
    dispatch: async (request, abort) => {
      dispatches++; assert.equal(abort.aborted, false); assert.deepEqual(request, input);
      assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(request.images[0])); assert.ok(Object.isFrozen(request.settings.reasoning));
      assert.equal(Object.hasOwn(request, 'apiKey'), false); return raw();
    },
    acknowledge: async event => { observed = event; entered.resolve(); return acknowledged.promise; },
  }, signal()).then(result => { complete = true; return result; });
  await entered.promise;
  assert.equal(complete, false); assert.equal(dispatches, 1); assert.ok(observed);
  assert.equal(hash(observed.requestBytes), input.requestSha256);
  assert.equal(observed.requestBytes.toString(), input.requestBody);
  assert.equal(hash(observed.responseBytes), observed.responseSha256);
  acknowledged.resolve({ receiptRef: 'atlas-receipt:fixture' });
  const result = await pending;
  assert.deepEqual(result.receipt, { attempt_id: input.attemptId, invocation_id: input.invocationId, receipt_ref: 'atlas-receipt:fixture',
    request_sha256: input.requestSha256, response_sha256: hash(result.responseBytes), http_status: 200, acknowledgement: 'adapter',
    images: input.images.map(image => ({ side: image.side, mime_type: image.mimeType, transmitted_sha256: image.transmittedSha256, source_sha256: image.sourceSha256 })) });
});

test('readable non-2xx, non-JSON and malformed JSON replies all reach acknowledgement unchanged', async () => {
  for (const response of [raw('<html>rate limited</html>', 429, 'text/html'), raw('{broken json', 200), raw('', 204, '')]) {
    let acknowledgements = 0, dispatches = 0;
    const result = await runCardCatalogScopeEffect(fixture(), {
      dispatch: async () => { dispatches++; return response; },
      acknowledge: async event => {
        acknowledgements++; assert.equal(event.httpStatus, response.httpStatus); assert.equal(event.contentType, response.contentType);
        assert.deepEqual(event.responseBytes, response.responseBytes); assert.equal(event.responseSha256, hash(response.responseBytes));
        return { receiptRef: 'receipt:readable-failure' };
      },
    }, signal());
    assert.equal(acknowledgements, 1); assert.equal(dispatches, 1); assert.deepEqual(result.responseBytes, response.responseBytes);
  }
});

test('default fetch makes one fixed-endpoint POST and returns an honestly process-only receipt even for non-2xx', async () => {
  const input = fixture(); let requests = 0;
  const result = await runCardCatalogScopeEffect(input, { apiKey: 'synthetic-test-key', fetchImpl: async (url, init) => {
    requests++; assert.equal(url, CARD_CATALOG_SCOPE_ENDPOINT); assert.equal(init?.method, 'POST'); assert.equal(init?.body, input.requestBody);
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.signal?.aborted, false);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-test-key');
    return new Response('not-json', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  } }, signal());
  assert.equal(requests, 1); assert.equal(result.httpStatus, 503); assert.equal(result.responseBytes.toString(), 'not-json');
  assert.equal(result.receipt.acknowledgement, 'process'); assert.match(result.receipt.receipt_ref, /^process:[a-f0-9-]{36}$/);
  assert.equal(JSON.stringify(result.receipt).includes('synthetic-test-key'), false);
});

test('missing acknowledgement and invalid request identity or image lineage fail before any dispatch', async () => {
  let calls = 0;
  const dispatch = async () => { calls++; return raw(); }, acknowledge = async () => ({ receiptRef: 'fixture:receipt' });
  await assert.rejects(runCardCatalogScopeEffect(fixture(), { dispatch }, signal()), isError('invalid_request'));
  const mutations: Array<(input: CardCatalogScopeEffectInput) => void> = [
    input => { input.requestSha256 = '0'.repeat(64); },
    input => { input.attemptId = 'https://private.invalid/request'; },
    input => { input.invocationId = '/private/local/path'; },
    input => { input.invocationId = 'a'.repeat(181); },
    input => { input.model = 'different-model'; },
    input => { input.settings.max_output_tokens = 100; },
    input => { input.schemaVersion = 2 as 1; },
    input => { input.stage = 'not-scope' as 'printing_scope'; },
    input => { input.endpoint = 'https://private.invalid' as typeof CARD_CATALOG_SCOPE_ENDPOINT; },
    input => { input.images[0].transmittedSha256 = 'f'.repeat(64); },
    input => { input.images[0].sourceSha256 = 'not-a-hash'; },
    input => { input.images[0].mimeType = 'image/jpeg'; },
    input => { input.images[1].side = 'front'; },
    input => { input.requestBody = '{}'; input.requestSha256 = hash(input.requestBody); },
    input => { input.requestBody = ' '.repeat(CARD_CATALOG_SCOPE_LIMITS.requestBytes + 1); },
  ];
  for (const mutate of mutations) { const input = fixture(); mutate(input); await assert.rejects(runCardCatalogScopeEffect(input, { dispatch, acknowledge }, signal()), isError('invalid_request')); }
  assert.equal(calls, 0);
});

test('ack failure or unsafe receipt cannot adopt or retry a dispatched response', async () => {
  for (const receiptRef of [null, 'https://private.invalid/receipt', '/private/receipt', 'sk-' + 'x'.repeat(30), 'x'.repeat(181)]) {
    let calls = 0, acknowledgements = 0;
    await assert.rejects(runCardCatalogScopeEffect(fixture(), {
      dispatch: async () => { calls++; return raw(); },
      acknowledge: async () => { acknowledgements++; if (receiptRef === null) throw new Error('synthetic persistence failure'); return { receiptRef }; },
    }, signal()), isError('acknowledgement_failed'));
    assert.equal(calls, 1); assert.equal(acknowledgements, 1);
  }
});

test('mutable response buffers and caller data cannot change admitted request or receipt hashes', async () => {
  const input = fixture(), original = structuredClone(input), provider = raw('original response'), admitted = deferred<void>(), release = deferred<void>();
  const pending = runCardCatalogScopeEffect(input, {
    dispatch: async () => provider,
    acknowledge: async event => {
      admitted.resolve(); await release.promise;
      assert.equal(event.requestBody, original.requestBody); assert.equal(event.attemptId, original.attemptId);
      provider.responseBytes.fill(0); event.responseBytes.fill(0); event.requestBytes.fill(0);
      return { receiptRef: 'receipt:immutable' };
    },
  }, signal());
  await admitted.promise;
  input.attemptId = 'changed'; input.images[0].sourceSha256 = null; input.settings.max_output_tokens = 1; input.requestBody = '{}';
  release.resolve(); const result = await pending;
  assert.equal(result.responseBytes.toString(), 'original response'); assert.equal(result.receipt.response_sha256, hash('original response'));
  assert.equal(result.receipt.request_sha256, original.requestSha256); assert.equal(result.receipt.attempt_id, original.attemptId);
  assert.equal(result.receipt.images[0].source_sha256, original.images[0].sourceSha256);
});

test('pre-dispatch cancellation prevents execution; late custom reply may be accounted but is never adopted or retried', async () => {
  const cancelled = new AbortController(); cancelled.abort(); let calls = 0;
  await assert.rejects(runCardCatalogScopeEffect(fixture(), { dispatch: async () => { calls++; return raw(); }, acknowledge: async () => ({ receiptRef: 'receipt:unused' }) }, cancelled.signal), isError('cancelled'));
  assert.equal(calls, 0);
  const controller = new AbortController(), reply = deferred<CardCatalogScopeRawResponse>(), accounted = deferred<void>();
  const pending = runCardCatalogScopeEffect(fixture(), {
    dispatch: async (_input, abort) => { calls++; assert.equal(abort.aborted, false); return reply.promise; },
    acknowledge: async (event, abort) => { assert.equal(abort.aborted, true); assert.equal(event.responseBytes.toString(), 'late bytes'); accounted.resolve(); return { receiptRef: 'receipt:late' }; },
  }, controller.signal);
  controller.abort(); await assert.rejects(pending, isError('cancelled'));
  reply.resolve(raw('late bytes')); await accounted.promise;
  assert.equal(calls, 1);
});

test('timeout bounds an uncooperative dispatch or acknowledgement without a second call', async () => {
  for (const block of ['dispatch', 'acknowledge'] as const) {
    let calls = 0, acknowledgements = 0;
    await assert.rejects(runCardCatalogScopeEffect(fixture(), { timeoutMs: 5,
      dispatch: async () => { calls++; return block === 'dispatch' ? new Promise(() => {}) : raw(); },
      acknowledge: async () => { acknowledgements++; return new Promise(() => {}); },
    }, signal()), isError('timeout'));
    assert.equal(calls, 1); assert.equal(acknowledgements, block === 'dispatch' ? 0 : 1);
  }
});

test('transport failure never retries, and response size/status/header bounds fail before acknowledgement', async () => {
  let calls = 0;
  await assert.rejects(runCardCatalogScopeEffect(fixture(), { apiKey: 'fixture-key', fetchImpl: async () => { calls++; throw new Error('synthetic transport failure'); } }, signal()), isError('dispatch_failed'));
  assert.equal(calls, 1);
  for (const response of [raw('x', 99), raw('x', 200.5), raw('x', 600), raw('x', 200, 'x'.repeat(513)),
    { ...raw(), responseBytes: Buffer.alloc(CARD_CATALOG_SCOPE_LIMITS.responseBytes + 1) }]) {
    let acknowledged = false;
    await assert.rejects(runCardCatalogScopeEffect(fixture(), { dispatch: async () => response, acknowledge: async () => { acknowledged = true; return { receiptRef: 'unused' }; } }, signal()),
      isError(response.responseBytes.length > CARD_CATALOG_SCOPE_LIMITS.responseBytes ? 'response_too_large' : 'invalid_response'));
    assert.equal(acknowledged, false);
  }
  await assert.rejects(runCardCatalogScopeEffect(fixture(), { apiKey: 'fixture-key', fetchImpl: async () => new Response(Buffer.alloc(CARD_CATALOG_SCOPE_LIMITS.responseBytes + 1)) }, signal()), isError('response_too_large'));
});
