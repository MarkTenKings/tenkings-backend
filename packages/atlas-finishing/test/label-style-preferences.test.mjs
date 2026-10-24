import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyReviewedLabelStylePreferences, REVIEWED_LABEL_STYLE_PREFERENCES } from '../src/label-style-preferences.mjs';
const hash = v => createHash('sha256').update(v).digest('hex');
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
function fixture(preference) {
  const serial = preference.text.indexOf('/');
  const body = { version: 'atlas-photo-informed-label-style-v1', sourceHash: 'a'.repeat(64), requestKey: 'synthetic-request', fontCatalogHash: 'b'.repeat(64),
    lines: [{ role: preference.role, text: preference.text, fontId: 'roboto-condensed', fontSha256: 'c'.repeat(64),
      fontSource: { basis: 'PRINTED_LETTERING' }, letteringMode: 'ORIGINAL_WORDMARK', emphasis: 'LARGE', normalizeWordInkHeight: false,
      protectedSpans: serial >= 0 ? [{ start: serial, end: preference.text.length }] : [],
      styleableSpans: [{ start: 0, end: preference.text.length }],
      spans: [{ start: 0, end: serial >= 0 ? serial - 1 : preference.text.length, baseColor: '#123b52', accentColor: '#c6d2cf', pattern: 'SHIMMER', opticalScale: 1.1,
        source: { sha256: preference.photoShas.FRONT, basis: 'CARD_BORDER' } }] }],
    provenance: { kind: 'MODEL_OBSERVATION', responseSha256: 'd'.repeat(64) } };
  return { spec: { ...body, specHash: hash(canonical(body)) }, photos: Object.entries(preference.photoShas).map(([side, sha256]) => ({ side, sha256 })) };
}

test('pinned feedback matches exact photo pair and caption, never identity names or approval request hashes', () => {
  const preference = REVIEWED_LABEL_STYLE_PREFERENCES.find(p => p.overrides.flatFill), f = fixture(preference), before = structuredClone(f.spec);
  const result = applyReviewedLabelStylePreferences(f.spec, f.photos);
  assert.equal(result.lines[0].fontId, 'knewave'); assert.equal(result.lines[0].letteringMode, 'CATALOG');
  assert.equal(result.lines[0].fontSource, null); assert.equal(result.lines[0].reviewedCapMm, 2.1);
  assert.equal(result.lines[0].spans[0].baseColor, '#ffffff'); assert.equal(result.lines[0].spans[0].pattern, 'NONE');
  assert.deepEqual(result.lines[0].protectedSpans, f.spec.lines[0].protectedSpans);
  assert.deepEqual(f.spec, before); assert.notEqual(result.specHash, f.spec.specHash);
  assert.equal(result.provenance.kind, 'REVIEWED_STYLE_FEEDBACK'); assert.equal(result.provenance.baseSpecHash, f.spec.specHash);
  assert.deepEqual(result.provenance.modelProvenance, f.spec.provenance);
  assert.equal(result.provenance.preferences[0].preferenceSha256, preference.preferenceSha256);
  assert.ok(Object.isFrozen(result.lines[0])); assert.deepEqual(result, applyReviewedLabelStylePreferences(f.spec, f.photos));
});

test('font-only feedback retains model material, source, optical scale and unchanged text', () => {
  for (const p of REVIEWED_LABEL_STYLE_PREFERENCES.filter(p => p.overrides.fontId && !p.overrides.flatFill)) {
    const f = fixture(p), result = applyReviewedLabelStylePreferences(f.spec, f.photos);
    assert.deepEqual(result.lines[0].spans, f.spec.lines[0].spans); assert.equal(result.lines[0].text, f.spec.lines[0].text);
    assert.equal(result.lines[0].fontId, 'knewave'); assert.equal(result.lines[0].reviewedCapMm, p.overrides.capMm);
  }
});

