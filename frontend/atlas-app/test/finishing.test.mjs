import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { StaffFinishing } from '../lib/server/access/finishing.mjs';
import { makeFinishingConfig } from '../lib/server/access/finishing-runtime.mjs';
import { ATLAS_NFC as C, canonicalNfcResult } from '@atlas/finishing/nfc';
import { canonical } from '../lib/server/review-contract.mjs';
import { hash, deny } from '../lib/server/policy.mjs';

function fixture() {
    const specimenId = randomUUID(), actorId = randomUUID(), approvalId = randomUUID();
    const packet = { version: 'atlas-public-report-v1', publicToken: `ar_${'A'.repeat(24)}`, reportNumber: 'ATLAS-ABCDEF123456', approvalVersion: 1,
        approvedAt: '2026-09-08T12:00:00.000Z', mode: 'LOCAL_FIXTURE', evidenceHash: 'e'.repeat(64), analysisHash: 'a'.repeat(64),
        report: { version: 'atlas-graded-report-v1', ruleVersion: 'synthetic-rules', cardProfile: 'POKEMON',
            identity: { cardName: 'Synthetic unit card', year: '2026', productSet: 'Offline only', parallel: null, cardNumber: '1' },
            detectorVersion: 'synthetic-only', grade: null, findings: [], findingCounts: { included: 0 } } };
    const damage = { score: 9, weightedDamagePercent: 1 };
    const side = { centering: { score: 9, leftRightBalance: [50, 50], topBottomBalance: [50, 50] }, corners: damage, edges: damage, surface: damage };
    packet.report.grade = { front: side, back: side, subgrades: { centering: 9, corners: 9, edges: 9, surface: 9 }, overall: { displayGrade: 9, rawGrade: 9 } };
    const card = { id: specimenId, analysisRevision: 1, draftRevision: 1, evidenceHash: packet.evidenceHash };
    const approved = { id: approvalId, specimenId, version: 1, analysisRevision: 1, reviewRevision: 1, evidenceHash: packet.evidenceHash,
        analysisHash: packet.analysisHash, publicCanonical: canonical(packet), publicHash: hash(canonical(packet)), approvedAt: new Date(packet.approvedAt) };
    const publication = { specimenId, publicToken: packet.publicToken, reportNumber: packet.reportNumber, currentApprovalId: approvalId };
    const state = { card, approval: approved, historicalApprovals: [], publication, pending: 0, operatorPending: 0, failAudit: false, tables: {
        staffLabelIssue: [], staffNfcJob: [], staffNfcVerification: [], staffPhysicalFinish: [], audits: [] } };
    const tx = { $queryRaw: async (strings, ...values) => {
        const sql = strings.join('?');
        if (sql.includes('operator_work_pending')) return [{ count: state.operatorPending }];
        if (sql.includes('lock_nfc_control')) { state.nfcLocks = (state.nfcLocks ?? 0) + 1; return state.nfcControl ? [state.nfcControl] : []; }
        assert(sql.includes('StaffSpecimen') && sql.includes('FOR UPDATE')); assert.equal(values[0], specimenId); return [state.card];
    }, staffGradingOperation: { count: async () => state.pending },
    staffPublicReport: { findUnique: async ({ where }) => where.specimenId === specimenId ? state.publication : null },
    staffReportApproval: { findUnique: async ({ where }) => where.id === state.approval.id ? state.approval : state.historicalApprovals.find(row => row.id === where.id) ?? null } };
    function matches(row, where) { return Object.entries(where).every(([key, value]) => typeof value === 'object' && value !== null
        ? Object.entries(value).every(([k, v]) => row[k] === v) : row[key] === value); }
    for (const name of Object.keys(state.tables).filter(x => x !== 'audits')) tx[name] = {
        findUnique: async ({ where }) => state.tables[name].find(row => matches(row, where)) ?? null,
        findMany: async ({ where, take }) => state.tables[name].filter(row => matches(row, where))
            .sort((a, b) => +b.createdAt - +a.createdAt || b.id.localeCompare(a.id)).slice(0, take),
        create: async ({ data }) => {
            assert(!state.tables[name].some(row => row.id === data.id || row.actorId === data.actorId && row.operationId === data.operationId));
            state.tables[name].push(data); return data;
        },
    };
    const context = { tx, identity: { id: actorId, role: 'REVIEWER', certificationUntil: new Date('2026-09-09T12:00:00Z'), accessVersion: 4 },
        session: { tokenHash: 's'.repeat(64), createdAt: new Date('2026-09-08T12:00:00Z') },
        now: new Date('2026-09-08T12:01:00.000Z'), control: { mode: 'LOCAL_FIXTURE', origin: 'http://127.0.0.1:4318',
            deploymentId: 'finishing-synthetic', releaseSha: '0'.repeat(40), revision: 7 } };
    const assignment = { canReview: true, fence: 3, revokedAt: null };
    const staff = Object.freeze({ id: actorId, role: 'REVIEWER' });
    const auth = {
        withStaff: async (handle, work) => {
            if (handle !== staff) deny(401, 'SIGN_IN_REQUIRED');
            const before = structuredClone(state.tables);
            try { return await work(context); } catch (error) { state.tables = before; throw error; }
        }, audit: async (_tx, event, subjectId, id, details) => {
            if (state.failAudit) throw new Error('synthetic audit rollback');
            state.tables.audits.push({ event, subjectId, actorId: id, details });
        },
    };
    const review = { assigned: async (_context, id) => { if (id !== specimenId || assignment.revokedAt) deny(404, 'CARD_NOT_FOUND'); return assignment; } };
    const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), workstation = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    function key(pair) { const bytes = pair.publicKey.export({ type: 'spki', format: 'der' }); return { keyId: hash(bytes), publicSpkiDerBase64: bytes.toString('base64') }; }
    const nfc = { ...makeFinishingConfig({ ...context.control, privateKeyPem: server.privateKey.export({ type: 'pkcs8', format: 'pem' }),
        trust: { schemaVersion: 'atlas-nfc-trust-v1', serverKeys: [key(server)], workstationKeys: [{ ...key(workstation), enrollmentPolicy: C.workstationEnrollmentPolicy }] } }) };
    state.nfcControl = { id: 'active', enabled: true, revision: 3, ...Object.fromEntries(
        ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash', 'signingKeyHash', 'trustHash'].map(k => [k, nfc[k]])) };
    const service = new StaffFinishing({ auth, review, nfc });
    const expected = () => ({ approvalId: state.approval.id, approvalVersion: state.approval.version, publicHash: state.approval.publicHash });
    function result(job) {
        const r = { schemaVersion: C.resultSchema, algorithm: C.algorithm, workstationKeyId: key(workstation).keyId,
            jobEnvelopeSha256: job.jobEnvelopeSha256, nonce: job.job.nonce, specimenId, ...expected(), publicToken: packet.publicToken, url: job.job.url,
            chipType: C.chipType, securityMode: C.securityMode, programmingProfile: C.programmingProfile, readerModel: C.readerModel,
            adapterIdentity: C.adapterIdentity, adapterVersion: C.adapterVersion, readbackPayloadSha256: hash(job.job.url), writeProtectionState: C.writeProtectionState,
            readerResultCode: C.readerResultCode, helperCapability: C.helperCapability, observedAt: context.now.toISOString(), signature: Buffer.alloc(64).toString('base64url') };
        r.signature = sign('sha256', Buffer.from(canonicalNfcResult(r)), { key: workstation.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'); return r;
    }
    async function label() { return service.issueLabel(staff, specimenId, { operationId: randomUUID(), ...expected() }); }
    async function job(labelIssueId) { return service.createNfcJob(staff, specimenId, { operationId: randomUUID(), ...expected(), labelIssueId }); }
    async function verify(j) { const input = { operationId: randomUUID(), jobId: j.id, result: result(j) }; return { input, receipt: await service.recordNfcVerification(staff, specimenId, input) }; }
    function physical(labelIssueId, verificationId, stage = 'ASSEMBLED', assemblyId = null) {
        return { operationId: randomUUID(), ...expected(), labelIssueId, verificationId, stage, assemblyId, humanConfirmed: true };
    }
    return { service, staff, specimenId, state, context, assignment, nfc, expected, label, job, verify, result, physical };
}
const rejects = (fn, code) => assert.rejects(fn, { code });

test('label, signed job, verified NFC and separate human assembly/weld preserve exact approval', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id), verification = await f.verify(job);
    assert.equal(label.status, 'READY_TO_PRINT'); assert.equal(label.label.grade.overall.displayGrade, 9);
    assert.equal(label.label.url, job.job.url); assert.equal(job.job.publicHash, f.state.approval.publicHash);
    assert.equal(f.state.tables.staffPhysicalFinish.length, 0);
    let view = await f.service.read(f.staff, f.specimenId); assert.equal(view.stage, 'READY_FOR_ASSEMBLY');
    const assemblyInput = f.physical(label.id, verification.receipt.id);
    const assembly = await f.service.recordPhysical(f.staff, f.specimenId, assemblyInput);
    assert.equal(assembly.authority, 'HUMAN_CONFIRMATION');
    const weldInput = f.physical(label.id, verification.receipt.id, 'SONIC_WELDED', assembly.id);
    await f.service.recordPhysical(f.staff, f.specimenId, weldInput);
    view = await f.service.read(f.staff, f.specimenId); assert.equal(view.stage, 'SONIC_WELD_CONFIRMED');
    assert.equal(f.state.tables.audits.length, 5);
    const output = JSON.stringify(view);
    for (const secret of ['PRIVATE KEY', f.context.session.tokenHash, 'publicSpkiDerBase64', 'workstationKeyId', 'signature', 'nonce']) assert(!output.includes(secret), secret);
    for (const name of ['staffLabelIssue', 'staffNfcJob', 'staffNfcVerification', 'staffPhysicalFinish']) for (const row of f.state.tables[name]) {
        assert.equal(row.actorId, f.staff.id); assert.equal(row.assignmentFence, 3); assert.equal(row.accessVersion, 4); assert.equal(row.controlRevision, 7);
    }
});
test('fresh trained assigned opaque human authority is required for every mutation', async () => {
    const f = fixture(), input = { operationId: randomUUID(), ...f.expected() };
    await rejects(() => f.service.issueLabel({ ...f.staff }, f.specimenId, input), 'SIGN_IN_REQUIRED');
    for (const mutate of [() => { f.context.identity.role = 'OBSERVER'; }, () => { f.assignment.canReview = false; }, () => { f.context.identity.certificationUntil = new Date('2026-09-08T12:00:00Z'); }]) {
        f.context.identity.role = 'REVIEWER'; f.assignment.canReview = true; f.context.identity.certificationUntil = new Date('2026-09-09T12:00:00Z');
        mutate(); await rejects(() => f.service.issueLabel(f.staff, f.specimenId, input), 'TRAINED_REVIEWER_REQUIRED');
    }
    f.context.identity.certificationUntil = new Date('2026-09-09T12:00:00Z'); f.context.session.createdAt = new Date('2026-09-08T11:45:00Z');
    await rejects(() => f.service.issueLabel(f.staff, f.specimenId, input), 'FRESH_SIGN_IN_REQUIRED');
    f.context.session.createdAt = new Date('2026-09-08T12:00:00Z'); f.assignment.revokedAt = f.context.now;
    await rejects(() => f.service.issueLabel(f.staff, f.specimenId, input), 'CARD_NOT_FOUND');
    assert.equal(f.state.tables.staffLabelIssue.length, 0);
});
test('new issuance rejects stale approval, changed report/evidence and unresolved grading', async () => {
    const f = fixture(), input = { operationId: randomUUID(), ...f.expected() };
    await rejects(() => f.service.issueLabel(f.staff, f.specimenId, { ...input, approvalVersion: 2 }), 'APPROVAL_CHANGED');
    f.state.card.draftRevision = 2; await rejects(() => f.service.issueLabel(f.staff, f.specimenId, input), 'APPROVAL_CHANGED'); f.state.card.draftRevision = 1;
    f.state.card.evidenceHash = 'b'.repeat(64); await rejects(() => f.service.issueLabel(f.staff, f.specimenId, input), 'APPROVAL_CHANGED'); f.state.card.evidenceHash = 'e'.repeat(64);
    f.state.pending = 1; await rejects(() => f.service.issueLabel(f.staff, f.specimenId, input), 'GRADING_WORK_UNRESOLVED'); f.state.pending = 0;
    f.state.operatorPending = 1; await rejects(() => f.service.issueLabel(f.staff, f.specimenId, input), 'GRADING_WORK_UNRESOLVED'); f.state.operatorPending = 0;
    f.state.approval.publicCanonical += ' '; await rejects(() => f.service.issueLabel(f.staff, f.specimenId, input), 'FINISHING_RECORD_UNAVAILABLE');
});
test('every action has immutable idempotent actor/operation receipt and atomic audit rollback', async () => {
    const f = fixture(), input = { operationId: randomUUID(), ...f.expected() };
    const label = await f.service.issueLabel(f.staff, f.specimenId, input);
    assert.deepEqual(await f.service.issueLabel(f.staff, f.specimenId, input), label);
    await rejects(() => f.service.issueLabel(f.staff, f.specimenId, { ...input, publicHash: 'b'.repeat(64) }), 'REQUEST_CONFLICT');
    f.state.failAudit = true;
    await assert.rejects(() => f.label(), /synthetic audit rollback/);
    assert.equal(f.state.tables.staffLabelIssue.length, 1); assert.equal(f.state.tables.audits.length, 1);
    f.state.failAudit = false;
    const reprint = await f.label(); assert.notEqual(reprint.id, label.id); assert.equal(reprint.approvalId, label.approvalId);
    const jobInput = { operationId: randomUUID(), ...f.expected(), labelIssueId: label.id };
    const job = await f.service.createNfcJob(f.staff, f.specimenId, jobInput);
    assert.deepEqual(await f.service.createNfcJob(f.staff, f.specimenId, jobInput), job);
    const verification = await f.verify(job), physical = f.physical(label.id, verification.receipt.id);
    const assembly = await f.service.recordPhysical(f.staff, f.specimenId, physical);
    assert.deepEqual(await f.service.recordPhysical(f.staff, f.specimenId, physical), assembly);
    await rejects(() => f.service.recordPhysical(f.staff, f.specimenId, { ...physical, stage: 'SONIC_WELDED', assemblyId: assembly.id }), 'REQUEST_CONFLICT');
});
test('successful NFC replay survives job expiry, but first late result and substituted operation fail', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id), verification = await f.verify(job);
    f.context.now = new Date('2026-09-08T12:12:00Z'); f.context.session.createdAt = new Date('2026-09-08T12:11:00Z');
    assert.deepEqual(await f.service.recordNfcVerification(f.staff, f.specimenId, verification.input), verification.receipt);
    assert.equal(f.state.tables.staffNfcVerification.length, 1);
    await rejects(() => f.service.recordNfcVerification(f.staff, f.specimenId, { ...verification.input, operationId: randomUUID() }), 'NFC_JOB_ALREADY_RECORDED');
    const other = fixture(), otherLabel = await other.label(), otherJob = await other.job(otherLabel.id), result = other.result(otherJob);
    other.context.now = new Date('2026-09-08T12:12:00Z'); other.context.session.createdAt = new Date('2026-09-08T12:11:00Z');
    await rejects(() => other.service.recordNfcVerification(other.staff, other.specimenId, { operationId: randomUUID(), jobId: otherJob.id, result }), 'NFC_VERIFICATION_REJECTED');
    assert.equal(other.state.tables.staffNfcVerification.length, 0);
});
test('wrong job/result/allowlist and rehashed label substitution cannot become physical facts', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id), secondJob = await f.job(label.id);
    await rejects(() => f.service.recordNfcVerification(f.staff, f.specimenId, { operationId: randomUUID(), jobId: secondJob.id, result: f.result(job) }), 'NFC_VERIFICATION_REJECTED');
    const trust = f.nfc.trust; f.nfc.trust = { ...trust, workstationKeys: [] };
    await rejects(() => f.verify(job), 'NFC_NOT_CONFIGURED'); f.nfc.trust = trust;
    const verification = await f.verify(job), row = f.state.tables.staffLabelIssue[0];
    const forged = JSON.parse(row.labelCanonical); forged.grade.overall.displayGrade = 10;
    row.labelCanonical = canonical(forged); row.labelHash = hash(row.labelCanonical);
    await rejects(() => f.service.recordPhysical(f.staff, f.specimenId, f.physical(label.id, verification.receipt.id)), 'FINISHING_RECORD_UNAVAILABLE');
    assert.equal(f.state.tables.staffPhysicalFinish.length, 0);
});
test('physical stages require exact label/NFC association and explicit prior human assembly', async () => {
    const f = fixture(), label = await f.label(), otherLabel = await f.label(), job = await f.job(label.id), verification = await f.verify(job);
    await rejects(() => f.service.recordPhysical(f.staff, f.specimenId, { ...f.physical(label.id, verification.receipt.id), humanConfirmed: false }), 'PHYSICAL_CONFIRMATION_REQUIRED');
    await rejects(() => f.service.recordPhysical(f.staff, f.specimenId, f.physical(otherLabel.id, verification.receipt.id)), 'FINISHING_LINKAGE_CHANGED');
    await rejects(() => f.service.recordPhysical(f.staff, f.specimenId, f.physical(label.id, verification.receipt.id, 'SONIC_WELDED', randomUUID())), 'FINISHING_LINKAGE_CHANGED');
    const assembly = await f.service.recordPhysical(f.staff, f.specimenId, f.physical(label.id, verification.receipt.id));
    await rejects(() => f.service.recordPhysical(f.staff, f.specimenId, f.physical(label.id, verification.receipt.id)), 'PHYSICAL_FACT_ALREADY_RECORDED');
    f.state.card.draftRevision++;
    await rejects(() => f.service.recordPhysical(f.staff, f.specimenId, f.physical(label.id, verification.receipt.id, 'SONIC_WELDED', assembly.id)), 'APPROVAL_CHANGED');
    assert.equal(f.state.tables.staffPhysicalFinish.length, 1);
});

