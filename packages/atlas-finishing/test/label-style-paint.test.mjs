import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { LABEL_STYLE_FONT_CATALOG, shapeLabelStyleText, validateLabelStyleTexture } from '../src/label-style-paint.mjs';

function recipe(text, fields = {}) {
  return { text, fontId: 'knewave', fontSha256: LABEL_STYLE_FONT_CATALOG.knewave.sha256,
    emphasis: 'LARGE', normalizeWordInkHeight: false, styleableSpans: [{ start: 0, end: text.length }], protectedSpans: [], spans: [], ...fields };
}
function painted(text, pattern = 'NONE', fields = {}) {
  return recipe(text, { spans: [{ start: 0, end: text.length, baseColor: '#ff4b2f', accentColor: '#ffddcc', pattern, opticalScale: 1 }], ...fields });
}
function svg(shape) {
  const scale = Math.min(580 / shape.width, 180 / shape.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><defs>${shape.defs}</defs><g transform="translate(10,10) scale(${scale},${-scale}) translate(${-shape.b.minX},${-shape.b.maxY})">${shape.paths}</g></svg>`;
}

test('catalog outlines the complete exact text with pinned commercially usable font files', () => {
  for (const font of Object.values(LABEL_STYLE_FONT_CATALOG)) {
    const text = 'THRILLERS · ICE /199';
    const s = shapeLabelStyleText({ text, recipe: recipe(text, { fontId: font.id, fontSha256: font.sha256 }) });
    assert.equal(s.text, text);
    assert.equal(s.segments.map(v => v.text).join(''), text);
    assert.equal(s.fontSha256, font.sha256);
    assert.ok(s.width > 0 && s.height > 0 && s.capHeight > 0 && s.unitsPerEm > 0);
    assert.ok(s.paths.includes('<path'));
    assert.equal(s.approximation, true);
    assert.ok(font.traits.length);
  }
});

async function textureTile() {
  const raw = Buffer.alloc(12 * 12 * 3);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const at = (y * 12 + x) * 3;
    raw[at] = y < 6 ? 255 : 0; raw[at + 2] = y < 6 ? 0 : 255;
  }
  const png = await sharp(raw, { raw: { width: 12, height: 12, channels: 3 } }).png().toBuffer();
  return { pngBase64: png.toString('base64'), sha256: createHash('sha256').update(png).digest('hex'), width: 12, height: 12 };
}

test('verified photographic patterns change only glyph RGB and stay upright after the font flip', async () => {
  const text = 'ICE /199', texture = await textureTile();
  const r = painted(text, 'DIAMOND', { protectedSpans: [{ start: 4, end: text.length }] });
  const base = shapeLabelStyleText({ text, recipe: r });
  const photo = shapeLabelStyleText({ text, recipe: r, spanTextures: [texture] });
  assert.equal(validateLabelStyleTexture(texture).sha256, texture.sha256);
  assert.match(photo.defs, new RegExp(`<image data-label-texture="${texture.sha256}"`));
  assert.match(photo.defs, /href="data:image\/png;base64,/);
  assert.ok(photo.segments.filter(s => s.protected).every(s => s.textureSha256 === null));
  assert.equal(photo.segments.find(s => s.text === 'ICE').textureSha256, texture.sha256);
  const a = await sharp(Buffer.from(svg(base))).ensureAlpha().raw().toBuffer();
  const b = await sharp(Buffer.from(svg(photo))).ensureAlpha().raw().toBuffer();
  assert.notDeepEqual(a, b);
  for (let i = 3; i < a.length; i += 4) assert.equal(a[i], b[i]);
  const tileSize = Number((photo.cap * .48).toFixed(6)), id = photo.defs.match(/<pattern id="([^"]+)"/)[1];
  const sample = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 ${tileSize} ${tileSize}"><defs>${photo.defs}</defs><g transform="translate(0,${tileSize}) scale(1,-1)"><rect width="${tileSize}" height="${tileSize}" fill="url(#${id})"/></g></svg>`;
  const rgb = await sharp(Buffer.from(sample)).removeAlpha().raw().toBuffer();
  const top = (25 * 100 + 50) * 3, bottom = (75 * 100 + 50) * 3;
  assert.ok(rgb[top] > 240 && rgb[top + 2] < 15, 'photo top must remain red');
  assert.ok(rgb[bottom] < 15 && rgb[bottom + 2] > 240, 'photo bottom must remain blue');
});

