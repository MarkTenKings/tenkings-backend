import { canonical, digest, object, requireThat, uuid } from '@atlas/manual-service/contract';
import { createPresentationMarket, MARKET_UNAVAILABLE_REASONS } from './presentation-market.mjs';

// Explicit staff searches only. A durable reservation precedes the provider
// request; replay never purchases another lookup after an uncertain response.
// Public report visits only read the already selected evidence.
export function createPresentationMarketService({ repository, approved, artifacts, provider = null, run = work => work(), now }) {
  const market = createPresentationMarket({ provider, ...(now ? { now } : {}) });
  async function saved(staff, cardId, requestId) {
    const row = await repository.market(staff, cardId, requestId);
    if (row.state === 'STARTED') return { state: 'PENDING', previewId: requestId };
    if (row.state !== 'READY') return { state: row.state, previewId: requestId,
      ...(row.state === 'UNAVAILABLE' && MARKET_UNAVAILABLE_REASONS.includes(row.saved?.reason) ? { reason: row.saved.reason } : {}) };
    const record = row.saved;
    requireThat(record?.state === 'READY' && record.ref?.kind === 'MARKET_PREVIEW', 503, 'MARKET_PREVIEW_CORRUPT');
    const preview = await artifacts.read(record.ref, { cardId, kind: 'MARKET_PREVIEW', sourceHash: record.artifactHash });
    requireThat(digest(JSON.stringify(preview)) === record.artifactHash && digest(canonical(preview)) === record.sourceHash, 503, 'MARKET_PREVIEW_CORRUPT');
    await repository.market(staff, cardId, requestId);
    return { state: 'READY', previewId: requestId, preview, sourceHash: record.sourceHash, ref: record.ref, input: row.input };
  }
  const publicPreview = value => {
    const { sourceHash, ref, input, ...publicValue } = value; return publicValue;
  };
  return Object.freeze({
    enabled: Boolean(provider),
    preview: (staff, cardId, input) => run(async () => {
      if (!provider) return { state: 'UNAVAILABLE', reason: 'PROVIDER_NOT_CONFIGURED' };
      const row = await repository.reserveMarket(staff, cardId, input);
      if (!row.created) return publicPreview(await saved(staff, cardId, input.requestId));
      try {
        const source = await approved.loadPacket(staff, cardId, input.approvalActionId);
        await repository.market(staff, cardId, input.requestId);
        const result = await market.preview(source);
        if (result.state !== 'READY') {
          await repository.finishMarket(staff, cardId, input.requestId, result);
          return { ...result, previewId: input.requestId };
        }
        const artifactHash = digest(JSON.stringify(result.preview));
        const ref = await artifacts.write(result.preview, { cardId, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
        await repository.finishMarket(staff, cardId, input.requestId, { state: 'READY', ref, artifactHash, sourceHash: result.sourceHash });
        return publicPreview(await saved(staff, cardId, input.requestId));
      } catch (error) {
        // A late successful terminal write is never overwritten. If even the
        // UNKNOWN receipt cannot commit, STARTED remains a no-repeat fence.
        try { await repository.finishMarket(staff, cardId, input.requestId, { state: 'UNKNOWN' }); } catch { /* Reconcile saved exact request. */ }
        throw error;
      }
    }),
    async select(staff, cardId, input) {
      object(input, ['requestId','approvalActionId','expectedRevision','previewId','selectedIds']);
      uuid(input.requestId); uuid(input.approvalActionId); uuid(input.previewId);
      requireThat(Array.isArray(input.selectedIds) && input.selectedIds.length > 0 && input.selectedIds.length <= 60);
      const committed = await repository.marketCommitStatus(staff, cardId, input);
      if (committed) return committed;
      const found = await saved(staff, cardId, input.previewId);
      requireThat(found.state === 'READY' && found.input.approvalActionId === input.approvalActionId, 409, 'MARKET_PREVIEW_NOT_READY');
      const source = await approved.loadPacket(staff, cardId, input.approvalActionId);
      const selected = market.select({ ...source, preview: found.preview, sourceHash: found.sourceHash, selectedIds: input.selectedIds });
      return repository.commit(staff, cardId, { requestId: input.requestId, approvalActionId: input.approvalActionId, expectedRevision: input.expectedRevision }, null,
        { market: selected, source: { version: 'atlas-selected-market-source-v1', previewId: input.previewId, ref: found.ref,
          sourceHash: found.sourceHash, selectedIds: [...input.selectedIds] } });
    },
  });
}
