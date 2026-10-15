import test from 'node:test';
import assert from 'node:assert/strict';
import { createInflate } from 'node:zlib';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { renderLabelV4 } from '../src/label-v4.mjs';
import { renderLabelSheetPng, LABEL_EXPORT_PROFILE_V1 } from '../src/label-sheet.mjs';
import { LABEL_JIG_V1, labelPointOnSheet } from '../src/label-sheet-geometry.mjs';

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

test('partial 800 ppi export retains the full canvas and exact first/last clockwise slot coordinates', async () => {
  const label = renderLabelV4({ identity: { playerName: 'Kobe Bryant', year: '1996–97', manufacturer: 'Topps', productSet: 'Basketball', cardNumber: '138' },
    finalGrade: 9.5, reportNumber: 'ATLAS-0123456789AB', approvalVersion: 1, cardProfile: 'SPORTS' });
  const result = await renderLabelSheetPng([{ ...label, slot: 50 }, { ...label, slot: 1 }]);
  assert.equal(result.manifest.pixelWidth, 9764); assert.equal(result.manifest.pixelHeight, 12598);
  assert.equal(result.manifest.intendedImportWidthMm, 310); assert.equal(result.manifest.intendedImportHeightMm, 400);
  assert.equal(result.manifest.cropXmm, 0); assert.equal(result.manifest.cropYmm, 0);
  assert.equal(result.manifest.intendedImportXmm, null); assert.equal(result.manifest.intendedImportYmm, null);
  assert.equal(result.manifest.exportProfileId, LABEL_EXPORT_PROFILE_V1.id);
  assert.deepEqual(result.manifest.orderedArtwork.map(item => item.slot), [1, 50]);
  const metadata = await sharp(result.bytes).metadata(); assert.equal(metadata.width, 9764); assert.equal(metadata.height, 12598);
  async function alphaAt(xMm, yMm) {
    const left = Math.floor(xMm / 310 * metadata.width), top = Math.floor(yMm / 400 * metadata.height);
    const data = await sharp(result.bytes, { sequentialRead: true }).extract({ left, top, width: 1, height: 1 }).ensureAlpha().raw().toBuffer();
    return data[3];
  }
  for (const slot of [1, 50]) {
    const ink = labelPointOnSheet(slot, 44.7, 12), hole = labelPointOnSheet(slot, 51.25, 10.041);
    assert.equal(await alphaAt(ink.xMm, ink.yMm), 255); assert.equal(await alphaAt(hole.xMm, hole.yMm), 0);
  }
  const empty = labelPointOnSheet(25, 44.7, 12); assert.equal(await alphaAt(empty.xMm, empty.yMm), 0);
  assert.equal(await alphaAt(1, 1), 0); assert.equal(await alphaAt(309, 399), 0);
  await assert.rejects(renderLabelSheetPng([{ ...label, slot: 1 }], { exportProfileId: 'unqualified-2400-ppi-full-plate' }), /PROFILE_INVALID/);
  await assert.rejects(renderLabelSheetPng([{ ...label, slot: 1 }], { calibrationProfile: { hash: 'a'.repeat(64), anchor: 'CENTER', originXmm: 0, originYmm: 0 } }), /CALIBRATION_INVALID/);
});

// This corpus covers every accepted grade in both categories, long accepted
// names/metadata and full twelve-hex certificates. The mixed-sheet golden
// includes the approved compact 8.5/9.5 typography. Unaffected individual
// fixtures retain their original strip-renderer byte goldens below.
function mixedSheet() {
  return Array.from({ length: 50 }, (_, i) => {
    const cardProfile = i % 2 ? 'POKEMON' : 'SPORTS';
    const identity = i % 2
      ? { cardName: 'Alolan Exeggutor', year: '2024', productSet: 'Scarlet & Violet', cardNumber: '242', parallel: 'Holo' }
      : { playerName: 'Alexander Ovechkin', year: '2023–24', manufacturer: 'Upper Deck', productSet: 'Hockey', cardNumber: '138' };
    const item = { slot: i + 1, ...renderLabelV4({ identity, finalGrade: 1 + (i % 19) * 0.5,
      reportNumber: `ATLAS-${'F'.repeat(10)}${i.toString(16).toUpperCase().padStart(2, '0')}`, approvalVersion: 1, cardProfile },
    { previewMaterial: i % 2 ? 'holo' : 'gold' }) };
    assert.equal(item.state, 'READY');
    return item;
  });
}

