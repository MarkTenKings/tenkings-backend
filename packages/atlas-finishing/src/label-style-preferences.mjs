import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const LABEL_STYLE_PREFERENCES_VERSION = 'atlas-reviewed-label-style-preferences-v1';
export const LABEL_STYLE_PREFERENCES_SHA256 = '45a55d12f1a8f46a8702c05ad7c82710831186c73fbc8e317e70c3e535abacca';
const hash = value => createHash('sha256').update(value).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const check = value => { if (!value) throw Error('LABEL_STYLE_PREFERENCE_INVALID'); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const exact = (value, keys, optional = []) => value && Object.getPrototypeOf(value) === Object.prototype
  && keys.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => keys.includes(k) || optional.includes(k));
function canonical(value, depth = 0) {
  check(depth <= 40);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isFinite(value)); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(v => canonical(v, depth + 1)).join(',')}]`;
  check(value && Object.getPrototypeOf(value) === Object.prototype);
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k], depth + 1)}`).join(',')}}`;
}
const color = value => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value);
const bytes = readFileSync(new URL('../assets/approved-b/label-style-preferences.json', import.meta.url));
check(hash(bytes) === LABEL_STYLE_PREFERENCES_SHA256);
const document = JSON.parse(bytes);
check(exact(document, ['version', 'records']) && document.version === LABEL_STYLE_PREFERENCES_VERSION && Array.isArray(document.records));
const bindings = new Set();
for (const record of document.records) {
  check(exact(record, ['version','id','photoShas','role','text','overrides','evidence','preferenceSha256'])
    && record.version === 'atlas-reviewed-label-style-preference-v1' && /^[a-z0-9-]{1,80}$/.test(record.id)
    && ['identity','variant'].includes(record.role) && typeof record.text === 'string' && record.text.length > 0 && record.text.length <= 512
    && exact(record.photoShas, ['FRONT','BACK']) && Object.values(record.photoShas).every(isHash));
  const { preferenceSha256, ...body } = record;
  check(isHash(preferenceSha256) && hash(canonical(body)) === preferenceSha256);
  check(exact(record.overrides, [], ['fontId','fontSha256','flatFill','spanPaints','normalizeWordInkHeight','capMm']) && Object.keys(record.overrides).length > 0);
  const o = record.overrides;
  check((o.fontId === undefined && o.fontSha256 === undefined) || typeof o.fontId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(o.fontId) && isHash(o.fontSha256));
  check(o.flatFill === undefined || exact(o.flatFill, ['baseColor','accentColor']) && Object.values(o.flatFill).every(color));
  check(o.normalizeWordInkHeight === undefined || typeof o.normalizeWordInkHeight === 'boolean');
  if (o.spanPaints !== undefined) {
    check(o.flatFill === undefined && Array.isArray(o.spanPaints) && o.spanPaints.length > 0 && o.spanPaints.length <= 32);
    let end = 0;
    for (const p of o.spanPaints) {
      check(exact(p, ['start','end','baseColor','accentColor','pattern']) && Number.isSafeInteger(p.start) && Number.isSafeInteger(p.end)
        && p.start >= end && p.end > p.start && p.end <= record.text.length && color(p.baseColor) && color(p.accentColor) && p.pattern === 'NONE');
      end = p.end;
    }
  }
  check(o.capMm === undefined || Number.isFinite(o.capMm) && o.capMm >= 1.3 && o.capMm <= 2.5);
  check(exact(record.evidence, ['proofSha256','sourceLabelSha256','proofReference','comment'])
    && isHash(record.evidence.proofSha256) && isHash(record.evidence.sourceLabelSha256)
    && typeof record.evidence.proofReference === 'string' && record.evidence.proofReference.length < 512
    && typeof record.evidence.comment === 'string' && record.evidence.comment.length > 0 && record.evidence.comment.length < 1200);
  const binding = canonical({ photoShas: record.photoShas, role: record.role, text: record.text });
  check(!bindings.has(binding)); bindings.add(binding);
}
export const REVIEWED_LABEL_STYLE_PREFERENCES = freeze(document.records);

function photoHashes(photos) {
  const items = Array.isArray(photos) ? photos : photos && Object.entries(photos).map(([side, p]) => ({ ...p, side }));
  check(Array.isArray(items)); const result = {};
  for (const item of items) {
    check(item && ['FRONT','BACK'].includes(item.side) && isHash(item.sha256) && !Object.hasOwn(result, item.side));
    result[item.side] = item.sha256;
  }
  check(Object.keys(result).length === 2); return result;
}

/** Trusted feedback is a separate, reproducible projection of the immutable
 * model result. Exact photographs and caption are its sole matching authority;
 * names, certificates, request UUIDs and public approval hashes are not keys.
 * Call once after validating the raw model/fallback spec against its request. */
export function applyReviewedLabelStylePreferences(spec, photos) {
  check(spec && spec.version === 'atlas-photo-informed-label-style-v1' && Array.isArray(spec.lines)
    && spec.provenance && spec.provenance.kind !== 'REVIEWED_STYLE_FEEDBACK' && isHash(spec.specHash));
  const { specHash, ...baseBody } = spec;
  check(hash(canonical(baseBody)) === specHash);
  const shas = photoHashes(photos), applied = [];
  const lines = spec.lines.map(line => {
    const preference = REVIEWED_LABEL_STYLE_PREFERENCES.find(p => p.role === line.role && p.text === line.text
      && p.photoShas.FRONT === shas.FRONT && p.photoShas.BACK === shas.BACK);
    if (!preference) return line;
    const result = structuredClone(line), fieldsApplied = [], o = preference.overrides;
    // ATLAS Rush supersedes earlier default-face tuning, while the exact-photo
    // color feedback still applies. Legacy recipes keep their earlier result.
    const preserveRush = line.letteringMode === 'CATALOG' && line.fontId === 'atlas-rush' && o.fontId === 'knewave';
    if (o.fontId !== undefined && !preserveRush) {
      result.fontId = o.fontId; result.fontSha256 = o.fontSha256; result.letteringMode = 'CATALOG';
      // The reviewed choice is not a fresh photographic font identification.
      result.fontSource = null;
      result.letteringDescription = ''; result.letteringTraits = []; result.status = 'PHOTO_INFORMED';
      result.fallbackReasons = (result.fallbackReasons ?? []).filter(reason => reason !== 'ORIGINAL_WORDMARK_REQUIRED');
      fieldsApplied.push('fontId','fontSha256','letteringMode','fontSource','letteringDescription','letteringTraits','status','fallbackReasons');
    }
    if (o.flatFill !== undefined || o.spanPaints !== undefined) {
      check(Array.isArray(result.spans) && Array.isArray(result.styleableSpans) && Array.isArray(result.protectedSpans));
      let locks = o.spanPaints;
      if (o.flatFill) {
        locks = result.protectedSpans.reduce((parts, p) => parts.flatMap(s => s.start >= p.end || s.end <= p.start ? [s]
          : [{ start: s.start, end: Math.min(s.end, p.start) }, { start: Math.max(s.start, p.end), end: s.end }].filter(v => v.end > v.start)), result.styleableSpans)
          .map(s => ({ ...s, ...o.flatFill, pattern: 'NONE' }));
      }
      for (const paint of locks) {
        check(result.styleableSpans.some(s => paint.start >= s.start && paint.end <= s.end)
          && !result.protectedSpans.some(s => paint.start < s.end && paint.end > s.start));
        const source = result.spans.find(s => s.start <= paint.start && s.end >= paint.end)?.source ?? null;
        result.spans = result.spans.flatMap(s => s.start >= paint.end || s.end <= paint.start ? [s]
          : [{ ...s, end: Math.min(s.end, paint.start) }, { ...s, start: Math.max(s.start, paint.end) }].filter(v => v.end > v.start));
        result.spans.push({ ...paint, opticalScale: 1, source }); result.spans.sort((a,b) => a.start - b.start);
      }
      check(result.spans.length <= 32);
      fieldsApplied.push('spans');
    }
    if (o.normalizeWordInkHeight !== undefined && !preserveRush) { result.normalizeWordInkHeight = o.normalizeWordInkHeight; fieldsApplied.push('normalizeWordInkHeight'); }
    if (o.capMm !== undefined && !preserveRush) { result.reviewedCapMm = o.capMm; fieldsApplied.push('reviewedCapMm'); }
    if (!fieldsApplied.length) return line;
    applied.push({ preferenceSha256: preference.preferenceSha256, photoShas: { ...preference.photoShas },
      captionSha256: hash(line.text), role: line.role, fieldsApplied });
    return result;
  });
  if (!applied.length) return spec;
  const body = { ...baseBody, lines, provenance: { kind: 'REVIEWED_STYLE_FEEDBACK', baseSpecHash: specHash,
    modelProvenance: structuredClone(spec.provenance), preferences: applied } };
  return freeze({ ...body, specHash: hash(canonical(body)) });
}
