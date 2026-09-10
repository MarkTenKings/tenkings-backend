export const REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const REFERENCE_JSON_MAX_BYTES = 1024 * 1024;
export const REFERENCE_REQUEST_TIMEOUT_MS = 15_000;
export const REFERENCE_ATTEMPT_TIMEOUT_MS = 90_000;

/** The deadline covers headers and the entire streamed body, including stalled chunks. */
export async function fetchReferenceBytes(
  url: string,
  options: RequestInit & { maxBytes?: number; timeoutMs?: number } = {},
): Promise<Buffer> {
  const { maxBytes = REFERENCE_IMAGE_MAX_BYTES, timeoutMs = REFERENCE_REQUEST_TIMEOUT_MS, signal, ...init } = options;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(url, { ...init, signal: controller.signal });
    reader = response.body?.getReader();
    if (!response.ok || !reader) throw new Error("Reference request failed");
    const length = Number(response.headers.get("content-length"));
    if (length > maxBytes) throw new Error("Reference response exceeds byte limit");
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      controller.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Reference response exceeds byte limit");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function fetchReferenceJson(url: string, options: RequestInit & { maxBytes?: number } = {}): Promise<unknown> {
  const bytes = await fetchReferenceBytes(url, { maxBytes: REFERENCE_JSON_MAX_BYTES, ...options });
  return JSON.parse(bytes.toString("utf8"));
}
