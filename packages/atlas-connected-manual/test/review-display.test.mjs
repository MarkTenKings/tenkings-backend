import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyAndDecodePhoto, deriveSdrWorkingPhoto, describeDecodedFrame } from '@atlas/photo-runtime';
import { createReviewDisplayReader, REVIEW_DISPLAY_POLICY } from '../src/review-display.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const bytes = await readFile(new URL('../../atlas-photo-runtime/test/fixtures/browser-canvas/opaque-p3.png', import.meta.url));
const limits = { maxInputBytes: 2e6, maxPixels: 1e6, maxRasterBytes: 8e6, maxOutputBytes: 4e6, timeoutMs: 5000 };
const object = { key: 'originals/front', versionId: null };
const decoded = await verifyAndDecodePhoto({ bytes, limits, observedObject: object, uploadPlan: {
  schemaVersion: 1, uploadId: 'synthetic-upload', binding: { cardId: 'synthetic-card', pairId: 'synthetic-pair', side: 'FRONT', version: 1 },
  object, expected: { byteCount: bytes.length, sha256: sha(bytes) } } });
const working = await deriveSdrWorkingPhoto(decoded);
const photo = { original: working.original, decodePlan: working.decodePlan,
  workingFrame: describeDecodedFrame(working, { id: 'working', object: { key: 'derived/working.png', versionId: null } }) };

function setup(options = {}) {
  const f = { generations: 0, originalsRead: 0, writes: [], reads: [], now: 0 };
  const output = (kind, dimensions) => { const bytes = Buffer.from(kind); return { bytes, dimensions,
    content: { mime: kind === 'full' ? 'image/webp' : 'image/jpeg', byteCount: bytes.length, sha256: sha(bytes) } }; };
  f.result = { policyVersion: REVIEW_DISPLAY_POLICY, sourceSha256: photo.workingFrame.raster.content.sha256,
    full: output('full', working.raster.dimensions), preview: output('preview', { width: 24, height: 32 }) };
  f.reader = createReviewDisplayReader({ keyPrefix: 'atlas-test', now: () => f.now, limited: fn => fn(), ...options,
    generate: async input => { f.generations++; assert.deepEqual(input.frame, photo.workingFrame);
      assert.deepEqual(input.bytes, working.png); if (f.beforeGenerate) await f.beforeGenerate(); return f.result; },
    storage: {
      async readDecodedFrame({ signal }) { f.originalsRead++; f.signal = signal;
        if (f.beforeRead) await f.beforeRead(); return { bytes: working.png }; },
      async writeDerivative({ descriptor, bytes }) { assert.equal(sha(bytes), descriptor.raster.content.sha256);
        assert.notEqual(descriptor.raster.object.key, photo.original.object.key); f.writes.push(descriptor); return descriptor; },
      async createDerivativeRead({ descriptor }) { f.reads.push(descriptor);
        return { ...descriptor.raster.content, url: `https://storage.invalid/${descriptor.id}?read=${f.reads.length}` }; },
    } });
  return f;
}

test('display derivatives bind to the exact saved working frame and renew URLs without recoding or replacing it', async () => {
  const before = structuredClone(photo), f = setup(), first = await f.reader(photo), second = await f.reader(photo);
  assert.equal(f.generations, 1); assert.equal(f.originalsRead, 1); assert.equal(f.writes.length, 2);
  assert.equal(first.sourceSha256, photo.workingFrame.raster.content.sha256);
  assert.equal(first.width, 48); assert.equal(first.height, 64); assert.equal(first.preview.width, 24);
  assert.notEqual(first.url, second.url); assert.equal(first.sha256, second.sha256);
  assert.deepEqual(f.writes[0].frameToDerivative, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual(f.writes[1].frameToDerivative, [.5, 0, -.25, 0, .5, -.25, 0, 0, 1]);
  assert.deepEqual(photo, before);
});

test('concurrent reads share one generation and grant batch', async () => {
  const f = setup(); let release; f.beforeGenerate = () => new Promise(resolve => { release = resolve; });
  const a = f.reader(photo), b = f.reader(photo); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.generations, 1); release(); const values = await Promise.all([a, b]);
  assert(values.every(Boolean)); assert.equal(f.writes.length, 2); assert.equal(f.reads.length, 2);
});

for (const [name, mutate] of [
  ['wrong source', result => { result.sourceSha256 = 'f'.repeat(64); }],
  ['resized full view', result => { result.full.dimensions.width--; }],
  ['lossy full view', result => { result.full.content.mime = 'image/jpeg'; }],
  ['unknown policy', result => { result.policyVersion = 'unqualified'; }],
  ['unbounded preview', result => { result.preview.dimensions.width = 1000; }],
]) test(`${name} cannot be published as the full-detail review transport`, async () => {
  const f = setup(); f.result = structuredClone(f.result); mutate(f.result);
  assert.equal(await f.reader(photo), null); assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
});

test('failed optional generation permits canonical fallback and has bounded retry backoff', async () => {
  const f = setup(); f.beforeGenerate = () => { throw new Error('PHOTO_DECODE_TIMEOUT'); };
  assert.equal(await f.reader(photo), null); assert.equal(await f.reader(photo), null); assert.equal(f.generations, 1);
  f.now = 30001; f.beforeGenerate = null; assert(await f.reader(photo)); assert.equal(f.generations, 2);
});

test('a stalled source read cannot delay canonical fallback or publish a late derivative', async () => {
  const f = setup({ timeoutMs: 15 }); let release;
  f.beforeRead = () => new Promise(resolve => { release = resolve; });
  const value = await f.reader(photo); assert.equal(value, null); assert.equal(f.signal.aborted, true);
  release(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
});

test('optional display deadline includes the native limiter queue, with no work after expiry', async () => {
  let queued;
  const f = setup({ timeoutMs: 15, limited: callback => new Promise((resolve, reject) => {
    queued = () => callback().then(resolve, reject);
  }) });
  assert.equal(await f.reader(photo), null); assert.equal(f.originalsRead, 0);
  queued(); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.originalsRead, 0); assert.equal(f.writes.length, 0);
});
