import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { renderLabelV4, fitLabelV4Name, renderLabelV4Png, LABEL_V4_RENDERER_PROFILE_HASH } from '../src/label-v4.mjs';
import { LABEL_JIG_V1, labelPointOnSheet, labelSlotTransform } from '../src/label-sheet-geometry.mjs';
import { LABEL_EXPORT_PROFILE_V1, renderLabelSheetSvg, validateLabelV4Artwork } from '../src/label-sheet.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const fixture = (overrides = {}) => ({ identity: { playerName: 'Kobe Bryant', year: '1996–97', manufacturer: 'Topps', productSet: 'Basketball', cardNumber: '138', parallel: null, insert: null },
  finalGrade: 9.5, reportNumber: 'ATLAS-0123456789AB', approvalVersion: 1, cardProfile: 'SPORTS', ...overrides });
function part(svg, name) {
  const start = svg.indexOf(`<g data-part="${name}"`); assert.ok(start >= 0);
  const tags = /<\/?g\b[^>]*>/g; tags.lastIndex = start; let depth = 0, token;
  while ((token = tags.exec(svg))) { depth += token[0].startsWith('</') ? -1 : 1; if (!depth) return svg.slice(start, tags.lastIndex); }
  throw new Error('UNBALANCED_GROUP');
}

test('pinned fonts reproduce supplied V4 specimen headline metrics and overflow decisions', () => {
  const sports = fitLabelV4Name('KOBE BRYANT'), pokemon = fitLabelV4Name('ALAKAZAM');
  assert.deepEqual(sports.lines, ['KOBE', 'BRYANT']);
  assert.ok(Math.abs(sports.widthsMm[0] - 14.599366110028821) < 0.003);
  assert.ok(Math.abs(sports.widthsMm[1] - 22.78783630371094) < 0.003);
  assert.ok(Math.abs(pokemon.inkHeightMm - 3.21303) < 0.0001);
  for (const name of ['VICTOR WEMBANYAMA', 'GIANNIS ANTETOKOUNMPO']) assert.equal(fitLabelV4Name(name).state, 'NEEDS_LAYOUT');
  const accented = renderLabelV4(fixture({ identity: { ...fixture().identity, playerName: 'José Ramírez' } }));
  assert.equal(accented.state, 'READY'); assert.deepEqual(accented.diagnostics.name.lines, ['JOSÉ', 'RAMÍREZ']);
});

test('complete source and explicit domain attention survive long fields and unsupported glyphs', () => {
  for (const [field, value, code] of [['playerName', 'Giannis Antetokounmpo', 'NAME_OVERFLOW'], ['playerName', '皮卡丘', 'UNSUPPORTED_GLYPH'],
    ['productSet', 'Very long exact confirmed product name '.repeat(8), 'METADATA_OVERFLOW']]) {
    const input = fixture({ identity: { ...fixture().identity, [field]: value } }), result = renderLabelV4(input);
    assert.equal(result.state, 'NEEDS_LAYOUT'); assert.equal(result.diagnostics.code, code);
    assert.deepEqual(result.source, input); assert.equal(result.printSvg, undefined);
  }
  const input = fixture({ reportNumber: `ATLAS-${'A'.repeat(80)}` });
  const cert = renderLabelV4(input); assert.equal(cert.state, 'NEEDS_LAYOUT'); assert.equal(cert.diagnostics.code, 'CERTIFICATE_OVERFLOW'); assert.equal(cert.source.reportNumber, input.reportNumber);
});

test('all whole and half grades are distinct paths with full certificate and no inferred rookie', () => {
  const hashes = new Set();
  for (let grade = 1; grade <= 10; grade += 0.5) {
    const result = renderLabelV4(fixture({ finalGrade: grade })); assert.equal(result.state, 'READY');
    assert.equal(result.source.finalGrade, grade); assert.equal(result.rendererProfileHash, LABEL_V4_RENDERER_PROFILE_HASH);
    assert.equal(result.diagnostics.certificate.text, 'ATLAS-0123456789AB · V1');
    assert.equal(result.diagnostics.certificate.layout, 'full-cert-arc-v1');
    assert.ok(result.diagnostics.certificate.inkHeightMm >= 0.85);
    assert.ok(!result.diagnostics.metadata.text.includes('ROOKIE'));
    hashes.add(sha(part(result.printSvg, 'grade'))); validateLabelV4Artwork(result);
    assert.ok(!/<text\b|<image\b|<linearGradient\b/.test(result.printSvg));
    assert.ok(result.previewSvg.includes('PREVIEW_ONLY')); assert.ok(result.previewSvg.includes('linearGradient'));
  }
  assert.equal(hashes.size, 19);
  for (const digit of '0123456789ABCDEF') {
    const result = renderLabelV4(fixture({ reportNumber: `ATLAS-${digit.repeat(12)}` }));
    assert.equal(result.state, 'READY', `complete twelve-${digit} certificate fits at version one`);
    assert.ok(result.diagnostics.certificate.inkHeightMm >= 0.85);
  }
  assert.throws(() => renderLabelV4(fixture({ finalGrade: 9.7 })), /SOURCE_INVALID/);
});

test('material simulation is independent of grade and cannot become print input', () => {
  const gold = renderLabelV4(fixture(), { previewMaterial: 'gold' }), holo = renderLabelV4(fixture(), { previewMaterial: 'holo' });
  assert.equal(gold.printSvg, holo.printSvg); assert.equal(gold.artworkHash, holo.artworkHash); assert.notEqual(gold.previewSvg, holo.previewSvg);
  assert.throws(() => validateLabelV4Artwork({ printSvg: gold.previewSvg, artworkHash: sha(gold.previewSvg) }), /ARTWORK_INVALID/);
  const unsafe = gold.printSvg.replace('</svg>', '<image href="https://example.com/image"/></svg>');
  assert.throws(() => validateLabelV4Artwork({ printSvg: unsafe, artworkHash: sha(unsafe) }), /ARTWORK_INVALID/);
});

