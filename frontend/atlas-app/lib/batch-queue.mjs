/** Bound thumbnail/report reads across the rail and selected card. A serverless
 * function can retain its own DB pool, so a queue mount must not fan out one
 * simultaneous authenticated request per photograph. */
export function createBatchReadQueue({ concurrency = 2, ttlMs = 60000, clock = Date.now } = {}) {
  const cache = new Map(), pending = [];
  let active = 0, order = 0;
  const cancelled = () => Object.assign(new Error('Queue changed'), { code: 'PREVIEW_READ_CANCELLED' });
  const abandon = entry => {
    if (!entry.pending || entry.consumers.size) return;
    entry.controller.abort();
    if (cache.get(entry.key) === entry) cache.delete(entry.key);
    const index = pending.indexOf(entry);
    if (index >= 0) { pending.splice(index, 1); entry.reject(cancelled()); }
  };
  function drain() {
    pending.sort((a, b) => b.priority - a.priority || a.order - b.order);
    while (active < concurrency && pending.length) {
      const item = pending.shift(); active++; item.started = true;
      Promise.resolve().then(() => {
        if (item.controller.signal.aborted) throw cancelled();
        return item.work({ signal: item.controller.signal });
      }).then(item.resolve, item.reject).finally(() => { active--; drain(); });
    }
  }
  function subscribe(entry, signal) {
    if (!signal) { entry.consumers.add(entry); return entry.promise; }
    if (signal.aborted) return Promise.reject(cancelled());
    const token = {}; entry.consumers.add(token);
    return new Promise((resolve, reject) => {
      const release = () => { signal.removeEventListener('abort', abort); entry.consumers.delete(token); };
      const abort = () => { release(); reject(cancelled()); abandon(entry); };
      signal.addEventListener('abort', abort, { once: true });
      entry.promise.then(value => { release(); resolve(value); }, error => { release(); reject(error); });
    });
  }
  return {
    read(key, work, fresh = false, { priority = 0, signal } = {}) {
      if (signal?.aborted) return Promise.reject(cancelled());
      const previous = cache.get(key);
      if (previous && (previous.pending || !fresh && clock() - previous.at < ttlMs)) {
        previous.priority = Math.max(previous.priority, priority);
        return subscribe(previous, signal);
      }
      const entry = { key, work, priority, order: order++, at: clock(), pending: true,
        controller: new AbortController(), consumers: new Set() };
      entry.promise = new Promise((resolve, reject) => { Object.assign(entry, { resolve, reject }); });
      pending.push(entry);
      cache.set(key, entry);
      entry.promise.then(() => { entry.pending = false; entry.at = clock(); entry.consumers.clear(); }, () => {
        entry.pending = false; entry.consumers.clear();
        if (cache.get(key) === entry) cache.delete(key);
      });
      for (const [oldKey, old] of cache) if (cache.size > 100 && !old.pending) cache.delete(oldKey);
      const promise = subscribe(entry, signal);
      // Let the selected-card effect join and promote work before rail reads
      // begin in the same React commit. Existing active reads stay bounded.
      queueMicrotask(drain); return promise;
    },
    clear({ abortActive = false } = {}) {
      if (abortActive) for (const entry of cache.values()) if (entry.pending) entry.controller.abort();
      cache.clear();
      for (const item of pending.splice(0)) { item.controller.abort(); item.reject(cancelled()); }
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
