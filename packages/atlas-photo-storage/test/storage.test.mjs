import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { descriptorSha256 } from '@atlas/photo-core';
import { createPhotoStorage } from '../src/index.mjs';
import { rgb16Png, sha256, limits as decodeLimits } from '../../atlas-photo-runtime/test/helpers.mjs';

const bytes = rgb16Png(4, 3);
const storageLimits = { maxObjectBytes: 4_000_000, timeoutMs: 1000 };
const code = expected => error => error?.code === expected;
const error = (name, status) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
function plan(body = bytes, overrides = {}) {
  return { schemaVersion: 1, uploadId: 'upload-front',
    binding: { cardId: 'card-1', pairId: 'pair-1', side: 'FRONT', version: 1 },
    object: { key: 'test/originals/upload-front', versionId: null },
    expected: { byteCount: body.length, sha256: sha256(body) }, ...overrides };
}

// Actual-byte local transport. It implements only the injected SDK command
// boundary, never a filesystem or production S3 substitute.
class ByteTransport {
  constructor({ versioned = true } = {}) { this.versioned = versioned; this.objects = new Map(); this.calls = []; this.sequence = 0; }
  current(key) { return this.objects.get(key)?.at(-1); }
  record(input) {
    const value = { bytes: Buffer.from(input.Body), mime: input.ContentType, metadata: structuredClone(input.Metadata),
      version: this.versioned ? `version-${++this.sequence}` : null, etag: `"opaque-${++this.sequence}"` };
    this.objects.set(input.Key, [...(this.objects.get(input.Key) ?? []), value]);
    return value;
  }
  describe(value) {
    return { ContentLength: value.bytes.length, ContentType: value.mime, Metadata: structuredClone(value.metadata),
      ...(value.version !== null ? { VersionId: value.version } : {}), ETag: value.etag,
      ...(this.omitChecksum ? {} : { ChecksumSHA256: Buffer.from(sha256(value.bytes), 'hex').toString('base64') }) };
  }
  async send(command, { abortSignal } = {}) {
    const name = command.constructor.name, input = command.input;
    this.calls.push({ name, input, abortSignal });
    if (this.intercept) { const special = await this.intercept(name, input, abortSignal); if (special) return special.value; }
    if (name === 'PutObjectCommand') {
      assert.equal(input.IfNoneMatch, '*');
      assert.equal(input.ChecksumAlgorithm, 'SHA256');
      assert.equal(input.ChecksumSHA256, Buffer.from(sha256(input.Body), 'hex').toString('base64'));
      assert.equal(input.ContentLength, input.Body.length);
      if (this.current(input.Key)) throw error('PreconditionFailed', 412);
      if (this.rejectPut) throw error('AccessDenied', 403);
      if (this.loseBeforePut) throw new Error('Connection lost before provider response');
      const value = this.record(input);
      this.afterPut?.(value);
      if (this.losePut) { this.losePut = false; throw new Error('Provider stored bytes; response lost'); }
      return value.version === null ? {} : { VersionId: value.version };
    }
    const versions = this.objects.get(input.Key) ?? [];
    const value = input.VersionId === undefined ? versions.at(-1) : versions.find(item => item.version === input.VersionId);
    if (!value) throw error('NotFound', 404);
    if (input.IfMatch && input.IfMatch !== value.etag) throw error('PreconditionFailed', 412);
    const response = this.describe(value);
    if (name === 'HeadObjectCommand') {
      this.afterHead?.(value, input);
      return this.changeHead ? this.changeHead(response) : response;
    }
    assert.equal(name, 'GetObjectCommand');
    const body = this.makeBody ? this.makeBody(value) : Readable.from([value.bytes.subarray(0, 7), value.bytes.subarray(7)]);
    this.lastBody = body;
    return this.changeGet ? this.changeGet({ ...response, Body: body }) : { ...response, Body: body };
  }
}
function storage(client, options = {}) { return createPhotoStorage({ client, bucket: 'synthetic-bucket', keyPrefix: 'test', limits: storageLimits, ...options }); }
function putCount(client) { return client.calls.filter(call => call.name === 'PutObjectCommand').length; }
async function fixture() {
  const client = new ByteTransport(), store = storage(client), uploadPlan = plan();
  await store.writeOriginal({ uploadPlan, bytes });
  const decoded = await store.decodeOriginal({ uploadPlan, decodeLimits });
  return { client, store, uploadPlan, decoded };
}

