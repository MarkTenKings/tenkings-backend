import test from 'node:test';
import assert from 'node:assert/strict';
import { intakePhotoAttention, geometryCorrectionAttention, analysisCorrectionAttention } from '../lib/manual-review-attention.mjs';

test('photo warnings follow the selected upload and disappear when that side becomes ready', () => {
  const saved = { card: { sides: { FRONT: { upload: { uploadId: 'new-front', source: {} } }, BACK: { upload: { uploadId: 'back', source: {} } } } },
    earlyGeometry: { FRONT: { uploadId: 'old-front', state: 'FAILED' }, BACK: { uploadId: 'back', state: 'READY' } } };
  assert.deepEqual(intakePhotoAttention(saved), []);
  saved.earlyGeometry.FRONT.uploadId = 'new-front';
  assert.deepEqual(intakePhotoAttention(saved).map(i => i.side), ['FRONT']);
  saved.earlyGeometry.FRONT.state = 'READY'; assert.deepEqual(intakePhotoAttention(saved), []);
});

test('geometry guidance chooses the exact missing side/tool and respects saved confirmation', () => {
  const confirmed = { image: {}, physical: {}, prepared: {}, printed: {}, confirmation: {} };
  const state = { sides: { FRONT: structuredClone(confirmed), BACK: { image: {}, physical: {}, prepared: {}, printed: null } } };
  let issues = geometryCorrectionAttention(state);
  assert.equal(issues.length, 1); assert.equal(issues[0].side, 'BACK'); assert.equal(issues[0].kind, 'PRINTED');
  state.sides.BACK.printed = {}; issues = geometryCorrectionAttention(state);
  assert.equal(issues[0].reviewBoth, true);
  state.sides.BACK.confirmation = {}; assert.deepEqual(geometryCorrectionAttention(state), []);
  state.sides.FRONT = { image: {} }; issues = geometryCorrectionAttention(state);
  assert.equal(issues.length, 1); assert.equal(issues[0].side, 'FRONT'); assert.equal(issues[0].kind, 'PHYSICAL');
});

test('analysis warnings do not label running or completed analysis as a failure', () => {
  for (const status of ['RUNNING', 'READY', 'IDLE']) assert.deepEqual(analysisCorrectionAttention({ enabled: true, status }), []);
  assert.equal(analysisCorrectionAttention({ enabled: true, status: 'REFUSED' })[0].key, 'analysis');
  assert.equal(analysisCorrectionAttention({ enabled: true, status: 'UNKNOWN', collectionStopped: true }).length, 1);
  assert.deepEqual(analysisCorrectionAttention({ enabled: true, status: 'UNKNOWN', backgroundAccepted: true }), []);
});
