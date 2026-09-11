import { randomUUID } from 'node:crypto';
import { BoundaryError, deny, hash, identifier, strictObject } from '../policy.mjs';
import { canonical } from '../review-contract.mjs';
import { projectWorkspaceTiming } from '../../workspace-timing.mjs';
import { WORKSPACE_CONTROLS } from '../../workspace-contract.mjs';

const MAX_ACTIVITY = 100, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const check = (ok, code = 'WORKSPACE_OPERATOR_UNAVAILABLE', status = 503) => { if (!ok) deny(status, code); };
const preflight = (ok, code, status = 409) => { if (!ok) throw Object.assign(new BoundaryError(status, code), { outcome: 'NOT_DISPATCHED' }); };
const abandonmentDenials = Object.freeze({
    ASTRA_ABANDONMENT_AUTHORITY_REQUIRED: 403,
    ASTRA_ABANDONMENT_FRESH_OPERATIONS_REQUIRED: 403,
    ASTRA_ABANDONMENT_NOT_AVAILABLE: 409,
    ASTRA_ABANDONMENT_REVIEW_CHANGED: 409,
});
const instant = value => { const time = new Date(value); check(Number.isFinite(+time)); return time.toISOString(); };
const boundedText = (value, max = 500) => {
    if (typeof value !== 'string') return null;
    // Observations are untrusted, bounded display content. Transport URLs,
    // private local paths and credential-looking strings are never a finding.
    if (/(?:https?:\/\/|data:|file:\/\/|\/Users\/|\/root\/|[A-Z]:\\|sk-[A-Za-z0-9_-]{8}|Bearer\s)/i.test(value))
        return 'Recorded text is withheld because it contains private transport details.';
    return value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max).trim() || null;
};
const positive = value => Number.isSafeInteger(value) && value > 0;
const readCanonical = (text, digest, limit) => {
    check(typeof text === 'string' && Buffer.byteLength(text) <= limit && SHA.test(digest ?? '') && hash(text) === digest);
    let value; try { value = JSON.parse(text); } catch { check(false); }
    check(canonical(value) === text); return value;
};
const safeRect = value => value && ['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(value[k])
    && value[k] >= (['width', 'height'].includes(k) ? 1 : 0) && value[k] <= 20_000)
    ? Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, value[k]])) : null;
const unitQuad = value => Array.isArray(value) && value.length === 4 && value.every(p => p
    && ['x', 'y'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 1))
    ? value.map(({ x, y }) => ({ x, y })) : null;
const measurements = value => {
    if (!value || !['FRONT', 'BACK'].includes(value.side) || !value.borders
        || !['leftMm', 'rightMm', 'topMm', 'bottomMm'].every(k => Number.isFinite(value.borders[k]) && value.borders[k] >= 0)
        || !['leftRightBalance', 'topBottomBalance'].every(k => Array.isArray(value[k]) && value[k].length === 2
            && value[k].every(n => Number.isFinite(n) && n >= 0 && n <= 100))
        || !Number.isFinite(value.score) || value.score < 1 || value.score > 10) return null;
    return { side: value.side, borders: Object.fromEntries(['leftMm', 'rightMm', 'topMm', 'bottomMm'].map(k => [k, value.borders[k]])),
        leftRightBalance: [...value.leftRightBalance], topBottomBalance: [...value.topBottomBalance], score: value.score };
};
const evidenceRef = value => value && UUID.test(value.assetId ?? '') && SHA.test(value.sha256 ?? value.sourceSha256 ?? '')
    && ['FRONT', 'BACK'].includes(value.side) ? { assetId: value.assetId, sha256: value.sha256 ?? value.sourceSha256, side: value.side,
        ...(safeRect(value.rect) ? { rect: safeRect(value.rect) } : {}) } : null;
const stages = Object.freeze({ read_original_photos: 'PHOTOS', propose_capture_identity: 'IDENTITY',
    propose_physical_boundary: 'PREPARATION', submit_capture_preparation: 'PREPARATION', read_card_report: 'REPORT', inspect_region: 'INSPECTION', inspect_original: 'PREPARATION',
    inspect_card_geometry: 'PREPARATION', measure_centering: 'CENTERING', inspect_finding: 'INSPECTION',
    propose_identity: 'IDENTITY', propose_finding_change: 'INSPECTION', submit_for_human_review: 'REVIEW' });
