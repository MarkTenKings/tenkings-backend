import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { requireThat } from '@atlas/manual-service/contract';
import { descriptorSha256, parseDecodedFrame } from '@atlas/photo-core';
import { photo } from '../../../packages/atlas-connected-manual/test/photo-fixture.mjs';
import { savedGradingPhoto } from '../../../packages/atlas-connected-manual/test/grading-photo-fixture.mjs';
import { createVerifiedImagePool } from '../../../packages/atlas-manual-workspace/src/verified-image-pool.mjs';
import { verifiedImageContentKey } from '../../../packages/atlas-manual-workspace/src/verified-image.mjs';

// Exercise the actual private-runtime signing callback without constructing
// credential-bearing database/storage clients or starting background workers.
const source = readFileSync(new URL('../lib/server/connected-manual-runtime.mjs', import.meta.url), 'utf8');
const callback = source.slice(source.indexOf('  const reads=new Map();'), source.indexOf('  const memoryEnabled='));
assert.ok(callback.includes('const imageReadUrl='));
const origin = 'https://fixture.example';
function runtime(storage, clock = Date) {
  return vm.runInNewContext(`(() => { ${callback}; return imageReadUrl; })()`, {
    storage, settings: { uploadOrigin: origin }, descriptorSha256, requireThat, URL, Date: clock,
  });
}
test('serving grants the exact selected original or generated frame and retains storage validation', async () => {
  const generated = await savedGradingPhoto(photo), calls = [];
  const read = runtime({ async createDecodedFrameRead(input) {
    parseDecodedFrame(input.frame, input.original, input.decodePlan);
    calls.push(input);return { url: `${origin}/${input.frame.raster.content.sha256}.png` };
  }, createImmutableDerivativeRead() { assert.fail('A grading frame is not a derivative'); } });
  for (const frame of [photo.workingFrame, generated.frame]) {
    const input = { kind: 'original', descriptor: frame, photo: { ...photo, workingFrame: frame } };
    const grant = await read(input);
    assert.equal(grant.descriptorSha256, descriptorSha256(frame));
    assert.equal(grant.width, frame.raster.dimensions.width);
    assert.equal(grant.height, frame.raster.dimensions.height);
    assert.equal(calls.at(-1).frame, frame);
    await read(input); // Cache cannot confuse original and generated domains.
  }
  assert.equal(calls.length, 2);
  await assert.rejects(read({ kind:'original', descriptor:{ ...photo.workingFrame, schemaVersion:5 }, photo }), { code:'GRADING_IMAGE_REQUIRED' });
  await assert.rejects(read({ kind:'original', descriptor:{ ...photo.workingFrame, originalDescriptorSha256:'f'.repeat(64) }, photo }));
});
test('fallback frame grants retain the approved storage-origin restriction', async () => {
  const read = runtime({ createDecodedFrameRead:async()=>({url:'https://unapproved.example/photo.png'}) });
  await assert.rejects(read({kind:'original',descriptor:photo.workingFrame,photo}), {code:'MANUAL_UPLOAD_ORIGIN_MISMATCH'});
});

test('explicit descriptor renewal recovers an aged cached grant after idle photo eviction before the next workspace refresh', async t => {
  // Actual signing-cache callback and pool lifecycle; authorization expiry and
  // retained bytes are synthetic. No storage client or live grant is used.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0, signatures = 0, loads = 0;
  const read = runtime({ async createDecodedFrameRead({ expiresIn }) {
    signatures++; assert.equal(expiresIn, 300);
    return { url: `${origin}/photo?expires=${now + expiresIn * 1000}`, sha256: 'a'.repeat(64), byteCount: 10 };
  } }, class extends Date { static now() { return now; } });
  const input = { kind: 'original', descriptor: photo.workingFrame, photo };
  const first = await read(input); now = 239000;
  const opened = await read(input), nextWorkspaceRefresh = now + 240000;
  assert.equal(opened.url, first.url); assert.equal(signatures, 1);
  assert.equal(Number(new URL(opened.url).searchParams.get('expires')) - now, 61000);
  const pool = createVerifiedImagePool({ keyOf: verifiedImageContentKey, clock: () => now, load: async descriptor => {
    loads++;
    if (now >= Number(new URL(descriptor.url).searchParams.get('expires'))) throw { code: 'VERIFIED_IMAGE_UNAVAILABLE' };
    return { contentKey: verifiedImageContentKey(descriptor), url: `blob:synthetic-${loads}`, byteCount: 10, dispose() {} };
  } });
  try {
    const front = await pool.borrow(opened); now += 5000; front.dispose();
    now += 61000; t.mock.timers.tick(61000);
    assert.equal(pool.stats().entries, 0, 'unused Front bytes have left the actual pool');
    assert.ok(now < nextWorkspaceRefresh, 'the periodic workspace read is not due yet');
    await assert.rejects(pool.borrow(opened), { code: 'VERIFIED_IMAGE_UNAVAILABLE' });
    await assert.rejects(pool.borrow(opened), { code: 'VERIFIED_IMAGE_UNAVAILABLE' }, 'retrying only the old URL still fails');
    const renewed = await read(input);
    assert.notEqual(renewed.url, opened.url); assert.equal(signatures, 2);
    assert.equal(verifiedImageContentKey(renewed), verifiedImageContentKey(opened), 'renewal retains exact pixel identity');
    const recovered = await pool.borrow(renewed); assert.equal(recovered.url, 'blob:synthetic-4'); recovered.dispose();
  } finally { pool.close(); }
});
