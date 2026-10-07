import { randomUUID } from 'node:crypto';
import { parsePilotPolicy } from '@atlas/service-bridge/protocol';
import { canonical } from '../review-contract.mjs';
import { deny, hash, identifier, strictObject } from '../policy.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const check = (condition, code = 'OPERATIONS_REQUEST_INVALID', status = 400) => { if (!condition) deny(status, code); };
const uuid = value => { check(typeof value === 'string' && UUID.test(value)); return value; };
const digest = value => { check(typeof value === 'string' && SHA.test(value)); return value; };
const text = (value, max) => check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value));
const revision = value => check(Number.isSafeInteger(value) && value > 0 && value < 2147483647);
const date = value => {
    check(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
    return new Date(value);
};
const money = value => { check(typeof value === 'string' && /^(0|[1-9]\d{0,12})$/.test(value) && BigInt(value) <= 1_000_000_000_000n); return BigInt(value); };
const checked = (body, expected, limit) => {
    check(typeof body === 'string' && Buffer.byteLength(body) <= limit && hash(body) === expected, 'OPERATIONS_EVIDENCE_INVALID', 409);
    let value; try { value = JSON.parse(body); } catch { check(false, 'OPERATIONS_EVIDENCE_INVALID', 409); }
    check(canonical(value) === body, 'OPERATIONS_EVIDENCE_INVALID', 409); return value;
};
// Summaries never load model image bodies or opaque provider conversation state.
const select = fields => Object.freeze(Object.fromEntries(fields.split(' ').map(key => [key, true])));
const WORKER_COST = select('operationId claimId pilotId reservedMicroUsd actualMicroUsd costEvidenceHash state');
const ASTRA_COST = select('id runId requestHash dispatchClaimId reservedMicroUsd actualMicroUsd costEvidenceHash state usageCeilingMicroUsd usageEnvelopeExceeded dispatchedAt');
const WORKER_PARENT = select('id specimenId inputHash');
const RUN_PARENT = select('id specimenId pilotId state revision');

/**
 * Inactive service, deliberately without a DB client, route, credentials or runtime fallback.
 * admin.transaction(staff, work) must authenticate an opaque server staff handle, lock
 * current identity/session/operations grant + the common atlas-staff-access-v1 gate,
 * verify the exact restricted operations DB role, and flush deferred constraints.
 * It supplies {tx, now, control, identity, session, actorKind:'HUMAN',
 * capability:'OPERATIONS', capabilityUntil}. It must never trust browser actor fields.
 * sourceValidation.inspect(context, exactSource) is a DB-only, read-only port: hold
 * source/preparation locks until commit, verify owner, captured state, preservation
 * and admission receipts, then derive descriptors from that source. No HTTP/storage
 * or worker call belongs inside this transaction. Missing ports fail closed.
 */
export class StaffOperations {
    constructor({ admin, sourceValidation }) {
        check(typeof admin?.transaction === 'function', 'OPERATIONS_NOT_CONFIGURED', 503);
        this.admin = admin; this.sourceValidation = sourceValidation;
    }
    transaction(staff, work) {
        return this.admin.transaction(staff, async context => {
            const { identity: i, session: s, now, control } = context;
            check(context.actorKind === 'HUMAN' && context.capability === 'OPERATIONS'
                && now instanceof Date && Number.isFinite(+now) && context.capabilityUntil instanceof Date
                && context.capabilityUntil > now && i && !i.revokedAt && ['REVIEWER', 'OBSERVER'].includes(i.role)
                && s && !s.revokedAt && s.identityId === i.id && s.accessVersion === i.accessVersion
                && s.createdAt instanceof Date && s.createdAt <= now && +now - +s.createdAt <= 300_000
                && s.expiresAt instanceof Date && s.expiresAt > now && control?.enabled
                && s.controlRevision === control.revision && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(control.mode),
                'FRESH_HUMAN_OPERATIONS_REQUIRED', 403);
            uuid(i.id); digest(s.tokenHash); uuid(context.operationsGrantId);
            return work(context);
        });
    }
    async mutation(staff, event, subjectId, input, work) {
        identifier(input.operationId); text(input.reason, 500); digest(input.authorizationEvidenceHash);
        const inputHash = hash(canonical(input));
        return this.transaction(staff, async context => {
            // Stable audit PK plus the common transaction lock gives idempotency
            // without a second operation framework or mutable recovery table.
            const bytes = hash(canonical({ actorId: context.identity.id, operationId: input.operationId }));
            const auditId = `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-4${bytes.slice(13, 16)}-8${bytes.slice(17, 20)}-${bytes.slice(20, 32)}`;
            const prior = await context.tx.staffAudit.findUnique({ where: { id: auditId } });
            if (prior) {
                const details = JSON.parse(prior.details);
                check(prior.actorId === context.identity.id && prior.event === event && prior.subjectId === subjectId
                    && details.inputHash === inputHash, 'OPERATIONS_REQUEST_CONFLICT', 409);
                return details.receipt;
            }
            const { receipt, evidence = {} } = await work(context);
            const details = canonical({ version: 'atlas-human-operations-v1', operationId: input.operationId, inputHash,
                operationsGrantId: context.operationsGrantId,
                reason: input.reason, authorizationEvidenceHash: input.authorizationEvidenceHash,
                accessVersion: context.identity.accessVersion, sessionHash: context.session.tokenHash,
                controlRevision: context.control.revision, receipt, ...evidence });
            check(Buffer.byteLength(details) <= 16_384, 'OPERATIONS_AUDIT_TOO_LARGE');
            await context.tx.staffAudit.create({ data: { id: auditId, event, subjectId,
                actorId: context.identity.id, details, createdAt: context.now } });
            return receipt;
        });
    }
    async source(context, input) {
        strictObject(input, ['sourceType', 'sourceId', 'sourceOwnerId']);
        check(input.sourceType === (context.control.mode === 'PRODUCTION' ? 'SPEEDSTER' : 'LOCAL_FIXTURE'));
        text(input.sourceId, 128); text(input.sourceOwnerId, 128);
        check(typeof this.sourceValidation?.inspect === 'function', 'INTAKE_SOURCE_VALIDATOR_REQUIRED', 503);
        const row = await this.sourceValidation.inspect(context, { ...input });
        check(row && ['sourceType', 'sourceId', 'sourceOwnerId'].every(key => row[key] === input[key]), 'INTAKE_SOURCE_CHANGED', 409);
        text(row.title, 200); text(row.subtitle, 300); text(row.sourceRevision, 80);
        const evidence = checked(row.evidenceCanonical, row.evidenceHash, 131_072);
        const admission = checked(row.admissionCanonical, row.admissionHash, 8192);
        check(evidence.sourceRevision === row.sourceRevision && admission && typeof admission === 'object'
            && !Array.isArray(admission), 'INTAKE_SOURCE_CHANGED', 409);
        check(evidence.sides && ['FRONT', 'BACK'].every(side => {
            const d = evidence.sides[side];
            return d && SHA.test(d.sha256 ?? '') && Number.isSafeInteger(d.byteCount) && d.byteCount > 0
                && d.byteCount <= 50 * 1024 * 1024 && Number.isSafeInteger(d.width) && d.width > 0
                && Number.isSafeInteger(d.height) && d.height > 0 && typeof d.sourceRef === 'string'
                && d.sourceRef.length > 0 && d.sourceRef.length <= 2048
                && ['image/jpeg', 'image/png', 'image/webp', ...(input.sourceType === 'LOCAL_FIXTURE' ? ['image/svg+xml'] : [])].includes(d.contentType);
        }), 'INTAKE_EVIDENCE_REQUIRED', 409);
        const snapshot = { ...input, title: row.title, subtitle: row.subtitle, sourceRevision: row.sourceRevision,
            evidenceHash: row.evidenceHash, admissionHash: row.admissionHash };
        return { ...snapshot, evidenceCanonical: row.evidenceCanonical, admissionCanonical: row.admissionCanonical,
            sourceBindingHash: hash(canonical(snapshot)) };
    }
    previewIntake(staff, source) {
        return this.transaction(staff, async context => {
            const row = await this.source(context, source);
            const existing = await context.tx.staffSpecimen.findUnique({ where: { sourceType_sourceId: { sourceType: source.sourceType, sourceId: source.sourceId } } });
            return { sourceType: row.sourceType, sourceId: row.sourceId, sourceOwnerId: row.sourceOwnerId,
                title: row.title, subtitle: row.subtitle, sourceRevision: row.sourceRevision, evidenceHash: row.evidenceHash,
                admissionHash: row.admissionHash, sourceBindingHash: row.sourceBindingHash, existingSpecimenId: existing?.id ?? null };
        });
    }
    admitIntake(staff, input) {
        strictObject(input, ['operationId', 'reason', 'authorizationEvidenceHash', 'source', 'sourceBindingHash']); digest(input.sourceBindingHash);
        text(input.source?.sourceId, 128);
        // StaffAudit.subjectId is bounded to 100 bytes; retain exact long source in evidence.
        return this.mutation(staff, 'SPECIMEN_INTAKE_ADMITTED', hash(canonical(input.source)), input, async context => {
            const row = await this.source(context, input.source);
            check(row.sourceBindingHash === input.sourceBindingHash, 'INTAKE_SOURCE_CHANGED', 409);
            const existing = await context.tx.staffSpecimen.findUnique({ where: { sourceType_sourceId: { sourceType: row.sourceType, sourceId: row.sourceId } } });
            check(!existing, 'SOURCE_ALREADY_ADMITTED', 409);
            const id = randomUUID(), draft = { revision: 1, evidenceRevision: 1, evidenceHash: row.evidenceHash,
                observations: { FRONT: '', BACK: '' }, reviewedSides: [], identityReviewed: false,
                disposition: 'IN_REVIEW', savedAt: null, savedBy: null };
            await context.tx.staffSpecimen.create({ data: { id, sourceType: row.sourceType, sourceId: row.sourceId,
                sourceOwnerId: row.sourceOwnerId, title: row.title, subtitle: row.subtitle,
                evidenceCanonical: row.evidenceCanonical, evidenceHash: row.evidenceHash,
                evidenceRevision: 1, draftRevision: 1, analysisRevision: 0, createdAt: context.now } });
            const content = canonical(draft);
            await context.tx.staffReviewRevision.create({ data: { specimenId: id, revision: 1, evidenceRevision: 1,
                evidenceHash: row.evidenceHash, analysisRevision: 0, contentHash: hash(content), canonical: content,
                savedById: context.identity.id, savedAt: context.now } });
            return { receipt: { specimenId: id, evidenceHash: row.evidenceHash, sourceBindingHash: row.sourceBindingHash },
                evidence: { source: input.source, sourceRevision: row.sourceRevision, admissionHash: row.admissionHash,
                    admissionCanonical: row.admissionCanonical } };
        });
    }
    roster(staff) {
        return this.transaction(staff, async ({ tx }) => {
            const rows = await tx.staffIdentity.findMany({ orderBy: { id: 'asc' }, take: 101 });
            check(rows.length <= 100, 'ROSTER_REQUIRES_PAGINATION', 409);
            return rows.map(row => ({ id: row.id, name: row.name, role: row.role, accessVersion: row.accessVersion,
                revokedAt: row.revokedAt?.toISOString() ?? null, certificationUntil: row.certificationUntil?.toISOString() ?? null,
                trustedLearningUntil: row.trustedLearningUntil?.toISOString() ?? null }));
        });
    }
    updateRoster(staff, input) {
        strictObject(input, ['operationId', 'reason', 'authorizationEvidenceHash', 'identityId', 'expectedAccessVersion',
            'role', 'revoked', 'certificationUntil', 'trustedLearningUntil']);
        uuid(input.identityId); revision(input.expectedAccessVersion);
        check(['REVIEWER', 'OBSERVER'].includes(input.role) && typeof input.revoked === 'boolean');
        const certificationUntil = input.certificationUntil === null ? null : date(input.certificationUntil);
        const trustedLearningUntil = input.trustedLearningUntil === null ? null : date(input.trustedLearningUntil);
        return this.mutation(staff, 'STAFF_ROSTER_UPDATED', input.identityId, input, async ({ tx, now }) => {
            const row = await tx.staffIdentity.findUnique({ where: { id: input.identityId } });
            check(row, 'STAFF_IDENTITY_NOT_FOUND', 404);
            check(row.accessVersion === input.expectedAccessVersion, 'STAFF_ACCESS_CHANGED', 409);
            check([certificationUntil, trustedLearningUntil].every(value => value === null || value > now));
            // Both capability expiries are explicit and independent. Neither role nor
            // certification silently grants trusted-learning or operations authority.
            const updated = await tx.staffIdentity.update({ where: { id: row.id }, data: { role: input.role,
                revokedAt: input.revoked ? now : null, certificationUntil, trustedLearningUntil,
                accessVersion: row.accessVersion + 1 } });
            return { receipt: { identityId: row.id, accessVersion: updated.accessVersion }, evidence: { before: {
                role: row.role, revokedAt: row.revokedAt?.toISOString() ?? null,
                certificationUntil: row.certificationUntil?.toISOString() ?? null,
                trustedLearningUntil: row.trustedLearningUntil?.toISOString() ?? null },
                after: { role: input.role, revoked: input.revoked, certificationUntil: input.certificationUntil,
                    trustedLearningUntil: input.trustedLearningUntil } } };
        });
    }
    assign(staff, input) {
        strictObject(input, ['operationId', 'reason', 'authorizationEvidenceHash', 'specimenId', 'identityId',
            'expectedFence', 'canReview', 'expiresAt', 'revoked']);
        uuid(input.specimenId); uuid(input.identityId); if (input.expectedFence !== null) revision(input.expectedFence);
        check(typeof input.canReview === 'boolean' && typeof input.revoked === 'boolean'); const expiresAt = date(input.expiresAt);
        return this.mutation(staff, 'STAFF_ASSIGNMENT_UPDATED', input.specimenId, input, async ({ tx, now }) => {
            const person = await tx.staffIdentity.findUnique({ where: { id: input.identityId } });
            const card = await tx.staffSpecimen.findUnique({ where: { id: input.specimenId } });
            check(person && card, 'ASSIGNMENT_SUBJECT_NOT_FOUND', 404);
            check(input.revoked || (!person.revokedAt && expiresAt > now && (!input.canReview || person.role === 'REVIEWER')),
                'ASSIGNMENT_NOT_ALLOWED', 409);
            const where = { specimenId_identityId: { specimenId: card.id, identityId: person.id } };
            const prior = await tx.staffAssignment.findUnique({ where });
            check((prior?.fence ?? null) === input.expectedFence, 'ASSIGNMENT_CHANGED', 409);
            const data = { canReview: input.canReview, expiresAt, revokedAt: input.revoked ? now : null, fence: (prior?.fence ?? 0) + 1 };
            if (prior) await tx.staffAssignment.update({ where, data });
            else await tx.staffAssignment.create({ data: { ...data, specimenId: card.id, identityId: person.id } });
            return { receipt: { specimenId: card.id, identityId: person.id, fence: data.fence },
                evidence: { assignment: { identityId: person.id, canReview: input.canReview,
                    expiresAt: input.expiresAt, revoked: input.revoked, previousFence: input.expectedFence } } };
        });
    }
    preparePilot(staff, input) {
        strictObject(input, ['operationId', 'reason', 'authorizationEvidenceHash', 'policy', 'specimens']);
        const policy = parsePilotPolicy(input.policy);
        check(policy.version === 'atlas-grading-bridge-policy-v1', 'PILOT_REQUIRES_WORKSPACE_ADMISSION', 409);
        check(Array.isArray(input.specimens) && input.specimens.length === 10);
        const bindings = input.specimens.map(value => {
            strictObject(value, ['specimenId', 'evidenceHash', 'sourceBindingHash']);
            uuid(value.specimenId); digest(value.evidenceHash); digest(value.sourceBindingHash); return value;
        });
        check(new Set(bindings.map(v => v.specimenId)).size === 10 && bindings.every(v => policy.specimenIds.includes(v.specimenId)));
        return this.mutation(staff, 'TEN_CARD_PILOT_PREPARED', policy.pilotId, input, async context => {
            check(date(policy.expiresAt) > context.now, 'PILOT_WINDOW_EXPIRED', 409);
            for (const binding of bindings) {
                const row = await context.tx.staffSpecimen.findUnique({ where: { id: binding.specimenId } });
                check(row && row.evidenceHash === binding.evidenceHash && hash(row.evidenceCanonical) === row.evidenceHash,
                    'PILOT_EVIDENCE_CHANGED', 409);
                const source = await this.source(context, { sourceType: row.sourceType, sourceId: row.sourceId, sourceOwnerId: row.sourceOwnerId });
                check(source.evidenceHash === binding.evidenceHash && source.sourceBindingHash === binding.sourceBindingHash,
                    'PILOT_EVIDENCE_CHANGED', 409);
            }
            const policyCanonical = canonical(policy), policyHash = hash(policyCanonical);
            return { receipt: { pilotId: policy.pilotId, policyCanonical, policyHash, state: 'PREPARED_ONLY', specimenCount: 10 },
                evidence: { specimens: bindings } };
        });
    }
    reconcileInvoice(staff, input) {
        strictObject(input, ['operationId', 'reason', 'authorizationEvidenceHash', 'kind', 'recordId', 'pilotId',
            'expectedBindingHash', 'invoice']);
        check(['WORKER', 'ASTRA'].includes(input.kind)); uuid(input.recordId); uuid(input.pilotId); digest(input.expectedBindingHash);
        strictObject(input.invoice, ['invoiceId', 'lineId', 'documentSha256', 'actualMicroUsd']);
        text(input.invoice.invoiceId, 128); text(input.invoice.lineId, 128); digest(input.invoice.documentSha256);
        const amount = money(input.invoice.actualMicroUsd);
        return this.mutation(staff, 'INVOICE_COST_RECONCILED', input.recordId, input, async context => {
            const record = await this.costRecord(context, input.kind, input.recordId);
            check(record.pilotId === input.pilotId && record.bindingHash === input.expectedBindingHash, 'INVOICE_BINDING_CHANGED', 409);
            // Reconciliation accounts for a known charge; it does not resolve an
            // UNKNOWN result, release a run, clear a reservation or dispatch work.
            check(record.actualMicroUsd === null, 'INVOICE_ALREADY_RECONCILED', 409);
            check(!['RUNNING', 'RESERVED', 'DISPATCHED'].includes(record.state), 'INVOICE_WORK_NOT_TERMINAL', 409);
            check(record.dispatched, 'INVOICE_DISPATCH_REQUIRED', 409);
            const reused = await context.tx.$queryRaw`SELECT id FROM atlas_staff."StaffAudit"
                WHERE event='INVOICE_COST_RECONCILED'
                AND ((details::jsonb->>'costEvidence')::jsonb->'invoice'->>'documentSha256')=${input.invoice.documentSha256}
                AND ((details::jsonb->>'costEvidence')::jsonb->'invoice'->>'lineId')=${input.invoice.lineId}
                LIMIT 1`;
            check(reused.length === 0, 'INVOICE_LINE_ALREADY_USED', 409);
            const costEvidence = canonical({ version: 'atlas-invoice-cost-v1', kind: input.kind, recordId: input.recordId,
                pilotId: input.pilotId, bindingHash: record.bindingHash, invoice: input.invoice });
            const costEvidenceHash = hash(costEvidence), data = { actualMicroUsd: amount, costEvidenceHash };
            if (input.kind === 'WORKER') await context.tx.staffGradingExecution.update({ where: { operationId: input.recordId }, data });
            else await context.tx.staffOperatorAttempt.update({ where: { id: input.recordId }, data });
            return { receipt: { kind: input.kind, recordId: input.recordId, actualMicroUsd: amount.toString(), costEvidenceHash },
                evidence: { costEvidence } };
        });
    }
    async costRecord({ tx }, kind, id) {
        const row = kind === 'WORKER' ? await tx.staffGradingExecution.findUnique({ where: { operationId: id }, select: WORKER_COST })
            : await tx.staffOperatorAttempt.findUnique({ where: { id }, select: ASTRA_COST });
        check(row, 'COST_RECORD_NOT_FOUND', 404);
        const parent = kind === 'WORKER' ? await tx.staffGradingOperation.findUnique({ where: { id }, select: WORKER_PARENT })
            : await tx.staffOperatorRun.findUnique({ where: { id: row.runId }, select: RUN_PARENT });
        return this.costView(kind, row, parent);
    }
    costView(kind, row, parent) {
        check(parent, 'COST_RECORD_NOT_FOUND', 404);
        const binding = { kind, recordId: kind === 'WORKER' ? row.operationId : row.id,
            specimenId: parent.specimenId, pilotId: kind === 'WORKER' ? row.pilotId : parent.pilotId,
            requestHash: kind === 'WORKER' ? parent.inputHash : row.requestHash, claimId: kind === 'WORKER' ? row.claimId : row.dispatchClaimId,
            reservedMicroUsd: row.reservedMicroUsd.toString() };
        return { ...binding, bindingHash: hash(canonical(binding)), state: row.state,
            actualMicroUsd: row.actualMicroUsd?.toString() ?? null, costEvidenceHash: row.costEvidenceHash,
            usageCeilingMicroUsd: row.usageCeilingMicroUsd?.toString() ?? null, usageEnvelopeExceeded: row.usageEnvelopeExceeded ?? false,
            dispatched: kind === 'WORKER' || row.dispatchedAt !== null };
    }
    pilotSummary(staff, pilotId) {
        uuid(pilotId);
        return this.transaction(staff, async context => {
            const workers = await context.tx.staffGradingExecution.findMany({ where: { pilotId }, take: 1001, select: WORKER_COST });
            const runs = await context.tx.staffOperatorRun.findMany({ where: { pilotId }, take: 1001, select: RUN_PARENT });
            const initializations = await context.tx.staffMachineInitialization.findMany({ where: { pilotId }, take: 1001,
                select: { id: true, specimenId: true, state: true, deadlineAt: true } });
            check(workers.length <= 1000 && runs.length <= 1000 && initializations.length <= 1000, 'PILOT_SUMMARY_LIMIT', 409);
            const attempts = await context.tx.staffOperatorAttempt.findMany({ where: { runId: { in: runs.map(row => row.id) } }, take: 1001, select: ASTRA_COST });
            check(attempts.length <= 1000, 'PILOT_SUMMARY_LIMIT', 409);
            const operations = await context.tx.staffGradingOperation.findMany({ where: { id: { in: workers.map(row => row.operationId) } }, take: 1001, select: WORKER_PARENT });
            const sources = await context.tx.staffWorkspaceSourceOperation.findMany({ where: { pilotId }, take: 1001,
                select: { id: true, cardId: true, purpose: true, side: true, sourceConfigHash: true, requestHash: true, state: true,
                    reservedMicroUsd: true, actualMicroUsd: true, costEvidenceHash: true, dispatchedAt: true } });
            const infrastructure = await context.tx.staffWorkspaceInfrastructureReservation.findMany({ where: { pilotId }, take: 101,
                select: { id: true, sourceConfigHash: true, reservedMicroUsd: true, actualMicroUsd: true, costEvidenceHash: true } });
            check(sources.length <= 1000 && infrastructure.length <= 100, 'PILOT_SUMMARY_LIMIT', 409);
            const operationById = new Map(operations.map(row => [row.id, row])), runById = new Map(runs.map(row => [row.id, row]));
            const costs = [...workers.map(row => this.costView('WORKER', row, operationById.get(row.operationId))),
                ...attempts.map(row => this.costView('ASTRA', row, runById.get(row.runId))),
                ...sources.filter(row => row.purpose !== 'INITIALIZE_REPORT').map(row => ({ kind: 'SOURCE', recordId: row.id, pilotId,
                    cardId: row.cardId, purpose: row.purpose, side: row.side, state: row.state, sourceConfigHash: row.sourceConfigHash,
                    reservedMicroUsd: row.reservedMicroUsd.toString(), actualMicroUsd: row.actualMicroUsd?.toString() ?? null,
                    costEvidenceHash: row.costEvidenceHash, usageCeilingMicroUsd: null, usageEnvelopeExceeded: false, dispatched: row.dispatchedAt !== null })),
                ...infrastructure.map(row => ({ kind: 'INFRASTRUCTURE', recordId: row.id, pilotId, state: 'RESERVED',
                    sourceConfigHash: row.sourceConfigHash, reservedMicroUsd: row.reservedMicroUsd.toString(),
                    actualMicroUsd: row.actualMicroUsd?.toString() ?? null, costEvidenceHash: row.costEvidenceHash,
                    usageCeilingMicroUsd: null, usageEnvelopeExceeded: false, dispatched: true }))];
            // Match the SQL admission function exactly, retaining unsettled usage
            // ceilings/reservations and distinguishing them from actual invoices.
            let actual = 0n, held = 0n, overrun = false;
            for (const cost of costs) {
                const reservation = BigInt(cost.reservedMicroUsd), ceiling = cost.usageCeilingMicroUsd === null ? reservation : BigInt(cost.usageCeilingMicroUsd);
                const invoiced = cost.actualMicroUsd === null ? null : BigInt(cost.actualMicroUsd);
                if (invoiced !== null) actual += invoiced;
                else if (!(['ASTRA', 'SOURCE'].includes(cost.kind) && cost.state === 'FAILED' && !cost.dispatched)) held += ceiling;
                overrun ||= cost.usageEnvelopeExceeded || ceiling > reservation || invoiced !== null && invoiced > ceiling;
            }
            const preparations = await context.tx.staffAudit.findMany({ where: { event: 'TEN_CARD_PILOT_PREPARED', subjectId: pilotId },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 });
            let preparedConfiguration = null; const specimens = [];
            if (preparations[0]) {
                const details = JSON.parse(preparations[0].details), prepared = details.receipt;
                const policy = parsePilotPolicy(checked(prepared.policyCanonical, prepared.policyHash, 16_384));
                check(policy.version === 'atlas-grading-bridge-policy-v1' && policy.pilotId === pilotId && Array.isArray(details.specimens) && details.specimens.length === 10,
                    'PILOT_CONFIGURATION_INVALID', 409);
                preparedConfiguration = { policyHash: prepared.policyHash, policy, state: 'PREPARED_ONLY',
                    preparedAt: preparations[0].createdAt.toISOString(), expired: date(policy.expiresAt) <= context.now };
                for (const specimenId of policy.specimenIds) {
                    const card = await context.tx.staffSpecimen.findUnique({ where: { id: specimenId } });
                    const binding = details.specimens.find(row => row.specimenId === specimenId);
                    const assignments = await context.tx.staffAssignment.findMany({ where: { specimenId }, take: 101 });
                    check(assignments.length <= 100, 'ASSIGNMENT_SUMMARY_LIMIT', 409);
                    specimens.push({ specimenId, title: card?.title ?? null, present: Boolean(card),
                        evidenceMatches: Boolean(card && card.evidenceHash === binding?.evidenceHash && hash(card.evidenceCanonical) === card.evidenceHash),
                        analysisRevision: card?.analysisRevision ?? null, reviewRevision: card?.draftRevision ?? null,
                        assignments: assignments.map(row => ({ identityId: row.identityId, fence: row.fence,
                            canReview: row.canReview, active: !row.revokedAt && row.expiresAt > context.now,
                            expiresAt: row.expiresAt.toISOString() })) });
                }
            }
            return { pilotId, preparedConfiguration, specimens, actualMicroUsd: actual.toString(), unsettledMicroUsd: held.toString(),
                initializations: initializations.map(row => ({ id: row.id, specimenId: row.specimenId, state: row.state, deadlineAt: row.deadlineAt.toISOString() })),
                accountedMicroUsd: (actual + held).toString(), overrun, costs,
                runs: runs.map(row => ({ id: row.id, specimenId: row.specimenId, state: row.state, revision: row.revision })) };
        });
    }
}
