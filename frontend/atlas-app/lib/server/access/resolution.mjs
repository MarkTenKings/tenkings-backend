import { canonical } from '../review-contract.mjs';
import { deny, hash, strictObject } from '../policy.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const KINDS = ['INITIALIZATION', 'ASTRA', 'WORKER'];
const check = (condition, code = 'RESOLUTION_REQUEST_INVALID', status = 400) => { if (!condition) deny(status, code); };
const uuid = value => check(typeof value === 'string' && UUID.test(value));
const sha = value => check(typeof value === 'string' && SHA.test(value));
const pick = (row, keys) => Object.fromEntries(keys.map(key => {
    check(row && row[key] !== undefined, 'RESOLUTION_LEDGER_INVALID', 409); return [key, row[key]];
}));
const iso = value => {
    check(value instanceof Date && Number.isFinite(+value), 'RESOLUTION_LEDGER_INVALID', 409); return value.toISOString();
};
const amount = value => {
    check(typeof value === 'bigint' && value >= 0n, 'RESOLUTION_LEDGER_INVALID', 409); return value.toString();
};
const checked = (body, expected) => {
    check(typeof body === 'string' && SHA.test(expected ?? '') && hash(body) === expected, 'RESOLUTION_LEDGER_INVALID', 409);
    let value; try { value = JSON.parse(body); } catch { check(false, 'RESOLUTION_LEDGER_INVALID', 409); }
    check(canonical(value) === body, 'RESOLUTION_LEDGER_INVALID', 409); return value;
};
const jobBinding = job => job ? { ...pick(job, ['id', 'specimenId', 'pilotId', 'gradingOperationId', 'runtimeHash', 'evidenceHash',
    'operatorPolicyHash', 'bridgePolicyHash', 'gradingPolicyHash', 'sourceHash', 'sourceRevision', 'expectedAnalysisRevision',
    'expectedReviewRevision', 'controlRevision', 'operatorRevision', 'bridgeRevision', 'admittedById', 'admittedSessionHash', 'admittedAccessVersion', 'operationsGrantId',
    'admissionReason', 'authorizationEvidenceHash']), deadlineAt: iso(job.deadlineAt) } : null;
const operationBinding = op => ({ ...pick(op, ['id', 'specimenId', 'operationId', 'actorKind', 'actorId', 'sessionHash', 'assignmentFence',
    'controlRevision', 'evidenceHash', 'expectedAnalysisRevision', 'expectedReviewRevision', 'inputHash', 'dispatchClaimId', 'leaseFence']),
    leaseExpiresAt: iso(op.leaseExpiresAt) });
const executionBinding = execution => execution ? { ...pick(execution, ['operationId', 'claimId', 'pilotId', 'bridgeRevision', 'sourceRevision']),
    reservedMicroUsd: amount(execution.reservedMicroUsd) } : null;

/** The exact versioned object below is also the definer's binding contract.
 * Receipt/state/invoice/usage fields are deliberately not binding inputs: late
 * evidence and accurate accounting must remain possible after abandonment.
 * All canonical request, policy and manifest hashes are verified when loading.
 */
export function operationalResolutionBinding({ kind, recordId, pilotId, card, run, attempts, op, execution, job }) {
    const source = pick(card, ['id', 'sourceType', 'sourceId', 'sourceOwnerId', 'evidenceHash']);
    const binding = { version: 'atlas-operational-resolution-binding-v1', kind, recordId, specimenId: card.id, pilotId, source };
    if (kind === 'ASTRA') return { ...binding,
        run: pick(run, ['id', 'evidenceHash', 'policyHash', 'runtimeHash', 'gradingPolicyHash', 'manifestHash',
            'expectedAnalysisRevision', 'expectedReviewRevision', 'revision', 'inputHash']),
        attempts: [...attempts].sort((a, b) => a.ordinal - b.ordinal).map(row => ({ ...pick(row,
            ['id', 'ordinal', 'runRevision', 'leaseFence', 'dispatchClaimId', 'requestHash', 'providerBindingHash']),
            reservedMicroUsd: amount(row.reservedMicroUsd) })) };
    return { ...binding, operation: operationBinding(op), execution: executionBinding(execution), initialization: jobBinding(job) };
}

