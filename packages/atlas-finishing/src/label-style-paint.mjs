import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as fontkit from 'fontkit';
import { validateLabelStyleTexture } from './label-style-png.mjs';
export { validateLabelStylePng, validateLabelStyleTexture } from './label-style-png.mjs';

// Catalog fonts are licensed, pinned files. A photographic style selection is
// an approximation, never proof that one of these is the original card font.
const fontDefinitions = [
  ['knewave', 'Knewave', 'ed3bac761d755b89ab3082c844d4a623d63c7d6eef85d22ba1fb6c680e6a4436', 400, '../assets/approved-b/fonts/Knewave-Regular.ttf'],
  ['montserrat-black', 'Montserrat', '0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7', 900, '../assets/v4/fonts/Montserrat-variable.ttf'],
  ['roboto-condensed', 'Roboto Condensed', 'dace262afcee68a5276f200d8026c57221735c0118ab5fda8c2c0d3dc409a8d0', 700, '../assets/v4/fonts/RobotoCondensed-variable.ttf'],
  ['lacquer', 'Lacquer', '140c21f71907a16952926ee354c81081092c90d599c89fe8b4557baeaebbbe83', 400, '../assets/approved-b/fonts/Lacquer-Regular.ttf'],
];
const traits = {
  knewave: ['bold brush', 'slanted', 'rounded strokes', 'default expressive fallback'],
  'montserrat-black': ['heavy geometric sans', 'upright', 'wide', 'clean edges'],
  'roboto-condensed': ['condensed sans', 'upright', 'clean edges', 'neutral detail fallback'],
  lacquer: ['rough hand lettering', 'irregular edges', 'upright', 'approximation only'],
};
export const LABEL_STYLE_FONT_CATALOG = Object.freeze(Object.fromEntries(fontDefinitions.map(([id, family, sha256, weight]) =>
  [id, Object.freeze({ id, family, sha256, weight, traits: Object.freeze(traits[id]), license: 'OFL-1.1', approximation: true })])));
const fontFiles = Object.fromEntries(fontDefinitions.map(([id, , , , file]) => [id, file]));

export const LABEL_STYLE_PAINT_VERSION = 'atlas-label-style-paint-v2';
const patterns = new Set(['NONE', 'DIAMOND', 'SHIMMER', 'STRIPES']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const round = n => Number(n.toFixed(6));
const fail = code => { throw new Error(code); };
const faces = new Map();
const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fail('LABEL_STYLE_COLOR_INVALID');
const boundary = (text, at) => Number.isSafeInteger(at) && at >= 0 && at <= text.length
  && !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]));

function ranges(input, text, code) {
  if (!Array.isArray(input) || input.length > 32) fail(code);
  let last = 0;
  return input.map(s => {
    if (!s || !boundary(text, s.start) || !boundary(text, s.end) || s.start < last || s.end <= s.start) fail(code);
    last = s.end;
    return s;
  });
}

function faceFor(id, expectedHash) {
  const entry = Object.hasOwn(LABEL_STYLE_FONT_CATALOG, id) ? LABEL_STYLE_FONT_CATALOG[id] : null;
  if (!entry || expectedHash !== entry.sha256) fail('LABEL_STYLE_FONT_INVALID');
  if (!faces.has(id)) {
    const bytes = readFileSync(new URL(fontFiles[id], import.meta.url));
    if (hash(bytes) !== entry.sha256) fail('LABEL_STYLE_FONT_HASH_MISMATCH');
    const loaded = fontkit.create(bytes);
    faces.set(id, loaded.variationAxes?.wght ? loaded.getVariation({ wght: entry.weight }) : loaded);
  }
  return faces.get(id);
}

function rawShape(text, face) {
  if ([...text].some(c => !face.hasGlyphForCodePoint(c.codePointAt(0)))) fail('UNSUPPORTED_GLYPH');
  const run = face.layout(text, { kern: false, liga: false, clig: false });
  let x = 0, y = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const paths = run.glyphs.map((g, i) => {
    const p = run.positions[i], gx = x + p.xOffset, gy = y + p.yOffset;
    if (g.path.commands.length) {
      minX = Math.min(minX, gx + g.bbox.minX); minY = Math.min(minY, gy + g.bbox.minY);
      maxX = Math.max(maxX, gx + g.bbox.maxX); maxY = Math.max(maxY, gy + g.bbox.maxY);
    }
    const path = g.path.commands.length ? `<path d="${g.path.toSVG()}" transform="translate(${round(gx)},${round(gy)})"/>` : '';
    x += p.xAdvance; y += p.yAdvance;
    return path;
  }).join('');
  return { paths, advance: x, b: { minX, minY, maxX, maxY }, height: maxY - minY };
}