const summaries = Object.freeze({ read_original_photos: 'Inspected the verified original Front and Back photographs.',
    propose_capture_identity: 'Proposed card details from the original photographs.',
    propose_physical_boundary: 'Proposed a physical card boundary for original preparation.',
    submit_capture_preparation: 'Recorded machine selections for original preparation; worker validation is still required.', read_card_report: 'Read the saved deterministic report.', inspect_region: 'Inspected a saved image region.',
    inspect_original: 'Inspected an original photograph.', inspect_card_geometry: 'Read the saved card boundaries.',
    measure_centering: 'Calculated centering from the saved boundaries.', inspect_finding: 'Inspected a recorded finding and its measurements.',
    propose_identity: 'Proposed card details for human review.', propose_finding_change: 'Proposed a finding change for human review.',
    submit_for_human_review: 'Submitted the saved draft for human review.' });

/** Takes only immutable step projections from the database function. It never
 * loads run continuations, provider receipts or dispatch request bodies. A
 * malformed row fails closed rather than becoming plausible-looking progress. */
export function projectWorkspaceActivity(rows) {
    check(Array.isArray(rows) && rows.length <= MAX_ACTIVITY);
    return rows.map(row => {
        check(UUID.test(row.id ?? '') && UUID.test(row.runId ?? '') && positive(row.revision)
            && Object.hasOwn(stages, row.toolName));
        if (row.unavailableReason === 'OVERSIZED_RECORDED_STEP') return { id: row.id, at: instant(row.createdAt), actor: 'ASTRA',
            stage: stages[row.toolName], type: row.toolName, runId: row.runId, revision: row.revision, evidence: [], status: 'UNAVAILABLE',
            summary: 'This recorded action is too large to display here. Its saved evidence remains retained.' };
        check(row.unavailableReason === undefined || row.unavailableReason === null);
        const request = readCanonical(row.requestCanonical, row.requestHash, 65_536);
        const output = readCanonical(row.resultCanonical, row.resultHash, 2 * 1024 * 1024);
        check(request.runId === row.runId && positive(request.expectedRevision) && request.expectedRevision + 1 === row.revision
            && output.binding?.runId === row.runId && output.binding.expectedRevision === row.revision
            && output.binding.evidenceHash === request.evidenceHash && output.binding.manifestHash === request.manifestHash);
        const refs = row.toolName === 'inspect_region' || row.toolName === 'inspect_original' ? [request]
            : ['read_card_report','read_original_photos'].includes(row.toolName) ? (output.result?.assets ?? []).filter(a => a.view === (row.toolName === 'read_original_photos' ? 'ORIGINAL' : 'RECTIFIED'))
            : ['propose_identity','propose_capture_identity'].includes(row.toolName) ? (request.fields ?? []).flatMap(f => f.evidence ?? [])
            : request.evidence ?? [];
        check(Array.isArray(refs) && refs.length <= 108);
        const evidence = [...new Map(refs.map(evidenceRef).filter(Boolean).map(ref => [canonical(ref), ref])).values()].slice(0, 12);
        const proposal = row.toolName.startsWith('propose_') ? { stepId: row.id, toolName: row.toolName,
            ...(['propose_identity','propose_capture_identity'].includes(row.toolName) ? { fields: (request.fields ?? []).slice(0, 9).map(field => ({
                field: boundedText(field.field, 40), value: boundedText(field.value, 160) })) }
                : row.toolName === 'propose_physical_boundary' ? { side: ['FRONT','BACK'].includes(request.side) ? request.side : null,
                    corners: unitQuad(request.corners), matColor: ['BLACK','WHITE','MAGENTA'].includes(request.matColor) ? request.matColor : null }
                : { findingId: boundedText(request.findingId, 180), action: boundedText(request.action, 40),
                    reason: boundedText(request.reason, 40), defectType: boundedText(request.defectType, 80), rect: safeRect(request.rect) }),
            summary: boundedText(request.summary) } : null;
        const decision = row.decision && ['ACCEPTED', 'REJECTED', 'INSPECTED'].includes(row.decision.decision)
            && positive(row.decision.analysisRevision) ? { decision: row.decision.decision,
                analysisRevision: row.decision.analysisRevision, reason: boundedText(row.decision.reason, 1000) } : null;
        const unavailableRegion = row.toolName === 'inspect_region' && output.result?.status === 'REGION_NOT_AVAILABLE' && output.result?.code === 'ASTRA_CROP_OUTSIDE_SOURCE';
        const attention = row.toolName === 'submit_for_human_review' && request.disposition !== 'READY_FOR_REVIEW'
            || row.toolName === 'submit_capture_preparation' && request.disposition !== 'READY_FOR_PREPARATION';
        const measurement = row.toolName === 'measure_centering' ? measurements(output.result) : null;
        const geometry = row.toolName === 'inspect_card_geometry' ? { side: ['FRONT','BACK'].includes(request.side) ? request.side : null,
            corners: unitQuad(output.result?.corners), centeringQuad: unitQuad(output.result?.centeringQuad) } : null;
        const selection = row.toolName === 'submit_capture_preparation' && output.result?.actor === 'MACHINE'
            && output.result.status === 'PENDING_ORIGINAL_PREPARATION' ? { actor: 'MACHINE', status: 'PENDING_ORIGINAL_PREPARATION',
                proposals: [output.result.identityProposal, ...(output.result.boundaries ?? []).map(b => b.proposal)]
                    .filter(p => UUID.test(p?.stepId ?? '') && SHA.test(p?.requestHash ?? ''))
                    .slice(0,3).map(p => ({ stepId:p.stepId,requestHash:p.requestHash })) } : null;
        return { id: row.id, at: instant(row.createdAt), actor: 'ASTRA', stage: stages[row.toolName], type: row.toolName,
            summary: unavailableRegion ? 'The requested area extended beyond the photograph. Astra received the image bounds to choose another area.' : boundedText(request.summary) ?? summaries[row.toolName],
            status: proposal ? 'PROPOSED' : attention ? 'NEEDS_ATTENTION' : 'RECORDED',
            runId: row.runId, revision: row.revision, evidence: unavailableRegion ? [] : evidence, ...(proposal ? { proposal, decision } : {}),
            ...(selection ? { selection } : {}), ...(measurement ? { measurements: measurement } : {}), ...(geometry ? { geometry } : {}),
            ...(row.toolName === 'inspect_finding' ? { findingId: boundedText(request.findingId, 180) } : {}),
            ...(SHA.test(request.reportHash ?? output.result?.reportHash ?? '')
                ? { reportHash: request.reportHash ?? output.result.reportHash } : {}) };
    });
}