test('revoked training and forged actor fields cannot issue, record or replay finishing authority', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id), verification = await f.verify(job);
    const physical = f.physical(label.id, verification.receipt.id);
    const methods = [
        () => f.label(),
        () => f.job(label.id),
        () => f.service.recordNfcVerification(f.staff, f.specimenId, verification.input),
        () => f.service.recordPhysical(f.staff, f.specimenId, physical),
    ];
    f.context.identity.certificationUntil = new Date('2026-09-08T12:00:00Z');
    for (const action of methods) await rejects(action, 'TRAINED_REVIEWER_REQUIRED');
    f.context.identity.certificationUntil = new Date('2026-09-09T12:00:00Z');
    await rejects(() => f.service.recordPhysical(f.staff, f.specimenId, { ...physical, actorId: randomUUID() }), 'INVALID_REQUEST');
    await rejects(() => f.service.createNfcJob(f.staff, f.specimenId, { operationId: randomUUID(), ...f.expected(), labelIssueId: label.id, workstationToken: 'browser-secret' }), 'INVALID_REQUEST');
    assert.equal(f.state.tables.staffLabelIssue.length, 1); assert.equal(f.state.tables.staffNfcJob.length, 1);
    assert.equal(f.state.tables.staffNfcVerification.length, 1); assert.equal(f.state.tables.staffPhysicalFinish.length, 0);
});

