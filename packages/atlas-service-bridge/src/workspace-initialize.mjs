import { randomUUID } from 'node:crypto';
import { canonical, digest, keys, pilotDollarLimitsAllow, requireBridge as check, SHA, UUID } from './protocol.mjs';
import { MachineInitializationBridge } from './machine-initialize.mjs';
import { pilotSubject, pilotUsage } from './pilot-scope.mjs';

const reason = 'Recorded fresh-photo capture selection';
const instant = value => value instanceof Date && Number.isFinite(+value);
const integer = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const same = (left, right) => canonical(left) === canonical(right);
function checked(text, hash, maximum = 262144) {
    check(typeof text === 'string' && Buffer.byteLength(text) <= maximum && SHA.test(hash ?? '')
        && digest(text) === hash, 'WORKSPACE_MACHINE_EVIDENCE_INVALID');
    let value; try { value = JSON.parse(text); } catch { check(false, 'WORKSPACE_MACHINE_EVIDENCE_INVALID'); }
    check(value && typeof value === 'object' && !Array.isArray(value) && canonical(value) === text,
        'WORKSPACE_MACHINE_EVIDENCE_INVALID'); return value;
}
function record(row, fields) {
    const value = checked(row?.canonical, row?.contentHash);
    check(fields.every(key => value[key] === row[key]), 'WORKSPACE_MACHINE_EVIDENCE_INVALID'); return value;
}

// Preserve the original operation protocol. The job's explicit admission kind
// carries workspace authority; neither a human session nor a grant is invented.
const requests = (job, card) => ({ version: 'atlas-machine-initialize-operation-v1', jobId: job.id, runtimeHash: job.runtimeHash,
    policyHash: job.gradingPolicyHash, operatorPolicyHash: job.operatorPolicyHash, bridgePolicyHash: job.bridgePolicyHash,
    sourceId: card.sourceId, sourceOwnerId: card.sourceOwnerId, sourceRevision: job.sourceRevision, sourceHash: job.sourceHash,
    request: { action: { type: 'INITIALIZE' } } });