/** Input records have already passed the workspace store's canonical/hash and
 * card-scope checks. Project only retained machine source intent/outcome facts;
 * private worker receipts and transport metadata never enter the activity DTO. */
export function projectWorkspaceSourceActivity(rows) {
    check(Array.isArray(rows) && rows.length <= MAX_ACTIVITY);
    return rows.map(row => {
        check(UUID.test(row.id ?? '') && UUID.test(row.cardId ?? '')
            && ['MACHINE_SOURCE_ACTION', 'MACHINE_SOURCE_RESULT', 'MACHINE_REPORT_SUCCESSOR'].includes(row.action));
        const value = row.result;
        check(value?.actor === 'MACHINE' && positive(value.revision));
        const base = { id: row.id, at: instant(row.createdAt), actor: 'ASTRA', type: row.action,
            revision: value.revision, evidence: [] };
        if (row.action === 'MACHINE_REPORT_SUCCESSOR') {
            check(['sourceRequestId', 'captureRunId', 'reportRunId'].every(key => UUID.test(value[key] ?? ''))
                && positive(value.claimFence));
            return { ...base, stage: 'INSPECTION', status: 'RECORDED',
                summary: 'Linked the initialized report for machine inspection.', runId: value.reportRunId,
                requestId: value.sourceRequestId, captureRunId: value.captureRunId };
        }
        check(UUID.test(value.requestId ?? '') && ['PREPARE_SIDE', 'INITIALIZE_REPORT'].includes(value.action));
        const requested = row.action === 'MACHINE_SOURCE_ACTION';
        const machine = requested ? value.payload?.machine : value;
        const side = requested ? value.payload?.side : value.side;
        check(machine && ['runId', 'selectionStepId'].every(key => UUID.test(machine[key] ?? ''))
            && SHA.test(machine.selectionResultHash ?? '')
            && (value.action === 'PREPARE_SIDE' ? ['FRONT', 'BACK'].includes(side) : side === undefined));
        const source = value.action === 'PREPARE_SIDE' ? `${side === 'FRONT' ? 'Front' : 'Back'} image preparation` : 'original report initialization';
        const state = requested ? 'REQUESTED' : value.state;
        check(requested ? value.phase === 'REQUESTED' : ['SUCCEEDED', 'FAILED', 'UNKNOWN'].includes(state));
        const preparation = !requested && state === 'SUCCEEDED' && value.action === 'PREPARE_SIDE' ? value.preparation : null;
        if (preparation) check(SHA.test(preparation.manifestHash ?? '') && positive(preparation.width) && positive(preparation.height)
            && preparation.width <= 20_000 && preparation.height <= 20_000 && unitQuad(preparation.sourceCorners)
            && ['BLACK', 'WHITE', 'MAGENTA'].includes(preparation.matColor)
            && (preparation.centeringProposal === null || unitQuad(preparation.centeringProposal)));
        return { ...base, stage: value.action === 'PREPARE_SIDE' ? 'PREPARATION' : 'REPORT',
            status: requested ? 'REQUESTED' : state === 'FAILED' ? 'NEEDS_ATTENTION' : state === 'UNKNOWN' ? 'UNKNOWN' : 'RECORDED',
            summary: requested ? `Requested ${source}.` : state === 'SUCCEEDED' ? `Completed ${source}.`
                : state === 'UNKNOWN' ? `The outcome of ${source} is unconfirmed; its recorded work remains pending.` : `${source[0].toUpperCase()}${source.slice(1)} needs attention.`,
            runId: machine.runId, requestId: value.requestId, ...(side ? { side } : {}),
            selection: { actor: 'MACHINE', stepId: machine.selectionStepId, resultHash: machine.selectionResultHash },
            ...(preparation ? { preparation: { manifestHash: preparation.manifestHash,
                width: preparation.width, height: preparation.height, sourceCorners: unitQuad(preparation.sourceCorners),
                matColor: preparation.matColor, centeringProposal: unitQuad(preparation.centeringProposal) } } : {}) };
    });
}