test('read-only recovery retrieves expired historical exact job and saved verification with fresh human authority', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id), saved = await f.verify(job);
    const before = structuredClone(f.state.tables);
    f.state.historicalApprovals.push(f.state.approval);
    f.state.approval = { ...f.state.approval, id: randomUUID(), version: 2 };
    f.state.publication.currentApprovalId = f.state.approval.id; f.state.card.draftRevision++;
    f.context.now = new Date('2026-09-08T12:30:00Z'); f.context.session.createdAt = new Date('2026-09-08T12:29:00Z');
    f.nfc.enabled = false; f.state.pending = 1;
    const recovery = await f.service.retrieveNfcJob(f.staff, f.specimenId, job.id);
    assert.deepEqual(recovery, { receipt: job, recoveryOnly: true, verification: saved.receipt });
    assert.deepEqual(f.state.tables, before); // No new jobs, mutations or audits.
    await rejects(() => f.service.recordNfcVerification(f.staff, f.specimenId, { ...saved.input, operationId: randomUUID() }), 'NFC_JOB_ALREADY_RECORDED');
    await rejects(() => f.service.retrieveNfcJob({ ...f.staff }, f.specimenId, job.id), 'SIGN_IN_REQUIRED');
    f.context.session.createdAt = new Date('2026-09-08T12:00:00Z');
    await rejects(() => f.service.retrieveNfcJob(f.staff, f.specimenId, job.id), 'FRESH_SIGN_IN_REQUIRED');
    f.context.session.createdAt = f.context.now; f.context.identity.certificationUntil = f.context.now;
    await rejects(() => f.service.retrieveNfcJob(f.staff, f.specimenId, job.id), 'TRAINED_REVIEWER_REQUIRED');
});

