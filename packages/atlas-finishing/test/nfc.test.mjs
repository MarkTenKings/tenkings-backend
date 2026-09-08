import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ATLAS_NFC as C, atlasReportUrl, canonicalNfcJob, canonicalNfcResult, JOB_FIELDS, RESULT_FIELDS,
    nfcJobEnvelopeSha256, signNfcJob, validateNfcJob, validateNfcTrust, verifyNfcJob, verifyNfcResult } from '../src/nfc.mjs';
const hash = v => createHash('sha256').update(v).digest('hex');
const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), workstation = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const entry = pair => { const der = pair.publicKey.export({ type: 'spki', format: 'der' }); return { keyId: hash(der), publicSpkiDerBase64: der.toString('base64') }; };
const trust = { schemaVersion: 'atlas-nfc-trust-v1', serverKeys: [entry(server)], workstationKeys: [{ ...entry(workstation), enrollmentPolicy: C.workstationEnrollmentPolicy }] };
const approvedReport = { specimenId: 'synthetic-specimen-1', approvalId: 'synthetic-approval-1', approvalVersion: 2, publicToken: `ar_${'A'.repeat(24)}`, publicHash: 'a'.repeat(64) };
const now = new Date('2026-09-08T12:00:00.000Z');
function job(overrides = {}) { return { ...signNfcJob({ approvedReport, privateKeyPem: server.privateKey.export({ type: 'pkcs8', format: 'pem' }), now }), ...overrides }; }
function result(j) {
    const r = { schemaVersion: C.resultSchema, algorithm: C.algorithm, workstationKeyId: entry(workstation).keyId,
        jobEnvelopeSha256: nfcJobEnvelopeSha256(j), nonce: j.nonce, ...approvedReport, url: j.url, chipType: C.chipType,
        securityMode: C.securityMode, programmingProfile: C.programmingProfile, readerModel: C.readerModel,
        adapterIdentity: C.adapterIdentity, adapterVersion: C.adapterVersion, readbackPayloadSha256: hash(j.url),
        writeProtectionState: C.writeProtectionState, readerResultCode: C.readerResultCode, helperCapability: C.helperCapability,
        observedAt: now.toISOString(), signature: Buffer.alloc(64).toString('base64url') };
    r.signature = sign('sha256', Buffer.from(canonicalNfcResult(r)), { key: workstation.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return r;
}
test('signed ATLAS report version exact URL and terminal result verify', () => {
    const j = job(), r = result(j);
    assert.equal(j.url, `https://atlasgrading.com/reports/${approvedReport.publicToken}?v=2`);
    assert.deepEqual(verifyNfcJob({ job: j, trust, now }), j);
    assert.deepEqual(verifyNfcResult({ job: j, result: r, approvedReport, trust, now }), r);
    assert.deepEqual(verifyNfcResult({ job: j, result: r, approvedReport, trust, now }), r);
    assert(!JSON.stringify(r).toLowerCase().includes('uid'));
});
test('all signed job and result fields resist substitution', () => {
    const j = job(), r = result(j);
    for (const key of [...JOB_FIELDS, 'signature']) {
        const changed = { ...j, [key]: key === 'approvalVersion' ? 3 : `${j[key]}X` };
        assert.throws(() => verifyNfcJob({ job: changed, trust, now }), key);
    }
    for (const key of [...RESULT_FIELDS, 'signature']) {
        const changed = { ...r, [key]: key === 'approvalVersion' ? 3 : `${r[key]}X` };
        assert.throws(() => verifyNfcResult({ job: j, result: changed, approvedReport, trust, now }), key);
    }
});
test('authority must match currently selected immutable approval and original job', () => {
    const j = job(), r = result(j);
    for (const key of Object.keys(approvedReport)) assert.throws(() => verifyNfcResult({ job: j, result: r,
        approvedReport: { ...approvedReport, [key]: key === 'approvalVersion' ? 3 : `${approvedReport[key]}b` }, trust, now }), key);
    assert.throws(() => verifyNfcResult({ job: job(), result: r, approvedReport, trust, now }));
});
test('expired, future, excessive lifetime, malformed UTC and late observations fail', () => {
    const j = job(), r = result(j);
    for (const date of ['2026-09-08T11:59:29.999Z', '2026-09-08T12:10:00.001Z']) assert.throws(() => verifyNfcJob({ job: j, trust, now: new Date(date) }));
    for (const changed of [{ expiresAt: '2026-09-08T12:16:00.000Z' }, { issuedAt: '2026-09-08T12:00:00Z' }, { issuedAt: j.expiresAt }, { issuedAt: '2026-02-30T12:00:00.000Z' }]) assert.throws(() => validateNfcJob({ ...j, ...changed }));
    for (const observedAt of ['2026-09-08T11:59:59.999Z', '2026-09-08T12:10:00.001Z']) assert.throws(() => verifyNfcResult({ job: j, result: { ...r, observedAt }, approvedReport, trust, now }));
});
test('closed shapes, exact token/version/host/query and no legacy purpose borrowing', () => {
    const j = job();
    for (const url of [j.url.replace('atlasgrading.com', 'collect.tenkings.co'), j.url.replace('?v=2', ''), `${j.url}&v=3`, `${j.url}#x`, j.url.replace('?v=2', '?v=02'), j.url.replace('/reports/', '/c/'), j.url.replace('https:', 'http:')]) assert.throws(() => validateNfcJob({ ...j, url }));
    for (const extra of [{ rawUid: '04112233445566' }, { assembled: true }, { approvalVersion: '2' }, { purpose: 'program-permanent-card-url' }, { schemaVersion: 'ten-kings-v2-nfc-job-v1' }, { signature: `${j.signature}=` }, { publicHash: 'A'.repeat(64) }]) assert.throws(() => validateNfcJob({ ...j, ...extra }));
    for (const version of [0, -1, 1.5, 2147483648, NaN, '2']) assert.throws(() => atlasReportUrl(approvedReport.publicToken, version));
});
test('server and workstation allowlists are distinct and strict P-256 SPKI', () => {
    const j = job(), r = result(j), other = entry(generateKeyPairSync('ec', { namedCurve: 'prime256v1' }));
    assert.throws(() => verifyNfcJob({ job: j, trust: { ...trust, serverKeys: [other] }, now }));
    assert.throws(() => verifyNfcResult({ job: j, result: r, approvedReport, trust: { ...trust, workstationKeys: [{ ...other, enrollmentPolicy: C.workstationEnrollmentPolicy }] }, now }));
    for (const enrollmentPolicy of ['exportable', '', 'ten-kings-approved']) assert.throws(() => validateNfcTrust({ ...trust, workstationKeys: [{ ...entry(workstation), enrollmentPolicy }] }));
    assert.throws(() => validateNfcTrust({ ...trust, workstationKeys: [{ ...entry(server), enrollmentPolicy: C.workstationEnrollmentPolicy }] }));
    assert.throws(() => validateNfcTrust({ ...trust, serverKeys: [entry(generateKeyPairSync('ec', { namedCurve: 'secp384r1' }))] }));
});
test('retained public-only interoperability vector verifies and matches C# canonical field order', () => {
    const vector = JSON.parse(readFileSync(new URL('./nfc-vector.json', import.meta.url)));
    const { job: j, result: r, trust: t, approvedReport: a } = vector;
    assert.equal(canonicalNfcJob(j), vector.canonicalJob);
    assert.equal(canonicalNfcResult(r), vector.canonicalResult);
    verifyNfcResult({ job: j, result: r, trust: t, approvedReport: a, now: new Date(vector.now) });
    const cs = readFileSync(new URL('../../ai-grader-nfc-helper/src/TenKings.AiGrader.NfcHelper/AtlasNfcProtocol.cs', import.meta.url), 'utf8');
    for (const [method, symbol, fields] of [['CanonicalJobStatement', 'job', JOB_FIELDS], ['CanonicalResultStatement', 'result', RESULT_FIELDS]]) {
        const section = cs.slice(cs.indexOf(`public static string ${method}`));
        const join = section.slice(section.indexOf("return string.Join"), section.indexOf(');', section.indexOf("return string.Join")));
        const names = [...join.matchAll(new RegExp(`${symbol}\\.(\\w+)`, 'g'))].map(m => m[1][0].toLowerCase() + m[1].slice(1));
        assert.deepEqual(names, fields, `${method} source field order (runtime remains separately required)`);
    }
});