test('texture payloads reject URLs, bad hashes, noncanonical base64, corrupt PNGs and oversized dimensions', async () => {
  const t = await textureTile(), bytes = Buffer.from(t.pngBase64, 'base64');
  const corrupted = Buffer.from(bytes); corrupted[45] ^= 1;
  const corruptPayload = { ...t, pngBase64: corrupted.toString('base64'), sha256: createHash('sha256').update(corrupted).digest('hex') };
  for (const bad of [
    { ...t, pngBase64: 'https://example.com/tile.png' }, { ...t, sha256: '0'.repeat(64) },
    { ...t, pngBase64: `${t.pngBase64}\n` }, { ...t, width: 13 }, { ...t, height: 257 },
    { ...t, url: 'https://example.com/' }, { ...t, pngBase64: Buffer.from('<svg/>').toString('base64') }, corruptPayload,
  ]) assert.throws(() => validateLabelStyleTexture(bad), /LABEL_STYLE_TEXTURE_INVALID/);
  const text = 'ICE';
  assert.throws(() => shapeLabelStyleText({ text, recipe: painted(text, 'NONE'), spanTextures: [t] }), /LABEL_STYLE_TEXTURE_INVALID/);
  assert.throws(() => shapeLabelStyleText({ text, recipe: painted(text, 'DIAMOND'), spanTextures: [] }), /LABEL_STYLE_TEXTURE_INVALID/);
});

