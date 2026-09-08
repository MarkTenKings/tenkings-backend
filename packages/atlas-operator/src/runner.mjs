import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { canonical, requireBridge as check } from '@atlas/service-bridge/protocol';
import { checked, parseControlPolicy } from './policy.mjs';

const TERMINAL = new Set(['READY_FOR_HUMAN', 'NEEDS_RECAPTURE', 'NEEDS_EXPERT']);
const DB_TIMEOUT_MS = 15_000;
const systemClock = { now: () => performance.now(), setTimeout, clearTimeout };
const failure = code => Object.assign(new Error(code), { code });
const safeCode = error => /^ASTRA_[A-Z0-9_]{1,74}$/.test(error?.code ?? error?.message)
    ? error.code ?? error.message : 'ASTRA_RUNNER_FAILED';

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
    let lease, policy, pinnedPolicy, pinnedRuntime, deadline = Infinity, claimStarted = false, stepsApplied = 0;
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
    async function snapshot() {
        const requestedAt = clock.now();
        const snap = await db(() => ledger.snapshot(lease));
        const parsed = parseControlPolicy(checked(snap.run.policyCanonical, snap.run.policyHash));
        check(canonical(parsed) === canonical(snap.policy) && snap.run.id === runId
            && snap.run.revision === lease.revision && snap.run.state === 'RUNNING', 'ASTRA_RUNNER_SNAPSHOT_INVALID');
        if (pinnedPolicy) check(snap.run.policyHash === pinnedPolicy && snap.run.runtimeHash === pinnedRuntime,
            'ASTRA_RUNNER_POLICY_CHANGED');
        pinnedPolicy = snap.run.policyHash; pinnedRuntime = snap.run.runtimeHash; policy = parsed;
        const remaining = Math.min(+new Date(snap.run.deadlineAt) - +new Date(snap.now),
            +new Date(policy.expiresAt) - +new Date(snap.now), policy.maxRunMs);
        check(Number.isFinite(remaining) && remaining > 0, 'ASTRA_RUN_DEADLINE');
        // Account conservatively for the snapshot round trip; a slow database
        // response must not extend the absolute deadline observed inside it.
        deadline = Math.min(deadline, requestedAt + remaining);
        for (const name of policy.tools) check(Object.hasOwn(adapters, name) && typeof adapters[name]?.apply === 'function'
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
        const claimed = await db(() => { claimStarted = true; return ledger.claim(runId, owner); }); lease = claimed.lease;
        check(lease?.runId === runId && lease.owner === owner, 'ASTRA_RUNNER_LEASE_INVALID');
        if (claimed.mode === 'RECONCILE_ONLY') return result('RECONCILIATION_REQUIRED', 'ASTRA_RECONCILIATION_ONLY');
        check(claimed.mode === 'WORK', 'ASTRA_RUNNER_LEASE_INVALID');
        for (;;) {
            await snapshot(); alive();
            check(lease.revision <= policy.maxStepsPerRun && stepsApplied < policy.maxStepsPerRun, 'ASTRA_STEP_LIMIT');
            const reserved = await db(() => ledger.reserve(lease));
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
                // response arriving after lease loss is still retained once.
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
                    await bounded(() => ledger.recordReceipt({ attemptId: reserved.attemptId,
                        dispatchClaimId: reserved.dispatchClaimId, receipt: value }), DB_TIMEOUT_MS,
                        { independent: true, code: 'ASTRA_RECEIPT_PERSISTENCE_UNCONFIRMED' });
                    return value;
                })();
                receiptWrites.push(delivery.then(() => ({ attemptId: reserved.attemptId, state: 'PERSISTED' }),
                    () => ({ attemptId: reserved.attemptId, state: 'UNCONFIRMED' })));
                return delivery;
            });
            check(receipt.state === 'RECEIVED' && receipt.httpStatus === 200, 'ASTRA_PROVIDER_RECONCILIATION_REQUIRED');
            const tool = await db(() => ledger.inspectTool(lease, reserved.attemptId));
            check(policy.tools.includes(tool.call.name) && Object.hasOwn(adapters, tool.call.name), 'ASTRA_ADAPTER_NOT_ADMITTED');
            const adapter = adapters[tool.call.name];
            const prepared = adapter.prepare ? await external(() => adapter.prepare(tool, { signal: controller.signal })) : undefined;
            const applied = await db(() => ledger.applyTool(lease, reserved.attemptId, data => {
                alive();
                check(canonical(data.call) === canonical(tool.call), 'ASTRA_TOOL_CHANGED');
                return adapter.apply(data, prepared);
            }));
            check(applied.lease?.runId === lease.runId && applied.lease.owner === lease.owner
                && applied.lease.fence === lease.fence && applied.lease.revision === lease.revision + 1,
            'ASTRA_RUNNER_APPLY_INVALID');
            lease = applied.lease; stepsApplied++;
            if (TERMINAL.has(applied.state)) return result(applied.state);
            check(applied.state === 'RUNNING', 'ASTRA_RUNNER_APPLY_INVALID');
        }
    } catch (error) {
        const code = safeCode(error); abort(code);
        // A lost claim reply can conceal a committed lease. Do not claim that
        // no lease exists; a subsequent owner must use normal fenced recovery.
        if (!lease) return result(claimStarted ? 'RECONCILIATION_REQUIRED' : 'NOT_CLAIMED', code);
        try {
            const stopped = await bounded(() => ledger.stop(lease, { code }), DB_TIMEOUT_MS, { independent: true });
            // A timeout or lost transaction reply never proves rollback. Only
            // the durable fenced stop may report a safely failed run.
            return result(stopped?.state === 'FAILED' ? 'FAILED' : 'RECONCILIATION_REQUIRED', code);
        } catch { return result('RECONCILIATION_REQUIRED', code); }
    } finally { signal?.removeEventListener('abort', callerAbort); }
}
