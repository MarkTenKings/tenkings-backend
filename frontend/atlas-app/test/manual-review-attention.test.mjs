import test from 'node:test';
import assert from 'node:assert/strict';
import { intakePhotoAttention, geometryCorrectionAttention, analysisCorrectionAttention } from '../lib/manual-review-attention.mjs';

test('photo warnings follow the selected upload and disappear when that side becomes ready', () => {
  const saved = { card: { sides: { FRONT: { upload: { uploadId: 'new-front', source: {} } }, BACK: { upload: { uploadId: 'back', source: {} } } } },
    earlyGeometry: { FRONT: { uploadId: 'old-front', state: 'FAILED' }, BACK: { uploadId: 'back', state: 'READY' } } };
  assert.deepEqual(intakePhotoAttention(saved), []);
  saved.earlyGeometry.FRONT.uploadId = 'new-front';
  assert.deepEqual(intakePhotoAttention(saved).map(i => i.side), ['FRONT']);
  saved.manual = {current:true}; assert.deepEqual(intakePhotoAttention(saved), []);
  saved.manual.current = false; assert.deepEqual(intakePhotoAttention(saved).map(i => i.side), ['FRONT']);
  delete saved.manual;
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

test('the explicitly selected side leads geometry guidance without dropping the other side',()=>{
 const geometry={sides:{FRONT:{image:{}},BACK:{image:{},physical:{},prepared:{}}}};
 assert.deepEqual(geometryCorrectionAttention(geometry,'BACK').map(i=>[i.side,i.kind]),[['BACK','PRINTED'],['FRONT','PHYSICAL']]);
 assert.deepEqual(geometryCorrectionAttention(geometry,'invalid').map(i=>i.side),['FRONT','BACK']);
});

test('explicit editor entry still focuses a confirmed side without disturbing the opposite confirmation',()=>{
 const slot={image:{},physical:{},prepared:{},printed:{},confirmation:{}};
 const geometry={sides:{FRONT:structuredClone(slot),BACK:structuredClone(slot)}};
 assert.deepEqual(geometryCorrectionAttention(geometry),[]);
 assert.deepEqual(geometryCorrectionAttention(geometry,'BACK').map(i=>[i.side,i.kind]),[['BACK','PHYSICAL']]);
 assert.deepEqual(geometry.sides.BACK.confirmation,{});
});