export function projectWorkspaceControl(value, { canControl = true, canStart = canControl, canRecover = canStart } = {}) {
    check(value && ['UNAVAILABLE', 'QUEUED', 'RUNNING', 'PAUSE_REQUESTED', 'PAUSED', 'TAKEN_OVER', 'COMPLETED', 'NEEDS_ATTENTION', 'WAITING_REVIEW'].includes(value.state)
        && ['CONTINUOUS', 'STEP'].includes(value.mode) && Number.isSafeInteger(value.pending) && value.pending >= 0
        && value.pending <= 100 && typeof value.settled === 'boolean'
        && (value.runId === null || UUID.test(value.runId ?? '')));
    const state = value.state === 'TAKEN_OVER' ? value.state : ['UNKNOWN', 'FAILED', 'NEEDS_RECAPTURE', 'NEEDS_EXPERT'].includes(value.runState) ? 'NEEDS_ATTENTION' : value.runState === 'READY_FOR_HUMAN' ? 'WAITING_REVIEW' : value.state;
    let attemptRecovery = null, unconfirmedCost;
    if (value.attemptRecovery != null) {
        const review = value.attemptRecovery;
        check(UUID.test(review.attemptId ?? '') && SHA.test(review.reviewHash ?? '')
            && typeof review.reservedMicroUsd === 'string' && /^[1-9][0-9]{0,18}$/.test(review.reservedMicroUsd)
            && typeof review.dispatchedAt === 'string');
        attemptRecovery = { attemptId: review.attemptId, reviewHash: review.reviewHash,
            reservedMicroUsd: review.reservedMicroUsd, dispatchedAt: instant(review.dispatchedAt) };
    }
    if (value.unconfirmedCost != null) {
        const cost = value.unconfirmedCost;
        check(Number.isSafeInteger(cost.attempts) && cost.attempts >= 0 && cost.attempts <= 100
            && typeof cost.reservedMicroUsd === 'string' && /^(0|[1-9][0-9]{0,20})$/.test(cost.reservedMicroUsd)
            && (cost.attempts === 0) === (cost.reservedMicroUsd === '0'));
        unconfirmedCost = { attempts: cost.attempts, reservedMicroUsd: cost.reservedMicroUsd };
    }
    return { state, mode: value.mode, pending: value.pending,
        ...(typeof value.failureCode === 'string' && /^(ASTRA|WORKSPACE)_[A-Z0-9_]{1,69}$/.test(value.failureCode) ? { failureCode: value.failureCode } : {}),
        ...(value.lastUpdatedAt ? { lastUpdatedAt: instant(value.lastUpdatedAt) } : {}),
        canRecover: canControl && canRecover && value.canRecover === true,
        ...(typeof value.canAbandon === 'boolean' ? { canAbandon: canControl && canRecover
            && value.canAbandon && attemptRecovery !== null } : {}),
        ...(Object.hasOwn(value, 'attemptRecovery') ? { attemptRecovery: canControl && canRecover ? attemptRecovery : null } : {}),
        ...(unconfirmedCost ? { unconfirmedCost } : {}),
        canPause: canControl && value.canPause === true, canResume: canControl && canStart && value.canResume === true,
        canStep: canControl && canStart && value.canStep === true, canTakeOver: canControl && value.canTakeOver === true && value.settled };
}