test('packaged font provenance and license bytes match every pinned artifact', () => {
  const root = new URL('../assets/approved-b/fonts/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('label-style-provenance.json', root)));
  for (const f of manifest.files) {
    const b = readFileSync(new URL(f.file, root));
    assert.equal(createHash('sha256').update(b).digest('hex'), f.sha256);
    assert.equal(b.length, f.bytes);
  }
  assert.equal(manifest.license, 'OFL-1.1');
  assert.match(readFileSync(new URL('OFL-Knewave.txt', root), 'utf8'), /SIL Open Font License/);
  assert.match(readFileSync(new URL('OFL-Lacquer.txt', root), 'utf8'), /SIL Open Font License/);
});

test('protected serial stays exact and can use a card-derived color without generated paint effects', () => {
  const text = 'ICE · ICE /199';
  const r = painted(text, 'DIAMOND', {
    protectedSpans: [{ start: 10, end: text.length }],
    spans: [
      { start: 0, end: 3, baseColor: '#112233', accentColor: '#445566', pattern: 'NONE', opticalScale: 1 },
      { start: 6, end: text.length, baseColor: '#778899', accentColor: '#aabbcc', pattern: 'DIAMOND', opticalScale: 1.2 },
    ],
  });
  const s = shapeLabelStyleText({ text, recipe: r, defaultColor: '#090a0b' });
  assert.match(s.paths, /fill="#112233"/);
  assert.match(s.paths, /fill="url\(#atlas-style-/);
  assert.match(s.paths, /fill="#090a0b"/);
  assert.equal(s.segments.filter(v => v.protected).map(v => v.text).join(''), '/199');
  for (const v of s.segments.filter(v => v.protected)) {
    assert.equal(v.pattern, 'NONE'); assert.equal(v.scale, 1); assert.equal(v.spanIndex, -1);
  }
  const colored = shapeLabelStyleText({ text, recipe: r, defaultColor: '#090a0b', protectedColor: '#f14524' });
  assert.match(colored.paths, /fill="#f14524" data-style-span="-1"/);
  assert.deepEqual(colored.b, s.b);
  assert.deepEqual(colored.segments.filter(v => v.protected), s.segments.filter(v => v.protected));
});

test('optical normalization increases short-word ink height uniformly and never beyond 1.2', () => {
  const text = 'THRILLERS · ICE', r = painted(text);
  const ordinary = shapeLabelStyleText({ text, recipe: r });
  const normalized = shapeLabelStyleText({ text, recipe: { ...r, normalizeWordInkHeight: true } });
  const h = (s, word) => { const b = s.segments.find(v => v.text === word).bounds; return b.maxY - b.minY; };
  assert.ok(Math.abs(h(normalized, 'THRILLERS') - h(normalized, 'ICE')) <= Math.abs(h(ordinary, 'THRILLERS') - h(ordinary, 'ICE')));
  assert.ok(normalized.segments.every(v => v.scale >= 1 && v.scale <= 1.2));
  assert.equal(normalized.segments.find(v => v.text === 'THRILLERS').scale, 1);
  const enlarged = shapeLabelStyleText({ text, recipe: { ...r, normalizeWordInkHeight: true, spans: r.spans.map(s => ({ ...s, opticalScale: 1.2 })) } });
  assert.ok(enlarged.segments.every(v => v.scale <= 1.2));
});

test('procedural fills change RGB while preserving the exact outlined glyph alpha silhouette', async () => {
  const text = 'BLUE ICE';
  let first;
  for (const pattern of ['NONE', 'DIAMOND', 'SHIMMER', 'STRIPES']) {
    const shape = shapeLabelStyleText({ text, recipe: painted(text, pattern) });
    const { data, info } = await sharp(Buffer.from(svg(shape))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = Buffer.from(Array.from({ length: info.width * info.height }, (_, i) => data[i * 4 + 3]));
    if (!first) first = { data, alpha };
    else { assert.deepEqual(alpha, first.alpha); assert.notDeepEqual(data, first.data); }
    assert.doesNotMatch(shape.paths + shape.defs, /<(?:image|script|foreignObject|text)\b|https?:|data:/i);
  }
});

test('finish palette overrides preserve recipe, geometry and deterministic output', () => {
  const text = 'THRILLERS · ICE', r = painted(text, 'SHIMMER'), before = JSON.stringify(r);
  const a = shapeLabelStyleText({ text, recipe: r });
  const b = shapeLabelStyleText({ text, recipe: r, defaultColor: '#090a0b', spanColors: [{ baseColor: '#70150e', accentColor: '#123b52' }] });
  assert.deepEqual(a.b, b.b); assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  assert.equal(JSON.stringify(r), before);
  assert.deepEqual(a, shapeLabelStyleText({ text, recipe: r }));
  assert.match(b.defs, /#70150e/); assert.match(b.defs, /#123b52/);
});

test('invalid source binding, font, paint, offsets and unsupported glyphs fail closed', () => {
  const text = 'ICE', r = painted(text);
  const invalid = [
    { recipe: { ...r, text: 'THRILLERS' } },
    { recipe: { ...r, fontId: 'hallowfranken' } },
    { recipe: { ...r, fontId: '__proto__', fontSha256: undefined } },
    { recipe: { ...r, fontSha256: '0'.repeat(64) } },
    { recipe: { ...r, spans: [{ ...r.spans[0], baseColor: 'url(https://example.com)' }] } },
    { recipe: { ...r, spans: [{ ...r.spans[0], pattern: '<image/>' }] } },
    { recipe: { ...r, spans: [{ ...r.spans[0], opticalScale: 1.21 }] } },
    { recipe: { ...r, spans: [{ ...r.spans[0], start: -1 }] } },
    { recipe: { ...r, spans: [r.spans[0], r.spans[0]] } },
    { recipe: { ...r, styleableSpans: [{ start: 0, end: 1 }] } },
    { idPrefix: 'x"><script>' },
    { defaultColor: '#fff' },
    { spanColors: [] },
  ];
  for (const change of invalid) assert.throws(() => shapeLabelStyleText({ text, recipe: r, ...change }), /LABEL_STYLE_/);
  assert.throws(() => shapeLabelStyleText({ text: 'I😀', recipe: recipe('I😀', { spans: [{ ...r.spans[0], start: 1, end: 2 }] }) }), /SPANS_INVALID/);
  assert.throws(() => shapeLabelStyleText({ text: '😀', recipe: recipe('😀') }), /UNSUPPORTED_GLYPH/);
});