test('Rush keeps its own lettering and sizing when legacy default feedback still supplies exact-photo colors', () => {
  for (const p of REVIEWED_LABEL_STYLE_PREFERENCES.filter(p => p.overrides.fontId === 'knewave')) {
    const f = fixture(p);
    Object.assign(f.spec.lines[0], { fontId: 'atlas-rush', letteringMode: 'CATALOG', normalizeWordInkHeight: false });
    delete f.spec.specHash; f.spec.specHash = hash(canonical(f.spec));
    const result = applyReviewedLabelStylePreferences(f.spec, f.photos), line = result.lines[0];
    assert.equal(line.fontId, 'atlas-rush'); assert.equal(line.reviewedCapMm, undefined); assert.equal(line.normalizeWordInkHeight, false);
    if (p.overrides.flatFill) assert.equal(line.spans[0].baseColor, p.overrides.flatFill.baseColor);
    else assert.equal(result, f.spec);
  }
});

test('paint-only feedback keeps original lettering while replacing exact word paints and normalizing short words', () => {
  const p = REVIEWED_LABEL_STYLE_PREFERENCES.find(p => p.overrides.spanPaints), f = fixture(p);
  const result = applyReviewedLabelStylePreferences(f.spec, f.photos), line = result.lines[0];
  assert.equal(line.letteringMode, 'ORIGINAL_WORDMARK'); assert.equal(line.fontId, f.spec.lines[0].fontId);
  assert.equal(line.normalizeWordInkHeight, true); assert.equal(line.reviewedCapMm, 2.5);
  for (const lock of p.overrides.spanPaints) {
    const actual = line.spans.find(s => s.start === lock.start && s.end === lock.end);
    assert.equal(actual.pattern, 'NONE'); assert.equal(actual.baseColor, lock.baseColor); assert.equal(actual.opticalScale, 1);
  }
  assert.equal(line.text, f.spec.lines[0].text);
});

test('saved and qualification captions have separate exact bindings without transferring proposed facts', () => {
  for (const [saved, proposed] of [['REFRACTOR','REFRACTOR /499'],['PATENTED','PATENTED · CASE HIT'],['BLUE MINI DIAMOND','BLUE MINI DIAMOND /199']]) {
    const p = REVIEWED_LABEL_STYLE_PREFERENCES.find(p => p.text === saved), other = REVIEWED_LABEL_STYLE_PREFERENCES.find(p => p.text === proposed);
    assert.ok(p && other); assert.deepEqual(p.photoShas, other.photoShas);
    const f = fixture(p), result = applyReviewedLabelStylePreferences(f.spec, f.photos);
    assert.equal(result.lines[0].text, saved); assert.equal(result.lines[0].fontId, 'knewave');
  }
});

test('new cards, changed photo sides, changed caption and changed role stay automatic', () => {
  const f = fixture(REVIEWED_LABEL_STYLE_PREFERENCES[0]);
  const changedPhotos = structuredClone(f.photos); changedPhotos[0].sha256 = 'f'.repeat(64);
  assert.equal(applyReviewedLabelStylePreferences(f.spec, changedPhotos), f.spec);
  assert.equal(applyReviewedLabelStylePreferences(f.spec, f.photos.map(p => ({ ...p, side: p.side === 'FRONT' ? 'BACK' : 'FRONT' }))), f.spec);
  for (const change of [{ text: `${f.spec.lines[0].text} EXTRA` }, { role: 'identity' }]) {
    const s = structuredClone(f.spec); Object.assign(s.lines[0], change); delete s.specHash; s.specHash = hash(canonical(s));
    assert.equal(applyReviewedLabelStylePreferences(s, f.photos), s);
  }
});

test('raw spec tampering and duplicate or missing photo bindings fail closed', () => {
  const f = fixture(REVIEWED_LABEL_STYLE_PREFERENCES[0]), changed = structuredClone(f.spec); changed.lines[0].text += 'x';
  assert.throws(() => applyReviewedLabelStylePreferences(changed, f.photos), /PREFERENCE_INVALID/);
  assert.throws(() => applyReviewedLabelStylePreferences(f.spec, [f.photos[0], f.photos[0]]), /PREFERENCE_INVALID/);
  assert.throws(() => applyReviewedLabelStylePreferences(f.spec, [f.photos[0]]), /PREFERENCE_INVALID/);
  assert.throws(() => applyReviewedLabelStylePreferences(applyReviewedLabelStylePreferences(f.spec, f.photos), f.photos), /PREFERENCE_INVALID/);
});
