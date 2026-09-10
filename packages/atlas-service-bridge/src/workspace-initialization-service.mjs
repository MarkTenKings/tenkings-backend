import { randomUUID } from 'node:crypto';
import { canonical, digest, parsePilotPolicy, requireBridge as check } from './protocol.mjs';
import { ScopedGradingBridge } from './executor.mjs';
import { MachineInitializationBridge } from './machine-initialize.mjs';
import { admitWorkspaceSource } from './workspace-admission.mjs';
import { enqueueWorkspaceMachineInitializationInTransaction } from './workspace-initialize.mjs';

/** This private composition retains the original HUMAN or MACHINE execution
 * bridge. Its source ledger owns no additional detector budget and dispatches
 * only inside the original grading execution's committed reservation. */
export function createWorkspaceInitializationService({ client, authority, config, ports, sourceConfigHash, request, ledger }) {
    const machine = request.scope.actorKind === 'MACHINE';
    const bound = { purpose: 'INITIALIZE_REPORT', side: 'PAIR', requestId: request.requestId, cardId: request.cardId,
        binding: request.binding, request: { action: 'INITIALIZE', actorKind: machine ? 'MACHINE' : 'HUMAN' } };
    const transaction = work => client.$transaction(async tx => {
        const result = await work(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
    }, { maxWait: 5000, timeout: 10000 });
    async function savedStatus() {
        const authorized = await authority.load(request);
        const retained = await ledger.read(bound);
        if (!retained) return { state: 'PENDING' };
        if (retained.result) return retained.result;
        const result = await transaction(async tx => {
            await authority.recheck(request, authorized, tx);
            const [admission] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceAdmission" WHERE "requestId"=${request.requestId}::uuid`;
            if (!admission) return { state: 'PENDING' };
            const operations = machine
                ? await tx.$queryRaw`SELECT o.* FROM atlas_staff."StaffMachineInitialization" j JOIN atlas_staff."StaffGradingOperation" o
                    ON o.id=j."gradingOperationId" WHERE j."workspaceSourceRequestId"=${request.requestId}::uuid`
                : await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=${admission.specimenId}::uuid
                    AND "operationId"=${request.requestId} AND "actorKind"='HUMAN'`;
            const op = operations[0];
            if (!op) return { state: 'PENDING' };
            const [execution] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingExecution" WHERE "operationId"=${op.id}::uuid`;
            if (op.state === 'SUCCEEDED' && execution?.state === 'COMMITTED' && op.resultAnalysisRevision === 1)
                return { state: 'SUCCEEDED', specimenId: admission.specimenId };
            if (op.state === 'FAILED' && !execution)
                return { state: 'FAILED', failureCode: op.failureCode ?? 'WORKSPACE_INITIALIZATION_NOT_DISPATCHED' };
            return { state: op.state === 'UNKNOWN' || execution?.state === 'UNKNOWN' ? 'UNKNOWN' : 'PENDING' };
        });
        if (result.state !== 'PENDING' && (retained.state === 'DISPATCHED' || result.state === 'FAILED' && retained.state === 'RESERVED')) {
            const saved = await ledger.complete(bound, retained.id, { ...result,
                ...(result.state === 'UNKNOWN' ? { failureCode: 'WORKSPACE_INITIALIZATION_OUTCOME_UNCONFIRMED' } : {}) });
            return saved.result;
        }
        return result;
    }
    async function enqueueHuman(tx, admission, authorized) {
            await tx.$executeRaw`SELECT atlas_staff.lock_workspace_private_controls()`;
            await authority.recheck(request, authorized, tx);
            const [bridge] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active'`;
            const [staff] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffControl" WHERE id='active'`;
            const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            check(bridge?.enabled && ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash', 'clientKeyHash', 'gradingPolicyHash']
                .every(key => bridge[key] === config[key]) && staff.enabled && staff.gradingPolicyHash === bridge.gradingPolicyHash,
            'WORKSPACE_INITIALIZATION_NOT_ENABLED');
            const policy = parsePilotPolicy(JSON.parse(bridge.policyCanonical));
            check(digest(bridge.policyCanonical) === bridge.policyHash && policy.version === 'atlas-workspace-bridge-policy-v1'
                && policy.workspaceCardIds.includes(request.cardId) && +new Date(policy.expiresAt) > +now, 'PILOT_NOT_ACTIVE');
            const [prior] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=${admission.specimenId}::uuid
                AND "operationId"=${request.requestId} FOR SHARE`;
            if (prior) return { operationId: prior.id };
            const [review] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffReviewRevision" WHERE "specimenId"=${admission.specimenId}::uuid AND revision=1`;
            check(review && admission.actorKind === 'HUMAN' && admission.actorId === request.scope.actorId, 'WORKSPACE_SOURCE_ADMISSION_CHANGED');
            const action = { type: 'INITIALIZE' }, input = { operationId: request.requestId, expectedAnalysisRevision: 0, analysisHash: null,
                expectedReviewRevision: 1, reviewHash: review.contentHash, evidenceHash: admission.evidenceHash, action };
            const requestCanonical = canonical({ version: 'atlas-review-operation-v1', request: input,
                sourceId: admission.sourceId, sourceOwnerId: admission.sourceOwnerId, sourceRevision: admission.sourceRevision,
                accessVersion: admission.accessVersion, policyHash: bridge.gradingPolicyHash, bridgePolicyHash: bridge.policyHash });
            const id = randomUUID(), deadline = new Date(Math.min(+now + policy.deadlineMs, +new Date(policy.expiresAt)));
            await tx.$executeRaw`INSERT INTO atlas_staff."StaffGradingOperation"
                (id,"specimenId","operationId","actorKind","actorId","sessionHash","assignmentFence","controlRevision","evidenceHash",
                  "expectedAnalysisRevision","expectedReviewRevision","requestCanonical","inputHash",state,"dispatchClaimId","leaseFence","leaseExpiresAt","createdAt","dispatchedAt")
                VALUES(${id}::uuid,${admission.specimenId}::uuid,${request.requestId},'HUMAN',${request.scope.actorId},${request.scope.sessionHash},1,
                  ${staff.revision},${admission.evidenceHash},0,1,${requestCanonical},${digest(requestCanonical)},'RESERVED',${randomUUID()}::uuid,1,
                  (${deadline}::timestamptz AT TIME ZONE 'UTC'),(${now}::timestamptz AT TIME ZONE 'UTC'),NULL)`;
            await tx.$executeRaw`UPDATE atlas_staff."StaffGradingOperation" SET state='DISPATCHED',"dispatchedAt"=(${now}::timestamptz AT TIME ZONE 'UTC') WHERE id=${id}::uuid`;
            return { operationId: id };
    }
    async function retainPreDispatchFailure(claimedId) {
        // Only the owner of this first claim reaches this path. A lost commit
        // reply is not assumed to have rolled back: inspect the same database
        // under the shared lock and retain failure only if no admission or
        // original operation exists. No worker reservation is released here.
        return transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceOperation" WHERE id=${claimedId}::uuid FOR UPDATE`;
            const [proof] = await tx.$queryRaw`SELECT
                EXISTS(SELECT 1 FROM atlas_staff."StaffWorkspaceSourceAdmission" WHERE "requestId"=${request.requestId}::uuid) AS admitted,
                EXISTS(SELECT 1 FROM atlas_staff."StaffGradingOperation" WHERE "specimenId"=${request.cardId}::uuid AND "operationId"=${request.requestId}) AS enqueued`;
            if (!row || row.state !== 'RESERVED' || row.dispatchedAt !== null || row.gradingExecutionId !== null || proof.admitted || proof.enqueued)
                return { state: 'PENDING' };
            check(row.requestId === request.requestId && row.cardId === request.cardId && row.purpose === 'INITIALIZE_REPORT', 'WORKSPACE_SOURCE_REQUEST_CHANGED');
            const result = { state: 'FAILED', failureCode: 'WORKSPACE_INITIALIZATION_NOT_DISPATCHED' }, text = canonical(result);
            await tx.$executeRaw`UPDATE atlas_staff."StaffWorkspaceSourceOperation" SET state='FAILED',"failureCode"=${result.failureCode},
                "resultCanonical"=${text},"resultHash"=${digest(text)},"finishedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=${claimedId}::uuid`;
            return result;
        });
    }
    return {
        status: savedStatus,
        async run() {
            const claimed = await ledger.claim(bound);
            if (!claimed.claimed) return savedStatus();
            let admission, operation;
            try {
                const authorized = await authority.load(request);
                ({ admission, operation } = await transaction(async tx => {
                    const admitted = await admitWorkspaceSource({ client, authority, ports, sourceConfigHash, transaction: tx, authorized }, request);
                    const enqueued = machine ? await enqueueWorkspaceMachineInitializationInTransaction(tx, config, ports, { requestId: request.requestId })
                        : await enqueueHuman(tx, admitted, authorized);
                    return { admission: admitted, operation: enqueued };
                }));
            } catch {
                return retainPreDispatchFailure(claimed.row.id);
            }
            const scopedPorts = { ...ports, async afterExecutionClaim(tx, execution) {
                await ledger.dispatch(bound, claimed.row.id, execution.operationId, tx);
                await ports.afterExecutionClaim?.(tx, execution);
            } };
            if (machine) await new MachineInitializationBridge({ client, config, ports: scopedPorts })
                .run({ jobId: operation.id, runtimeHash: config.runtimeHash });
            else await new ScopedGradingBridge({ client, config, ports: scopedPorts }).run({
                controlRevision: request.scope.controlRevision, specimenId: admission.specimenId, actorId: request.scope.actorId,
                sessionHash: request.scope.sessionHash, assignmentFence: 1, evidenceHash: admission.evidenceHash,
                deploymentId: config.staffDeploymentId, releaseSha: config.staffReleaseSha,
            }, operation.operationId);
            return savedStatus();
        },
    };
}
