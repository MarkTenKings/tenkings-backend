const assert = require('node:assert/strict');
const test = require('node:test');
const { parseEbaySoldCompsV2Candidate: parse, buildEbaySoldCompsV2Query: query,
  readEbaySoldCompsV2GradeEvidence: grade } = require('../dist');

const magikarp = { category: 'POKEMON', cardName: 'Magikarp', year: '2020', productSet: 'Rebel Clash',
  cardNumber: '039/192', parallel: null, matchingPolicy: 'ATLAS_IDENTITY_V1' };
const snivy = { category: 'POKEMON', cardName: 'Snivy', year: '2013', productSet: 'Legendary Treasures – Radiant Collection',
  cardNumber: 'RC1/RC25', parallel: null, matchingPolicy: 'ATLAS_IDENTITY_V1' };
const sports = { category: 'SPORTS', playerName: 'Draymond Green', year: '2024', manufacturer: 'Panini',
  productSet: '2024 Panini Prizm', cardNumber: '24', parallel: 'Red Wave', matchingPolicy: 'ATLAS_IDENTITY_V1' };
const raw = title => ({ itemId: '123456789012', url: 'https://www.ebay.com/itm/123456789012', title,
  soldPrice: '12.34', soldCurrency: 'USD', bestOfferAccepted: false, endedAt: '2026-10-08', condition: 'Ungraded' });
const pokemonTitle = suffix => `2020 Pokemon Rebel Clash Magikarp 039/192 ${suffix}`;
const sportsTitle = suffix => `2024 Panini Prizm Draymond Green #24 ${suffix}`;
const parsed = (input, title, condition = 'Ungraded') => parse({ ...raw(title), condition }, input);
const reason = (candidate, code) => assert.ok(candidate.variantEvidence.reasonCodes.includes(code), JSON.stringify(candidate.variantEvidence));

test('actual Magikarp and Snivy saved null parallels remain unknown for ordinary, foil and series titles', () => {
  for (const suffix of ['', 'Non-Holo', 'Reverse Holo', 'PSA 9']) {
    const candidate = parsed(magikarp, pokemonTitle(suffix), suffix === 'PSA 9' ? 'Graded' : 'Ungraded');
    assert.equal(candidate.parallelMatch, 'UNKNOWN');
    reason(candidate, 'VARIANT_TARGET_UNRESOLVED');
  }
  for (const suffix of ['', 'Holo', 'Pokemon Black & White', 'Pokemon Black and White Holo']) {
    const candidate = parsed(snivy, `2013 Legendary Treasures Radiant Collection Snivy RC1/RC25 ${suffix}`);
    assert.equal(candidate.parallelMatch, 'UNKNOWN');
    assert.ok(!candidate.variantEvidence.observed.parallelSignals.includes('black'));
    assert.ok(!candidate.variantEvidence.observed.parallelSignals.includes('white'));
  }
});

test('lexical negation and Black & White corrections also preserve legacy human-review output shape', () => {
  const { matchingPolicy, ...legacy } = magikarp;
  const candidate = parsed({ ...legacy, parallel: 'Base' }, pokemonTitle('Non-Holo'));
  assert.equal(candidate.parallelMatch, 'MATCH');
  assert.equal('gradeEvidence' in candidate, false);
  assert.equal('variantEvidence' in candidate, false);
  const { matchingPolicy: policy, ...oldSnivy } = snivy;
  assert.equal(parsed(oldSnivy, '2013 Pokemon Black & White Legendary Treasures Radiant Collection Snivy RC1/RC25').parallelMatch, 'MATCH');
});