test('actual original bytes are create-only, fully verified, replayed once and privately untyped', async () => {
  const client = new ByteTransport(), store = storage(client), uploadPlan = plan();
  const first = await store.writeOriginal({ uploadPlan, bytes });
  assert.equal(first.disposition, 'CREATED'); assert.equal(first.contentType, 'application/octet-stream');
  assert.deepEqual(first.bytes, bytes); assert.equal(first.sha256, sha256(bytes));
  const second = await store.writeOriginal({ uploadPlan, bytes });
  assert.equal(second.disposition, 'EXISTING'); assert.deepEqual(second.object, first.object); assert.equal(putCount(client), 1);
  assert.equal(client.calls.some(call => /Delete|Copy|List/.test(call.name)), false);
});

test('owned input snapshot prevents caller mutation during asynchronous storage I/O', async () => {
  const client = new ByteTransport(), store = storage(client), supplied = Buffer.from(bytes);
  const pending = store.writeOriginal({ uploadPlan: plan(supplied), bytes: supplied });
  supplied.fill(0);
  assert.deepEqual((await pending).bytes, bytes);
});

test('same bytes on a wrong upload, pair, side or version cannot replay a captured key', async () => {
  const client = new ByteTransport(), store = storage(client), uploadPlan = plan();
  await store.writeOriginal({ uploadPlan, bytes });
  for (const changed of [
    { ...uploadPlan, uploadId: 'different-upload' },
    ...[{ pairId: 'pair-2' }, { side: 'BACK' }, { version: 2 }].map(binding => ({ ...uploadPlan, binding: { ...uploadPlan.binding, ...binding } })),
  ]) await assert.rejects(store.writeOriginal({ uploadPlan: changed, bytes }), code('PHOTO_STORAGE_CONFLICT'));
  assert.equal(putCount(client), 1);
});

test('different bytes/hash and a wrong namespace fail before writing', async () => {
  const client = new ByteTransport(), store = storage(client), changed = Buffer.from(bytes); changed[20] ^= 1;
  await assert.rejects(store.writeOriginal({ uploadPlan: plan(), bytes: changed }), code('PHOTO_STORAGE_CONFLICT'));
  await assert.rejects(store.writeOriginal({ uploadPlan: plan(bytes, { object: { key: 'test/derived/front', versionId: null } }), bytes }), code('PHOTO_STORAGE_SCOPE'));
  await assert.rejects(store.writeOriginal({ uploadPlan: plan(bytes, { object: { key: 'other/originals/front', versionId: null } }), bytes }), code('PHOTO_STORAGE_SCOPE'));
  assert.equal(client.calls.length, 0);
});

test('lost successful PUT reply and create-only racing writer reconcile the same stored object', async () => {
  for (const behavior of ['losePut', 'racingPut']) {
    const client = new ByteTransport(), store = storage(client);
    if (behavior === 'losePut') client.losePut = true;
    else client.intercept = async (name, input) => {
      if (name === 'PutObjectCommand') { client.record(input); client.intercept = null; }
    };
    const result = await store.writeOriginal({ uploadPlan: plan(), bytes });
    assert.equal(result.disposition, 'RECONCILED'); assert.deepEqual(result.bytes, bytes);
    assert.equal(putCount(client), 1); assert.equal(client.objects.size, 1);
  }
});

test('uncertain absent reply is UNKNOWN; known rejection and object conflict are distinct', async () => {
  const client = new ByteTransport(), store = storage(client); client.loseBeforePut = true;
  await assert.rejects(store.writeOriginal({ uploadPlan: plan(), bytes }), code('PHOTO_WRITE_UNKNOWN'));
  assert.equal(putCount(client), 1);
  const denied = new ByteTransport(); denied.rejectPut = true;
  await assert.rejects(storage(denied).writeOriginal({ uploadPlan: plan(), bytes }), code('PHOTO_STORAGE_WRITE_REJECTED'));
  assert.equal(putCount(denied), 1);
  const conflict = new ByteTransport(); conflict.afterPut = value => { value.metadata['atlas-binding-sha256'] = 'f'.repeat(64); };
  await assert.rejects(storage(conflict).writeOriginal({ uploadPlan: plan(), bytes }), code('PHOTO_STORAGE_CONFLICT'));
});