test('bounded clipped strips preserve the mixed 50-label golden and original unaffected individual bytes', async () => {
  const { renderLabelV4Png, LABEL_INDIVIDUAL_EXPORT_PROFILE_V1 } = await import('../src/label-sheet.mjs');
  const items = mixedSheet();
  for (const category of ['SPORTS', 'POKEMON']) assert.equal(new Set(items.filter(item => item.source.cardProfile === category).map(item => item.source.finalGrade)).size, 19);
  const result = await renderLabelSheetPng(items);
  assert.equal(result.sha256, '9091008d13d8ac37bc1c37cb1d0534daeaa15dc17753012b6e6812f59d2afc62');
  assert.equal(result.manifest.exportProfileId, 'atlas-v4-sheet-800ppi-diagnostic-v2');
  assert.equal(result.manifest.rasterReceipt.rasterizer, 'sharp-0.33.5-clipped-strip-png-v2');
  assert.ok(result.manifest.rasterReceipt.rasterizedTiles > 50);
  assert.ok(result.manifest.rasterReceipt.maxRasterTileBytes <= 640 * 256 * 4);
  assert.ok(result.manifest.rasterReceipt.peakRssBytes < 512 * 1024 * 1024);
  const partial = await renderLabelSheetPng([items[0], items[49]]), fullRows = pngRows(result.bytes), partialRows = pngRows(partial.bytes);
  const frames = [LABEL_JIG_V1.slots[0], LABEL_JIG_V1.slots[49]].map(frame => ({
    left: Math.floor(frame.xMm * 9764 / 310) - 1, right: Math.ceil((frame.xMm + frame.widthMm) * 9764 / 310) + 1,
    top: Math.floor(frame.yMm * 12598 / 400) - 1, bottom: Math.ceil((frame.yMm + frame.heightMm) * 12598 / 400) + 1,
  }));
  const expectedRow = Buffer.alloc(9764 * 4); let row = 0;
  for (;;) {
    const [full, selected] = await Promise.all([fullRows.next(), partialRows.next()]);
    assert.equal(full.done, selected.done); if (full.done) break;
    expectedRow.fill(0);
    for (const frame of frames) if (row >= frame.top && row < frame.bottom) full.value.copy(expectedRow, frame.left * 4, frame.left * 4, frame.right * 4);
    assert.ok(expectedRow.equals(selected.value), `partial row ${row}: retained slots are identical; every unused pixel is transparent`);
    for (let offset = 3; offset < full.value.length; offset += 4) {
      const alpha = full.value[offset];
      if (alpha !== 0 && alpha !== 255) assert.fail(`nonbinary alpha at row ${row}`);
    }
    row += 1;
  }
  assert.equal(row, 12598);
  assert.equal(LABEL_INDIVIDUAL_EXPORT_PROFILE_V1.rasterizer, 'sharp-0.33.5-strip-png-v1');
  assert.equal(LABEL_INDIVIDUAL_EXPORT_PROFILE_V1.version, 1);
  for (const [index, expected] of [[0, '87190ba49a5a5882f0432a32df83fc857a4e472fbc576cdcf9e272b3a6015803'],
    [1, '8de8d059aca7d4a961c5b42178d1c4f7dc9306aacf5c5e506b630a1019bfc04f']]) {
    const individual = await renderLabelV4Png(items[index]);
    assert.equal(individual.sha256, expected, '2400ppi individual bytes remain identical to the original worker');
    assert.equal(individual.manifest.rasterReceipt.rasterizedTiles, 0);
  }
});