export function projectWorkspaceControlTiming(control) {
    if (!control?.timingHistory) return null;
    return projectWorkspaceTiming({ ...control.timingHistory,
        events: [...control.timingHistory.events, ...(control.extraTimingEvents ?? [])],
        leaseRequired: ['RUNNING','WAITING_TOOL'].includes(control.runState) && control.state === 'RUNNING',
        leaseExpiresAt: control.leaseExpiresAt ?? null });
}

function controlCapabilities(context, card) {
    const canControl = context.identity.role === 'REVIEWER' && card.claim?.kind === 'ASTRA';
    return { canControl, canRecover: canControl && card.claim.actorId === context.identity.id
        && card.claim.accessVersion === context.identity.accessVersion && context.policy?.astraEnabled === true
        && +new Date(context.policy.expiresAt) > +context.now, canStart: canControl && card.claim.actorId === context.identity.id
        && positive(context.identity.accessVersion) && card.claim.accessVersion === context.identity.accessVersion
        && positive(context.control?.revision) && card.claim.controlRevision === context.control.revision
        && context.policy?.astraEnabled === true && +new Date(context.policy.expiresAt) > +context.now };
}

/** Fixed scoped SQL ports; the serving role receives no machine table reads.
 * Functions must verify the workspace's current exact run/claim binding and
 * share the existing staff transaction lock. They return scalar control data
 * and immutable step projections only, never private provider continuation. */