test('versioned Head/Get race retrieves the exact observed original version', async () => {
  const client = new ByteTransport(), store = storage(client), uploadPlan = plan();
  const stored = await store.writeOriginal({ uploadPlan, bytes });
  const different = Buffer.from(bytes); different[25] ^= 1;
  client.afterHead = () => {
    client.afterHead = null;
    client.record({ Key: uploadPlan.object.key, Body: different, ContentType: 'application/octet-stream', Metadata: client.current(uploadPlan.object.key).metadata });
  };
  const read = await store.readOriginal({ uploadPlan, object: stored.object });
  assert.deepEqual(read.bytes, bytes); assert.deepEqual(read.object, stored.object);
  assert.equal(client.calls.at(-1).input.VersionId, stored.object.versionId);
});

test('unversioned Head/Get race uses IfMatch; same-ETag tampering still fails actual SHA', async () => {
  const client = new ByteTransport({ versioned: false }), store = storage(client), uploadPlan = plan();
  await store.writeOriginal({ uploadPlan, bytes });
  client.afterHead = value => { client.afterHead = null; value.etag = '"raced"'; };
  await assert.rejects(store.readOriginal({ uploadPlan }), code('PHOTO_STORAGE_CONFLICT'));
  assert.ok(client.calls.at(-1).input.IfMatch); assert.equal(client.calls.at(-1).input.VersionId, undefined);
  client.omitChecksum = true;
  client.afterHead = value => { client.afterHead = null; value.bytes[25] ^= 1; };
  await assert.rejects(store.readOriginal({ uploadPlan }), code('PHOTO_STORAGE_CONFLICT'));
  assert.equal(client.lastBody.destroyed, true);
});

test('mismatched Get versions, ranges, lengths, MIME and checksum cannot become a receipt', async () => {
  const client = new ByteTransport(), store = storage(client), uploadPlan = plan();
  await store.writeOriginal({ uploadPlan, bytes });
  for (const change of [
    response => ({ ...response, VersionId: 'another-version' }),
    response => ({ ...response, ContentRange: 'bytes 0-4/9' }),
    response => ({ ...response, ContentLength: response.ContentLength - 1 }),
    response => ({ ...response, ContentType: 'image/jpeg' }),
    response => ({ ...response, ChecksumSHA256: Buffer.alloc(32).toString('base64') }),
  ]) {
    client.changeGet = change;
    await assert.rejects(store.readOriginal({ uploadPlan }), code('PHOTO_STORAGE_CONFLICT'));
    assert.equal(client.lastBody.destroyed, true);
  }
});

test('missing native checksum still verifies full bytes; oversized headers stop before Get', async () => {
  const client = new ByteTransport(), store = storage(client), uploadPlan = plan(); client.omitChecksum = true;
  await store.writeOriginal({ uploadPlan, bytes });
  assert.deepEqual((await store.readOriginal({ uploadPlan })).bytes, bytes);
  const count = client.calls.filter(call => call.name === 'GetObjectCommand').length;
  client.changeHead = response => ({ ...response, ContentLength: storageLimits.maxObjectBytes + 1 });
  await assert.rejects(store.readOriginal({ uploadPlan }), code('PHOTO_STORAGE_CONFLICT'));
  assert.equal(client.calls.filter(call => call.name === 'GetObjectCommand').length, count);
});

test('truncated and oversized streams stop and close their actual bodies', async () => {
  const client = new ByteTransport(), store = storage(client), uploadPlan = plan();
  await store.writeOriginal({ uploadPlan, bytes });
  client.makeBody = value => Readable.from([value.bytes.subarray(0, -1)]);
  await assert.rejects(store.readOriginal({ uploadPlan }), code('PHOTO_STORAGE_CONFLICT'));
  assert.equal(client.lastBody.destroyed, true);
  client.makeBody = value => Readable.from([value.bytes, Buffer.from([1])]);
  await assert.rejects(store.readOriginal({ uploadPlan }), code('PHOTO_STORAGE_LIMIT'));
  assert.equal(client.lastBody.destroyed, true);
});

test('blocked body timeout and caller abort terminate reading without deleting stored evidence', async () => {
  const client = new ByteTransport(), store = storage(client), uploadPlan = plan();
  await store.writeOriginal({ uploadPlan, bytes });
  client.makeBody = () => new Readable({ read() {} });
  await assert.rejects(storage(client, { limits: { ...storageLimits, timeoutMs: 25 } }).readOriginal({ uploadPlan }), code('PHOTO_STORAGE_TIMEOUT'));
  assert.equal(client.lastBody.destroyed, true);
  const controller = new AbortController();
  const pending = store.readOriginal({ uploadPlan, signal: controller.signal });
  setImmediate(() => controller.abort());
  await assert.rejects(pending, code('PHOTO_STORAGE_CANCELLED'));
  assert.equal(client.lastBody.destroyed, true); assert.deepEqual(client.current(uploadPlan.object.key).bytes, bytes);
});

