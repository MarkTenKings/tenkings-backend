import test from 'node:test';
import assert from 'node:assert/strict';
import { createInflate } from 'node:zlib';
import { Readable } from 'node:stream';
import { renderApprovedBLabel } from '../src/label-approved-b.mjs';
import { renderLabelSheetPng, LABEL_BLACK_INK_EXPORT_PROFILE_V1 } from '../src/label-sheet.mjs';
import { LABEL_JIG_V1 } from '../src/label-sheet-geometry.mjs';

async function* pngRows(bytes) {
  const chunks = [], stride = 9764 * 4 + 1;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  let pending = Buffer.alloc(0);
  for await (const chunk of Readable.from(chunks).pipe(createInflate())) {
    pending = Buffer.concat([pending, chunk]); let offset = 0;
    while (pending.length - offset >= stride) {
      assert.equal(pending[offset], 0);
      yield pending.subarray(offset + 1, offset + stride); offset += stride;
    }
    pending = Buffer.from(pending.subarray(offset));
  }
  assert.equal(pending.length, 0);
}

const items = () => Array.from({ length: 50 }, (_, i) => ({ slot: i + 1,
  ...renderApprovedBLabel({ identity: { playerName: 'Kobe Bryant', year: '1996–97', manufacturer: 'Topps', productSet: 'Basketball', cardNumber: '138' },
    finalGrade: 1 + (i % 10), reportNumber: `ATLAS-${String(i + 1).padStart(12, '0')}`, approvalVersion: 1, cardProfile: 'SPORTS' }) }));

test('full approved-B sheets cache bounded final-grid frames and match partial sheets at every pixel', async () => {
  const all = items(), options = { exportProfileId: LABEL_BLACK_INK_EXPORT_PROFILE_V1.id };
  assert(all.every(item => item.state === 'READY')); assert.equal(new Set(all.map(item => item.artworkHash)).size, 50);
  const full = await renderLabelSheetPng(all, options), receipt = full.manifest.rasterReceipt;
  assert.equal(receipt.frameStrategy, 'approved-b-final-grid-frame-cache-v1');
  assert.equal(receipt.rasterizedFrames, 50); assert.equal(receipt.rasterizedTiles, 0);
  assert.equal(receipt.maxRasterTileBytes, 0); assert(receipt.maxRasterFrameBytes <= 640 * 2160 * 4);
  assert(receipt.maxCachedFrames <= 10); assert(receipt.maxCachedFrameBytes <= 10 * 640 * 2160 * 4);
  assert.deepEqual(receipt.frameLimits, { width: 640, height: 2160, count: 10 });
  assert(receipt.elapsedMs < 180000); assert(receipt.peakRssBytes < 1024 ** 3);
  assert.deepEqual([full.manifest.pixelWidth, full.manifest.pixelHeight, full.manifest.intendedImportWidthMm, full.manifest.intendedImportHeightMm], [9764, 12598, 310, 400]);
  assert.equal(receipt.blackInkOnly, true); assert.equal(receipt.alphaBinary, true);
  const positions = [1, 10, 11, 25, 40, 41, 50];
  const partial = await renderLabelSheetPng(all.filter(item => positions.includes(item.slot)), options);
  assert.equal(partial.manifest.rasterReceipt.rasterizedFrames, positions.length);
  const frames = positions.map(slot => LABEL_JIG_V1.slots[slot - 1]).map(frame => ({
    left: Math.floor(frame.xMm * 9764 / 310) - 1, right: Math.ceil((frame.xMm + frame.widthMm) * 9764 / 310) + 1,
    top: Math.floor(frame.yMm * 12598 / 400) - 1, bottom: Math.ceil((frame.yMm + frame.heightMm) * 12598 / 400) + 1,
  }));
  const expectedRow = Buffer.alloc(9764 * 4), fullRows = pngRows(full.bytes), partialRows = pngRows(partial.bytes); let row = 0;
  for (;;) {
    const [actual, selected] = await Promise.all([fullRows.next(), partialRows.next()]);
    assert.equal(actual.done, selected.done); if (actual.done) break;
    expectedRow.fill(0);
    for (const frame of frames) if (row >= frame.top && row < frame.bottom) actual.value.copy(expectedRow, frame.left * 4, frame.left * 4, frame.right * 4);
    assert(expectedRow.equals(selected.value), `partial row ${row} must preserve occupied frames and keep every unused pixel transparent`);
    for (let i = 0; i < actual.value.length; i += 4) {
      if (actual.value[i] || actual.value[i + 1] || actual.value[i + 2] || ![0, 255].includes(actual.value[i + 3])) assert.fail(`nonbinary black ink at row ${row}`);
    }
    row += 1;
  }
  assert.equal(row, 12598);
  console.log(JSON.stringify({ qualification: 'APPROVED_B_FRAME_CACHE', fullSha256: full.sha256, partialSha256: partial.sha256, receipt }));
});
