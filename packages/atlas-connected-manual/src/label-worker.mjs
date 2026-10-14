import { requireThat } from '@atlas/manual-service/contract';

/** Cold, single-cycle driver for the durable label queue. Rendering runs in
 * the renderer's bounded child process; the repository owns cross-process
 * claims. A browser visit never creates or processes a label. */
export function createLabelWorker({ service, intervalMs = 2000, timers = globalThis, onError = () => {} }) {
  requireThat(typeof service?.runPending === 'function' && Number.isInteger(intervalMs)
    && intervalMs >= 100 && intervalMs <= 60000, 500, 'LABEL_WORKER_CONFIGURATION_INVALID');
  let stopped = true, timer = null, running = null;
  const emit = error => {
    try { onError({ code: /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '')
      ? error.code : 'LABEL_WORKER_INTERRUPTED' }); } catch { /* Logging cannot affect queue state. */ }
  };
  function cycle() {
    if (stopped || running) return running;
    running = Promise.resolve().then(() => service.runPending({ limit: 4 }))
      .catch(emit).finally(() => { running = null; });
    return running;
  }
  return Object.freeze({
    start() {
      if (!stopped) return;
      stopped = false;
      timer = timers.setInterval(() => void cycle(), intervalMs);
      timer.unref?.();
      void cycle();
    },
    wake: cycle,
    async stop() {
      stopped = true;
      if (timer) timers.clearInterval(timer);
      timer = null;
      await running;
    },
    async drainOnce() {
      if (!stopped) return cycle();
      stopped = false;
      try { await cycle(); } finally { stopped = true; }
    },
  });
}
