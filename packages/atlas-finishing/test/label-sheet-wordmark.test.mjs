import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { buildLabelStyleFront, validateLabelStyleArtwork } from '../src/label-style-artwork.mjs';
import { shapeLabelStyleWordmark } from '../src/label-style-wordmark.mjs';
import { renderLabelExportSvg, renderLabelSheetSvg, LABEL_COLOR_EXPORT_PROFILE_V1, LABEL_COLOR_EXPORT_PROFILE_V2, LABEL_25_EXPORT_PROFILES } from '../src/label-sheet.mjs';
import { LABEL_JIG_V1 } from '../src/label-sheet-geometry.mjs';
import { LABEL_JIG_25, LABEL_25_CURRENT_PROFILE_DEFINITIONS } from '../src/label-sheet-25.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;

// Deterministic local alpha lettering with a counter: no provider or saved
// customer artifact is needed. Both PNGs and the descriptor pass real validation.
const width = 40, height = 20;
const raw = Buffer.alloc(width * height * 4, 255), preview = Buffer.alloc(width * height * 3, 255);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const ink = x >= 2 && x < 38 && y >= 2 && y < 18 && !(x >= 16 && x < 24 && y >= 7 && y < 13);
  raw[(y * width + x) * 4 + 3] = ink ? 255 : 0;
  if (ink) preview.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3);
}
const mask = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
const png = await sharp(preview, { raw: { width, height, channels: 3 } }).png().toBuffer();
const descriptor = {
  version: 'atlas-original-label-wordmark-v1', requestKey: `label-wordmark-generate:v1:${'b'.repeat(64)}`,
  sourceHash: 'a'.repeat(64), role: 'variant', text: 'ICE', ink: 'BLACK_ON_WHITE', mimeType: 'image/png',
  width, height, sha256: hash(png), byteCount: png.length,
  mask: { width, height, sha256: hash(mask), byteCount: mask.length, mimeType: 'image/png' },
  words: [{ text: 'ICE', start: 0, end: 3, x: 2, y: 2, width: 36, height: 16 }], normalizeWordInkHeight: false,
  provenance: { kind: 'ORIGINAL_GENERATED_LETTERING', sourceFontReproduced: false, fontMatchPercentageClaimed: false, ownershipClaimed: false },
};
descriptor.artifactHash = hash(canonical(descriptor));
const wordmark = { descriptor, pngBase64: png.toString('base64'), maskBase64: mask.toString('base64') };

function fixture(slot, inverted, baseColor) {
  const recipe = { text: 'ICE', role: 'variant', styleableSpans: [{ start: 0, end: 3 }], protectedSpans: [], normalizeWordInkHeight: false,
    spans: [{ start: 0, end: 3, baseColor, accentColor: '#ffffff', pattern: 'NONE', opticalScale: 1 }] };
  const shape = shapeLabelStyleWordmark({ text: 'ICE', recipe, wordmark, expectedSourceHash: descriptor.sourceHash,
    idPrefix: 'repeated-wordmark', outlineRadiusUnits: inverted ? 2 : 0 });
  const printSvg = buildLabelStyleFront({ title: 'Synthetic original lettering', primary: '', support: '', inverted,
    accents: `<g transform="translate(30,15) scale(.2,-.2)">${shape.paths}</g>`, defs: shape.defs });
  const item = { slot, printSvg, artworkHash: hash(printSvg), previewMaterial: 'gold' };
  assert.equal(validateLabelStyleArtwork(item), printSvg);
  return item;
}

const layouts = [
  { name: '50-position', profile: LABEL_COLOR_EXPORT_PROFILE_V2, slots: [1, 25, 50], frames: LABEL_JIG_V1.slots },
  ...[1, 2].map(page => ({ name: `25-position page ${page}`,
    profile: LABEL_25_CURRENT_PROFILE_DEFINITIONS.find(value => value.page === page && value.mode === 'color' && value.side === 'FRONT'),
    slots: [1, 7, 25].map(slot => slot + (page - 1) * 25), frames: LABEL_JIG_25.slots })),
];

