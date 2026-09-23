import { createHash, createPublicKey, createPrivateKey, sign, verify } from 'node:crypto';
import { STATION_WIRE as W } from './station-wire.mjs';
export { STATION_WIRE } from './station-wire.mjs';

export function stationAssert(ok, code = 'STATION_INPUT_INVALID', status = 400) {
  if (!ok) throw Object.assign(new Error(code), { code, status });
}
export function stationObject(value, keys) {
  stationAssert(value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}
export const stationHash = bytes => createHash('sha256').update(bytes).digest('hex');
export function stationCanonical(value) {
  const encode = input => {
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return JSON.stringify(input);
    if (typeof input === 'number') { stationAssert(Number.isFinite(input)); return JSON.stringify(input); }
    if (Array.isArray(input)) return `[${input.map(encode).join(',')}]`;
    stationAssert(input && Object.getPrototypeOf(input) === Object.prototype);
    return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${encode(input[key])}`).join(',')}}`;
  };
  const text = encode(value); stationAssert(Buffer.byteLength(text) <= 16384, 'STATION_INPUT_TOO_LARGE', 413); return text;
}
export const stationId = value => stationAssert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value));
export const stationSha = value => stationAssert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
export const stationUuid = value => stationAssert(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value));
const time = value => stationAssert(Number.isSafeInteger(value) && value > 0);
function p256(key) {
  stationAssert(key?.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1', 'STATION_P256_KEY_REQUIRED'); return key;
}
export function stationPublicKey(publicKeySpki) {
  stationAssert(typeof publicKeySpki === 'string' && /^[A-Za-z0-9+/]{100,200}={0,2}$/.test(publicKeySpki), 'STATION_PUBLIC_KEY_INVALID');
  const bytes = Buffer.from(publicKeySpki, 'base64');
  stationAssert(bytes.toString('base64') === publicKeySpki, 'STATION_PUBLIC_KEY_INVALID');
  let key; try { key = p256(createPublicKey({ key: bytes, type: 'spki', format: 'der' })); } catch { stationAssert(false, 'STATION_PUBLIC_KEY_INVALID'); }
  stationAssert(key.export({ type: 'spki', format: 'der' }).equals(bytes), 'STATION_PUBLIC_KEY_INVALID');
  return { key, fingerprint: stationHash(bytes), publicKeySpki };
}
function signatureBytes(signature) {
  stationAssert(typeof signature === 'string' && /^[A-Za-z0-9_-]{11,96}$/.test(signature), 'STATION_SIGNATURE_INVALID', 403);
  const bytes = Buffer.from(signature, 'base64url');
  stationAssert(bytes.toString('base64url') === signature && bytes.length >= 8 && bytes.length <= 72, 'STATION_SIGNATURE_INVALID', 403);
  return bytes;
}
export function verifyStationSignature(publicKeySpki, value, signature) {
  stationAssert(verify('sha256', Buffer.from(stationCanonical(value)), { key: stationPublicKey(publicKeySpki).key, dsaEncoding: 'der' }, signatureBytes(signature)),
    'STATION_SIGNATURE_INVALID', 403); return true;
}
export function createStationSigner({ keyId, privateKey }) {
  stationId(keyId); const key = p256(createPrivateKey(privateKey));
  return Object.freeze({ keyId,
    publicKeySpki: createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64'),
    async signClaims(claims) {
      const text = stationCanonical(claims);
      return { version: W.envelope, keyId, algorithm: W.algorithm, payload: Buffer.from(text).toString('base64url'),
        signature: sign('sha256', Buffer.from(text), { key, dsaEncoding: 'der' }).toString('base64url') };
    },
  });
}
export function createStationVerifier({ publicKeys }) {
  stationAssert(Array.isArray(publicKeys) && publicKeys.length > 0 && publicKeys.length <= 8, 'STATION_TRUST_INVALID', 503);
  const trusted = new Map();
  for (const item of publicKeys) { stationObject(item, ['keyId', 'publicKeySpki']); stationId(item.keyId);
    stationAssert(!trusted.has(item.keyId), 'STATION_TRUST_INVALID'); trusted.set(item.keyId, stationPublicKey(item.publicKeySpki)); }
  return Object.freeze({ async verifyEnvelope(envelope) {
    stationObject(envelope, ['version', 'keyId', 'algorithm', 'payload', 'signature']);
    stationAssert(envelope.version === W.envelope && envelope.algorithm === W.algorithm && trusted.has(envelope.keyId)
      && typeof envelope.payload === 'string' && /^[A-Za-z0-9_-]{1,22000}$/.test(envelope.payload), 'STATION_HOST_SIGNATURE_INVALID', 403);
    const bytes = Buffer.from(envelope.payload, 'base64url');
    stationAssert(bytes.toString('base64url') === envelope.payload && bytes.length <= 16384, 'STATION_HOST_SIGNATURE_INVALID', 403);
    stationAssert(verify('sha256', bytes, { key: trusted.get(envelope.keyId).key, dsaEncoding: 'der' }, signatureBytes(envelope.signature)),
      'STATION_HOST_SIGNATURE_INVALID', 403);
    let claims; try { claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { stationAssert(false, 'STATION_HOST_SIGNATURE_INVALID', 403); }
    stationAssert(stationCanonical(claims) === bytes.toString('utf8'), 'STATION_HOST_SIGNATURE_INVALID', 403);
    return claims;
  } });
}
export function stationEnrollmentProof(challenge, input) {
  validateStationChallenge(challenge);
  return { version: W.proof, challengeId: challenge.challengeId, challengeHash: stationHash(stationCanonical(challenge)),
    stationId: challenge.stationId, enrollmentId: input.enrollmentId, keyId: input.keyId, publicKeySpki: input.publicKeySpki, protectionEvidenceHash: input.protectionEvidenceHash };
}
export function validateStationChallenge(claims) {
  stationObject(claims, ['version','challengeId','requestId','stationId','origin','nonce','issuedAt','expiresAt']);
  stationAssert(claims.version === W.challenge && claims.origin === 'https://atlasgrading.com');
  stationUuid(claims.challengeId); stationUuid(claims.requestId); stationId(claims.stationId);
  stationAssert(typeof claims.nonce === 'string' && /^[A-Za-z0-9_-]{43}$/.test(claims.nonce));
  time(claims.issuedAt); time(claims.expiresAt);
  stationAssert(claims.expiresAt > claims.issuedAt && claims.expiresAt - claims.issuedAt <= W.maxChallengeMs); return claims;
}
export function validateStationEnrollment(claims) {
  stationObject(claims, ['version','origin','stationId','enrollmentId','keyId','keyFingerprint','protectionEvidenceHash','state','profileHash','qualificationHash','activationId','issuedAt']);
  stationAssert(claims.version === W.enrollment && claims.origin === 'https://atlasgrading.com' && ['ACTIVE','PENDING_ACTIVATION'].includes(claims.state));
  stationId(claims.stationId); stationId(claims.keyId); stationUuid(claims.enrollmentId);
  stationSha(claims.keyFingerprint); stationSha(claims.protectionEvidenceHash); time(claims.issuedAt);
  if (claims.state === 'ACTIVE') { stationSha(claims.profileHash); stationSha(claims.qualificationHash); stationId(claims.activationId); }
  else stationAssert(claims.profileHash === null && claims.qualificationHash === null && claims.activationId === null);
  return claims;
}
export function stationProfileHash(profile) {
  stationAssert(profile.id === W.profile && Number.isInteger(profile.firstUserPage) && profile.firstUserPage >= 4
    && Number.isInteger(profile.lastUserPage) && profile.lastUserPage >= profile.firstUserPage + 3 && profile.lastUserPage <= 255,
  'STATION_QUALIFIED_PROFILE_REQUIRED', 503); stationSha(profile.qualificationHash);
  return stationHash(stationCanonical({ id: profile.id, qualificationHash: profile.qualificationHash,
    firstUserPage: profile.firstUserPage, lastUserPage: profile.lastUserPage }));
}
export function validateStationArm(claims) {
  stationObject(claims, ['version','origin','stationId','enrollmentId','keyId','intentId','planHash','profileHash','qualificationHash','activationId',
    'cardId','approvalActionId','publicHash','reportHash','approvalVersion','reportNumber','url','ndefHash','firstUserPage','lastUserPage','nonce','issuedAt','expiresAt']);
  stationAssert(claims.version === W.arm && claims.origin === 'https://atlasgrading.com');
  for (const key of ['stationId','keyId','intentId','activationId','nonce']) stationId(claims[key]);
  stationAssert(/^[A-Za-z0-9_-]{43}$/.test(claims.nonce));
  for (const key of ['enrollmentId','cardId','approvalActionId']) stationUuid(claims[key]);
  for (const key of ['planHash','profileHash','qualificationHash','publicHash','reportHash','ndefHash']) stationSha(claims[key]);
  stationAssert(claims.intentId === `afnfc_${claims.planHash}` && Number.isSafeInteger(claims.approvalVersion) && claims.approvalVersion > 0
    && /^ATLAS-[A-Z0-9]{12}$/.test(claims.reportNumber));
  let url; try { url = new URL(claims.url); } catch { stationAssert(false); }
  stationAssert(url.origin === claims.origin && /^\/reports\/ar_[A-Za-z0-9_-]{24,64}$/.test(url.pathname)
    && url.search === `?v=${claims.approvalVersion}` && !url.hash && !url.username && !url.password && url.href === claims.url);
  stationAssert(claims.profileHash === stationProfileHash({ id: W.profile, qualificationHash: claims.qualificationHash,
    firstUserPage: claims.firstUserPage, lastUserPage: claims.lastUserPage }));
  time(claims.issuedAt); time(claims.expiresAt);
  stationAssert(claims.expiresAt > claims.issuedAt && claims.expiresAt - claims.issuedAt <= W.maxArmMs); return claims;
}
export function validateStationResult(receipt) {
  stationObject(receipt, ['version','intentId','planHash','profileHash','stationId','enrollmentId','keyId','authorizationHash','nonce','ndefHash','readbackVerified','lockVerified']);
  stationAssert(receipt.version === W.result && receipt.readbackVerified === true && receipt.lockVerified === true);
  for (const key of ['intentId','stationId','keyId','nonce']) stationId(receipt[key]); stationUuid(receipt.enrollmentId);
  for (const key of ['planHash','profileHash','authorizationHash','ndefHash']) stationSha(receipt[key]); return receipt;
}
export function validateStationRemoval(receipt) {
  stationObject(receipt, ['version','stationId','enrollmentId','keyId','intentId','planHash','authorizationHash','nonce','receiptHash','removalObserved']);
  stationAssert(receipt.version === W.removal && receipt.removalObserved === true);
  for (const key of ['intentId','stationId','keyId','nonce']) stationId(receipt[key]); stationUuid(receipt.enrollmentId);
  for (const key of ['planHash','authorizationHash','receiptHash']) stationSha(receipt[key]); return receipt;
}
export function validateStationAcknowledgement(claims) {
  stationObject(claims, ['version','kind','intentId','receiptHash','enrollmentId','stationId','planHash','authorizationHash','committed','recordedAt']);
  stationAssert(claims.version === W.acknowledgement && ['WRITE','REMOVAL'].includes(claims.kind) && claims.committed === true);
  for (const key of ['intentId','stationId']) stationId(claims[key]); stationUuid(claims.enrollmentId);
  for (const key of ['receiptHash','planHash','authorizationHash']) stationSha(claims[key]); time(claims.recordedAt); return claims;
}
