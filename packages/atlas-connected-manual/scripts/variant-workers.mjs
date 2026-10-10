import { createAnalysisWorker } from './analysis-worker.mjs';

/** Variant rechecks use their own provider binding. Collection must run with
 * that same binding, independently of admission for new paid work. No broader
 * database grants or main-host workers are required. */
export function createVariantWorkers({ worker, reconciler, onEvent }) {
  const collector = createAnalysisWorker({ reconciler, batchSize: 2, concurrency: 1, intervalMs: 5000, onEvent });
  return Object.freeze({
    start() { collector.start(); worker.start(); },
    async stop() { await Promise.all([collector.stop(), worker.stop()]); },
  });
}
