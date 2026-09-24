import { randomBytes } from 'node:crypto';
import { validateManualFinishingPlan } from '@atlas/finishing/manual';
import { encodeApprovedNdef } from '@atlas/finishing/mac-nfc';
import { STATION_WIRE as W, stationAssert as check, stationObject as object, stationId, stationUuid, stationSha,
  stationCanonical as canonical, stationHash as hash, stationPublicKey, stationEnrollmentProof, stationProfileHash,
  verifyStationSignature, createStationVerifier, validateStationArm, validateStationResult, validateStationRemoval,
  validateStationEnrollment, validateStationAcknowledgement } from './finishing-station-protocol.mjs';

function trustConfiguration(items) {
  check(Array.isArray(items) && items.length <= 64, 'STATION_TRUST_INVALID', 503);
  const result = new Map();
  for (const value of structuredClone(items)) {
    object(value, ['stationId','enrollmentId','keyId','keyFingerprint','protectionEvidenceHash','activationId','qualificationReceiptHash','allowedStaffIds','profile']);
    stationId(value.stationId); stationUuid(value.enrollmentId); stationId(value.keyId); stationId(value.activationId);
    for (const key of ['keyFingerprint','protectionEvidenceHash','qualificationReceiptHash']) stationSha(value[key]);
    // The first release has one owning operator per protected enrollment. A
    // shared station needs a separate authenticated membership/transfer model.
    check(Array.isArray(value.allowedStaffIds) && value.allowedStaffIds.length === 1, 'STATION_SINGLE_OPERATOR_REQUIRED', 503);
    value.allowedStaffIds.forEach(stationUuid);
    object(value.profile, ['id','qualified','qualificationHash','firstUserPage','lastUserPage']);
    check(value.profile.qualified === true && value.profile.qualificationHash === value.qualificationReceiptHash, 'STATION_QUALIFIED_PROFILE_REQUIRED', 503);
    value.profileHash = stationProfileHash(value.profile);
    check(!result.has(value.stationId), 'STATION_TRUST_INVALID', 503); result.set(value.stationId, value);
  }
  return result;
}
/** Enrollment proves possession only. Production trust comes from the protected
 * deployment allowlist and reviewed qualification/protected-key receipt hashes.
 * No request field, browser callback or public-key assertion can activate it. */
