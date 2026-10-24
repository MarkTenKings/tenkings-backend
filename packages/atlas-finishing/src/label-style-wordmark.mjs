import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { createLabelStylePaint, validateLabelStylePng, validateLabelStyleTexture } from './label-style-paint.mjs';

export const LABEL_STYLE_WORDMARK_VERSION = 'atlas-label-style-wordmark-v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = code => { throw Error(code); };
const check = (ok, code = 'LABEL_STYLE_WORDMARK_INVALID') => { if (!ok) fail(code); };
const color = value => { check(typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value), 'LABEL_STYLE_COLOR_INVALID'); return value.toLowerCase(); };
const boundary = (text, at) => Number.isSafeInteger(at) && at >= 0 && at <= text.length
  && !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]));

// Matches the compiler's sorted-key, integer-only canonical descriptor format.
// Kept dependency-free so this renderer does not import connected services.
function canonicalDescriptor(value) {
  const seen = new Set();
  const visit = (v, depth) => {
    check(depth <= 40);
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') { check(Number.isSafeInteger(v) && !Object.is(v, -0)); return String(v); }
    check(v && typeof v === 'object' && !seen.has(v)); seen.add(v);
    let out;
    if (Array.isArray(v)) {
      check(Object.keys(v).length === v.length && Reflect.ownKeys(v).length === v.length + 1);
      out = `[${v.map(item => visit(item, depth + 1)).join(',')}]`;
    } else {
      check([Object.prototype, null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(v).length === Object.keys(v).length);
      out = `{${Object.keys(v).sort().map(k => {
        const d = Object.getOwnPropertyDescriptor(v, k); check(d && Object.hasOwn(d, 'value'));
        return `${JSON.stringify(k)}:${visit(d.value, depth + 1)}`;
      }).join(',')}}`;
    }
    seen.delete(v); return out;
  };
  const out = visit(value, 0); check(Buffer.byteLength(out) <= 65536); return out;
}

/** Only removes explicit, spaced middle-dot separators. No spelling, case,
 * punctuation, serial, or word-order correction is permitted here. */
export function labelWordmarkTextProjection(text) {
  check(typeof text === 'string' && text === text.trim() && !/[\u0000-\u001f\u007f]/u.test(text) && text.length <= 512);
  return text.replace(/ +· +/gu, ' ');
}

function ranges(values, text) {
  check(Array.isArray(values) && values.length <= 32); let previous = 0;
  for (const value of values) {
    check(value && boundary(text, value.start) && boundary(text, value.end) && value.end > value.start && value.start >= previous);
    previous = value.end;
  }
  return values;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode the validated, noninterlaced RGBA mask synchronously and enforce
 * white RGB plus alpha. This prevents an opaque photographic image from being
 * accepted as generated lettering, even with self-consistent hashes. */
function readMaskBounds(bytes, width, height, words) {
  const idat = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const stride = width * 4, expected = height * (stride + 1); let raw;
  try { raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected }); } catch { fail('LABEL_STYLE_WORDMARK_MASK_INVALID'); }
  check(raw.length === expected, 'LABEL_STYLE_WORDMARK_MASK_INVALID');
  let prior = Buffer.alloc(stride), minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, ink = 0;
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1), filter = raw[offset], row = Buffer.allocUnsafe(stride);
    check(filter >= 0 && filter <= 4, 'LABEL_STYLE_WORDMARK_MASK_INVALID');
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? row[i - 4] : 0, b = prior[i], c = i >= 4 ? prior[i - 4] : 0;
      row[i] = (raw[offset + 1 + i] + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c))) & 255;
    }
    for (let x = 0; x < width; x++) {
      const at = x * 4;
      check(row[at] === 255 && row[at + 1] === 255 && row[at + 2] === 255, 'LABEL_STYLE_WORDMARK_MASK_INVALID');
      if (row[at + 3] > 0) {
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1); ink++;
        if (row[at + 3] >= 32) check(words.some(w => x >= w.x && x < w.x + w.width && y >= w.y && y < w.y + w.height), 'LABEL_STYLE_WORDMARK_BOX_INVALID');
      }
    }
    prior = row;
  }
  check(ink > 0 && maxX > minX && maxY > minY, 'LABEL_STYLE_WORDMARK_MASK_INVALID');
  return { minX, minY: height - maxY, maxX, maxY: height - minY };
}

/** Original generated lettering -> shared y-up renderer coordinates. The only
 * embedded wordmark image is the small white alpha mask, never its source PNG.
 * Paint is reconstructed from validated recipe spans in original-text offsets. */
