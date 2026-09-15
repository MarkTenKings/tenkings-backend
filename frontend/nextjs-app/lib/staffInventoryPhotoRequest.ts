/** A mobile transfer can outlast a short fetch timeout before the server even
 * receives the JPEG. Keep exact bytes/identity across one bounded recovery. */
export const STAFF_PHOTO_REQUEST_TIMEOUT_MS = 75_000;
const RETRY_DELAY_MS = 300;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

class PhotoRequestError extends Error {
  constructor(readonly retryable: boolean) { super('The photo could not be saved.'); }
}

function cancelled() { return new DOMException('Photo upload cancelled.', 'AbortError'); }
function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(cancelled()); return; }
    const abort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, RETRY_DELAY_MS);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function saveStaffInventoryPhoto(input: {
  image: string; uploadId: string; headers: Record<string, string>; signal: AbortSignal;
}, deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<{ photo_key: string; photo_url: string }> {
  const body = JSON.stringify({ image: input.image, upload_id: input.uploadId });
  const timeoutMs = Math.max(1, Math.min(STAFF_PHOTO_REQUEST_TIMEOUT_MS, deps.timeoutMs ?? STAFF_PHOTO_REQUEST_TIMEOUT_MS));
  for (let attempt = 0; attempt < 2; attempt++) {
    if (input.signal.aborted) throw cancelled();
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal.addEventListener('abort', abort, { once: true });
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(cancelled());
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    const timer = setTimeout(abort, timeoutMs);
    try {
      return await Promise.race([(async () => {
        const response = await (deps.fetchImpl ?? fetch)('/api/v2/admin/inventory/photo', {
          method: 'POST', headers: input.headers, body, signal: controller.signal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new PhotoRequestError(RETRYABLE_STATUS.has(response.status));
        }
        const result = await response.json();
        if (!result || typeof result.photo_key !== 'string' || !result.photo_key || typeof result.photo_url !== 'string' || !result.photo_url) throw new PhotoRequestError(false);
        return { photo_key: result.photo_key as string, photo_url: result.photo_url as string };
      })(), aborted]);
    } catch (error) {
      if (input.signal.aborted) throw cancelled();
      if (attempt === 1 || error instanceof PhotoRequestError && !error.retryable) throw error;
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', rejectAbort);
      controller.abort();
    }
    await delay(input.signal);
  }
  throw new PhotoRequestError(false);
}
