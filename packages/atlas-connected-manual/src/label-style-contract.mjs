import { canonical, digest, immutable, requireThat } from '@atlas/manual-service/contract';
import { applyReviewedLabelStylePreferences } from '../../atlas-finishing/src/label-style-preferences.mjs';

export const LABEL_STYLE_POLICY = 'atlas-photo-informed-label-style-v1';
export const LABEL_STYLE_MODEL = 'gpt-6-astra';
export const LABEL_STYLE_REASONING = 'xhigh';
export const LABEL_STYLE_DEFAULT_FONT_ID = 'atlas-rush';
// The default face is part of the immutable request/cache key. Earlier Knewave
// requests retain their original projection and cache validation behavior.
export const usesAtlasLabelDefault = request => request.defaultFontId === LABEL_STYLE_DEFAULT_FONT_ID;
export const LABEL_STYLE_PATTERNS = Object.freeze(['NONE', 'DIAMOND', 'SHIMMER', 'STRIPES']);
export const LABEL_STYLE_LETTERING_TRAITS = Object.freeze(['BRUSH', 'SCRIPT', 'HAND_DRAWN', 'BLOCK', 'SERIF', 'SANS',
  'CONDENSED', 'WIDE', 'UPRIGHT', 'ITALIC', 'LIGHT', 'MEDIUM', 'BOLD', 'HEAVY', 'CLEAN', 'ROUGH', 'DRY_BRUSH', 'TIGHT', 'OPEN']);
export const LABEL_STYLE_LIMITS = Object.freeze({ lines: 2, spans: 12, fonts: 24, imageBytes: 12 * 1024 * 1024,
  totalImageBytes: 24 * 1024 * 1024, responseBytes: 512 * 1024, timeoutMs: 300000, maxOutputTokens: 8000 });
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const COLOR = /^#[A-Fa-f0-9]{6}$/;
const ROLES = ['identity', 'variant'];
const BASIS = ['PRINTED_LETTERING', 'CARD_FIELD', 'CARD_BORDER', 'UNAVAILABLE'];
const CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'];
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const safeText = (value, max, empty = false) => typeof value === 'string' && value.length <= max
  && (empty || value.trim().length > 0) && !/[\x00-\x1f\x7f]/u.test(value);
