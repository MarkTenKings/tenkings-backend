import { digest, canonical, requireBridge as check, UUID, SHA } from '@atlas/service-bridge/protocol';

const END_STATES = new Set(['PREPARATION_READY', 'READY_FOR_HUMAN', 'NEEDS_RECAPTURE', 'NEEDS_EXPERT', 'FAILED', 'PAUSED', 'TAKEN_OVER',
    'NOT_STARTED', 'NOT_CLAIMED', 'RECONCILIATION_REQUIRED', 'CONFIGURATION_REJECTED', 'INACTIVE']);
const safeCode = error => /^ASTRA_[A-Z0-9_]{1,74}$/.test(error?.code) ? error.code : 'ASTRA_WORKSPACE_OUTCOME_UNCONFIRMED';
const validClaim = claim => claim && UUID.test(claim.cardId ?? '') && UUID.test(claim.claimId ?? '')
    && [claim.claimFence, claim.captureRevision, claim.workflowRevision].every(n => Number.isSafeInteger(n) && n > 0)
    && SHA.test(claim.captureHash ?? '');
const operationFor = (operationId, ordinal) => `workspace-${digest(canonical({ operationId, ordinal }))}`;

/** Finite sequential consumer of the existing staff workspace queue. This is
 * called by an explicitly started, admitted runner, never by an upload/read.
 *
 * queue.admission() reads current exact cohort, remaining processing limit and
 * pilot window. claimNext({operationId,mode}) atomically checks those controls,
 * fresh verified photo pairing and exclusive capture/workflow/claim fences.
 * prepare(claim,{signal}) first returns CAPTURE_REVIEW + exact runId for a
 * fresh pair, or READY + exact report run/initialization ID for saved capture.
 * After a continuous capture run reaches PREPARATION_READY, one further
 * prepare(claim,{signal,captureRunId}) may perform admitted original-source
 * preparation and return READY + the exact retained initialization/run ID.
 * STEP always stops at that capture handoff before any preparation dispatch.
 * It must quarantine unknowns and replay the same operation, never fund a new
 * attempt. settle(claim,result) must atomically recheck the exact claim fence
 * and stage from durable results; it cannot approve, publish or change costs.
 *
 * The fixed executor callbacks are executeOperatorInitialization/Run wrappers
 * holding the verified runtime configuration. Neither comes from model output.
 * No source IDs, actor selectors, API keys or authorization hashes are browser
 * inputs here. A claim/prepare/run/settle lost reply stops this invocation.
 */
