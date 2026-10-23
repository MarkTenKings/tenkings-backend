import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { buildLabelStyleFront, validateLabelStyleArtwork, labelStyleBlackInk } from '../src/label-style-artwork.mjs';
import { shapeLabelStyleWordmark } from '../src/label-style-wordmark.mjs';
import { renderApprovedBLabel } from '../src/label-approved-b.mjs';
import { validateApprovedBArtwork } from '../src/label-approved-b-artwork.mjs';

const hash = v => createHash('sha256').update(v).digest('hex');
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
const width = 40, height = 20, raw = Buffer.alloc(width * height * 4, 255), preview = Buffer.alloc(width * height * 3, 255);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const ink = x >= 2 && x < 38 && y >= 2 && y < 18 && !(x >= 16 && x < 24 && y >= 7 && y < 13);
  raw[(y * width + x) * 4 + 3] = ink ? 255 : 0;
  if (ink) preview.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3);
}
const mask = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
const png = await sharp(preview, { raw: { width, height, channels: 3 } }).png().toBuffer();
const d = { version: 'atlas-original-label-wordmark-v1', requestKey: `label-wordmark-generate:v1:${'b'.repeat(64)}`,
  sourceHash: 'a'.repeat(64), role: 'variant', text: 'ICE', ink: 'BLACK_ON_WHITE', mimeType: 'image/png',
  width, height, sha256: hash(png), byteCount: png.length, mask: { width, height, sha256: hash(mask), byteCount: mask.length, mimeType: 'image/png' },
  words: [{ text: 'ICE', start: 0, end: 3, x: 2, y: 2, width: 36, height: 16 }], normalizeWordInkHeight: false,
  provenance: { kind: 'ORIGINAL_GENERATED_LETTERING', sourceFontReproduced: false, fontMatchPercentageClaimed: false, ownershipClaimed: false } };
d.artifactHash = hash(canonical(d));
const wordmark = { descriptor: d, pngBase64: png.toString('base64'), maskBase64: mask.toString('base64') };
const recipe = { text: 'ICE', role: 'variant', styleableSpans: [{ start: 0, end: 3 }], protectedSpans: [], normalizeWordInkHeight: false,
  spans: [{ start: 0, end: 3, baseColor: '#92e2ff', accentColor: '#ffffff', pattern: 'NONE', opticalScale: 1 }] };
const shape = outlineRadiusUnits => shapeLabelStyleWordmark({ text: 'ICE', recipe, wordmark, expectedSourceHash: d.sourceHash, outlineRadiusUnits });
function artwork(inverted = false) {
  const s = shape(inverted ? 1 : 0);
  return buildLabelStyleFront({ title: 'Label & test <safe>', primary: '', support: '',
    accents: `<g transform="translate(30,15) scale(.1,-.1)">${s.paths}</g>`, defs: s.defs, inverted });
}
const item = printSvg => ({ printSvg, artworkHash: hash(printSvg) });

test('data-label-style is accepted and real generated masks, internal references and bounded dilation validate', () => {
  for (const inverted of [false, true]) {
    const svg = artwork(inverted); assert.equal(validateLabelStyleArtwork(item(svg)), svg);
    assert.equal((svg.match(/<image data-label-wordmark=/g) ?? []).length, 1);
  }
});

test('actual Sports and Pokémon renderer groups validate for ordinary and inverted finishes', () => {
  for (const finalGrade of Array.from({ length: 10 }, (_, i) => i + 1)) for (const cardProfile of ['SPORTS', 'POKEMON']) {
    const identity = cardProfile === 'SPORTS'
      ? { playerName: 'TreVeyon Henderson', year: '2025', manufacturer: 'Panini', productSet: 'Rookies & Stars', cardNumber: '20', insert: 'Thrillers', parallel: 'Ice' }
      : { cardName: 'Alakazam ex', year: '2024', manufacturer: 'Pokémon', productSet: 'Paldean Fates', cardNumber: '215/091', parallel: null, insert: null };
    const result = renderApprovedBLabel({ identity, cardProfile, finalGrade, reportNumber: 'ATLAS-031200997F31', approvalVersion: 1 }, { previewMaterial: cardProfile === 'SPORTS' ? 'gold' : 'holo' });
    assert.equal(result.state, 'READY'); assert.equal(validateApprovedBArtwork(result), result.printSvg);
    const mono = labelStyleBlackInk(result); assert.equal(validateLabelStyleArtwork(item(mono)), mono);
    const bad = result.printSvg.replace('data-part="name"', 'data-part="arbitrary-handler"');
    assert.throws(() => validateLabelStyleArtwork(item(bad)), /LABEL_PRINT_ARTWORK_INVALID/);
  }
});

test('active markup, unsafe attributes, external references and unbounded filters fail closed', () => {
  const base = artwork(true);
  const attacks = [
    s => s.replace('<g data-style-accents="true"', '<g data-style-accents="true" onload="alert(1)"'),
    s => s.replace('<g data-style-accents="true"', '<g data-style-accents="true" style="fill:red"'),
    s => s.replace('</defs>', '<script>alert(1)</script></defs>'),
    s => s.replace('</defs>', '<foreignObject/></defs>'),
    s => s.replace('<title>', '<!DOCTYPE svg><title>'),
    s => s.replace(/<use href="#[^"]+"/, '<use href="https://example.com/a.svg"'),
    s => s.replace(/<use href="#[^"]+"/, '<use href="#missing"'),
    s => s.replace('radius="1"', 'radius="20.001"'),
    s => s.replace('operator="dilate"', 'operator="erode"'),
    s => s.replace('<feMorphology', '<feGaussianBlur'),
    s => s.replace(/data-label-wordmark="[a-f0-9]+"/, `data-label-wordmark="${'0'.repeat(64)}"`),
    s => s.replace('data-style-span="0"', 'data-style-span="0" onclick="x"') + '<script/>',
    s => s.replace('</defs>', '<image data-label-texture="bad" href="https://example.com/photo"/></defs>'),
    s => s.replace('</defs>', '<pattern id="loop" patternUnits="userSpaceOnUse" width="1" height="1"><path d="M0 0L1 1" fill="url(#loop)"/></pattern></defs>'),
    s => s.replace('</defs>', '<mask id="style-primary-cutout"/></defs>'),
    s => s.replace('</defs>', '<mask id="cycle-a"><g mask="url(#cycle-b)"></g></mask><mask id="cycle-b"><g mask="url(#cycle-a)"></g></mask></defs>'),
  ];
  for (const attack of attacks) assert.throws(() => validateLabelStyleArtwork(item(attack(base))), /LABEL_PRINT_ARTWORK_INVALID/);
});

test('monochrome retains alpha-mask letter counters and validates idempotently for both finishes', async () => {
  for (const inverted of [false, true]) {
    const mono = labelStyleBlackInk(item(artwork(inverted)));
    assert.equal(validateLabelStyleArtwork(item(mono)), mono);
    assert.equal(labelStyleBlackInk(item(mono)), mono);
    assert.equal((mono.match(/<image data-label-wordmark=/g) ?? []).length, 1);
    const { data, info } = await sharp(Buffer.from(mono), { density: 508 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => { const i = (Math.round(y / 20.082 * info.height) * info.width + Math.round(x / 68.342 * info.width)) * 4; return [...data.subarray(i, i + 4)]; };
    const ink = pixel(30.6, 13.5), hole = pixel(32, 14);
    if (inverted) { assert.deepEqual(ink, [0, 0, 0, 255]); assert.notDeepEqual(hole, ink); }
    else { assert.equal(ink[3], 0); assert.equal(hole[3], 255); }
  }
});
