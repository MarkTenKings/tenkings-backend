import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { prepareLabelWordmarkRequest } from '../../atlas-connected-manual/src/label-wordmark-contract.mjs';
import { compileLabelWordmark } from '../../atlas-connected-manual/src/label-wordmark-image.mjs';
import { shapeLabelStyleWordmark, labelWordmarkTextProjection } from '../src/label-style-wordmark.mjs';

const hash = v => createHash('sha256').update(v).digest('hex');
const sourceHash = 'a'.repeat(64), text = 'THRILLERS · ICE';
const request = prepareLabelWordmarkRequest({ sourceHash, role: 'variant', text: 'THRILLERS ICE', traits: ['BRUSH', 'BOLD'], normalizeWordInkHeight: true });
const sourceSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="white"/><path fill="black" d="M200 400H850V580H200ZM240 440V540H810V440Z" fill-rule="evenodd"/><rect x="930" y="430" width="120" height="120" fill="black"/></svg>';
const bytes = await sharp(Buffer.from(sourceSvg)).png().toBuffer();
const image = { bytes, sha256: hash(bytes), mimeType: 'image/png', width: 1536, height: 1024 };
const reading = { transcription: request.text, singleLine: true, extraMarks: false, confidence: 'HIGH', words: [
  { text: 'THRILLERS', x: 200, y: 400, width: 650, height: 180 }, { text: 'ICE', x: 930, y: 430, width: 120, height: 120 },
] };
const compiled = await compileLabelWordmark({ request, image, verification: { imageSha256: image.sha256, sourceHash,
  generationRequestKey: request.requestKey, responseSha256: 'b'.repeat(64), reading } });
const wordmark = { descriptor: compiled.descriptor, pngBase64: compiled.bytes.toString('base64'), maskBase64: compiled.maskBytes.toString('base64') };
const recipe = { role: 'variant', text, emphasis: 'LARGE', normalizeWordInkHeight: true,
  styleableSpans: [{ start: 0, end: text.length }], protectedSpans: [], spans: [
    { start: 0, end: 9, baseColor: '#ff4b2f', accentColor: '#ffc9be', pattern: 'NONE', opticalScale: 1 },
    { start: 12, end: 15, baseColor: '#92e2ff', accentColor: '#ffffff', pattern: 'NONE', opticalScale: 1 },
  ] };