test('Pokemon non-holo negation, reverse and ordinary holo are distinct explicit target facts', () => {
  for (const word of ['Non-Holo', 'Non Holographic', 'Nonfoil', 'Non-Foil']) {
    assert.equal(parsed({ ...magikarp, parallel: 'English Non-Holo' }, pokemonTitle(`English ${word}`)).parallelMatch, 'MATCH');
  }
  for (const [expected, actual] of [['Non-Holo', 'Holo'], ['Non-Holo', 'Reverse Holo'], ['Holo', 'Reverse Holo'], ['Reverse Holo', 'Non-Holo']]) {
    const candidate = parsed({ ...magikarp, parallel: `English ${expected}` }, pokemonTitle(`English ${actual}`));
    assert.equal(candidate.parallelMatch, 'CONTRADICTORY'); reason(candidate, 'FINISH_MISMATCH');
  }
  assert.equal(parsed({ ...magikarp, parallel: 'Base' }, pokemonTitle('Holo')).parallelMatch, 'UNKNOWN');
});

test('missing language is not English even when the saved finish matches', () => {
  const candidate = parsed({ ...magikarp, parallel: 'Reverse Holo' }, pokemonTitle('Reverse Holo'));
  assert.equal(candidate.parallelMatch, 'UNKNOWN'); reason(candidate, 'LANGUAGE_TARGET_UNRESOLVED');
  const omitted = parsed({ ...magikarp, parallel: 'English Reverse Holo' }, pokemonTitle('Reverse Holo'));
  assert.equal(omitted.parallelMatch, 'UNKNOWN'); reason(omitted, 'LANGUAGE_UNDISCLOSED');
  const wrong = parsed({ ...magikarp, parallel: 'English Reverse Holo' }, pokemonTitle('Japanese Reverse Holo'));
  assert.equal(wrong.parallelMatch, 'CONTRADICTORY'); reason(wrong, 'LANGUAGE_MISMATCH');
});

test('special Pokemon foil patterns remain separate and Costco does not become Cosmos', () => {
  for (const [expected, actual] of [['Cosmos Holo', 'Reverse Holo'], ['Poke Ball', 'Master Ball'], ['Masterball', 'Pokeball']]) {
    const candidate = parsed({ ...magikarp, parallel: `English ${expected}` }, pokemonTitle(`English ${actual}`));
    assert.equal(candidate.parallelMatch, 'CONTRADICTORY'); reason(candidate, 'FINISH_MISMATCH');
  }
  for (const actual of ['Costco', 'Costco Holo', 'Holo']) {
    const candidate = parsed({ ...magikarp, parallel: 'English Cosmos Holo' }, pokemonTitle(`English ${actual}`));
    assert.equal(candidate.parallelMatch, 'UNKNOWN');
    assert.ok(!candidate.variantEvidence.observed.finish.includes('cosmos holo'));
  }
  assert.equal(parsed({ ...magikarp, parallel: 'English Masterball' }, pokemonTitle('English Master Ball Reverse Holo')).parallelMatch, 'MATCH');
  assert.equal(parsed({ ...magikarp, parallel: 'English Reverse Holo' }, pokemonTitle('English Master Ball Reverse Holo')).parallelMatch, 'UNKNOWN');
});

test('edition, stamp, and promo dimensions require positive evidence and reject a conflicting named version', () => {
  const target = { ...magikarp, parallel: 'English First Edition Non-Holo', variantIdentity: { stamp: 'Pokemon Center', promo: true } };
  const same = parsed(target, pokemonTitle('English 1st Edition Non-Holo Pokemon Center Promo'));
  assert.equal(same.parallelMatch, 'MATCH');
  const wrong = parsed(target, pokemonTitle('English Unlimited Non-Holo Staff Promo'));
  assert.equal(wrong.parallelMatch, 'CONTRADICTORY'); reason(wrong, 'EDITION_MISMATCH'); reason(wrong, 'STAMP_MISMATCH');
  const incomplete = parsed(target, pokemonTitle('English Non-Holo'));
  assert.equal(incomplete.parallelMatch, 'UNKNOWN'); reason(incomplete, 'EDITION_UNDISCLOSED'); reason(incomplete, 'STAMP_UNDISCLOSED'); reason(incomplete, 'PROMO_UNDISCLOSED');
  const explicitNonPromo = parsed({ ...magikarp, parallel: 'English Non-Holo', variantIdentity: { promo: false } }, pokemonTitle('English Non-Holo Promo'));
  assert.equal(explicitNonPromo.parallelMatch, 'CONTRADICTORY'); reason(explicitNonPromo, 'PROMO_MISMATCH');
});

