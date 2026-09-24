import { randomUUID } from 'node:crypto';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';

const doc = value => { const text = canonical(value, { maxBytes: 16384 }); return { text, hash: digest(text) }; };
const stored = (text, hash) => { requireThat(digest(text) === hash, 503, 'STATION_STORED_CONTENT_INVALID'); return JSON.parse(text); };
const reviewer = principal => requireThat(principal.role === 'REVIEWER', 403, 'STATION_REVIEWER_REQUIRED');
function enrollment(row) {
  const proof = stored(row.proof, row.proof_hash);
  requireThat(proof.enrollmentId === row.id && proof.stationId === row.station_id && proof.keyId === row.key_id && proof.publicKeySpki === row.public_key_spki
    && proof.protectionEvidenceHash === row.protection_evidence_hash, 503, 'STATION_STORED_CONTENT_INVALID');
  return { enrollmentId: row.id, stationId: row.station_id, keyId: row.key_id, publicKeySpki: row.public_key_spki,
    keyFingerprint: row.key_fingerprint, protectionEvidenceHash: row.protection_evidence_hash, proof, signature: row.signature };
}
function arm(row) {
  const claims = stored(row.claims, row.authorization_hash), authorization = stored(row.authorization_envelope, row.authorization_envelope_hash);
  requireThat(claims.intentId === row.intent_id && claims.stationId === row.station_id && claims.enrollmentId === row.enrollment_id
    && claims.cardId === row.card_id && claims.approvalActionId === row.approval_action_id
    && claims.expiresAt === new Date(row.expires_at).getTime(), 503, 'STATION_STORED_CONTENT_INVALID');
  return { claims, authorization, authorizationHash: row.authorization_hash, request: stored(row.request, row.request_hash) };
}
function receipt(row) { return row ? { kind: row.kind, receipt: stored(row.receipt, row.receipt_hash), receiptHash: row.receipt_hash,
  signature: row.signature, recordedAt: new Date(row.recorded_at).getTime() } : null; }
