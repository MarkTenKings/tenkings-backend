// All mounted public reports share the native reader's two-request allowance.
// Queue grants only: verified image bytes still travel directly from storage.
export function createPublicImageAccessLoader({ fetchImpl = (...args) => fetch(...args),
  timeoutMs = 30000, retryDelays = [250, 750] } = {}) {
  const queue = []; let active = 0, scheduled = false;
  const drain = () => {
    scheduled = false;
    queue.sort((a, b) => a.priority - b.priority);
    while (active < 2 && queue.length) {
      const next = queue.shift(); next.detach();
      if (next.signal.aborted) { next.reject(next.signal.reason); continue; }
      active++;
      Promise.resolve().then(() => { next.signal.throwIfAborted(); return next.run(); })
        .then(next.resolve, next.reject).finally(() => { active--; schedule(); });
    }
  };
  const schedule = () => {
    if (!scheduled) { scheduled = true; queueMicrotask(drain); }
  };
  const enqueue = (run, signal, priority) => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const entry = { run, signal, priority, resolve, reject,
      detach: () => signal.removeEventListener('abort', abort) };
    const abort = () => { const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); entry.detach(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true }); queue.push(entry); schedule();
  });
  const pause = (ms, signal) => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(done, ms); signal.addEventListener('abort', abort, { once: true });
  });
  return async function loadAccess(url, { signal = new AbortController().signal, parse, priority = 0 }) {
    // One deadline includes queueing, all attempts, parsing and backoff. A busy
    // response never starts a new timeout or keeps another queued reader out.
    const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(new Error('IMAGE_ACCESS_TIMEOUT')), timeoutMs);
    const bounded = AbortSignal.any([signal, deadline.signal]);
    try {
      for (let attempt = 0; ; attempt++) {
        const result = await enqueue(async () => {
          const response = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: bounded });
          bounded.throwIfAborted();
          if (response.status === 503 && attempt < retryDelays.length) {
            await response.body?.cancel(); return { busy: true };
          }
          if (!response.ok) throw new Error('IMAGE_ACCESS_UNAVAILABLE');
          const value = parse(await response.json()); bounded.throwIfAborted();
          return { value };
        }, bounded, priority);
        if (!result.busy) return result.value;
        await pause(retryDelays[attempt], bounded);
      }
    } finally { clearTimeout(timer); }
  };
}

// No grants/results are cached; each caller obtains fresh publication authority.
export const loadPublicImageAccess = createPublicImageAccessLoader();
