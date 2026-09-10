import { randomUUID } from 'node:crypto';
import { parsePublicReport } from '@atlas/report-view/public-contract';
import { ATLAS_NFC, atlasReportUrl, signNfcJob, verifyNfcJob, verifyNfcResult, validateNfcTrust,
    validateApprovedReportBinding, nfcJobEnvelopeSha256, canonicalNfcResult } from '@atlas/finishing/nfc';
import { deny, hash, identifier, strictObject } from '../policy.mjs';
import { canonical } from '../review-contract.mjs';
import { operatorPending } from './operator.mjs';

const digest = value => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) deny(400, 'INVALID_REQUEST'); };
const uuid = value => { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) deny(400, 'INVALID_REQUEST'); };
const stamped = row => ({ id: row.id, approvalId: row.approvalId, createdAt: row.createdAt.toISOString() });
const expectedFields = ['operationId', 'approvalId', 'approvalVersion', 'publicHash'];
function expected(input, extra = []) {
    strictObject(input, [...expectedFields, ...extra]); identifier(input.operationId); uuid(input.approvalId); digest(input.publicHash);
    if (!Number.isSafeInteger(input.approvalVersion) || input.approvalVersion < 1 || input.approvalVersion > 2147483647) deny(400, 'INVALID_REQUEST');
}
function checked(text, digestValue) {
    if (typeof text !== 'string' || hash(text) !== digestValue) deny(503, 'FINISHING_RECORD_UNAVAILABLE');
    let parsed; try { parsed = JSON.parse(text); } catch { deny(503, 'FINISHING_RECORD_UNAVAILABLE'); }
    if (canonical(parsed) !== text) deny(503, 'FINISHING_RECORD_UNAVAILABLE');
    return parsed;
}
function binding(card, approval, publication) {
    try { return validateApprovedReportBinding({ specimenId: card.id, approvalId: approval.id, approvalVersion: approval.version,
        publicToken: publication.publicToken, publicHash: approval.publicHash }); }
    catch { deny(503, 'APPROVED_REPORT_UNAVAILABLE'); }
}
function humanBlock(context, assignment) {
    if (context.identity.role !== 'REVIEWER' || !assignment.canReview || !context.identity.certificationUntil
        || context.identity.certificationUntil <= context.now) return 'TRAINED_REVIEWER_REQUIRED';
    if (!(context.session.createdAt instanceof Date) || +context.session.createdAt > +context.now
        || +context.session.createdAt + 15 * 60_000 <= +context.now) return 'FRESH_SIGN_IN_REQUIRED';
    return null;
}
function sameExpected(input, current) {
    if (input.approvalId !== current.approval.id || input.approvalVersion !== current.approval.version || input.publicHash !== current.approval.publicHash)
        deny(409, 'APPROVAL_CHANGED');
}
function sameRow(row, cardId, approvalId) {
    if (!row || row.specimenId !== cardId || row.approvalId !== approvalId) deny(409, 'FINISHING_LINKAGE_CHANGED');
}

