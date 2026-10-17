import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInflate } from 'node:zlib';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { renderLabelV4, renderLabelV4Png } from '../src/label-v4.mjs';
import { renderLabelBlackInkSvg, renderLabelBlackInkPreviewSvg, renderLabelSheetSvg, renderLabelSheetPng,
  validateLabelV4Artwork, LABEL_EXPORT_PROFILE_V1, LABEL_INDIVIDUAL_EXPORT_PROFILE_V1,
  LABEL_BLACK_INK_EXPORT_PROFILE_V1, LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1 } from '../src/label-sheet.mjs';
import { LABEL_JIG_V1, labelPointOnSheet } from '../src/label-sheet-geometry.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const label = (category, grade = 8.5) => renderLabelV4({
  identity: category === 'SPORTS'
    ? { playerName: 'Kobe Bryant', year: '1996–97', manufacturer: 'Topps', productSet: 'Basketball', cardNumber: '138' }
    : { cardName: 'Sylveon ex', year: '2024', manufacturer: 'The Pokémon Company International', productSet: 'Scarlet & Violet—Surging Sparks', cardNumber: '086/191', parallel: 'English Holofoil' },
  finalGrade: grade, reportNumber: 'ATLAS-0123456789AB', approvalVersion: 1, cardProfile: category,
}, { previewMaterial: category === 'SPORTS' ? 'gold' : 'holo' });
const singleOptions = { exportProfileId: LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1.id };
const sheetOptions = { exportProfileId: LABEL_BLACK_INK_EXPORT_PROFILE_V1.id };
function physical(bytes, width, height, mmWidth, mmHeight) {
  assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
  const index = bytes.indexOf(Buffer.from('pHYs')); assert(index > 0);
  assert.equal(bytes.readUInt32BE(index + 4), Math.round(width / (mmWidth / 1000)));
  assert.equal(bytes.readUInt32BE(index + 8), Math.round(height / (mmHeight / 1000))); assert.equal(bytes[index + 12], 1);
}
async function* rows(bytes, width) {
  const chunks = [], stride = width * 4 + 1;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  let pending = Buffer.alloc(0);
  for await (const chunk of Readable.from(chunks).pipe(createInflate())) {
    pending = Buffer.concat([pending, chunk]); let offset = 0;
    while (pending.length - offset >= stride) { assert.equal(pending[offset], 0); yield pending.subarray(offset + 1, offset + stride); offset += stride; }
    pending = Buffer.from(pending.subarray(offset));
  }
  assert.equal(pending.length, 0);
}

test('black export derives metadata and gray fingerprint knockouts without changing source artwork, masks, or grade', () => {
  for (const category of ['SPORTS', 'POKEMON']) for (const grade of [7.5, 8.5, 9, 9.5, 10]) {
    const original = label(category, grade), before = structuredClone(original), derived = renderLabelBlackInkSvg(original);
    const defs = original.printSvg.match(/<defs>([^]*?)<\/defs>/)[1];
    assert(derived.includes(`<defs>${defs}<mask id="black-ink-detail-knockouts"`));
    const metadata = original.printSvg.match(/<g data-part="metadata" fill="white">([^]*)<\/g><\/g><\/svg>$/)[1];
    assert(derived.includes(`<g data-part="metadata" fill="black">${metadata}</g>`));
    assert.equal((derived.match(/color="black"/g) ?? []).length, (original.printSvg.match(/color="black"/g) ?? []).length + 1);
    assert(!derived.includes('color="#353535"')); assert(!derived.includes('data-part="metadata" fill="white"'));
    assert.deepEqual(original, before); assert.equal(sha(original.printSvg), original.artworkHash);
    assert.equal(derived, renderLabelBlackInkSvg(original));
    const previews = ['gold', 'holo'].map(previewMaterial => renderLabelBlackInkPreviewSvg(original, { previewMaterial }));
    for (const preview of previews) {
      assert(preview.includes('data-atlas-artwork="PREVIEW_ONLY"')); assert(preview.includes(derived.match(/<mask id="black-ink-detail-knockouts"[^]*?<\/mask>/)[0]));
      assert.throws(() => validateLabelV4Artwork({ printSvg: preview, artworkHash: sha(preview) }), /ARTWORK_INVALID/);
    }
    assert.notEqual(previews[0], previews[1]);
  }
  assert.notEqual(LABEL_BLACK_INK_EXPORT_PROFILE_V1.hash, LABEL_EXPORT_PROFILE_V1.hash);
  assert.notEqual(LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1.hash, LABEL_INDIVIDUAL_EXPORT_PROFILE_V1.hash);
  assert.throws(() => renderLabelBlackInkSvg({ ...label('SPORTS'), artworkHash: '0'.repeat(64) }), /ARTWORK_INVALID/);
  assert.throws(() => renderLabelBlackInkPreviewSvg(label('SPORTS'), { previewMaterial: 'white' }), /MATERIAL_INVALID/);
});

