import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { requireThat } from '@atlas/manual-service/contract';

const VERSION = 'atlas-label-style-cache-v1';
const KINDS = ['request', 'reservation', 'response', 'result'];
const KEY = /^(label-style|label-wordmark-generate|label-wordmark-verify):v1:([a-f0-9]{64})$/;
const HASH = /^[a-f0-9]{64}$/;
// A generated-wordmark response may retain up to12MiB of JSON/base64. Style
// analysis itself is separately bounded to512KiB by its provider adapter.
export const LABEL_STYLE_CACHE_MAX_BYTES = 13 * 1024 * 1024;
const sha = value => createHash('sha256').update(value).digest('hex');
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function binding(request, kind) {
  const match = typeof request?.requestKey === 'string' && KEY.exec(request.requestKey);
  requireThat(match && HASH.test(request.sourceHash) && KINDS.includes(kind), 409, 'LABEL_STYLE_CACHE_BINDING_INVALID');
  return { kind, requestKey: request.requestKey, sourceHash: request.sourceHash, key: `${match[1]}/${match[2]}/${kind}.json` };
}
function encode(request, kind, value) {
  const expected = binding(request, kind), body = JSON.stringify(value);
  requireThat(typeof body === 'string' && body.length > 0 && Buffer.byteLength(body) <= LABEL_STYLE_CACHE_MAX_BYTES - 2048,
    413, 'LABEL_STYLE_CACHE_TOO_LARGE');
  // JSON round-trip rejects accidental undefined/non-JSON contract payloads.
  const normalized = JSON.parse(body);
  const bytes = Buffer.from(JSON.stringify({ version: VERSION, kind, requestKey: expected.requestKey,
    sourceHash: expected.sourceHash, valueHash: sha(body), value: normalized }));
  requireThat(bytes.length <= LABEL_STYLE_CACHE_MAX_BYTES, 413, 'LABEL_STYLE_CACHE_TOO_LARGE');
  return bytes;
}
function decode(bytes, request, kind) {
  const expected = binding(request, kind);
  requireThat(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= LABEL_STYLE_CACHE_MAX_BYTES, 503, 'LABEL_STYLE_CACHE_CORRUPT');
  let record;
  try { record = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { requireThat(false, 503, 'LABEL_STYLE_CACHE_CORRUPT'); }
  requireThat(exact(record, ['version', 'kind', 'requestKey', 'sourceHash', 'valueHash', 'value'])
    && record.version === VERSION && record.kind === kind && record.requestKey === expected.requestKey
    && record.sourceHash === expected.sourceHash && HASH.test(record.valueHash)
    && sha(JSON.stringify(record.value)) === record.valueHash, 503, 'LABEL_STYLE_CACHE_CORRUPT');
  return record.value;
}

/** The adapter MUST implement a durable atomic create-if-absent. A plain file
 * write or an in-memory map is not a production reservation. Only an observed
 * successful conditional write may return true. An ambiguous write returns
 * false (or throws), even if later reading finds the same value. */
export function createLabelStyleCache({ read, putIfAbsent } = {}) {
  requireThat(typeof read === 'function' && typeof putIfAbsent === 'function', 503, 'LABEL_STYLE_CACHE_UNAVAILABLE');
  return Object.freeze({
    async read(request, kind, { signal } = {}) {
      const { key } = binding(request, kind); signal?.throwIfAborted();
      const bytes = await read(key, { signal });
      return bytes === null ? null : decode(bytes, request, kind);
    },
    async putIfAbsent(request, kind, value, { signal } = {}) {
      const { key } = binding(request, kind), bytes = encode(request, kind, value); signal?.throwIfAborted();
      const created = await putIfAbsent(key, bytes, { signal });
      requireThat(typeof created === 'boolean', 503, 'LABEL_STYLE_CACHE_WRITE_UNCERTAIN');
      const stored = await read(key, { signal });
      requireThat(stored !== null, 503, 'LABEL_STYLE_CACHE_WRITE_UNCERTAIN');
      if (created) requireThat(sha(stored) === sha(bytes), 503, 'LABEL_STYLE_CACHE_CONFLICT');
      return { created, value: decode(stored, request, kind) };
    },
  });
}

const absent = error => error?.$metadata?.httpStatusCode === 404 && ['NotFound', 'NoSuchKey'].includes(error.name);
function bounded(promise, signal, onLate = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { if (settled) onLate(value); else finish(resolve, value); }, error => finish(reject, error));
    if (signal.aborted) abort();
  });
}

