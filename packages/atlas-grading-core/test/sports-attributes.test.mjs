import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { atlasPrintedSerial, emptyAtlasSportsAttributes, parseAtlasSportsAttributes, assertAtlasSportsAttributePhotos, projectAtlasSportsAttributes, atlasPublicSportsAttributesSchema } from '../dist/sports-attributes.js';
const front = { side: 'FRONT', imageSha256: 'a'.repeat(64), observation: 'Lower right: 007/099.' };
const back = { side: 'BACK', imageSha256: 'b'.repeat(64), observation: 'Back: the enclosed player-worn material is guaranteed by the manufacturer.' };
const feature = (kind = 'CASE_HIT') => ({ kind, evidence: { type: 'REVIEWED_REFERENCE', sourceTitle: 'Synthetic manufacturer checklist',
  sourceUrl: 'https://example.com/checklist#card-7', matchNote: 'The reference identifies card 7 and this exact printing as a case hit.' } });
function reviewed() {
  const value = emptyAtlasSportsAttributes();
  value.serial = { presence: 'PRESENT', ...atlasPrintedSerial('007/099'), evidence: [front] };
  value.autograph = { presence: 'PRESENT', type: 'STICKER', evidence: [{ ...back, observation: 'Back signature visible on a separate adhesive panel.' }] };
  value.relic = { presence: 'PRESENT', evidence: [front], windows: [{ position: 'Upper left', material: 'Fabric', manufacturerStatement: 'The enclosed player-worn material is guaranteed by the manufacturer.', use: 'PLAYER_WORN', evidence: [back] }] };
  return value;
}
test('reviewed numbering preserves printed zeros and separates numeric denominator from checklist identity', () => {
  assert.deepEqual(atlasPrintedSerial('007/099'), { printed: '007/099', numerator: 7, denominator: 99 });
  assert.deepEqual(atlasPrintedSerial('001 / 001'), { printed: '001 / 001', numerator: 1, denominator: 1 });
  for (const value of ['000/099', '100/099', '1/0', '/99', '99', '1/1000000', '1 of 99']) assert.throws(() => atlasPrintedSerial(value));
  const value = reviewed(); value.serial.denominator = 100;
  assert.throws(() => parseAtlasSportsAttributes(value));
});
test('presence is explicitly reviewed, both sides may support a signature, and absence is not inferred', () => {
  assert.deepEqual(parseAtlasSportsAttributes(emptyAtlasSportsAttributes()), emptyAtlasSportsAttributes());
  assert.equal(parseAtlasSportsAttributes(reviewed()).autograph.evidence[0].side, 'BACK');
  const value = reviewed(); value.autograph.evidence = [];
  assert.throws(() => parseAtlasSportsAttributes(value));
  value.autograph = { presence: 'ABSENT', type: 'UNKNOWN', evidence: [front] };
  assert.throws(() => parseAtlasSportsAttributes(value));
  value.autograph.evidence.push(back); assert.equal(parseAtlasSportsAttributes(value).autograph.presence, 'ABSENT');
});
test('each relic window keeps its exact material and manufacturer statement with no wear inference', () => {
  const value = reviewed();
  value.relic.windows.push({ position: 'Lower right', material: null, manufacturerStatement: null, use: 'UNKNOWN', evidence: [front] });
  const result = parseAtlasSportsAttributes(value);
  assert.equal(result.relic.windows[0].use, 'PLAYER_WORN');
  assert.equal(result.relic.windows[1].material, null); assert.equal(result.relic.windows[1].use, 'UNKNOWN');
  result.relic.windows[1].use = 'GAME_USED'; assert.throws(() => parseAtlasSportsAttributes(result));
});
test('reviewed claims bind exact saved side photographs; stale/replaced sources cannot be reused', () => {
  assert.equal(assertAtlasSportsAttributePhotos(reviewed(), { FRONT: front.imageSha256, BACK: back.imageSha256 }).serial.printed, '007/099');
  assert.throws(() => assertAtlasSportsAttributePhotos(reviewed(), { FRONT: 'c'.repeat(64), BACK: back.imageSha256 }), /PHOTO_STALE/);
  assert.throws(() => parseAtlasSportsAttributes({ ...reviewed(), authority: 'MACHINE_PROPOSAL' }));
});
test('public projection retains approved card facts but excludes private observations and source hashes', () => {
  const original = reviewed(), before = JSON.stringify(original), projected = projectAtlasSportsAttributes(original);
  assert.equal(projected.serial.printed, '007/099'); assert.equal(projected.autograph.type, 'STICKER');
  assert.equal(projected.relic.windows[0].manufacturerStatement, original.relic.windows[0].manufacturerStatement);
  assert.doesNotMatch(JSON.stringify(projected), /imageSha256|observation|HUMAN_REVIEWED|evidence/);
  assert.equal(JSON.stringify(original), before);
  assert.throws(() => atlasPublicSportsAttributesSchema.parse({ ...projected, actorId: 'staff' }));
});
test('special features require a bounded exact kind and an explicit private reviewed reference', () => {
  const value = { ...emptyAtlasSportsAttributes(), specialFeatures: [feature()] };
  assert.deepEqual(parseAtlasSportsAttributes(value), value);
  assert.deepEqual(assertAtlasSportsAttributePhotos(value, {}), value);
  for (const mutate of [v => { v.specialFeatures = []; }, v => { v.specialFeatures.push(feature()); },
    v => { v.specialFeatures[0].kind = 'RARE'; }, v => { delete v.specialFeatures[0].evidence; },
    v => { v.specialFeatures[0].evidence.type = 'MACHINE_PROPOSAL'; }, v => { v.specialFeatures[0].evidence.matchNote = ''; },
    v => { v.specialFeatures[0].evidence.sourceTitle = 'a'.repeat(161); }, v => { v.specialFeatures[0].evidence.matchNote = 'a'.repeat(601); },
    v => { v.specialFeatures[0].evidence.actorId = 'invented'; }]) {
    const invalid = structuredClone(value); mutate(invalid); assert.throws(() => parseAtlasSportsAttributes(invalid));
  }
  for (const sourceUrl of ['http://example.com', 'javascript:alert(1)', 'https:example.com', 'https://user:secret@example.com', 'https://example.com/ with-space', 'https://example.com/\\path', ' https://example.com', 'https://example.com/' + 'a'.repeat(2048)]) {
    const invalid = structuredClone(value); invalid.specialFeatures[0].evidence.sourceUrl = sourceUrl; assert.throws(() => parseAtlasSportsAttributes(invalid));
  }
});
test('special feature projection strips reference evidence while omitted historical keys stay omitted', () => {
  const old = reviewed(), oldPublic = projectAtlasSportsAttributes(old);
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  // Captured from the same fixture using the exact 20b747ba source parser.
  assert.equal(digest(parseAtlasSportsAttributes(old)), 'a5aca127929cd659c0e83f77762c7ec8659dfcd8bd3868100afef60012010047');
  assert.equal(digest(oldPublic), '8ab6b71b144ae3e0d0ba322bad75bc31a63ba2f6703c282959cea9813633b7b0');
  assert.equal(Object.hasOwn(old, 'specialFeatures'), false); assert.equal(Object.hasOwn(oldPublic, 'specialFeatures'), false);
  const value = { ...old, specialFeatures: [feature(), feature('SHORT_PRINT'), feature('SUPER_SHORT_PRINT')] }, privateBefore = JSON.stringify(value);
  const projected = projectAtlasSportsAttributes(value);
  assert.deepEqual(projected.specialFeatures, [{ kind: 'CASE_HIT' }, { kind: 'SHORT_PRINT' }, { kind: 'SUPER_SHORT_PRINT' }]);
  assert.doesNotMatch(JSON.stringify(projected), /sourceTitle|sourceUrl|matchNote|REVIEWED_REFERENCE|example\.com/);
  assert.equal(JSON.stringify(value), privateBefore); assert.deepEqual(atlasPublicSportsAttributesSchema.parse(projected), projected);
  assert.throws(() => atlasPublicSportsAttributesSchema.parse({ ...projected, specialFeatures: [feature()] }));
  const stale = structuredClone(value); stale.serial.evidence[0].imageSha256 = 'c'.repeat(64);
  assert.throws(() => assertAtlasSportsAttributePhotos(stale, { FRONT: front.imageSha256, BACK: back.imageSha256 }), /PHOTO_STALE/);
});
