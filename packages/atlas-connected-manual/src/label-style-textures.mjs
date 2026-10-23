import sharp from 'sharp';
import { canonical, digest, immutable, requireThat } from '@atlas/manual-service/contract';

export const LABEL_STYLE_TEXTURE_POLICY = 'atlas-label-source-texture-v2';
export const LABEL_STYLE_TEXTURE_LIMITS = Object.freeze({ edge: 128, bytes: 65536, sourceBytes: 12 * 1024 * 1024, sourcePixels: 50 * 1024 * 1024 });
const HASH = /^[a-f0-9]{64}$/;
const roles = ['identity', 'variant'];
const patterned = ['DIAMOND', 'SHIMMER', 'STRIPES'];
const check = (value, code) => requireThat(value, 409, code);

function sourceBox(source) {
  check(source && ['FRONT', 'BACK'].includes(source.side) && HASH.test(source.sha256), 'LABEL_STYLE_TEXTURE_SOURCE_INVALID');
  const b = source.box;
  check(b && Object.keys(b).sort().join(',') === 'height,width,x,y' && Object.values(b).every(Number.isFinite)
    && b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0 && b.x + b.width <= 1 && b.y + b.height <= 1,
  'LABEL_STYLE_TEXTURE_BOX_INVALID');
  return b;
}

const hexChannels = value => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value)
  ? [1, 3, 5].map(at => parseInt(value.slice(at, at + 2), 16)) : null;
const luma = (r, g, b) => r * .2126 + g * .7152 + b * .0722;
const round = value => Math.round(value * 1000000) / 1000000;

/** Tone is derived only from the bounded pattern/base-color intent and the
 * verified source pixels. It never depends on card identity, grade or category.
 * Source facet locations/luminance detail remain intact; receipts distinguish
 * a recolored tile from its untouched source crop. */
async function toneTile(data, span) {
  const base = hexChannels(span.baseColor);
  const neutral = base && Math.max(...base) > 0 && (Math.max(...base) - Math.min(...base)) / Math.max(...base) <= .18;
  const kind = span.pattern === 'SHIMMER' && neutral ? 'NEUTRAL_SHIMMER'
    : span.pattern === 'DIAMOND' && base ? 'DARK_DIAMOND_LIFT' : 'SOURCE_UNCHANGED';
  if (kind === 'SOURCE_UNCHANGED') return { data, tone: { kind } };
  const { data: raw, info } = await sharp(data).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  check(info.channels === 4, 'LABEL_STYLE_TEXTURE_OUTPUT_INVALID');
  let inputTotal = 0;
  for (let i = 0; i < raw.length; i += 4) inputTotal += luma(raw[i], raw[i + 1], raw[i + 2]);
  const mean = inputTotal / (info.width * info.height);
  // A low mean alone permits a gentle multiplicative lift. Bright facets and
  // ordinary blue crops are unchanged; a hard20% ceiling prevents washout.
  const gain = kind === 'DARK_DIAMOND_LIFT' && mean > 0 && mean < 95 ? Math.min(1.2, 100 / mean) : 1;
  if (kind === 'DARK_DIAMOND_LIFT' && gain === 1) return { data, tone: { kind: 'SOURCE_UNCHANGED', sourceMeanLuma: round(mean) } };
  const saturation = .12, whiteMix = .12; let outputTotal = 0;
  for (let i = 0; i < raw.length; i += 4) {
    const gray = luma(raw[i], raw[i + 1], raw[i + 2]);
    for (let channel = 0; channel < 3; channel++) {
      const reduced = gray + saturation * (raw[i + channel] - gray);
      raw[i + channel] = kind === 'NEUTRAL_SHIMMER'
        ? Math.round(reduced + whiteMix * (255 - reduced)) : Math.min(255, Math.round(raw[i + channel] * gain));
    }
    outputTotal += luma(raw[i], raw[i + 1], raw[i + 2]);
  }
  const adjusted = await sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9, palette: false, progressive: false }).toBuffer();
  return { data: adjusted, tone: { kind, method: kind === 'NEUTRAL_SHIMMER' ? 'srgb-luma-chroma-reduction-and-white-mix' : 'srgb-channel-gain',
    ...(kind === 'NEUTRAL_SHIMMER' ? { saturation, whiteMix } : { gain: round(gain), maximumGain: 1.2 }),
    sourceMeanLuma: round(mean), outputMeanLuma: round(outputTotal / (info.width * info.height)) } };
}

