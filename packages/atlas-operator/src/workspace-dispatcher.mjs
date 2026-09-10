import { z } from 'zod';
import { canonical, digest, parsePilotPolicy, requireBridge as check } from '@atlas/service-bridge/protocol';
import { assertWorkspacePrivileges } from '@atlas/service-bridge/workspace-privileges';
import { assertCaptureScope } from './capture-protocol.mjs';
import { parseControlPolicy, toolsForRun } from './policy.mjs';
import { operatorControl, ACTIVE_RUN_STATES } from './workflow-control.mjs';
import { enqueueWorkspaceReportSuccessorInTransaction } from './ledger.mjs';
import { createWorkspaceSourceRunner } from './workspace-source-runner.mjs';

const uuid = z.uuidv4(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().min(1).max(2147483646);
const commandSchema = z.strictObject({ runId: uuid, commandId: uuid });
const inputSchema = commandSchema.extend({ signal: z.instanceof(AbortSignal).optional() });
const configSchema = z.strictObject({ mode: z.enum(['PRODUCTION', 'LOCAL_FIXTURE']),
    releaseSha: z.string().regex(/^[a-f0-9]{40}$/), buildHash: hash, configHash: hash, providerBindingHash: hash });
const safeCode = z.string().regex(/^(?:ASTRA|WORKSPACE)_[A-Z0-9_]{1,69}$/);
const operatorReply = z.strictObject({ runId: uuid.nullable(),
    state: z.enum(['READY_FOR_HUMAN', 'PREPARATION_READY', 'NEEDS_RECAPTURE', 'NEEDS_EXPERT', 'FAILED', 'NOT_CLAIMED',
        'RECONCILIATION_REQUIRED', 'PAUSED', 'TAKEN_OVER', 'NOT_STARTED', 'INACTIVE', 'CONFIGURATION_REJECTED']),
    code: safeCode.nullable(), stepsApplied: z.number().int().min(0).max(64),
    receipts: z.strictObject({ total: z.number().int().min(0).max(100), persisted: z.number().int().min(0).max(100),
        unconfirmed: z.number().int().min(0).max(100), pending: z.number().int().min(0).max(100) }),
    disconnect: z.enum(['CLOSED', 'NOT_OPENED', 'UNCONFIRMED']), exitCode: z.number().int().min(0).max(255) });
const sourceReply = z.strictObject({ runId: uuid, actions: z.number().int().min(0).max(3),
    state: z.enum(['READY', 'PAUSED', 'TAKEN_OVER', 'NEEDS_ATTENTION', 'HELD', 'STOPPED']),
    reportRunId: uuid.optional(), requestId: uuid.optional(), code: safeCode.optional() });
const same = (left, right) => canonical(left) === canonical(right);
const instant = value => value instanceof Date && Number.isFinite(+value);
const codeOf = error => safeCode.safeParse(error?.code).success ? error.code : 'ASTRA_DISPATCH_OUTCOME_UNCONFIRMED';
function checked(text, contentHash, maximum = 262144) {
    check(typeof text === 'string' && Buffer.byteLength(text) <= maximum && hash.safeParse(contentHash).success
        && digest(text) === contentHash, 'ASTRA_DISPATCH_RECORD_CHANGED');
    let value; try { value = JSON.parse(text); } catch { check(false, 'ASTRA_DISPATCH_RECORD_CHANGED'); }
    check(value && typeof value === 'object' && canonical(value) === text, 'ASTRA_DISPATCH_RECORD_CHANGED'); return value;
}
function cardRecord(row) {
    const card = checked(row?.canonical, row?.contentHash);
    check(['id', 'creatorId', 'cohortId', 'revision', 'state', 'stage', 'specimenId'].every(key => card[key] === row[key]),
        'ASTRA_DISPATCH_RECORD_CHANGED'); return card;
}
function operationRecord(row) {
    const event = checked(row?.canonical, row?.contentHash);
    check(['id', 'actorId', 'operationId', 'cardId', 'action', 'inputHash'].every(key => event[key] === row[key]),
        'ASTRA_DISPATCH_RECORD_CHANGED'); return event;
}
function requestFor(card, run) {
    return { cardId: card.id, scope: { actorKind: 'MACHINE', actorId: card.claim.actorId, accessVersion: card.claim.accessVersion,
        controlRevision: card.claim.controlRevision, runId: run.id, runRevision: run.revision, leaseFence: run.leaseFence,
        runControlRevision: run.controlRevision }, binding: { captureRevision: card.captureRevision,
        captureHash: card.captureHash, claimFence: card.claimFence, workflowRevision: card.revision } };
}

/** Private composition for one already-admitted run. All dependency functions
 * are fixed by verified bootstrap code, never supplied by a request or model.
 * executeOperator must close over executeOperatorRun's exact verified manifest,
 * artifact and separate OPERATOR client factory. The supplied client has only
 * COORDINATOR grants; it never receives provider or original-storage authority.
 *
 * This does not claim a waiting workspace, alter a control, poll, retry a lost
 * effect, or approve a result. One invocation performs at most one capture run,
 * one bounded source continuation (three actions), and one linked report run.
 */
export function createWorkspaceDispatcher({ client, authority, source, operatorConfig, executeOperator }, {
    makeSourceRunner = createWorkspaceSourceRunner,
    verifySuccessor = enqueueWorkspaceReportSuccessorInTransaction,
} = {}) {
    const config = Object.freeze(configSchema.parse(operatorConfig));
    check(client && typeof client.$transaction === 'function' && typeof executeOperator === 'function'
        && ['controls', 'current', 'loadInTransaction', 'recheck'].every(key => typeof authority?.[key] === 'function')
        && ['prepare', 'finalize', 'status'].every(key => typeof source?.[key] === 'function')
        && typeof makeSourceRunner === 'function' && typeof verifySuccessor === 'function', 'ASTRA_DISPATCH_CONFIGURATION_REQUIRED');
    const privateAuthority = Object.freeze(Object.fromEntries(['controls', 'current', 'loadInTransaction', 'recheck']
        .map(key => [key, authority[key].bind(authority)])));
    const privateSource = Object.freeze(Object.fromEntries(['prepare', 'finalize', 'status'].map(key => [key, source[key].bind(source)])));
    const transact = client.$transaction.bind(client);
    const coordinator = Object.freeze({ $transaction(work) {
        return transact(async tx => {
            await assertWorkspacePrivileges(tx, 'COORDINATOR');
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const result = await work(tx); await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
        }, { maxWait: 5000, timeout: 10000 });
    } });
    const continuation = makeSourceRunner({ client: coordinator, authority: privateAuthority, source: privateSource, operatorConfig: config,
        async authorizeCommand(tx, { run, card, intent, commandId }) {
            const command = await savedCommand(tx, commandId, run, run, card);
            if (intent) {
                const machine = intent.result?.payload?.machine;
                check(machine?.runId === run.id && machine.runControlRevision === command.revision
                    && (command.mode !== 'STEP' || machine.permitOperationId === command.id)
                    && (!command.later || command.later.result.action === 'PAUSE'), 'ASTRA_DISPATCH_COMMAND_CHANGED');
            } else check(!command.later && command.mode === run.executionMode && command.revision === run.controlRevision,
                'ASTRA_DISPATCH_COMMAND_CHANGED');
        } });
    check(continuation && typeof continuation.run === 'function', 'ASTRA_DISPATCH_CONFIGURATION_REQUIRED');
    const continueSource = continuation.run.bind(continuation);

    async function runRow(tx, runId) {
        const [run] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_run(${runId}::uuid)`;
        check(run && run.id === runId && uuid.safeParse(run.workspaceCardId).success
            && integer.safeParse(run.revision).success && Number.isSafeInteger(run.leaseFence) && run.leaseFence >= 0,
        'ASTRA_DISPATCH_RUN_NOT_ADMITTED'); return run;
    }
    function validateRun(run, context, live = true) {
        const { control, bridge, policy, budget, now } = context;
        check(['CAPTURE_REVIEW', 'REPORT_REVIEW'].includes(run.phase) && run.runtimeHash === config.configHash
            && run.policyHash === control.policyHash && run.policyCanonical === control.policyCanonical
            && run.gradingPolicyHash === bridge.gradingPolicyHash && run.pilotId === policy.pilotId
            && budget.workspaceCardIds.includes(run.workspaceCardId) && instant(run.deadlineAt) && (!live || run.deadlineAt > now),
        'ASTRA_DISPATCH_RUN_NOT_CURRENT');
        toolsForRun(policy, run); operatorControl(run);
        checked(run.inputCanonical, run.inputHash, 4 * 1024 * 1024);
        return checked(run.manifestCanonical, run.manifestHash);
    }
    async function reportProof(tx, context, run, card) {
        check(run.phase === 'REPORT_REVIEW' && uuid.safeParse(run.captureRunId).success
            && uuid.safeParse(run.initializationId).success && run.specimenId === card.id && card.specimenId === card.id
            && !card.workspace?.pending, 'ASTRA_DISPATCH_SUCCESSOR_UNCONFIRMED');
        const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceOperation"
            WHERE "actorId"=${card.claim.actorId}::uuid AND "operationId"=${`machine-report-${run.initializationId}`}`;
        const event = operationRecord(row), result = event.result;
        check(event.cardId === card.id && event.action === 'MACHINE_REPORT_SUCCESSOR' && result?.actor === 'MACHINE'
            && result.sourceRequestId === run.initializationId && result.captureRunId === run.captureRunId
            && result.reportRunId === run.id && result.claimFence === card.claimFence,
        'ASTRA_DISPATCH_SUCCESSOR_UNCONFIRMED');
        const previous = await runRow(tx, run.captureRunId);
        validateRun(previous, context, false);
        check(previous.phase === 'CAPTURE_REVIEW' && previous.state === 'PREPARATION_READY'
            && previous.workspaceCardId === card.id && previous.evidenceHash === card.captureHash,
        'ASTRA_DISPATCH_SUCCESSOR_UNCONFIRMED');
        // The report row and exact claim/event already exist. Only the existing
        // helper's replay branch is reachable: it rechecks original admission,
        // job, source settlement, permit, actor and immutable handoff proof.
        const retained = await verifySuccessor(tx, config, { requestId: run.initializationId });
        check(retained?.id === run.id && retained.captureRunId === previous.id && retained.workspaceCardId === card.id
            && retained.initializationId === run.initializationId && retained.runtimeHash === config.configHash,
        'ASTRA_DISPATCH_SUCCESSOR_UNCONFIRMED');
    }
    async function savedCommand(tx, commandId, requested, run, card) {
        const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceOperation" WHERE id=${commandId}::uuid`;
        const event = operationRecord(row), value = event.result;
        const initial = event.action === 'claim', claim = initial ? value?.claim : value?.priorClaim;
        check(event.id === commandId && event.actorId === card.claim.actorId && event.cardId === card.id
            && (initial || event.action === 'OPERATOR_CONTROL' && ['RESUME', 'STEP'].includes(value?.action))
            && claim?.kind === 'ASTRA' && ['id', 'actorId', 'accessVersion', 'controlRevision', 'fence', 'captureRevision', 'captureHash', 'workflowRevision']
                .every(key => claim[key] === card.claim[key])
            && claim.runId === requested.id && (initial ? value.cardId === card.id && value.revision === claim.workflowRevision
                && requested.phase === 'CAPTURE_REVIEW' : value.runId === requested.id && value.claimFence === card.claimFence
                    && ['QUEUED', 'RUNNING'].includes(value.control?.state)), 'ASTRA_DISPATCH_COMMAND_CHANGED');
        const mode = initial ? claim.mode : value.control?.mode, revision = initial ? 1 : value.runControlRevision;
        const runRevision = initial ? 1 : value.runRevision, createdAt = new Date(event.createdAt);
        check(['CONTINUOUS', 'STEP'].includes(mode) && integer.safeParse(revision).success && integer.safeParse(runRevision).success
            && requested.controlRevision >= revision && requested.revision >= runRevision && instant(createdAt)
            && (initial || mode === (value.action === 'STEP' ? 'STEP' : 'CONTINUOUS')), 'ASTRA_DISPATCH_COMMAND_CHANGED');
        const rows = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceOperation"
            WHERE "cardId"=${card.id}::uuid AND action='OPERATOR_CONTROL'
                AND ((canonical::jsonb#>>'{result,runId}'=${requested.id}
                    AND (canonical::jsonb#>>'{result,runControlRevision}')::integer>${revision})
                    OR (${run.id}::uuid<>${requested.id}::uuid AND canonical::jsonb#>>'{result,runId}'=${run.id}))
            ORDER BY "createdAt" DESC,(canonical::jsonb#>>'{result,runControlRevision}')::integer DESC,id DESC LIMIT 1`;
        const later = rows[0] ? operationRecord(rows[0]) : null;
        if (later) check(later.cardId === card.id && ['PAUSE', 'RESUME', 'STEP', 'TAKE_OVER'].includes(later.result?.action)
            && later.result.claimFence === card.claimFence && later.result.priorClaim?.id === card.claim.id
            && later.result.priorClaim.captureHash === card.captureHash && later.result.priorClaim.captureRevision === card.captureRevision
            && integer.safeParse(later.result.runControlRevision).success && +new Date(later.createdAt) >= +createdAt
            && (!['RESUME', 'STEP'].includes(later.result.action) || later.actorId === card.claim.actorId
                && later.result.priorClaim.accessVersion === card.claim.accessVersion
                && later.result.priorClaim.controlRevision === card.claim.controlRevision), 'ASTRA_DISPATCH_COMMAND_CHANGED');
        return { id: commandId, hash: row.contentHash, mode, revision, runRevision, createdAt, later };
    }
    async function settledStep(tx, command, requested, card) {
        const [proof] = await tx.$queryRaw`SELECT
            (SELECT count(*)::integer FROM atlas_staff."StaffOperatorStep" s
                JOIN atlas_staff."StaffOperatorAttempt" a ON a.id=s."attemptId" AND a."runId"=s."runId"
                WHERE s."runId"=${requested.id}::uuid AND s.revision=${command.runRevision + 1}::integer
                    AND a."runRevision"=${command.runRevision}::integer AND a.state='APPLIED'
                    AND a."dispatchedAt">=(${command.createdAt}::timestamptz AT TIME ZONE 'UTC')) AS applied,
            (SELECT count(*)::integer FROM atlas_staff."StaffWorkspaceSourceActionPermit" p
                JOIN atlas_staff."StaffWorkspaceOperation" intent ON intent.id=p."requestId"
                JOIN atlas_staff."StaffWorkspaceOperation" result ON result."cardId"=intent."cardId"
                    AND result."actorId"=intent."actorId" AND result.action='MACHINE_SOURCE_RESULT'
                    AND result."operationId"='source-result_'||p."requestId"::text
                WHERE p."runId"=${requested.id}::uuid AND p."runControlRevision"=${command.revision}::integer
                    AND p."runRevision"=${command.runRevision}::integer AND p.mode='STEP' AND p.state IN ('SUCCEEDED','FAILED')
                    AND p."cardId"=${card.id}::uuid AND p."claimFence"=${card.claimFence}::integer AND p."captureHash"=${card.captureHash}
                    AND intent.action='MACHINE_SOURCE_ACTION' AND intent."actorId"=${card.claim.actorId}::uuid
                    AND intent.canonical::jsonb#>>'{result,payload,machine,permitOperationId}'=${command.id}
                    AND result.canonical::jsonb#>>'{result,actor}'='MACHINE'
                    AND result.canonical::jsonb#>>'{result,requestId}'=p."requestId"::text
                    AND result.canonical::jsonb#>>'{result,runId}'=p."runId"::text
                    AND result.canonical::jsonb#>>'{result,state}'=p.state
                    AND result.canonical::jsonb#>>'{result,captureHash}'=p."captureHash"
                    AND result.canonical::jsonb#>>'{result,claimFence}'=p."claimFence"::text) AS prepared`;
        check(proof && [proof.applied, proof.prepared].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1),
            'ASTRA_DISPATCH_COMMAND_UNCONFIRMED');
        return proof.applied + proof.prepared === 1;
    }
    async function snapshot(requestedId, commandId) {
        return coordinator.$transaction(async tx => {
            const privateContext = await privateAuthority.controls(tx), { staff, workspace, source: sourceControl, now } = privateContext;
            const [control] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffOperatorControl" WHERE id='active'`;
            const [bridge] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffGradingBridgeControl" WHERE id='active'`;
            check(control?.enabled && Object.keys(config).every(key => control[key] === config[key]), 'ASTRA_NOT_ENABLED');
            const policy = parseControlPolicy(checked(control.policyCanonical, control.policyHash));
            const budget = parsePilotPolicy(checked(bridge?.policyCanonical, bridge?.policyHash));
            check(instant(now) && staff?.enabled && bridge?.enabled && bridge.mode === config.mode && staff.mode === config.mode
                && staff.gradingPolicyHash === bridge.gradingPolicyHash && policy.pilotId === budget.pilotId
                && sourceControl?.pilotId === budget.pilotId && budget.version === 'atlas-workspace-bridge-policy-v1'
                && +new Date(policy.expiresAt) > +now && +new Date(budget.expiresAt) > +now
                && workspace?.claimsEnabled && workspace.astraEnabled && workspace.preparationEnabled, 'ASTRA_PILOT_NOT_ACTIVE');
            const [{ count }] = await tx.$queryRaw`SELECT atlas_staff.operator_workspace_count(${budget.pilotId}::uuid) AS count`;
            check(count === 10, 'ASTRA_TEN_CARDS_REQUIRED');
            const context = { ...privateContext, control, bridge, policy, budget };
            const requested = await runRow(tx, requestedId); validateRun(requested, context, false);
            const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_workspace_private_card(${requested.workspaceCardId}::uuid)`;
            const card = cardRecord(row), claim = card.claim;
            if (requested.controlState === 'TAKEN_OVER' && claim?.kind === 'HUMAN')
                return { state: 'TAKEN_OVER', run: requested, card };
            check(claim?.kind === 'ASTRA' && uuid.safeParse(claim.runId).success && uuid.safeParse(claim.actorId).success
                && integer.safeParse(claim.accessVersion).success && integer.safeParse(claim.controlRevision).success
                && claim.fence === card.claimFence && claim.captureHash === card.captureHash
                && claim.captureRevision === card.captureRevision && card.cohortId === workspace.cohortId,
            'ASTRA_DISPATCH_CLAIM_CHANGED');
            const run = claim.runId === requested.id ? requested : await runRow(tx, claim.runId);
            const manifest = validateRun(run, context);
            if (run.id !== requested.id) check(requested.phase === 'CAPTURE_REVIEW' && requested.state === 'PREPARATION_READY'
                && run.phase === 'REPORT_REVIEW' && run.captureRunId === requested.id && run.workspaceCardId === card.id,
            'ASTRA_DISPATCH_CLAIM_CHANGED');
            check(run.workspaceCardId === card.id, 'ASTRA_DISPATCH_CLAIM_CHANGED');
            const current = await privateAuthority.current(tx, requestFor(card, run));
            check(same(current.card, card) && current.identity?.id === claim.actorId
                && current.identity.accessVersion === claim.accessVersion && current.staff?.revision === claim.controlRevision,
            'ASTRA_DISPATCH_CLAIM_CHANGED');
            if (run.phase === 'CAPTURE_REVIEW') assertCaptureScope(run, card, manifest);
            else {
                check(manifest.version === 'atlas-operator-manifest-v1' && manifest.runId === run.id
                    && manifest.workspaceCardId === card.id && manifest.captureRunId === run.captureRunId
                    && manifest.specimenId === run.specimenId && manifest.evidenceHash === run.evidenceHash
                    && manifest.analysisRevision === run.expectedAnalysisRevision && manifest.reviewRevision === run.expectedReviewRevision,
                'ASTRA_DISPATCH_REPORT_CHANGED');
                await reportProof(tx, context, run, card);
            }
            const command = await savedCommand(tx, commandId, requested, run, card);
            const scoped = value => ({ ...value, command, run, card });
            // A later committed Start/Resume/STEP can only follow a settled
            // boundary. Recover this older command; never consume the newer one.
            if (command.later && ['RESUME', 'STEP'].includes(command.later.result.action))
                return scoped({ state: 'SETTLED', settledState: 'YIELDED', code: 'ASTRA_DISPATCH_COMMAND_SUPERSEDED' });
            const [work] = await tx.$queryRaw`SELECT
                (SELECT count(*)::integer FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=${run.id}::uuid
                    AND state IN ('RESERVED','DISPATCHED','RECEIVED','UNKNOWN')) AS attempts,
                (SELECT count(*)::integer FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=${run.id}::uuid
                    AND state IN ('DISPATCHED','RECEIVED','UNKNOWN')) AS held,
                (SELECT count(*)::integer FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "runId"=${run.id}::uuid
                    AND state IN ('ACTIVE','UNKNOWN')) AS permits,
                (SELECT count(*)::integer FROM atlas_staff."StaffWorkspaceSourceOperation" WHERE "runId"=${run.id}::uuid
                    AND state IN ('RESERVED','DISPATCHED','UNKNOWN')) AS sources,
                (SELECT count(*)::integer FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=${run.id}::uuid AND state='UNKNOWN') AS "unknownAttempts",
                (SELECT count(*)::integer FROM atlas_staff."StaffOperatorAttempt" WHERE "runId"=${run.id}::uuid AND state='UNKNOWN')
                    +(SELECT count(*)::integer FROM atlas_staff."StaffWorkspaceSourceActionPermit" WHERE "runId"=${run.id}::uuid AND state='UNKNOWN')
                    +(SELECT count(*)::integer FROM atlas_staff."StaffWorkspaceSourceOperation" WHERE "runId"=${run.id}::uuid AND state='UNKNOWN') AS unknown`;
            check(work && ['attempts', 'held', 'permits', 'sources', 'unknown', 'unknownAttempts'].every(key => Number.isSafeInteger(work[key]) && work[key] >= 0),
                'ASTRA_DISPATCH_RECORD_CHANGED');
            const controlState = operatorControl(run), pending = card.workspace?.pending;
            const leased = run.leaseOwner && (!instant(run.leaseExpiresAt) || run.leaseExpiresAt > now);
            if (run.state === 'UNKNOWN' || work.unknownAttempts > 0) return scoped({ state: 'HELD', code: 'ASTRA_WORK_UNRESOLVED' });
            if (work.held > 0) return scoped({ state: leased ? 'IN_FLIGHT' : 'HELD', code: 'ASTRA_WORK_UNRESOLVED' });
            if (controlState.state === 'TAKEN_OVER') return scoped({ state: 'TAKEN_OVER' });
            if (run.state === 'PREPARATION_READY' && run.phase === 'CAPTURE_REVIEW' && pending && work.attempts === 0) {
                const [row] = await tx.$queryRaw`SELECT * FROM atlas_staff."StaffWorkspaceOperation" WHERE id=${pending.requestId}::uuid`;
                const intent = operationRecord(row), machine = intent.result?.payload?.machine;
                check(intent.id === pending.requestId && intent.action === 'MACHINE_SOURCE_ACTION' && intent.actorId === card.claim.actorId
                    && intent.cardId === card.id && machine?.runId === requested.id && machine.runControlRevision === command.revision
                    && (command.mode !== 'STEP' || machine.permitOperationId === command.id)
                    && same(intent.result.binding, pending.binding), 'ASTRA_DISPATCH_COMMAND_CHANGED');
                return scoped({ state: 'SOURCE', recovering: true });
            }
            if (work.unknown > 0) return scoped({ state: 'HELD', code: 'ASTRA_WORK_UNRESOLVED' });
            if (pending || work.permits > 0 || work.sources > 0 || run.state === 'PREPARATION_READY' && work.attempts > 0)
                return scoped({ state: 'HELD', code: 'ASTRA_SOURCE_WORK_UNRESOLVED' });
            if (work.attempts === 0 && !leased && (run.state === 'READY_FOR_HUMAN' && run.phase === 'REPORT_REVIEW'
                || ['NEEDS_RECAPTURE', 'NEEDS_EXPERT', 'FAILED'].includes(run.state)))
                return scoped({ state: 'SETTLED', settledState: run.state === 'READY_FOR_HUMAN' ? run.state : 'NEEDS_ATTENTION' });
            if (['PAUSED', 'PAUSE_REQUESTED'].includes(controlState.state)
                || controlState.mode === 'STEP' && controlState.stepBudget !== 1) {
                if (controlState.state === 'PAUSED' && work.attempts === 0 && !leased
                    && (command.later?.result.action === 'PAUSE' || command.mode === 'STEP'
                        && requested.controlRevision >= command.revision + 2 && await settledStep(tx, command, requested, card)))
                    return scoped({ state: 'SETTLED', settledState: 'PAUSED' });
                return scoped({ state: 'HELD', code: 'ASTRA_DISPATCH_COMMAND_UNCONFIRMED' });
            }
            check(!command.later && command.mode === run.executionMode
                && (run.id === requested.id ? command.revision === run.controlRevision : command.mode === 'CONTINUOUS'),
            'ASTRA_DISPATCH_COMMAND_CHANGED');
            if (run.state === 'PREPARATION_READY' && run.phase === 'CAPTURE_REVIEW') return scoped({ state: 'SOURCE', recovering: false });
            check(ACTIVE_RUN_STATES.includes(run.state), 'ASTRA_DISPATCH_RUN_NOT_CURRENT');
            if (leased) return scoped({ state: 'IN_FLIGHT', code: 'ASTRA_LEASE_BUSY' });
            return scoped({ state: 'OPERATOR' });
        });
    }

    return Object.freeze({ async admit(value) {
        const { runId, commandId } = commandSchema.parse(value);
        try {
            const current = await snapshot(runId, commandId);
            check(current.command, 'ASTRA_DISPATCH_COMMAND_CHANGED');
            return { runId, commandId, commandHash: current.command.hash, activeRunId: current.run.id, workspaceCardId: current.card.id,
                phase: current.state === 'SOURCE' ? 'SOURCE' : current.run.phase,
                state: ['OPERATOR', 'SOURCE'].includes(current.state) ? 'ADMITTED' : current.state, code: current.code ?? null };
        } catch (error) { return { runId, commandId, commandHash: null, activeRunId: null, workspaceCardId: null, phase: 'ADMISSION', state: 'HELD', code: codeOf(error) }; }
    }, async run(value) {
        const { runId, commandId, signal } = inputSchema.parse(value);
        let activeRunId = runId, phase = 'ADMISSION', operatorRuns = 0, sourceActions = 0, stepsApplied = 0;
        const result = (state, code) => ({ runId, commandId, activeRunId, phase, state, operatorRuns, sourceActions, stepsApplied, code: code ?? null });
        const observed = current => { activeRunId = current.run.id; phase = current.state === 'SOURCE' ? 'SOURCE' : current.run.phase; return current; };
        const done = current => result(current.state === 'IN_FLIGHT' ? 'HELD' : current.settledState ?? current.state, current.code);
        const stop = () => result('STOPPED', 'ASTRA_RUNNER_STOPPED');
        async function execute(current) {
            if (signal?.aborted) return stop();
            operatorRuns++;
            const reply = operatorReply.parse(await executeOperator({ runId: current.run.id,
                expectedControlRevision: current.run.controlRevision, ...(signal ? { signal } : {}) }));
            check(reply.runId === current.run.id && reply.receipts.total === reply.receipts.persisted + reply.receipts.unconfirmed + reply.receipts.pending,
                'ASTRA_DISPATCH_OPERATOR_UNCONFIRMED');
            stepsApplied += reply.stepsApplied;
            if (reply.state === 'RECONCILIATION_REQUIRED' || reply.receipts.pending || reply.receipts.unconfirmed || reply.disconnect === 'UNCONFIRMED')
                return result('HELD', reply.code ?? 'ASTRA_DISPATCH_OPERATOR_UNCONFIRMED');
            if (['INACTIVE', 'CONFIGURATION_REJECTED', 'NOT_STARTED', 'NOT_CLAIMED'].includes(reply.state))
                return result('STOPPED', reply.code ?? 'ASTRA_DISPATCH_OPERATOR_UNAVAILABLE');
            check(reply.disconnect === 'CLOSED', 'ASTRA_DISPATCH_OPERATOR_UNCONFIRMED');
            const next = observed(await snapshot(runId, commandId));
            if (signal?.aborted) return stop();
            if (['HELD', 'IN_FLIGHT', 'SETTLED', 'TAKEN_OVER'].includes(next.state)) return done(next);
            check(reply.state === 'PREPARATION_READY' && current.run.phase === 'CAPTURE_REVIEW'
                && reply.exitCode === 0 && next.state === 'SOURCE' && next.run.id === current.run.id,
            'ASTRA_DISPATCH_OPERATOR_UNCONFIRMED');
            // A newly recorded human control may already be waiting. This
            // invocation never consumes a second STEP after its first action.
            if (current.run.executionMode === 'STEP') return result('YIELDED', 'ASTRA_DISPATCH_STEP_BOUNDARY');
            return next;
        }
        try {
            if (signal?.aborted) return stop();
            let current = observed(await snapshot(runId, commandId));
            if (signal?.aborted) return stop();
            if (current.state === 'OPERATOR') {
                current = await execute(current);
                if (Object.hasOwn(current, 'operatorRuns')) return current;
            }
            if (current.state !== 'SOURCE') return done(current);
            if (signal?.aborted) return stop();
            const sourceMode = current.run.executionMode;
            const reply = sourceReply.parse(await continueSource({ runId: current.run.id, commandId, ...(signal ? { signal } : {}) }));
            sourceActions = reply.actions;
            check(reply.runId === current.run.id && (reply.state === 'READY' ? !!reply.reportRunId : reply.reportRunId === undefined),
                'ASTRA_DISPATCH_SOURCE_UNCONFIRMED');
            if (reply.state !== 'READY') return result(reply.state, reply.code);
            current = observed(await snapshot(runId, commandId));
            check(current.run.phase === 'REPORT_REVIEW' && current.run.id === reply.reportRunId,
                'ASTRA_DISPATCH_SUCCESSOR_UNCONFIRMED');
            if (signal?.aborted) return stop();
            if (current.state !== 'OPERATOR') return done(current);
            if (sourceMode === 'STEP') return result('YIELDED', 'ASTRA_DISPATCH_STEP_BOUNDARY');
            const outcome = await execute(current);
            check(Object.hasOwn(outcome, 'operatorRuns'), 'ASTRA_DISPATCH_BOUND_REACHED'); return outcome;
        } catch (error) { return result('HELD', codeOf(error)); }
    } });
}