const inputs = { text, recipe, wordmark, expectedSourceHash: sourceHash };
function svg(shape, margin = 0) {
  const d = wordmark.descriptor;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width + margin * 2}" height="${d.height + margin * 2}" viewBox="${-margin} ${-margin} ${d.width + margin * 2} ${d.height + margin * 2}"><defs>${shape.defs}</defs><g transform="translate(0,${d.height}) scale(1,-1)">${shape.paths}</g></svg>`;
}
const raster = shape => sharp(Buffer.from(svg(shape))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
function changedDescriptor(mutate) {
  const d = structuredClone(wordmark.descriptor); mutate(d); delete d.artifactHash; d.artifactHash = hash(canonical(d));
  return { ...wordmark, descriptor: d };
}

test('actual compiler output maps exact generated words to original-caption offsets and bounded y-up geometry', () => {
  const shape = shapeLabelStyleWordmark(inputs);
  assert.equal(shape.text, text); assert.equal(shape.representation, 'ALPHA_MASK');
  assert.equal(shape.fontFamily, 'Original generated lettering'); assert.equal(shape.capHeight, 256);
  assert.equal(shape.unitsPerEm, 256); assert.equal(shape.emphasis, 'LARGE');
  assert.deepEqual(shape.segments.map(s => [s.text, s.start, s.end, s.generatedStart, s.generatedEnd]), [['THRILLERS', 0, 9, 0, 9], ['ICE', 12, 15, 10, 13]]);
  assert.equal(shape.segments[0].bounds.maxY - shape.segments[0].bounds.minY, shape.segments[1].bounds.maxY - shape.segments[1].bounds.minY);
  assert.equal((shape.defs.match(/<image data-label-wordmark=/g) ?? []).length, 1);
  assert.equal(shape.defs.includes(wordmark.pngBase64), false);
  assert.ok(Buffer.byteLength(shape.defs) < 400000);
  assert.deepEqual(shape, shapeLabelStyleWordmark(inputs));
});

test('word colors are confined to the exact alpha mask, including internal counters', async () => {
  const shape = shapeLabelStyleWordmark(inputs), output = await raster(shape);
  const mask = await sharp(compiled.maskBytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(output.info.width, mask.info.width); assert.equal(output.info.height, mask.info.height);
  for (let i = 3; i < output.data.length; i += 4) assert.equal(output.data[i], mask.data[i]);
  const d = wordmark.descriptor, first = d.words[0], second = d.words[1];
  const pixel = (x, y) => [...output.data.subarray((y * output.info.width + x) * 4, (y * output.info.width + x) * 4 + 4)];
  assert.deepEqual(pixel(first.x + 10, first.y + 10), [255, 75, 47, 255]);
  assert.deepEqual(pixel(second.x + 10, second.y + 10), [146, 226, 255, 255]);
  assert.equal(pixel(first.x + Math.floor(first.width / 2), first.y + 128)[3], 0);
});

test('photo texture stays upright inside generated lettering and preserves mask alpha', async () => {
  const raw = Buffer.alloc(12 * 12 * 3);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) { const i = (y * 12 + x) * 3; raw[i] = y < 6 ? 255 : 0; raw[i + 2] = y < 6 ? 0 : 255; }
  const tile = await sharp(raw, { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
  const t = { pngBase64: tile.toString('base64'), sha256: hash(tile), width: 12, height: 12 };
  const patterned = { ...recipe, spans: recipe.spans.map(s => ({ ...s, pattern: 'DIAMOND' })) };
  const shape = shapeLabelStyleWordmark({ ...inputs, recipe: patterned, spanTextures: [t, t] });
  const output = await raster(shape), original = await raster(shapeLabelStyleWordmark(inputs));
  for (let i = 3; i < output.data.length; i += 4) assert.equal(output.data[i], original.data[i]);
  const x = wordmark.descriptor.words[1].x + 10, top = (30 * output.info.width + x) * 4, bottom = (90 * output.info.width + x) * 4;
  assert.ok(output.data[top] > 240 && output.data[top + 2] < 15);
  assert.ok(output.data[bottom] < 15 && output.data[bottom + 2] > 240);
});

test('grade-10 outline dilates actual glyph alpha with one shared mask image and expanded fit bounds', async () => {
  const base = shapeLabelStyleWordmark(inputs), shape = shapeLabelStyleWordmark({ ...inputs, outlineRadiusUnits: 4, outlineColor: '#090a0b' });
  assert.deepEqual(shape.b, { minX: base.b.minX - 4, minY: base.b.minY - 4, maxX: base.b.maxX + 4, maxY: base.b.maxY + 4 });
  assert.equal(shape.width, base.width + 8); assert.equal(shape.height, base.height + 8);
  assert.equal((shape.defs.match(/<image data-label-wordmark=/g) ?? []).length, 1);
  assert.match(shape.defs, /<feMorphology operator="dilate" radius="4"\/>/);
  const rendered = await sharp(Buffer.from(svg(shape, 8))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const first = wordmark.descriptor.words[0], x = first.x + 30 + 8, y = first.y - 3 + 8, at = (y * rendered.info.width + x) * 4;
  assert.deepEqual([...rendered.data.subarray(at, at + 4)], [9, 10, 11, 255]);
});

test('binding, spelling, ordering, descriptor bytes, protected serials and partial-word paint fail closed', () => {
  assert.equal(labelWordmarkTextProjection(text), 'THRILLERS ICE');
  assert.equal(labelWordmarkTextProjection('ICE/199'), 'ICE/199');
  for (const change of [
    { expectedSourceHash: 'f'.repeat(64) }, { text: 'THRILLER · ICE' },
    { wordmark: { ...wordmark, maskBase64: `${wordmark.maskBase64}\n` } },
    { wordmark: { ...wordmark, pngBase64: 'https://example.com/image.png' } },
    { wordmark: changedDescriptor(d => { d.words[1].text = '1CE'; }) },
    { wordmark: changedDescriptor(d => { d.words[1].start = 9; }) },
    { wordmark: changedDescriptor(d => { d.words.reverse(); }) },
    { wordmark: changedDescriptor(d => { d.mask.sha256 = '0'.repeat(64); }) },
    { recipe: { ...recipe, protectedSpans: [{ start: 12, end: 15 }] } },
    { recipe: { ...recipe, spans: [{ ...recipe.spans[0], start: 1 }] } },
    { outlineRadiusUnits: 9 }, { outlineColor: 'url(#unsafe)' }, { idPrefix: 'x"><script>' },
  ]) assert.throws(() => shapeLabelStyleWordmark({ ...inputs, ...change }), /LABEL_STYLE_/);
  const modified = structuredClone(wordmark); modified.descriptor.role = 'identity';
  assert.throws(() => shapeLabelStyleWordmark({ ...inputs, wordmark: modified }), /BINDING_INVALID/);
});

test('nonwhite RGB masks are refused even when descriptor and PNG hashes are self-consistent', async () => {
  const { data, info } = await sharp(compiled.maskBytes).raw().toBuffer({ resolveWithObject: true }); data[0] = 1;
  const altered = await sharp(data, { raw: info }).png().toBuffer();
  const changed = changedDescriptor(d => { d.mask.sha256 = hash(altered); d.mask.byteCount = altered.length; }); changed.maskBase64 = altered.toString('base64');
  assert.throws(() => shapeLabelStyleWordmark({ ...inputs, wordmark: changed }), /MASK_INVALID/);
});
