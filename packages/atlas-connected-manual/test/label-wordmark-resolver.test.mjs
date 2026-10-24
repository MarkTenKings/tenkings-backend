import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createLabelStyleCache } from '../src/label-style-cache.mjs';
import { prepareLabelWordmarkRequest, LABEL_WORDMARK_VERIFY_MODEL } from '../src/label-wordmark-contract.mjs';
import { createLabelWordmarkProvider } from '../src/label-wordmark-provider.mjs';
import { createLabelWordmarkResolver } from '../src/label-wordmark-resolver.mjs';

const request = prepareLabelWordmarkRequest({ sourceHash: 'e'.repeat(64), role: 'variant', text: 'THRILLERS ICE',
  traits: ['BRUSH', 'BOLD'], normalizeWordInkHeight: true });
const bytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="white"/><rect x="200" y="400" width="650" height="180"/><rect x="930" y="430" width="120" height="120"/></svg>')).png().toBuffer();
const reading = { transcription: request.text, singleLine: true, extraMarks: false, confidence: 'HIGH',
  words: [{ text: 'THRILLERS', x: 200, y: 400, width: 650, height: 180 }, { text: 'ICE', x: 930, y: 430, width: 120, height: 120 }] };
function setup({ fetch, putHook, now = () => new Date('2026-10-23T06:00:00.000Z') } = {}) {
  const objects = new Map(), calls = [];
  const cache = createLabelStyleCache({
    read: async key => objects.get(key) ?? null,
    putIfAbsent: async (key, value) => {
      if (putHook) { const answer = await putHook(key, value, objects); if (answer !== undefined) return answer; }
      if (objects.has(key)) return false;
      objects.set(key, Buffer.from(value)); return true;
    },
  });
  const provider = createLabelWordmarkProvider({ apiKey: 'fixture-key-never-a-real-key', imageApiKey: 'dedicated-image-fixture-key-not-real', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (fetch) return fetch(url, options, calls.length);
    return new Response(JSON.stringify(url.endsWith('generations') ? { data: [{ b64_json: bytes.toString('base64') }] }
      : { model: LABEL_WORDMARK_VERIFY_MODEL, status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(reading) }] }] }), { status: 200 });
  } });
  const resolver = createLabelWordmarkResolver({ provider, cache, now });
  return { resolver, provider, cache, objects, calls };
}

test('fresh wordmark uses two separately reserved paid stages then replays retained raw responses with no calls', async () => {
  const { resolver, objects, calls } = setup();
  const first = await resolver.resolve(request); assert.equal(first.state, 'READY'); assert.equal(calls.length, 2);
  assert.ok(first.artifact.pngBase64 && first.artifact.maskBase64 && first.artifact.descriptor.artifactHash);
  assert.equal([...objects.keys()].filter(key => key.endsWith('reservation.json')).length, 2);
  assert.equal([...objects.keys()].filter(key => key.endsWith('response.json')).length, 2);
  const second = await resolver.resolve(request); assert.deepEqual(second, first); assert.equal(calls.length, 2);
});

test('parallel resolvers cannot pay twice for the same generation or verification', async () => {
  const { resolver, calls } = setup();
  const results = await Promise.all([resolver.resolve(request), resolver.resolve(request), resolver.resolve(request)]);
  assert.ok(results.some(result => result.state === 'READY')); assert.ok(results.every(result => ['READY', 'PENDING'].includes(result.state)));
  assert.equal(calls.filter(call => call.url.endsWith('generations')).length, 1);
  assert.equal(calls.filter(call => call.url.endsWith('responses')).length, 1);
  assert.equal((await resolver.resolve(request)).state, 'READY'); assert.equal(calls.length, 2);
});

test('transport uncertainty permanently consumes generation reservation and never retries on restart', async () => {
  const state = setup({ fetch: () => { throw new Error('sensitive transport detail'); } });
  const first = await state.resolver.resolve(request); assert.deepEqual(first, { state: 'PENDING', code: 'LABEL_WORDMARK_GENERATION_PENDING' });
  const restarted = createLabelWordmarkResolver({ provider: state.provider, cache: state.cache, now: () => new Date('2026-10-23T06:00:00.000Z') });
  assert.deepEqual(await restarted.resolve(request), first); assert.equal(state.calls.length, 1);
});

test('unknown conditional reservation success never confers dispatch ownership', async () => {
  const state = setup({ putHook: (key, value, objects) => {
    if (key.endsWith('reservation.json') && !objects.has(key)) { objects.set(key, Buffer.from(value)); return false; }
  } });
  assert.equal((await state.resolver.resolve(request)).state, 'PENDING'); assert.equal(state.calls.length, 0);
  assert.equal((await state.resolver.resolve(request)).state, 'PENDING'); assert.equal(state.calls.length, 0);
});

test('a raw response committed before a crash is recovered without regenerating', async () => {
  let simulatedCrash = true;
  const state = setup({ putHook: (key, value, objects) => {
    if (simulatedCrash && key.includes('label-wordmark-generate/') && key.endsWith('response.json')) {
      simulatedCrash = false; objects.set(key, Buffer.from(value)); throw new Error('crash-after-commit');
    }
  } });
  assert.equal((await state.resolver.resolve(request)).state, 'PENDING'); assert.equal(state.calls.length, 1);
  assert.equal((await state.resolver.resolve(request)).state, 'READY'); assert.equal(state.calls.length, 2);
});

