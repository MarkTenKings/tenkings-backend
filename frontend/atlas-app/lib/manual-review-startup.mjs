/** The mounted workspace owns recovery and exact batch-report adoption. Never
 * seed a new command coordinator from a cached view or another card's client. */
export async function recoverManualReview({ client, cardId, batchReview, request, isCurrent = () => true }) {
  if (batchReview && (batchReview.cardId !== cardId || typeof batchReview.key !== 'string' || !batchReview.key))
    throw { code: 'BATCH_REVIEW_STALE' };
  if (!isCurrent()) return null;
  let current = await client.recover();
  if (!isCurrent()) return null;
  if (client.hasPending()) throw { code: 'MANUAL_COMMAND_PENDING' };
  if (!current.finalReview && batchReview?.state === 'REVIEW') {
    const detail = await request(`/api/staff/manual-connected/cards/batch/${batchReview.key}`);
    if (!isCurrent()) return null;
    if (detail.state !== 'PENDING' && detail.reportHash) {
      try {
        current = await client.execute({ type: 'BEGIN_FINAL_REVIEW', batchKey: batchReview.key, reportHash: detail.reportHash });
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