function paint(pattern, base, accent, id, cap, texture) {
  if (pattern === 'NONE') return { fill: base, defs: '' };
  const tile = round(cap * .48), half = round(tile / 2), stroke = round(tile * .075);
  if (texture) {
    const tileHeight = round(tile * texture.height / texture.width);
    // The containing glyph group is flipped from font y-up to SVG y-down by
    // its caller. Counter-flip the photographic tile so it remains upright.
    return { fill: `url(#${id})`, defs: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${tile}" height="${tileHeight}"><rect width="${tile}" height="${tileHeight}" fill="${base}"/><image data-label-texture="${texture.sha256}" x="0" y="0" width="${tile}" height="${tileHeight}" preserveAspectRatio="none" transform="translate(0,${tileHeight}) scale(1,-1)" href="data:image/png;base64,${texture.pngBase64}"/></pattern>` };
  }
  if (pattern === 'SHIMMER') return {
    fill: `url(#${id})`,
    defs: `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1" color-interpolation="sRGB"><stop offset="0" stop-color="${base}"/><stop offset=".42" stop-color="${base}"/><stop offset=".5" stop-color="${accent}"/><stop offset=".58" stop-color="${base}"/><stop offset="1" stop-color="${base}"/></linearGradient>`,
  };
  const motif = pattern === 'DIAMOND'
    ? `<path d="M ${half} 0 L ${tile} ${half} L ${half} ${tile} L 0 ${half} Z" fill="${accent}" fill-opacity=".62"/><path d="M 0 ${half} H ${tile} M ${half} 0 V ${tile}" fill="none" stroke="${base}" stroke-width="${stroke}"/>`
    : `<path d="M ${-tile} 0 L 0 ${tile} M 0 0 L ${tile} ${tile} M ${tile} 0 L ${tile * 2} ${tile}" fill="none" stroke="${accent}" stroke-width="${round(tile * .22)}" stroke-opacity=".8"/>`;
  return { fill: `url(#${id})`, defs: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${tile}" height="${tile}"><rect width="${tile}" height="${tile}" fill="${base}"/>${motif}</pattern>` };
}

/** Shared trusted paint construction for font paths and generated alpha masks. */
export function createLabelStylePaint({ pattern, baseColor, accentColor, id, capHeight, texture } = {}) {
  if (!patterns.has(pattern) || typeof id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(id)
    || !Number.isFinite(capHeight) || capHeight <= 0 || capHeight > 100000) fail('LABEL_STYLE_PAINT_INVALID');
  if (texture && pattern === 'NONE') fail('LABEL_STYLE_TEXTURE_INVALID');
  return paint(pattern, color(baseColor), color(accentColor), id, capHeight, texture ? validateLabelStyleTexture(texture) : null);
}

/**
 * Exact source text -> outlined, painted font units, with y pointing upward.
 * The caller fits the actual returned b/width/height into physical millimeters.
 * defs is trusted generated markup; paths contain no source text or SVG input.
 * spanColors is an optional finish-only palette override, indexed by recipe span.
 */
export function shapeLabelStyleText({ text, recipe, defaultColor = '#ffffff', protectedColor = defaultColor, spanColors, spanTextures, idPrefix } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 512 || /[\u0000-\u001f\u007f]/u.test(text)) fail('LABEL_STYLE_TEXT_INVALID');
  if (!recipe || recipe.text !== text) fail('LABEL_STYLE_TEXT_BINDING_MISMATCH');
  const face = faceFor(recipe.fontId, recipe.fontSha256), entry = LABEL_STYLE_FONT_CATALOG[recipe.fontId];
  const primary = color(defaultColor), serialColor = color(protectedColor), spans = ranges(recipe.spans ?? [], text, 'LABEL_STYLE_SPANS_INVALID');
  const protectedSpans = ranges(recipe.protectedSpans ?? [], text, 'LABEL_STYLE_PROTECTED_SPANS_INVALID');
  const styleableSpans = recipe.styleableSpans == null ? [{ start: 0, end: text.length }] : ranges(recipe.styleableSpans, text, 'LABEL_STYLE_STYLEABLE_SPANS_INVALID');
  if (recipe.normalizeWordInkHeight !== undefined && typeof recipe.normalizeWordInkHeight !== 'boolean') fail('LABEL_STYLE_SCALE_INVALID');
  if (spanColors !== undefined && (!Array.isArray(spanColors) || spanColors.length !== spans.length)) fail('LABEL_STYLE_PALETTE_INVALID');
  if (spanTextures !== undefined && (!Array.isArray(spanTextures) || spanTextures.length !== spans.length)) fail('LABEL_STYLE_TEXTURE_INVALID');
  const textures = spans.map((s, i) => {
    const texture = spanTextures?.[i];
    if (texture == null) return null;
    if (s.pattern === 'NONE') fail('LABEL_STYLE_TEXTURE_INVALID');
    return validateLabelStyleTexture(texture);
  });
  const paints = spans.map((s, i) => {
    if (!patterns.has(s.pattern) || !Number.isFinite(s.opticalScale) || s.opticalScale < 1 || s.opticalScale > 1.2) fail('LABEL_STYLE_PAINT_INVALID');
    if (!styleableSpans.some(r => s.start >= r.start && s.end <= r.end)) fail('LABEL_STYLE_SPAN_NOT_STYLEABLE');
    // Validate source colors even when this render uses a grade-10 palette.
    color(s.baseColor); color(s.accentColor);
    return { base: color(spanColors?.[i]?.baseColor ?? s.baseColor), accent: color(spanColors?.[i]?.accentColor ?? s.accentColor) };
  });
  const fingerprint = hash(JSON.stringify({ text, font: entry.sha256, weight: entry.weight, spans, protectedSpans, paints, textures: textures.map(t => t?.sha256 ?? null), primary,
    ...(serialColor !== primary ? { serialColor } : {}), normalize: !!recipe.normalizeWordInkHeight }));
  const prefix = idPrefix ?? `atlas-style-${fingerprint.slice(0, 16)}`;
  if (typeof prefix !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(prefix)) fail('LABEL_STYLE_ID_INVALID');
  const cap = rawShape('H', face).height;
  const words = [...text.matchAll(/[\p{L}\p{M}]+/gu)].map(m => ({ start: m.index, end: m.index + m[0].length, letters: [...m[0]].length, ...rawShape(m[0], face) }));
  const referenceHeight = Math.max(cap, ...words.map(w => w.height));
  const breaks = [...new Set([0, text.length, ...[...spans, ...protectedSpans, ...words].flatMap(s => [s.start, s.end])])].sort((a, b) => a - b);
  let dx = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, paths = '';
  const definitions = new Map(), segments = [];
  for (let i = 0; i < breaks.length - 1; i++) {
    const start = breaks[i], end = breaks[i + 1], segmentText = text.slice(start, end);
    const shape = rawShape(segmentText, face), protectedText = protectedSpans.some(s => start >= s.start && end <= s.end);
    const spanIndex = protectedText ? -1 : spans.findIndex(s => start >= s.start && end <= s.end);
    const span = spans[spanIndex], word = words.find(w => start >= w.start && end <= w.end);
    const normalization = !protectedText && recipe.normalizeWordInkHeight && word?.letters <= 4 && word.height > 0 ? Math.max(1, referenceHeight / word.height) : 1;
    const scale = Math.min(1.2, (span?.opticalScale ?? 1) * normalization);
    // Center any uniform optical enlargement on the font's cap-height band.
    const y = (1 - scale) * cap / 2;
    let fill = protectedText ? serialColor : primary, pattern = 'NONE';
    if (span) {
      pattern = span.pattern;
      const id = `${prefix}-s${spanIndex}`, p = paint(pattern, paints[spanIndex].base, paints[spanIndex].accent, id, cap, textures[spanIndex]);
      fill = p.fill;
      if (p.defs) definitions.set(id, p.defs);
    }
    let bounds = null;
    if (shape.paths) {
      bounds = { minX: dx + shape.b.minX * scale, minY: y + shape.b.minY * scale, maxX: dx + shape.b.maxX * scale, maxY: y + shape.b.maxY * scale };
      minX = Math.min(minX, bounds.minX); minY = Math.min(minY, bounds.minY); maxX = Math.max(maxX, bounds.maxX); maxY = Math.max(maxY, bounds.maxY);
      paths += `<g fill="${fill}" data-style-span="${spanIndex}" transform="translate(${round(dx)},${round(y)}) scale(${round(scale)})">${shape.paths}</g>`;
    }
    segments.push({ start, end, text: segmentText, protected: protectedText, spanIndex, pattern,
      textureSha256: spanIndex >= 0 ? textures[spanIndex]?.sha256 ?? null : null, scale, bounds });
    dx += shape.advance * scale;
  }
  if (!(maxX > minX && maxY > minY)) fail('EMPTY_GLYPH_OUTLINE');
  return { text, fontId: entry.id, fontFamily: entry.family, fontSha256: entry.sha256, fontWeight: entry.weight,
    approximation: true, b: { minX, minY, maxX, maxY }, width: maxX - minX, height: maxY - minY,
    unitsPerEm: face.unitsPerEm, capHeight: cap, cap, advance: dx, paths, defs: [...definitions.values()].join(''), segments,
    emphasis: recipe.emphasis === 'LARGE' ? 'LARGE' : 'NORMAL', version: LABEL_STYLE_PAINT_VERSION, fingerprint };
}