export function createFinishingStationRepository({ boundary }) {
  const lockStation = (tx, stationId) => tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721930,hashtext($1))', `finishing:${stationId}`);
  async function member(tx, principal, enrollmentId) {
    const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_enrollment WHERE id=$1::uuid AND actor_id=$2::uuid', enrollmentId, principal.id);
    requireThat(row, 404, 'STATION_ENROLLMENT_NOT_FOUND'); return row;
  }
  async function publication(tx, principal, cardId, actionId, latest = false) {
    const [card] = await tx.$queryRawUnsafe('SELECT owner_id,approvers FROM atlas_manual.card WHERE id=$1::uuid FOR SHARE', cardId);
    requireThat(card && (card.owner_id === principal.id || card.approvers.includes(principal.id)), 404, 'MANUAL_CARD_NOT_FOUND');
    const [row] = await tx.$queryRawUnsafe(`SELECT p.*,a.report_hash FROM atlas_manual.publication p
      JOIN atlas_manual.approval a ON a.card_id=p.card_id AND a.action_id=p.action_id
      WHERE p.card_id=$1::uuid AND p.action_id=$2::uuid`, cardId, actionId);
    requireThat(row?.state === 'PUBLISHED' && row.mode === 'PRODUCTION', 409, 'STATION_PUBLISHED_PRODUCTION_REPORT_REQUIRED');
    if (latest) {
      const [current] = await tx.$queryRawUnsafe('SELECT action_id FROM atlas_manual.publication WHERE card_id=$1::uuid ORDER BY version DESC LIMIT 1', cardId);
      requireThat(current.action_id === actionId, 409, 'STATION_APPROVAL_CHANGED');
    }
    return row;
  }
  async function scopedIntent(tx, principal, intentId) {
    reviewer(principal);
    const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_arm WHERE intent_id=$1 AND actor_id=$2::uuid', intentId, principal.id);
    requireThat(row, 404, 'STATION_INTENT_NOT_FOUND');
    await publication(tx, principal, row.card_id, row.approval_action_id);
    return row;
  }
  return Object.freeze({
    async challenge(staff, input, make) {
      return boundary.transaction(staff, async ({ tx, principal, now }) => {
        reviewer(principal);
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721931,hashtext($1))', `${principal.id}:${input.requestId}`);
        const [prior] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_challenge WHERE actor_id=$1::uuid AND request_id=$2::uuid', principal.id, input.requestId);
        if (prior) { requireThat(prior.station_id === input.stationId, 409, 'STATION_REQUEST_CONFLICT'); return stored(prior.content, prior.content_hash); }
        const challenge = make({ now: now.getTime(), challengeId: randomUUID() }), value = doc(challenge);
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.station_challenge(id,actor_id,request_id,station_id,content,content_hash,expires_at,created_at)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::timestamptz,$8::timestamptz)`, challenge.challengeId, principal.id, input.requestId, input.stationId,
        value.text, value.hash, new Date(challenge.expiresAt), now);
        return challenge;
      });
    },
    async enrollmentChallenge(staff, challengeId) {
      return boundary.transaction(staff, async ({ tx, principal, now }) => {
        reviewer(principal);
        const [row] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_challenge WHERE id=$1::uuid AND actor_id=$2::uuid', challengeId, principal.id);
        requireThat(row, 404, 'STATION_CHALLENGE_NOT_FOUND');
        return { challenge: stored(row.content, row.content_hash), now: now.getTime(), principal };
      });
    },
    async enroll(staff, input, proof, keyFingerprint) {
      const value = doc(proof);
      return boundary.transaction(staff, async ({ tx, principal, now }) => {
        reviewer(principal);
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721932,hashtext($1))', input.enrollmentId);
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(721933,hashtext($1))', input.challengeId);
        const [challenge] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_challenge WHERE id=$1::uuid AND actor_id=$2::uuid', input.challengeId, principal.id);
        requireThat(challenge && challenge.station_id === proof.stationId && challenge.content_hash === proof.challengeHash, 409, 'STATION_CHALLENGE_CHANGED');
        const [prior] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_pairing WHERE challenge_id=$1::uuid', input.challengeId);
        if (prior) { requireThat(prior.actor_id === principal.id && prior.proof_hash === value.hash, 409, 'STATION_REQUEST_CONFLICT');
          return { enrollment: enrollment(await member(tx, principal, prior.enrollment_id)), principal }; }
        requireThat(new Date(challenge.expires_at) > now, 409, 'STATION_CHALLENGE_EXPIRED');
        const [existing] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_enrollment WHERE id=$1::uuid', input.enrollmentId);
        if (existing) {
          requireThat(existing.actor_id === principal.id && existing.station_id === proof.stationId && existing.key_id === input.keyId
            && existing.public_key_spki === input.publicKeySpki && existing.key_fingerprint === keyFingerprint
            && existing.protection_evidence_hash === input.protectionEvidenceHash, 409, 'STATION_ENROLLMENT_CHANGED');
        }
        const [row] = existing ? [existing] : await tx.$queryRawUnsafe(`INSERT INTO atlas_manual_connected.station_enrollment(id,challenge_id,actor_id,station_id,key_id,public_key_spki,key_fingerprint,protection_evidence_hash,proof,proof_hash,signature)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, input.enrollmentId, input.challengeId, principal.id, proof.stationId,
        input.keyId, input.publicKeySpki, keyFingerprint, input.protectionEvidenceHash, value.text, value.hash, input.signature);
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.station_pairing(challenge_id,enrollment_id,actor_id,proof,proof_hash,signature)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6)`, input.challengeId, input.enrollmentId, principal.id, value.text, value.hash, input.signature);
        return { enrollment: enrollment(row), principal };
      });
    },
    async enrollment(staff, id) { return boundary.transaction(staff, async ({ tx, principal, now }) => {
      reviewer(principal); return { enrollment: enrollment(await member(tx, principal, id)), principal, now: now.getTime() };
    }); },
    async list(staff) { return boundary.transaction(staff, async ({ tx, principal }) => {
      reviewer(principal);
      const rows = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_enrollment WHERE actor_id=$1::uuid ORDER BY created_at DESC LIMIT 64', principal.id);
      const active = await tx.$queryRawUnsafe(`SELECT s.station_id,s.intent_id FROM atlas_manual_connected.station_active s
        JOIN atlas_manual_connected.station_arm a USING(intent_id) WHERE a.actor_id=$1::uuid`, principal.id);
      return { enrollments: rows.map(enrollment), active, principal };
    }); },
    async reserveArm(staff, input, claims, authorization) {
      const request = doc(input), value = doc(claims), envelope = doc(authorization);
      return boundary.transaction(staff, async ({ tx, principal, now }) => {
        reviewer(principal); requireThat(principal.canCertify, 403, 'MANUAL_CERTIFICATION_REQUIRED');
        await lockStation(tx, input.stationId);
        const enrolled = await member(tx, principal, input.enrollmentId);
        requireThat(enrolled.station_id === input.stationId && enrolled.key_id === claims.keyId, 409, 'STATION_ENROLLMENT_CHANGED');
        const published = await publication(tx, principal, input.cardId, input.approvalActionId, true);
        requireThat(published.public_hash === claims.publicHash && published.report_hash === claims.reportHash && published.version === claims.approvalVersion,
          409, 'STATION_APPROVAL_CHANGED');
        const [prior] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_arm WHERE actor_id=$1::uuid AND request_id=$2::uuid', principal.id, input.requestId);
        if (prior) { requireThat(prior.request_hash === request.hash, 409, 'STATION_REQUEST_CONFLICT'); return arm(prior); }
        requireThat(claims.issuedAt <= now.getTime() && claims.expiresAt > now.getTime() && claims.expiresAt - now.getTime() <= 15 * 60000,
          409, 'STATION_ARM_EXPIRED');
        const [active] = await tx.$queryRawUnsafe('SELECT intent_id FROM atlas_manual_connected.station_active WHERE station_id=$1', input.stationId);
        requireThat(!active, 409, 'STATION_BUSY');
        const [done] = await tx.$queryRawUnsafe('SELECT intent_id FROM atlas_manual_connected.station_arm WHERE intent_id=$1', claims.intentId);
        requireThat(!done, 409, 'STATION_PLAN_ALREADY_ARMED');
        const [saved] = await tx.$queryRawUnsafe(`INSERT INTO atlas_manual_connected.station_arm(intent_id,station_id,enrollment_id,actor_id,request_id,card_id,approval_action_id,
          request,request_hash,claims,authorization_hash,authorization_envelope,authorization_envelope_hash,expires_at,created_at)
          VALUES($1,$2,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::timestamptz) RETURNING *`,
        claims.intentId, input.stationId, input.enrollmentId, principal.id, input.requestId, input.cardId, input.approvalActionId,
        request.text, request.hash, value.text, value.hash, envelope.text, envelope.hash, new Date(claims.expiresAt), now);
        await tx.$executeRawUnsafe('INSERT INTO atlas_manual_connected.station_active(station_id,intent_id) VALUES($1,$2)', input.stationId, claims.intentId);
        return arm(saved);
      });
    },
    async intent(staff, id) { return boundary.transaction(staff, async ({ tx, principal, now }) => {
      const row = await scopedIntent(tx, principal, id), enrolled = await member(tx, principal, row.enrollment_id);
      const receipts = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_receipt WHERE intent_id=$1 ORDER BY kind', id);
      return { ...arm(row), enrollment: enrollment(enrolled), receipts: receipts.map(receipt), principal, now: now.getTime() };
    }); },
    async commitReceipt(staff, input, kind, expectedAuthorizationHash) {
      const value = doc(input.receipt);
      return boundary.transaction(staff, async ({ tx, principal, now }) => {
        const row = await scopedIntent(tx, principal, input.receipt.intentId);
        await lockStation(tx, row.station_id);
        requireThat(row.authorization_hash === expectedAuthorizationHash, 409, 'STATION_ARM_CHANGED');
        const [prior] = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.station_receipt WHERE intent_id=$1 AND kind=$2', row.intent_id, kind);
        if (prior) { requireThat(prior.receipt_hash === value.hash, 409, 'STATION_RECEIPT_CONFLICT'); return receipt(prior); }
        if (kind === 'WRITE') requireThat(new Date(row.expires_at) > now, 409, 'STATION_ARM_EXPIRED');
        else {
          const [written] = await tx.$queryRawUnsafe("SELECT receipt_hash FROM atlas_manual_connected.station_receipt WHERE intent_id=$1 AND kind='WRITE'", row.intent_id);
          requireThat(written?.receipt_hash === input.receipt.receiptHash, 409, 'STATION_WRITE_RECEIPT_REQUIRED');
        }
        const [active] = await tx.$queryRawUnsafe('SELECT intent_id FROM atlas_manual_connected.station_active WHERE station_id=$1', row.station_id);
        requireThat(active?.intent_id === row.intent_id, 409, 'STATION_ACTIVE_INTENT_CHANGED');
        const [saved] = await tx.$queryRawUnsafe(`INSERT INTO atlas_manual_connected.station_receipt(intent_id,kind,receipt,receipt_hash,signature)
          VALUES($1,$2,$3,$4,$5) RETURNING *`, row.intent_id, kind, value.text, value.hash, input.signature);
        if (kind === 'REMOVAL') await tx.$executeRawUnsafe('DELETE FROM atlas_manual_connected.station_active WHERE station_id=$1 AND intent_id=$2', row.station_id, row.intent_id);
        return receipt(saved);
      });
    },
  });
}
export function finishingStationGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_manual_connected TO "${role}";\nGRANT SELECT,INSERT ON atlas_manual_connected.station_challenge,atlas_manual_connected.station_enrollment,atlas_manual_connected.station_pairing,atlas_manual_connected.station_arm,atlas_manual_connected.station_receipt,atlas_manual_connected.station_active TO "${role}";\nGRANT DELETE ON atlas_manual_connected.station_active TO "${role}";`;
}