test('late noncooperative Get response is fenced and its body destroyed', async () => {
  const client = new ByteTransport(), uploadPlan = plan();
  await storage(client).writeOriginal({ uploadPlan, bytes });
  let finish;
  client.intercept = async name => name === 'GetObjectCommand' ? { value: await new Promise(resolve => { finish = resolve; }) } : undefined;
  const pending = storage(client, { limits: { ...storageLimits, timeoutMs: 25 } }).readOriginal({ uploadPlan });
  await assert.rejects(pending, code('PHOTO_STORAGE_TIMEOUT'));
  const body = new Readable({ read() {} }); finish({ Body: body });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(body.destroyed, true);
});

test('cancellation after successful PUT is UNKNOWN and next lookup recovers without another write', async () => {
  const client = new ByteTransport(), store = storage(client), controller = new AbortController(), uploadPlan = plan();
  client.afterPut = () => controller.abort();
  await assert.rejects(store.writeOriginal({ uploadPlan, bytes, signal: controller.signal }), code('PHOTO_WRITE_UNKNOWN'));
  client.afterPut = null;
  assert.deepEqual((await store.readOriginal({ uploadPlan })).bytes, bytes); assert.equal(putCount(client), 1);
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(store.writeOriginal({ uploadPlan, bytes, signal: alreadyAborted.signal }), code('PHOTO_STORAGE_CANCELLED'));
  assert.equal(putCount(client), 1);
});

test('a timed-out successful write reconciles with a new bounded same-key read', async () => {
  const client = new ByteTransport();
  client.intercept = async (name, input) => {
    if (name === 'PutObjectCommand') {
      client.record(input); client.intercept = null;
      return { value: await new Promise(() => {}) };
    }
  };
  const store = storage(client, { limits: { ...storageLimits, timeoutMs: 25 } });
  const stored = await store.writeOriginal({ uploadPlan: plan(), bytes });
  assert.equal(stored.disposition, 'RECONCILED'); assert.deepEqual(stored.bytes, bytes);
  assert.equal(putCount(client), 1);
  assert.equal(client.calls.find(call => call.name === 'PutObjectCommand').abortSignal.aborted, true);
});

test('real decoder and verified frame store preserve 16-bit source lineage and immutable replay', async () => {
  const { client, store, uploadPlan, decoded } = await fixture();
  assert.equal(decoded.original.content.mime, 'image/png'); assert.equal(decoded.treatment.bitDepth, 16);
  const frame = await store.writeDecodedFrame(decoded, { id: 'frame-1', key: 'test/derived/frame-1.png' });
  assert.equal(frame.raster.object.versionId !== null, true);
  assert.deepEqual((await store.readDecodedFrame({ frame, original: decoded.original, decodePlan: decoded.decodePlan })).bytes, decoded.png);
  assert.deepEqual(await store.writeDecodedFrame(decoded, { id: 'frame-1', key: 'test/derived/frame-1.png' }), frame);
  assert.equal(putCount(client), 2);
  assert.deepEqual(client.current(uploadPlan.object.key).bytes, bytes);
  const replay = await store.decodeOriginal({ uploadPlan, existingOriginal: decoded.original, decodeLimits });
  assert.deepEqual(replay.original, decoded.original);
  await assert.rejects(store.writeDecodedFrame(decoded, { id: 'frame-2', key: 'test/derived/frame-1.png' }), code('PHOTO_STORAGE_CONFLICT'));
});

test('actual invalid decode preserves original storage and produces no derived write', async () => {
  const body = Buffer.from('not an image'), client = new ByteTransport(), store = storage(client), uploadPlan = plan(body);
  const stored = await store.writeOriginal({ uploadPlan, bytes: body });
  await assert.rejects(store.decodeOriginal({ uploadPlan, decodeLimits }), error => error.code === 'PHOTO_FORMAT_UNSUPPORTED');
  assert.deepEqual((await store.readOriginal({ uploadPlan, object: stored.object })).bytes, body);
  assert.equal(putCount(client), 1); assert.equal(client.objects.size, 1);
});