test('sports player/set/team vocabulary is removed but a real extra color or pattern still contradicts', () => {
  const target = { ...sports, variantIdentity: { language: 'English' } };
  assert.equal(parsed(target, sportsTitle('English Red Wave')).parallelMatch, 'MATCH');
  const wrongColor = parsed(target, sportsTitle('English Blue Wave'));
  assert.equal(wrongColor.parallelMatch, 'CONTRADICTORY'); reason(wrongColor, 'PARALLEL_COLOR_MISMATCH');
  const wrongPattern = parsed(target, sportsTitle('English Red Prizm'));
  assert.equal(wrongPattern.parallelMatch, 'CONTRADICTORY'); reason(wrongPattern, 'PARALLEL_PATTERN_MISMATCH');
  const extraColor = parsed(target, sportsTitle('English Red White Blue Wave'));
  assert.equal(extraColor.parallelMatch, 'CONTRADICTORY'); reason(extraColor, 'PARALLEL_COLOR_MISMATCH');
  assert.equal(parsed({ ...target, parallel: 'Base' }, sportsTitle('English Base')).parallelMatch, 'MATCH');
  assert.equal(parsed({ ...target, parallel: null }, sportsTitle('English Red Wave')).parallelMatch, 'UNKNOWN');
  const jays = { ...target, playerName: 'Vladimir Guerrero Jr', parallel: 'Base' };
  assert.equal(parsed(jays, '2024 Panini Prizm Vladimir Guerrero Jr Toronto Blue Jays #24 English Base').parallelMatch, 'MATCH');
});

test('sports numbered, autograph, memorabilia facts distinguish the print run from the copy numerator', () => {
  const target = { ...sports, parallel: 'English Red Wave /99 Autograph Patch' };
  assert.equal(parsed(target, sportsTitle('English Red Wave 07/99 Autograph Patch')).parallelMatch, 'MATCH');
  assert.equal(parsed(target, sportsTitle('English Red Wave 81/99 Autograph Patch')).parallelMatch, 'MATCH');
  const wrong = parsed(target, sportsTitle('English Red Wave 07/49 Autograph Patch'));
  assert.equal(wrong.parallelMatch, 'CONTRADICTORY'); reason(wrong, 'SERIAL_DENOMINATOR_MISMATCH');
  const missing = parsed(target, sportsTitle('English Red Wave Autograph'));
  assert.equal(missing.parallelMatch, 'UNKNOWN'); reason(missing, 'SERIAL_DENOMINATOR_UNDISCLOSED'); reason(missing, 'MEMORABILIA_UNDISCLOSED');
  const unsigned = parsed(target, sportsTitle('English Red Wave /99 Unsigned Patch'));
  assert.equal(unsigned.parallelMatch, 'CONTRADICTORY'); reason(unsigned, 'AUTOGRAPH_MISMATCH');
  const positive = parsed({ ...sports, parallel: 'English Red Wave', variantIdentity: { autograph: false, memorabilia: false } }, sportsTitle('English Red Wave Autograph Patch'));
  reason(positive, 'AUTOGRAPH_MISMATCH'); reason(positive, 'MEMORABILIA_MISMATCH');
});

test('Pokemon collector denominator is never inferred as a sports serial print run', () => {
  const candidate = parsed({ ...magikarp, parallel: 'English Non-Holo' }, pokemonTitle('English Non-Holo'));
  assert.deepEqual(candidate.variantEvidence.observed.serialDenominators, []);
  assert.equal(candidate.parallelMatch, 'MATCH');
});

