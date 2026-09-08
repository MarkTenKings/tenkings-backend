import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { ATLAS_NFC as C, JOB_FIELDS, signNfcJob, canonicalNfcResult, nfcJobEnvelopeSha256 } from '@atlas/finishing/nfc';
import { DurableReviewStore } from '../lib/server/access/review.mjs';
import { StaffReports } from '../lib/server/access/reports.mjs';
import { StaffFinishing } from '../lib/server/access/finishing.mjs';
import { makeFinishingConfig } from '../lib/server/access/finishing-runtime.mjs';
import { fixtureEvidence } from '../lib/server/access/fixture.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { hash } from '../lib/server/policy.mjs';

// Called only by the lead's existing disposable database context. This module
// starts no database, listener, provider, helper, process or real key enrollment.
const OPTIONS = { analyses: true, trained: true };
const events = { staffLabelIssue: 'ATLAS_LABEL_ISSUED', staffNfcJob: 'ATLAS_NFC_JOB_ISSUED', staffNfcVerification: 'ATLAS_NFC_VERIFIED' };
const approvalInput = card => ({ operationId: randomUUID(), expectedAnalysisRevision: card.grading.analysisRevision,
    analysisHash: card.grading.analysisHash, expectedReviewRevision: card.draft.revision, reviewHash: card.reviewHash, evidenceHash: card.evidenceHash });
const readyInput = card => ({ operationId: randomUUID(), expectedRevision: card.draft.revision, evidenceRevision: card.evidenceRevision,
    evidenceHash: card.evidenceHash, observations: { FRONT: 'Owned synthetic finishing fixture.', BACK: '' },
    reviewedSides: ['FRONT', 'BACK'], identityReviewed: true, disposition: 'READY_FOR_HUMAN' });