test('derived byte writes bind real encoder provenance and cannot overwrite original or other lineage', async () => {
  const { store, decoded } = await fixture();
  const frame = await store.writeDecodedFrame(decoded, { id: 'frame-1', key: 'test/derived/frame-1.png' });
  const descriptor = { schemaVersion: 1, kind: 'derivative', id: 'copy-for-preview', purpose: 'preview',
    originalDescriptorSha256: descriptorSha256(decoded.original), frameDescriptorSha256: descriptorSha256(frame),
    raster: { object: { key: 'test/derived/preview.png', versionId: null }, content: decoded.raster.content, dimensions: decoded.raster.dimensions },
    frameToDerivative: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    encoder: { name: 'preserve-decoded-png-bytes', version: '1', settingsSha256: descriptorSha256({ operation: 'exact-byte-copy' }) } };
  const args = { descriptor, frame, original: decoded.original, decodePlan: decoded.decodePlan, bytes: decoded.png };
  const stored = await store.writeDerivative(args);
  assert.deepEqual((await store.readDerivative({ ...args, descriptor: stored })).bytes, decoded.png);
  assert.deepEqual(await store.writeDerivative(args), stored);
  const changed = structuredClone(descriptor); changed.encoder.version = '2';
  await assert.rejects(store.writeDerivative({ ...args, descriptor: changed }), code('PHOTO_STORAGE_CONFLICT'));
  const originalSpace = structuredClone(descriptor); originalSpace.raster.object.key = 'test/originals/another-native';
  await assert.rejects(store.writeDerivative({ ...args, descriptor: originalSpace }), code('PHOTO_STORAGE_SCOPE'));
});

test('decode and frame-write source snapshots resist caller mutation across asynchronous I/O', async () => {
  const { store, decoded } = await fixture();
  const original = structuredClone(decoded.original), decodePlan = structuredClone(decoded.decodePlan);
  const pending = store.writeDecodedFrame(decoded, { id: 'snapshot-frame', key: 'test/derived/snapshot.png' });
  decoded.treatment.policyVersion = 'mutated-after-call'; decoded.png.fill(0);
  const stored = await pending;
  assert.notEqual(stored.treatment.policyVersion, 'mutated-after-call');
  assert.equal((await store.readDecodedFrame({ frame: stored, original, decodePlan })).sha256, stored.raster.content.sha256);
});

test('direct PUT is locally signed with immutable checksum, length, conditional and lineage headers', async () => {
  const client = new S3Client({ region: 'us-east-1', endpoint: 'https://synthetic-storage.example.invalid',
    credentials: { accessKeyId: 'SYNTHETICONLYACCESS', secretAccessKey: 'synthetic-test-key-never-a-live-credential' },
    forcePathStyle: true, maxAttempts: 1 });
  const upload = await storage(client).createOriginalUpload({ uploadPlan: plan(), expiresIn: 60 });
  const signed = new URL(upload.url), signedHeaders = signed.searchParams.get('X-Amz-SignedHeaders').split(';');
  for (const name of ['content-length', 'content-type', 'if-none-match', 'x-amz-checksum-sha256', 'x-amz-meta-atlas-kind', 'x-amz-meta-atlas-binding-sha256']) assert.ok(signedHeaders.includes(name), name);
  assert.equal(upload.headers['If-None-Match'], '*'); assert.equal(upload.headers['Content-Type'], 'application/octet-stream');
  assert.equal(upload.headers['x-amz-checksum-sha256'], Buffer.from(sha256(bytes), 'hex').toString('base64'));
  assert.equal(signed.searchParams.get('x-amz-sdk-checksum-algorithm'), 'SHA256');
  // The SDK signs the algorithm in the query; browsers need no extra CORS header.
  assert.equal(upload.headers['x-amz-sdk-checksum-algorithm'], undefined);
  assert.equal(signed.pathname, '/synthetic-bucket/test/originals/upload-front');
  client.destroy();
});

test('provider success without checksum enforcement cannot admit corrupted original bytes', async () => {
  const client = new ByteTransport(), store = storage(client), uploadPlan = plan();
  client.omitChecksum = true;
  client.afterPut = value => { value.bytes[25] ^= 1; };
  await assert.rejects(store.writeOriginal({ uploadPlan, bytes }), code('PHOTO_STORAGE_CONFLICT'));
  assert.equal(putCount(client), 1);
  await assert.rejects(store.decodeOriginal({ uploadPlan, decodeLimits }), code('PHOTO_STORAGE_CONFLICT'));
  // Failed integrity preserves the original object for reconciliation; no retry,
  // delete, derivative, or decoder can turn the provider's 200 into acceptance.
  assert.equal(client.objects.size, 1);
  assert.equal(client.calls.some(call => /Delete|Copy|List/.test(call.name)), false);
});

