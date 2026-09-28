const cancelled = () => Object.assign(new Error('Image access ended'), { code: 'VERIFIED_IMAGE_CANCELLED' });

/** One authorized browser boundary owns this pool. It never persists bytes or
 * grants. Each consumer owns a lease; releasing one cannot revoke another's URL. */
export function createVerifiedImagePool({ load, keyOf, maxBytes = 64 * 1024 * 1024,
  maxEntries = 12, concurrency = 3, idleMs = 60000, graceMs = 100,
  clock = Date.now, onMetric = () => {} } = {}) {
  if (typeof load !== 'function' || typeof keyOf !== 'function'
    || ![maxBytes, maxEntries, concurrency, idleMs].every(value => Number.isSafeInteger(value) && value > 0))
    throw new TypeError('Invalid verified image pool');
  const entries = new Map(), pending = [];
  let active = 0, sequence = 0, closed = false;
  const metric = value => { try { onMetric(value); } catch {} };
  const remove = entry => {
    clearTimeout(entry.timer);
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    const index = pending.indexOf(entry); if (index >= 0) pending.splice(index, 1);
    entry.removed = true; entry.controller.abort(); entry.asset?.dispose();
    for (const waiter of [...entry.waiters]) waiter.reject(cancelled());
  };
  const trim = () => {
    let bytes = [...entries.values()].reduce((total, entry) => total + (entry.asset?.byteCount ?? 0), 0);
    for (const entry of [...entries.values()].sort((a, b) => a.touched - b.touched)) {
      if (entry.refs || entry.waiters.size || !entry.asset) continue;
      const size = entry.asset.byteCount;
      if (!Number.isSafeInteger(size) || size > maxBytes || bytes > maxBytes || entries.size > maxEntries) {
        bytes -= size ?? 0; remove(entry);
      }
    }
  };
  const idle = entry => {
    if (entry.removed || entry.refs || entry.waiters.size) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { if (!entry.refs && !entry.waiters.size) remove(entry); }, entry.asset ? idleMs : graceMs);
    entry.timer.unref?.(); trim();
  };
  const lease = entry => {
    clearTimeout(entry.timer); entry.refs++; entry.touched = clock();
    let released = false;
    return { ...entry.asset, dispose() {
      if (released) return; released = true; entry.refs--; entry.touched = clock(); idle(entry);
    } };
  };
  const drain = () => {
    pending.sort((a, b) => b.priority - a.priority || a.order - b.order);
    while (!closed && active < concurrency && pending.length) {
      const entry = pending.shift(); if (entry.removed) continue;
      active++; entry.started = true; const began = clock();
      const progress = value => {
        entry.progress = value;
        for (const waiter of entry.waiters) { try { waiter.onProgress?.(value); } catch {} }
      };
      Promise.resolve().then(async () => {
        if (entry.controller.signal.aborted) throw cancelled();
        const requested = entry.descriptor;
        try { return await load(requested, { signal: entry.controller.signal, onProgress: progress }); }
        catch (error) {
          if (entry.controller.signal.aborted || error?.code !== 'VERIFIED_IMAGE_UNAVAILABLE'
            || requested.url === entry.descriptor.url) throw error;
          return load(entry.descriptor, { signal: entry.controller.signal, onProgress: progress });
        }
      }).then(asset => {
        if (entry.removed || closed) { asset.dispose(); return; }
        entry.asset = asset; entry.touched = clock();
        metric({ phase: 'VERIFIED', bytes: asset.byteCount, durationMs: clock() - began });
        for (const waiter of [...entry.waiters]) waiter.resolve(lease(entry));
        idle(entry); trim();
      }, error => {
        for (const waiter of [...entry.waiters]) waiter.reject(error);
        metric({ phase: 'FAILED', code: error?.code, durationMs: clock() - began }); remove(entry);
      }).finally(() => { active--; drain(); });
    }
  };
  return {
    borrow(descriptor, { signal, onProgress, priority = descriptor?.byteCount <= 512 * 1024 ? 3 : 2 } = {}) {
      if (closed || signal?.aborted) return Promise.reject(cancelled());
      const key = keyOf(descriptor);
      if (!key || typeof descriptor?.url !== 'string' || !descriptor.url)
        return Promise.reject(Object.assign(new Error('Image unavailable'), { code: 'VERIFIED_IMAGE_INVALID' }));
      let entry = entries.get(key);
      if (entry) {
        clearTimeout(entry.timer); entry.descriptor = { ...descriptor }; entry.touched = clock();
        entry.priority = Math.max(entry.priority, priority);
        if (entry.asset) { metric({ phase: 'CACHE_HIT', bytes: entry.asset.byteCount }); return Promise.resolve(lease(entry)); }
      } else {
        entry = { key, descriptor: { ...descriptor }, priority, order: sequence++, touched: clock(),
          controller: new AbortController(), waiters: new Set(), refs: 0, asset: null };
        entries.set(key, entry); pending.push(entry);
      }
      const promise = new Promise((resolve, reject) => {
        let ended = false;
        const release = () => { ended = true; signal?.removeEventListener('abort', abort); entry.waiters.delete(waiter); };
        const waiter = { onProgress, resolve(value) { if (ended) { value.dispose(); return; } release(); resolve(value); },
          reject(error) { if (ended) return; release(); reject(error); } };
        const abort = () => { waiter.reject(cancelled()); idle(entry); };
        entry.waiters.add(waiter); signal?.addEventListener('abort', abort, { once: true });
        if (entry.progress) { try { onProgress?.(entry.progress); } catch {} }
      });
      queueMicrotask(drain); return promise;
    },
    close() { closed = true; for (const entry of [...entries.values()]) remove(entry); },
    stats() { return { entries: entries.size, active, queued: pending.length,
      bytes: [...entries.values()].reduce((sum, entry) => sum + (entry.asset?.byteCount ?? 0), 0) }; },
  };
}