test('read-only recovery does not turn unrecorded expired results into hosted success', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id), result = f.result(job);
    f.context.now = new Date('2026-09-08T12:30:00Z'); f.context.session.createdAt = new Date('2026-09-08T12:29:00Z');
    assert.equal((await f.service.retrieveNfcJob(f.staff, f.specimenId, job.id)).verification, null);
    await rejects(() => f.service.recordNfcVerification(f.staff, f.specimenId, { operationId: randomUUID(), jobId: job.id, result }), 'NFC_VERIFICATION_REJECTED');
    assert.equal(f.state.tables.staffNfcVerification.length, 0);
});

test('recovery rejects unknown/cross-card jobs, unassigned staff and rehashed immutable label substitution', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id);
    await rejects(() => f.service.retrieveNfcJob(f.staff, f.specimenId, randomUUID()), 'NFC_JOB_NOT_FOUND');
    f.state.tables.staffNfcJob[0].specimenId = randomUUID();
    await rejects(() => f.service.retrieveNfcJob(f.staff, f.specimenId, job.id), 'NFC_JOB_NOT_FOUND');
    f.state.tables.staffNfcJob[0].specimenId = f.specimenId; f.assignment.revokedAt = f.context.now;
    await rejects(() => f.service.retrieveNfcJob(f.staff, f.specimenId, job.id), 'CARD_NOT_FOUND'); f.assignment.revokedAt = null;
    const row = f.state.tables.staffLabelIssue[0], value = JSON.parse(row.labelCanonical); value.grade.overall.displayGrade = 10;
    row.labelCanonical = canonical(value); row.labelHash = hash(row.labelCanonical);
    await rejects(() => f.service.retrieveNfcJob(f.staff, f.specimenId, job.id), 'FINISHING_RECORD_UNAVAILABLE');
});

