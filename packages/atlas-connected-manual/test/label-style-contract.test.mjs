import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '@atlas/manual-service/contract';
import { compileLabelStyleSpec, fallbackLabelStyleSpec, labelStyleDisplayParallel, prepareLabelStyleRequest,
  validateLabelStyleRequest, validateLabelStyleSpec, assertLabelStylePhotoColors } from '../src/label-style-contract.mjs';
import { styleFixture, styleFonts, styleObservation, styleSource } from './label-style-fixture.mjs';
import { prepareLabelWordmarkRequest } from '../src/label-wordmark-contract.mjs';
import { applyReviewedLabelStylePreferences } from '../../atlas-finishing/src/label-style-preferences.mjs';
import { LABEL_STYLE_FONT_CATALOG } from '../../atlas-finishing/src/label-style-paint.mjs';
const binding = { requestSha256: 'e'.repeat(64), responseSha256: 'f'.repeat(64) };
const rushFonts = [...styleFonts, { id: 'atlas-rush', family: 'ATLAS Rush', sha256: '8'.repeat(64), traits: ['original brush lettering'], weight: 700 }];

test('new Rush default ignores border/field font guesses while retaining photographed paint and legacy recipes', async () => {
  const { input, request: legacy } = await styleFixture({ lines: [{ role: 'variant', text: 'BLUE DIAMOND · AUTO · PATCH /500' }] });
  const request = prepareLabelStyleRequest(input, { fontCatalog: rushFonts, defaultFontId: 'atlas-rush' });
  assert.notEqual(request.requestKey, legacy.requestKey);
  for (const basis of ['CARD_FIELD', 'CARD_BORDER', 'UNAVAILABLE']) {
    const observation = styleObservation(request), value = observation.lines[0];
    value.fontSource = basis === 'UNAVAILABLE'
      ? { side: null, sha256: null, box: null, basis, confidence: 'LOW', observation: 'Variant name is not printed.' }
      : styleSource(request, { basis });
    const spec = compileLabelStyleSpec(request, observation, binding), line = spec.lines[0];
    assert.equal(line.fontId, 'atlas-rush'); assert.equal(line.fontSource, null); assert.equal(line.letteringMode, 'CATALOG');
    assert.equal(line.spans[0].baseColor, '#235BA9'); assert.equal(line.spans[0].pattern, 'DIAMOND');
    assert.deepEqual(validateLabelStyleSpec(spec, request), spec); assert.doesNotThrow(() => assertLabelStylePhotoColors(spec, request));
    const forged = structuredClone(spec); forged.lines[0].fontId = 'sans'; forged.lines[0].fontSha256 = styleFonts[1].sha256;
    forged.lines[0].fontSource = value.fontSource;
    const { specHash, ...body } = forged; forged.specHash = digest(canonical(body));
    assert.throws(() => validateLabelStyleSpec(forged, request), { code: 'LABEL_STYLE_SPEC_INVALID' });
    if (basis !== 'UNAVAILABLE') assert.equal(compileLabelStyleSpec(legacy, observation, binding).lines[0].fontId, 'sans');
  }
  const missing = fallbackLabelStyleSpec(request);
  assert.throws(() => assertLabelStylePhotoColors(missing, request), { code: 'LABEL_STYLE_CARD_COLOR_REQUIRED' });
  const partial = styleObservation(request); partial.lines[0].spans[0].end = 12;
  assert.throws(() => assertLabelStylePhotoColors(compileLabelStyleSpec(request, partial, binding), request), { code: 'LABEL_STYLE_CARD_COLOR_REQUIRED' });
});