// Runtime receives only the server-owned config; browser actor fields are never accepted.
// All writes and audit rows compose inside auth.withStaff's guarded DB transaction.
export class StaffFinishing {
    constructor({ auth, review, nfc = null }) { this.auth = auth; this.review = review; this.nfc = nfc; }
    async scope(context, cardId, mutation = false) {
        const assignment = await this.review.assigned(context, cardId);
        if (mutation) { const blocked = humanBlock(context, assignment); if (blocked) deny(403, blocked); }
        const rows = await context.tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${cardId}::uuid FOR UPDATE`;
        const card = rows[0]; if (!card) deny(404, 'CARD_NOT_FOUND');
        return { card, assignment };
    }
    async approval(context, card, requireCurrent = true) {
        const publication = await context.tx.staffPublicReport.findUnique({ where: { specimenId: card.id } });
        const approval = publication ? await context.tx.staffReportApproval.findUnique({ where: { id: publication.currentApprovalId } }) : null;
        if (!approval || approval.specimenId !== card.id) {
            if (requireCurrent) deny(409, 'APPROVED_REPORT_REQUIRED');
            return null;
        }
        const packet = checked(approval.publicCanonical, approval.publicHash);
        try { parsePublicReport(packet); } catch { deny(503, 'APPROVED_REPORT_UNAVAILABLE'); }
        if (packet.publicToken !== publication.publicToken || packet.reportNumber !== publication.reportNumber
            || packet.approvalVersion !== approval.version || packet.evidenceHash !== approval.evidenceHash
            || packet.analysisHash !== approval.analysisHash || packet.approvedAt !== approval.approvedAt.toISOString()
            || packet.mode !== context.control.mode) deny(503, 'APPROVED_REPORT_UNAVAILABLE');
        const matchesCurrent = approval.analysisRevision === card.analysisRevision && approval.reviewRevision === card.draftRevision
            && approval.evidenceHash === card.evidenceHash;
        if (requireCurrent && !matchesCurrent) deny(409, 'APPROVAL_CHANGED');
        return { publication, approval, packet, approvedReport: binding(card, approval, publication), matchesCurrent };
    }
    async requireSettled(context, card) {
        if (await context.tx.staffGradingOperation.count({ where: { specimenId: card.id, state: { in: ['RESERVED', 'DISPATCHED', 'UNKNOWN'] } } })
            || await operatorPending(context.tx, card.id)) deny(409, 'GRADING_WORK_UNRESOLVED');
    }
    authority(context, assignment, cardId, approvalId, input, kind) {
        return { id: randomUUID(), specimenId: cardId, approvalId, actorId: context.identity.id,
            sessionHash: context.session.tokenHash, accessVersion: context.identity.accessVersion, assignmentFence: assignment.fence,
            controlRevision: context.control.revision, operationId: input.operationId,
            inputHash: hash(canonical({ kind, cardId, input })), createdAt: context.now };
    }
    async prior(model, context, cardId, input, kind) {
        const prior = await model.findUnique({ where: { actorId_operationId: { actorId: context.identity.id, operationId: input.operationId } } });
        if (prior && (prior.specimenId !== cardId || prior.inputHash !== hash(canonical({ kind, cardId, input })))) deny(409, 'REQUEST_CONFLICT');
        return prior;
    }
    async nfcConfig(context, required = true) {
        // The lock is retained through the same guarded transaction and insert.
        // Runtime settings alone never authorize a new signing/verification fact.
        const controls = await context.tx.$queryRaw`SELECT * FROM atlas_staff.lock_nfc_control()`;
        const control = controls[0];
        let config;
        try { config = typeof this.nfc === 'function' ? await this.nfc() : this.nfc; }
        catch (error) { if (error.code !== 'NFC_NOT_CONFIGURED') throw error; }
        let available = controls.length === 1 && control?.id === 'active' && control.enabled === true && config?.enabled === true
            && Number.isSafeInteger(control.revision) && control.revision > 0 && typeof config.privateKeyPem === 'string'
            && ['mode', 'origin', 'deploymentId', 'releaseSha'].every(key => config[key] === context.control[key])
            && ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash', 'signingKeyHash', 'trustHash'].every(key => typeof config[key] === 'string' && config[key] === control[key])
            && ['configHash', 'signingKeyHash', 'trustHash'].every(key => /^[a-f0-9]{64}$/.test(config[key]));
        if (available) {
            try {
                validateNfcTrust(config.trust);
                const trustHash = hash(canonical({ schemaVersion: config.trust.schemaVersion,
                    serverKeys: [...config.trust.serverKeys].sort((a, b) => a.keyId.localeCompare(b.keyId)),
                    workstationKeys: [...config.trust.workstationKeys].sort((a, b) => a.keyId.localeCompare(b.keyId)) }));
                const signer = config.trust.serverKeys.find(key => key.keyId === config.signingKeyHash);
                available = Boolean(signer) && trustHash === config.trustHash && hash(canonical({ version: 'atlas-approved-finishing-config-v1',
                    purpose: ATLAS_NFC.purpose, mode: config.mode, origin: config.origin, deploymentId: config.deploymentId,
                    releaseSha: config.releaseSha, signingKeyHash: config.signingKeyHash, publicSpkiDerBase64: signer.publicSpkiDerBase64,
                    trustHash })) === config.configHash;
            } catch { available = false; }
        }
        if (!available) { if (required) deny(503, 'NFC_NOT_CONFIGURED'); return null; }
        return { ...config, nfcControlRevision: control.revision };
    }
    labelReceipt(row) {
        const label = checked(row.labelCanonical, row.labelHash);
        try { strictObject(label, ['version', 'labelIssueId', 'mode', 'specimenId', 'approvalId', 'approvalVersion', 'publicToken', 'publicHash', 'reportNumber', 'url', 'cardProfile', 'identity', 'grade']);
            validateApprovedReportBinding({ specimenId: label.specimenId, approvalId: label.approvalId, approvalVersion: label.approvalVersion,
                publicToken: label.publicToken, publicHash: label.publicHash }); }
        catch { deny(503, 'FINISHING_RECORD_UNAVAILABLE'); }
        if (label.version !== 'atlas-approved-slab-label-v1' || label.labelIssueId !== row.id || label.specimenId !== row.specimenId || label.approvalId !== row.approvalId
            || label.url !== atlasReportUrl(label.publicToken, label.approvalVersion)) deny(503, 'FINISHING_RECORD_UNAVAILABLE');
        return { ...stamped(row), labelHash: row.labelHash, label, status: 'READY_TO_PRINT' };
    }
    requireLabel(row, current) {
        const { label } = this.labelReceipt(row);
        if (canonical(label) !== canonical({ version: 'atlas-approved-slab-label-v1', labelIssueId: row.id, mode: current.packet.mode,
            ...current.approvedReport, reportNumber: current.publication.reportNumber,
            url: atlasReportUrl(current.publication.publicToken, current.approval.version), cardProfile: current.packet.report.cardProfile,
            identity: current.packet.report.identity, grade: current.packet.report.grade })) deny(503, 'FINISHING_RECORD_UNAVAILABLE');
    }
    jobReceipt(row, includeJob = false) {
        const job = checked(row.jobCanonical, row.jobHash);
        if (nfcJobEnvelopeSha256(job) !== row.jobEnvelopeSha256 || hash(canonical({ specimenId: job.specimenId, approvalId: job.approvalId,
            approvalVersion: job.approvalVersion, publicToken: job.publicToken, publicHash: job.publicHash })) !== row.bindingHash
            || job.specimenId !== row.specimenId || job.approvalId !== row.approvalId || job.expiresAt !== row.expiresAt.toISOString()) deny(503, 'FINISHING_RECORD_UNAVAILABLE');
        return { ...stamped(row), labelIssueId: row.labelIssueId, jobHash: row.jobHash, jobEnvelopeSha256: row.jobEnvelopeSha256,
            bindingHash: row.bindingHash, expiresAt: row.expiresAt.toISOString(), ...(includeJob ? { job } : {}) };
    }
    verificationReceipt(row) {
        const result = checked(row.resultCanonical, row.resultHash);
        try { canonicalNfcResult(result); } catch { deny(503, 'FINISHING_RECORD_UNAVAILABLE'); }
        if (result.specimenId !== row.specimenId || result.approvalId !== row.approvalId || result.workstationKeyId !== row.workstationKeyId
            || result.readbackPayloadSha256 !== row.readbackPayloadSha256 || result.observedAt !== row.observedAt.toISOString()) deny(503, 'FINISHING_RECORD_UNAVAILABLE');
        return { ...stamped(row), jobId: row.jobId, resultHash: row.resultHash, status: 'URL_AND_PERMANENT_LOCK_VERIFIED', observedAt: row.observedAt.toISOString() };
    }
    physicalReceipt(row) { return { ...stamped(row), labelIssueId: row.labelIssueId, verificationId: row.verificationId,
        stage: row.stage, assemblyId: row.assemblyId, physicalConfirmedAt: row.physicalConfirmedAt.toISOString(), authority: 'HUMAN_CONFIRMATION' }; }
    async audit(context, event, row) {
        await this.auth.audit(context.tx, event, row.specimenId, context.identity.id,
            { recordId: row.id, approvalId: row.approvalId, operationId: row.operationId, inputHash: row.inputHash, assignmentFence: row.assignmentFence });
    }
    async read(staff, cardId) {
        return this.auth.withStaff(staff, async context => {
            const { card, assignment } = await this.scope(context, cardId);
            const current = await this.approval(context, card, false);
            const [labels, jobs, verifications, physical] = await Promise.all([
                context.tx.staffLabelIssue.findMany({ where: { specimenId: cardId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51 }),
                context.tx.staffNfcJob.findMany({ where: { specimenId: cardId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51 }),
                context.tx.staffNfcVerification.findMany({ where: { specimenId: cardId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51 }),
                context.tx.staffPhysicalFinish.findMany({ where: { specimenId: cardId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51 }),
            ]);
            const pending = await context.tx.staffGradingOperation.count({ where: { specimenId: cardId, state: { in: ['RESERVED', 'DISPATCHED', 'UNKNOWN'] } } }) + await operatorPending(context.tx, cardId);
            const approvalId = current?.approval.id;
            const latestLabel = labels.find(row => row.approvalId === approvalId);
            const currentJobs = jobs.filter(row => row.approvalId === approvalId && row.labelIssueId === latestLabel?.id);
            const verified = verifications.find(row => currentJobs.some(job => job.id === row.jobId));
            const assembled = physical.find(row => row.labelIssueId === latestLabel?.id && row.verificationId === verified?.id && row.stage === 'ASSEMBLED');
            const welded = physical.find(row => row.assemblyId === assembled?.id && row.stage === 'SONIC_WELDED' && assembled);
            const mutationBlock = !current ? 'APPROVED_REPORT_REQUIRED' : !current.matchesCurrent ? 'APPROVAL_CHANGED'
                : pending ? 'GRADING_WORK_UNRESOLVED' : humanBlock(context, assignment);
            return { specimenId: cardId, mutationBlock, nfcConfigured: Boolean(await this.nfcConfig(context, false)),
                approved: current ? { ...current.approvedReport, reportNumber: current.publication.reportNumber,
                    url: atlasReportUrl(current.publication.publicToken, current.approval.version), matchesCurrent: current.matchesCurrent } : null,
                stage: mutationBlock === 'APPROVED_REPORT_REQUIRED' || mutationBlock === 'APPROVAL_CHANGED' ? 'AWAITING_APPROVAL'
                    : welded ? 'SONIC_WELD_CONFIRMED' : assembled ? 'ASSEMBLY_CONFIRMED' : verified ? 'READY_FOR_ASSEMBLY' : latestLabel ? 'LABEL_READY_FOR_PRINT_AND_NFC' : 'READY_FOR_LABEL',
                labels: labels.slice(0, 50).map(row => this.labelReceipt(row)), jobs: jobs.slice(0, 50).map(row => ({ ...this.jobReceipt(row), expired: row.expiresAt <= context.now })),
                verifications: verifications.slice(0, 50).map(row => this.verificationReceipt(row)), physical: physical.slice(0, 50).map(row => this.physicalReceipt(row)),
                olderHistoryAvailable: [labels, jobs, verifications, physical].some(rows => rows.length > 50) };
        });
    }
    async retrieveNfcJob(staff, cardId, jobId) {
        uuid(cardId); uuid(jobId);
        return this.auth.withStaff(staff, async context => {
            // This port restores an immutable historical operation for status and
            // cleanup. It grants no fresh encoding, current approval or signer authority.
            const { card } = await this.scope(context, cardId, true);
            const row = await context.tx.staffNfcJob.findUnique({ where: { id: jobId } });
            if (!row || row.specimenId !== cardId) deny(404, 'NFC_JOB_NOT_FOUND');
            const publication = await context.tx.staffPublicReport.findUnique({ where: { specimenId: cardId } });
            const approval = await context.tx.staffReportApproval.findUnique({ where: { id: row.approvalId } });
            if (!approval || approval.specimenId !== cardId || approval.id !== row.approvalId) deny(409, 'FINISHING_LINKAGE_CHANGED');
            const packet = checked(approval.publicCanonical, approval.publicHash);
            try { parsePublicReport(packet); } catch { deny(503, 'APPROVED_REPORT_UNAVAILABLE'); }
            if (!publication || packet.publicToken !== publication.publicToken || packet.reportNumber !== publication.reportNumber
                || packet.approvalVersion !== approval.version || packet.evidenceHash !== approval.evidenceHash
                || packet.analysisHash !== approval.analysisHash || packet.approvedAt !== approval.approvedAt.toISOString()
                || packet.mode !== context.control.mode) deny(503, 'APPROVED_REPORT_UNAVAILABLE');
            const approvedReport = binding(card, approval, publication);
            const label = await context.tx.staffLabelIssue.findUnique({ where: { id: row.labelIssueId } });
            sameRow(label, cardId, approval.id); this.requireLabel(label, { approval, publication, packet, approvedReport });
            let receipt; try { receipt = this.jobReceipt(row, true); } catch { deny(503, 'FINISHING_RECORD_UNAVAILABLE'); }
            if (Object.keys(approvedReport).some(key => receipt.job[key] !== approvedReport[key])) deny(503, 'FINISHING_RECORD_UNAVAILABLE');
            const saved = await context.tx.staffNfcVerification.findUnique({ where: { jobId } });
            let verification = null;
            if (saved) {
                sameRow(saved, cardId, approval.id); verification = this.verificationReceipt(saved);
                const result = checked(saved.resultCanonical, saved.resultHash);
                if (Object.keys(approvedReport).some(key => result[key] !== approvedReport[key])
                    || result.jobEnvelopeSha256 !== receipt.jobEnvelopeSha256 || result.nonce !== receipt.job.nonce
                    || result.url !== receipt.job.url || result.readbackPayloadSha256 !== hash(receipt.job.url)) deny(503, 'FINISHING_RECORD_UNAVAILABLE');
            }
            return { receipt, recoveryOnly: true, verification };
        });
    }
    async issueLabel(staff, cardId, input) {
        expected(input);
        return this.auth.withStaff(staff, async context => {
            const { card, assignment } = await this.scope(context, cardId, true);
            const prior = await this.prior(context.tx.staffLabelIssue, context, cardId, input, 'LABEL');
            if (prior) return this.labelReceipt(prior);
            const current = await this.approval(context, card); sameExpected(input, current); await this.requireSettled(context, card);
            const data = this.authority(context, assignment, cardId, current.approval.id, input, 'LABEL');
            const label = { version: 'atlas-approved-slab-label-v1', labelIssueId: data.id, mode: current.packet.mode,
                ...current.approvedReport, reportNumber: current.publication.reportNumber,
                url: atlasReportUrl(current.publication.publicToken, current.approval.version), cardProfile: current.packet.report.cardProfile,
                identity: current.packet.report.identity, grade: current.packet.report.grade };
            const labelCanonical = canonical(label);
            const row = await context.tx.staffLabelIssue.create({ data: { ...data, labelCanonical, labelHash: hash(labelCanonical) } });
            await this.audit(context, 'ATLAS_LABEL_ISSUED', row); return this.labelReceipt(row);
        });
    }
    async createNfcJob(staff, cardId, input) {
        expected(input, ['labelIssueId']); uuid(input.labelIssueId);
        return this.auth.withStaff(staff, async context => {
            const { card, assignment } = await this.scope(context, cardId, true);
            const prior = await this.prior(context.tx.staffNfcJob, context, cardId, input, 'NFC_JOB');
            const current = await this.approval(context, card); sameExpected(input, current);
            if (prior) { sameRow(prior, cardId, current.approval.id); return this.jobReceipt(prior, true); }
            await this.requireSettled(context, card);
            const label = await context.tx.staffLabelIssue.findUnique({ where: { id: input.labelIssueId } });
            sameRow(label, cardId, current.approval.id); this.requireLabel(label, current);
            const config = await this.nfcConfig(context);
            let job;
            try { job = signNfcJob({ approvedReport: current.approvedReport, privateKeyPem: config.privateKeyPem, now: context.now });
                verifyNfcJob({ job, trust: config.trust, now: context.now });
                if (job.signingKeyId !== config.signingKeyHash) deny(503, 'NFC_NOT_CONFIGURED'); }
            catch { deny(503, 'NFC_NOT_CONFIGURED'); }
            const jobCanonical = canonical(job);
            const row = await context.tx.staffNfcJob.create({ data: { ...this.authority(context, assignment, cardId, current.approval.id, input, 'NFC_JOB'),
                labelIssueId: label.id, jobCanonical, jobHash: hash(jobCanonical), jobEnvelopeSha256: nfcJobEnvelopeSha256(job),
                bindingHash: hash(canonical(current.approvedReport)), expiresAt: new Date(job.expiresAt),
                nfcConfigHash: config.configHash, nfcControlRevision: config.nfcControlRevision } });
            await this.audit(context, 'ATLAS_NFC_JOB_ISSUED', row); return this.jobReceipt(row, true);
        });
    }
    async recordNfcVerification(staff, cardId, input) {
        strictObject(input, ['operationId', 'jobId', 'result']); identifier(input.operationId); uuid(input.jobId);
        try { canonicalNfcResult(input.result); } catch { deny(400, 'NFC_RESULT_INVALID'); }
        return this.auth.withStaff(staff, async context => {
            const { card, assignment } = await this.scope(context, cardId, true);
            const prior = await this.prior(context.tx.staffNfcVerification, context, cardId, input, 'NFC_VERIFIED');
            if (prior) return this.verificationReceipt(prior); // Durable exact success survives job expiry; auth remains fresh.
            const existing = await context.tx.staffNfcVerification.findUnique({ where: { jobId: input.jobId } });
            if (existing) deny(409, 'NFC_JOB_ALREADY_RECORDED'); // No substituted result, actor or operation may reuse the job.
            const current = await this.approval(context, card); await this.requireSettled(context, card);
            const jobRow = await context.tx.staffNfcJob.findUnique({ where: { id: input.jobId } });
            sameRow(jobRow, cardId, current.approval.id);
            const { job } = this.jobReceipt(jobRow, true);
            const label = await context.tx.staffLabelIssue.findUnique({ where: { id: jobRow.labelIssueId } });
            sameRow(label, cardId, current.approval.id); this.requireLabel(label, current);
            const config = await this.nfcConfig(context);
            let result;
            try { result = verifyNfcResult({ job, result: input.result, approvedReport: current.approvedReport, trust: config.trust, now: context.now }); }
            catch { deny(409, 'NFC_VERIFICATION_REJECTED'); }
            const resultCanonical = canonical(result);
            const row = await context.tx.staffNfcVerification.create({ data: { ...this.authority(context, assignment, cardId, current.approval.id, input, 'NFC_VERIFIED'),
                jobId: jobRow.id, resultCanonical, resultHash: hash(resultCanonical), readbackPayloadSha256: result.readbackPayloadSha256,
                workstationKeyId: result.workstationKeyId, observedAt: new Date(result.observedAt),
                nfcConfigHash: config.configHash, nfcControlRevision: config.nfcControlRevision } });
            await this.audit(context, 'ATLAS_NFC_VERIFIED', row); return this.verificationReceipt(row);
        });
    }
    async recordPhysical(staff, cardId, input) {
        expected(input, ['labelIssueId', 'verificationId', 'stage', 'assemblyId', 'humanConfirmed']); uuid(input.labelIssueId); uuid(input.verificationId);
        if (input.humanConfirmed !== true || !['ASSEMBLED', 'SONIC_WELDED'].includes(input.stage)
            || input.stage === 'ASSEMBLED' && input.assemblyId !== null) deny(400, 'PHYSICAL_CONFIRMATION_REQUIRED');
        if (input.stage === 'SONIC_WELDED') uuid(input.assemblyId);
        return this.auth.withStaff(staff, async context => {
            const { card, assignment } = await this.scope(context, cardId, true);
            const prior = await this.prior(context.tx.staffPhysicalFinish, context, cardId, input, 'PHYSICAL');
            if (prior) return this.physicalReceipt(prior);
            const current = await this.approval(context, card); sameExpected(input, current); await this.requireSettled(context, card);
            const label = await context.tx.staffLabelIssue.findUnique({ where: { id: input.labelIssueId } });
            const verification = await context.tx.staffNfcVerification.findUnique({ where: { id: input.verificationId } });
            sameRow(label, cardId, current.approval.id); sameRow(verification, cardId, current.approval.id);
            this.requireLabel(label, current); this.verificationReceipt(verification);
            const job = await context.tx.staffNfcJob.findUnique({ where: { id: verification.jobId } });
            sameRow(job, cardId, current.approval.id); this.jobReceipt(job);
            const retainedResult = checked(verification.resultCanonical, verification.resultHash);
            const retainedJob = checked(job.jobCanonical, job.jobHash);
            if (job.labelIssueId !== label.id || retainedResult.jobEnvelopeSha256 !== job.jobEnvelopeSha256
                || retainedResult.nonce !== retainedJob.nonce || retainedResult.url !== retainedJob.url
                || retainedResult.readbackPayloadSha256 !== hash(retainedJob.url)
                || Object.keys(current.approvedReport).some(key => retainedResult[key] !== current.approvedReport[key] || retainedJob[key] !== current.approvedReport[key]))
                deny(409, 'FINISHING_LINKAGE_CHANGED');
            const duplicate = await context.tx.staffPhysicalFinish.findUnique({ where: { labelIssueId_verificationId_stage:
                { labelIssueId: label.id, verificationId: verification.id, stage: input.stage } } });
            if (duplicate) deny(409, 'PHYSICAL_FACT_ALREADY_RECORDED');
            if (input.stage === 'SONIC_WELDED') {
                const assembly = await context.tx.staffPhysicalFinish.findUnique({ where: { id: input.assemblyId } });
                sameRow(assembly, cardId, current.approval.id);
                if (assembly.stage !== 'ASSEMBLED' || assembly.labelIssueId !== label.id || assembly.verificationId !== verification.id
                    || assembly.physicalConfirmedAt > context.now) deny(409, 'ASSEMBLY_CONFIRMATION_REQUIRED');
            }
            const row = await context.tx.staffPhysicalFinish.create({ data: { ...this.authority(context, assignment, cardId, current.approval.id, input, 'PHYSICAL'),
                labelIssueId: label.id, verificationId: verification.id, stage: input.stage, assemblyId: input.assemblyId, physicalConfirmedAt: context.now } });
            await this.audit(context, input.stage === 'ASSEMBLED' ? 'ATLAS_ASSEMBLY_CONFIRMED' : 'ATLAS_SONIC_WELD_CONFIRMED', row);
            return this.physicalReceipt(row);
        });
    }
}
