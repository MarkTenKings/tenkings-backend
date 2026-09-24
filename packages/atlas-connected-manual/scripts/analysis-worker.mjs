// This worker receives only durable accepted-work lookup and GET reconciliation.
// It cannot build, claim, submit, replace, cancel or adopt an analysis.
export function createAnalysisWorker({ reconciler, intervalMs = 5000, batchSize = 5, onEvent = () => {} }) {
  if (!reconciler || typeof reconciler.pending !== 'function' || typeof reconciler.reconcile !== 'function'
    || !Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 60000
    || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 10 || typeof onEvent !== 'function') {
    throw new Error('DEFECT_BACKGROUND_WORKER_CONFIGURATION_INVALID');
  }
  let stopped = true, timer = null, inFlight = null, controller = null, cursor = null;
  const emit = value => { try { onEvent(value); } catch { /* Logging is not accounting or dispatch authority. */ } };
  const errorCode = error => /^DEFECT_ANALYSIS_[A-Z_]{1,100}$/.test(error?.code ?? '') ? error.code : 'DEFECT_ANALYSIS_RETRIEVAL_PENDING';
  async function cycle() {
    if (stopped || inFlight) return;
    const owned = new AbortController(); controller = owned;
    inFlight = (async () => {
      const page = await reconciler.pending({ limit: batchSize, cursor });
      if (owned.signal.aborted) return;
      if (!Array.isArray(page?.items) || page.items.length > batchSize) throw new Error('Invalid accepted-work page');
      const ids = page.items.map(item => item?.run?.analysisId);
      if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))) throw new Error('Invalid accepted-work identity');
      cursor = page.nextCursor ?? null;
      for (const analysisId of ids) {
        if (owned.signal.aborted) break;
        try {
          const result = await reconciler.reconcile({ analysisId, signal: owned.signal });
          if (!owned.signal.aborted && ['SETTLED', 'UNKNOWN'].includes(result?.state)) {
            emit({ event: 'MANUAL_DEFECT_BACKGROUND_RECONCILED', analysisId, state: result.state });
          }
        } catch (error) {
          if (!owned.signal.aborted) emit({ event: 'MANUAL_DEFECT_BACKGROUND_RETRIEVAL_PENDING', analysisId, code: errorCode(error) });
        }
      }
    })();
    try { await inFlight; }
    catch (error) {
      cursor = null;
      if (!owned.signal.aborted) emit({ event: 'MANUAL_DEFECT_BACKGROUND_SCAN_PENDING', code: errorCode(error) });
    } finally {
      inFlight = null; controller = null;
      if (!stopped) { timer = setTimeout(() => { timer = null; void cycle(); }, intervalMs); timer.unref?.(); }
    }
  }
  return Object.freeze({
    start() {
      if (!stopped || inFlight) return false;
      stopped = false; cursor = null; void cycle(); return true;
    },
    async stop() {
      stopped = true; if (timer) clearTimeout(timer); timer = null; controller?.abort();
      await inFlight?.catch(() => {});
    },
  });
}
