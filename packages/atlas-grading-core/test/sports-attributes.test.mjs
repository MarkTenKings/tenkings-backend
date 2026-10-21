import test from 'node:test';
import assert from 'node:assert/strict';
import { atlasPrintedSerial, emptyAtlasSportsAttributes, parseAtlasSportsAttributes, assertAtlasSportsAttributePhotos, projectAtlasSportsAttributes, atlasPublicSportsAttributesSchema } from '../dist/sports-attributes.js';
const front = { side: 'FRONT', imageSha256: 'a'.repeat(64), observation: 'Lower right: 007/099.' };
const back = { side: 'BACK', imageSha256: 'b'.repeat(64), observation: 'Back: the enclosed player-worn material is guaranteed by the manufacturer.' };
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
