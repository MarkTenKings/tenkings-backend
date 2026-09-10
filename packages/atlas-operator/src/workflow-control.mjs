import { requireBridge as check } from '@atlas/service-bridge/protocol';

export const UNRESOLVED_ATTEMPTS = Object.freeze(['RESERVED', 'DISPATCHED', 'RECEIVED', 'UNKNOWN']);
export const ACTIVE_RUN_STATES = Object.freeze(['QUEUED', 'RUNNING', 'WAITING_TOOL', 'UNKNOWN']);
export const CONTROLLABLE_RUN_STATES = Object.freeze([...ACTIVE_RUN_STATES, 'PREPARATION_READY']);
const CONTROL_STATES = ['RUNNING', 'PAUSE_REQUESTED', 'PAUSED', 'TAKEN_OVER'];

/** Additive defaults describe historical runs exactly as they ran before
 * workspace controls existed. No policy, deadline or reservation is renewed. */
export function operatorControl(run) {
    const state = run.controlState ?? 'RUNNING', mode = run.executionMode ?? 'CONTINUOUS';
    const revision = run.controlRevision ?? 1, stepBudget = run.stepBudget ?? 0;
    check(CONTROL_STATES.includes(state) && ['CONTINUOUS', 'STEP'].includes(mode)
        && Number.isSafeInteger(revision) && revision > 0 && [0, 1].includes(stepBudget), 'ASTRA_CONTROL_INVALID');
    return { state, mode, revision, stepBudget };
}

export function assertOperatorDispatch(run) {
    const control = operatorControl(run);
    check(control.state === 'RUNNING' && (control.mode === 'CONTINUOUS' || control.stepBudget === 1),
        control.state === 'TAKEN_OVER' ? 'ASTRA_HUMAN_TAKEOVER' : 'ASTRA_WORKFLOW_PAUSED');
    return control;
}

export function assertOperatorApply(run) {
    const control = operatorControl(run);
    // An explicit pause prevents the next dispatch; its already dispatched
    // action may still settle once through the original lease/receipt checks.
    check(['RUNNING', 'PAUSE_REQUESTED'].includes(control.state),
        control.state === 'TAKEN_OVER' ? 'ASTRA_HUMAN_TAKEOVER' : 'ASTRA_WORKFLOW_PAUSED');
    return control;
}

export function pauseAfterAppliedAction(run, state) {
    const control = operatorControl(run);
    return ['RUNNING', 'PREPARATION_READY'].includes(state) && (control.state === 'PAUSE_REQUESTED'
        || control.mode === 'STEP' && control.stepBudget === 0);
}

/** Safe scalar projection, shared by the staff service and the deterministic
 * control adapter. Pending means unresolved work, not a count of active runs. */
export function projectOperatorControl(run, attempts = []) {
    if (!run) return { runId: null, runState: null, state: 'UNAVAILABLE', mode: 'CONTINUOUS', revision: 0,
        stepBudget: 0, pending: 0, settled: true, canPause: false, canResume: false, canStep: false, canTakeOver: false };
    const control = operatorControl(run), pending = attempts.filter(a => UNRESOLVED_ATTEMPTS.includes(a.state)).length;
    const active = CONTROLLABLE_RUN_STATES.includes(run.state), held = run.state === 'UNKNOWN'
        || attempts.some(a => ['DISPATCHED', 'RECEIVED', 'UNKNOWN'].includes(a.state));
    return { runId: run.id, runState: run.state, ...control, pending, settled: !held,
        canPause: active && control.state === 'RUNNING',
        canResume: active && control.state === 'PAUSED' && !pending && !held,
        canStep: active && control.state === 'PAUSED' && !pending && !held,
        canTakeOver: active && control.state !== 'TAKEN_OVER' && !held };
}

/** Used inside the human-authorized, locked workspace transaction. The caller
 * must cancel only the returned never-dispatched reservations before applying
 * the run update, then atomically update workspace ownership/operation receipt.
 * This helper cannot itself grant authority or perform a provider request. */
export function planOperatorControl(run, attempts, action) {
    check(['PAUSE', 'RESUME', 'STEP', 'TAKE_OVER'].includes(action), 'ASTRA_CONTROL_ACTION_INVALID');
    const current = projectOperatorControl(run, attempts);
    check(run && CONTROLLABLE_RUN_STATES.includes(run.state) && current.state !== 'TAKEN_OVER', 'ASTRA_CONTROL_NOT_ACTIVE');
    const cancelAttemptIds = attempts.filter(a => a.state === 'RESERVED').map(a => a.id);
    const clearLease = { leaseOwner: null, leaseMode: null, leaseExpiresAt: null };
    const next = { controlRevision: current.revision + 1 };
    if (action === 'TAKE_OVER') {
        check(current.settled, 'ASTRA_WORK_UNRESOLVED');
        Object.assign(next, clearLease, { state: 'FAILED', controlState: 'TAKEN_OVER', stepBudget: 0,
            failureCode: 'ASTRA_HUMAN_TAKEOVER' });
    } else if (action === 'PAUSE') {
        Object.assign(next, { controlState: current.settled ? 'PAUSED' : 'PAUSE_REQUESTED', stepBudget: 0 });
        if (current.settled) Object.assign(next, clearLease);
    } else {
        check(current.state === 'PAUSED' && current.pending === 0 && current.settled, 'ASTRA_CONTROL_NOT_SETTLED');
        Object.assign(next, clearLease, { controlState: 'RUNNING', executionMode: action === 'STEP' ? 'STEP' : 'CONTINUOUS',
            stepBudget: action === 'STEP' ? 1 : 0 });
    }
    return { runUpdate: next, cancelAttemptIds: ['PAUSE', 'TAKE_OVER'].includes(action) ? cancelAttemptIds : [],
        takenOver: action === 'TAKE_OVER' };
}