test('Rush requests retain distinctive printed lettering but never generate a border-derived wordmark', async () => {
  const { input } = await styleFixture({ lines: [{ role: 'variant', text: 'THRILLERS' }] });
  const request = prepareLabelStyleRequest(input, { fontCatalog: rushFonts, defaultFontId: 'atlas-rush' });
  const observation = styleObservation(request), value = observation.lines[0];
  value.spans[0] = { ...value.spans[0], baseColor: '#C62232', accentColor: '#C62232', pattern: 'NONE' };
  assert.equal(compileLabelStyleSpec(request, observation, binding).lines[0].fontId, 'sans');
  Object.assign(value, { letteringMode: 'ORIGINAL_WORDMARK', letteringDescription: 'Heavy rough brush capitals.',
    letteringTraits: ['BRUSH', 'HEAVY', 'ROUGH'], fontId: null });
  const printed = compileLabelStyleSpec(request, observation, binding);
  assert.equal(printed.lines[0].status, 'WORDMARK_REQUIRED'); assert.equal(printed.lines[0].spans[0].baseColor, '#C62232');
  assert.deepEqual(validateLabelStyleSpec(printed, request), printed);
  value.fontSource = styleSource(request, { basis: 'CARD_BORDER' });
  const border = compileLabelStyleSpec(request, observation, binding);
  assert.equal(border.lines[0].fontId, 'atlas-rush'); assert.equal(border.lines[0].letteringMode, 'CATALOG');
  assert.equal(border.lines[0].spans[0].baseColor, '#C62232'); assert.equal(border.lines[0].status, 'PHOTO_INFORMED');
  assert.deepEqual(validateLabelStyleSpec(border, request), border);
});

test('Rush serial-only caption retains photographed palette without changing protected numbering or legacy behavior', async () => {
  const { input, request: legacy } = await styleFixture({ lines: [{ role: 'variant', text: '/500' }] });
  const request = prepareLabelStyleRequest(input, { fontCatalog: rushFonts, defaultFontId: 'atlas-rush' });
  const observation = styleObservation(request); observation.lines[0].fontSource = styleSource(request, { basis: 'CARD_FIELD' });
  const spec = compileLabelStyleSpec(request, observation, binding), line = spec.lines[0];
  assert.equal(line.text, '/500'); assert.equal(line.fontId, 'atlas-rush'); assert.equal(line.letteringMode, 'CATALOG');
  assert.deepEqual(line.protectedSpans, [{ start: 0, end: 4 }]);
  assert.equal(line.spans[0].baseColor, '#235BA9'); assert.equal(line.spans[0].pattern, 'DIAMOND');
  assert.deepEqual(line.spans[0].source, observation.lines[0].spans[0].source);
  assert.deepEqual(validateLabelStyleSpec(spec, request), spec); assert.doesNotThrow(() => assertLabelStylePhotoColors(spec, request));
  assert.deepEqual(compileLabelStyleSpec(legacy, observation, binding).lines[0].spans, []);
  observation.lines[0].spans[0].source.confidence = 'LOW';
  assert.throws(() => assertLabelStylePhotoColors(compileLabelStyleSpec(request, observation, binding), request), { code: 'LABEL_STYLE_CARD_COLOR_REQUIRED' });
});

test('unknown cards receive exact-source styles with permitted product spans and protected serials', async () => {
  const { input, request } = await styleFixture(), before = canonical(input), observation = styleObservation(request);
  const spec = compileLabelStyleSpec(request, observation, binding);
  assert.equal(spec.lines[0].fontId, 'sans'); assert.equal(spec.lines[0].spans[0].start, input.lines[0].text.indexOf('Faceted'));
  assert.equal(spec.lines[1].text, 'COBALT CRYSTAL /199'); assert.equal(spec.lines[1].spans[0].end, 15);
  assert.equal(spec.lines[1].spans[0].baseColor, '#235BA9'); assert.equal(spec.lines[1].spans[0].pattern, 'DIAMOND');
  assert.deepEqual(spec.lines[1].protectedSpans, [{ start: 15, end: 19 }]);
  assert.equal(spec.lines[1].spans[0].opticalScale, 1.1); assert.equal(spec.lines[1].normalizeWordInkHeight, true);
  assert(spec.lines[1].fallbackReasons.includes('PROTECTED_TEXT_PRIMARY')); assert.equal(canonical(input), before);
  assert.equal(spec.provenance.kind, 'MODEL_OBSERVATION'); assert.equal(spec.provenance.approximation, true);
  assert(Object.isFrozen(spec.lines[1].spans[0])); assert.deepEqual(validateLabelStyleSpec(spec, request), spec);
});

