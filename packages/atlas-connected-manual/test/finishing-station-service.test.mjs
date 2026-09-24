import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFinishingStationService } from '../src/finishing-station-service.mjs';
import { stationKeys, hashClaims } from './finishing-station-fixture.mjs';
import { samplePlan } from '../../atlas-finishing/test/manual-fixture.mjs';

function fixture({ trusted = true, mode = 'PRODUCTION', canCertify = true } = {}) {
  const keys = stationKeys(), staff = {}, principal = { id: randomUUID(), role: 'REVIEWER', mode, canCertify };
  const state = { now: 1800000000000, plan: samplePlan(), enrolled: false, record: null, active: null, signingFails: false, commits: 0 };
  const guard = actor => assert.equal(actor, staff, 'actual authenticated opaque staff handle required');
  const repository = {
    async list(actor) { guard(actor); return { principal, enrollments: state.enrolled ? [keys.enrollment] : [], active: state.active ? [{ station_id: keys.enrollment.stationId, intent_id: state.active }] : [] }; },
    async challenge(actor, input, make) { guard(actor); state.challenge = make({ now: state.now, challengeId: randomUUID() }); return state.challenge; },
    async enrollmentChallenge(actor, id) { guard(actor); assert.equal(id, state.challenge.challengeId); return { challenge: state.challenge, principal, now: state.now }; },
    async enroll(actor, input, proof, fingerprint) { guard(actor); assert.equal(fingerprint, keys.enrollment.keyFingerprint); assert.equal(proof.challengeId, state.challenge.challengeId);
      state.enrolled = true; return { enrollment: keys.enrollment, principal }; },
    async enrollment(actor, id) { guard(actor); assert.equal(id, keys.enrollment.enrollmentId); assert.equal(state.enrolled, true); return { enrollment: keys.enrollment, principal, now: state.now }; },
    async reserveArm(actor, input, claims, authorization) { guard(actor);
      if (state.record?.request.requestId === input.requestId) { assert.deepEqual(input, state.record.request); return state.record; }
      assert.equal(state.active, null, 'STATION_BUSY');
      state.active = claims.intentId; state.record = { claims, authorization, authorizationHash: hashClaims(claims), request: input, receipts: [] }; return state.record;
    },
    async intent(actor, id) { guard(actor); assert.equal(id, state.record.claims.intentId); return { ...structuredClone(state.record), enrollment: keys.enrollment, principal, now: state.now }; },
    async commitReceipt(actor, input, kind, authorizationHash) { guard(actor); assert.equal(authorizationHash, state.record.authorizationHash);
      const prior = state.record.receipts.find(item => item.kind === kind), receiptHash = hashClaims(input.receipt);
      if (prior) { assert.equal(prior.receiptHash, receiptHash, 'STATION_RECEIPT_CONFLICT'); return prior; }
      const saved = { kind, receipt: structuredClone(input.receipt), signature: input.signature, receiptHash, recordedAt: state.now };
      state.record.receipts.push(saved); state.commits++; if (kind === 'REMOVAL') state.active = null; return saved;
    },
  };
  const signer = { ...keys.signer, async signClaims(claims) { if (state.signingFails) throw new Error('fixture signer unavailable'); return keys.signer.signClaims(claims); } };
  const service = createFinishingStationService({ repository, signer, finishing: { async load(actor, cardId, actionId) {
    guard(actor); assert.equal(cardId, state.plan.binding.cardId); assert.equal(actionId, state.plan.binding.approvalActionId); return state.plan;
  } }, trustedStations: trusted ? [keys.trust(principal.id)] : [], clock: () => state.now });
  const armInput = () => ({ requestId: randomUUID(), stationId: keys.enrollment.stationId, enrollmentId: keys.enrollment.enrollmentId,
    cardId: state.plan.binding.cardId, approvalActionId: state.plan.binding.approvalActionId, physicalCardPresent: true });
  async function enroll() { const { challenge, authorization } = await service.challenge(staff, { requestId: randomUUID(), stationId: keys.enrollment.stationId });
    assert.deepEqual(await keys.verifier.verifyEnvelope(authorization), challenge); return service.enroll(staff, keys.proof(challenge)); }
  async function arm() { await enroll(); const input = armInput(), result = await service.arm(staff, input); return { input, result, claims: await keys.verifier.verifyEnvelope(result.association.authorization) }; }
  return { keys, staff, principal, state, service, armInput, enroll, arm, repository, signer };
}

