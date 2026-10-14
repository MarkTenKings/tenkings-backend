import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderLabelV4 } from '../src/label-v4.mjs';
import { renderLabelSheetPng, LABEL_EXPORT_PROFILE_V1 } from '../src/label-sheet.mjs';
import { labelPointOnSheet } from '../src/label-sheet-geometry.mjs';

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