test('retained color profiles keep their historical hashes while corrected profiles have distinct identities', () => {
  const historical = [
    [LABEL_COLOR_EXPORT_PROFILE_V1, 'e28716c367ac14fa3c05c9187861888f498234348d253fb1b8ae71c8966cff7c'],
    [LABEL_25_EXPORT_PROFILES.find(value => value.id === 'atlas-approved-b-jig25-page1-800ppi-color-front-v1'), '530c6eb9790c093e641925cb7670321d7c8ee57dd4d498fc9231a73de9217868'],
    [LABEL_25_EXPORT_PROFILES.find(value => value.id === 'atlas-approved-b-jig25-page2-800ppi-color-front-v1'), '1da6d889b5281ee14526d433e3b152ef010ede600d7a1a93c434cb8317399222'],
  ];
  for (const [index, [legacy, expectedHash]] of historical.entries()) {
    assert.equal(legacy.hash, expectedHash, 'hash captured from the source before the compositor repair');
    const current = index ? LABEL_25_EXPORT_PROFILES.find(value => value.id === layouts[index].profile.id) : LABEL_COLOR_EXPORT_PROFILE_V2;
    assert.notEqual(current.id, legacy.id);
    assert.notEqual(current.hash, legacy.hash);
    const item = fixture(index === 2 ? 26 : 1, true, '#92e2ff');
    for (const profile of [legacy, current]) {
      const svg = renderLabelSheetSvg([item], { color: true, exportProfileId: profile.id });
      assert.ok(svg.includes(`href="data:image/png;base64,${wordmark.maskBase64}"`), 'both profile generations preserve the saved alpha-mask bytes');
    }
  }
});
const inner = svg => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
const frameFor = (layout, slot) => layout.frames[layout.profile.page ? (slot - 1) % 25 : slot - 1];
function point(frame, x, y) {
  return frame.rotationDeg === 90 ? [frame.xMm + frame.widthMm - y, frame.yMm + x] : [frame.xMm + x, frame.yMm + y];
}
function viewport(frame) {
  const corners = [point(frame, 29, 10), point(frame, 39, 16)];
  return { x: Math.min(...corners.map(p => p[0])), y: Math.min(...corners.map(p => p[1])),
    width: frame.rotationDeg === 90 ? 6 : 10, height: frame.rotationDeg === 90 ? 10 : 6 };
}
async function raster(svg, box) {
  // Keep the complete composed SVG and its actual transforms/definitions, but
  // rasterize only the wordmark viewport (at most400×240), never a full jig.
  const cropped = svg.replace(/^<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width * 40}" height="${box.height * 40}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}">`);
  return sharp(Buffer.from(cropped)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
function pixel(result, box, frame, x, y) {
  const p = point(frame, x, y), left = Math.floor((p[0] - box.x) * 40), top = Math.floor((p[1] - box.y) * 40);
  const at = (top * result.info.width + left) * 4;
  return [...result.data.subarray(at, at + 4)];
}

for (const layout of layouts) {
  test(`${layout.name}: every local fragment belongs to its label and embedded PNGs stay intact`, () => {
    const items = layout.slots.map((slot, index) => fixture(slot, true, index % 2 ? '#ff4b2f' : '#92e2ff'));
    const svg = renderLabelSheetSvg(items, { color: true, exportProfileId: layout.profile.id });
    const allIds = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(allIds).size, allIds.length, 'every definition has a unique sheet ID');
    const groups = svg.split(/<g data-slot="\d+" transform="[^"]+">/).slice(1);
    assert.equal(groups.length, items.length);
    for (const [index, group] of groups.entries()) {
      const ids = new Set([...group.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
      const refs = [...group.matchAll(/\bhref="#([^"]+)"|url\(#([^)]+)\)/g)].map(match => match[1] ?? match[2]);
      assert.ok(refs.length >= 5, 'exercises image uses, masks and outline filter');
      for (const ref of refs) assert.ok(ids.has(ref), `slot ${items[index].slot} has unbound local reference ${ref}`);
      assert.ok(group.includes(`href="data:image/png;base64,${wordmark.maskBase64}"`), 'embedded alpha-mask bytes are preserved');
    }
  });

  for (const inverted of [false, true]) test(`${layout.name}: ${inverted ? 'outlined foil' : 'black field'} wordmark pixels match individual artwork`, async () => {
    const items = layout.slots.map((slot, index) => fixture(slot, inverted, index % 2 ? '#ff4b2f' : '#92e2ff'));
    const sheet = renderLabelSheetSvg(items, { color: true, exportProfileId: layout.profile.id });
    for (const [index, item] of items.entries()) {
      const frame = frameFor(layout, item.slot), box = viewport(frame);
      // Place the original export independently of the sheet compositor and its
      // ID rewriting. Both use identical sheet coordinates to avoid resampling.
      const translation = point(frame, 0, 0);
      const reference = `<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(${translation.join(',')}) rotate(${frame.rotationDeg})">${inner(renderLabelExportSvg(item, { color: true }))}</g></svg>`;
      const expected = await raster(reference, box), actual = await raster(sheet, box);
      const fill = index % 2 ? [255, 75, 47, 255] : [146, 226, 255, 255];
      assert.deepEqual(pixel(expected, box, frame, 31.5, 12), fill, 'individual contains the expected original-lettering color');
      assert.notDeepEqual(pixel(expected, box, frame, 34, 13), fill, 'individual counter stays open');
      if (inverted) {
        const outline = pixel(expected, box, frame, 30.2, 13);
        const field = pixel(expected, box, frame, 29.8, 13);
        assert.equal(outline[3], 255);
        assert.ok(outline.slice(0, 3).reduce((a, b) => a + b) < field.slice(0, 3).reduce((a, b) => a + b) / 2,
          'individual has a dark outline beyond the colored mask, allowing edge antialiasing');
      }
      assert.deepEqual(pixel(actual, box, frame, 31.5, 12), fill, `slot ${item.slot} retains colored lettering`);
      assert.ok(actual.data.equals(expected.data), `slot ${item.slot}, rotation ${frame.rotationDeg}: every fill/counter/outline/field pixel matches the individual`);
    }
  });
}