test('a product-only identity can be styled without a variant or hardcoded card identity', async () => {
  const text = '#113 1998 Upper Deck Black Diamond';
  const { request } = await styleFixture({ lines: [{ role: 'identity', text, styleableSpans: [{ start: text.indexOf('Black Diamond'), end: text.length }] }] });
  const observation = styleObservation(request), spec = compileLabelStyleSpec(request, observation, binding);
  assert.equal(spec.lines.length, 1); assert.equal(spec.lines[0].spans[0].start, 21); assert.equal(spec.lines[0].spans[0].end, text.length);
  assert.equal(spec.lines[0].text, text);
});

test('card-field silver can style black source lettering and features while preserving serial primary ink', async () => {
  const { request } = await styleFixture({ lines: [{ role: 'variant', text: 'Patented · CASE HIT /25' }] });
  const observation = styleObservation(request);
  observation.lines[0].spans[0] = { ...observation.lines[0].spans[0], baseColor: '#D7DCE4', accentColor: '#FFFFFF', pattern: 'SHIMMER',
    source: styleSource(request, { basis: 'CARD_FIELD', observation: 'Silver light field surrounds black printed lettering.' }) };
  const line = compileLabelStyleSpec(request, observation, binding).lines[0];
  assert.equal(line.spans[0].pattern, 'SHIMMER'); assert.equal(line.spans[0].source.basis, 'CARD_FIELD');
  assert.equal(line.spans[0].end, line.text.indexOf('/25'));
});

test('distinctive original lettering requests remain explicitly ungenerated and preserve one face for the phrase', async () => {
  const { request } = await styleFixture({ lines: [{ role: 'variant', text: 'THRILLERS ICE' }] });
  const observation = styleObservation(request), value = observation.lines[0];
  Object.assign(value, { letteringMode: 'ORIGINAL_WORDMARK', letteringDescription: 'Heavy condensed upright rough brush capitals.',
    letteringTraits: ['BRUSH', 'CONDENSED', 'UPRIGHT', 'HEAVY', 'ROUGH'], fontId: null });
  value.spans = [{ ...value.spans[0], start: 0, end: 9, baseColor: '#D74424', accentColor: '#D74424', pattern: 'NONE', opticalScale: 1 },
    { ...value.spans[0], start: 10, end: 13, baseColor: '#96DAF6', accentColor: '#96DAF6', pattern: 'NONE', opticalScale: 1.2 }];
  const line = compileLabelStyleSpec(request, observation, binding).lines[0];
  assert.equal(line.status, 'WORDMARK_REQUIRED'); assert.equal(line.letteringMode, 'ORIGINAL_WORDMARK');
  assert.equal(line.fontId, 'knewave'); assert.equal(line.fontSource.basis, 'PRINTED_LETTERING'); assert(line.fallbackReasons.includes('ORIGINAL_WORDMARK_REQUIRED'));
  assert.equal(line.emphasis, 'LARGE'); assert.equal(line.normalizeWordInkHeight, true);
});

test('original lettering rejects identity, protected serial and partial spans before generation', async () => {
  for (const input of [{ role: 'identity', text: 'Black Diamond' }, { role: 'variant', text: 'Crystal /199' },
    { role: 'variant', text: 'Crystal Blue', styleableSpans: [{ start: 0, end: 7 }] }]) {
    const { request } = await styleFixture({ lines: [input] }), observation = styleObservation(request);
    Object.assign(observation.lines[0], { letteringMode: 'ORIGINAL_WORDMARK', letteringDescription: 'Heavy rough brush lettering.',
      letteringTraits: ['BRUSH', 'HEAVY', 'ROUGH'], fontId: null });
    assert.throws(() => compileLabelStyleSpec(request, observation, binding), { code: 'LABEL_STYLE_OBSERVATION_INVALID' });
  }
});