export function createFinishingStationService({ repository, finishing, signer, origin = 'https://atlasgrading.com',
  trustedStations = [], armTtlMs = W.maxArmMs, clock = () => Date.now() }) {
  check(repository && finishing?.load && signer?.signClaims && signer.publicKeySpki && signer.keyId
    && origin === 'https://atlasgrading.com' && Number.isInteger(armTtlMs) && armTtlMs > 0 && armTtlMs <= W.maxArmMs,
  'STATION_CONFIGURATION_INVALID', 503);
  const trusted = trustConfiguration(trustedStations);
  const verifier = createStationVerifier({ publicKeys: [{ keyId: signer.keyId, publicKeySpki: signer.publicKeySpki }] });
  async function signed(claims) {
    const authorization = await signer.signClaims(structuredClone(claims));
    check(canonical(await verifier.verifyEnvelope(authorization)) === canonical(claims), 'STATION_HOST_SIGNATURE_INVALID', 503);
    return authorization;
  }
  function trust(enrollment, principal) {
    const entry = trusted.get(enrollment.stationId);
    if (!entry) return { state: 'PENDING_ACTIVATION', reason: 'STATION_NOT_ACTIVATED', entry: null };
    if (!['enrollmentId','keyId','keyFingerprint','protectionEvidenceHash'].every(key => entry[key] === enrollment[key]))
      return { state: 'PENDING_ACTIVATION', reason: 'STATION_KEY_NOT_TRUSTED', entry: null };
    if (!entry.allowedStaffIds.includes(principal.id)) return { state: 'PENDING_ACTIVATION', reason: 'STATION_OPERATOR_NOT_ALLOWED', entry: null };
    return { state: 'ACTIVE', reason: null, entry };
  }
  function view(enrollment, principal, activeIntentId = null) {
    const state = trust(enrollment, principal);
    return { stationId: enrollment.stationId, enrollmentId: enrollment.enrollmentId, keyId: enrollment.keyId,
      state: state.state, reason: state.reason, profileHash: state.entry?.profileHash ?? null,
      qualificationHash: state.entry?.profile.qualificationHash ?? null, activationId: state.entry?.activationId ?? null,
      activeIntentId, canArm: state.state === 'ACTIVE' && principal.mode === 'PRODUCTION' && principal.canCertify === true && !activeIntentId };
  }
  function active(enrollment, principal) {
    const state = trust(enrollment, principal); check(state.entry, state.reason, 409); return state.entry;
  }
  async function acknowledgement(record, saved, kind) {
    const claims = validateStationAcknowledgement({ version: W.acknowledgement, kind,
      intentId: record.claims.intentId, receiptHash: saved.receiptHash, enrollmentId: record.claims.enrollmentId,
      stationId: record.claims.stationId, planHash: record.claims.planHash, authorizationHash: record.authorizationHash,
      committed: true, recordedAt: saved.recordedAt });
    return signed(claims);
  }
  async function saveReceipt(staff, input, kind) {
    object(input, ['receipt','signature']);
    const value = kind === 'WRITE' ? validateStationResult(input.receipt) : validateStationRemoval(input.receipt);
    const record = await repository.intent(staff, value.intentId), claims = validateStationArm(record.claims);
    const same = ['intentId','planHash','stationId','enrollmentId','keyId','nonce', ...(kind === 'WRITE' ? ['profileHash','ndefHash'] : [])];
    check(same.every(key => value[key] === claims[key]) && value.authorizationHash === record.authorizationHash,
      'STATION_RESULT_BINDING_CHANGED', 409);
    verifyStationSignature(record.enrollment.publicKeySpki, value, input.signature);
    const previous = record.receipts.find(item => item.kind === kind);
    if (!previous) {
      const entry = active(record.enrollment, record.principal);
      check(entry.profileHash === claims.profileHash && entry.activationId === claims.activationId, 'STATION_ACTIVATION_CHANGED', 409);
      if (kind === 'WRITE') check(record.now < claims.expiresAt, 'STATION_ARM_EXPIRED', 409);
      else check(record.receipts.find(item => item.kind === 'WRITE')?.receiptHash === value.receiptHash,
        'STATION_WRITE_RECEIPT_REQUIRED', 409);
    }
    // Commit before signing acknowledgement; a signing/network failure cannot
    // lose verified physical evidence or permit a second write.
    const saved = await repository.commitReceipt(staff, input, kind, record.authorizationHash);
    return acknowledgement(record, saved, kind);
  }
  return Object.freeze({
    async list(staff) {
      const result = await repository.list(staff);
      return { enabled: true, stations: result.enrollments.map(enrollment => view(enrollment, result.principal,
        result.active.find(row => row.station_id === enrollment.stationId)?.intent_id ?? null)) };
    },
    async challenge(staff, input) {
      object(input, ['requestId','stationId']); stationUuid(input.requestId); stationId(input.stationId);
      const challenge = await repository.challenge(staff, input, ({ now, challengeId }) => ({ version: W.challenge, challengeId,
        requestId: input.requestId, stationId: input.stationId, origin, nonce: randomBytes(32).toString('base64url'),
        issuedAt: now, expiresAt: now + W.maxChallengeMs }));
      return { challenge, authorization: await signed(challenge) };
    },
    async enroll(staff, input) {
      object(input, ['challengeId','enrollmentId','keyId','publicKeySpki','protectionEvidenceHash','signature']);
      stationUuid(input.challengeId); stationUuid(input.enrollmentId); stationId(input.keyId); stationSha(input.protectionEvidenceHash);
      const key = stationPublicKey(input.publicKeySpki), source = await repository.enrollmentChallenge(staff, input.challengeId);
      check(source.challenge.origin === origin, 'STATION_CHALLENGE_CHANGED', 409);
      const proof = stationEnrollmentProof(source.challenge, input); verifyStationSignature(input.publicKeySpki, proof, input.signature);
      const saved = await repository.enroll(staff, input, proof, key.fingerprint), status = view(saved.enrollment, saved.principal);
      const claims = validateStationEnrollment({ version: W.enrollment, origin, stationId: status.stationId,
        enrollmentId: status.enrollmentId, keyId: status.keyId, keyFingerprint: key.fingerprint,
        protectionEvidenceHash: input.protectionEvidenceHash, state: status.state, profileHash: status.profileHash,
        qualificationHash: status.qualificationHash, activationId: status.activationId, issuedAt: clock() });
      return { ...claims, authorization: await signed(claims) };
    },
    async arm(staff, input) {
      object(input, ['requestId','stationId','enrollmentId','cardId','approvalActionId','physicalCardPresent']);
      for (const key of ['requestId','enrollmentId','cardId','approvalActionId']) stationUuid(input[key]); stationId(input.stationId);
      check(input.physicalCardPresent === true, 'STATION_PHYSICAL_ASSOCIATION_REQUIRED');
      const saved = await repository.enrollment(staff, input.enrollmentId);
      check(saved.enrollment.stationId === input.stationId, 'STATION_ENROLLMENT_CHANGED', 409);
      const entry = active(saved.enrollment, saved.principal);
      check(saved.principal.mode === 'PRODUCTION', 'STATION_PRODUCTION_SESSION_REQUIRED', 403);
      check(saved.principal.canCertify, 'MANUAL_CERTIFICATION_REQUIRED', 403);
      const plan = validateManualFinishingPlan(await finishing.load(staff, input.cardId, input.approvalActionId));
      check(plan.label.mode === 'PRODUCTION' && plan.binding.cardId === input.cardId && plan.binding.approvalActionId === input.approvalActionId,
        'STATION_PUBLISHED_PRODUCTION_REPORT_REQUIRED', 409);
      const claims = validateStationArm({ version: W.arm, origin, stationId: input.stationId, enrollmentId: input.enrollmentId,
        keyId: saved.enrollment.keyId, intentId: plan.nfc.intentId, planHash: plan.planHash, profileHash: entry.profileHash,
        qualificationHash: entry.profile.qualificationHash, activationId: entry.activationId,
        cardId: input.cardId, approvalActionId: input.approvalActionId, publicHash: plan.binding.publicHash,
        reportHash: plan.binding.reportHash, approvalVersion: plan.binding.approvalVersion, reportNumber: plan.binding.reportNumber,
        url: plan.nfc.url, ndefHash: hash(encodeApprovedNdef(plan)), firstUserPage: entry.profile.firstUserPage,
        lastUserPage: entry.profile.lastUserPage, nonce: randomBytes(32).toString('base64url'),
        issuedAt: saved.now, expiresAt: saved.now + armTtlMs });
      const reserved = await repository.reserveArm(staff, input, claims, await signed(claims));
      check(reserved.claims.planHash === plan.planHash, 'STATION_PLAN_CHANGED', 409);
      return { plan, association: { armed: true, stationId: reserved.claims.stationId, planHash: plan.planHash,
        cardId: input.cardId, approvalActionId: input.approvalActionId, expiresAt: reserved.claims.expiresAt,
        authorization: reserved.authorization } };
    },
    acknowledge: (staff, input) => saveReceipt(staff, input, 'WRITE'),
    complete: (staff, input) => saveReceipt(staff, input, 'REMOVAL'),
  });
}