test('lost uncommitted raw response stays pending and never launches another paid request', async () => {
  const state = setup({ putHook: key => { if (key.endsWith('response.json')) throw new Error('storage unavailable'); } });
  assert.equal((await state.resolver.resolve(request)).state, 'PENDING'); assert.equal(state.calls.length, 1);
  assert.equal((await state.resolver.resolve(request)).state, 'PENDING'); assert.equal(state.calls.length, 1);
});

test('unknown generation and verification age out after330seconds without another dispatch; later raw evidence still recovers', async () => {
  for (const [namespace, name, paidAtFailure] of [['generate', 'GENERATION', 1], ['verify', 'VERIFICATION', 2]]) {
    let now = Date.parse('2026-10-23T06:00:00.000Z'), lost;
    const state = setup({ now: () => new Date(now), putHook: (key, value) => {
      if (key.includes(`label-wordmark-${namespace}/`) && key.endsWith('response.json')) {
        lost = { key, value: Buffer.from(value) }; throw new Error('unknown storage outcome');
      }
    } });
    assert.deepEqual(await state.resolver.resolve(request), { state: 'PENDING', code: `LABEL_WORDMARK_${name}_PENDING` });
    assert.equal(state.calls.length, paidAtFailure);
    now += 329999;
    assert.equal((await state.resolver.resolve(request)).state, 'PENDING'); assert.equal(state.calls.length, paidAtFailure);
    now += 1;
    const unavailable = { state: 'UNAVAILABLE', code: `LABEL_WORDMARK_${name}_OUTCOME_UNKNOWN` };
    assert.deepEqual(await state.resolver.resolve(request), unavailable); assert.equal(state.calls.length, paidAtFailure);
    const restarted = createLabelWordmarkResolver({ provider: state.provider, cache: state.cache, now: () => new Date(now + 86400000) });
    assert.deepEqual(await restarted.resolve(request), unavailable); assert.equal(state.calls.length, paidAtFailure);
    // A delayed commit/read reconciles the original exact response; it does not
    // authorize repeating either consumed paid stage.
    state.objects.set(lost.key, lost.value);
    assert.equal((await state.resolver.resolve(request)).state, 'READY'); assert.equal(state.calls.length, 2);
  }
});

test('invalid, noncanonical or future reservation timestamps fail without dispatch', async () => {
  const { createHash } = await import('node:crypto');
  for (const reservedAt of ['not-a-date', '2026-10-23', '2026-10-23T06:00:01.000Z']) {
    const state = setup({ fetch: () => { throw Error('unknown'); } });
    assert.equal((await state.resolver.resolve(request)).state, 'PENDING');
    const key = [...state.objects.keys()].find(value => value.endsWith('reservation.json'));
    const envelope = JSON.parse(state.objects.get(key)); envelope.value.reservedAt = reservedAt;
    envelope.valueHash = createHash('sha256').update(JSON.stringify(envelope.value)).digest('hex');
    state.objects.set(key, Buffer.from(JSON.stringify(envelope)));
    assert.deepEqual(await state.resolver.resolve(request), { state: 'UNAVAILABLE', code: 'LABEL_WORDMARK_RESERVATION_INVALID' });
    assert.equal(state.calls.length, 1);
  }
});

test('permanent HTTP error is retained and does not trigger generation or verification retries', async () => {
  const state = setup({ fetch: () => new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }) });
  const failure = await state.resolver.resolve(request); assert.equal(failure.state, 'UNAVAILABLE'); assert.equal(failure.code, 'LABEL_WORDMARK_PROVIDER_HTTP_ERROR');
  assert.deepEqual(await state.resolver.resolve(request), failure); assert.equal(state.calls.length, 1);
  assert.equal([...state.objects.keys()].filter(key => key.endsWith('response.json')).length, 1);
});

test('cached result cannot hide changed raw evidence and raw response replay cannot accept a forged artifact', async () => {
  const state = setup(); assert.equal((await state.resolver.resolve(request)).state, 'READY');
  const resultKey = [...state.objects.keys()].find(key => key.endsWith('result.json'));
  const resultEnvelope = JSON.parse(state.objects.get(resultKey)); resultEnvelope.value.artifact.descriptor.text = 'FORGED';
  // Recompute the cache integrity envelope to prove independent semantic replay.
  const { createHash } = await import('node:crypto');
  resultEnvelope.valueHash = createHash('sha256').update(JSON.stringify(resultEnvelope.value)).digest('hex');
  state.objects.set(resultKey, Buffer.from(JSON.stringify(resultEnvelope)));
  const failure = await state.resolver.resolve(request); assert.equal(failure.state, 'UNAVAILABLE'); assert.equal(failure.code, 'LABEL_WORDMARK_CACHE_CONFLICT');
  assert.equal(state.calls.length, 2);
});
