import { machineInitializationAdmissionClient, makeMachineInitializationAdmissionConfig } from '@atlas/service-bridge/machine-initialize-transport';
import { keyBytes, SHA, UUID } from '@atlas/service-bridge/protocol';
import { deny, hash, strictObject } from '../policy.mjs';

const check = (condition, code = 'MACHINE_ADMISSION_REQUIRED', status = 409) => { if (!condition) deny(status, code); };
const jobFields = { id: true, specimenId: true, pilotId: true, gradingOperationId: true, runtimeHash: true,
    state: true, deadlineAt: true, admittedById: true, admissionReason: true, authorizationEvidenceHash: true };
function inputShape(input) {
    strictObject(input, ['jobId', 'specimenId', 'reason', 'authorizationEvidenceHash']);
    check(UUID.test(input.jobId ?? '') && UUID.test(input.specimenId ?? '') && SHA.test(input.authorizationEvidenceHash ?? '')
        && typeof input.reason === 'string' && input.reason.trim().length > 0 && input.reason.length <= 500
        && !/[\x00-\x1f\x7f]/.test(input.reason), 'MACHINE_ADMISSION_REQUIRED', 400);
}
function receipt(job, run = null) {
    return { jobId: job.id, specimenId: job.specimenId, pilotId: job.pilotId, gradingOperationId: job.gradingOperationId,
        runtimeHash: job.runtimeHash, state: job.state, deadlineAt: job.deadlineAt.toISOString(),
        operatorRun: run ? { id: run.id, state: run.state } : null };
}

/** Reparsed by runtime on each request. Admission has no worker execution key. */
export function machineAdmissionRuntimeSettings(env, staffConfig) {
    if (env.ATLAS_MACHINE_INITIALIZATION_ENABLED !== 'true') return null;
    check(staffConfig.mode === 'PRODUCTION' && env.NODE_ENV === 'production' && env.VERCEL_ENV === 'production'
        && !Object.keys(env).some(name => name.startsWith('ATLAS_LOCAL_'))
        && env.ATLAS_MACHINE_EXECUTION_KEY === undefined, 'MACHINE_ADMISSION_NOT_CONFIGURED', 503);
    const otherKeyHashes = [hash(staffConfig.sessionKey), hash(staffConfig.phoneKey),
        ...['ATLAS_GRADING_BRIDGE_KEY', 'ATLAS_INTAKE_KEY', 'ATLAS_TRUSTED_LEARNING_KEY', 'ATLAS_OPERATOR_EVIDENCE_KEY', 'ATLAS_PUBLIC_MEDIA_KEY']
            .filter(name => env[name] !== undefined).map(name => hash(keyBytes(env[name])))];
    return makeMachineInitializationAdmissionConfig({ mode: 'PRODUCTION', origin: env.ATLAS_MACHINE_INITIALIZATION_ORIGIN,
        runtimeHash: env.ATLAS_OPERATOR_RUNTIME_HASH, key: keyBytes(env.ATLAS_MACHINE_ADMISSION_KEY),
        peerKeyHash: env.ATLAS_MACHINE_EXECUTION_KEY_HASH, otherKeyHashes });
}

/** Fresh opaque Operations authority authorizes one source-bound job. The
 * worker/model runner executes it separately from this serving process. */
export class StaffMachinePreparation {
    constructor({ admin, settings = null, fetchImpl }) { this.admin = admin;
        this.client = settings ? machineInitializationAdmissionClient(settings, fetchImpl) : null; }
    transaction(staff, work) {
        check(typeof this.admin?.transaction === 'function', 'OPERATIONS_NOT_CONFIGURED', 503);
        return this.admin.transaction(staff, context => {
            check(context.actorKind === 'HUMAN' && context.capability === 'OPERATIONS'
                && context.capabilityUntil > context.now && UUID.test(context.identity?.id ?? '')
                && UUID.test(context.operationsGrantId ?? ''), 'FRESH_HUMAN_OPERATIONS_REQUIRED', 403);
            return work(context);
        });
    }
    async retained(context, input) {
        const job = await context.tx.staffMachineInitialization.findUnique({ where: { id: input.jobId }, select: jobFields });
        if (!job) return null;
        check(job.admittedById === context.identity.id && job.specimenId === input.specimenId
            && job.admissionReason === input.reason && job.authorizationEvidenceHash === input.authorizationEvidenceHash,
        'MACHINE_ADMISSION_CONFLICT');
        const run = await context.tx.staffOperatorRun.findUnique({ where: { initializationId: job.id }, select: { id: true, state: true } });
        return receipt(job, run);
    }
    async admit(staff, input) {
        inputShape(input);
        const prepared = await this.transaction(staff, async context => {
            const prior = await this.retained(context, input); if (prior) return { prior };
            check(this.client, 'MACHINE_ADMISSION_NOT_CONFIGURED', 503);
            const { identity, session, control } = context;
            const card = await context.tx.staffSpecimen.findUnique({ where: { id: input.specimenId },
                select: { id: true, analysisRevision: true, sourceType: true } });
            check(card && card.analysisRevision === 0 && card.sourceType === (control.mode === 'PRODUCTION' ? 'SPEEDSTER' : 'LOCAL_FIXTURE'),
                'MACHINE_INITIALIZATION_STALE');
            return { scope: { actorId: identity.id, sessionHash: session.tokenHash, browserHash: session.browserHash,
                accessVersion: identity.accessVersion, controlRevision: control.revision, staffOrigin: control.origin,
                deploymentId: control.deploymentId, releaseSha: control.releaseSha, staffConfigHash: control.configHash,
                operationsGrantId: context.operationsGrantId } };
        });
        if (prepared.prior) return prepared.prior;
        await this.client.admit(prepared.scope, { ...input, runtimeHash: this.client.binding.runtimeHash });
        return this.transaction(staff, async context => {
            const saved = await this.retained(context, input);
            check(saved && saved.runtimeHash === this.client.binding.runtimeHash, 'MACHINE_ADMISSION_OUTCOME_UNCONFIRMED');
            return saved;
        });
    }
    status(staff, jobId) {
        check(UUID.test(jobId ?? ''), 'MACHINE_ADMISSION_REQUIRED', 400);
        return this.transaction(staff, async context => {
            const job = await context.tx.staffMachineInitialization.findUnique({ where: { id: jobId }, select: jobFields });
            check(job, 'MACHINE_INITIALIZATION_NOT_FOUND', 404);
            const run = await context.tx.staffOperatorRun.findUnique({ where: { initializationId: job.id }, select: { id: true, state: true } });
            return receipt(job, run);
        });
    }
}
