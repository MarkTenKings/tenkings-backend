import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { EbaySoldCompsV2Error } from '@tenkings/ebay-sold-comps-v2';
import { createPresentationMarket, publishedMarketQuery } from './presentation-market.mjs';

// Only typed provider refusals prove there was no successful paid result.
export function marketProviderFailure(error) {
  if (error instanceof EbaySoldCompsV2Error) {
    if (error.code === 'SOLDCOMPS_CREDENTIAL_MISSING') return { code: 'PROVIDER_NOT_CONFIGURED', disposition: 'UNAVAILABLE' };
    if (error.statusCode === 401 && error.code === 'SOLDCOMPS_CONFIGURATION_ERROR') return { code: 'PROVIDER_CONFIGURATION_ERROR', disposition: 'UNAVAILABLE' };
    if ([403,429].includes(error.statusCode) && error.code === 'SOLDCOMPS_QUOTA_REACHED') return { code: 'PROVIDER_QUOTA_REACHED', disposition: 'UNAVAILABLE' };
    if (error.statusCode === 429 && error.code === 'SOLDCOMPS_TEMPORARY_UNAVAILABLE') return { code: 'PROVIDER_REQUEST_LIMITED', disposition: 'RETRY' };
  }
  return { code: 'PROVIDER_OUTCOME_UNKNOWN', disposition: 'UNKNOWN' };
}

/** Cold construction. Only start/cycle executes durable, human-admitted jobs.
 * Leases bound process concurrency, never the number of approved cards. */
export function createMarketWorker({ store, approved, publication, artifacts, provider, authorityFor,
  concurrency = 2, intervalMs = 2000, heartbeatMs = 30000, timers = globalThis, now, onError = () => {} }) {
  requireThat(typeof provider === 'function' && typeof authorityFor === 'function' && Number.isInteger(concurrency)
    && concurrency >= 1 && concurrency <= 16 && Number.isInteger(intervalMs) && intervalMs >= 10
    && Number.isInteger(heartbeatMs) && heartbeatMs >= 10, 500, 'MARKET_WORKER_CONFIG_INVALID');
  const market = createPresentationMarket({ ...(now ? { now } : {}) });
  const tasks = new Set(); let stopped = true, cycling = null, timer = null;
  const emit = error => { try { onError({ code: /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'MARKET_WORKER_INTERRUPTED' }); } catch { /* Logging cannot change receipts. */ } };
  async function execute(job) {
    let dispatched = false, responseSaved = Boolean(job.response), providerFailed = null, leaseLost = false, renewing = Promise.resolve();
    const heartbeat = timers.setInterval(() => { renewing = renewing.then(async () => {
      if (!await store.renew(job)) leaseLost = true;
    }).catch(error => { leaseLost = true; emit(error); }); }, heartbeatMs); heartbeat.unref?.();
    try {
      const staff = await authorityFor(job);
      // This is delivery of the exact already human-approved snapshot. It
      // cannot create an approval or alter approved grade/report bytes.
      await publication.publish(staff, job.card_id, job.approval_action_id);
      const source = await approved.loadPacket(staff, job.card_id, job.approval_action_id);
      requireThat(!leaseLost && await store.bind(job, source), 409, 'MARKET_LEASE_LOST');
      const context = publishedMarketQuery(source);
      let response = job.response;
      if (!response) {
        // An uncertain dispatch-transaction reply is itself a no-repeat fence.
        dispatched = true;
        requireThat(!leaseLost && await store.dispatch(job), 409, 'MARKET_LEASE_LOST');
        try { response = await provider(structuredClone(context.input)); }
        catch (error) { providerFailed = marketProviderFailure(error); throw error; }
        requireThat(await store.recordResponse(job, response), 503, 'MARKET_RESPONSE_NOT_SAVED');
        responseSaved = true;
      }
      requireThat(!leaseLost, 409, 'MARKET_LEASE_LOST');
      const result = market.project(source, response);
      const artifactHash = digest(JSON.stringify(result.preview));
      const ref = await artifacts.write(result.preview, { cardId: job.card_id, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
      requireThat(result.sourceHash === digest(canonical(result.preview)), 503, 'MARKET_PREVIEW_CORRUPT');
      await store.finish(job, { result: { state: 'READY', ref, artifactHash, sourceHash: result.sourceHash } });
    } catch (error) {
      emit(error);
      const failure = providerFailed ?? (responseSaved ? { code: 'MARKET_PROCESSING_INTERRUPTED', disposition: 'RETRY' }
        : dispatched ? { code: 'PROVIDER_OUTCOME_UNKNOWN', disposition: 'UNKNOWN' }
        : { code: 'MARKET_PREPARATION_INTERRUPTED', disposition: 'RETRY' });
      try { await store.finish(job, failure); } catch (saveError) { emit(saveError); }
    } finally { timers.clearInterval(heartbeat); await renewing; }
  }
  async function cycle() {
    if (stopped || cycling) return cycling;
    cycling = (async () => {
      while (!stopped && tasks.size < concurrency) {
        const job = await store.claim(concurrency); if (!job) break;
        const task = execute(job).finally(() => tasks.delete(task)); tasks.add(task);
      }
    })().catch(emit).finally(() => { cycling = null; });
    return cycling;
  }
  return Object.freeze({
    start() { if (!stopped) return; stopped = false; timer = timers.setInterval(() => void cycle(), intervalMs); timer.unref?.(); void cycle(); },
    wake() { return cycle(); },
    async stop() { stopped = true; if (timer) timers.clearInterval(timer); timer = null; await cycling; await Promise.allSettled([...tasks]); },
    // Finite qualification path; same leased executor, no browser requirement.
    async drainOnce() { if (!stopped) { await cycle(); await Promise.allSettled([...tasks]); return; }
      stopped = false; try { await cycle(); await Promise.allSettled([...tasks]); } finally { stopped = true; } },
  });
}
