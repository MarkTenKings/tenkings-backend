import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifiedImagePool } from '../src/verified-image-pool.mjs';
import { createVerifiedImageResource, verifiedImageContentKey } from '../src/verified-image.mjs';

const image = { sha256: 'a'.repeat(64), byteCount: 10, width: 1350, height: 1858, url: '/a' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const loads = [], disposed = [], metrics = [];
  const pool = createVerifiedImagePool({ keyOf: verifiedImageContentKey, onMetric: value => metrics.push(value),
    load: async (descriptor, { signal }) => { loads.push({ descriptor, signal }); return {
      contentKey: verifiedImageContentKey(descriptor), url: `blob:${loads.length}`, byteCount: descriptor.byteCount,
      dispose: () => disposed.push(descriptor.sha256),
    }; }, ...options });
  return { pool, loads, disposed, metrics };
}

test('two simultaneous panes share exact bytes and releasing one preserves the other', async () => {
  const f = fixture();
  const [left, right] = await Promise.all([f.pool.borrow(image), f.pool.borrow({ ...image, url: '/renewed' })]);
  assert.equal(f.loads.length, 1); assert.equal(left.url, right.url);
  left.dispose(); assert.equal(f.disposed.length, 0); right.dispose();
  const next = await f.pool.borrow({ ...image, url: '/later' });
  assert.equal(next.url, right.url); assert.equal(f.loads.length, 1);
  next.dispose(); f.pool.close(); assert.equal(f.disposed.length, 1);
});

test('report-to-editor resource unmount reuses verified bytes in the authorized boundary', async () => {
  const f = fixture(), seen = [];
  const first = createVerifiedImageResource({ load: (descriptor, options) => f.pool.borrow(descriptor, options) });
  await first.update(image, value => seen.push(value)); first.dispose();
  const second = createVerifiedImageResource({ load: (descriptor, options) => f.pool.borrow(descriptor, options) });
  await second.update({ ...image, url: '/editor-grant' }, value => seen.push(value));
  assert.equal(f.loads.length, 1); assert.equal(seen.at(-1).url, 'blob:1');
  second.dispose(); f.pool.close();
});

test('dimensions, source/policy and different authorization pools cannot share a lease', async () => {
  const f = fixture(), other = fixture();
  for (const change of [{}, { width: 1351 }, { sourceSha256: 'b'.repeat(64) }, { policyVersion: 'new' }])
    (await f.pool.borrow({ ...image, ...change })).dispose();
  (await other.pool.borrow(image)).dispose();
  assert.equal(f.loads.length, 4); assert.equal(other.loads.length, 1); f.pool.close(); other.pool.close();
});

test('cancelling one pending reader does not cancel another reader of the same image', async () => {
  let finish, requestSignal;
  const f = fixture({ load: (descriptor, { signal }) => { requestSignal = signal; return new Promise(resolve => {
    finish = () => resolve({ contentKey: verifiedImageContentKey(descriptor), url: 'blob:shared', byteCount: 10, dispose() {} });
  }); } });
  const controller = new AbortController();
  const gone = f.pool.borrow(image, { signal: controller.signal }); const kept = f.pool.borrow(image);
  await tick(); controller.abort(); await assert.rejects(gone, { code: 'VERIFIED_IMAGE_CANCELLED' });
  assert.equal(requestSignal.aborted, false); finish(); (await kept).dispose(); f.pool.close();
});

test('revocation clears active and cached images and refuses future reuse', async () => {
  const f = fixture(); const first = await f.pool.borrow(image); f.pool.close();
  assert.equal(f.disposed.length, 1); assert.equal(f.pool.stats().entries, 0);
  await assert.rejects(f.pool.borrow(image), { code: 'VERIFIED_IMAGE_CANCELLED' }); first.dispose();
  assert.equal(f.disposed.length, 1);
});

test('revocation cancels pending consumers immediately and disposes a noncooperative late result', async () => {
  let finish, disposed = 0;
  const f = fixture({ load: () => new Promise(resolve => { finish = () => resolve({ url: 'blob:late', byteCount: 10, dispose() { disposed++; } }); }) });
  const pending = f.pool.borrow(image); await tick(); f.pool.close();
  await assert.rejects(pending, { code: 'VERIFIED_IMAGE_CANCELLED' }); finish(); await tick();
  assert.equal(disposed, 1); assert.equal(f.pool.stats().entries, 0);
});

test('idle eviction stays bounded without revoking a visible image', async () => {
  const f = fixture({ maxBytes: 15, maxEntries: 2 });
  const visible = await f.pool.borrow(image);
  (await f.pool.borrow({ ...image, sha256: 'b'.repeat(64) })).dispose();
  assert.deepEqual(f.disposed, ['b'.repeat(64)]); assert.equal(f.pool.stats().bytes, 10);
  visible.dispose(); (await f.pool.borrow({ ...image, sha256: 'c'.repeat(64) })).dispose();
  assert(f.pool.stats().bytes <= 15); f.pool.close();
});

test('unsubscribed pending requests expire but a fast remount can join the same transfer', async () => {
  let finish, signal, calls = 0;
  const f = fixture({ graceMs: 15, load: (descriptor, options) => { calls++; signal = options.signal;
    return new Promise(resolve => { finish = () => resolve({ contentKey: verifiedImageContentKey(descriptor), byteCount: 10, url: 'blob:kept', dispose() {} }); }); } });
  const first = new AbortController(), pending = f.pool.borrow(image, { signal: first.signal });
  await tick(); first.abort(); await assert.rejects(pending);
  const second = f.pool.borrow(image); finish(); (await second).dispose();
  assert.equal(calls, 1); assert.equal(signal.aborted, false); f.pool.close();
});

test('selected and preview loads overtake queued speculative downloads', async () => {
  const starts = [], release = [];
  const f = fixture({ concurrency: 1, load: descriptor => { starts.push(descriptor.sha256[0]);
    return new Promise(resolve => release.push(() => resolve({ contentKey: verifiedImageContentKey(descriptor), byteCount: 10, url: `blob:${descriptor.sha256}`, dispose() {} }))); } });
  const a = f.pool.borrow(image, { priority: 0 }); await tick();
  const b = f.pool.borrow({ ...image, sha256: 'b'.repeat(64) }, { priority: 0 });
  const c = f.pool.borrow({ ...image, sha256: 'c'.repeat(64) }, { priority: 0 });
  const selected = f.pool.borrow({ ...image, sha256: 'c'.repeat(64) }, { priority: 3 });
  release.shift()(); (await a).dispose(); await tick(); assert.deepEqual(starts, ['a', 'c']);
  release.shift()(); (await c).dispose(); (await selected).dispose(); await tick();
  release.shift()(); (await b).dispose(); assert.deepEqual(starts, ['a', 'c', 'b']); f.pool.close();
});

test('verification failures do not enter the cache and a later explicit retry can succeed', async () => {
  let calls = 0;
  const f = fixture({ load: async descriptor => {
    if (++calls === 1) throw Object.assign(new Error('wrong bytes'), { code: 'VERIFIED_IMAGE_HASH' });
    return { contentKey: verifiedImageContentKey(descriptor), byteCount: 10, url: 'blob:verified', dispose() {} };
  } });
  await assert.rejects(f.pool.borrow(image), { code: 'VERIFIED_IMAGE_HASH' });
  assert.equal(f.pool.stats().entries, 0); (await f.pool.borrow(image)).dispose(); assert.equal(calls, 2); f.pool.close();
});