const exact = (value, required, optional = [], code = 'LABEL_STYLE_INPUT_INVALID') => requireThat(plain(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 409, code);
const hashed = (value, code = 'LABEL_STYLE_INPUT_INVALID') => requireThat(typeof value === 'string' && HASH.test(value), 409, code);
const clone = value => JSON.parse(canonical(value, { maxBytes: 128 * 1024 }));
const boundary = (text, at) => Number.isInteger(at) && at >= 0 && at <= text.length
  && !(at > 0 && at < text.length && /[\uD800-\uDBFF]/u.test(text[at - 1]) && /[\uDC00-\uDFFF]/u.test(text[at]));
function span(value, text, code = 'LABEL_STYLE_INPUT_INVALID') {
  exact(value, ['start', 'end'], [], code);
  requireThat(boundary(text, value.start) && boundary(text, value.end) && value.start < value.end, 409, code);
  return { start: value.start, end: value.end };
}
function spans(values, text, code = 'LABEL_STYLE_INPUT_INVALID') {
  requireThat(Array.isArray(values) && values.length <= LABEL_STYLE_LIMITS.spans, 409, code);
  const result = values.map(value => span(value, text, code)).sort((a, b) => a.start - b.start);
  requireThat(result.every((value, index) => !index || value.start >= result[index - 1].end), 409, code);
  return result;
}
function protectedSerialSpans(text) {
  // Every displayed serial fraction keeps the renderer's primary contrast ink.
  // It is descriptive label text, never a source for invented numbering.
  return [...text.matchAll(/(?:\d{1,8})?\/\d{1,8}(?!\d)/gu)].map(match => ({ start: match.index, end: match.index + match[0].length }));
}
function normalizedLine(line) {
  exact(line, ['role', 'text'], ['styleableSpans']);
  requireThat(ROLES.includes(line.role) && safeText(line.text, 512), 409, 'LABEL_STYLE_INPUT_INVALID');
  const styleableSpans = spans(line.styleableSpans ?? [{ start: 0, end: line.text.length }], line.text);
  const protectedSpans = protectedSerialSpans(line.text);
  requireThat(protectedSpans.length <= 32, 409, 'LABEL_STYLE_INPUT_INVALID');
  return { role: line.role, text: line.text, styleableSpans, protectedSpans };
}

/** Display alias only. A lone Refractor (and a one-word qualifier) is retained.
 * The caller keeps the original approved parallel in the immutable identity. */
export function labelStyleDisplayParallel(value) {
  if (value === null || value === undefined) return { text: value ?? null, abbreviations: [] };
  requireThat(safeText(value, 180), 409, 'LABEL_STYLE_INPUT_INVALID');
  const match = /^(\S(?:.*\S)?)\s+Refractor$/iu.exec(value.trim());
  const words = match?.[1].match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
  if (words.length < 2 || !words.some(word => /\p{L}/u.test(word)) || /^(?:base|standard|regular)\b/iu.test(match[1]))
    return { text: value, abbreviations: [] };
  return { text: match[1], abbreviations: [{ field: 'parallel', from: value, to: match[1], reason: 'specific-parallel-omit-refractor-v1' }] };
}

/** Only verified packaged font descriptors enter the model's finite vocabulary.
 * No supplied family/path/URL becomes executable font loading. */
export function prepareLabelStyleRequest(input, { fontCatalog, defaultFontId } = {}) {
  exact(input, ['approval', 'identity', 'cardProfile', 'photos', 'lines']);
  exact(input.approval, ['cardId', 'actionId', 'approvalVersion', 'publicHash', 'reportHash']);
  const approval = input.approval;
  requireThat(UUID.test(approval.cardId) && UUID.test(approval.actionId)
    && Number.isSafeInteger(approval.approvalVersion) && approval.approvalVersion > 0 && approval.approvalVersion <= 2147483647,
  409, 'LABEL_STYLE_APPROVAL_INVALID');
  hashed(approval.publicHash); hashed(approval.reportHash);
  requireThat(['SPORTS', 'POKEMON'].includes(input.cardProfile) && plain(input.identity)
    && Object.hasOwn(input.identity, input.cardProfile === 'SPORTS' ? 'playerName' : 'cardName'), 409, 'LABEL_STYLE_INPUT_INVALID');
  // The finishing adapter proves the actual human-approved identity. Preserve
  // every applicable field here, including facts omitted from display captions.
  const identity = JSON.parse(canonical(input.identity, { maxBytes: 16384 }));
  requireThat(Array.isArray(input.photos) && input.photos.length === 2, 409, 'LABEL_STYLE_PHOTO_PAIR_REQUIRED');
  const photos = input.photos.map(photo => {
    exact(photo, ['side', 'sha256', 'contentType', 'width', 'height', 'byteCount']);
    hashed(photo.sha256);
    requireThat(['FRONT', 'BACK'].includes(photo.side) && ['image/jpeg', 'image/png', 'image/webp'].includes(photo.contentType)
      && Number.isSafeInteger(photo.width) && photo.width > 0 && photo.width <= 20000
      && Number.isSafeInteger(photo.height) && photo.height > 0 && photo.height <= 20000
      && photo.width * photo.height <= 50 * 1024 * 1024
      && Number.isSafeInteger(photo.byteCount) && photo.byteCount > 0 && photo.byteCount <= LABEL_STYLE_LIMITS.imageBytes,
    409, 'LABEL_STYLE_PHOTO_INVALID');
    return { ...photo };
  }).sort((a, b) => ['FRONT', 'BACK'].indexOf(a.side) - ['FRONT', 'BACK'].indexOf(b.side));
  requireThat(photos[0].side === 'FRONT' && photos[1].side === 'BACK'
    && photos.reduce((total, photo) => total + photo.byteCount, 0) <= LABEL_STYLE_LIMITS.totalImageBytes, 409, 'LABEL_STYLE_PHOTO_PAIR_REQUIRED');
  requireThat(Array.isArray(input.lines) && input.lines.length > 0 && input.lines.length <= LABEL_STYLE_LIMITS.lines, 409, 'LABEL_STYLE_INPUT_INVALID');
  const lines = input.lines.map(normalizedLine).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  requireThat(new Set(lines.map(line => line.role)).size === lines.length, 409, 'LABEL_STYLE_INPUT_INVALID');
  requireThat(Array.isArray(fontCatalog) && fontCatalog.length > 0 && fontCatalog.length <= LABEL_STYLE_LIMITS.fonts, 409, 'LABEL_STYLE_FONT_CATALOG_INVALID');
  const fonts = fontCatalog.map(font => {
    exact(font, ['id', 'family', 'sha256', 'traits'], ['weight', 'license', 'approximation'], 'LABEL_STYLE_FONT_CATALOG_INVALID');
    requireThat(ID.test(font.id) && safeText(font.family, 100) && Array.isArray(font.traits) && font.traits.length > 0 && font.traits.length <= 8
      && font.traits.every(trait => safeText(trait, 80)), 409, 'LABEL_STYLE_FONT_CATALOG_INVALID');
    hashed(font.sha256, 'LABEL_STYLE_FONT_CATALOG_INVALID');
    requireThat((font.weight === undefined || Number.isInteger(font.weight) && font.weight >= 100 && font.weight <= 1000)
      && (font.license === undefined || safeText(font.license, 80))
      && (font.approximation === undefined || typeof font.approximation === 'boolean'), 409, 'LABEL_STYLE_FONT_CATALOG_INVALID');
    return { ...font, traits: [...font.traits] };
  }).sort((a, b) => a.id.localeCompare(b.id));
  requireThat(new Set(fonts.map(font => font.id)).size === fonts.length && fonts.some(font => font.id === defaultFontId), 409, 'LABEL_STYLE_FONT_CATALOG_INVALID');
  const source = { approval: { ...approval }, identity, cardProfile: input.cardProfile, photos, lines };
  const request = { policy: LABEL_STYLE_POLICY, model: LABEL_STYLE_MODEL, reasoning: LABEL_STYLE_REASONING,
    source, sourceHash: digest(canonical(source)), fontCatalog: fonts, fontCatalogHash: digest(canonical(fonts)), defaultFontId };
  return immutable({ ...request, requestKey: `label-style:v1:${digest(canonical(request))}` });
}

export function validateLabelStyleRequest(request) {
  requireThat(plain(request), 409, 'LABEL_STYLE_REQUEST_INVALID');
  const input = request.source && { approval: request.source.approval, identity: request.source.identity,
    cardProfile: request.source.cardProfile, photos: request.source.photos,
    lines: request.source.lines?.map(({ role, text, styleableSpans }) => ({ role, text, styleableSpans })) };
  const expected = prepareLabelStyleRequest(input, { fontCatalog: request.fontCatalog, defaultFontId: request.defaultFontId });
  requireThat(canonical(expected) === canonical(request), 409, 'LABEL_STYLE_REQUEST_CHANGED');
  return expected;
}

const objectSchema = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const nullable = value => ({ anyOf: [value, { type: 'null' }] });
export function labelStyleOutputSchema(rawRequest) {
  const request = validateLabelStyleRequest(rawRequest);
  const region = nullable(objectSchema({ x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }));
  const source = objectSchema({ side: { type: ['string', 'null'], enum: ['FRONT', 'BACK', null] },
    sha256: { type: ['string', 'null'], enum: [...request.source.photos.map(photo => photo.sha256), null] }, box: region,
    basis: { type: 'string', enum: BASIS }, confidence: { type: 'string', enum: CONFIDENCE }, observation: { type: 'string' } });
  return objectSchema({ lines: { type: 'array', items: objectSchema({ role: { type: 'string', enum: request.source.lines.map(line => line.role) },
    letteringMode: { type: 'string', enum: ['CATALOG', 'ORIGINAL_WORDMARK'] }, letteringDescription: { type: 'string' },
    letteringTraits: { type: 'array', items: { type: 'string', enum: LABEL_STYLE_LETTERING_TRAITS } },
    fontId: { type: ['string', 'null'], enum: [...request.fontCatalog.map(font => font.id), null] }, fontSource: source,
    emphasis: { type: 'string', enum: ['NORMAL', 'LARGE'] }, normalizeWordInkHeight: { type: 'boolean' },
    spans: { type: 'array', items: objectSchema({ start: { type: 'integer' }, end: { type: 'integer' },
      baseColor: { type: 'string' }, accentColor: { type: 'string' }, pattern: { type: 'string', enum: LABEL_STYLE_PATTERNS },
      opticalScale: { type: 'number' }, source }) },
  }) } });
}
function validateSource(value, request) {
  const code = 'LABEL_STYLE_OBSERVATION_INVALID';
  exact(value, ['side', 'sha256', 'box', 'basis', 'confidence', 'observation'], [], code);
  requireThat(BASIS.includes(value.basis) && CONFIDENCE.includes(value.confidence) && safeText(value.observation, 600), 502, code);
  if (value.basis === 'UNAVAILABLE') {
    requireThat(value.side === null && value.sha256 === null && value.box === null && value.confidence === 'LOW', 502, code);
  } else {
    requireThat(request.source.photos.some(photo => photo.side === value.side && photo.sha256 === value.sha256), 502, code);
    exact(value.box, ['x', 'y', 'width', 'height'], [], code);
    const box = value.box;
    requireThat(Object.values(box).every(Number.isFinite) && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
      && box.x + box.width <= 1 && box.y + box.height <= 1, 502, code);
  }
  return clone(value);
}
function validateObservation(raw, request) {
  const code = 'LABEL_STYLE_OBSERVATION_INVALID';
  exact(raw, ['lines'], [], code);
  requireThat(Array.isArray(raw.lines) && raw.lines.length === request.source.lines.length
    && new Set(raw.lines.map(line => line?.role)).size === raw.lines.length, 502, code);
  return { lines: request.source.lines.map(line => {
    let value = raw.lines.find(entry => entry?.role === line.role);
    exact(value, ['role', 'letteringMode', 'letteringDescription', 'letteringTraits', 'fontId', 'fontSource', 'emphasis', 'normalizeWordInkHeight', 'spans'], [], code);
    requireThat((value.fontId === null || request.fontCatalog.some(font => font.id === value.fontId))
      && ['NORMAL', 'LARGE'].includes(value.emphasis) && typeof value.normalizeWordInkHeight === 'boolean'
      && ['CATALOG', 'ORIGINAL_WORDMARK'].includes(value.letteringMode) && safeText(value.letteringDescription, 800, true)
      && Array.isArray(value.letteringTraits) && value.letteringTraits.length <= 8
      && new Set(value.letteringTraits).size === value.letteringTraits.length
      && value.letteringTraits.every(trait => LABEL_STYLE_LETTERING_TRAITS.includes(trait))
      && Array.isArray(value.spans) && value.spans.length <= LABEL_STYLE_LIMITS.spans, 502, code);
    // HAND_DRAWN is generic morphology; one specific family makes it redundant.
    // Never choose between conflicting specific families or change weights.
    if (value.letteringMode === 'ORIGINAL_WORDMARK' && value.letteringTraits.includes('HAND_DRAWN')
      && value.letteringTraits.filter(trait => ['BRUSH', 'SCRIPT', 'BLOCK', 'SERIF', 'SANS'].includes(trait)).length === 1)
      value = { ...value, letteringTraits: value.letteringTraits.filter(trait => trait !== 'HAND_DRAWN') };
    if (value.letteringMode === 'ORIGINAL_WORDMARK') {
      requireThat(line.role === 'variant' && line.protectedSpans.length === 0
        && line.styleableSpans.length === 1 && line.styleableSpans[0].start === 0
        && line.styleableSpans[0].end === line.text.length, 502, code);
      requireThat(value.letteringDescription.trim().length > 0
        && value.letteringTraits.filter(trait => ['BRUSH', 'SCRIPT', 'HAND_DRAWN', 'BLOCK', 'SERIF', 'SANS'].includes(trait)).length === 1
        && value.letteringTraits.filter(trait => ['LIGHT', 'MEDIUM', 'BOLD', 'HEAVY'].includes(trait)).length === 1,
      502, code);
      for (const options of [['CONDENSED', 'WIDE'], ['UPRIGHT', 'ITALIC'], ['CLEAN', 'ROUGH', 'DRY_BRUSH'], ['TIGHT', 'OPEN']])
        requireThat(options.filter(trait => value.letteringTraits.includes(trait)).length <= 1, 502, code);
    }
    const fontSource = validateSource(value.fontSource, request);
    if (value.letteringMode === 'ORIGINAL_WORDMARK') requireThat(fontSource.basis !== 'UNAVAILABLE'
      && fontSource.confidence !== 'LOW', 502, code);
    const paint = value.spans.map(part => {
      exact(part, ['start', 'end', 'baseColor', 'accentColor', 'pattern', 'opticalScale', 'source'], [], code);
      span({ start: part.start, end: part.end }, line.text, code);
      requireThat(COLOR.test(part.baseColor) && COLOR.test(part.accentColor) && LABEL_STYLE_PATTERNS.includes(part.pattern)
        && Number.isFinite(part.opticalScale) && part.opticalScale >= 1 && part.opticalScale <= 1.2, 502, code);
      // Original raster lettering is independently measured per whole word.
      // Reject a color/pattern boundary inside one before buying that artwork;
      // catalog outlines continue to support exact character-offset paint.
      if (value.letteringMode === 'ORIGINAL_WORDMARK') {
        const words = [...line.text.matchAll(/\S+/gu)].filter(match => match[0] !== '·');
        requireThat(!words.some(word => part.start < word.index + word[0].length && part.end > word.index
          && !(part.start <= word.index && part.end >= word.index + word[0].length)), 502, code);
      }
      return { ...part, baseColor: part.baseColor.toUpperCase(), accentColor: part.accentColor.toUpperCase(), source: validateSource(part.source, request) };
    }).sort((a, b) => a.start - b.start);
    requireThat(paint.every((part, index) => !index || part.start >= paint[index - 1].end)
      && new Set(paint.flatMap(part => [part.baseColor, part.accentColor])).size <= 8, 502, code);
    return { ...value, fontSource, spans: paint };
  }) };
}
function allowedSegments(part, line, request) {
  const inside = line.styleableSpans.flatMap(allowed => {
    const start = Math.max(allowed.start, part.start), end = Math.min(allowed.end, part.end);
    return start < end ? [{ start, end }] : [];
  });
  // A numbered base card can have only /500 on this row. Keep its photographed
  // palette evidence so protected serial glyphs can inherit that color too.
  // Mixed captions and every older request retain ordinary serial exclusion.
  const serial = line.protectedSpans.length === 1 && line.protectedSpans[0];
  if (usesAtlasLabelDefault(request) && line.role === 'variant' && serial
    && !`${line.text.slice(0, serial.start)}${line.text.slice(serial.end)}`.trim()) return inside;
  return line.protectedSpans.reduce((segments, protectedSpan) => segments.flatMap(segment => {
    if (protectedSpan.end <= segment.start || protectedSpan.start >= segment.end) return [segment];
    return [{ start: segment.start, end: Math.min(protectedSpan.start, segment.end) },
      { start: Math.max(protectedSpan.end, segment.start), end: segment.end }].filter(value => value.start < value.end);
  }), inside);
}
function result(request, lines, provenance) {
  const value = { version: LABEL_STYLE_POLICY, requestKey: request.requestKey, sourceHash: request.sourceHash,
    fontCatalogHash: request.fontCatalogHash, lines, provenance };
  return immutable({ ...value, specHash: digest(canonical(value)) });
}
function fallbackLine(line, request, reason) {
  const font = request.fontCatalog.find(entry => entry.id === request.defaultFontId);
  return { ...clone(line), fontId: font.id, fontSha256: font.sha256, fontSource: null,
    letteringMode: 'CATALOG', letteringDescription: '', letteringTraits: [],
    emphasis: 'NORMAL', normalizeWordInkHeight: false, spans: [], status: 'FALLBACK', fallbackReasons: [reason] };
}

/** Deterministic projection, never visual inference. Evidence confidence is a
 * model assessment, not a measured font-match percentage. A recipe is an
 * approximation using packaged faces, original lettering requests and bounded
 * patterns. Optional photo texture extraction is a separate exact-byte-bound
 * operation; this model result contains only a source region, never pixels. */
export function compileLabelStyleSpec(rawRequest, rawObservation, { requestSha256, responseSha256 } = {}) {
  const request = validateLabelStyleRequest(rawRequest);
  hashed(requestSha256, 'LABEL_STYLE_RESPONSE_BINDING_INVALID'); hashed(responseSha256, 'LABEL_STYLE_RESPONSE_BINDING_INVALID');
  const observation = validateObservation(rawObservation, request);
  const lines = request.source.lines.map((line, index) => {
    const value = observation.lines[index], fallbackReasons = [];
    const requiresPrintedLettering = usesAtlasLabelDefault(request) && line.role === 'variant';
    const hasPrintedLettering = value.fontSource.basis === 'PRINTED_LETTERING' && value.fontSource.confidence !== 'LOW';
    const useDefaultFace = requiresPrintedLettering && !hasPrintedLettering;
    const original = value.letteringMode === 'ORIGINAL_WORDMARK' && !useDefaultFace;
    const fontAvailable = !original && !useDefaultFace && value.fontId !== null && value.fontSource.basis !== 'UNAVAILABLE' && value.fontSource.confidence !== 'LOW';
    const selectedFont = request.fontCatalog.find(font => font.id === (fontAvailable ? value.fontId : request.defaultFontId));
    if (!fontAvailable) fallbackReasons.push('FONT_MATCH_UNAVAILABLE');
    if (useDefaultFace) fallbackReasons.push('NO_PRINTED_VARIANT_LETTERING');
    if (original) fallbackReasons.push('ORIGINAL_WORDMARK_REQUIRED');
    let paint = value.spans.flatMap(part => {
      if (part.source.basis === 'UNAVAILABLE' || part.source.confidence === 'LOW') { fallbackReasons.push('PAINT_EVIDENCE_UNCERTAIN'); return []; }
      const segments = allowedSegments(part, line, request);
      if (segments.length !== 1 || segments[0].start !== part.start || segments[0].end !== part.end) fallbackReasons.push('PROTECTED_TEXT_PRIMARY');
      return segments.map(segment => ({ ...part, ...segment }));
    });
    if (paint.length > 32) { paint = []; fallbackReasons.push('PAINT_COMPLEXITY_UNSUPPORTED'); }
    const informed = original || fontAvailable || paint.length > 0;
    return { ...clone(line), fontId: selectedFont.id, fontSha256: selectedFont.sha256, fontSource: fontAvailable || original ? value.fontSource : null,
      letteringMode: useDefaultFace ? 'CATALOG' : value.letteringMode,
      letteringDescription: useDefaultFace ? '' : value.letteringDescription, letteringTraits: useDefaultFace ? [] : [...value.letteringTraits],
      emphasis: informed ? value.emphasis : 'NORMAL', normalizeWordInkHeight: !useDefaultFace && informed && value.normalizeWordInkHeight,
      spans: paint, status: original ? 'WORDMARK_REQUIRED' : informed ? 'PHOTO_INFORMED' : 'FALLBACK', fallbackReasons: [...new Set(fallbackReasons)] };
  });
  const normalizations = observation.lines.flatMap(line => {
    if (lines.find(value => value.role === line.role).letteringMode !== 'ORIGINAL_WORDMARK') return [];
    const original = rawObservation.lines.find(value => value.role === line.role);
    return canonical(original.letteringTraits) === canonical(line.letteringTraits) ? [] : [{ role: line.role, field: 'letteringTraits',
      rule: 'drop-redundant-hand-drawn-v1', removed: ['HAND_DRAWN'], retained: [...line.letteringTraits] }];
  });
  return result(request, lines, { kind: 'MODEL_OBSERVATION', model: LABEL_STYLE_MODEL, reasoning: LABEL_STYLE_REASONING,
    requestSha256, responseSha256, observationHash: digest(canonical(observation)), approximation: true,
    ...(normalizations.length ? { rawObservationHash: digest(canonical(rawObservation)), normalizations } : {}) });
}

/** A font fallback is allowed; inventing a card palette is not. The production
 * styler calls this after trusted feedback, before texture/wordmark work. Serial
 * ink inherits an evidenced palette in the renderer and needs no direct span. */
export function assertLabelStylePhotoColors(spec, request) {
  if (!usesAtlasLabelDefault(request)) return;
  for (const line of spec.lines.filter(line => line.role === 'variant')) {
    const styled = at => line.styleableSpans.some(span => at >= span.start && at < span.end);
    const protectedAt = at => line.protectedSpans.some(span => at >= span.start && at < span.end);
    const covered = at => line.spans.some(span => at >= span.start && at < span.end);
    requireThat(line.spans.length > 0 && [...line.text.matchAll(/\S/gu)].every(match =>
      match[0] === '·' || !styled(match.index) || protectedAt(match.index) || covered(match.index)),
    409, 'LABEL_STYLE_CARD_COLOR_REQUIRED');
  }
}

export function fallbackLabelStyleSpec(rawRequest, reason = 'STYLE_UNAVAILABLE') {
  const request = validateLabelStyleRequest(rawRequest);
  requireThat(typeof reason === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(reason), 409, 'LABEL_STYLE_FALLBACK_INVALID');
  return result(request, request.source.lines.map(line => fallbackLine(line, request, reason)),
    { kind: 'DETERMINISTIC_FALLBACK', reason, approximation: true });
}

/** Checks stored projection integrity and exact source/font binding. Replaying
 * a saved cache record additionally recompiles from its retained observation. */
export function validateLabelStyleSpec(spec, rawRequest, { baseSpec } = {}) {
  const request = validateLabelStyleRequest(rawRequest);
  if (spec?.provenance?.kind === 'REVIEWED_STYLE_FEEDBACK') {
    requireThat(baseSpec && ['MODEL_OBSERVATION', 'DETERMINISTIC_FALLBACK'].includes(baseSpec.provenance?.kind),
      409, 'LABEL_STYLE_REVIEWED_BASE_REQUIRED');
    const original = validateLabelStyleSpec(baseSpec, request);
    const expected = applyReviewedLabelStylePreferences(original, request.source.photos);
    // Only the repository-pinned photo+caption preferences may add reviewed
    // metrics or replace model choices. Client-supplied receipts confer no trust.
    requireThat(expected.provenance?.kind === 'REVIEWED_STYLE_FEEDBACK' && canonical(expected) === canonical(spec),
      409, 'LABEL_STYLE_REVIEWED_SPEC_CHANGED');
    return immutable(clone(expected));
  }
  exact(spec, ['version', 'requestKey', 'sourceHash', 'fontCatalogHash', 'lines', 'provenance', 'specHash'], [], 'LABEL_STYLE_SPEC_INVALID');
  const { specHash, ...value } = spec;
  hashed(specHash, 'LABEL_STYLE_SPEC_INVALID');
  requireThat(spec.version === LABEL_STYLE_POLICY && spec.requestKey === request.requestKey && spec.sourceHash === request.sourceHash
    && spec.fontCatalogHash === request.fontCatalogHash && digest(canonical(value)) === specHash,
  409, 'LABEL_STYLE_SPEC_CHANGED');
  // Cache consumers must not accept extra text, unregistered fonts or unbound
  // raw rendering instructions even if an attacker recomputes the outer hash.
  requireThat(Array.isArray(spec.lines) && spec.lines.length === request.source.lines.length, 409, 'LABEL_STYLE_SPEC_INVALID');
  spec.lines.forEach((line, index) => {
    const original = request.source.lines[index], font = request.fontCatalog.find(entry => entry.id === line.fontId);
    exact(line, ['role', 'text', 'styleableSpans', 'protectedSpans', 'fontId', 'fontSha256', 'fontSource', 'emphasis',
      'letteringMode', 'letteringDescription', 'letteringTraits', 'normalizeWordInkHeight', 'spans', 'status', 'fallbackReasons'], [], 'LABEL_STYLE_SPEC_INVALID');
    requireThat(line.role === original.role && line.text === original.text && canonical(line.styleableSpans) === canonical(original.styleableSpans)
      && canonical(line.protectedSpans) === canonical(original.protectedSpans) && font?.sha256 === line.fontSha256,
    409, 'LABEL_STYLE_SPEC_CHANGED');
    if (usesAtlasLabelDefault(request) && line.role === 'variant'
      && (line.fontId !== request.defaultFontId || line.letteringMode === 'ORIGINAL_WORDMARK'))
      requireThat(line.fontSource?.basis === 'PRINTED_LETTERING' && ['HIGH', 'MEDIUM'].includes(line.fontSource.confidence),
        409, 'LABEL_STYLE_SPEC_INVALID');
    requireThat(['NORMAL', 'LARGE'].includes(line.emphasis) && typeof line.normalizeWordInkHeight === 'boolean'
      && ['PHOTO_INFORMED', 'FALLBACK', 'WORDMARK_REQUIRED'].includes(line.status)
      && Array.isArray(line.fallbackReasons) && line.fallbackReasons.length <= 8
      && line.fallbackReasons.every(reason => typeof reason === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(reason))
      && Array.isArray(line.spans) && line.spans.length <= 32, 409, 'LABEL_STYLE_SPEC_INVALID');
    const unavailable = { side: null, sha256: null, box: null, basis: 'UNAVAILABLE', confidence: 'LOW', observation: 'Fallback.' };
    // Reuse the exact observation grammar, in bounded chunks because clipping
    // may split one requested span around several protected serials.
    const chunks = Math.max(1, Math.ceil(line.spans.length / LABEL_STYLE_LIMITS.spans));
    for (let index = 0; index < chunks; index++) {
      const item = { role: line.role, letteringMode: line.letteringMode, letteringDescription: line.letteringDescription,
        letteringTraits: line.letteringTraits, fontId: line.fontId, fontSource: line.fontSource ?? unavailable,
        emphasis: line.emphasis, normalizeWordInkHeight: line.normalizeWordInkHeight,
        spans: line.spans.slice(index * LABEL_STYLE_LIMITS.spans, (index + 1) * LABEL_STYLE_LIMITS.spans) };
      const oneLineRequest = { ...request, source: { ...request.source, lines: [original] } };
      validateObservation({ lines: [item] }, oneLineRequest);
    }
    requireThat(line.spans.every((part, index) => (!index || part.start >= line.spans[index - 1].end)
      && canonical(allowedSegments(part, original, request)) === canonical([{ start: part.start, end: part.end }]))
      && (line.fontSource === null || line.fontSource.basis !== 'UNAVAILABLE' && line.fontSource.confidence !== 'LOW')
      && (line.status !== 'WORDMARK_REQUIRED' || line.letteringMode === 'ORIGINAL_WORDMARK')
      && (line.letteringMode !== 'ORIGINAL_WORDMARK' || line.status === 'WORDMARK_REQUIRED')
      && (line.status !== 'FALLBACK' || line.spans.length === 0 && line.fontSource === null && line.fontId === request.defaultFontId),
    409, 'LABEL_STYLE_SPEC_INVALID');
  });
  if (spec.provenance?.kind === 'MODEL_OBSERVATION') {
    exact(spec.provenance, ['kind', 'model', 'reasoning', 'requestSha256', 'responseSha256', 'observationHash', 'approximation'],
      ['rawObservationHash', 'normalizations'], 'LABEL_STYLE_SPEC_INVALID');
    requireThat(spec.provenance.model === LABEL_STYLE_MODEL && spec.provenance.reasoning === LABEL_STYLE_REASONING
      && spec.provenance.approximation === true && ['requestSha256', 'responseSha256', 'observationHash'].every(key => HASH.test(spec.provenance[key])),
    409, 'LABEL_STYLE_SPEC_INVALID');
    if (Object.hasOwn(spec.provenance, 'rawObservationHash') || Object.hasOwn(spec.provenance, 'normalizations')) {
      requireThat(HASH.test(spec.provenance.rawObservationHash) && Array.isArray(spec.provenance.normalizations)
        && spec.provenance.normalizations.length > 0 && spec.provenance.normalizations.length <= 2
        && new Set(spec.provenance.normalizations.map(value => value.role)).size === spec.provenance.normalizations.length,
      409, 'LABEL_STYLE_SPEC_INVALID');
      for (const normalization of spec.provenance.normalizations) {
        exact(normalization, ['role', 'field', 'rule', 'removed', 'retained'], [], 'LABEL_STYLE_SPEC_INVALID');
        const line = spec.lines.find(value => value.role === normalization.role);
        requireThat(line?.letteringMode === 'ORIGINAL_WORDMARK' && normalization.field === 'letteringTraits'
          && normalization.rule === 'drop-redundant-hand-drawn-v1' && canonical(normalization.removed) === '["HAND_DRAWN"]'
          && canonical(normalization.retained) === canonical(line.letteringTraits) && !line.letteringTraits.includes('HAND_DRAWN'),
        409, 'LABEL_STYLE_SPEC_INVALID');
      }
    }
  } else {
    exact(spec.provenance, ['kind', 'reason', 'approximation'], [], 'LABEL_STYLE_SPEC_INVALID');
    requireThat(spec.provenance.kind === 'DETERMINISTIC_FALLBACK' && spec.provenance.approximation === true
      && /^[A-Z][A-Z0-9_]{0,79}$/.test(spec.provenance.reason), 409, 'LABEL_STYLE_SPEC_INVALID');
    requireThat(canonical(spec) === canonical(fallbackLabelStyleSpec(request, spec.provenance.reason)), 409, 'LABEL_STYLE_SPEC_CHANGED');
  }
  return immutable(clone(spec));
}