test('finite resource bounds and malformed cancellation fail before transport work', async () => {
  const client = new ByteTransport();
  assert.throws(() => storage(client, { limits: { ...storageLimits, timeoutMs: Infinity } }), code('PHOTO_STORAGE_INVALID'));
  await assert.rejects(storage(client, { limits: { ...storageLimits, maxObjectBytes: bytes.length - 1 } }).writeOriginal({ uploadPlan: plan(), bytes }), code('PHOTO_STORAGE_LIMIT'));
  await assert.rejects(storage(client).writeOriginal({ uploadPlan: plan(), bytes, signal: {} }), code('PHOTO_STORAGE_INVALID'));
  await assert.rejects(storage(client).decodeOriginal({ uploadPlan: plan(), decodeLimits: { ...decodeLimits, maxInputBytes: bytes.length - 1 } }), code('PHOTO_STORAGE_LIMIT'));
  await assert.rejects(storage(client).decodeOriginal({ uploadPlan: plan(), decodeLimits: { ...decodeLimits, timeoutMs: Infinity } }), code('PHOTO_STORAGE_INVALID'));
  assert.equal(client.calls.length, 0);
});

test('raw signer diagnostics do not escape the storage error boundary', async () => {
  const store = storage(new ByteTransport(), { sign: async () => { throw new Error('synthetic-secret-diagnostic'); } });
  await assert.rejects(store.createOriginalUpload({ uploadPlan: plan(), expiresIn: 60 }), error =>
    error.code === 'PHOTO_STORAGE_UNAVAILABLE' && error.message === 'PHOTO_STORAGE_UNAVAILABLE' && error.cause === undefined);
});


test('private read grants verify bytes and bind the observed object version before signing', async () => {
  const {client,store,decoded}=await fixture();
  const frame=await store.writeDecodedFrame(decoded,{id:'read-frame',key:'test/derived/read.png'});
  const calls=[];
  const reader=storage(client,{sign:async(_client,command,options)=>{calls.push({command,options});return 'https://synthetic.example.invalid/private';}});
  const args={frame,original:decoded.original,decodePlan:decoded.decodePlan,expiresIn:300};
  const grant=await reader.createDecodedFrameRead(args);
  assert.equal(grant.sha256,frame.raster.content.sha256);assert.equal(grant.byteCount,decoded.png.length);assert.equal(grant.mime,'image/png');
  assert.equal(calls[0].command.constructor.name,'GetObjectCommand');assert.equal(calls[0].command.input.VersionId,frame.raster.object.versionId);assert.equal(calls[0].options.expiresIn,300);
  const before=client.calls.length;
  await assert.rejects(reader.createDecodedFrameRead({...args,expiresIn:901}),code('PHOTO_STORAGE_INVALID'));assert.equal(client.calls.length,before);
  client.omitChecksum=true;client.current(frame.raster.object.key).bytes[30]^=1;
  await assert.rejects(reader.createDecodedFrameRead(args),code('PHOTO_STORAGE_CONFLICT'));assert.equal(calls.length,1);
});

test('private read signer is bounded, cancelled and hides raw diagnostics', async () => {
  const {client,store,decoded}=await fixture();const frame=await store.writeDecodedFrame(decoded,{id:'bound-frame',key:'test/derived/bound.png'});
  const args={frame,original:decoded.original,decodePlan:decoded.decodePlan};
  const blocked=storage(client,{limits:{...storageLimits,timeoutMs:30},sign:()=>new Promise(()=>{})});
  await assert.rejects(blocked.createDecodedFrameRead(args),code('PHOTO_STORAGE_TIMEOUT'));
  const controller=new AbortController();controller.abort();await assert.rejects(blocked.createDecodedFrameRead({...args,signal:controller.signal}),code('PHOTO_STORAGE_CANCELLED'));
  const bad=storage(client,{sign:async()=>{throw new Error('private diagnostic');}});
  await assert.rejects(bad.createDecodedFrameRead(args),error=>error.code==='PHOTO_STORAGE_UNAVAILABLE'&&!error.message.includes('private diagnostic'));
});