test('original paint must cover whole words while catalog paint may split at exact character offsets', async () => {
  const { request } = await styleFixture({ lines: [{ role: 'variant', text: 'NEW · WAVE' }] });
  for (const range of [{ start: 0, end: 2 }, { start: 1, end: 3 }, { start: 0, end: 7 }]) {
    const catalog = styleObservation(request);Object.assign(catalog.lines[0].spans[0], range);
    assert.doesNotThrow(() => compileLabelStyleSpec(request, catalog, binding));
    const original = structuredClone(catalog);Object.assign(original.lines[0], { letteringMode: 'ORIGINAL_WORDMARK',
      letteringDescription: 'Heavy rough brush lettering.', letteringTraits: ['BRUSH', 'HEAVY', 'ROUGH'], fontId: null });
    assert.throws(() => compileLabelStyleSpec(request, original, binding), { code: 'LABEL_STYLE_OBSERVATION_INVALID' });
  }
  const original = styleObservation(request);Object.assign(original.lines[0], { letteringMode: 'ORIGINAL_WORDMARK',
    letteringDescription: 'Heavy rough brush lettering.', letteringTraits: ['BRUSH', 'HEAVY', 'ROUGH'], fontId: null });
  original.lines[0].spans = [{ ...original.lines[0].spans[0], start: 0, end: 3 },
    { ...original.lines[0].spans[0], start: 6, end: 10 }];
  const spec = compileLabelStyleSpec(request, original, binding);
  assert.deepEqual(validateLabelStyleSpec(spec, request), spec);
});

test('redundant generic hand-drawn morphology normalizes explicitly without accepting conflicting specifics', async () => {
  const { request } = await styleFixture({ lines: [{ role: 'variant', text: 'NEW WAVE' }] });
  const raw = styleObservation(request);Object.assign(raw.lines[0], { letteringMode: 'ORIGINAL_WORDMARK',
    letteringDescription: 'Bold rough italic brush lettering.', letteringTraits: ['BRUSH', 'HAND_DRAWN', 'BOLD', 'ITALIC', 'ROUGH'], fontId: null });
  const before = canonical(raw), spec = compileLabelStyleSpec(request, raw, binding), line = spec.lines[0];
  assert.equal(canonical(raw), before);assert.deepEqual(line.letteringTraits, ['BRUSH', 'BOLD', 'ITALIC', 'ROUGH']);
  assert.equal(spec.provenance.rawObservationHash, digest(before));
  assert.deepEqual(spec.provenance.normalizations, [{ role: 'variant', field: 'letteringTraits', rule: 'drop-redundant-hand-drawn-v1',
    removed: ['HAND_DRAWN'], retained: line.letteringTraits }]);
  assert.deepEqual(validateLabelStyleSpec(spec, request), spec);
  const wordmark = prepareLabelWordmarkRequest({ sourceHash: spec.specHash, role: line.role, text: line.text,
    traits: line.letteringTraits, normalizeWordInkHeight: line.normalizeWordInkHeight });
  assert.deepEqual(wordmark.traits, [...line.letteringTraits].sort());
  for (const traits of [['BRUSH', 'SCRIPT', 'HAND_DRAWN', 'BOLD'], ['SANS', 'SERIF', 'BOLD'], ['BRUSH', 'HAND_DRAWN', 'BOLD', 'LIGHT']]) {
    const invalid = structuredClone(raw);invalid.lines[0].letteringTraits = traits;
    assert.throws(() => compileLabelStyleSpec(request, invalid, binding), { code: 'LABEL_STYLE_OBSERVATION_INVALID' });
  }
  const generic = structuredClone(raw);generic.lines[0].letteringTraits = ['HAND_DRAWN', 'BOLD'];
  const genericSpec = compileLabelStyleSpec(request, generic, binding);
  assert.deepEqual(genericSpec.lines[0].letteringTraits, ['HAND_DRAWN', 'BOLD']);assert.equal(genericSpec.provenance.normalizations, undefined);
});