/** Private immutable S3 cache. There are no list/delete/update operations,
 * signed/public URLs, schema changes or user-selectable storage keys. */
export function createS3LabelStyleCache({ client, bucket, keyPrefix, timeoutMs = 20000 } = {}) {
  requireThat(client?.send && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
    && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(keyPrefix)
    && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 503, 'LABEL_STYLE_CACHE_CONFIGURATION_INVALID');
  const prefix = keyPrefix.endsWith('/label-styles') ? keyPrefix : `${keyPrefix}/label-styles`;
  const deadline = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  async function read(key, options = {}) {
    const signal = deadline(options.signal); let body;
    try {
      signal.throwIfAborted();
      const response = await bounded(client.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}/${key}`, ChecksumMode: 'ENABLED' }),
        { abortSignal: signal }), signal, late => late?.Body?.destroy?.());
      body = response.Body;
      requireThat(!response.DeleteMarker && !response.ContentRange && !response.ContentEncoding && response.ContentType === 'application/json'
        && Number.isSafeInteger(response.ContentLength) && response.ContentLength > 0 && response.ContentLength <= LABEL_STYLE_CACHE_MAX_BYTES
        && HASH.test(response.Metadata?.['atlas-label-style-sha256']) && body && typeof body[Symbol.asyncIterator] === 'function',
      503, 'LABEL_STYLE_CACHE_CORRUPT');
      const chunks = []; let total = 0; const iterator = body[Symbol.asyncIterator]();
      for (;;) {
        const part = await bounded(iterator.next(), signal); if (part.done) break;
        requireThat(part.value instanceof Uint8Array, 503, 'LABEL_STYLE_CACHE_CORRUPT');
        total += part.value.byteLength;
        requireThat(total <= response.ContentLength && total <= LABEL_STYLE_CACHE_MAX_BYTES, 503, 'LABEL_STYLE_CACHE_TOO_LARGE');
        chunks.push(Buffer.from(part.value));
      }
      signal.throwIfAborted(); const bytes = Buffer.concat(chunks, total), hash = sha(bytes);
      requireThat(total === response.ContentLength && hash === response.Metadata['atlas-label-style-sha256']
        && (response.ChecksumSHA256 === undefined || response.ChecksumSHA256 === Buffer.from(hash, 'hex').toString('base64')),
      503, 'LABEL_STYLE_CACHE_CORRUPT');
      return bytes;
    } catch (error) { if (absent(error)) return null; throw error; }
    finally { body?.destroy?.(); }
  }
  return createLabelStyleCache({ read,
    async putIfAbsent(key, bytes, options = {}) {
      const signal = deadline(options.signal), hash = sha(bytes); signal.throwIfAborted();
      try {
        const response = await bounded(client.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}/${key}`, Body: bytes,
          ContentLength: bytes.length, ContentType: 'application/json', IfNoneMatch: '*', ChecksumAlgorithm: 'SHA256',
          ChecksumSHA256: Buffer.from(hash, 'hex').toString('base64'), Metadata: { 'atlas-label-style-sha256': hash } }),
        { abortSignal: signal }), signal);
        requireThat(response?.$metadata?.httpStatusCode >= 200 && response.$metadata.httpStatusCode < 300,
          503, 'LABEL_STYLE_CACHE_WRITE_UNCERTAIN');
        return true;
      } catch (error) {
        const status = error?.$metadata?.httpStatusCode;
        // Never infer reservation ownership from readback after transport loss.
        // The wrapper reconciles the same key; a missing object remains error.
        if (status === 409 || status === 412 || !status || status >= 500) return false;
        throw error;
      }
    },
  });
}
