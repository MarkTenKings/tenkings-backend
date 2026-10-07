import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';

export const ATLAS_NFC = Object.freeze({
    jobSchema: 'atlas-approved-report-nfc-job-v1', resultSchema: 'atlas-approved-report-nfc-result-v1',
    algorithm: 'ecdsa-p256-sha256-p1363', purpose: 'atlas-program-approved-report-url-v1',
    origin: 'https://atlasgrading.com', staffOrigin: 'https://app.atlasgrading.com',
    chipType: 'FEIJU_F8215', securityMode: 'static_url_v1', programmingProfile: 'gototags_manual_start_v1',
    readerModel: 'ACS_ACR1552U', adapterIdentity: 'gototags_desktop', adapterVersion: '4.37.0.1',
    writeProtectionState: 'permanently_read_only_verified', readerResultCode: 'write_locked_verified_gototags_readback',
    helperCapability: 'atlas-approved-report-f8215-v1', maximumJobLifetimeMs: 900_000,
    workstationEnrollmentPolicy: 'windows-current-user-nonexportable-p256-v1',
});
const BINDING = ['specimenId', 'approvalId', 'approvalVersion', 'publicToken', 'publicHash'];
export const JOB_FIELDS = Object.freeze(['schemaVersion', 'algorithm', 'signingKeyId', 'purpose', 'nonce', ...BINDING,
    'url', 'chipType', 'securityMode', 'programmingProfile', 'issuedAt', 'expiresAt']);
export const RESULT_FIELDS = Object.freeze(['schemaVersion', 'algorithm', 'workstationKeyId', 'jobEnvelopeSha256', 'nonce', ...BINDING,
    'url', 'chipType', 'securityMode', 'programmingProfile', 'readerModel', 'adapterIdentity', 'adapterVersion',
    'readbackPayloadSha256', 'writeProtectionState', 'readerResultCode', 'helperCapability', 'observedAt']);
const shaPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;
function fail() { throw new Error('atlas_nfc_contract_invalid'); }
function requireThat(value) { if (!value) fail(); }
function exact(value, fields) {
    requireThat(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
    requireThat(Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)));
    for (const key of fields) requireThat(key === 'approvalVersion' ? Number.isSafeInteger(value[key]) && value[key] >= 1 && value[key] <= 2147483647 : typeof value[key] === 'string');
}
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function base64(value, length) {
    requireThat(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value));
    const bytes = Buffer.from(value, 'base64url');
    requireThat(bytes.length === length && bytes.toString('base64url') === value);
    return bytes;
}
function timestamp(value) {
    requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value));
    const n = Date.parse(value); requireThat(Number.isFinite(n) && new Date(n).toISOString() === value); return n;
}
function clock(now) { requireThat(now instanceof Date && Number.isFinite(now.getTime())); return now.getTime(); }
export function atlasReportUrl(publicToken, approvalVersion) {
    requireThat(typeof publicToken === 'string' && /^ar_[A-Za-z0-9_-]{24}$/.test(publicToken));
    requireThat(Number.isSafeInteger(approvalVersion) && approvalVersion >= 1 && approvalVersion <= 2147483647);
    return `${ATLAS_NFC.origin}/reports/${publicToken}?v=${approvalVersion}`;
}
export function validateApprovedReportBinding(value) {
    exact(value, BINDING);
    requireThat(idPattern.test(value.specimenId) && idPattern.test(value.approvalId) && shaPattern.test(value.publicHash));
    atlasReportUrl(value.publicToken, value.approvalVersion);
    return Object.freeze({ ...value });
}
function binding(value) { return validateApprovedReportBinding(Object.fromEntries(BINDING.map(k => [k, value[k]]))); }
function profile(value) {
    for (const k of ['algorithm', 'chipType', 'securityMode', 'programmingProfile']) requireThat(value[k] === ATLAS_NFC[k]);
    binding(value); requireThat(value.url === atlasReportUrl(value.publicToken, value.approvalVersion));
    base64(value.nonce, 32);
}
export function validateNfcJob(value) {
    exact(value, [...JOB_FIELDS, 'signature']); profile(value);
    requireThat(value.schemaVersion === ATLAS_NFC.jobSchema && value.purpose === ATLAS_NFC.purpose && shaPattern.test(value.signingKeyId));
    base64(value.signature, 64);
    const issued = timestamp(value.issuedAt), expires = timestamp(value.expiresAt);
    requireThat(expires > issued && expires - issued <= ATLAS_NFC.maximumJobLifetimeMs);
    return Object.freeze({ ...value });
}
export function canonicalNfcJob(value) { const job = validateNfcJob(value); return JOB_FIELDS.map(k => job[k]).join('\n'); }
export function nfcJobEnvelopeSha256(value) { return sha(`${canonicalNfcJob(value)}\n${value.signature}`); }
function publicKey(encoded) {
    requireThat(typeof encoded === 'string' && encoded.length <= 700);
    const der = Buffer.from(encoded, 'base64'); requireThat(der.length >= 64 && der.toString('base64') === encoded);
    const key = createPublicKey({ key: der, type: 'spki', format: 'der' });
    requireThat(key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1' && key.export({ type: 'spki', format: 'der' }).equals(der));
    return { key, id: sha(der) };
}
// These objects are private configuration, never accepted from a browser or a signed result.
export function validateNfcTrust(value) {
    requireThat(value && value.schemaVersion === 'atlas-nfc-trust-v1' && Object.keys(value).sort().join(',') === 'schemaVersion,serverKeys,workstationKeys');
    requireThat(Array.isArray(value.serverKeys) && value.serverKeys.length >= 1 && value.serverKeys.length <= 2);
    requireThat(Array.isArray(value.workstationKeys) && value.workstationKeys.length >= 1 && value.workstationKeys.length <= 16);
    const seen = new Set();
    for (const [kind, keys] of [['server', value.serverKeys], ['workstation', value.workstationKeys]]) for (const entry of keys) {
        exact(entry, kind === 'server' ? ['keyId', 'publicSpkiDerBase64'] : ['keyId', 'publicSpkiDerBase64', 'enrollmentPolicy']);
        const parsed = publicKey(entry.publicSpkiDerBase64);
        requireThat(entry.keyId === parsed.id && !seen.has(parsed.id)); seen.add(parsed.id);
        if (kind === 'workstation') requireThat(entry.enrollmentPolicy === ATLAS_NFC.workstationEnrollmentPolicy);
    }
    return value;
}
function trustedKey(trust, kind, id) {
    validateNfcTrust(trust);
    const entry = trust[kind].find(x => x.keyId === id); requireThat(entry); return publicKey(entry.publicSpkiDerBase64).key;
}
export function signNfcJob({ approvedReport, privateKeyPem, now, lifetimeMs = 600_000 }) {
    const approved = validateApprovedReportBinding(approvedReport), issued = clock(now);
    requireThat(Number.isSafeInteger(lifetimeMs) && lifetimeMs > 0 && lifetimeMs <= ATLAS_NFC.maximumJobLifetimeMs);
    const key = createPrivateKey(privateKeyPem), pub = createPublicKey(key);
    requireThat(pub.asymmetricKeyType === 'ec' && pub.asymmetricKeyDetails?.namedCurve === 'prime256v1');
    const job = { schemaVersion: ATLAS_NFC.jobSchema, algorithm: ATLAS_NFC.algorithm,
        signingKeyId: sha(pub.export({ format: 'der', type: 'spki' })), purpose: ATLAS_NFC.purpose,
        nonce: randomBytes(32).toString('base64url'), ...approved, url: atlasReportUrl(approved.publicToken, approved.approvalVersion),
        chipType: ATLAS_NFC.chipType, securityMode: ATLAS_NFC.securityMode, programmingProfile: ATLAS_NFC.programmingProfile,
        issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + lifetimeMs).toISOString(), signature: Buffer.alloc(64).toString('base64url') };
    job.signature = sign('sha256', Buffer.from(canonicalNfcJob(job)), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return Object.freeze(job);
}
export function verifyNfcJob({ job, trust, now }) {
    const valid = validateNfcJob(job), current = clock(now);
    requireThat(current >= timestamp(valid.issuedAt) - 30_000 && current <= timestamp(valid.expiresAt));
    requireThat(verify('sha256', Buffer.from(canonicalNfcJob(valid)), { key: trustedKey(trust, 'serverKeys', valid.signingKeyId), dsaEncoding: 'ieee-p1363' }, base64(valid.signature, 64)));
    return valid;
}
export function canonicalNfcResult(value) {
    exact(value, [...RESULT_FIELDS, 'signature']); profile(value);
    requireThat(value.schemaVersion === ATLAS_NFC.resultSchema);
    for (const k of ['readerModel', 'adapterIdentity', 'adapterVersion', 'writeProtectionState', 'readerResultCode', 'helperCapability']) requireThat(value[k] === ATLAS_NFC[k]);
    for (const k of ['workstationKeyId', 'jobEnvelopeSha256', 'readbackPayloadSha256']) requireThat(shaPattern.test(value[k]));
    base64(value.signature, 64); timestamp(value.observedAt);
    return RESULT_FIELDS.map(k => value[k]).join('\n');
}
// Call inside the approval-bound write transaction. The supplied approvedReport must be read
// from immutable approved DB authority; a browser assertion is never approval authority.
export function verifyNfcResult({ job, result, approvedReport, trust, now }) {
    const validJob = verifyNfcJob({ job, trust, now }), approved = validateApprovedReportBinding(approvedReport);
    const canonical = canonicalNfcResult(result);
    for (const k of BINDING) requireThat(validJob[k] === approved[k] && result[k] === approved[k]);
    for (const k of ['nonce', 'url', 'chipType', 'securityMode', 'programmingProfile']) requireThat(result[k] === validJob[k]);
    requireThat(result.jobEnvelopeSha256 === nfcJobEnvelopeSha256(validJob) && result.readbackPayloadSha256 === sha(validJob.url));
    const observed = timestamp(result.observedAt);
    requireThat(observed >= timestamp(validJob.issuedAt) && observed <= timestamp(validJob.expiresAt) && observed <= clock(now) + 30_000);
    requireThat(verify('sha256', Buffer.from(canonical), { key: trustedKey(trust, 'workstationKeys', result.workstationKeyId), dsaEncoding: 'ieee-p1363' }, base64(result.signature, 64)));
    return Object.freeze({ ...result });
}
