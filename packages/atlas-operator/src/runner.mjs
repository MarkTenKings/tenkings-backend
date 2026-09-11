import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonical, requireBridge as check } from '@atlas/service-bridge/protocol';
import { checked, parseControlPolicy, toolsForRun } from './policy.mjs';

const TERMINAL = new Set(['PREPARATION_READY', 'READY_FOR_HUMAN', 'NEEDS_RECAPTURE', 'NEEDS_EXPERT']);
const DB_TIMEOUT_MS = 15_000;
const RECEIPT_WRITE_ATTEMPTS = 3;
const transientReceiptCodes = new Set(['P1001','P1002','P1008','P1017','P2024','P2028','P2034',
    'ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT']);
const transientSqlStates = new Set(['40001','40P01','53300','57P01','57P02','57P03']);
const retryableReceiptFailure = error => {
    const code = error?.code, sqlState = code === 'P2010' ? error?.meta?.code : code;
    return transientReceiptCodes.has(code) || transientSqlStates.has(sqlState)
        || typeof sqlState === 'string' && /^08[0-9A-Z]{3}$/.test(sqlState);
};
const systemClock = { now: () => performance.now(), setTimeout, clearTimeout };
const failure = code => Object.assign(new Error(code), { code });
// Preserve actionable driver categories without exposing SQL, credentials or
// image-bearing exception messages. This does not authorize any retry.
const databaseFailureCodes = new Map([
    ['P1001', 'ASTRA_DATABASE_UNREACHABLE'], ['P1002', 'ASTRA_DATABASE_TIMEOUT'],
    ['P1008', 'ASTRA_DATABASE_TIMEOUT'], ['P1017', 'ASTRA_DATABASE_CONNECTION_CLOSED'],
    ['P2024', 'ASTRA_DATABASE_POOL_TIMEOUT'], ['P2028', 'ASTRA_DATABASE_TRANSACTION_FAILED'],
    ['P2034', 'ASTRA_DATABASE_TRANSACTION_CONFLICT']
]);
const safeCode = error => /^ASTRA_[A-Z0-9_]{1,74}$/.test(error?.code ?? error?.message)
    ? error.code ?? error.message : databaseFailureCodes.get(error?.code) ?? 'ASTRA_RUNNER_FAILED';

/** Run one already-enqueued job. This function never schedules/retries a job.
 *
 * ledger is OperatorLedger, including snapshot(lease) and stop(lease,{code}).
 * createProvider({takeDispatch,signal}) returns the existing dispatch(attemptId)
 * transport; it must honor signal and must obtain its sole grant through the
 * supplied callback. No provider or adapter is constructed from model output.
 * adapters[name].prepare(snapshot,{signal}) optionally reads/decodes evidence
 * outside a transaction. apply(data,prepared) runs only inside applyTool's
 * freshly validated transaction and returns {result,images?}; it must recheck
 * preparation lineage, perform no external I/O and grant no human authority.
 *
 * All advertised adapters must exist before spending. The ledger remains the
 * budget/model/request/receipt/state authority. Local bounds only tighten it.
 * clock is injectable solely for deterministic timer tests. The returned
 * receiptWrites contains promises resolving to safe persistence outcomes,
 * including late receipts. A host may drain these with its own bounded grace;
 * it must never restart processing merely because a late receipt arrives.
 */