export async function consumeWorkspaceQueue({ queue, operationId, mode = 'CONTINUOUS', signal,
    executeInitialization, executeRun, now = () => Date.now() }) {
    check(queue && ['admission', 'claimNext', 'prepare', 'settle'].every(k => typeof queue[k] === 'function')
        && typeof operationId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(operationId)
        && ['CONTINUOUS', 'STEP'].includes(mode) && typeof executeInitialization === 'function'
        && typeof executeRun === 'function', 'ASTRA_WORKSPACE_CONFIGURATION_REQUIRED');
    const cards = [];
    let initialLimit = null;
    for (let ordinal = 0; ordinal < 10; ordinal++) {
        if (signal?.aborted) return { state: 'STOPPED', code: 'ASTRA_RUNNER_STOPPED', cards };
        let admission;
        try { admission = await queue.admission(); } catch (error) { return { state: 'HELD', code: safeCode(error), cards }; }
        check(admission && typeof admission.enabled === 'boolean' && Number.isSafeInteger(admission.processingLimit)
            && admission.processingLimit >= 1 && admission.processingLimit <= 10
            && Number.isSafeInteger(admission.remaining) && admission.remaining >= 0 && admission.remaining <= 10
            && Number.isFinite(+new Date(admission.expiresAt)), 'ASTRA_WORKSPACE_ADMISSION_INVALID');
        if (!admission.enabled || +new Date(admission.expiresAt) <= now()) return { state: 'INACTIVE', code: 'ASTRA_PILOT_NOT_ACTIVE', cards };
        if (initialLimit === null) initialLimit = Math.min(admission.processingLimit, admission.remaining, mode === 'STEP' ? 1 : 10);
        // A change during this invocation can tighten admission, never expand
        // the initial reviewed first-card or batch processing allowance.
        if (ordinal >= Math.min(initialLimit, admission.processingLimit) || admission.remaining === 0)
            return { state: 'BOUND_REACHED', code: null, cards };
        let claim;
        try {
            claim = await queue.claimNext({ operationId: operationFor(operationId, ordinal), mode });
            if (claim === null) return { state: 'EMPTY', code: null, cards };
            check(validClaim(claim), 'ASTRA_WORKSPACE_CLAIM_INVALID');
        } catch (error) { return { state: 'HELD', code: safeCode(error), cards }; }
        let result;
        try {
            if (signal?.aborted) result = { state: 'NOT_STARTED', code: 'ASTRA_RUNNER_STOPPED' };
            else {
                let prepared = await queue.prepare(claim, { signal });
                check(prepared && ['CAPTURE_REVIEW', 'READY', 'NEEDS_RECAPTURE', 'NEEDS_EXPERT', 'RECONCILIATION_REQUIRED', 'INACTIVE'].includes(prepared.state),
                    'ASTRA_WORKSPACE_PREPARATION_UNCONFIRMED');
                if (prepared.state === 'CAPTURE_REVIEW') {
                    check(UUID.test(prepared.runId ?? '') && Object.keys(prepared).every(k => ['state', 'runId'].includes(k)),
                        'ASTRA_WORKSPACE_PREPARATION_UNCONFIRMED');
                    result = await executeRun({ runId: prepared.runId, signal });
                    check(result?.runId === prepared.runId && END_STATES.has(result.state)
                        && result.state !== 'READY_FOR_HUMAN', 'ASTRA_WORKSPACE_RUN_CHANGED');
                    if (result.state === 'PREPARATION_READY' && mode === 'CONTINUOUS') {
                        const current = await queue.admission();
                        check(current?.enabled && +new Date(current.expiresAt) > now()
                            && Number.isSafeInteger(current.processingLimit) && ordinal < current.processingLimit,
                        'ASTRA_PILOT_NOT_ACTIVE');
                        signal?.throwIfAborted();
                        prepared = await queue.prepare(claim, { signal, captureRunId: prepared.runId });
                        check(prepared && ['READY', 'NEEDS_RECAPTURE', 'NEEDS_EXPERT', 'RECONCILIATION_REQUIRED', 'INACTIVE'].includes(prepared.state),
                            'ASTRA_WORKSPACE_PREPARATION_UNCONFIRMED');
                    } else prepared = { state: result.state, code: result.code, runId: result.runId };
                }
                if (prepared.state !== 'READY') result = { state: prepared.state, code: prepared.code ?? null,
                    ...(UUID.test(prepared.runId ?? '') ? { runId: prepared.runId } : {}) };
                else {
                    const hasRun = typeof prepared.runId === 'string' && UUID.test(prepared.runId);
                    const hasInitialization = typeof prepared.initializationId === 'string' && UUID.test(prepared.initializationId);
                    check(hasRun !== hasInitialization && Object.keys(prepared).every(k => ['state', 'runId', 'initializationId'].includes(k)),
                        'ASTRA_WORKSPACE_PREPARATION_UNCONFIRMED');
                    result = hasInitialization ? await executeInitialization({ initializationId: prepared.initializationId, signal })
                        : await executeRun({ runId: prepared.runId, signal });
                    check(result && END_STATES.has(result.state) && result.state !== 'PREPARATION_READY', 'ASTRA_WORKSPACE_RUN_UNCONFIRMED');
                    // A prepared initialization can create its run internally;
                    // an existing-run callback may only return that exact run.
                    if (hasRun) check(result.runId === prepared.runId, 'ASTRA_WORKSPACE_RUN_CHANGED');
                    if (hasInitialization) check(result.initializationId === prepared.initializationId, 'ASTRA_WORKSPACE_RUN_CHANGED');
                }
            }
        } catch (error) { result = { state: 'RECONCILIATION_REQUIRED', code: safeCode(error) }; }
        const safeResult = { state: result.state, code: /^ASTRA_[A-Z0-9_]{1,74}$/.test(result.code ?? '') ? result.code : null,
            ...(UUID.test(result.runId ?? '') ? { runId: result.runId } : {}) };
        let settled;
        try {
            settled = await queue.settle(claim, safeResult);
            check(settled && typeof settled.settled === 'boolean'
                && ['IN_PROGRESS', 'NEEDS_ATTENTION', 'HUMAN_REVIEW'].includes(settled.cardState), 'ASTRA_WORKSPACE_SETTLEMENT_UNCONFIRMED');
            if (safeResult.state === 'READY_FOR_HUMAN') check(settled.cardState === 'HUMAN_REVIEW', 'ASTRA_WORKSPACE_SETTLEMENT_UNCONFIRMED');
            else check(settled.cardState !== 'HUMAN_REVIEW', 'ASTRA_WORKSPACE_SETTLEMENT_UNCONFIRMED');
        } catch (error) {
            cards.push({ cardId: claim.cardId, state: 'RECONCILIATION_REQUIRED' });
            return { state: 'HELD', code: safeCode(error), cards };
        }
        cards.push({ cardId: claim.cardId, state: safeResult.state, cardState: settled.cardState });
        if (!settled.settled || !['READY_FOR_HUMAN', 'NEEDS_RECAPTURE', 'NEEDS_EXPERT'].includes(safeResult.state))
            return { state: safeResult.state === 'PAUSED' ? 'PAUSED' : 'HELD', code: safeResult.code, cards };
    }
    return { state: 'BOUND_REACHED', code: null, cards };
}
