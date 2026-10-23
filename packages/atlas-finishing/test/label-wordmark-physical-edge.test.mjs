import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderApprovedBLabel, approvedBStyleInputLines, isApprovedBRendererProfile } from '../src/label-approved-b.mjs';
import { approvedBHash, validateApprovedBArtwork } from '../src/label-approved-b-artwork.mjs';
import { LABEL_STYLE_FONT_CATALOG } from '../src/label-style-paint.mjs';
import { shapeLabelStyleWordmark } from '../src/label-style-wordmark.mjs';
import { prepareLabelStyleRequest, compileLabelStyleSpec } from '../../atlas-connected-manual/src/label-style-contract.mjs';
import { prepareLabelWordmarkRequest } from '../../atlas-connected-manual/src/label-wordmark-contract.mjs';
import { compileLabelWordmark } from '../../atlas-connected-manual/src/label-wordmark-image.mjs';

// Synthetic ink rectangles exercise the actual compiler, alpha mask, fit and
// raster export without claiming to reproduce generated provider lettering.
async function fixture({ width, height, normalize, pattern = 'SHIMMER' }) {
  const source = { cardProfile: 'SPORTS', identity: { playerName: 'Test Player', year: '2025', manufacturer: 'Topps',
    productSet: 'Chrome', cardNumber: '1', parallel: 'ICE' }, finalGrade: 10, reportNumber: 'ATLAS-123456789ABC', approvalVersion: 1 };
  const request = prepareLabelStyleRequest({
    approval: { cardId: '8d63e0e2-41f8-4cd0-bad4-54e06e247ec4', actionId: '6d964eee-65a4-442a-b6c5-f92e1bbb460c',
      approvalVersion: 1, publicHash: 'a'.repeat(64), reportHash: 'b'.repeat(64) },
    identity: source.identity, cardProfile: source.cardProfile,
    photos: ['FRONT', 'BACK'].map((side, index) => ({ side, sha256: String(index + 1).repeat(64), contentType: 'image/png', width: 32, height: 48, byteCount: 200 })),
    lines: approvedBStyleInputLines(source.identity, { cardProfile: source.cardProfile }),
  }, { fontCatalog: Object.values(LABEL_STYLE_FONT_CATALOG), defaultFontId: 'knewave' });
  const evidence = { side: 'FRONT', sha256: '1'.repeat(64), box: { x: .1, y: .2, width: .4, height: .2 },
    basis: 'PRINTED_LETTERING', confidence: 'HIGH', observation: 'Synthetic brush lettering fixture.' };
  const spec = compileLabelStyleSpec(request, { lines: request.source.lines.map(line => ({ role: line.role,
    letteringMode: line.role === 'variant' ? 'ORIGINAL_WORDMARK' : 'CATALOG',
    letteringDescription: line.role === 'variant' ? 'Bold brush capitals.' : '', letteringTraits: line.role === 'variant' ? ['BRUSH', 'BOLD'] : [],
    fontId: 'knewave', fontSource: evidence, emphasis: 'LARGE', normalizeWordInkHeight: normalize,
    spans: line.role === 'variant' ? [{ start: 0, end: 3, baseColor: '#ff4b2f', accentColor: '#ff4b2f', pattern, opticalScale: 1, source: evidence }] : [],
  })) }, { requestSha256: 'c'.repeat(64), responseSha256: 'd'.repeat(64) });
  const wordmarkRequest = prepareLabelWordmarkRequest({ sourceHash: spec.specHash, role: 'variant', text: 'ICE', traits: ['BRUSH', 'BOLD'], normalizeWordInkHeight: normalize });
  const x = 40, y = 200;
  const bytes = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="white"/><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="black"/></svg>`)).png().toBuffer();
  const image = { bytes, sha256: approvedBHash(bytes), mimeType: 'image/png', width: 1536, height: 1024 };
  const compiled = await compileLabelWordmark({ request: wordmarkRequest, image, verification: {
    imageSha256: image.sha256, sourceHash: spec.specHash, generationRequestKey: wordmarkRequest.requestKey, responseSha256: 'e'.repeat(64),
    reading: { transcription: 'ICE', singleLine: true, extraMarks: false, confidence: 'HIGH', words: [{ text: 'ICE', x, y, width, height }] },
  } });
  const wordmark = { descriptor: compiled.descriptor, pngBase64: compiled.bytes.toString('base64'), maskBase64: compiled.maskBytes.toString('base64') };
  return { source, spec, wordmark, options: { styleSpec: spec, wordmarks: { variant: wordmark } } };
}

function variant(svg) {
  const start = svg.indexOf('<g data-part="variant">'), tags = /<\/?g\b[^>]*>/g; tags.lastIndex = start;
  let depth = 0, token;
  while ((token = tags.exec(svg))) { depth += token[0].startsWith('</') ? -1 : 1; if (!depth) return svg.slice(start, tags.lastIndex); }
  assert.fail('Missing variant group');
}
function edgeGeometry(result) {
  const part = variant(result.printSvg), match = /scale\(([\d.]+),-([\d.]+)\)/.exec(part);
  const radius = Number(/<feMorphology operator="dilate" radius="([\d.]+)"/.exec(result.printSvg)?.[1]);
  return { radius, scale: Number(match[1]), part, bounds: result.diagnostics.metadata.bounds.find(b => b.role === 'variant') };
}
async function rasterEdge(result) {
  const { part, bounds } = edgeGeometry(result), margin = .15;
  const defs = /<defs>([^]*?)<\/defs>/.exec(result.printSvg)[1];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width + margin * 2}mm" height="${bounds.height + margin * 2}mm" viewBox="${bounds.x - margin} ${bounds.y - margin} ${bounds.width + margin * 2} ${bounds.height + margin * 2}"><defs>${defs}</defs>${part}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg), { density: 2540 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const x = Math.floor(info.width / 2); let ink = -1, fill = -1;
  for (let y = 0; y < info.height; y++) {
    const at = (y * info.width + x) * 4;
    if (data[at + 3] < 128) continue;
    if (ink < 0) ink = y;
    if (data[at] > 160 && data[at + 1] < 180 && data[at + 2] < 150) { fill = y; break; }
  }
  assert(ink >= 0 && fill > ink);
  return (fill - ink) * (bounds.height + margin * 2) / info.height;
}

for (const [name, input, capCheck] of [
  ['non-normalized 500-unit cap', { width: 500, height: 500, normalize: false }, cap => assert.equal(cap, 500)],
  ['normalized width-constrained cap', { width: 1400, height: 70, normalize: true }, cap => assert(cap < 256 && cap >= 64)],
]) test(`${name} retains exact physical edges after actual label fitting`, async () => {
  const f = await fixture(input); capCheck(f.wordmark.descriptor.words[0].height);
  for (const grade of [8, 10]) {
    const result = renderApprovedBLabel({ ...f.source, finalGrade: grade }, f.options); assert.equal(result.state, 'READY');
    validateApprovedBArtwork(result);
    const { radius, scale, bounds } = edgeGeometry(result), wanted = grade === 10 ? .045 : .025;
    assert(Math.abs(radius * scale - wanted) < .00002, `physical edge ${radius * scale} differs from ${wanted}`);
    assert(Math.abs(await rasterEdge(result) - wanted) < .011, 'actual raster must retain the requested edge within one pixel');
    assert(bounds.capHeightMm >= 1.3 && bounds.capHeightMm <= 2.5);
    if (!input.normalize && grade === 10) assert(radius > 8 && radius <= 20);
  }
});

test('the accepted 256-unit cap at2.5mm retains the exact prior outline and placement', async () => {
  const f = await fixture({ width: 500, height: 500, normalize: true, pattern: 'NONE' });
  const result = renderApprovedBLabel(f.source, f.options); assert.equal(result.state, 'READY');
  const recipe = f.spec.lines.find(l => l.role === 'variant'), prior = shapeLabelStyleWordmark({ text: 'ICE', recipe,
    wordmark: f.wordmark, expectedSourceHash: f.spec.specHash, defaultColor: '#090a0b',
    spanColors: [{ baseColor: '#FF4B2F', accentColor: '#FF4B2F' }], outlineColor: '#090a0b', outlineRadiusUnits: .045 / 2.5 * 256 });
  const { radius, bounds, part } = edgeGeometry(result);
  assert.equal(radius, 4.608); assert.equal(bounds.capHeightMm, 2.5);
  const n = value => Number(value.toFixed(6)), scale = 2.5 / 256, center = 11 + (2.675 + .25) + 2.675 / 2;
  const expected = `<g data-part="variant"><g transform="translate(17.5,${n(center - prior.height * scale / 2)}) scale(${n(scale)},${n(-scale)}) translate(${n(-prior.b.minX)},${n(-prior.b.maxY)})">${prior.paths}</g></g>`;
  assert.equal(part, expected); assert(result.printSvg.includes(prior.defs));
  assert(isApprovedBRendererProfile('df5054cb6e777409dcef8b5938c87df3ec76e980c8553c6edb77567c2f9defbe'));
});