export async function runOperator({ ledger, runId, owner = randomUUID(), createProvider, adapters,
    signal, clock = systemClock }) {
    check(ledger && ['claim','snapshot','renew','reserve','takeDispatch','recordReceipt','inspectTool','applyTool','stop']
        .every(name => typeof ledger[name] === 'function') && typeof createProvider === 'function'
        && adapters && typeof adapters === 'object', 'ASTRA_RUNNER_CONFIGURATION_REQUIRED');
    let lease, policy, pinnedPolicy, pinnedRuntime, recoveryAttemptId=null, deadline = Infinity, claimStarted = false, stepsApplied = 0;
    const controller = new AbortController(), receiptWrites = [];
    const abort = code => { if (!controller.signal.aborted) controller.abort(failure(code)); };
    const callerAbort = () => abort('ASTRA_RUNNER_STOPPED');
    signal?.addEventListener('abort', callerAbort, { once: true });
    if (signal?.aborted) callerAbort();
    const alive = () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (clock.now() >= deadline) { abort('ASTRA_RUN_DEADLINE'); throw controller.signal.reason; }
    };
    async function bounded(work, ms, { independent = false, code = 'ASTRA_LEDGER_TIMEOUT' } = {}) {
        if (!independent) alive();
        let timer, listener;
        const bound = independent ? ms : Math.min(ms, deadline - clock.now());
        const expiryCode = !independent && deadline - clock.now() <= ms ? 'ASTRA_RUN_DEADLINE' : code;
        const expiry = new Promise((_, reject) => {
            timer = clock.setTimeout(() => {
                if (!independent) abort(expiryCode);
                reject(failure(expiryCode));
            }, Math.max(0, bound));
            if (!independent) {
                listener = () => reject(controller.signal.reason);
                controller.signal.addEventListener('abort', listener, { once: true });
            }
        });
        try { return await Promise.race([Promise.resolve().then(() => { if (!independent) alive(); return work(); }), expiry]); }
        finally { clock.clearTimeout(timer); if (listener) controller.signal.removeEventListener('abort', listener); }
    }
    const db = work => bounded(work, DB_TIMEOUT_MS);
    async function persistReceipt(binding) {
        // The ledger deduplicates the exact attempt/receipt hash, including a
        // committed write whose reply was lost. Retry only settled transient
        // failures, serially, inside the original single-write time bound.
        // Cancellation stops tools but must not discard this captured receipt.
        const until = clock.now() + DB_TIMEOUT_MS;
        let open = true, retryTimer;
        try {
            await bounded(async () => {
                for (let attempt = 0; ; attempt++) {
                    if (!open || clock.now() >= until) throw failure('ASTRA_RECEIPT_PERSISTENCE_UNCONFIRMED');
                    try { return await ledger.recordReceipt(binding); }
                    catch (error) {
                        const delay = 250 * 2 ** attempt;
                        if (!open || attempt + 1 >= RECEIPT_WRITE_ATTEMPTS || !retryableReceiptFailure(error)
                            || clock.now() + delay >= until) throw error;
                        await new Promise(resolve => { retryTimer = clock.setTimeout(resolve, delay); });
                    }
                }
            }, DB_TIMEOUT_MS, { independent: true, code: 'ASTRA_RECEIPT_PERSISTENCE_UNCONFIRMED' });
        } finally {
            // An unresolved timed-out write may still settle. It must never
            // start another write after this receipt promise has been closed.
            open = false; clock.clearTimeout(retryTimer);
        }
    }
    async function snapshot() {
        const requestedAt = clock.now();
        const snap = await db(() => ledger.snapshot(lease));
        const parsed = parseControlPolicy(checked(snap.run.policyCanonical, snap.run.policyHash));
        check(canonical(parsed) === canonical(snap.policy) && snap.run.id === runId
            && snap.run.revision === lease.revision && snap.run.state === (recoveryAttemptId?'WAITING_TOOL':'RUNNING'), 'ASTRA_RUNNER_SNAPSHOT_INVALID');
        if (pinnedPolicy) check(snap.run.policyHash === pinnedPolicy && snap.run.runtimeHash === pinnedRuntime,
            'ASTRA_RUNNER_POLICY_CHANGED');
        pinnedPolicy = snap.run.policyHash; pinnedRuntime = snap.run.runtimeHash; policy = parsed;
        const remaining = Math.min(+new Date(snap.run.deadlineAt) - +new Date(snap.now),
            +new Date(policy.expiresAt) - +new Date(snap.now), policy.maxRunMs);
        check(Number.isFinite(remaining) && remaining > 0, 'ASTRA_RUN_DEADLINE');
        // Account conservatively for the snapshot round trip; a slow database
        // response must not extend the absolute deadline observed inside it.
        deadline = Math.min(deadline, requestedAt + remaining);
        for (const name of toolsForRun(policy,snap.run)) check(Object.hasOwn(adapters, name) && typeof adapters[name]?.apply === 'function'
            && (adapters[name].prepare === undefined || typeof adapters[name].prepare === 'function'), 'ASTRA_ADAPTER_NOT_ADMITTED');
        return snap;
    }
    async function external(work) {
        // Renew immediately, then serialize heartbeats only while external work
        // is outstanding. Drain an in-flight renewal before advancing revision.
        await db(() => ledger.renew(lease));
        let timer, pending = Promise.resolve(), done = false;
        const schedule = () => { timer = clock.setTimeout(() => {
            if (done || controller.signal.aborted) return;
            pending = db(() => ledger.renew(lease)).catch(error => { abort(safeCode(error)); });
            void pending.then(() => { if (!done && !controller.signal.aborted) schedule(); });
        }, Math.floor(policy.leaseMs / 3)); };
        schedule();
        try {
            const result = await bounded(work, policy.astra.requestTimeoutMs, { code: 'ASTRA_EXTERNAL_TIMEOUT' });
            done = true; clock.clearTimeout(timer); await pending; alive(); return result;
        } finally { done = true; clock.clearTimeout(timer); }
    }
    const result = (state, code = null) => ({ runId, state, code, stepsApplied, receiptWrites: [...receiptWrites] });
    try {
        alive();
        const claimed = await db(() => { claimStarted = true; return ledger.claim(runId, owner); });
        if (claimed.mode === 'PAUSED' || claimed.mode === 'TAKEN_OVER') return result(claimed.mode,
            claimed.mode === 'PAUSED' ? 'ASTRA_WORKFLOW_PAUSED' : 'ASTRA_HUMAN_TAKEOVER');
        lease = claimed.lease;
        check(lease?.runId === runId && lease.owner === owner, 'ASTRA_RUNNER_LEASE_INVALID');
        if (claimed.mode === 'RECONCILE_ONLY') return result('RECONCILIATION_REQUIRED', 'ASTRA_RECONCILIATION_ONLY');
        check(['WORK','RECOVER_TOOL'].includes(claimed.mode), 'ASTRA_RUNNER_LEASE_INVALID');
        if (claimed.mode==='RECOVER_TOOL') {
            check(typeof claimed.attemptId==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(claimed.attemptId),'ASTRA_RECOVERY_ATTEMPT_CHANGED');
            recoveryAttemptId=claimed.attemptId;
        }
        for (;;) {
            await snapshot(); alive();
            check(lease.revision <= policy.maxStepsPerRun && stepsApplied < policy.maxStepsPerRun, 'ASTRA_STEP_LIMIT');
            let attemptId=recoveryAttemptId;
            if (recoveryAttemptId) recoveryAttemptId=null;
            else {
                const reserved = await db(() => ledger.reserve(lease));
                attemptId=reserved.attemptId;
                let dispatchRequested = false, dispatched = false;
                const dispatchLease = { ...lease }, startedAt = new Date().toISOString();
                const takeDispatch = async attemptId => {
                    alive(); check(attemptId === reserved.attemptId && !dispatchRequested, 'ASTRA_DISPATCH_ALREADY_CONSUMED');
                    dispatchRequested = true;
                    const grant = await db(() => ledger.takeDispatch(dispatchLease, attemptId));
                    dispatched = true; alive(); return grant;
                };
                const receipt = await external(async () => {
                    const provider = createProvider({ takeDispatch, signal: controller.signal });
                    check(typeof provider?.dispatch === 'function', 'ASTRA_PROVIDER_CONFIGURATION_REQUIRED');
                    // Install this continuation before racing cancellation, so a
                    // response arriving after lease loss is still retained.
                    const delivery = (async () => {
                        let value;
                        try {
                            value = await provider.dispatch(reserved.attemptId);
                            check(dispatched, 'ASTRA_DISPATCH_NOT_ADMITTED');
                        } catch (error) {
                            if (!dispatched) throw error;
                            value = { state: 'UNKNOWN', attemptId: reserved.attemptId, startedAt,
                                receivedAt: new Date().toISOString(), httpStatus: null, failureCode: 'ASTRA_OUTCOME_UNCONFIRMED' };
                        }
                        await persistReceipt({ attemptId: reserved.attemptId,
                            dispatchClaimId: reserved.dispatchClaimId, receipt: value });
                        return value;
                    })();
                    receiptWrites.push(delivery.then(() => ({ attemptId: reserved.attemptId, state: 'PERSISTED' }),
                        () => ({ attemptId: reserved.attemptId, state: 'UNCONFIRMED' })));
                    return delivery;
                });
                check(receipt.state === 'RECEIVED' && receipt.httpStatus === 200, 'ASTRA_PROVIDER_RECONCILIATION_REQUIRED');
            }
            // A recovery claim applies the retained response first. No request
            // reservation, provider construction or POST occurs for that tool.
            const tool = await db(() => ledger.inspectTool(lease, attemptId));
            check(toolsForRun(policy,tool.run).includes(tool.call.name) && Object.hasOwn(adapters, tool.call.name), 'ASTRA_ADAPTER_NOT_ADMITTED');
            const adapter = adapters[tool.call.name];
            const prepared = adapter.prepare ? await external(() => adapter.prepare(tool, { signal: controller.signal })) : undefined;
            const applied = await db(() => ledger.applyTool(lease, attemptId, data => {
                alive();
                check(canonical(data.call) === canonical(tool.call), 'ASTRA_TOOL_CHANGED');
                return adapter.apply(data, prepared);
            }));
            check(applied.lease?.runId === lease.runId && applied.lease.owner === lease.owner
                && applied.lease.fence === lease.fence && applied.lease.revision === lease.revision + 1,
            'ASTRA_RUNNER_APPLY_INVALID');
            lease = applied.lease; stepsApplied++;
            if (applied.requiresPauseRelease) {
                check(applied.state === 'PREPARATION_READY' && typeof ledger.releasePause === 'function', 'ASTRA_CONTROL_ADAPTER_REQUIRED');
                const paused = await db(() => ledger.releasePause(lease));
                check(paused?.state === 'PAUSED', 'ASTRA_CONTROL_NOT_SETTLED');
            }
            if (TERMINAL.has(applied.state)) return result(applied.state);
            if (applied.state === 'PAUSED') {
                check(typeof ledger.releasePause === 'function', 'ASTRA_CONTROL_ADAPTER_REQUIRED');
                const paused = await db(() => ledger.releasePause(lease));
                check(paused?.state === 'PAUSED', 'ASTRA_CONTROL_NOT_SETTLED');
                return result('PAUSED', 'ASTRA_WORKFLOW_PAUSED');
            }
            check(applied.state === 'RUNNING', 'ASTRA_RUNNER_APPLY_INVALID');
        }
    } catch (error) {
        const code = safeCode(error); abort(code);
        // A lost claim reply can conceal a committed lease. Do not claim that
        // no lease exists; a subsequent owner must use normal fenced recovery.
        if (!lease) return result(claimStarted ? 'RECONCILIATION_REQUIRED' : 'NOT_CLAIMED', code);
        if (code === 'ASTRA_WORKFLOW_PAUSED' && typeof ledger.releasePause === 'function') {
            try {
                const paused = await bounded(() => ledger.releasePause(lease), DB_TIMEOUT_MS, { independent: true });
                if (paused?.state === 'PAUSED') return result('PAUSED', code);
            } catch { return result('RECONCILIATION_REQUIRED', code); }
        }
        try {
            const stopped = await bounded(() => ledger.stop(lease, { code }), DB_TIMEOUT_MS, { independent: true });
            // A timeout or lost transaction reply never proves rollback. Only
            // the durable fenced stop may report a safely failed run.
            return result(stopped?.state === 'FAILED' ? 'FAILED' : 'RECONCILIATION_REQUIRED', code);
        } catch { return result('RECONCILIATION_REQUIRED', code); }
    } finally { signal?.removeEventListener('abort', callerAbort); }
}