const costs = record => record.kind === 'ASTRA' ? record.attempts : record.execution ? [record.execution] : [];
const retained = record => canonical(costs(record).map(row => ({ ...row,
    reservedMicroUsd: amount(row.reservedMicroUsd), actualMicroUsd: row.actualMicroUsd === null ? null : amount(row.actualMicroUsd),
    ...(row.usageCeilingMicroUsd !== undefined ? { usageCeilingMicroUsd: row.usageCeilingMicroUsd === null ? null : amount(row.usageCeilingMicroUsd) } : {}),
    // Prisma dates need an explicit canonical representation.
    ...Object.fromEntries(Object.entries(row).filter(([, value]) => value instanceof Date).map(([key, value]) => [key, iso(value)])),
})).sort((a, b) => String(a.id ?? a.operationId).localeCompare(String(b.id ?? b.operationId))));
function holdSummary(record) {
    let reserved = 0n, unsettled = 0n, actual = 0n;
    for (const row of costs(record)) {
        reserved += BigInt(amount(row.reservedMicroUsd));
        if (row.actualMicroUsd !== null) actual += BigInt(amount(row.actualMicroUsd));
        else if (!(record.kind === 'ASTRA' && row.state === 'FAILED' && row.dispatchedAt === null))
            unsettled += row.usageCeilingMicroUsd === undefined || row.usageCeilingMicroUsd === null
                ? BigInt(amount(row.reservedMicroUsd)) : BigInt(amount(row.usageCeilingMicroUsd));
    }
    return { scope: 'TARGET', records: costs(record).length, reservedMicroUsd: reserved.toString(),
        unsettledMicroUsd: unsettled.toString(), actualMicroUsd: actual.toString(), accountingChanged: false };
}
function state(record) { return record.kind === 'ASTRA' ? record.run.state : record.kind === 'WORKER' ? record.op.state : record.job.state; }
function terminal(record) {
    check(state(record) === 'FAILED' && (record.kind === 'ASTRA' || record.op.state === 'FAILED')
        && (!record.job || record.job.state === 'FAILED'), 'RESOLUTION_OUTCOME_UNCONFIRMED', 409);
}
function receipt(row, record) {
    return { resolutionId: row.id, kind: row.kind, recordId: row.recordId, specimenId: row.specimenId, pilotId: row.pilotId,
        state: 'FAILED', disposition: row.kind === 'INITIALIZATION' ? 'CANCELLED_BEFORE_DISPATCH' : 'ABANDONED',
        nextAction: 'HUMAN_INSPECTION_OR_RECAPTURE', holds: holdSummary(record),
        summary: row.kind === 'INITIALIZATION'
            ? 'Undispatched initialization cancelled. History is preserved. Human inspection or recapture is required before new automation.'
            : 'Unapplied automation abandoned. Receipts, cost reservations and invoice evidence remain recorded; unsettled costs stay held. Human inspection or recapture is required. No retry was scheduled.' };
}

/** Inactive named operations only. Supply the real StaffOperationsAuthority;
 * its transaction validates the opaque handle, exact restricted role, fresh
 * session/browser/operations grant, common lock, and final deferred constraints.
 * No route, credentials, activation, worker/provider call or raw state UPDATE.
 */