/** Derive small texture tiles solely from caller-supplied verified photographs.
 * Model recipes remain immutable. Returned bytes/receipts are a separate,
 * source-bound render payload; no storage, network, metadata or grade writes. */
export async function deriveLabelStyleTextures({ recipe, photos, signal } = {}) {
  check(recipe && Array.isArray(recipe.lines) && recipe.lines.length > 0 && recipe.lines.length <= 2
    && new Set(recipe.lines.map(l => l.role)).size === recipe.lines.length && photos && typeof photos === 'object',
  'LABEL_STYLE_TEXTURE_RECIPE_INVALID');
  const recipeHash = digest(canonical(recipe, { maxBytes: 128 * 1024 })), verified = new Map(), tiles = new Map();
  async function photoFor(source) {
    if (verified.has(source.side)) {
      const saved = verified.get(source.side);
      check(saved.sha256 === source.sha256, 'LABEL_STYLE_TEXTURE_PHOTO_CHANGED');
      return saved;
    }
    const photo = photos[source.side];
    check(photo && Buffer.isBuffer(photo.bytes) && photo.bytes.length > 0 && photo.bytes.length <= LABEL_STYLE_TEXTURE_LIMITS.sourceBytes
      && photo.sha256 === source.sha256 && digest(photo.bytes) === source.sha256, 'LABEL_STYLE_TEXTURE_PHOTO_CHANGED');
    let meta;
    try { meta = await sharp(photo.bytes, { limitInputPixels: LABEL_STYLE_TEXTURE_LIMITS.sourcePixels, failOn: 'warning', animated: false }).metadata(); }
    catch { check(false, 'LABEL_STYLE_TEXTURE_PHOTO_INVALID'); }
    check(['jpeg', 'png', 'webp'].includes(meta.format) && (meta.pages ?? 1) === 1 && (meta.orientation ?? 1) === 1
      && Number.isSafeInteger(meta.width) && Number.isSafeInteger(meta.height) && meta.width > 0 && meta.height > 0
      && meta.width <= 20000 && meta.height <= 20000 && meta.width * meta.height <= LABEL_STYLE_TEXTURE_LIMITS.sourcePixels
      && (photo.width === undefined || photo.width === meta.width) && (photo.height === undefined || photo.height === meta.height),
    'LABEL_STYLE_TEXTURE_PHOTO_INVALID');
    const saved = { bytes: photo.bytes, sha256: source.sha256, width: meta.width, height: meta.height };
    verified.set(source.side, saved);
    return saved;
  }
  const lines = [], receipts = [];
  for (const line of recipe.lines) {
    check(roles.includes(line.role) && typeof line.text === 'string' && Array.isArray(line.spans) && line.spans.length <= 32,
      'LABEL_STYLE_TEXTURE_RECIPE_INVALID');
    const spanTextures = [], lineReceipts = [];
    for (const [spanIndex, span] of line.spans.entries()) {
      signal?.throwIfAborted();
      const common = { role: line.role, spanIndex, start: span.start, end: span.end, pattern: span.pattern };
      check(Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end) && span.start >= 0 && span.end > span.start
        && span.end <= line.text.length && ['NONE', ...patterned].includes(span.pattern), 'LABEL_STYLE_TEXTURE_RECIPE_INVALID');
      let texture = null, receipt;
      if (span.pattern === 'NONE') receipt = { ...common, status: 'NOT_REQUESTED', reason: 'FLAT_FILL' };
      else if (!span.source || span.source.basis === 'UNAVAILABLE') receipt = { ...common, status: 'PROCEDURAL_FALLBACK', reason: 'SOURCE_UNAVAILABLE' };
      else if (span.source.confidence === 'LOW') receipt = { ...common, status: 'PROCEDURAL_FALLBACK', reason: 'SOURCE_UNCERTAIN' };
      else if (span.source.basis === 'PRINTED_LETTERING') receipt = { ...common, status: 'PROCEDURAL_FALLBACK', reason: 'LETTERING_IS_NOT_FIELD_TEXTURE' };
      else {
        check(['CARD_FIELD', 'CARD_BORDER'].includes(span.source.basis) && ['HIGH', 'MEDIUM'].includes(span.source.confidence), 'LABEL_STYLE_TEXTURE_SOURCE_INVALID');
        const normalized = sourceBox(span.source), photo = await photoFor(span.source);
        // Out-of-range boxes are rejected above. Clamping here handles only
        // integer rounding at the right/bottom edge of a valid normalized box.
        const left = Math.floor(normalized.x * photo.width), top = Math.floor(normalized.y * photo.height);
        const right = Math.min(photo.width, Math.ceil((normalized.x + normalized.width) * photo.width));
        const bottom = Math.min(photo.height, Math.ceil((normalized.y + normalized.height) * photo.height));
        const crop = { left, top, width: right - left, height: bottom - top };
        check(crop.width > 0 && crop.height > 0, 'LABEL_STYLE_TEXTURE_BOX_INVALID');
        const cropBinding = { side: span.source.side, sha256: photo.sha256, normalized: { ...normalized },
          sourceDimensions: { width: photo.width, height: photo.height }, cropBox: crop };
        const tileKey = digest(canonical({ policy: LABEL_STYLE_TEXTURE_POLICY, cropBinding, pattern: span.pattern, baseColor: span.baseColor ?? null }));
        let saved = tiles.get(tileKey);
        if (!saved) {
          const { data, info } = await sharp(photo.bytes, { limitInputPixels: LABEL_STYLE_TEXTURE_LIMITS.sourcePixels, failOn: 'warning' })
            .extract(crop).resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
            .toColourspace('srgb').png({ compressionLevel: 9, palette: false, progressive: false }).toBuffer({ resolveWithObject: true });
          check(data.length <= LABEL_STYLE_TEXTURE_LIMITS.bytes && info.width > 0 && info.height > 0 && info.width <= 128 && info.height <= 128,
            'LABEL_STYLE_TEXTURE_OUTPUT_INVALID');
          const toned = await toneTile(data, span);
          check(toned.data.length <= LABEL_STYLE_TEXTURE_LIMITS.bytes, 'LABEL_STYLE_TEXTURE_OUTPUT_INVALID');
          saved = { payload: { pngBase64: toned.data.toString('base64'), sha256: digest(toned.data), width: info.width, height: info.height },
            byteCount: toned.data.length, sourceTileSha256: digest(data), tone: toned.tone };
          tiles.set(tileKey, saved);
        }
        texture = saved.payload;
        receipt = { ...common, status: 'READY', source: cropBinding, basis: span.source.basis,
          output: { sha256: texture.sha256, width: texture.width, height: texture.height, byteCount: saved.byteCount, contentType: 'image/png' },
          processing: { colorSpace: 'srgb', resize: 'inside-128-no-enlargement', kernel: 'lanczos3', pattern: 'repeat-aspect-preserved-glyph-fill',
            sourceTileSha256: saved.sourceTileSha256, tone: saved.tone } };
      }
      spanTextures.push(texture); lineReceipts.push(receipt); receipts.push(receipt);
    }
    lines.push({ role: line.role, text: line.text, spanTextures, receipts: lineReceipts });
  }
  signal?.throwIfAborted();
  return immutable({ version: LABEL_STYLE_TEXTURE_POLICY, recipeHash, lines, receipts,
    payloadHash: digest(canonical({ version: LABEL_STYLE_TEXTURE_POLICY, recipeHash, receipts })) });
}