async function admissionContext(context, requestId) {
    const { tx, now, policy, operator, bridge, control } = context;
    check(policy.version === 'atlas-workspace-bridge-policy-v1', 'WORKSPACE_MACHINE_ADMISSION_REQUIRED');
    const [admission] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceAdmission" WHERE "requestId"=${requestId}::uuid`;
    check(admission?.requestId === requestId && admission.actorKind === 'MACHINE' && admission.sessionHash === null
        && UUID.test(admission.actorId ?? '') && integer(admission.accessVersion) && admission.cardId === admission.specimenId
        && policy.workspaceCardIds.includes(admission.cardId) && instant(admission.createdAt) && admission.createdAt <= now,
    'WORKSPACE_MACHINE_ADMISSION_REQUIRED');
    const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_card(${admission.cardId}::uuid)`;
    const workspace = record(row, ['id', 'creatorId', 'cohortId', 'revision', 'state', 'stage', 'specimenId']);
    const [operationRow] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceOperation" WHERE id=${requestId}::uuid`;
    const operation = record(operationRow, ['id', 'actorId', 'operationId', 'cardId', 'action', 'inputHash']);
    const [identity] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_actor(${admission.actorId}::uuid,NULL::text)`;
    const [workspaceControl] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceControl" WHERE id='active'`;
    const [sourceControl] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceSourceControl" WHERE id='active'`;
    check(identity?.id === admission.actorId && identity.role === 'REVIEWER' && identity.revokedAt === null
        && identity.accessVersion === admission.accessVersion, 'WORKSPACE_MACHINE_ACTOR_CHANGED');
    check(workspaceControl?.enabled && workspaceControl.astraEnabled && workspaceControl.claimsEnabled && workspaceControl.preparationEnabled
        && workspaceControl.mode === control.mode && workspaceControl.releaseSha === control.releaseSha
        && workspaceControl.cohortId === workspace.cohortId && workspaceControl.maxCards === 10
        && instant(workspaceControl.expiresAt) && workspaceControl.expiresAt > now
        && sourceControl?.enabled && sourceControl.mode === workspaceControl.mode
        && sourceControl.releaseSha === workspaceControl.releaseSha && sourceControl.configHash === workspaceControl.configHash
        && sourceControl.cohortId === workspace.cohortId && sourceControl.pilotId === policy.pilotId
        && sourceControl.sourceConfigHash === admission.sourceConfigHash && SHA.test(admission.sourceConfigHash ?? '')
        && instant(sourceControl.expiresAt) && sourceControl.expiresAt > now, 'WORKSPACE_MACHINE_SOURCE_NOT_ENABLED');
    const claim = workspace.claim, intent = operation.result, binding = intent?.binding, machine = intent?.payload?.machine;
    check(workspace.id === admission.cardId && workspace.specimenId === admission.specimenId
        && ['IN_PROGRESS', 'NEEDS_ATTENTION'].includes(workspace.state) && claim?.kind === 'ASTRA'
        && claim.actorId === identity.id && claim.fence === workspace.claimFence && claim.captureHash === workspace.captureHash
        && claim.captureRevision === workspace.captureRevision && UUID.test(claim.runId ?? '')
        && operation.id === requestId && operation.cardId === workspace.id && operation.actorId === identity.id
        && operation.action === 'MACHINE_SOURCE_ACTION' && intent?.phase === 'REQUESTED'
        && intent.requestId === requestId && intent.action === 'INITIALIZE_REPORT'
        && binding?.captureHash === workspace.captureHash && binding.captureRevision === workspace.captureRevision
        && binding.claimFence === workspace.claimFence && integer(binding.workflowRevision) && binding.workflowRevision <= workspace.revision
        && workspace.workspace?.pending?.requestId === requestId && workspace.workspace.pending.action === 'INITIALIZE_REPORT'
        && same(workspace.workspace.pending.binding, binding) && machine?.runId === claim.runId,
    'WORKSPACE_MACHINE_SCOPE_CHANGED');
    const evidence = checked(admission.evidenceCanonical, admission.evidenceHash, 131072);
    const proof = checked(admission.admissionCanonical, admission.admissionHash, 16384);
    keys(proof, ['version', 'requestId', 'workspaceCardId', 'actorKind', 'captureHash', 'claimFence', 'sourceRevision',
        'sourceHash', 'evidenceHash', 'sourceConfigHash', 'gradingPolicyHash', 'preparation']);
    keys(proof.preparation, ['preparationRelease', 'frontAuthorityHash', 'backAuthorityHash']);
    check(proof.version === 'atlas-workspace-source-admission-v1' && proof.requestId === requestId
        && proof.workspaceCardId === workspace.id && proof.actorKind === 'MACHINE'
        && proof.captureHash === workspace.captureHash && proof.claimFence === workspace.claimFence
        && proof.sourceRevision === admission.sourceRevision && proof.sourceHash === admission.sourceHash
        && proof.evidenceHash === admission.evidenceHash && proof.sourceConfigHash === admission.sourceConfigHash
        && proof.gradingPolicyHash === bridge.gradingPolicyHash && SHA.test(proof.sourceHash ?? '')
        && proof.preparation.preparationRelease && typeof proof.preparation.preparationRelease === 'object'
        && !Array.isArray(proof.preparation.preparationRelease)
        && ['frontAuthorityHash', 'backAuthorityHash'].every(key => SHA.test(proof.preparation[key] ?? ''))
        && evidence.sourceRevision === admission.sourceRevision && evidence.sourceId === admission.sourceId
        && evidence.sourceOwnerId === admission.sourceOwnerId
        && ['sourceType', 'sourceId', 'sourceOwnerId'].every(key => admission[key] === workspace.source?.[key])
        && admission.sourceId === `atlas-${workspace.id}` && admission.sourceOwnerId === `atlas-staff-${workspace.creatorId}`,
    'WORKSPACE_MACHINE_ADMISSION_CHANGED');
    const [permit] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_permit(${requestId}::uuid)`;
    const [run] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_run(${claim.runId}::uuid)`;
    check(permit?.requestId === requestId && permit.state === 'ACTIVE' && permit.cardId === workspace.id
        && permit.runId === run?.id && run.id === claim.runId && run.phase === 'CAPTURE_REVIEW' && run.state === 'PREPARATION_READY'
        && run.workspaceCardId === workspace.id && run.specimenId === null && run.initializationId === null
        && run.pilotId === policy.pilotId && run.runtimeHash === operator.configHash && run.policyHash === operator.policyHash
        && run.gradingPolicyHash === bridge.gradingPolicyHash && run.evidenceHash === workspace.captureHash
        && run.revision === permit.runRevision && run.revision === machine.runRevision && run.leaseFence === machine.leaseFence
        && ['RUNNING', 'PAUSE_REQUESTED'].includes(run.controlState) && ['CONTINUOUS', 'STEP'].includes(run.executionMode)
        && permit.mode === run.executionMode && permit.runControlRevision === machine.runControlRevision
        && run.controlRevision >= permit.runControlRevision && (permit.mode !== 'STEP' || run.stepBudget === 0)
        && permit.claimFence === workspace.claimFence && permit.captureHash === workspace.captureHash
        && permit.selectionStepId === machine.selectionStepId && permit.selectionResultHash === machine.selectionResultHash
        && instant(run.deadlineAt) && run.deadlineAt > now, 'WORKSPACE_MACHINE_PERMIT_CHANGED');
    const [step] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorStep" WHERE id=${permit.selectionStepId}::uuid`;
    check(step?.id === permit.selectionStepId && step.runId === run.id && step.revision === run.revision
        && step.toolName === 'submit_capture_preparation' && step.resultHash === permit.selectionResultHash,
    'WORKSPACE_MACHINE_SELECTION_CHANGED');
    const selected = checked(step.resultCanonical, step.resultHash), submitted = checked(step.requestCanonical, step.requestHash, 65536);
    check(submitted.disposition === 'READY_FOR_PREPARATION' && submitted.runId === run.id
        && submitted.expectedRevision + 1 === run.revision && submitted.manifestHash === run.manifestHash
        && submitted.evidenceHash === workspace.captureHash && selected.binding?.runId === run.id
        && selected.binding.expectedRevision === run.revision && selected.binding.manifestHash === run.manifestHash
        && selected.binding.evidenceHash === workspace.captureHash
        && selected.result?.version === 'atlas-machine-capture-selection-v1' && selected.result.actor === 'MACHINE'
        && selected.result.status === 'PENDING_ORIGINAL_PREPARATION' && selected.result.runId === run.id
        && selected.result.workspaceCardId === workspace.id && selected.result.claimId === claim.id
        && selected.result.claimFence === workspace.claimFence && selected.result.captureHash === workspace.captureHash
        && selected.result.captureRevision === workspace.captureRevision && selected.result.workflowRevision === claim.workflowRevision
        && selected.result.manifestHash === run.manifestHash, 'WORKSPACE_MACHINE_SELECTION_CHANGED');
    const [scope] = await tx.$queryRaw`SELECT atlas_staff.operator_capture_current(${run.id}::uuid) AS current,
        (SELECT count(*)::integer FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=${run.id}::uuid
            AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN')) AS pending`;
    check(scope?.current === true && scope.pending === 0, 'WORKSPACE_MACHINE_CAPTURE_CHANGED');
    return { ...context, admission, workspace, identity, operation, permit, run, step, workspaceControl, sourceControl };
}

