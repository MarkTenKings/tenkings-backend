/** Bound thumbnail/report reads across the rail and selected card. A serverless
 * function can retain its own DB pool, so a queue mount must not fan out one
 * simultaneous authenticated request per photograph. */
export function createBatchReadQueue({ concurrency = 2, ttlMs = 60000, clock = Date.now } = {}) {
  const cache = new Map(), pending = [];
  let active = 0;
  function drain() {
    while (active < concurrency && pending.length) {
      const item = pending.shift(); active++;
      Promise.resolve().then(item.work).then(item.resolve, item.reject).finally(() => { active--; drain(); });
    }
  }
  return {
    read(key, work, fresh = false) {
      const previous = cache.get(key);
      if (previous && (previous.pending || !fresh && clock() - previous.at < ttlMs)) return previous.promise;
      const entry = { at: clock(), pending: true };
      entry.promise = new Promise((resolve, reject) => { pending.push({ work, resolve, reject }); });
      cache.set(key, entry);
      entry.promise.then(() => { entry.pending = false; entry.at = clock(); }, () => {
        if (cache.get(key) === entry) cache.delete(key);
      });
      for (const [oldKey, old] of cache) if (cache.size > 100 && !old.pending) cache.delete(oldKey);
      drain(); return entry.promise;
    },
    clear() {
      cache.clear();
      for (const item of pending.splice(0)) item.reject(Object.assign(new Error('Queue changed'), { code: 'PREVIEW_READ_CANCELLED' }));
    },
  };
}

/** Uploads can stop before a grading job exists. Include these retained cards
 * in the same visible queues without inventing a resumable grading action. */
export function mergeProcessingCards(jobs, cards) {
  const admitted = new Set(jobs.map(job => job.cardId));
  const intake = cards.filter(card => !admitted.has(card.cardId)).map(card => {
    const sides = ['FRONT', 'BACK'].map(side => ({ side, ...card.ingestion?.[side] }));
    const attention = sides.filter(side => side.state === 'ATTENTION');
    return { key: `intake:${card.cardId}`, cardId: card.cardId, label: card.label, intakeOnly: true,
      state: attention.length ? 'NEEDS_ATTENTION' : sides.some(side => side.state === 'RUNNING') ? 'RUNNING' : 'QUEUED',
      stage: 'UPLOAD', code: attention[0]?.code ?? null, canResumeProcessing: false, evidence: {},
      revision: JSON.stringify([card.ready, card.sides, card.ingestion]),
      attentionSides: attention.map(side => side.side) };
  });
  return [...jobs, ...intake];
}

export function queueProblemMessage(job) {
  if (!job.intakeOnly) return null;
  const side = job.attentionSides?.map(value => value === 'FRONT' ? 'Front' : 'Back').join(' and ');
  if (job.code === 'PHOTO_HDR_UNSUPPORTED') return `${side} HDR photo could not be prepared. The uploaded original is retained. Open card to check the photo.`;
  if (job.state === 'NEEDS_ATTENTION') return `${side} photo preparation needs attention. The uploaded original is retained. Open card for details.`;
  return 'Waiting for uploaded photos to finish verification and preparation.';
}
