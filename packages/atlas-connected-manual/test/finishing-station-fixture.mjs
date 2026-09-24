// Ephemeral software keys and synthetic qualification hashes: test data only.
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createStationSigner, createStationVerifier, stationCanonical, stationHash, stationPublicKey,
  stationEnrollmentProof, STATION_WIRE as W } from '../src/finishing-station-protocol.mjs';
export const hashClaims = value => stationHash(stationCanonical(value));
export function stationKeys() {
  const host = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const native = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signer = createStationSigner({ keyId: 'test-host-key', privateKey: host.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const publicKeySpki = native.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const enrollment = { stationId: 'fixture-mac', enrollmentId: randomUUID(), keyId: 'fixture-secure-key', publicKeySpki,
    keyFingerprint: stationPublicKey(publicKeySpki).fingerprint, protectionEvidenceHash: 'e'.repeat(64) };
  const signNative = value => sign('sha256', Buffer.from(stationCanonical(value)), { key: native.privateKey, dsaEncoding: 'der' }).toString('base64url');
  return { signer, enrollment, signNative, host, native,
    verifier: createStationVerifier({ publicKeys: [{ keyId: signer.keyId, publicKeySpki: signer.publicKeySpki }] }),
    trust(actorId) { const { publicKeySpki: _, ...identity } = enrollment; return { ...identity, activationId: 'fixture-reviewed-activation',
      qualificationReceiptHash: 'f'.repeat(64), allowedStaffIds: [actorId],
      profile: { id: W.profile, qualified: true, qualificationHash: 'f'.repeat(64), firstUserPage: 4, lastUserPage: 127 } }; },
    proof(challenge) { const input = { challengeId: challenge.challengeId, enrollmentId: enrollment.enrollmentId, keyId: enrollment.keyId,
      publicKeySpki, protectionEvidenceHash: enrollment.protectionEvidenceHash };
      return { ...input, signature: signNative(stationEnrollmentProof(challenge, input)) }; },
    result(claims) { return { version: W.result, intentId: claims.intentId, planHash: claims.planHash, profileHash: claims.profileHash,
      stationId: claims.stationId, enrollmentId: claims.enrollmentId, keyId: claims.keyId, authorizationHash: hashClaims(claims),
      nonce: claims.nonce, ndefHash: claims.ndefHash, readbackVerified: true, lockVerified: true }; },
    removal(claims, write) { return { version: W.removal, stationId: claims.stationId, enrollmentId: claims.enrollmentId,
      keyId: claims.keyId, intentId: claims.intentId, planHash: claims.planHash, authorizationHash: hashClaims(claims), nonce: claims.nonce,
      receiptHash: hashClaims(write), removalObserved: true }; },
  };
}