const spki = pair => pair.publicKey.export({ type: 'spki', format: 'der' });
const inputHash = (kind, cardId, input) => hash(canonical({ kind, cardId, input }));
async function fixture(context, work) {
    assert.equal(context.config.mode, 'LOCAL_FIXTURE');
    const { admin } = context, signed = await context.login(), review = new DurableReviewStore({ auth: context.auth, evidence: fixtureEvidence() });
    const reports = new StaffReports({ auth: context.auth, review });
    const cards = await review.list(signed.staff), card = await review.read(signed.staff, cards.find(c => c.evidenceComplete).id);
    const ready = await review.save(signed.staff, card.id, readyInput(card));
    const approved = await reports.approve(signed.staff, ready.id, approvalInput(ready));
    const ap = await admin.staffReportApproval.findUnique({ where: { id: approved.approval.approvalId } }), packet = JSON.parse(ap.publicCanonical);
    const session = await admin.staffSession.findUnique({ where: { tokenHash: hash(signed.token) } });
    const identity = await admin.staffIdentity.findUnique({ where: { id: signed.staff.id } });
    const assignment = await admin.staffAssignment.findUnique({ where: { specimenId_identityId: { specimenId: card.id, identityId: signed.staff.id } } });
    const control = await admin.staffControl.findUnique({ where: { id: 'active' } });
    const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }), workstation = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const trust = { schemaVersion: 'atlas-nfc-trust-v1', serverKeys: [{ keyId: hash(spki(server)), publicSpkiDerBase64: spki(server).toString('base64') }],
        workstationKeys: [{ keyId: hash(spki(workstation)), publicSpkiDerBase64: spki(workstation).toString('base64'), enrollmentPolicy: C.workstationEnrollmentPolicy }] };
    const nfcSettings = makeFinishingConfig({ mode: control.mode, origin: control.origin, deploymentId: control.deploymentId,
        releaseSha: control.releaseSha, privateKeyPem: server.privateKey.export({ type: 'pkcs8', format: 'pem' }), trust });
    const { privateKeyPem: _private, trust: _trust, ...nfcActivation } = nfcSettings;
    let nfc = await admin.staffNfcControl.create({ data: nfcActivation });
    const binding = { specimenId: card.id, approvalId: ap.id, approvalVersion: ap.version, publicToken: packet.publicToken, publicHash: ap.publicHash };
    const expected = () => ({ approvalId: ap.id, approvalVersion: ap.version, publicHash: ap.publicHash });
    const authority = () => ({ id: randomUUID(), specimenId: card.id, approvalId: ap.id, actorId: signed.staff.id,
        sessionHash: session.tokenHash, accessVersion: identity.accessVersion, assignmentFence: assignment.fence, controlRevision: control.revision,
        operationId: randomUUID(), createdAt: new Date() });
    function label() {
        const data = authority(), value = { version: 'atlas-approved-slab-label-v1', labelIssueId: data.id, mode: packet.mode, ...binding,
            reportNumber: packet.reportNumber, url: `https://atlasgrading.com/reports/${packet.publicToken}?v=${ap.version}`,
            cardProfile: packet.report.cardProfile, identity: packet.report.identity, grade: packet.report.grade };
        return { ...data, labelCanonical: canonical(value), labelHash: hash(canonical(value)),
            inputHash: inputHash('LABEL', card.id, { operationId: data.operationId, ...expected() }) };
    }
    function job(labelRow, lifetimeMs = 600_000) {
        const data = authority(), j = signNfcJob({ approvedReport: binding,
            privateKeyPem: server.privateKey.export({ type: 'pkcs8', format: 'pem' }), now: data.createdAt, lifetimeMs });
        return { ...data, labelIssueId: labelRow.id, jobCanonical: canonical(j), jobHash: hash(canonical(j)), jobEnvelopeSha256: nfcJobEnvelopeSha256(j),
            bindingHash: hash(canonical(binding)), expiresAt: new Date(j.expiresAt), nfcConfigHash: nfc.configHash, nfcControlRevision: nfc.revision,
            inputHash: inputHash('NFC_JOB', card.id, { operationId: data.operationId, ...expected(), labelIssueId: labelRow.id }) };
    }
    function verification(jobRow) {
        const data = authority(), j = JSON.parse(jobRow.jobCanonical), result = { schemaVersion: C.resultSchema, algorithm: C.algorithm,
            workstationKeyId: hash(spki(workstation)), jobEnvelopeSha256: jobRow.jobEnvelopeSha256, nonce: j.nonce, ...binding, url: j.url,
            chipType: C.chipType, securityMode: C.securityMode, programmingProfile: C.programmingProfile, readerModel: C.readerModel,
            adapterIdentity: C.adapterIdentity, adapterVersion: C.adapterVersion, readbackPayloadSha256: hash(j.url), writeProtectionState: C.writeProtectionState,
            readerResultCode: C.readerResultCode, helperCapability: C.helperCapability, observedAt: data.createdAt.toISOString(), signature: Buffer.alloc(64).toString('base64url') };
        result.signature = sign('sha256', Buffer.from(canonicalNfcResult(result)), { key: workstation.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
        return { ...data, jobId: jobRow.id, resultCanonical: canonical(result), resultHash: hash(canonical(result)), readbackPayloadSha256: result.readbackPayloadSha256,
            workstationKeyId: result.workstationKeyId, observedAt: new Date(result.observedAt), nfcConfigHash: nfc.configHash, nfcControlRevision: nfc.revision,
            inputHash: inputHash('NFC_VERIFIED', card.id, { operationId: data.operationId, jobId: jobRow.id, result }) };
    }
    function physical(labelRow, verified, assembly = null) {
        const data = authority(), stage = assembly ? 'SONIC_WELDED' : 'ASSEMBLED', assemblyId = assembly?.id ?? null;
        return { ...data, labelIssueId: labelRow.id, verificationId: verified.id, stage, assemblyId, physicalConfirmedAt: data.createdAt,
            inputHash: inputHash('PHYSICAL', card.id, { operationId: data.operationId, ...expected(), labelIssueId: labelRow.id,
                verificationId: verified.id, stage, assemblyId, humanConfirmed: true }) };
    }
    function auditData(model, data, details = {}) {
        return { id: randomUUID(), event: events[model] ?? (data.stage === 'ASSEMBLED' ? 'ATLAS_ASSEMBLY_CONFIRMED' : 'ATLAS_SONIC_WELD_CONFIRMED'),
            actorId: data.actorId, subjectId: data.specimenId, details: JSON.stringify({ recordId: data.id, approvalId: data.approvalId,
                operationId: data.operationId, inputHash: data.inputHash, assignmentFence: data.assignmentFence, ...details }) };
    }
    async function persist(model, data, { audit = true, details, after } = {}) {
        return admin.$transaction(async tx => {
            const row = await tx[model].create({ data });
            if (audit) await tx.staffAudit.create({ data: auditData(model, data, details) });
            if (after) await after(tx);
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return row;
        });
    }
    async function completeNfc() {
        const l = await persist('staffLabelIssue', label()), j = await persist('staffNfcJob', job(l)), v = await persist('staffNfcVerification', verification(j));
        return { l, j, v };
    }
    async function nfcControl(change) { nfc = await admin.staffNfcControl.update({ where: { id: 'active' }, data: { ...change, revision: { increment: 1 }, updatedAt: new Date() } }); return nfc; }
    await work({ ...context, signed, review, reports, ready, approved, ap, packet, session, identity, assignment, control,
        binding, expected, label, job, verification, physical, persist, auditData, completeNfc, nfcControl, nfcSettings });
}

async function serviceFixture(context, work) {
    return fixture(context, async f => {
        // Exercise the real restricted serving role and opaque staff authority,
        // never an admin-backed service substitute or fake withStaff callback.
        assert.equal(f.auth.database.client, f.client);
        const finishing = new StaffFinishing({ auth: f.auth, review: f.review, nfc: f.nfcSettings });
        const issueInput = () => ({ operationId: randomUUID(), ...f.expected() });
        const issue = input => finishing.issueLabel(f.signed.staff, f.ready.id, input ?? issueInput());
        const startInput = label => ({ ...issueInput(), labelIssueId: label.id });
        const start = label => finishing.createNfcJob(f.signed.staff, f.ready.id, startInput(label));
        const resultInput = job => {
            const value = f.verification({ ...job, jobCanonical: canonical(job.job) });
            return { operationId: value.operationId, jobId: job.id, result: JSON.parse(value.resultCanonical) };
        };
        const verify = async job => {
            const input = resultInput(job), receipt = await finishing.recordNfcVerification(f.signed.staff, f.ready.id, input);
            return { input, receipt };
        };
        const physicalInput = (label, verification, assembly = null) => ({ ...issueInput(), labelIssueId: label.id, verificationId: verification.id,
            stage: assembly ? 'SONIC_WELDED' : 'ASSEMBLED', assemblyId: assembly?.id ?? null, humanConfirmed: true });
        const physical = (label, verification, assembly = null) => finishing.recordPhysical(f.signed.staff, f.ready.id, physicalInput(label, verification, assembly));
        const complete = async () => { const label = await issue(), job = await start(label), saved = await verify(job); return { label, job, saved }; };
        await work({ ...f, finishing, issueInput, issue, startInput, start, resultInput, verify, physicalInput, physical, complete });
    });
}
const rejectsCode = (code, work) => assert.rejects(work, error => error.code === code, code);

/** Lead invokes await finishingScenarios(scenario); each uses a fresh owned DB. */
export async function finishingScenarios(scenario) {
    await scenario('finishing SQL retains immutable exact facts and human physical work after NFC disable', context => fixture(context, async f => {
        const { l, j, v } = await f.completeNfc(); await f.nfcControl({ enabled: false });
        const assembled = await f.persist('staffPhysicalFinish', f.physical(l, v));
        const welded = await f.persist('staffPhysicalFinish', f.physical(l, v, assembled));
        assert.equal(welded.assemblyId, assembled.id); assert.equal(j.labelIssueId, l.id); assert.equal(v.jobId, j.id);
        for (const [model, row] of [['staffLabelIssue', l], ['staffNfcJob', j], ['staffNfcVerification', v], ['staffPhysicalFinish', welded]]) {
            await assert.rejects(() => f.admin[model].update({ where: { id: row.id }, data: { inputHash: 'f'.repeat(64) } }), /immutable/);
            await assert.rejects(() => f.admin[model].delete({ where: { id: row.id } }), /immutable/);
        }
        for (const name of ['StaffLabelIssue', 'StaffNfcJob', 'StaffNfcVerification', 'StaffPhysicalFinish'])
            await assert.rejects(() => f.admin.$executeRawUnsafe(`TRUNCATE TABLE atlas_staff."${name}" CASCADE`));
        assert.equal(await f.admin.staffPhysicalFinish.count(), 2);
        const audits = await f.admin.staffAudit.findMany({ where: { event: { in: Object.values(events).concat(['ATLAS_ASSEMBLY_CONFIRMED', 'ATLAS_SONIC_WELD_CONFIRMED']) } } });
        assert.equal(audits.length, 5);
    }), OPTIONS);
    await scenario('finishing SQL rejects missing, substituted and orphan audits atomically', context => fixture(context, async f => {
        await assert.rejects(() => f.persist('staffLabelIssue', f.label(), { audit: false }), /same transaction/);
        await assert.rejects(() => f.persist('staffLabelIssue', f.label(), { details: { inputHash: 'f'.repeat(64) } }), /same transaction/);
        const data = f.label();
        await assert.rejects(() => f.admin.$transaction(async tx => { await tx.staffAudit.create({ data: f.auditData('staffLabelIssue', data) });
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; }), /same transaction/);
        assert.equal(await f.admin.staffLabelIssue.count(), 0);
    }), OPTIONS);
    await scenario('finishing SQL rejects rehashed label edits and protocol/domain substitutions', context => fixture(context, async f => {
        const bad = f.label(), value = JSON.parse(bad.labelCanonical); value.grade.overall.displayGrade = value.grade.overall.displayGrade === 10 ? 9 : 10;
        bad.labelCanonical = canonical(value); bad.labelHash = hash(bad.labelCanonical);
        await assert.rejects(() => f.persist('staffLabelIssue', bad), /immutable approved report/);
        const l = await f.persist('staffLabelIssue', f.label());
        for (const [key, value] of [['purpose', 'tenkings-program-url-v1'], ['url', 'https://collect.tenkings.co/nfc/other'], ['nonce', 12345]]) {
            const row = f.job(l), job = JSON.parse(row.jobCanonical); job[key] = value;
            row.jobCanonical = canonical(job); row.jobHash = hash(row.jobCanonical);
            row.jobEnvelopeSha256 = hash(`${JOB_FIELDS.map(k => job[k]).join('\n')}\n${job.signature}`);
            await assert.rejects(() => f.persist('staffNfcJob', row), /ATLAS NFC/);
        }
        assert.equal(await f.admin.staffNfcJob.count(), 0);
    }), OPTIONS);
    await scenario('finishing SQL requires current activation but can verify a retained job across reviewed configuration rotation', context => fixture(context, async f => {
        const l = await f.persist('staffLabelIssue', f.label()), original = f.job(l);
        await f.nfcControl({ configHash: 'd'.repeat(64) });
        await assert.rejects(() => f.persist('staffNfcJob', original), /current enabled control/);
        const j = await f.persist('staffNfcJob', f.job(l));
        await f.nfcControl({ configHash: 'e'.repeat(64) });
        const v = await f.persist('staffNfcVerification', f.verification(j)); assert.notEqual(v.nfcConfigHash, j.nfcConfigHash);
        await f.nfcControl({ enabled: false });
        await assert.rejects(() => f.persist('staffNfcJob', f.job(l)), /current enabled control/);
        assert(await f.persist('staffLabelIssue', f.label()));
    }), OPTIONS);
    await scenario('finishing SQL rejects result readback/lock substitution and duplicate result/job recording', context => fixture(context, async f => {
        const l = await f.persist('staffLabelIssue', f.label()), j = await f.persist('staffNfcJob', f.job(l));
        for (const [key, value] of [['readbackPayloadSha256', 'f'.repeat(64)], ['writeProtectionState', 'locked_claimed'], ['approvalVersion', 2]]) {
            const row = f.verification(j), result = JSON.parse(row.resultCanonical); result[key] = value;
            row.resultCanonical = canonical(result); row.resultHash = hash(row.resultCanonical);
            if (key === 'readbackPayloadSha256') row.readbackPayloadSha256 = value;
            row.inputHash = inputHash('NFC_VERIFIED', f.ready.id, { operationId: row.operationId, jobId: j.id, result });
            await assert.rejects(() => f.persist('staffNfcVerification', row), /exact current job/);
        }
        const row = f.verification(j); await f.persist('staffNfcVerification', row);
        await assert.rejects(() => f.persist('staffNfcVerification', f.verification(j)));
        assert.equal(await f.admin.staffNfcVerification.count(), 1);
    }), OPTIONS);
    await scenario('finishing SQL rejects cross-label assembly and weld without exact prior human assembly', context => fixture(context, async f => {
        const { l, v } = await f.completeNfc(), other = await f.persist('staffLabelIssue', f.label());
        await assert.rejects(() => f.persist('staffPhysicalFinish', f.physical(other, v)), /exact verified label/);
        await assert.rejects(() => f.persist('staffPhysicalFinish', f.physical(l, v, { id: randomUUID() })), /prior human assembly|foreign key/);
        const assembly = await f.persist('staffPhysicalFinish', f.physical(l, v));
        await assert.rejects(() => f.persist('staffPhysicalFinish', f.physical(l, v)), /Unique constraint/);
        await f.persist('staffPhysicalFinish', f.physical(l, v, assembly));
    }), OPTIONS);
    await scenario('finishing deferred SQL guard rejects in-transaction human revocation and preserves earlier receipts', context => fixture(context, async f => {
        const saved = await f.persist('staffLabelIssue', f.label());
        await assert.rejects(() => f.persist('staffLabelIssue', f.label(), { after: tx => tx.staffIdentity.update({ where: { id: f.signed.staff.id },
            data: { accessVersion: { increment: 1 }, revokedAt: new Date() } }) }), /fresh trained human/);
        assert.equal(await f.admin.staffLabelIssue.count(), 1); assert.equal((await f.admin.staffLabelIssue.findUnique({ where: { id: saved.id } })).labelHash, saved.labelHash);
    }), OPTIONS);
    await scenario('finishing SQL preserves historic labels while a changed review blocks all new physical work', context => fixture(context, async f => {
        const { l, v } = await f.completeNfc();
        const current = await f.review.read(f.signed.staff, f.ready.id);
        await f.review.save(f.signed.staff, current.id, { ...readyInput(current), observations: { FRONT: 'New human review revision.', BACK: '' } });
        await assert.rejects(() => f.persist('staffLabelIssue', f.label()), /fresh trained human/);
        await assert.rejects(() => f.persist('staffPhysicalFinish', f.physical(l, v)), /fresh trained human/);
        assert.equal((await f.admin.staffLabelIssue.findUnique({ where: { id: l.id } })).labelCanonical, l.labelCanonical);
    }), OPTIONS);

    await scenario('restricted finishing service signs and verifies exact approved label before separate human assembly and weld', context => serviceFixture(context, async f => {
        const { label, job, saved } = await f.complete();
        assert.equal(label.label.url, job.job.url); assert.equal(job.job.publicHash, f.ap.publicHash);
        assert.equal(saved.receipt.status, 'URL_AND_PERMANENT_LOCK_VERIFIED');
        assert.equal(await f.client.staffPhysicalFinish.count(), 0);
        assert.equal((await f.finishing.read(f.signed.staff, f.ready.id)).stage, 'READY_FOR_ASSEMBLY');
        const assembly = await f.physical(label, saved.receipt), weld = await f.physical(label, saved.receipt, assembly);
        assert.equal(weld.assemblyId, assembly.id); assert.equal(weld.authority, 'HUMAN_CONFIRMATION');
        assert.equal((await f.finishing.read(f.signed.staff, f.ready.id)).stage, 'SONIC_WELD_CONFIRMED');
        const storedJob = await f.client.staffNfcJob.findUnique({ where: { id: job.id } });
        const storedResult = await f.client.staffNfcVerification.findUnique({ where: { id: saved.receipt.id } });
        for (const row of [storedJob, storedResult]) {
            assert.equal(row.nfcConfigHash, f.nfcSettings.configHash); assert(row.nfcControlRevision > 0);
            assert.equal(row.actorId, f.signed.staff.id); assert.equal(row.sessionHash, f.session.tokenHash);
            assert.equal(row.assignmentFence, f.assignment.fence); assert.equal(row.controlRevision, f.control.revision);
        }
        assert.equal(storedResult.jobId, storedJob.id); assert.equal(storedJob.labelIssueId, label.id);
        const auditRows = await f.client.staffAudit.findMany({ where: { event: { in: Object.values(events).concat(['ATLAS_ASSEMBLY_CONFIRMED', 'ATLAS_SONIC_WELD_CONFIRMED']) } } });
        assert.equal(auditRows.length, 5);
        for (const row of [storedJob, storedResult]) {
            const audit = auditRows.find(a => JSON.parse(a.details).recordId === row.id); assert(audit);
            assert.equal(JSON.parse(audit.details).inputHash, row.inputHash);
        }
        assert.deepEqual(await f.finishing.recordNfcVerification(f.signed.staff, f.ready.id, saved.input), saved.receipt);
        await rejectsCode('REQUEST_CONFLICT', () => f.finishing.recordNfcVerification(f.signed.staff, f.ready.id,
            { ...saved.input, result: { ...saved.input.result, signature: Buffer.alloc(64, 1).toString('base64url') } }));
        await rejectsCode('SIGN_IN_REQUIRED', () => f.finishing.issueLabel({ ...f.signed.staff }, f.ready.id, f.issueInput()));
        await assert.rejects(() => f.client.staffNfcControl.update({ where: { id: 'active' }, data: { enabled: false } }));
        assert.equal(await f.client.staffNfcVerification.count(), 1);
    }), OPTIONS);

    await scenario('restricted finishing service retains physical work, exact replay and status recovery after NFC disable', context => serviceFixture(context, async f => {
        const { label, job, saved } = await f.complete(), unrecorded = await f.start(label);
        const unrecordedInput = f.resultInput(unrecorded);
        await f.nfcControl({ enabled: false });
        assert.equal((await f.finishing.read(f.signed.staff, f.ready.id)).nfcConfigured, false);
        await rejectsCode('NFC_NOT_CONFIGURED', () => f.start(label));
        await rejectsCode('NFC_NOT_CONFIGURED', () => f.finishing.recordNfcVerification(f.signed.staff, f.ready.id, unrecordedInput));
        const assembly = await f.physical(label, saved.receipt); await f.physical(label, saved.receipt, assembly);
        assert.deepEqual(await f.finishing.recordNfcVerification(f.signed.staff, f.ready.id, saved.input), saved.receipt);
        const recovery = await f.finishing.retrieveNfcJob(f.signed.staff, f.ready.id, job.id);
        assert.equal(recovery.recoveryOnly, true); assert.deepEqual(recovery.receipt, job); assert.deepEqual(recovery.verification, saved.receipt);
        const empty = await f.finishing.retrieveNfcJob(f.signed.staff, f.ready.id, unrecorded.id);
        assert.equal(empty.recoveryOnly, true); assert.equal(empty.verification, null);
        assert(await f.issue()); assert.equal(await f.client.staffNfcJob.count(), 2);
        assert.equal(await f.client.staffNfcVerification.count(), 1); assert.equal(await f.client.staffPhysicalFinish.count(), 2);
    }), OPTIONS);

    await scenario('restricted historical retrieval stays status only after actual synthetic job expiry and a newer approval', context => serviceFixture(context, async f => {
        const label = await f.issue(), row = await f.client.staffLabelIssue.findUnique({ where: { id: label.id } });
        // Only this expiry fixture uses normal audited SQL insertion of a short
        // protocol-valid job. No clocks, guards or immutable rows are changed.
        const short = await f.persist('staffNfcJob', f.job(row, 2000));
        const original = await f.finishing.retrieveNfcJob(f.signed.staff, f.ready.id, short.id);
        const result = f.resultInput(original.receipt);
        await new Promise(resolve => setTimeout(resolve, Math.max(0, +short.expiresAt - Date.now() + 100)));
        const [{ now }] = await f.client.$queryRaw`SELECT clock_timestamp() AS now`; assert(now > short.expiresAt);
        await rejectsCode('NFC_VERIFICATION_REJECTED', () => f.finishing.recordNfcVerification(f.signed.staff, f.ready.id, result));
        const current = await f.review.read(f.signed.staff, f.ready.id);
        const ready = await f.review.save(f.signed.staff, current.id, { ...readyInput(current), observations: { FRONT: 'Second synthetic approved version.', BACK: '' } });
        const next = await f.reports.approve(f.signed.staff, ready.id, approvalInput(ready));
        assert.notEqual(next.approval.approvalId, f.ap.id);
        const counts = [await f.client.staffNfcJob.count(), await f.client.staffNfcVerification.count(), await f.client.staffAudit.count()];
        const recovered = await f.finishing.retrieveNfcJob(f.signed.staff, f.ready.id, short.id);
        assert.deepEqual(recovered, original); assert.equal(recovered.verification, null); assert.equal(recovered.recoveryOnly, true);
        assert.equal(recovered.receipt.job.approvalId, f.ap.id); assert.equal(recovered.receipt.job.url, label.label.url);
        await rejectsCode('FINISHING_LINKAGE_CHANGED', () => f.finishing.recordNfcVerification(f.signed.staff, f.ready.id, result));
        await rejectsCode('APPROVAL_CHANGED', () => f.start(label));
        assert.deepEqual([await f.client.staffNfcJob.count(), await f.client.staffNfcVerification.count(), await f.client.staffAudit.count()], counts);
    }), OPTIONS);

    await scenario('restricted finishing service rejects active NFC configuration drift and records restored control revision', context => serviceFixture(context, async f => {
        const label = await f.issue(), job = await f.start(label), result = f.resultInput(job);
        const original = await f.admin.staffNfcControl.findUnique({ where: { id: 'active' } });
        for (const change of [{ configHash: 'a'.repeat(64) }, { signingKeyHash: 'b'.repeat(64) }, { trustHash: 'c'.repeat(64) },
            { deploymentId: 'other-synthetic' }, { releaseSha: 'd'.repeat(40) }, { mode: 'PRODUCTION', origin: 'https://app.atlasgrading.com' }]) {
            await f.nfcControl(change);
            assert.equal((await f.finishing.read(f.signed.staff, f.ready.id)).nfcConfigured, false);
            await rejectsCode('NFC_NOT_CONFIGURED', () => f.start(label));
            await rejectsCode('NFC_NOT_CONFIGURED', () => f.finishing.recordNfcVerification(f.signed.staff, f.ready.id, result));
            await f.nfcControl(Object.fromEntries(Object.keys(change).map(key => [key, original[key]])));
        }
        const active = await f.admin.staffNfcControl.findUnique({ where: { id: 'active' } });
        const saved = await f.finishing.recordNfcVerification(f.signed.staff, f.ready.id, result);
        const stored = await f.client.staffNfcVerification.findUnique({ where: { id: saved.id } });
        assert.equal(stored.nfcControlRevision, active.revision); assert(stored.nfcControlRevision > original.revision);
        assert.equal(stored.nfcConfigHash, original.configHash); assert.equal(await f.client.staffNfcJob.count(), 1);
    }), OPTIONS);

    for (const [name, change] of [['role', { role: 'OBSERVER' }], ['training', { certificationUntil: null }]]) {
        await scenario(`restricted finishing service rechecks current ${name} for new work, replay and recovery`, context => serviceFixture(context, async f => {
            const { label, job, saved } = await f.complete();
            // The fixture owner changes the current roster with its required
            // accessVersion bump; the service is still the restricted client.
            await f.admin.staffIdentity.update({ where: { id: f.signed.staff.id }, data: { ...change, accessVersion: { increment: 1 } } });
            await rejectsCode('SIGN_IN_REQUIRED', () => f.finishing.retrieveNfcJob(f.signed.staff, f.ready.id, job.id));
            await rejectsCode('SIGN_IN_REQUIRED', () => f.finishing.recordNfcVerification(f.signed.staff, f.ready.id, saved.input));
            const fresh = await f.login();
            assert.equal((await f.finishing.read(fresh.staff, f.ready.id)).mutationBlock, 'TRAINED_REVIEWER_REQUIRED');
            const actions = [
                () => f.finishing.issueLabel(fresh.staff, f.ready.id, f.issueInput()),
                () => f.finishing.createNfcJob(fresh.staff, f.ready.id, f.startInput(label)),
                () => f.finishing.recordNfcVerification(fresh.staff, f.ready.id, saved.input),
                () => f.finishing.recordPhysical(fresh.staff, f.ready.id, f.physicalInput(label, saved.receipt)),
                () => f.finishing.retrieveNfcJob(fresh.staff, f.ready.id, job.id),
            ];
            for (const action of actions) await rejectsCode('TRAINED_REVIEWER_REQUIRED', action);
            assert.equal(await f.client.staffLabelIssue.count(), 1); assert.equal(await f.client.staffNfcJob.count(), 1);
            assert.equal(await f.client.staffNfcVerification.count(), 1); assert.equal(await f.client.staffPhysicalFinish.count(), 0);
        }), OPTIONS);
    }
}