test('black-only individual PNG contains only solid black/clear, keeps physical cuts and reveals all solid white/gray source details', async () => {
  for (const category of ['SPORTS', 'POKEMON']) {
    const original = label(category), old = await renderLabelV4Png(original), result = await renderLabelV4Png(original, singleOptions);
    physical(result.bytes, 6458, 1898, 68.342, 20.082);
    assert.equal(result.manifest.exportProfileId, singleOptions.exportProfileId); assert.equal(result.manifest.artworkHash, original.artworkHash);
    assert.equal(result.manifest.printMode, 'BLACK_INK_TRANSPARENT'); assert.equal(result.manifest.rasterReceipt.blackInkOnly, true);
    assert.equal(result.manifest.intendedImportWidthMm, 68.342); assert.equal(result.manifest.intendedImportHeightMm, 20.082);
    const [before, after] = await Promise.all([old, result].map(x => sharp(x.bytes).ensureAlpha().raw().toBuffer()));
    let whiteReveals = 0, grayReveals = 0, opaque = 0;
    for (let i = 0; i < after.length; i += 4) {
      if (after[i] || after[i + 1] || after[i + 2] || ![0, 255].includes(after[i + 3])) assert.fail(`nonbinary black/clear pixel ${i / 4}`);
      if (!before[i + 3]) assert.equal(after[i + 3], 0, 'every existing transparent cut/foil pixel stays clear');
      // White glyph edges can also rasterize to RGB53. Left of the text area,
      // RGB53 unambiguously identifies the original solid fingerprint stroke.
      const sourceDetail = before[i] === 255 || before[i] === 53 && (i / 4 % 6458) * 68.342 / 6458 < 15.8;
      if (before[i + 3] === 255 && sourceDetail && before[i] === before[i + 1] && before[i] === before[i + 2]) {
        assert.equal(after[i + 3], 0, 'solid gray fingerprint and white metadata geometry become foil reveals');
        before[i] === 255 ? whiteReveals++ : grayReveals++;
      }
      if (after[i + 3]) opaque++;
    }
    assert(whiteReveals > 1000); assert(grayReveals > 1000); assert(opaque > 1_000_000);
    const pixelAlpha = (x, y) => after[(Math.floor(y / 20.082 * 1898) * 6458 + Math.floor(x / 68.342 * 6458)) * 4 + 3];
    for (const x of [47, 49, 51.25, 53, 55]) assert.equal(pixelAlpha(x, 10.041), 0);
    assert.equal(pixelAlpha(44.7, 12), 255); assert.equal(pixelAlpha(0, 0), 0);
    if (category === 'POKEMON') assert.deepEqual((await renderLabelV4Png(original, singleOptions)).bytes, result.bytes);
  }
  await assert.rejects(renderLabelV4Png(label('SPORTS'), sheetOptions), /PROFILE_INVALID/);
});

test('black-only full jig and partial exports preserve all 50 placements, binary pixels, unused margins, pHYs and strip seams', async () => {
  const labels = [label('SPORTS', 9.5), label('POKEMON', 8.5)], items = Array.from({ length: 50 }, (_, i) => ({ ...labels[i % 2], slot: i + 1 }));
  const full = await renderLabelSheetPng(items, sheetOptions), partial = await renderLabelSheetPng([items[0], items[49]], sheetOptions);
  physical(full.bytes, 9764, 12598, 310, 400); physical(partial.bytes, 9764, 12598, 310, 400);
  assert.equal(full.manifest.exportProfileId, sheetOptions.exportProfileId); assert.equal(full.manifest.printMode, 'BLACK_INK_TRANSPARENT');
  assert.equal(full.manifest.intendedImportWidthMm, 310); assert.equal(full.manifest.intendedImportHeightMm, 400);
  assert.deepEqual(full.manifest.orderedArtwork, items.map(({ slot, artworkHash }) => ({ slot, artworkHash })));
  assert(full.manifest.rasterReceipt.maxRasterTileBytes <= 640 * 256 * 4); assert(full.manifest.rasterReceipt.peakRssBytes < 512 * 1024 * 1024);
  const frames = [LABEL_JIG_V1.slots[0], LABEL_JIG_V1.slots[49]].map(frame => ({ left: Math.floor(frame.xMm * 9764 / 310) - 1,
    right: Math.ceil((frame.xMm + frame.widthMm) * 9764 / 310) + 1, top: Math.floor(frame.yMm * 12598 / 400) - 1, bottom: Math.ceil((frame.yMm + frame.heightMm) * 12598 / 400) + 1 }));
  const points = items.flatMap(({ slot }) => [[44.7, 12, 255], [51.25, 10.041, 0]].map(([x, y, alpha]) => {
    const p = labelPointOnSheet(slot, x, y); return { x: Math.floor(p.xMm * 9764 / 310), y: Math.floor(p.yMm * 12598 / 400), alpha };
  }));
  const fullRows = rows(full.bytes, 9764), partialRows = rows(partial.bytes, 9764), expected = Buffer.alloc(9764 * 4); let y = 0;
  for (;;) {
    const [f, p] = await Promise.all([fullRows.next(), partialRows.next()]); assert.equal(f.done, p.done); if (f.done) break;
    expected.fill(0); for (const frame of frames) if (y >= frame.top && y < frame.bottom) f.value.copy(expected, frame.left * 4, frame.left * 4, frame.right * 4);
    assert(expected.equals(p.value), `partial row ${y} preserves the identical selected-slot pixels through every strip seam`);
    for (let x = 0; x < f.value.length; x += 4) if (f.value[x] || f.value[x + 1] || f.value[x + 2] || ![0, 255].includes(f.value[x + 3])) assert.fail(`nonbinary black/clear sheet pixel ${x / 4},${y}`);
    for (const point of points.filter(p => p.y === y)) assert.equal(f.value[point.x * 4 + 3], point.alpha);
    assert.equal(f.value[3], 0); assert.equal(f.value[f.value.length - 1], 0); y++;
  }
  assert.equal(y, 12598);
  const svg = renderLabelSheetSvg([items[0], items[49]], { blackInkTransparent: true });
  assert(svg.includes('id="s1-black-ink-detail-knockouts"')); assert(svg.includes('url(#s50-black-ink-detail-knockouts)'));
  await assert.rejects(renderLabelSheetPng([items[0]], singleOptions), /PROFILE_INVALID/);
});
