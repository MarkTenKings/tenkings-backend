import test from 'node:test';
import assert from 'node:assert/strict';
import { createLabelStylePhotoProvider } from '../src/label-style-provider.mjs';
import { createLabelStyleResolver } from '../src/label-style-resolver.mjs';
import { LABEL_STYLE_LIMITS } from '../src/label-style-contract.mjs';
import { styleFixture, styleResponse, memoryStyleCache } from './label-style-fixture.mjs';
const secret = 'synthetic-only-not-a-provider-key';

test('new cards perform one paid request, retain all stages, and reuse exact style on later processes', async () => {
  const fixture = await styleFixture(), memory = memoryStyleCache(); let calls = 0, reads = 0;
  const provider = createLabelStylePhotoProvider({ apiKey: secret,
    readApprovedImage: async input => { reads++; return fixture.readApprovedImage(input); },
    fetchImpl: async () => { calls++; return Response.json(styleResponse(fixture.request)); } });
  const resolver = createLabelStyleResolver({ provider, cache: memory.cache });
  const [first, duplicate] = await Promise.all([resolver.resolve(fixture.request), resolver.resolve(fixture.request)]);
  assert.equal(first.state, 'READY'); assert.equal(first.spec.specHash, duplicate.spec.specHash); assert.equal(calls, 1); assert.equal(reads, 2);
  assert.equal(memory.values.size, 4);
  const restarted = createLabelStyleResolver({ provider, cache: memory.cache }), again = await restarted.resolve(fixture.request);
  assert.equal(again.cached, true); assert.equal(again.spec.specHash, first.spec.specHash); assert.equal(calls, 1); assert.equal(reads, 2);
});

test('projection interruption resumes from saved raw response without image rereads or another paid call', async () => {
  const fixture = await styleFixture(), memory = memoryStyleCache(); let calls = 0;
  const provider = createLabelStylePhotoProvider({ apiKey: secret, readApprovedImage: fixture.readApprovedImage,
    fetchImpl: async () => { calls++; return Response.json(styleResponse(fixture.request)); } });
  const failing = { ...memory.cache, putIfAbsent: async (request, kind, value, options) => {
    if (kind === 'result') throw new Error('interrupted before saving projected result');
    return memory.cache.putIfAbsent(request, kind, value, options);
  } };
  await assert.rejects(createLabelStyleResolver({ provider, cache: failing }).resolve(fixture.request), /interrupted/);
  assert.equal(calls, 1); assert.equal(memory.values.size, 3);
  const result = await createLabelStyleResolver({ provider, cache: memory.cache }).resolve(fixture.request);
  assert.equal(result.state, 'READY'); assert.equal(calls, 1); assert.equal(memory.values.size, 4);
});

test('concurrent process sees pending reservation; it cannot steal or repeat an active request', async () => {
  const fixture = await styleFixture(), memory = memoryStyleCache(); let release, admitted;
  const dispatched = new Promise(resolve => { admitted = resolve; });
  let calls = 0;
  const provider = createLabelStylePhotoProvider({ apiKey: secret, readApprovedImage: fixture.readApprovedImage,
    fetchImpl: async () => { calls++; admitted(); await new Promise(resolve => { release = resolve; }); return Response.json(styleResponse(fixture.request)); } });
  const first = createLabelStyleResolver({ provider, cache: memory.cache }).resolve(fixture.request); await dispatched;
  const pending = await createLabelStyleResolver({ provider, cache: memory.cache }).resolve(fixture.request);
  assert.equal(pending.state, 'PENDING'); assert.equal(calls, 1); assert.equal(pending.spec, undefined);
  release(); const completed = await first; assert.equal(completed.state, 'READY');
  assert.equal((await createLabelStyleResolver({ provider, cache: memory.cache }).resolve(fixture.request)).spec.specHash, completed.spec.specHash);
});

test('aborted unknown dispatch expires to an explicit cached fallback and never repeats', async () => {
  const fixture = await styleFixture(), memory = memoryStyleCache(), controller = new AbortController(); let now = 1000, calls = 0;
  const provider = createLabelStylePhotoProvider({ apiKey: secret, readApprovedImage: fixture.readApprovedImage,
    fetchImpl: async () => { calls++; controller.abort(); throw controller.signal.reason; } });
  await assert.rejects(createLabelStyleResolver({ provider, cache: memory.cache, now: () => now }).resolve(fixture.request, { signal: controller.signal }));
  assert.equal(calls, 1); assert.equal(memory.values.size, 2);
  assert.equal((await createLabelStyleResolver({ provider, cache: memory.cache, now: () => now }).resolve(fixture.request)).state, 'PENDING');
  now += LABEL_STYLE_LIMITS.timeoutMs + 30001;
  const fallback = await createLabelStyleResolver({ provider, cache: memory.cache, now: () => now }).resolve(fixture.request);
  assert.equal(fallback.state, 'FALLBACK'); assert.equal(fallback.spec.provenance.reason, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(calls, 1); assert.equal((await createLabelStyleResolver({ provider, cache: memory.cache }).resolve(fixture.request)).cached, true);
});

test('definite rejection and invalid model output retain the response and settle to honest fallback without retry', async () => {
  const fixture = await styleFixture();
  for (const [makeResponse, reason] of [[() => Response.json({ error: { code: 'synthetic_refusal' } }, { status: 400 }), 'PROVIDER_REJECTED'],
    [() => Response.json({ model: 'wrong', status: 'completed', output: [] }), 'MODEL_RESPONSE_INVALID']]) {
    const memory = memoryStyleCache(); let calls = 0;
    const provider = createLabelStylePhotoProvider({ apiKey: secret, readApprovedImage: fixture.readApprovedImage,
      fetchImpl: async () => { calls++; return makeResponse(); } });
    const first = await createLabelStyleResolver({ provider, cache: memory.cache }).resolve(fixture.request);
    assert.equal(first.state, 'FALLBACK'); assert.equal(first.spec.provenance.reason, reason); assert.equal(memory.values.size, 4);
    await createLabelStyleResolver({ provider, cache: memory.cache }).resolve(fixture.request); assert.equal(calls, 1);
  }
});

test('no configured provider returns a deterministic fallback without creating request or paid reservation', async () => {
  const fixture = await styleFixture(), memory = memoryStyleCache();
  const result = await createLabelStyleResolver({ cache: memory.cache }).resolve(fixture.request);
  assert.equal(result.state, 'FALLBACK'); assert.equal(result.spec.provenance.reason, 'PROVIDER_UNAVAILABLE'); assert.equal(memory.values.size, 0);
});