test('recovery rejects rehashed saved result substitution against the original immutable job', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id); await f.verify(job);
    const row = f.state.tables.staffNfcVerification[0], result = JSON.parse(row.resultCanonical);
    result.nonce = Buffer.alloc(32, 7).toString('base64url'); row.resultCanonical = canonical(result); row.resultHash = hash(row.resultCanonical);
    await rejects(() => f.service.retrieveNfcJob(f.staff, f.specimenId, job.id), 'FINISHING_RECORD_UNAVAILABLE');
});

test('DB NFC activation and every deployment/config pin govern reads and new jobs/results', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id);
    const original = { ...f.state.nfcControl };
    const changes = [null, { enabled: false }, { id: 'other' }, { revision: 0 },
        ...['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash', 'signingKeyHash', 'trustHash'].map(k => ({ [k]: 'mismatch' }))];
    for (const change of changes) {
        f.state.nfcControl = change === null ? null : { ...original, ...change };
        assert.equal((await f.service.read(f.staff, f.specimenId)).nfcConfigured, false);
        await rejects(() => f.job(label.id), 'NFC_NOT_CONFIGURED'); await rejects(() => f.verify(job), 'NFC_NOT_CONFIGURED');
    }
    f.state.nfcControl = original;
    for (const key of ['mode', 'origin', 'deploymentId', 'releaseSha']) {
        const saved = f.context.control[key]; f.context.control[key] = 'mismatch';
        assert.equal(await f.service.nfcConfig(f.context, false), null); f.context.control[key] = saved;
    }
    assert.equal((await f.service.read(f.staff, f.specimenId)).nfcConfigured, true);
    const verified = await f.verify(job);
    for (const row of [f.state.tables.staffNfcJob[0], f.state.tables.staffNfcVerification[0]]) {
        assert.equal(row.nfcConfigHash, f.nfc.configHash); assert.equal(row.nfcControlRevision, original.revision);
    }
    assert(f.state.nfcLocks >= changes.length * 3);
    assert.equal(verified.receipt.status, 'URL_AND_PERMANENT_LOCK_VERIFIED');
});

