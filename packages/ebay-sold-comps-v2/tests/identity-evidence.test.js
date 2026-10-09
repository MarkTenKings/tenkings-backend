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

// Titles and item IDs observed in the saved 2026-10-08 automatic backfill.
// These are local fixtures, never live provider requests or verified photos.
const charmander = { ...magikarp, cardName: 'Charmander', year: '2023', productSet: 'Scarlet & Violet—151', cardNumber: '004/165' };
const pikachu = { ...charmander, cardName: 'Pikachu', cardNumber: '025/165' };
const observed = (input, itemId, title) => parse({ ...raw(title), itemId, url: `https://www.ebay.com/itm/${itemId}` }, input);

test('actual Reverse Cosmos wording preserves both finish signals instead of collapsing to ordinary holo', () => {
  const title = 'Magikarp 039/192 Reverse Cosmos Holo Promo Pokemon Pikachu English Rebel Clash';
  const candidate = observed(magikarp, '227536166244', title);
  assert.deepEqual(candidate.variantEvidence.observed.finish, ['reverse holo', 'cosmos holo']);
  assert.equal(candidate.variantEvidence.observed.promo, true);
  assert.equal(candidate.parallelMatch, 'UNKNOWN'); reason(candidate, 'VARIANT_TARGET_UNRESOLVED');
  for (const parallel of ['English Holo Promo', 'English Reverse Holo Promo']) {
    const wrong = observed({ ...magikarp, parallel }, '227536166244', title);
    assert.equal(wrong.parallelMatch, 'CONTRADICTORY'); reason(wrong, 'FINISH_MISMATCH');
  }
  assert.equal(observed({ ...magikarp, parallel: 'English Reverse Cosmos Holo Promo' }, '227536166244', title).parallelMatch, 'MATCH');
  for (const wording of ['Cosmos Reverse Holo', 'Reverse Cosmos Holo', 'Rev Cosmos Holo', 'Reverse Cosmo Holo']) {
    assert.deepEqual(parsed(magikarp, pokemonTitle(wording)).variantEvidence.observed.finish, ['reverse holo', 'cosmos holo']);
  }
});

test('actual singular Cosmo names the Cosmos finish without inferring the approved printing or language', () => {
  const title = 'Pokemon Card Charmander 004/165 Scarlet & Violet 151 Cosmo Holo Near Mint';
  const candidate = observed(charmander, '267703750498', title);
  assert.deepEqual(candidate.variantEvidence.observed.finish, ['cosmos holo']);
  assert.deepEqual(candidate.variantEvidence.observed.language, []);
  assert.equal(candidate.parallelMatch, 'UNKNOWN'); reason(candidate, 'VARIANT_TARGET_UNRESOLVED');
  const wrong = observed({ ...charmander, parallel: 'English Reverse Holo' }, '267703750498', title);
  assert.equal(wrong.parallelMatch, 'CONTRADICTORY'); reason(wrong, 'FINISH_MISMATCH');
  const sameWithoutLanguage = observed({ ...charmander, parallel: 'English Cosmos Holo' }, '267703750498', title);
  assert.equal(sameWithoutLanguage.parallelMatch, 'UNKNOWN'); reason(sameWithoutLanguage, 'LANGUAGE_UNDISCLOSED');
  assert.deepEqual(parsed(charmander, 'Charmander 004/165 Costco Holo').variantEvidence.observed.finish, ['holo']);
});

test('actual GameStop stamp remains observed evidence and contradicts an explicitly unstamped target', () => {
  const title = 'Pokémon TCG Charmander 004/165 GameStop Stamp Scarlet & Violet: 151 SEALED';
  const candidate = observed(charmander, '800725203478', title);
  assert.deepEqual(candidate.variantEvidence.observed.stamp, ['gamestop']);
  assert.equal(candidate.parallelMatch, 'UNKNOWN'); reason(candidate, 'STAMP_TARGET_UNRESOLVED');
  assert.equal(candidate.variantEvidence.observed.promo, null); // Stamp wording is not a claim of a promo classification.
  const wrong = observed({ ...charmander, parallel: 'English Non-Holo', variantIdentity: { stamp: 'none' } }, '800725203478', title);
  assert.equal(wrong.parallelMatch, 'CONTRADICTORY'); reason(wrong, 'STAMP_MISMATCH');
  const explicit = { ...charmander, parallel: 'English Non-Holo', variantIdentity: { stamp: 'GameStop' } };
  assert.equal(parsed(explicit, '2023 Charmander 004/165 Scarlet Violet 151 English Non-Holo GameStop Stamp').parallelMatch, 'MATCH');
  assert.equal(parsed(explicit, '2023 Charmander 004/165 Scarlet Violet 151 English Non-Holo Game Stop Stamp').parallelMatch, 'MATCH');
  for (const parallel of ['English Non-Holo Game Stop Stamp', 'English Non-Holo GameStop', 'English Non-Holo GameStop Stamped']) {
    assert.equal(parsed({ ...charmander, parallel }, '2023 Charmander 004/165 Scarlet Violet 151 English Non-Holo GameStop').parallelMatch, 'MATCH', parallel);
    assert.equal(parsed({ ...charmander, parallel }, '2023 Charmander 004/165 Scarlet Violet 151 English Non-Holo Game Stop Stamp').parallelMatch, 'MATCH', parallel);
  }
});

