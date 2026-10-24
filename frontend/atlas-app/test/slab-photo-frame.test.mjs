import test from 'node:test';
import assert from 'node:assert/strict';
import { INSPECTION_SLAB_FRAME, INSPECTION_SLAB_IMAGE_STYLE, slabPhotoFrame } from '../lib/slab-photo-frame.mjs';

test('only verified canonical inspection representations receive the slab viewport', () => {
  const sourceSha256 = 'a'.repeat(64), frame = INSPECTION_SLAB_FRAME.version;
  const full = { sourceSha256, representation: 'full', width: 1350, height: 1858 };
  assert.equal(slabPhotoFrame(full), frame);
  assert.equal(slabPhotoFrame({ sourceSha256, representation: 'preview', width: 558, height: 768 }), frame);
  for (const input of [null, {}, { ...full, sourceSha256: null }, { ...full, representation: undefined },
    { ...full, width: 1270, height: 1778 }, { ...full, representation: 'preview' },
    { ...full, representation: 'preview', width: 768, height: 558 }]) assert.equal(slabPhotoFrame(input), null);
});

test('the still viewport maps every canonical card edge exactly without losing printed border pixels', () => {
  const frame = INSPECTION_SLAB_FRAME, style = INSPECTION_SLAB_IMAGE_STYLE;
  for (const [offset, extent, start, end, full] of [
    [parseFloat(style.left) / 100, parseFloat(style.width) / 100, 40, 1310, frame.width],
    [parseFloat(style.top) / 100, parseFloat(style.height) / 100, 40, 1818, frame.height],
  ]) {
    assert.ok(Math.abs(offset + extent * start / full) < 1e-12);
    assert.ok(Math.abs(offset + extent * end / full - 1) < 1e-12);
  }
});
