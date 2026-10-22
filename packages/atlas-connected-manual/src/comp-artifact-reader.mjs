// Native comp reads use their own credentials and client. No grading storage
// client, write command, provider search, listener or I/O on construction.
import { createManualArtifactStore } from '@atlas/manual-service/artifacts';
import { requireThat } from '@atlas/manual-service/contract';

const valid = ok => requireThat(ok, 503, 'COMP_STORAGE_NOT_CONFIGURED');
export function createCompArtifactReader({ settings, createClient, GetObjectCommand }) {
  const names = ['endpoint', 'region', 'bucket', 'prefix', 'accessKeyId', 'secretAccessKey'];
  valid(settings && Object.getPrototypeOf(settings) === Object.prototype
    && Object.keys(settings).length === names.length && names.every(name => typeof settings[name] === 'string')
    && typeof createClient === 'function' && typeof GetObjectCommand === 'function');
  const captured = Object.fromEntries(names.map(name => [name, settings[name]]));
  let endpoint; try { endpoint = new URL(captured.endpoint); } catch { valid(false); }
  valid(endpoint.protocol === 'https:' && endpoint.origin === captured.endpoint && !endpoint.username && !endpoint.password
    && /^[a-z0-9-]{1,40}$/.test(captured.region) && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(captured.bucket)
    && /^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,120}$/.test(captured.prefix) && !captured.prefix.includes('..') && !captured.prefix.endsWith('/')
    && captured.accessKeyId.length >= 8 && captured.secretAccessKey.length >= 16);
  let client, send, destroy, closed = false, closing = false, failed = false, closePromise, invalidCleanup;
  const active = new Set();
  const current = () => valid(!closed && !failed && names.every(name => settings[name] === captured[name])
    && Object.keys(settings).length === names.length && (!client || client.send === send && client.destroy === destroy));
  const ownedClient = () => {
    current(); if (client) return client;
    let value;
    try { value = createClient({ endpoint: captured.endpoint, region: captured.region, maxAttempts: 1,
      credentials: { accessKeyId: captured.accessKeyId, secretAccessKey: captured.secretAccessKey } }); }
    catch (error) { failed = true; throw error; }
    // This host supplies a synchronous S3 constructor. Observe an invalid
    // thenable, but never use it as an untracked client.
    if (value?.then) {
      invalidCleanup = Promise.resolve(value).then(v => v?.destroy?.());
      void invalidCleanup.catch(() => {}); failed = true; valid(false);
    }
    if (value && typeof value.destroy === 'function') { client = value; send = value.send; destroy = value.destroy; }
    if (!client || typeof send !== 'function') { failed = true; valid(false); }
    current(); return client;
  };
  const store = createManualArtifactStore({ prefix: captured.prefix, transport: Object.freeze({
    putIfAbsent() { throw Object.assign(new Error('Comp storage is read only'), { status: 503, code: 'COMP_STORAGE_READ_ONLY' }); },
    async read({ key, maxBytes, signal }) {
      current(); valid(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 16 * 1024 * 1024);
      const owner = ownedClient(); signal.throwIfAborted();
      const result = await Reflect.apply(send, owner, [new GetObjectCommand({ Bucket: captured.bucket, Key: key, ChecksumMode: 'ENABLED' }), { abortSignal: signal }]);
      const body = result?.Body; let length = 0; const chunks = [];
      const abort = () => body?.destroy?.();
      try {
        current(); signal.throwIfAborted();
        valid(result.ContentLength === maxBytes && result.ContentType === 'application/json'
          && result.DeleteMarker !== true && result.ContentEncoding === undefined && result.ContentRange === undefined
          && body?.[Symbol.asyncIterator] && typeof body.destroy === 'function');
        // A stalled next chunk must be interrupted, not merely checked after
        // it eventually arrives; otherwise a timeout could leave close waiting.
        signal.addEventListener('abort', abort, { once: true });
        for await (const chunk of body) {
          current(); signal.throwIfAborted(); const bytes = Buffer.from(chunk); length += bytes.length;
          valid(length <= maxBytes); chunks.push(bytes);
        }
        valid(length === maxBytes); current(); signal.throwIfAborted();
        // The unchanged artifact store verifies exact SHA256, lineage, path,
        // card, kind, byte count and JSON before returning any saved content.
        return { bytes: Buffer.concat(chunks, length), contentType: result.ContentType,
          lineageSha256: result.Metadata?.['atlas-manual-lineage-sha256'] };
      } finally { signal.removeEventListener('abort', abort); body?.destroy?.(); }
    },
  }) });
  const reader = Object.freeze({ async read(ref, expected, options = {}) {
    current(); valid(!closing && ['PUBLIC_REPORT', 'MARKET_PREVIEW'].includes(expected?.kind));
    requireThat(active.size < 2, 503, 'COMP_BUSY');
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
    const work = Promise.resolve().then(() => store.read(ref, expected, { signal })); active.add(work);
    try { const value = await work; current(); signal.throwIfAborted(); return value; } finally { active.delete(work); }
  } });
  return Object.freeze({ reader, close() {
    if (closePromise) return closePromise; closing = true;
    closePromise = (async () => {
      await Promise.allSettled([...active]); closed = true;
      if (invalidCleanup) await invalidCleanup;
      if (client) await Reflect.apply(destroy, client, []);
    })();
    return closePromise;
  } });
}
