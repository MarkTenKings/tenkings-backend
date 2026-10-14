import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { requireThat } from '@atlas/manual-service/contract';
import { descriptorSha256, parseDecodedFrame } from '@atlas/photo-core';
import { photo } from '../../../packages/atlas-connected-manual/test/photo-fixture.mjs';
import { savedGradingPhoto } from '../../../packages/atlas-connected-manual/test/grading-photo-fixture.mjs';

// Exercise the actual private-runtime signing callback without constructing
// credential-bearing database/storage clients or starting background workers.
const source = readFileSync(new URL('../lib/server/connected-manual-runtime.mjs', import.meta.url), 'utf8');
const callback = source.slice(source.indexOf('  const reads=new Map();'), source.indexOf('  const memoryEnabled='));
assert.ok(callback.includes('const imageReadUrl='));
const origin = 'https://fixture.example';
function runtime(storage) {
  return vm.runInNewContext(`(() => { ${callback}; return imageReadUrl; })()`, {
    storage, settings: { uploadOrigin: origin }, descriptorSha256, requireThat, URL,
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
  await assert.rejects(read({ kind:'original', descriptor:{ ...photo.workingFrame, schemaVersion:4 }, photo }), { code:'GRADING_IMAGE_REQUIRED' });
  await assert.rejects(read({ kind:'original', descriptor:{ ...photo.workingFrame, originalDescriptorSha256:'f'.repeat(64) }, photo }));
});
test('fallback frame grants retain the approved storage-origin restriction', async () => {
  const read = runtime({ createDecodedFrameRead:async()=>({url:'https://unapproved.example/photo.png'}) });
  await assert.rejects(read({kind:'original',descriptor:photo.workingFrame,photo}), {code:'MANUAL_UPLOAD_ORIGIN_MISMATCH'});
});
