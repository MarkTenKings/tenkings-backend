import { randomUUID } from 'node:crypto';
import { financeAssert as check, copy, identifier } from './ledger.mjs';

export const operationalCode = error => /^[A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'FINANCE_OPERATION_FAILED';
export function requireOperationalReady(assertReady, binding) {
  const result = assertReady(copy(binding));
  if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => {});
  check(result === true, 'HOST_FINANCE_UNQUALIFIED');
}

// Only use this around read-only provider I/O or an outbox send whose durable
// dispatch claim already exists. Never race a mutating reducer/whole runner.
export async function boundedOperationalCall(operation, { signal, timeoutMs, code = 'FINANCE_OPERATION_TIMEOUT' }) {
  check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, code);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timer, listener;
  try {
    const interrupted = new Promise((_, reject) => {
      listener = () => { const error = new Error(code); error.code = code; reject(error); };
      controller.signal.addEventListener('abort', listener, { once: true });
      timer = setTimeout(abort, timeoutMs);
      if (controller.signal.aborted) listener();
    });
    // Promise.race consumes eventual rejection; a late response is discarded.
    return await Promise.race([interrupted, Promise.resolve().then(() => {
      check(!controller.signal.aborted, code);
      return operation(controller.signal);
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', listener); }
}

// Timers are local admission mechanisms; the durable lease owns the work. No
// missed-interval catch-up, financial writes, import effects or implicit start.
export function createFinanceScheduler({ enabled = false, store, scope, configHash, config, run, assertRuntimeReady, timers = globalThis } = {}) {
  if (!enabled) return Object.freeze({ start() { check(false, 'FINANCE_SCHEDULER_DISABLED'); }, async stop() {}, async tick() { check(false, 'FINANCE_SCHEDULER_DISABLED'); } });
  identifier(scope); identifier(configHash);
  check(typeof run === 'function' && typeof assertRuntimeReady === 'function' && typeof store?.transaction === 'function', 'FINANCE_SCHEDULER_REQUIRED');
  for (const [key, min, max] of [['intervalMs',1000,86400000],['pollIntervalMs',100,60000],['leaseMs',1000,900000]]) check(Number.isSafeInteger(config?.[key]) && config[key] >= min && config[key] <= max, 'FINANCE_SCHEDULE_BOUNDS_REQUIRED');
  check(config.pollIntervalMs <= config.intervalMs, 'FINANCE_SCHEDULE_BOUNDS_REQUIRED');
  config = Object.freeze(copy(config));
  let running = false, timer = null, active = null, controller = null, lastCode = null;
  const ready = () => requireOperationalReady(assertRuntimeReady, { scope, configHash });
  async function perform(signal) {
    ready(); const token = randomUUID();
    const claim = await store.transaction(tx => {
      ready(); const schedules = tx.state.financeSchedules ??= {}, runs = tx.state.financeScheduleRuns ??= {};
      const row = schedules[scope] ??= { scope, configHash, nextDueAt: tx.now, sequence: 0, active: null, lastRunId: null };
      check(row.configHash === configHash, 'FINANCE_SCHEDULE_CONFIG_CONFLICT');
      if (row.active && row.active.expiresAt > tx.now) return { status: 'BUSY', retryAfter: row.active.expiresAt };
      if (row.active) {
        const old = runs[row.active.runId];
        if (old?.status === 'RUNNING') Object.assign(old, { status: 'INTERRUPTED', code: 'FINANCE_SCHEDULE_LEASE_EXPIRED', completedAt: tx.now });
        row.active = null;
      }
      if (row.nextDueAt > tx.now) return { status: 'NOT_DUE', retryAfter: row.nextDueAt };
      row.sequence++; check(Number.isSafeInteger(row.sequence) && Number.isSafeInteger(tx.now + config.leaseMs + config.intervalMs), 'FINANCE_SCHEDULE_CLOCK_INVALID');
      const runId = `schedule:${scope}:${row.sequence}`;
      row.active = { token, runId, expiresAt: tx.now + config.leaseMs };
      row.nextDueAt = tx.now + config.intervalMs;
      runs[runId] = { runId, scope, configHash, status: 'RUNNING', startedAt: tx.now };
      return { status: 'CLAIMED', runId };
    });
    if (claim.status !== 'CLAIMED') return claim;
    let result;
    try {
      ready(); const receipt = await run({ runId: claim.runId, signal });
      result = { status: receipt.status, recoveryRunId: receipt.runId };
    } catch (error) { result = { status: 'ERROR', code: operationalCode(error) }; }
    return store.transaction(tx => {
      const row = tx.state.financeSchedules[scope], receipt = tx.state.financeScheduleRuns[claim.runId];
      if (row.active?.token !== token) return copy(receipt);
      Object.assign(receipt, result, { completedAt: tx.now }); row.active = null; row.lastRunId = claim.runId;
      return copy(receipt);
    });
  }
  function tick() {
    if (active) return active;
    controller = new AbortController();
    active = perform(controller.signal).finally(() => { active = null; controller = null; });
    return active;
  }
  function queue() {
    if (!running) return;
    timer = timers.setTimeout(async () => {
      timer = null;
      try { await tick(); lastCode = null; } catch (error) { lastCode = operationalCode(error); }
      queue();
    }, config.pollIntervalMs);
    timer?.unref?.();
  }
  return Object.freeze({
    tick,
    start() { ready(); if (!running) { running = true; queue(); } return { started: true }; },
    async stop() { running = false; if (timer !== null) timers.clearTimeout(timer); timer = null; controller?.abort(); if (active) await active; return { stopped: true }; },
    status: () => ({ started: running, active: active !== null, lastCode })
  });
}