/** Called only inside the private source host's existing authorized transaction,
 * after admit_workspace_source records the unchanged original capture. The
 * caller owns commit and the retained source permit. This neither dispatches a
 * detector nor settles source costs, and replays cannot create a second job. */
export async function enqueueWorkspaceMachineInitializationInTransaction(tx, config, ports, input) {
    keys(input, ['requestId']); check(UUID.test(input.requestId ?? '') && typeof tx?.$queryRaw === 'function'
        && typeof tx?.$executeRaw === 'function', 'WORKSPACE_MACHINE_ADMISSION_REQUIRED');
    const requestId = input.requestId, executor = new MachineInitializationBridge({ client: null, config, ports });
    const context = await admissionContext(await executor.controls(tx), requestId);
    const { admission, workspace, identity, operator, bridge, control, policy, operatorPolicy, now, run, step } = context;
    const [existing] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffMachineInitialization" WHERE id=${requestId}::uuid FOR UPDATE`;
    if (existing) {
        check(existing.id === requestId && existing.workspaceSourceRequestId === requestId && existing.admissionKind === 'WORKSPACE_CAPTURE'
            && existing.specimenId === admission.specimenId && existing.runtimeHash === config.runtimeHash
            && existing.pilotId === policy.pilotId && existing.admittedById === admission.actorId
            && existing.admittedAccessVersion === admission.accessVersion && existing.admittedSessionHash === null && existing.operationsGrantId === null
            && existing.admissionReason === reason && existing.authorizationEvidenceHash === admission.admissionHash
            && existing.evidenceHash === admission.evidenceHash && existing.sourceHash === admission.sourceHash
            && existing.sourceRevision === admission.sourceRevision, 'MACHINE_ADMISSION_CONFLICT'); return existing;
    }
    const [card] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffSpecimen" WHERE id=${admission.specimenId}::uuid FOR UPDATE`;
    const subject = card && await pilotSubject(tx, policy, card);
    check(card && subject?.workspaceCardId === workspace.id && card.analysisRevision === 0 && integer(card.draftRevision)
        && card.sourceType === (bridge.mode === 'PRODUCTION' ? 'SPEEDSTER' : 'LOCAL_FIXTURE')
        && ['sourceType', 'sourceId', 'sourceOwnerId', 'evidenceCanonical', 'evidenceHash'].every(key => card[key] === admission[key]),
    'MACHINE_INITIALIZATION_STALE');
    const deadlineAt = new Date(Math.min(+now + policy.deadlineMs, +new Date(policy.expiresAt), +new Date(operatorPolicy.expiresAt),
        +context.workspaceControl.expiresAt, +context.sourceControl.expiresAt, +run.deadlineAt));
    check(deadlineAt > now, 'MACHINE_INITIALIZATION_STALE');
    const job = { id: requestId, specimenId: card.id, pilotId: policy.pilotId, gradingOperationId: randomUUID(), runtimeHash: config.runtimeHash,
        evidenceHash: card.evidenceHash, operatorPolicyHash: operator.policyHash, bridgePolicyHash: bridge.policyHash,
        gradingPolicyHash: bridge.gradingPolicyHash, sourceRevision: admission.sourceRevision, sourceHash: admission.sourceHash,
        expectedAnalysisRevision: 0, expectedReviewRevision: card.draftRevision, controlRevision: control.revision,
        operatorRevision: operator.revision, bridgeRevision: bridge.revision, workspaceSourceRequestId: requestId, admissionKind: 'WORKSPACE_CAPTURE',
        admittedById: identity.id, admittedSessionHash: null, admittedAccessVersion: identity.accessVersion, operationsGrantId: null,
        admissionReason: reason, authorizationEvidenceHash: admission.admissionHash, deadlineAt, createdAt: now,
        state: 'QUEUED', dispatchedAt: null, finishedAt: null, failureCode: null };
    await executor.noOtherWork({ ...context, card, job });
    const source = await executor.source({ ...context, card, job });
    await ports.assertFreshDetection(tx, source);
    const usage = await pilotUsage(tx, policy, card), reserve = BigInt(policy.reservationPerOperationMicroUsd);
    check(pilotDollarLimitsAllow(policy, usage, reserve) && usage.operations < policy.maxOperationsPerCard,
    'PILOT_BUDGET_EXHAUSTED');
    await tx.$executeRaw`INSERT INTO atlas_staff."StaffMachineInitialization"
        (id,"specimenId","pilotId","gradingOperationId","runtimeHash","evidenceHash","operatorPolicyHash","bridgePolicyHash","gradingPolicyHash",
         "sourceRevision","sourceHash","expectedAnalysisRevision","expectedReviewRevision","controlRevision","operatorRevision","bridgeRevision",
         "admittedById","admittedSessionHash","admittedAccessVersion","operationsGrantId","admissionReason","authorizationEvidenceHash",
         "workspaceSourceRequestId","admissionKind","deadlineAt","createdAt",state)
        VALUES (${job.id}::uuid,${job.specimenId}::uuid,${job.pilotId}::uuid,${job.gradingOperationId}::uuid,${job.runtimeHash},${job.evidenceHash},
            ${job.operatorPolicyHash},${job.bridgePolicyHash},${job.gradingPolicyHash},${job.sourceRevision},${job.sourceHash},0,
            ${job.expectedReviewRevision},${job.controlRevision},${job.operatorRevision},${job.bridgeRevision},${job.admittedById}::uuid,
            NULL,${job.admittedAccessVersion},NULL,${job.admissionReason},${job.authorizationEvidenceHash},${requestId}::uuid,'WORKSPACE_CAPTURE',
            (${deadlineAt}::timestamptz AT TIME ZONE 'UTC'),(${now}::timestamptz AT TIME ZONE 'UTC'),'QUEUED')`;
    const requestCanonical = canonical(requests(job, card));
    await tx.$executeRaw`INSERT INTO atlas_staff."StaffGradingOperation"
        (id,"specimenId","operationId","actorKind","actorId","sessionHash","assignmentFence","controlRevision","evidenceHash",
         "expectedAnalysisRevision","expectedReviewRevision","requestCanonical","inputHash",state,"dispatchClaimId","leaseFence","leaseExpiresAt","createdAt")
        VALUES (${job.gradingOperationId}::uuid,${card.id}::uuid,${requestId},'ASTRA',${`ASTRA_INITIALIZE:${requestId}`},NULL,NULL,
            ${control.revision},${card.evidenceHash},0,${card.draftRevision},${requestCanonical},${digest(requestCanonical)},'RESERVED',${randomUUID()}::uuid,1,
            (${deadlineAt}::timestamptz AT TIME ZONE 'UTC'),(${now}::timestamptz AT TIME ZONE 'UTC'))`;
    await tx.$executeRaw`INSERT INTO atlas_staff."StaffAudit" (id,event,"subjectId","actorId",details,"createdAt")
        VALUES (${randomUUID()}::uuid,'WORKSPACE_MACHINE_INITIALIZATION_ADMITTED',${card.id},${identity.id}::uuid,
        ${canonical({ jobId: job.id, operationId: job.gradingOperationId, requestId, admissionHash: admission.admissionHash,
            runId: run.id, runtimeHash: job.runtimeHash, workspaceCardId: workspace.id, selectionStepId: step.id, selectionResultHash: step.resultHash,
            evidenceHash: job.evidenceHash, accessVersion: identity.accessVersion, controlRevision: control.revision,
            reason, authorizationEvidenceHash: job.authorizationEvidenceHash })},(${now}::timestamptz AT TIME ZONE 'UTC'))`;
    return job;
}