test('unavailable or low-confidence observations produce an honest reusable fallback', async () => {
  const { request } = await styleFixture(); const observation = styleObservation(request);
  for (const line of observation.lines) {
    line.fontId = null; line.fontSource = { side: null, sha256: null, box: null, basis: 'UNAVAILABLE', confidence: 'LOW', observation: 'Lettering is occluded.' };
    line.spans[0].source.confidence = 'LOW';
  }
  const spec = compileLabelStyleSpec(request, observation, binding);
  for (const line of spec.lines) { assert.equal(line.status, 'FALLBACK'); assert.equal(line.fontId, 'knewave'); assert.deepEqual(line.spans, []); }
  const fallback = fallbackLabelStyleSpec(request, 'PROVIDER_UNAVAILABLE');
  assert.equal(fallback.provenance.kind, 'DETERMINISTIC_FALLBACK'); assert.equal(fallback.sourceHash, spec.sourceHash);
  assert.equal(fallbackLabelStyleSpec(request, 'PROVIDER_UNAVAILABLE').specHash, fallback.specHash);
});

test('source, approval, photos, text and actual available font hashes each invalidate cache binding', async () => {
  const { input, request } = await styleFixture();
  const cases = [value => { value.approval.publicHash = '1'.repeat(64); }, value => { value.approval.approvalVersion++; },
    value => { value.identity.playerName = 'A Different New Player'; }, value => { value.photos[0].sha256 = '2'.repeat(64); },
    value => { value.lines[1].text = 'NEW SILVER WAVE /199'; }];
  for (const edit of cases) {
    const next = structuredClone(input); edit(next);
    assert.notEqual(prepareLabelStyleRequest(next, { fontCatalog: styleFonts, defaultFontId: 'knewave' }).requestKey, request.requestKey);
  }
  const fonts = structuredClone(styleFonts); fonts[0].sha256 = '3'.repeat(64);
  assert.notEqual(prepareLabelStyleRequest(input, { fontCatalog: fonts, defaultFontId: 'knewave' }).requestKey, request.requestKey);
  assert.throws(() => validateLabelStyleRequest({ ...request, sourceHash: '4'.repeat(64) }), { code: 'LABEL_STYLE_REQUEST_CHANGED' });
});

test('display-only omission preserves specific named parallel and never deletes bare Refractor', () => {
  assert.equal(labelStyleDisplayParallel('Blue Mini Diamond Refractor').text, 'Blue Mini Diamond');
  assert.equal(labelStyleDisplayParallel('Purple Wave Refractor').text, 'Purple Wave');
  for (const value of ['Refractor', 'Blue Refractor', 'Base Chrome Refractor', 'Orange', '']) {
    if (value) assert.equal(labelStyleDisplayParallel(value).text, value);
    else assert.throws(() => labelStyleDisplayParallel(value));
  }
  const value = labelStyleDisplayParallel('Blue Mini Diamond Refractor');
  assert.equal(value.abbreviations[0].from, 'Blue Mini Diamond Refractor');
});

test('foreign photos, illegal regions/fonts/colors, arbitrary rendering instructions and bad optical sizes are refused', async () => {
  const { request } = await styleFixture();
  for (const edit of [value => { value.lines[0].fontId = 'remote-font'; }, value => { value.lines[0].spans[0].baseColor = 'url(https://bad.example)'; },
    value => { value.lines[0].spans[0].source.sha256 = '9'.repeat(64); }, value => { value.lines[0].spans[0].source.box.x = 0.99; },
    value => { value.lines[0].spans[0].source.box.width = NaN; }, value => { value.lines[0].spans[0].opticalScale = 1.21; },
    value => { value.lines[0].text = 'DIFFERENT'; }, value => { value.lines[1] = value.lines[0]; },
    value => { value.lines[0].spans[0].end = 999; }, value => { value.lines[0].spans.push({ ...value.lines[0].spans[0] }); }]) {
    const value = styleObservation(request); edit(value);
    assert.throws(() => compileLabelStyleSpec(request, value, binding), { code: 'LABEL_STYLE_OBSERVATION_INVALID' });
  }
  const changed = structuredClone(compileLabelStyleSpec(request, styleObservation(request), binding));
  changed.lines[0].text += ' FAKE'; const { specHash, ...body } = changed; changed.specHash = digest(canonical(body));
  assert.throws(() => validateLabelStyleSpec(changed, request), { code: 'LABEL_STYLE_SPEC_CHANGED' });
});