test('enrollment signs possession evidence without trusting self-enrollment or accepting forged proof', async () => {
  const f = fixture({ trusted: false }), enrolled = await f.enroll();
  assert.equal(enrolled.state, 'PENDING_ACTIVATION'); assert.equal(enrolled.profileHash, null);
  const { authorization, ...claims } = enrolled; assert.deepEqual(await f.keys.verifier.verifyEnvelope(authorization), claims);
  await assert.rejects(f.service.arm(f.staff, f.armInput()), { code: 'STATION_NOT_ACTIVATED' });
  const bad = f.keys.proof(f.state.challenge); bad.protectionEvidenceHash = '1'.repeat(64);
  await assert.rejects(f.service.enroll(f.staff, bad), { code: 'STATION_SIGNATURE_INVALID' });
  await assert.rejects(f.service.enroll(f.staff, { ...f.keys.proof(f.state.challenge), qualified: true }), { code: 'STATION_INPUT_INVALID' });
});
test('active trust is bound to one exact protected enrollment and one operator; local sessions cannot arm production', async () => {
  const f = fixture({ mode: 'LOCAL_FIXTURE' }); await f.enroll();
  assert.equal((await f.service.list(f.staff)).stations[0].canArm, false);
  await assert.rejects(f.service.arm(f.staff, f.armInput()), { code: 'STATION_PRODUCTION_SESSION_REQUIRED' });
  const g = fixture({ canCertify: false }); await g.enroll();
  await assert.rejects(g.service.arm(g.staff, g.armInput()), { code: 'MANUAL_CERTIFICATION_REQUIRED' });
  const trust = f.keys.trust(f.principal.id); trust.allowedStaffIds.push(randomUUID());
  assert.throws(() => createFinishingStationService({ repository: f.repository, signer: f.signer, finishing: { load() {} }, trustedStations: [trust] }), { code: 'STATION_SINGLE_OPERATOR_REQUIRED' });
});
test('arm carries exact published bytes/version, a bounded deadline and durable retry; physical association is explicit', async () => {
  const f = fixture(), { input, result, claims } = await f.arm();
  assert.equal(claims.url, f.state.plan.nfc.url); assert.equal(claims.planHash, f.state.plan.planHash);
  assert.equal(claims.expiresAt - claims.issuedAt, 900000); assert.equal(claims.intentId, f.state.plan.nfc.intentId);
  f.state.now += 10000; assert.deepEqual(await f.service.arm(f.staff, input), result);
  await assert.rejects(f.service.arm(f.staff, f.armInput()), /STATION_BUSY/);
  await assert.rejects(f.service.arm(f.staff, { ...input, physicalCardPresent: false }), { code: 'STATION_PHYSICAL_ASSOCIATION_REQUIRED' });
  await assert.rejects(f.service.arm(f.staff, { ...input, url: 'https://other.invalid' }), { code: 'STATION_INPUT_INVALID' });
  assert.equal((await f.service.list(f.staff)).stations[0].canArm, false);
});
test('unpublished/fixture plan and foreign card cannot acquire a physical intent', async () => {
  const f = fixture(); await f.enroll(); f.state.plan = samplePlan({ mode: 'LOCAL_FIXTURE' });
  await assert.rejects(f.service.arm(f.staff, f.armInput()), { code: 'STATION_PUBLISHED_PRODUCTION_REPORT_REQUIRED' });
  f.state.plan = samplePlan(); await assert.rejects(f.service.arm(f.staff, { ...f.armInput(), cardId: randomUUID() }));
  assert.equal(f.state.active, null);
});
test('verified write is committed before signed ack; lost host signature retries exactly after expiry without another write', async () => {
  const f = fixture(), { claims } = await f.arm(), receipt = f.keys.result(claims), input = { receipt, signature: f.keys.signNative(receipt) };
  f.state.signingFails = true; await assert.rejects(f.service.acknowledge(f.staff, input), /signer unavailable/);
  assert.equal(f.state.commits, 1); assert.equal(f.state.active, claims.intentId);
  f.state.now = claims.expiresAt + 1000; f.state.signingFails = false;
  const ack = await f.keys.verifier.verifyEnvelope(await f.service.acknowledge(f.staff, input));
  assert.equal(ack.committed, true); assert.equal(ack.kind, 'WRITE'); assert.equal(ack.receiptHash, hashClaims(receipt)); assert.equal(f.state.commits, 1);
  assert.equal(f.state.active, claims.intentId, 'receipt acknowledgement alone never releases physical slot');
});
test('forged, cross-card, incomplete or expired new write receipts never commit', async () => {
  const f = fixture(), { claims } = await f.arm(), receipt = f.keys.result(claims);
  await assert.rejects(f.service.acknowledge(f.staff, { receipt, signature: stationKeys().signNative(receipt) }), { code: 'STATION_SIGNATURE_INVALID' });
  const changed = { ...receipt, planHash: '0'.repeat(64) };
  await assert.rejects(f.service.acknowledge(f.staff, { receipt: changed, signature: f.keys.signNative(changed) }), { code: 'STATION_RESULT_BINDING_CHANGED' });
  await assert.rejects(f.service.acknowledge(f.staff, { receipt: { ...receipt, lockVerified: false }, signature: f.keys.signNative(receipt) }));
  await assert.rejects(f.service.acknowledge({}, { receipt, signature: f.keys.signNative(receipt) }));
  f.state.now = claims.expiresAt; await assert.rejects(f.service.acknowledge(f.staff, { receipt, signature: f.keys.signNative(receipt) }), { code: 'STATION_ARM_EXPIRED' });
  assert.equal(f.state.commits, 0); assert.equal(f.state.active, claims.intentId);
});
test('only signed removal referencing committed write releases station; delayed signed custody relays safely', async () => {
  const f = fixture(), { claims } = await f.arm(), write = f.keys.result(claims), removal = f.keys.removal(claims, write);
  const signed = { receipt: removal, signature: f.keys.signNative(removal) };
  await assert.rejects(f.service.complete(f.staff, signed), { code: 'STATION_WRITE_RECEIPT_REQUIRED' });
  await f.service.acknowledge(f.staff, { receipt: write, signature: f.keys.signNative(write) });
  const wrong = { ...removal, receiptHash: '0'.repeat(64) };
  await assert.rejects(f.service.complete(f.staff, { receipt: wrong, signature: f.keys.signNative(wrong) }), { code: 'STATION_WRITE_RECEIPT_REQUIRED' });
  f.state.now = claims.expiresAt + 1000;
  const ack = await f.keys.verifier.verifyEnvelope(await f.service.complete(f.staff, signed));
  assert.equal(ack.kind, 'REMOVAL'); assert.equal(ack.receiptHash, hashClaims(removal)); assert.equal(f.state.active, null);
  assert.deepEqual(await f.keys.verifier.verifyEnvelope(await f.service.complete(f.staff, signed)), ack); assert.equal(f.state.commits, 2);
});