test('actual Pokémon FR evidence is French, stays distinct from English and does not reinterpret sports initials', () => {
  const title = '2023 Pokemon SV: Scarlet & Violet 151 FR Charmander #004/165 Common Gamestop';
  const candidate = observed(charmander, '158333471911', title);
  assert.deepEqual(candidate.variantEvidence.observed.language, ['french']);
  assert.deepEqual(candidate.variantEvidence.observed.stamp, ['gamestop']);
  assert.equal(candidate.parallelMatch, 'UNKNOWN'); reason(candidate, 'VARIANT_TARGET_UNRESOLVED');
  const wrong = observed({ ...charmander, parallel: 'English Non-Holo' }, '158333471911', title);
  assert.equal(wrong.parallelMatch, 'CONTRADICTORY'); reason(wrong, 'LANGUAGE_MISMATCH');
  assert.equal(parsed({ ...charmander, parallel: 'FR Non-Holo' }, '2023 Charmander 004/165 Scarlet Violet 151 French Non-Holo').parallelMatch, 'MATCH');
  assert.deepEqual(parsed(sports, sportsTitle('FR Red Wave')).variantEvidence.observed.language, []);
});

test('actual unanchored picker and multi-card offers are excluded only from the ATLAS matching policy', () => {
  const fixtures = [
    [charmander, '256243811242', 'Pokemon Cards - Scarlet & Violet: 151 - Holos & Reverse Holos - Buy 5 Get 5 FREE'],
    [charmander, '256312536052', 'Pokemon Cards - Scarlet & Violet: 151 - Non-Holo SIngles - BUY 5 GET 5 FREE -'],
    [charmander, '276276967286', 'Pokemon TCG Scarlet & Violet 151 Holo & Reverse Holo Cards - Choose Your Own'],
    [charmander, '186108582833', 'Pokémon Scarlet Violet 151 Set 01-165 SAVE UP TO 30% Reverse Holo English NM/M'],
    [magikarp, '304285169906', 'Pokemon - SWSH Rebel Clash - Reverse & Standard Holo SIngles'],
    [magikarp, '257134563708', 'Pokemon Cards - Sword & Shield: Rebel Clash - Holos & Reverse Holos - TCG'],
  ];
  for (const [input, itemId, title] of fixtures) {
    assert.equal(observed(input, itemId, title), null, itemId);
    const { matchingPolicy, ...legacy } = input;
    assert.ok(observed(legacy, itemId, title), `legacy ${itemId}`);
  }
  for (const [input, itemId, title] of fixtures.slice(0, 3)) assert.equal(observed(pikachu, itemId, title), null, itemId);
  assert.equal(parsed(charmander, 'Pokemon Scarlet Violet 151 lot of 10 assorted cards'), null);
});

test('named single cards and exact collector aliases remain reviewable despite seller promotion wording', () => {
  for (const [input, title] of [
    [snivy, 'Snivy RC1/RC25 Holo Common Legendary Treasures: Radiant Collection Pokemon Cards'],
    [charmander, 'Charmander 004/165 Scarlet Violet 151 Reverse Holo BUY 5 GET 5 FREE'],
    [charmander, 'Charmander Scarlet Violet 151 Reverse Holo Buy 5 Get 5 Free'],
    [charmander, 'Pokemon Scarlet Violet 151 #4/165 Non-Holo Singles'],
    [pikachu, 'Pokemon Scarlet Violet 151 #25/165 Reverse Holo Cards'],
    [snivy, 'Pokemon Legendary Treasures #RC01/RC25 Holo Singles'],
    [sports, '2024 Panini Prizm Draymond Green #24 Red Wave NBA Cards'],
  ]) {
    assert.ok(parsed(input, title), title);
  }
});