test('no half surrogate offsets and no identity mutation or cross-category grade-dependent inference', async () => {
  const { input } = await styleFixture({ lines: [{ role: 'variant', text: 'BLUE 🔷 WAVE /99' }] });
  assert.throws(() => prepareLabelStyleRequest({ ...input, lines: [{ ...input.lines[0], styleableSpans: [{ start: 6, end: 8 }] }] },
    { fontCatalog: styleFonts, defaultFontId: 'knewave' }), { code: 'LABEL_STYLE_INPUT_INVALID' });
  assert.equal(Object.hasOwn(input, 'finalGrade'), false);
});

test('reviewed preferences require pinned photos/caption and a validated immutable base spec', async () => {
  const { input } = await styleFixture({ lines: [{ role: 'variant', text: 'REFRACTOR /499' }] });
  input.photos[0].sha256 = '769cca069d18d9fc049e88374e6c766af1338dcc830952df205dd6630d91d324';
  input.photos[1].sha256 = 'f80441708674f71dfeb4d77712a7e6e3a23edc9bee71857e99681b60db675525';
  const request = prepareLabelStyleRequest(input, { fontCatalog: Object.values(LABEL_STYLE_FONT_CATALOG), defaultFontId: 'knewave' });
  const observation = styleObservation(request);observation.lines[0].fontId = 'roboto-condensed';
  const baseSpec = compileLabelStyleSpec(request, observation, binding), before = canonical(baseSpec);
  const effective = applyReviewedLabelStylePreferences(baseSpec, request.source.photos);
  assert.equal(canonical(baseSpec), before);assert.notEqual(effective.specHash, baseSpec.specHash);
  assert.equal(effective.provenance.kind, 'REVIEWED_STYLE_FEEDBACK');assert.equal(effective.provenance.baseSpecHash, baseSpec.specHash);
  assert.equal(effective.lines[0].fontId, 'knewave');assert.equal(effective.lines[0].fontSource, null);
  assert.equal(effective.lines[0].reviewedCapMm, 2.1);assert.equal(effective.lines[0].spans[0].pattern, 'NONE');
  assert.deepEqual(effective.lines[0].protectedSpans, baseSpec.lines[0].protectedSpans);
  assert.deepEqual(validateLabelStyleSpec(effective, request, { baseSpec }), effective);
  assert.throws(() => validateLabelStyleSpec(effective, request), { code: 'LABEL_STYLE_REVIEWED_BASE_REQUIRED' });
  for (const edit of [s => { s.lines[0].reviewedCapMm = 2.6; }, s => { s.lines[0].fontId = 'montserrat-black'; },
    s => { s.provenance.baseSpecHash = '1'.repeat(64); }, s => { s.provenance.preferences[0].preferenceSha256 = '2'.repeat(64); }]) {
    const changed = structuredClone(effective);edit(changed);const { specHash, ...body } = changed;changed.specHash = digest(canonical(body));
    assert.throws(() => validateLabelStyleSpec(changed, request, { baseSpec }), { code: 'LABEL_STYLE_REVIEWED_SPEC_CHANGED' });
  }
  const unreviewed = structuredClone(baseSpec);unreviewed.lines[0].reviewedCapMm = 2.1;
  const { specHash, ...body } = unreviewed;unreviewed.specHash = digest(canonical(body));
  assert.throws(() => validateLabelStyleSpec(unreviewed, request), { code: 'LABEL_STYLE_SPEC_INVALID' });
  const changedPhotos = structuredClone(request.source.photos);changedPhotos[0].sha256 = '9'.repeat(64);
  assert.equal(applyReviewedLabelStylePreferences(baseSpec, changedPhotos), baseSpec);
});