export function shapeLabelStyleWordmark({ text, recipe, wordmark, expectedSourceHash, defaultColor = '#ffffff', spanColors, spanTextures,
  idPrefix, outlineColor = '#090a0b', outlineRadiusUnits = 0 } = {}) {
  check(recipe?.text === text && wordmark && isHash(expectedSourceHash), 'LABEL_STYLE_WORDMARK_BINDING_INVALID');
  const d = wordmark.descriptor, projected = labelWordmarkTextProjection(text);
  check(d && d.version === 'atlas-original-label-wordmark-v1' && d.sourceHash === expectedSourceHash
    && d.text === projected && d.role === recipe.role && ['identity', 'variant'].includes(d.role)
    && /^label-wordmark-generate:v1:[a-f0-9]{64}$/.test(d.requestKey)
    && d.ink === 'BLACK_ON_WHITE' && d.mimeType === 'image/png' && isHash(d.artifactHash)
    && d.provenance?.kind === 'ORIGINAL_GENERATED_LETTERING' && d.provenance.sourceFontReproduced === false
    && d.provenance.fontMatchPercentageClaimed === false && d.provenance.ownershipClaimed === false,
  'LABEL_STYLE_WORDMARK_BINDING_INVALID');
  const { artifactHash, ...descriptorBody } = d;
  check(hash(canonicalDescriptor(descriptorBody)) === artifactHash, 'LABEL_STYLE_WORDMARK_BINDING_INVALID');
  check(Number.isSafeInteger(d.width) && d.width > 0 && d.width <= 4096 && Number.isSafeInteger(d.height) && d.height > 0 && d.height <= 512
    && d.mask?.width === d.width && d.mask?.height === d.height && d.mask?.mimeType === 'image/png'
    && typeof d.normalizeWordInkHeight === 'boolean' && d.normalizeWordInkHeight === !!recipe.normalizeWordInkHeight);
  check(Array.isArray(d.words) && d.words.length >= 1 && d.words.length <= 8);
  const tokens = [...text.matchAll(/\S+/gu)].filter(m => m[0] !== '·'), expectedWords = projected.split(' ');
  check(tokens.length === d.words.length && expectedWords.length === d.words.length);
  let generatedStart = 0, previousRight = 0;
  const words = d.words.map((w, i) => {
    check(w.text === expectedWords[i] && w.text === tokens[i][0] && w.start === generatedStart && w.end === generatedStart + w.text.length
      && ['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(w[k]))
      && w.x >= previousRight && w.y >= 0 && w.width > 0 && w.height > 0 && w.x + w.width <= d.width && w.y + w.height <= d.height,
    'LABEL_STYLE_WORDMARK_BOX_INVALID');
    generatedStart = w.end + 1; previousRight = w.x + w.width;
    return { ...w, originalStart: tokens[i].index, originalEnd: tokens[i].index + w.text.length };
  });
  const payload = (base64, descriptor) => ({ pngBase64: base64, sha256: descriptor.sha256, width: descriptor.width, height: descriptor.height });
  try {
    validateLabelStylePng(payload(wordmark.maskBase64, d.mask), { maxWidth: 4096, maxHeight: 512, maxBytes: 262144, colorTypes: [6], maxChunks: 128 });
    validateLabelStylePng(payload(wordmark.pngBase64, d), { maxWidth: 4096, maxHeight: 512, maxBytes: 8 * 1024 * 1024, colorTypes: [0, 2, 4, 6], maxChunks: 1024 });
  } catch { fail('LABEL_STYLE_WORDMARK_PNG_INVALID'); }
  const maskBytes = Buffer.from(wordmark.maskBase64, 'base64');
  check(d.mask.byteCount === maskBytes.length && d.byteCount === Buffer.from(wordmark.pngBase64, 'base64').length, 'LABEL_STYLE_WORDMARK_PNG_INVALID');
  const inkBounds = readMaskBounds(maskBytes, d.width, d.height, words), primary = color(defaultColor), edgeColor = color(outlineColor);
  check(Number.isFinite(outlineRadiusUnits) && outlineRadiusUnits >= 0 && outlineRadiusUnits <= 20, 'LABEL_STYLE_WORDMARK_OUTLINE_INVALID');
  const radius = Number(outlineRadiusUnits.toFixed(4));
  const b = { minX: inkBounds.minX - radius, minY: inkBounds.minY - radius, maxX: inkBounds.maxX + radius, maxY: inkBounds.maxY + radius };
  const spans = ranges(recipe.spans ?? [], text), protectedSpans = ranges(recipe.protectedSpans ?? [], text);
  const styleableSpans = ranges(recipe.styleableSpans ?? [{ start: 0, end: text.length }], text);
  check(!words.some(w => protectedSpans.some(p => w.originalStart < p.end && w.originalEnd > p.start)), 'LABEL_STYLE_WORDMARK_PROTECTED_TEXT');
  check(spanColors === undefined || Array.isArray(spanColors) && spanColors.length === spans.length);
  check(spanTextures === undefined || Array.isArray(spanTextures) && spanTextures.length === spans.length);
  for (const [i, s] of spans.entries()) {
    check(styleableSpans.some(p => s.start >= p.start && s.end <= p.end)
      && ['NONE', 'DIAMOND', 'SHIMMER', 'STRIPES'].includes(s.pattern) && Number.isFinite(s.opticalScale) && s.opticalScale >= 1 && s.opticalScale <= 1.2);
    color(s.baseColor); color(s.accentColor);
    if (spanTextures?.[i] != null) { check(s.pattern !== 'NONE'); validateLabelStyleTexture(spanTextures[i]); }
    check(!words.some(w => s.start < w.originalEnd && s.end > w.originalStart && !(s.start <= w.originalStart && s.end >= w.originalEnd)), 'LABEL_STYLE_WORDMARK_PARTIAL_WORD_PAINT');
  }
  const fingerprint = hash(JSON.stringify({ artifactHash, text, spans, spanColors, textures: spanTextures?.map(t => t?.sha256 ?? null), primary, edgeColor, radius }));
  const prefix = idPrefix ?? `atlas-wordmark-${fingerprint.slice(0, 16)}`;
  check(typeof prefix === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(prefix));
  const maskId = `${prefix}-mask`, imageId = `${prefix}-image`, outlineId = `${prefix}-outline`, filterId = `${prefix}-dilate`, cap = Math.max(...words.map(w => w.height));
  const definitions = new Map(), segments = [];
  const paths = words.map((w, index) => {
    const spanIndex = spans.findIndex(s => s.start <= w.originalStart && s.end >= w.originalEnd), s = spans[spanIndex];
    let fill = primary, pattern = 'NONE';
    if (s) {
      pattern = s.pattern;
      const id = `${prefix}-s${spanIndex}`, paint = createLabelStylePaint({ id, capHeight: cap, pattern,
        baseColor: spanColors?.[spanIndex]?.baseColor ?? s.baseColor, accentColor: spanColors?.[spanIndex]?.accentColor ?? s.accentColor,
        texture: spanTextures?.[spanIndex] });
      fill = paint.fill; if (paint.defs) definitions.set(id, paint.defs);
    }
    const left = index ? (words[index - 1].x + words[index - 1].width + w.x) / 2 : 0;
    const right = index < words.length - 1 ? (w.x + w.width + words[index + 1].x) / 2 : d.width;
    segments.push({ text: w.text, start: w.originalStart, end: w.originalEnd, generatedStart: w.start, generatedEnd: w.end,
      spanIndex, pattern, protected: false, scale: 1, textureSha256: spanTextures?.[spanIndex]?.sha256 ?? null,
      bounds: { minX: w.x, minY: d.height - w.y - w.height, maxX: w.x + w.width, maxY: d.height - w.y } });
    // Word paint spans the inter-word gap, retaining faint antialias pixels.
    // Its Y-flip restores the paint's native font coordinate orientation while
    // the mask is still evaluated in the compiled image's downward coordinates.
    return `<g transform="translate(0,${d.height}) scale(1,-1)"><rect x="${left}" y="0" width="${right - left}" height="${d.height}" fill="${fill}"/></g>`;
  }).join('');
  const imageDef = `<image data-label-wordmark="${d.mask.sha256}" id="${imageId}" x="0" y="0" width="${d.width}" height="${d.height}" href="data:image/png;base64,${wordmark.maskBase64}"/>`;
  const maskDef = `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${d.width}" height="${d.height}"><use href="#${imageId}"/></mask>`;
  const outlineDefs = radius ? `<filter id="${filterId}" filterUnits="userSpaceOnUse" x="${-radius}" y="${-radius}" width="${d.width + 2 * radius}" height="${d.height + 2 * radius}"><feMorphology operator="dilate" radius="${radius}"/></filter><mask id="${outlineId}" maskUnits="userSpaceOnUse" x="${-radius}" y="${-radius}" width="${d.width + 2 * radius}" height="${d.height + 2 * radius}"><use href="#${imageId}" filter="url(#${filterId})"/></mask>` : '';
  const outlinePath = radius ? `<rect x="${-radius}" y="${-radius}" width="${d.width + 2 * radius}" height="${d.height + 2 * radius}" fill="${edgeColor}" mask="url(#${outlineId})"/>` : '';
  return { text, fontId: 'original-generated-wordmark', fontFamily: 'Original generated lettering', fontSha256: d.mask.sha256,
    approximation: false, representation: 'ALPHA_MASK', wordmarkArtifactHash: artifactHash, maskSha256: d.mask.sha256,
    b, inkBounds, width: b.maxX - b.minX, height: b.maxY - b.minY, capHeight: cap, cap, unitsPerEm: cap, advance: d.width,
    outlineRadiusUnits: radius, paths: `<g transform="translate(0,${d.height}) scale(1,-1)">${outlinePath}<g mask="url(#${maskId})">${paths}</g></g>`,
    defs: imageDef + maskDef + outlineDefs + [...definitions.values()].join(''), segments,
    emphasis: recipe.emphasis === 'LARGE' ? 'LARGE' : 'NORMAL', version: LABEL_STYLE_WORDMARK_VERSION, fingerprint };
}
