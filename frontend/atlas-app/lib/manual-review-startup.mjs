/** The mounted workspace owns recovery and exact batch-report adoption. Never
 * seed a new command coordinator from a cached view or another card's client. */
export async function recoverManualReview({ client, cardId, batchReview, request, isCurrent = () => true }) {
  if (batchReview && (batchReview.cardId !== cardId || typeof batchReview.key !== 'string' || !batchReview.key))
    throw { code: 'BATCH_REVIEW_STALE' };
  if (!isCurrent()) return null;
  let current = await client.recover();
  if (!isCurrent()) return null;
  if (client.hasPending()) throw { code: 'MANUAL_COMMAND_PENDING' };
  if (current.finalReview || current.approval?.sourceHash === current.card.contentHash) return current;
  // Direct-card entry receives the exact source-bound hint from its recovered
  // workspace. Never infer it from a gallery cache or the capped batch list.
  const discovered = !batchReview && current.batchReview;
  if (discovered && (discovered.cardId !== cardId || !/^[a-f0-9]{64}$/.test(discovered.key)
    || discovered.state !== 'REVIEW' || discovered.sourceHash !== current.card.draft?.source?.sourceHash
    || discovered.manualRevision !== current.card.revision || discovered.manualContentHash !== current.card.contentHash))
    throw { code: 'BATCH_REVIEW_STALE' };
  const entry = batchReview ?? discovered;
  if (entry?.state === 'REVIEW') {
    const detail = await request(`/api/staff/manual-connected/cards/batch/${entry.key}`);
    if (!isCurrent()) return null;
    if (detail.state !== 'PENDING' && detail.reportHash) {
      try {
        current = await client.execute({ type: 'BEGIN_FINAL_REVIEW', batchKey: entry.key, reportHash: detail.reportHash });
      } catch (failure) {
        if (!isCurrent()) return null;
        if (!['BATCH_REVIEW_STALE', 'MANUAL_REVISION_CONFLICT'].includes(failure.code)) throw failure;
        current = await client.recover();
      }
      if (!isCurrent()) return null;
    }
  }
  return current;
}