test('disabled/malformed NFC retains label, physical facts, historical recovery and exact successful replay', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id), saved = await f.verify(job);
    f.state.nfcControl.enabled = false; f.service.nfc = () => deny(503, 'NFC_NOT_CONFIGURED');
    assert.equal((await f.service.read(f.staff, f.specimenId)).nfcConfigured, false);
    const locks = f.state.nfcLocks;
    await f.label();
    const assembly = await f.service.recordPhysical(f.staff, f.specimenId, f.physical(label.id, saved.receipt.id));
    await f.service.recordPhysical(f.staff, f.specimenId, f.physical(label.id, saved.receipt.id, 'SONIC_WELDED', assembly.id));
    f.context.now = new Date('2026-09-08T12:30:00Z'); f.context.session.createdAt = new Date('2026-09-08T12:29:00Z');
    assert.deepEqual(await f.service.recordNfcVerification(f.staff, f.specimenId, saved.input), saved.receipt);
    assert.deepEqual((await f.service.retrieveNfcJob(f.staff, f.specimenId, job.id)).verification, saved.receipt);
    assert.equal(f.state.nfcLocks, locks); // No current signer/config needed for these facts/reads.
});

test('new verification records current control after signer rotation while original job keeps its issuance pins', async () => {
    const f = fixture(), label = await f.label(), job = await f.job(label.id), second = await f.job(label.id);
    const oldConfig = f.nfc.configHash, next = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const der = next.publicKey.export({ type: 'spki', format: 'der' });
    const nextEntry = { keyId: hash(der), publicSpkiDerBase64: der.toString('base64') };
    const rotate = serverKeys => {
        const config = makeFinishingConfig({ ...f.context.control, privateKeyPem: next.privateKey.export({ type: 'pkcs8', format: 'pem' }),
            trust: { ...f.nfc.trust, serverKeys } });
        Object.assign(f.nfc, config);
        Object.assign(f.state.nfcControl, ...['configHash', 'signingKeyHash', 'trustHash'].map(k => ({ [k]: config[k] })));
        f.state.nfcControl.revision++;
    };
    rotate([...f.nfc.trust.serverKeys, nextEntry]); await f.verify(job);
    assert.equal(f.state.tables.staffNfcJob[0].nfcConfigHash, oldConfig);
    assert.notEqual(f.state.tables.staffNfcVerification[0].nfcConfigHash, oldConfig);
    assert.equal(f.state.tables.staffNfcVerification[0].nfcControlRevision, 4);
    rotate([nextEntry]); await rejects(() => f.verify(second), 'NFC_VERIFICATION_REJECTED');
    assert.equal(f.state.tables.staffNfcVerification.length, 1);
});

test('deliberate injected config cannot change actual trust or signer under an unchanged DB hash', async () => {
    const f = fixture(), label = await f.label();
    const next = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), der = next.publicKey.export({ type: 'spki', format: 'der' });
    const originalTrust = f.nfc.trust;
    f.nfc.trust = { ...originalTrust, serverKeys: [...originalTrust.serverKeys,
        { keyId: hash(der), publicSpkiDerBase64: der.toString('base64') }] };
    assert.equal((await f.service.read(f.staff, f.specimenId)).nfcConfigured, false);
    await rejects(() => f.job(label.id), 'NFC_NOT_CONFIGURED');
    f.nfc.trust = originalTrust; f.nfc.privateKeyPem = next.privateKey.export({ type: 'pkcs8', format: 'pem' });
    await rejects(() => f.job(label.id), 'NFC_NOT_CONFIGURED');
    assert.equal(f.state.tables.staffNfcJob.length, 0);
});