export const workspaceOperatorSqlPort = Object.freeze({
    async activity(context, { card, limit }) {
        return context.databaseTx.$queryRaw`SELECT * FROM atlas_staff.read_workspace_operator_activity(${card.id}::uuid,${limit}::integer)`;
    },
    async read(context, { card }) {
        const [row] = await context.databaseTx.$queryRaw`SELECT atlas_staff.read_workspace_operator_control(${card.id}::uuid) AS control`;
        return row?.control;
    },
    async control(context, { card, action, commandId, recovery }) {
        if (action === 'ABANDON_AND_STEP') {
            try {
                const [row] = await context.databaseTx.$queryRaw`SELECT atlas_staff.abandon_workspace_operator_attempt(${card.id}::uuid,${card.claimFence}::integer,
                    ${context.identity.id}::uuid,${context.session.tokenHash}::text,${card.revision}::integer,${commandId}::uuid,
                    ${recovery.reviewHash}::text,${recovery.reason}::text) AS control`;
                return row?.control;
            } catch (error) {
                // Only these exact PostgreSQL denials prove no command was
                // admitted. Unknown failures retain the same pending request.
                const code = error?.meta?.code === 'P0001' && typeof error.meta.message === 'string'
                    ? error.meta.message.replace(/^ERROR: /, '') : null;
                if (Object.hasOwn(abandonmentDenials, code)) preflight(false, code, abandonmentDenials[code]);
                throw error;
            }
        }
        if (action === 'RECOVER') {
            const [row] = await context.databaseTx.$queryRaw`SELECT atlas_staff.recover_workspace_operator(${card.id}::uuid,${card.claimFence}::integer,
                ${context.identity.id}::uuid,${context.session.tokenHash}::text,${card.revision}::integer,${commandId}::uuid) AS control`;
            return row?.control;
        }
        const [row] = await context.databaseTx.$queryRaw`SELECT atlas_staff.control_workspace_operator(${card.id}::uuid,${card.claimFence}::integer,${action}::text,
            ${context.identity.id}::uuid,${context.session.tokenHash}::text,${card.revision}::integer) AS control`;
        return row?.control;
    },
});

