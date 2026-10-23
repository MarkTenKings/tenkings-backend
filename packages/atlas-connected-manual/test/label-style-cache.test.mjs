import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createLabelStyleCache, createS3LabelStyleCache, LABEL_STYLE_CACHE_MAX_BYTES } from '../src/label-style-cache.mjs';
import { memoryStyleCache, styleFixture } from './label-style-fixture.mjs';

function fakeS3({ losePut = false, mutateRead = null } = {}) {
  const objects = new Map(), calls = [];
  const client = { async send(command) {
    const input = command.input; calls.push(command);
    if (command.constructor.name === 'PutObjectCommand') {
      assert.equal(input.IfNoneMatch, '*');
      if (objects.has(input.Key)) throw Object.assign(new Error('exists'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } });
      objects.set(input.Key, { ...input, Body: Buffer.from(input.Body) });
      if (losePut) throw new Error('lost conditional write response');
      return { $metadata: { httpStatusCode: 200 }, ETag: 'synthetic-etag' };
    }
    assert.equal(command.constructor.name, 'GetObjectCommand');
    const value = objects.get(input.Key);
    if (!value) throw Object.assign(new Error('absent'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
    const response = { ContentLength: value.Body.length, ContentType: value.ContentType, Metadata: value.Metadata,
      ChecksumSHA256: value.ChecksumSHA256, Body: Readable.from([value.Body]) };
    return mutateRead ? mutateRead(response) : response;
  } };
  return { client, calls, objects };
}

test('immutable source-bound cache permits one create winner and retains its value across callers', async () => {
  const { request } = await styleFixture(), { cache, values } = memoryStyleCache();
  const results = await Promise.all([cache.putIfAbsent(request, 'reservation', { id: 'first' }), cache.putIfAbsent(request, 'reservation', { id: 'second' })]);
  assert.equal(results.filter(result => result.created).length, 1); assert.deepEqual(results[0].value, results[1].value);
  assert.equal(values.size, 1); assert.deepEqual(await cache.read(request, 'reservation'), { id: 'first' });
  await assert.rejects(cache.read({ ...request, sourceHash: '1'.repeat(64) }, 'reservation'), { code: 'LABEL_STYLE_CACHE_CORRUPT' });
  await assert.rejects(cache.read({ ...request, requestKey: '../../secrets' }, 'response'), { code: 'LABEL_STYLE_CACHE_BINDING_INVALID' });
});

test('wordmark stages use separate immutable namespaces and retain long raw response strings', async () => {
  const { cache, values } = memoryStyleCache();
  for (const kind of ['generate', 'verify']) {
    const request = { sourceHash: 'a'.repeat(64), requestKey: `label-wordmark-${kind}:v1:${'b'.repeat(64)}` };
    const value = { bodyText: 'X'.repeat(100000), requestEvidence: { sourceHash: request.sourceHash } };
    await cache.putIfAbsent(request, 'response', value); assert.deepEqual(await cache.read(request, 'response'), value);
  }
  assert.equal(values.size, 2); assert.equal(LABEL_STYLE_CACHE_MAX_BYTES, 13 * 1024 * 1024);
});

test('S3 cache uses private scoped keys, checksums, conditional writes and no list/delete operations', async () => {
  const { request } = await styleFixture(), fake = fakeS3();
  const cache = createS3LabelStyleCache({ client: fake.client, bucket: 'atlas-fixture', keyPrefix: 'private/connected' });
  assert.equal(await cache.read(request, 'response'), null);
  assert.equal((await cache.putIfAbsent(request, 'response', { bodyText: 'synthetic' })).created, true);
  assert.equal((await cache.putIfAbsent(request, 'response', { bodyText: 'changed' })).created, false);
  assert.deepEqual(await cache.read(request, 'response'), { bodyText: 'synthetic' });
  assert(fake.calls.every(call => call.input.Key.startsWith('private/connected/label-styles/label-style/')));
  assert(fake.calls.every(call => ['GetObjectCommand', 'PutObjectCommand'].includes(call.constructor.name)));
});

test('an ambiguous successful S3 reservation write never grants permission to dispatch', async () => {
  const { request } = await styleFixture(), fake = fakeS3({ losePut: true });
  const cache = createS3LabelStyleCache({ client: fake.client, bucket: 'atlas-fixture', keyPrefix: 'private/label-styles' });
  const saved = await cache.putIfAbsent(request, 'reservation', { reservationId: 'synthetic' });
  assert.equal(saved.created, false); assert.deepEqual(saved.value, { reservationId: 'synthetic' });
  assert.equal(fake.objects.size, 1);
});

test('cache body corruption, wrong source, invalid media headers and oversized entries fail closed', async () => {
  const { request } = await styleFixture();
  for (const mutateRead of [response => ({ ...response, Metadata: { 'atlas-label-style-sha256': '0'.repeat(64) } }),
    response => ({ ...response, ContentType: 'text/html' }), response => ({ ...response, ContentLength: response.ContentLength + 1 })]) {
    const fake = fakeS3({ mutateRead }), cache = createS3LabelStyleCache({ client: fake.client, bucket: 'atlas-fixture', keyPrefix: 'private' });
    await assert.rejects(cache.putIfAbsent(request, 'result', { value: 1 }), { code: 'LABEL_STYLE_CACHE_CORRUPT' });
  }
  const cache = createLabelStyleCache({ read: async () => Buffer.from('{}'), putIfAbsent: async () => false });
  await assert.rejects(cache.read(request, 'result'), { code: 'LABEL_STYLE_CACHE_CORRUPT' });
  await assert.rejects(cache.putIfAbsent(request, 'response', { body: 'x'.repeat(LABEL_STYLE_CACHE_MAX_BYTES) }), { code: 'LABEL_STYLE_CACHE_TOO_LARGE' });
});
