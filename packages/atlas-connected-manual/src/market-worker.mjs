import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { EbaySoldCompsV2Error } from '@tenkings/ebay-sold-comps-v2';
import { createPresentationMarket, publishedMarketQuery, marketPreviewHash } from './presentation-market.mjs';
import { marketHasRetiredReclassification } from './market-job-store.mjs';

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

/** Extend only the same publication/query using already saved page evidence. */
export function mergeMarketPages(prior, current, previousPreviewId) {
  const next = current.preview;
  requireThat(prior.version === 'atlas-market-preview-v2' && prior.query === next.query
    && canonical(prior.binding) === canonical(next.binding) && prior.identityHash === next.identityHash
    && prior.pagination?.page + 1 === next.pagination?.page, 409, 'MARKET_PAGE_MISMATCH');
  const candidates = [...prior.candidates], seen = new Set(candidates.map(row => row.sourceItem.providerItemId ?? row.sale.listingUrl).filter(Boolean));
  let duplicates = 0;
  for (const candidate of next.candidates) {
    const key = candidate.sourceItem.providerItemId ?? candidate.sale.listingUrl;
    if (key && seen.has(key)) { duplicates++; continue; }
    if (key) seen.add(key);
    candidates.push(candidate);
  }
  candidates.sort((a, b) => (Date.parse(b.sale.soldAt) || 0) - (Date.parse(a.sale.soldAt) || 0));
  const counts = Object.fromEntries(Object.keys(next.counts).map(key => [key, (prior.counts?.[key] ?? 0) + next.counts[key]]));
  counts.shown = candidates.length;
  counts.raw = candidates.filter(row => row.sale.raw).length;
  counts.graded = candidates.filter(row => row.sale.evidenceKind === 'SLABBED').length;
  counts.unreadGrade = candidates.filter(row => row.sale.grade == null).length;
  counts.differentIdentity = candidates.filter(row => row.match === 'DIFFERENT').length;
  counts.outsideGrade = candidates.filter(row => row.sale.grade != null && !row.nearbyGrade).length;
  counts.recommended = candidates.filter(row => row.recommended).length;
  counts.duplicates = (prior.counts.duplicates ?? 0) + duplicates;
  const labelProcessing = { ...next.labelProcessing,
    state: prior.labelProcessing?.state === 'PARTIAL' || next.labelProcessing.state === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE',
    reasons: [...new Set([...(prior.labelProcessing?.reasons ?? []), ...next.labelProcessing.reasons])] };
  for (const key of ['completed','failed','unknown','unavailable']) labelProcessing[key] += prior.labelProcessing?.[key] ?? 0;
  const pages = prior.pages ?? [{ page: prior.pagination.page, retrievedAt: prior.retrievedAt, returned: prior.counts.returned }];
  const preview = { ...next, candidates, counts, labelProcessing, previousPreviewId,
    pages: [...pages, { page: next.pagination.page, retrievedAt: next.retrievedAt, returned: next.counts.returned }] };
  return { ...current, preview, sourceHash: marketPreviewHash(preview) };
}

/** Cold construction. Only start/cycle executes durable, human-admitted jobs.
 * Leases bound process concurrency, never the number of approved cards. */
