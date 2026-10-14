import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { canonical, digest, requireThat, uuid } from '@atlas/manual-service/contract';

const hash = value => requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 503, 'LABEL_STORAGE_BINDING_INVALID');
const absent = error => error?.$metadata?.httpStatusCode === 404 && ['NotFound','NoSuchKey'].includes(error.name);
/** Separate immutable binary storage. No object listing, deletes, arbitrary key,
 * user-selected bucket or base64 transport. A signed URL is issued only after
 * the service reauthorizes all source cards of this exact export. */
export function createLabelExportStorage({ client, bucket, keyPrefix, sign = getSignedUrl, maxBytes = 64 * 1024 * 1024, timeoutMs = 60000 }) {
  requireThat(client?.send && typeof sign === 'function' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
    && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(keyPrefix) && keyPrefix.endsWith('/label-exports'), 500, 'LABEL_STORAGE_CONFIGURATION_INVALID');
  requireThat(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 64 * 1024 * 1024 && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000, 500, 'LABEL_STORAGE_CONFIGURATION_INVALID');
  function expected(binding, content) {
    uuid(binding.exportId); hash(binding.manifestHash); hash(content.sha256);
    requireThat(['SHEET','SINGLE'].includes(binding.kind) && content.contentType === 'image/png' && Number.isSafeInteger(content.byteCount)
      && content.byteCount > 32 && content.byteCount <= maxBytes, 503, 'LABEL_STORAGE_BINDING_INVALID');
    const bindingHash = digest(canonical(binding));
    return { key: `${keyPrefix}/${binding.exportId}/${binding.manifestHash}/${content.sha256}.png`, bindingHash, ...content };
  }
  function headers(response, want, versionId = null) {
    requireThat(response && !response.DeleteMarker && !response.ContentRange && !response.ContentEncoding
      && response.ContentLength === want.byteCount && response.ContentType === 'image/png'
      && response.Metadata?.['atlas-label-binding'] === want.bindingHash
      && typeof response.ETag === 'string' && response.ETag.length < 256
      && (versionId === null || response.VersionId === versionId)
      && (response.ChecksumSHA256 === undefined || response.ChecksumSHA256 === Buffer.from(want.sha256, 'hex').toString('base64')),
    503, 'LABEL_STORAGE_CONFLICT');
    return { key: want.key, versionId: response.VersionId ?? null, etag: response.ETag };
  }
  function cancellable(promise, signal, onLate = () => {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); fn(value); };
      const abort = () => finish(reject, signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(value => { if (settled) onLate(value); else finish(resolve, value); }, error => finish(reject, error));
      if (signal.aborted) abort();
    });
  }
  async function send(command, signal) {
    signal.throwIfAborted();
    return cancellable(client.send(command, { abortSignal: signal }), signal, result => result?.Body?.destroy?.());
  }
  async function read(want, versionId = null) {
    const signal = AbortSignal.timeout(timeoutMs); let body;
    try {
      const head = await send(new HeadObjectCommand({ Bucket: bucket, Key: want.key, ChecksumMode: 'ENABLED', ...(versionId ? { VersionId: versionId } : {}) }), signal);
      const object = headers(head, want, versionId);
      const found = await send(new GetObjectCommand({ Bucket: bucket, Key: want.key, ChecksumMode: 'ENABLED',
        ...(object.versionId ? { VersionId: object.versionId } : { IfMatch: object.etag }) }), signal);
      body = found.Body; const observed = headers(found, want, object.versionId);
      requireThat(observed.etag === object.etag && body && typeof body[Symbol.asyncIterator] === 'function', 503, 'LABEL_STORAGE_CONFLICT');
      let length = 0; const chunks = [];
      const iterator = body[Symbol.asyncIterator]();
      while (true) { const next = await cancellable(iterator.next(), signal); if (next.done) break; const chunk = next.value;
        signal.throwIfAborted(); requireThat(chunk instanceof Uint8Array, 503, 'LABEL_STORAGE_CONFLICT'); length += chunk.byteLength;
        requireThat(length <= want.byteCount && length <= maxBytes, 503, 'LABEL_STORAGE_CONFLICT'); chunks.push(Buffer.from(chunk)); }
      const bytes = Buffer.concat(chunks, length); requireThat(length === want.byteCount && digest(bytes) === want.sha256, 503, 'LABEL_STORAGE_CONFLICT');
      return object;
    } finally { body?.destroy?.(); }
  }
  return Object.freeze({
    async write(binding, bytes, { sha256, contentType = 'image/png' } = {}) {
      requireThat(Buffer.isBuffer(bytes) && bytes.length > 32 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && digest(bytes) === sha256, 503, 'LABEL_PNG_INVALID');
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      requireThat(width > 0 && height > 0 && width <= 12800 && height <= 12800, 503, 'LABEL_PNG_INVALID');
      const want = expected(binding, { sha256, byteCount: bytes.length, contentType });
      let object;
      try { object = await read(want); } catch (error) { if (!absent(error)) throw error; }
      if (!object) {
        let response;
        try { response = await send(new PutObjectCommand({ Bucket: bucket, Key: want.key, Body: bytes, ContentLength: bytes.length,
          ContentType: contentType, IfNoneMatch: '*', ChecksumAlgorithm: 'SHA256', ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
          Metadata: { 'atlas-label-binding': want.bindingHash } }), AbortSignal.timeout(timeoutMs)); }
        catch (error) {
          const status = error?.$metadata?.httpStatusCode;
          requireThat(!status || status >= 500 && status !== 501 || status === 409 || status === 412, 503, 'LABEL_STORAGE_WRITE_REJECTED');
        }
        // An uncertain write always reconciles the same immutable key.
        object = await read(want, response?.VersionId ?? null);
      }
      return { object, sha256, byteCount: bytes.length, contentType };
    },
    async download(binding, saved) {
      const want = expected(binding, saved);
      requireThat(saved.object?.key === want.key && (saved.object.versionId === null || typeof saved.object.versionId === 'string'), 503, 'LABEL_STORAGE_SCOPE_INVALID');
      const head = await send(new HeadObjectCommand({ Bucket: bucket, Key: want.key, ChecksumMode: 'ENABLED',
        ...(saved.object.versionId ? { VersionId: saved.object.versionId } : {}) }), AbortSignal.timeout(timeoutMs));
      const object = headers(head, want, saved.object.versionId);
      requireThat(object.etag === saved.object.etag, 503, 'LABEL_STORAGE_CONFLICT');
      const expiresIn = 60, url = await cancellable(sign(client, new GetObjectCommand({ Bucket: bucket, Key: want.key,
        ...(object.versionId ? { VersionId: object.versionId } : {}),
        ResponseContentType: 'image/png', ResponseContentDisposition: `attachment; filename="ATLAS-${binding.kind.toLowerCase()}-${binding.exportId}.png"` }), { expiresIn }), AbortSignal.timeout(timeoutMs));
      requireThat(typeof url === 'string' && url.startsWith('https://'), 503, 'LABEL_STORAGE_URL_INVALID');
      return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
    },
  });
}