test('grade groups retain grader, half grades and explicit special designations without conversions', () => {
  for (const [text, designation, key, numeric] of [
    ['PSA 10', 'STANDARD', 'PSA_10', 10], ['PSA10', 'STANDARD', 'PSA_10', 10], ['PSA GEM MT10', 'STANDARD', 'PSA_10', 10], ['BGS 9.5', 'STANDARD', 'BGS_9_5', 9.5],
    ['BGS 10 Black Label', 'BLACK_LABEL', 'BGS_10_BLACK_LABEL', 10],
    ['BGS Black Label 10', 'BLACK_LABEL', 'BGS_10_BLACK_LABEL', 10],
    ['BGS 10 Pristine', 'PRISTINE', 'BGS_10_PRISTINE', 10], ['BGS 10', null, 'BGS_10', 10],
    ['CGC 10 Pristine', 'PRISTINE', 'CGC_10_PRISTINE', 10], ['CGC 10 Perfect', 'PERFECT', 'CGC_10_PERFECT', 10],
    ['CGC 10 Gem Mint', 'STANDARD', 'CGC_10', 10], ['CGC 10', null, 'CGC_10', 10],
    ['CGC Gem Mint 9.5', 'STANDARD', 'CGC_9_5', 9.5], ['SGC 8.5', 'STANDARD', 'SGC_8_5', 8.5],
  ]) {
    const result = grade(`${pokemonTitle('English Non-Holo')} ${text}`, 'Graded');
    assert.equal(result.evidence.status, 'GRADED', text); assert.equal(result.evidence.designation, designation, text);
    assert.equal(result.evidence.groupKey, key, text); assert.equal(result.numericGrade, numeric, text);
  }
});

test('unsupported graders, absent slab numbers, predictions, grade ranges and autograph-only grades never become raw', () => {
  for (const text of ['TAG 10', 'TAG10', 'PSA12345678', 'BGS Authentic', 'Beckett 10', 'PSA', 'PSA/DNA Auto 10', 'PSA AUTO 10', 'Maybe PSA 10', 'PSA 10?',
    'PSA 9/10', 'PSA 9 or 10', 'PSA 9-10', 'PSA 9 (OC)', 'PSA 10 Black Label', 'CGC 9 Pristine', 'PSA 10 BGS 9.5', 'BGS 10.5',
    'SGC 10 Pristine', 'SGC 10 Perfect', 'BGS 10 Perfect']) {
    const candidate = parsed(magikarp, pokemonTitle(text), 'Graded');
    assert.equal(candidate.gradeEvidence.status, 'UNRESOLVED', text); assert.equal(candidate.raw, false, text);
    assert.equal(candidate.grader, null, text); assert.equal(candidate.numericGrade, null, text);
  }
  const missing = parsed(magikarp, pokemonTitle(''), 'Graded');
  assert.equal(missing.gradeEvidence.status, 'UNRESOLVED'); assert.equal(missing.raw, false);
  const rawCandidate = parsed(magikarp, pokemonTitle('English Non-Holo NM'));
  assert.equal(rawCandidate.gradeEvidence.status, 'RAW'); assert.equal(rawCandidate.raw, true);
  const cardAndAuto = grade(sportsTitle('PSA 9 Auto 10'), 'Graded');
  assert.equal(cardAndAuto.numericGrade, 9); assert.equal(cardAndAuto.evidence.groupKey, 'PSA_9');
});

test('ATLAS query remains broad across grades and validates optional evidenced dimensions', () => {
  assert.equal(query(magikarp), '2020 Rebel Clash Magikarp #039/192');
  for (const variantIdentity of [{ autograph: 'no' }, { serialDenominator: 0 }, { language: '' }, { invented: 'yes' }]) {
    assert.throws(() => query({ ...magikarp, variantIdentity }), /Variant|Serial|variant/);
  }
  assert.throws(() => query({ ...magikarp, matchingPolicy: 'UNKNOWN' }), /matching policy/);
});