test('dynamic certificate, name, grade and metadata stay entirely clear of all original physical cuts', async () => {
  const vectors = JSON.parse(readFileSync(new URL('../assets/v4/vector-parts.json', import.meta.url)));
  const label = renderLabelV4(fixture());
  for (const name of ['name', 'grade', 'certificate', 'metadata', 'caption']) {
    const component = part(label.printSvg, name);
    const svg = (clipped) => `<svg xmlns="http://www.w3.org/2000/svg" width="68.342mm" height="20.082mm" viewBox="0 0 68.342 20.082"><defs>${vectors.clips}</defs><g fill="white" ${clipped ? 'clip-path="url(#body)"' : ''}>${component}</g></svg>`;
    const images = await Promise.all([false, true].map(clipped => sharp(Buffer.from(svg(clipped)), { density: 600 }).ensureAlpha().raw().toBuffer()));
    let maximumLoss = 0;
    for (let i = 3; i < images[0].length; i += 4) maximumLoss = Math.max(maximumLoss, images[0][i] - images[1][i]);
    // librsvg's additional clip changes glyph-edge antialiasing by up to 10/255
    // even far from the cuts. A real cut removes opaque interior pixels.
    assert.ok(maximumLoss <= 16, `${name} must not silently clip a glyph into a physical opening (loss ${maximumLoss})`);
  }
});

test('jig retains CAD hashes, all 50 exact integer frames, clockwise landmarks and partial positions', () => {
  assert.equal(LABEL_JIG_V1.capacity, 50); assert.equal(LABEL_JIG_V1.dxfHash, '8d734d44a2c64aa760acfa851294b767c2ae5065ce8e46cb1ca0df830a53fdd2');
  assert.equal(sha(readFileSync(new URL('../assets/jigs/ATLAS_50_LABEL_JIG_NOMINAL_MM.dxf', import.meta.url))), LABEL_JIG_V1.dxfHash);
  assert.equal(sha(readFileSync(new URL('../assets/jigs/Atlas_Noir_II_SINGLE_CUT_UNCHANGED.dxf', import.meta.url))), LABEL_JIG_V1.blankCutHash);
  for (const frame of LABEL_JIG_V1.slots) {
    const i = frame.slot - 1; assert.equal(frame.xUm, 36590 + 24082 * (i % 10)); assert.equal(frame.yUm, 21145 + 72342 * Math.floor(i / 10));
    assert.equal(frame.xMm, frame.xUm / 1000); assert.equal(frame.yMm, frame.yUm / 1000);
    assert.equal(frame.rotationDeg, 90); assert.equal(frame.widthMm, 20.082); assert.equal(frame.heightMm, 68.342);
    assert.deepEqual(labelPointOnSheet(frame.slot, 0, 0), { xMm: (frame.xUm + 20082) / 1000, yMm: frame.yUm / 1000 });
  }
  const art = renderLabelV4(fixture()); const svg = renderLabelSheetSvg([{ ...art, slot: 50 }, { ...art, slot: 1 }]);
  assert.ok(svg.includes(labelSlotTransform(50))); assert.ok(svg.includes('width="310mm" height="400mm"')); assert.ok(!svg.includes('data-slot="2"'));
  assert.ok(svg.indexOf('data-slot="1"') < svg.indexOf('data-slot="50"')); assert.ok(svg.includes('url(#s50-ink)'));
  assert.throws(() => renderLabelSheetSvg([{ ...art, slot: 1 }, { ...art, slot: 1 }]), /SLOT_INVALID/);
  assert.equal(LABEL_EXPORT_PROFILE_V1.pixelHeight, 12598); assert.ok(LABEL_EXPORT_PROFILE_V1.pixelHeight <= 12800);
});

test('individual 2400 ppi PNG has binary alpha, original NFC clearance, pHYs and reproducible bytes', async () => {
  const label = renderLabelV4(fixture()), first = await renderLabelV4Png(label), second = await renderLabelV4Png(label);
  assert.equal(first.sha256, second.sha256); assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.manifest.canvasWidthMm, 68.342); assert.equal(first.manifest.canvasHeightMm, 20.082);
  assert.equal(first.manifest.intendedImportXmm, null); assert.equal(first.manifest.calibrationProfileHash, null);
  const { data, info } = await sharp(first.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 6458); assert.equal(info.height, 1898);
  let opaque = 0, transparent = 0;
  for (let i = 3; i < data.length; i += 4) { assert.ok(data[i] === 0 || data[i] === 255); data[i] ? opaque += 1 : transparent += 1; }
  assert.ok(opaque > 1_000_000); assert.ok(transparent > 100_000);
  const pixel = (x, y) => data[(Math.floor(y / 20.082 * info.height) * info.width + Math.floor(x / 68.342 * info.width)) * 4 + 3];
  for (const x of [47, 49, 51.25, 53, 55]) assert.equal(pixel(x, 10.041), 0);
  assert.equal(pixel(0, 0), 0); assert.equal(pixel(44.7, 12), 255);
  const offset = first.bytes.indexOf(Buffer.from('pHYs')); assert.ok(offset > 0);
  assert.equal(first.bytes.readUInt32BE(offset + 4), Math.round(6458 / 0.068342)); assert.equal(first.bytes.readUInt32BE(offset + 8), Math.round(1898 / 0.020082));
  assert.equal(first.bytes[offset + 12], 1); assert.ok(first.manifest.rasterReceipt.peakRssBytes < 512 * 1024 * 1024);
});
