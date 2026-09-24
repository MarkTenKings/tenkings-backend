import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createInput, cardInput, identityInput, ownedUpload } from '../src/contract.mjs';
test('customer cannot select account, price, arbitrary terminal or staff role', () => {
  const valid = { requestId: randomUUID(), intakeMethod: 'MAIL_IN', kioskId: null };
  assert.deepEqual(createInput(valid), valid);
  for (const field of ['accountId', 'staff', 'price', 'terminalId']) assert.throws(() => createInput({ ...valid, [field]: 'forged' }));
  assert.throws(() => createInput({ ...valid, intakeMethod: 'DEALER_DROP_OFF' }));
});
test('closed pair contracts bind unique side IDs and hashes; camera filenames are display only', () => {
  const photo = () => ({ uploadId: randomUUID(), sha256: 'a'.repeat(64), byteCount: 100, fileName: 'IMG_1234.HEIC' });
  const pair = { requestId: randomUUID(), cardId: randomUUID(), pairId: randomUUID(), front: photo(), back: { ...photo(), sha256: 'b'.repeat(64) } };
  assert.deepEqual(cardInput(pair), pair);
  for (const bad of [{ ...pair, back: pair.front }, { ...pair, front: { ...pair.front, byteCount: 0 } }, { ...pair, role: 'REVIEWER' }]) assert.throws(() => cardInput(bad));
});
test('customer details admit identity corrections, never grading/report fields', () => {
  const identity = { category: 'SPORTS', title: 'Test', playerName: '', year: '', manufacturer: '', setName: '', cardNumber: '', parallel: '', insert: '' };
  assert.equal(identityInput(identity).title, 'Test');
  assert.throws(() => identityInput({ ...identity, grade: '10' })); assert.throws(() => identityInput({ ...identity, title: '' }));
});
test('owned upload refuses staff storage or mismatched account/side binding', () => {
  const accountId = randomUUID(), cardId = randomUUID(), pairId = randomUUID(), uploadId = randomUUID();
  const upload = { accountId, cardId, pairId, draftId: randomUUID(), side: 'FRONT', plan: { schemaVersion: 1, uploadId, binding: { cardId, pairId, side: 'FRONT', version: 1 }, object: { key: `atlas-customer/originals/${accountId}/${cardId}/${uploadId}`, versionId: null }, expected: { sha256: 'a'.repeat(64), byteCount: 100 } } };
  assert.equal(ownedUpload(upload), upload);
  assert.throws(() => ownedUpload({ ...upload, accountId: randomUUID() })); assert.throws(() => ownedUpload({ ...upload, side: 'BACK' }));
});