export function createMarketWorker({ store, approved, publication, artifacts, provider, authorityFor, labelMarket = null,
  concurrency = 2, intervalMs = 2000, heartbeatMs = 30000, timers = globalThis, onError = () => {} }) {
  requireThat(typeof provider === 'function' && typeof authorityFor === 'function' && Number.isInteger(concurrency)
    && concurrency >= 1 && concurrency <= 16 && Number.isInteger(intervalMs) && intervalMs >= 10
    && Number.isInteger(heartbeatMs) && heartbeatMs >= 10, 500, 'MARKET_WORKER_CONFIG_INVALID');
  const market = createPresentationMarket();
  const tasks = new Set(); let stopped = true, cycling = null, timer = null;
  const emit = error => { try { onError({ code: /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : 'MARKET_WORKER_INTERRUPTED' }); } catch { /* Logging cannot change receipts. */ } };
  async function execute(job) {
    let dispatched = false, responseSaved = Boolean(job.response), providerFailed = null, leaseLost = false, renewing = Promise.resolve();
    const heartbeat = timers.setInterval(() => { renewing = renewing.then(async () => {
      if (!await store.renew(job)) leaseLost = true;
    }).catch(error => { leaseLost = true; emit(error); }); }, heartbeatMs); heartbeat.unref?.();
    try {
      requireThat(!marketHasRetiredReclassification(job), 409, 'MARKET_RECLASSIFICATION_RETIRED');
      const staff = await authorityFor(job);
      // This is delivery of the exact already human-approved snapshot. It
      // cannot create an approval or alter approved grade/report bytes.
      await publication.publish(staff, job.card_id, job.approval_action_id);
      const source = await approved.loadPacket(staff, job.card_id, job.approval_action_id);
      requireThat(!leaseLost && await store.bind(job, source), 409, 'MARKET_LEASE_LOST');
      let response = job.response;
      const previous = typeof store.pageContext === 'function' ? await store.pageContext(job) : null;
      const context = publishedMarketQuery(source, response ? { savedQuery: response.query } : {});
      const page = previous ? previous.response.pagination.page + 1 : 1;
      requireThat(!previous || previous.response.query === publishedMarketQuery(source).query
        && previous.response.pagination.hasNextPage, 409, 'MARKET_NEXT_PAGE_UNAVAILABLE');
      if (!response) {
        // An uncertain dispatch-transaction reply is itself a no-repeat fence.
        dispatched = true;
        requireThat(!leaseLost && await store.dispatch(job), 409, 'MARKET_LEASE_LOST');
        try { response = await provider(structuredClone(context.input), { page }); }
        catch (error) { providerFailed = marketProviderFailure(error); throw error; }
        requireThat(await store.recordResponse(job, response), 503, 'MARKET_RESPONSE_NOT_SAVED');
        responseSaved = true;
      }
      requireThat(response.responsePolicy === 'ATLAS_SLAB_V1', 502, 'MARKET_PROVIDER_POLICY_INVALID');
      requireThat(!response.pagination || response.query === publishedMarketQuery(source).query && response.pagination.page === page, 502, 'MARKET_PROVIDER_RESULT_INVALID');
      requireThat(!leaseLost, 409, 'MARKET_LEASE_LOST');
      requireThat(typeof labelMarket === 'function', 503, 'MARKET_LABEL_PROVIDER_REQUIRED');
      const evidence = await labelMarket({ source, response: structuredClone(response), job,
        onProgress: async progress => {
          // Progress is advisory. A failed checkpoint must not repeat a paid
          // search or discard already journaled photograph readings.
          try { await store.recordProgress?.(job, progress); } catch (error) { emit(error); }
        } });
      requireThat(!leaseLost, 409, 'MARKET_LEASE_LOST');
      let result = market.project(source, evidence);
      if (previous) {
        const record = previous.record;
        const prior = await artifacts.read(record.ref, { cardId: job.card_id, kind: 'MARKET_PREVIEW', sourceHash: record.artifactHash });
        requireThat(digest(JSON.stringify(prior)) === record.artifactHash && marketPreviewHash(prior) === record.sourceHash,
          503, 'MARKET_PREVIEW_CORRUPT');
        result = mergeMarketPages(prior, result, previous.previewId);
      }
      const artifactHash = digest(JSON.stringify(result.preview));
      const ref = await artifacts.write(result.preview, { cardId: job.card_id, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
      requireThat(result.sourceHash === marketPreviewHash(result.preview), 503, 'MARKET_PREVIEW_CORRUPT');
      await store.finish(job, { result: { state: 'READY', ref, artifactHash, sourceHash: result.sourceHash } });
    } catch (error) {
      emit(error);
      const terminal = /^(MARKET_LABEL_(OUTCOME_UNKNOWN|RESPONSE_INVALID|RESPONSE_INCOMPLETE|RESPONSE_REJECTED|READING_INVALID|READING_MISSING)|MARKET_PHOTO_UNAVAILABLE|MARKET_PROVIDER_RESULT_INVALID|MARKET_PROVIDER_POLICY_INVALID|MARKET_RECLASSIFICATION_RETIRED)$/.test(error?.code ?? '');
      const failure = providerFailed ?? (terminal ? { code: error.code, disposition: 'FAILED' } : error?.code === 'MARKET_LABEL_PENDING' ? { code: 'MARKET_LABEL_PENDING', disposition: 'RETRY' } : responseSaved ? { code: 'MARKET_PROCESSING_INTERRUPTED', disposition: 'RETRY' }
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