export class StaffOperationalResolutionService {
    constructor({ admin }) {
        check(typeof admin?.transaction === 'function', 'RESOLUTION_NOT_CONFIGURED', 503); this.admin = admin;
    }
    transaction(staff, work) {
        return this.admin.transaction(staff, context => {
            const { identity, session, now, control } = context;
            check(context.actorKind === 'HUMAN' && context.capability === 'OPERATIONS' && now instanceof Date && Number.isFinite(+now)
                && context.capabilityUntil instanceof Date && context.capabilityUntil > now
                && identity && !identity.revokedAt && ['REVIEWER', 'OBSERVER'].includes(identity.role)
                && session && !session.revokedAt && session.identityId === identity.id && session.accessVersion === identity.accessVersion
                && session.createdAt instanceof Date && session.createdAt <= now && +now - +session.createdAt <= 300_000
                && session.expiresAt instanceof Date && session.expiresAt > now && control?.enabled === true
                && session.controlRevision === control.revision, 'FRESH_HUMAN_OPERATIONS_REQUIRED', 403);
            uuid(identity.id); uuid(context.operationsGrantId); sha(session.tokenHash); return work(context);
        });
    }
    async load({ tx }, kind, recordId, pilotId) {
        let run, attempts, op, execution, job, specimenId, storedPilot, request;
        if (kind === 'ASTRA') {
            run = await tx.staffOperatorRun.findUnique({ where: { id: recordId } });
            check(run, 'RESOLUTION_RECORD_NOT_FOUND', 404); specimenId = run.specimenId; storedPilot = run.pilotId;
            const policy = checked(run.policyCanonical, run.policyHash), manifest = checked(run.manifestCanonical, run.manifestHash);
            checked(run.inputCanonical, run.inputHash);
            check(policy.pilotId === run.pilotId && manifest.version === 'atlas-operator-manifest-v1' && manifest.runId === run.id
                && manifest.specimenId === run.specimenId && manifest.evidenceHash === run.evidenceHash
                && manifest.analysisRevision === run.expectedAnalysisRevision && manifest.reviewRevision === run.expectedReviewRevision,
            'RESOLUTION_LEDGER_INVALID', 409);
            attempts = await tx.staffOperatorAttempt.findMany({ where: { runId: run.id }, orderBy: { ordinal: 'asc' }, take: 101 });
            check(attempts.length <= 100 && new Set(attempts.map(row => row.ordinal)).size === attempts.length, 'RESOLUTION_LEDGER_LIMIT', 409);
            for (const row of attempts) { check(row.runId === run.id, 'RESOLUTION_LEDGER_INVALID', 409); checked(row.requestCanonical, row.requestHash); }
        } else {
            if (kind === 'INITIALIZATION') {
                job = await tx.staffMachineInitialization.findUnique({ where: { id: recordId } });
                check(job, 'RESOLUTION_RECORD_NOT_FOUND', 404);
                op = await tx.staffGradingOperation.findUnique({ where: { id: job.gradingOperationId } });
            } else {
                op = await tx.staffGradingOperation.findUnique({ where: { id: recordId } });
                job = await tx.staffMachineInitialization.findUnique({ where: { gradingOperationId: recordId } });
            }
            check(op, 'RESOLUTION_RECORD_NOT_FOUND', 404); request = checked(op.requestCanonical, op.inputHash);
            execution = await tx.staffGradingExecution.findUnique({ where: { operationId: op.id } });
            specimenId = op.specimenId; storedPilot = kind === 'INITIALIZATION' ? job.pilotId : execution?.pilotId;
            check(!job || job.gradingOperationId === op.id && job.specimenId === specimenId && job.pilotId === storedPilot
                && op.actorKind === 'ASTRA' && op.actorId === `ASTRA_INITIALIZE:${job.id}` && op.operationId === job.id
                && op.sessionHash === null && op.assignmentFence === null && op.evidenceHash === job.evidenceHash,
            'RESOLUTION_LEDGER_INVALID', 409);
            check(!execution || execution.operationId === op.id && execution.pilotId === storedPilot, 'RESOLUTION_LEDGER_INVALID', 409);
        }
        check(storedPilot === pilotId, 'RESOLUTION_PILOT_CHANGED', 409);
        const card = await tx.staffSpecimen.findUnique({ where: { id: specimenId } });
        check(card && card.evidenceHash === (run ?? op).evidenceHash, 'RESOLUTION_LEDGER_INVALID', 409);
        checked(card.evidenceCanonical, card.evidenceHash);
        if (op) check(request.sourceId === card.sourceId && request.sourceOwnerId === card.sourceOwnerId
            && (!execution || execution.sourceRevision === request.sourceRevision)
            && (!job || job.sourceRevision === request.sourceRevision), 'RESOLUTION_LEDGER_INVALID', 409);
        const record = { kind, recordId, pilotId, card, run, attempts, op, execution, job };
        record.bindingHash = hash(canonical(operationalResolutionBinding(record))); return record;
    }
    inspect(staff, input) {
        strictObject(input, ['kind', 'recordId', 'pilotId']); check(KINDS.includes(input.kind)); uuid(input.recordId); uuid(input.pilotId);
        return this.transaction(staff, async context => {
            const record = await this.load(context, input.kind, input.recordId, input.pilotId);
            return { ...input, specimenId: record.card.id, state: state(record), bindingHash: record.bindingHash,
                holds: holdSummary(record), requiredAction: 'EXPLICIT_HUMAN_REASON_AND_EXTERNAL_OUTCOME_OR_INCIDENT_EVIDENCE' };
        });
    }
    cancelUndispatchedInitialization(staff, input) {
        strictObject(input, ['operationId', 'recordId', 'pilotId', 'expectedBindingHash', 'evidenceHash', 'reason']);
        return this.resolve(staff, { ...input, kind: 'INITIALIZATION' });
    }
    abandonUnknown(staff, input) {
        strictObject(input, ['kind', 'operationId', 'recordId', 'pilotId', 'expectedBindingHash', 'evidenceHash', 'reason']);
        check(['ASTRA', 'WORKER'].includes(input.kind)); return this.resolve(staff, input);
    }
    async resolve(staff, input) {
        uuid(input.operationId); uuid(input.recordId); uuid(input.pilotId); sha(input.expectedBindingHash); sha(input.evidenceHash);
        check(typeof input.reason === 'string' && input.reason.trim().length > 0 && input.reason.length <= 500 && !/[\x00-\x1f\x7f]/.test(input.reason));
        const inputHash = hash(canonical({ version: 'atlas-operational-resolution-input-v1', ...input }));
        return this.transaction(staff, async context => {
            const { tx, identity, session, control, now } = context;
            const bytes = hash(canonical({ purpose: 'atlas-operational-resolution-id-v1', actorId: identity.id, operationId: input.operationId }));
            const id = `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-4${bytes.slice(13, 16)}-8${bytes.slice(17, 20)}-${bytes.slice(20, 32)}`;
            const prior = await tx.staffOperationalResolution.findUnique({ where: { id } });
            // Auth is fresh even on replay, but the previous browser session or
            // the now-terminal state must not prevent the same human's replay.
            if (prior) {
                check(prior.actorId === identity.id && prior.operationId === input.operationId && prior.inputHash === inputHash
                    && prior.kind === input.kind && prior.recordId === input.recordId && prior.pilotId === input.pilotId
                    && prior.bindingHash === input.expectedBindingHash && prior.evidenceHash === input.evidenceHash && prior.reason === input.reason,
                'RESOLUTION_OPERATION_CONFLICT', 409);
                const current = await this.load(context, prior.kind, prior.recordId, prior.pilotId);
                check(current.bindingHash === prior.bindingHash && current.card.evidenceHash === prior.sourceEvidenceHash, 'RESOLUTION_BINDING_CHANGED', 409); terminal(current);
                return receipt(prior, current);
            }
            const record = await this.load(context, input.kind, input.recordId, input.pilotId);
            check(record.bindingHash === input.expectedBindingHash, 'RESOLUTION_BINDING_CHANGED', 409);
            if (input.kind === 'INITIALIZATION') {
                check(record.job.state === 'QUEUED' && record.op.state === 'RESERVED' && record.job.dispatchedAt === null
                    && record.op.dispatchedAt === null && !record.execution && record.op.resultAnalysisRevision === null
                    && record.job.expectedAnalysisRevision === 0 && record.card.analysisRevision === 0,
                'INITIALIZATION_ALREADY_DISPATCHED_OR_COMMITTED', 409);
            } else check(state(record) === 'UNKNOWN' && (input.kind === 'ASTRA' || record.execution?.state === 'UNKNOWN'
                && record.op.resultAnalysisRevision === null && (!record.job || record.job.state === 'UNKNOWN')),
            'RESOLUTION_REQUIRES_UNKNOWN_UNCOMMITTED', 409);
            if (record.op) check(!await tx.staffAnalysisRevision.findUnique({ where: { operationId: record.op.id } }),
                'RESOLUTION_ALREADY_COMMITTED', 409);
            const before = retained(record);
            const row = { id, kind: input.kind, recordId: input.recordId, specimenId: record.card.id, pilotId: input.pilotId,
                operationId: input.operationId, actorId: identity.id, sessionHash: session.tokenHash, accessVersion: identity.accessVersion,
                controlRevision: control.revision, operationsGrantId: context.operationsGrantId, inputHash,
                bindingHash: record.bindingHash, sourceEvidenceHash: record.card.evidenceHash, evidenceHash: input.evidenceHash, reason: input.reason, createdAt: now };
            await tx.staffOperationalResolution.create({ data: row });
            await tx.staffAudit.create({ data: { id, event: 'OPERATIONAL_RESOLUTION_RECORDED', subjectId: input.recordId,
                actorId: identity.id, createdAt: now, details: canonical({ version: 'atlas-operational-resolution-audit-v1',
                    resolutionId: id, kind: input.kind, recordId: input.recordId, specimenId: record.card.id, pilotId: input.pilotId,
                    inputHash, bindingHash: record.bindingHash, sourceEvidenceHash: record.card.evidenceHash, evidenceHash: input.evidenceHash, reason: input.reason }) } });
            // The only state-changing authority is this narrowly guarded SQL
            // definer. It must verify the resolution + audit and retain costs.
            await tx.$queryRaw`SELECT * FROM atlas_staff.apply_operational_resolution(${id}::uuid)`;
            const current = await this.load(context, input.kind, input.recordId, input.pilotId); terminal(current);
            check(current.bindingHash === record.bindingHash && retained(current) === before, 'RESOLUTION_RETENTION_CHANGED', 409);
            return receipt(row, current);
        });
    }
}