export class StaffWorkspaceOperator {
    constructor({ store, projectCard, runPort = workspaceOperatorSqlPort }) {
        check(typeof store?.transaction === 'function' && typeof projectCard === 'function'
            && ['activity', 'read', 'control'].every(k => typeof runPort[k] === 'function'));
        this.store = store; this.projectCard = projectCard; this.runPort = runPort;
    }
    async card(context, cardId) {
        check(UUID.test(cardId ?? ''), 'WORKSPACE_CARD_NOT_FOUND', 404);
        const card = await context.tx.getCard(cardId);
        check(card, 'WORKSPACE_CARD_NOT_FOUND', 404);
        return card;
    }
    activity(staff, cardId) {
        return this.store.transaction(staff, async context => {
            const card = await this.card(context, cardId);
            const rows = await this.runPort.activity(context, { card, limit: MAX_ACTIVITY });
            const control = await this.runPort.read(context, { card });
            return { activity: projectWorkspaceActivity(rows), ...(control.timingHistory ? { timing: projectWorkspaceControlTiming(control) } : {}), control: projectWorkspaceControl(control,
                controlCapabilities(context, card)) };
        });
    }
    control(staff, cardId, input) {
        const abandonment = input?.action === 'ABANDON_AND_STEP';
        strictObject(input, ['operationId', 'expectedRevision', 'action', ...(abandonment ? ['recovery'] : [])]); identifier(input.operationId);
        check(positive(input.expectedRevision) && WORKSPACE_CONTROLS.includes(input.action), 'INVALID_REQUEST', 400);
        if (abandonment) {
            strictObject(input.recovery, ['reviewHash', 'reason']);
            check(SHA.test(input.recovery.reviewHash ?? '') && typeof input.recovery.reason === 'string'
                && input.recovery.reason.trim().length > 0 && input.recovery.reason.length <= 500
                && !/[\x00-\x1f\x7f]/.test(input.recovery.reason), 'INVALID_REQUEST', 400);
        }
        const inputHash = hash(canonical({ cardId, input }));
        return this.store.transaction(staff, async context => {
            const card = await this.card(context, cardId), { identity, tx, now } = context;
            check(identity.role === 'REVIEWER', 'WORKSPACE_CONTROL_ACCESS_REQUIRED', 403);
            const prior = await tx.getOperation(identity.id, input.operationId);
            if (prior) {
                check(prior.action === 'OPERATOR_CONTROL' && prior.cardId === cardId && prior.inputHash === inputHash,
                    'WORKSPACE_REQUEST_CONFLICT', 409);
                const current = await this.runPort.read(context, { card });
                return { card: await this.projectCard(context, card), control: projectWorkspaceControl(current,
                    controlCapabilities(context, card)), operationId: input.operationId };
            }
            preflight(card.revision === input.expectedRevision, 'WORKSPACE_REVISION_CHANGED', 409);
            preflight(card.claim?.kind === 'ASTRA' && card.claim.fence === card.claimFence
                && card.claim.captureRevision === card.captureRevision && card.claim.captureHash === card.captureHash
                && ['IN_PROGRESS', 'NEEDS_ATTENTION'].includes(card.state), 'WORKSPACE_CLAIM_CHANGED', 409);
            // Stopping/taking over remains possible after pilot expiry. Starting
            // new work must still satisfy the unchanged current admission.
            if (['RESUME', 'STEP', 'RECOVER', 'ABANDON_AND_STEP'].includes(input.action)) {
                preflight(card.claim.actorId === identity.id && positive(identity.accessVersion)
                    && card.claim.accessVersion === identity.accessVersion && positive(context.control?.revision)
                    && (input.action === 'RECOVER' || abandonment || card.claim.controlRevision === context.control.revision), 'WORKSPACE_CLAIM_CONFLICT', 409);
                check(context.policy?.astraEnabled && +new Date(context.policy.expiresAt) > +now, 'WORKSPACE_ASTRA_NOT_READY', 503);
            }
            const commandId = randomUUID();
            const control = await this.runPort.control(context, { card, action: input.action, commandId,
                ...(abandonment ? { recovery: input.recovery } : {}) });
            check(positive(control?.runRevision), 'WORKSPACE_OPERATOR_UNAVAILABLE');
            const safeControl = projectWorkspaceControl(control);
            const next = { ...card, revision: card.revision + 1, updatedAt: instant(now) };
            if (input.action === 'TAKE_OVER') {
                check(control.state === 'TAKEN_OVER' && control.settled && control.pending === 0,
                    'WORKSPACE_ACTION_PENDING', 409);
                next.claimFence = card.claimFence + 1;
                next.claim = { id: randomUUID(), kind: 'HUMAN', actorId: identity.id,
                    actorName: boundedText(identity.name, 120) ?? 'Staff grader', mode: 'MANUAL', fence: next.claimFence,
                    workflowRevision: next.revision, captureRevision: card.captureRevision, captureHash: card.captureHash,
                    runId: null, claimedAt: instant(now) };
            } else if (input.action === 'RECOVER' || abandonment) {
                check(UUID.test((abandonment ? control.abandonmentId : control.recoveryId) ?? '') && control.recoveredClaim
                    && ['id','kind','actorId','accessVersion','fence','workflowRevision','captureRevision','captureHash','runId'].every(key => control.recoveredClaim[key] === card.claim[key])
                    && control.recoveredClaim.controlRevision === context.control.revision
                    && control.recoveredClaim.mode === (abandonment ? 'STEP' : 'CONTINUOUS')
                    && (!abandonment || control.mode === 'STEP' && control.stepBudget === 1
                        && control.pending === 0 && control.settled === true && control.state === 'RUNNING'), 'WORKSPACE_CLAIM_CHANGED');
                next.claim = control.recoveredClaim; next.state = 'IN_PROGRESS'; next.attention = null;
            } else next.claim = { ...card.claim, mode: control.mode };
            await tx.updateCard(next, card.revision);
            await tx.insertOperation({ id: commandId, actorId: identity.id, operationId: input.operationId,
                action: 'OPERATOR_CONTROL', cardId, inputHash, result: { action: input.action, control: safeControl, priorClaim: input.action === 'RECOVER' || abandonment ? next.claim : card.claim,
                    ...(input.action === 'RECOVER' ? { originalClaim: card.claim, recoveryId: control.recoveryId } : {}),
                    ...(abandonment ? { originalClaim: card.claim, abandonmentId: control.abandonmentId,
                        recovery: input.recovery } : {}),
                    runId: control.runId, runRevision: control.runRevision, runControlRevision: control.controlRevision ?? control.revision,
                    claimFence: next.claimFence, revision: next.revision }, createdAt: instant(now) });
            // A recovery review binds the card revision and latest command. Keep
            // the SQL mutation's projection in its immutable audit, then return
            // a review of the committed card and command to the caller.
            const current = control.canAbandon ? await this.runPort.read(context, { card: next }) : control;
            return { card: await this.projectCard(context, next), control: projectWorkspaceControl(current,
                controlCapabilities(context, next)), operationId: input.operationId };
        });
    }
}
