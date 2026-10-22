import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { createOwnershipProofStorage } from '../src/card-ownership-proof-storage.mjs';
import { plan, now } from './fixtures/card-ownership-proof-fixtures.mjs';

const bytes = Buffer.from('synthetic private proof'), p = plan(bytes), origin = 'https://proof.invalid';
function fixture({ editHead, editGet, body, timeoutMs = 1000, sendOverride } = {}) {
  const calls = [], bodies = [];
  const client = { async send(command, options) {
    calls.push(command);
    if (sendOverride) return sendOverride(command, options);
    const result = { ContentLength: p.byteCount, ContentType: 'application/octet-stream', VersionId: 'version-1', ETag: '"etag-1"',
      ChecksumSHA256: Buffer.from(p.sha256, 'hex').toString('base64'), Metadata: { 'atlas-kind': 'ownership-proof-v2', 'atlas-binding-sha256': p.planHash } };
    if (command.constructor.name === 'HeadObjectCommand') { editHead?.(result); return result; }
    result.Body = body?.() ?? Readable.from([bytes]); bodies.push(result.Body); editGet?.(result); return result;
  } };
  return { calls, bodies, storage: createOwnershipProofStorage({ client, bucket: 'private-proof', origin, now: () => now, timeoutMs }) };
}
const refuse = (promise, code) => assert.rejects(promise, e => e.code === code);
test('exact private HEAD/version+ETag GET owns bytes; no write/list/delete/GET signing interface', async () => {
  const f = fixture(), result = await f.storage.readOriginal({ plan: p });
  assert.deepEqual(result.bytes, bytes); assert.deepEqual(result.object, { key: p.key, versionId: 'version-1', etag: '"etag-1"' });
  assert.deepEqual(Object.keys(f.storage), ['signUpload', 'readOriginal']);
  assert.equal(f.calls[1].input.VersionId, 'version-1'); assert.equal(f.calls[1].input.IfMatch, '"etag-1"');
  assert.ok(f.bodies[0].destroyed);
});
test('real SDK presigning is offline and binds required checksum, content length, conditional metadata and exact origin', async () => {
  const client = new S3Client({ region: 'us-east-1', endpoint: origin, forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'synthetic-fixture-key', secretAccessKey: 'synthetic-fixture-secret' } });
  try {
    const storage = createOwnershipProofStorage({ client, bucket: 'private-proof', origin, now: () => now });
    const result = await storage.signUpload({ plan: p }), url = new URL(result.url);
    assert.equal(url.origin, origin); assert.equal(url.pathname, `/private-proof/${p.key}`); assert.equal(result.expiresIn, 300);
    for (const field of ['content-length', 'content-type', 'if-none-match', 'x-amz-checksum-sha256', 'x-amz-meta-atlas-kind', 'x-amz-meta-atlas-binding-sha256'])
      assert.ok(url.searchParams.get('X-Amz-SignedHeaders').split(';').includes(field));
    assert.equal(result.headers['if-none-match'], '*'); assert.equal(result.headers['content-type'], 'application/octet-stream');
  } finally { client.destroy(); }
});
test('arbitrary keys, origins, expired plans and unsigned requirement removal refuse', async () => {
  const f = fixture(); await assert.rejects(f.storage.readOriginal({ plan: { ...p, key: 'reports/private' } })); assert.equal(f.calls.length, 0);
  await refuse(f.storage.signUpload({ plan: plan(bytes, { expiresAt: new Date(now).toISOString() }) }), 'OWNERSHIP_PROOF_PLAN_EXPIRED');
  for (const url of ['https://evil.invalid/object', `${origin}/${p.key}?X-Amz-Expires=300`, `${origin}/other`]) {
    const storage = createOwnershipProofStorage({ client: { send() { throw Error('not used'); } }, bucket: 'private-proof', origin, now: () => now, sign: async () => url });
    await refuse(storage.signUpload({ plan: p }), 'OWNERSHIP_PROOF_STORAGE_INVALID');
  }
});
test('header mismatch, delete marker, encoding, range, version, ETag and metadata drift refuse', async () => {
  for (const mutate of [r => r.ContentLength++, r => r.ContentType = 'image/png', r => r.DeleteMarker = true,
    r => r.ContentEncoding = 'gzip', r => r.ContentRange = 'bytes 0-1/2', r => r.VersionId = 'other', r => r.ETag = 'other',
    r => r.Metadata['atlas-binding-sha256'] = 'c'.repeat(64), r => r.Metadata.extra = 'unexpected', r => r.ChecksumSHA256 = 'wrong']) {
    const f = fixture({ editGet: mutate });
    await refuse(f.storage.readOriginal({ plan: p }), 'OWNERSHIP_PROOF_STORAGE_CONFLICT'); assert.ok(f.bodies[0].destroyed);
  }
});
test('bounded stream excess, short bytes, wrong hash and pinned old version', async () => {
  await refuse(fixture({ body: () => Readable.from([bytes, Buffer.from('x')]) }).storage.readOriginal({ plan: p }), 'OWNERSHIP_PROOF_STORAGE_LIMIT');
  await refuse(fixture({ body: () => Readable.from([bytes.subarray(1)]) }).storage.readOriginal({ plan: p }), 'OWNERSHIP_PROOF_STORAGE_CONFLICT');
  await refuse(fixture({ body: () => Readable.from([Buffer.alloc(bytes.length)]) }).storage.readOriginal({ plan: p }), 'OWNERSHIP_PROOF_STORAGE_CONFLICT');
  const f = fixture(); await refuse(f.storage.readOriginal({ plan: p, object: { key: p.key, versionId: 'old', etag: '"etag-1"' } }), 'OWNERSHIP_PROOF_STORAGE_CONFLICT');
  assert.equal(f.calls.length, 1);
});
test('stream chunks are owned even when a transport reuses its buffer', async () => {
  const buffer = Buffer.alloc(1); let offset = 0;
  const f = fixture({ body: () => ({ destroy() {}, [Symbol.asyncIterator]() { return this; }, async next() {
    if (offset === bytes.length) return { done: true };
    buffer[0] = bytes[offset++]; return { done: false, value: buffer };
  } }) });
  assert.deepEqual((await f.storage.readOriginal({ plan: p })).bytes, bytes);
});
test('unversioned storage still requires exact conditional ETag GET', async () => {
  const f = fixture({ editHead: r => delete r.VersionId, editGet: r => delete r.VersionId });
  const result = await f.storage.readOriginal({ plan: p }); assert.equal(result.object.versionId, null);
  assert.equal(f.calls[1].input.IfMatch, '"etag-1"'); assert.equal(f.calls[1].input.VersionId, undefined);
});
test('abort and timeout settle noncooperative SDK and stream; late body is destroyed', async () => {
  let finish; const f = fixture({ sendOverride: () => new Promise(resolve => { finish = resolve; }) });
  const controller = new AbortController(), result = f.storage.readOriginal({ plan: p, signal: controller.signal });
  controller.abort(); await refuse(result, 'OWNERSHIP_PROOF_STORAGE_CANCELLED');
  const late = Readable.from([bytes]); finish({ Body: late }); await new Promise(resolve => setImmediate(resolve)); assert.ok(late.destroyed);
  let closed = false;
  const hung = fixture({ timeoutMs: 15, body: () => ({ destroy() { closed = true; }, [Symbol.asyncIterator]() { return this; }, next() { return new Promise(() => {}); } }) });
  await refuse(hung.storage.readOriginal({ plan: p }), 'OWNERSHIP_PROOF_STORAGE_TIMEOUT'); assert.ok(closed);
});
