import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { INSPECTION_ALPHA_PREVIEW_ENCODER, encodeInspectionAlphaPreview } from './inspection-alpha-preview-encoder.mjs';

export const INSPECTION_ALPHA_PREVIEW_POLICY = 'atlas-inspection-alpha-preview-v1';
export const INSPECTION_ALPHA_PREVIEW_RECIPE = Object.freeze({
  policyVersion: INSPECTION_ALPHA_PREVIEW_POLICY, width: 558, height: 768, mime: 'image/webp',
  resize: Object.freeze({ fit: 'fill', kernel: 'lanczos3' }),
  webp: Object.freeze({ quality: 78, alphaQuality: 100, effort: 4 }),
  alpha: 'preserve', encoder: INSPECTION_ALPHA_PREVIEW_ENCODER,
});
const MAX_SOURCE_BYTES = 50 * 1024 * 1024, MAX_OUTPUT_BYTES = 1024 * 1024;
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const absent = error => error?.$metadata?.httpStatusCode === 404 && ['NotFound', 'NoSuchKey'].includes(error.name);
const check = condition => requireThat(condition, 503, 'INSPECTION_ALPHA_CACHE_INVALID');

function cancellable(promise, signal, onLate = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { if (settled) onLate(value); else finish(resolve, value); }, error => finish(reject, error));
    if (signal?.aborted) abort();
  });
}

/** An optional, additive cache for a verified APPROVED_MEDIA side. It never
 * changes the saved derivative, JPEG preview, publication, approval or DB.
 * No signed URL is persisted or shared between callers. */
export function createInspectionAlphaPreviewResolver({ storage, client, bucket, keyPrefix, sign = getSignedUrl,
  encode = encodeInspectionAlphaPreview, timeoutMs = 8000, maxJobs = 8 }) {
  requireThat(typeof storage?.readDerivative === 'function' && typeof client?.send === 'function'
    && typeof sign === 'function' && typeof encode === 'function'
    && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
    && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(keyPrefix) && keyPrefix.endsWith('/inspection-alpha-previews')
    && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 8000
    && Number.isInteger(maxJobs) && maxJobs >= 1 && maxJobs <= 8, 500, 'INSPECTION_ALPHA_CONFIGURATION_INVALID');
  const recipeHash = digest(canonical(INSPECTION_ALPHA_PREVIEW_RECIPE));
  const jobs = new Map(), queue = []; let active = false;
  function source(saved) {
    const { content, dimensions } = saved?.descriptor?.raster ?? {};
    check(saved?.descriptor?.purpose === 'inspection' && content?.mime === 'image/webp' && validHash(content.sha256)
      && Number.isSafeInteger(content.byteCount) && content.byteCount > 0 && content.byteCount <= MAX_SOURCE_BYTES
      && dimensions?.width === 1350 && dimensions.height === 1858);
    return { sha256: content.sha256, byteCount: content.byteCount };
  }
  const keyFor = source => `${keyPrefix}/${source.sha256}/${recipeHash}.webp`;
  const bindingFor = source => digest(canonical({ source, recipeHash }));
  async function send(command, signal) {
    signal.throwIfAborted();
    return cancellable(client.send(command, { abortSignal: signal }), signal, value => value?.Body?.destroy?.());
  }
  async function read(source, signal) {
    let body;
    try {
      const result = await send(new GetObjectCommand({ Bucket: bucket, Key: keyFor(source), ChecksumMode: 'ENABLED' }), signal);
      body = result.Body;
      const sha256 = result.Metadata?.['atlas-output-sha256'];
      check(!result.DeleteMarker && !result.ContentRange && !result.ContentEncoding
        && result.ContentType === 'image/webp' && Number.isSafeInteger(result.ContentLength)
        && result.ContentLength > 0 && result.ContentLength <= MAX_OUTPUT_BYTES
        && result.Metadata?.['atlas-alpha-binding'] === bindingFor(source) && validHash(sha256)
        && (result.ChecksumSHA256 === undefined || result.ChecksumSHA256 === Buffer.from(sha256, 'hex').toString('base64'))
        && typeof result.ETag === 'string' && result.ETag.length > 0 && result.ETag.length <= 512
        && !/[\x00-\x1f\x7f]/.test(result.ETag)
        && (result.VersionId === undefined || typeof result.VersionId === 'string' && result.VersionId.length > 0
          && result.VersionId.length <= 512 && !/[\x00-\x1f\x7f]/.test(result.VersionId))
        && body && typeof body[Symbol.asyncIterator] === 'function');
      const chunks = []; let length = 0;
      const iterator = body[Symbol.asyncIterator]();
      while (true) {
        const next = await cancellable(iterator.next(), signal);
        if (next.done) break;
        check(next.value instanceof Uint8Array);
        length += next.value.byteLength;
        check(length <= result.ContentLength && length <= MAX_OUTPUT_BYTES);
        chunks.push(Buffer.from(next.value));
      }
      const bytes = Buffer.concat(chunks, length);
      check(length === result.ContentLength && digest(bytes) === sha256);
      const metadata = await cancellable(sharp(bytes, { limitInputPixels: 558 * 768, failOn: 'warning' }).metadata(), signal);
      check(metadata.format === 'webp' && metadata.width === 558 && metadata.height === 768
        && (metadata.pages ?? 1) === 1 && (metadata.orientation ?? 1) === 1);
      return { key: keyFor(source), versionId: result.VersionId ?? null, etag: result.ETag, sha256, byteCount: length };
    } finally { body?.destroy?.(); }
  }
  async function prepare(saved, expected, signal) {
    try { return await read(expected, signal); } catch (error) { if (!absent(error)) throw error; }
    const full = await cancellable(storage.readDerivative({ ...saved, signal }), signal);
    check(Buffer.isBuffer(full?.bytes) && full.bytes.length === expected.byteCount && digest(full.bytes) === expected.sha256);
    signal.throwIfAborted();
    // Encoder observes the job deadline and owns its child until exit. Caller
    // cancellation only stops that caller's wait, never another caller's job.
    const bytes = await encode(full.bytes, { signal });
    signal.throwIfAborted();
    check(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_OUTPUT_BYTES);
    const sha256 = digest(bytes);
    try {
      await send(new PutObjectCommand({ Bucket: bucket, Key: keyFor(expected), Body: bytes,
        ContentLength: bytes.length, ContentType: 'image/webp', CacheControl: 'private, max-age=31536000, immutable',
        IfNoneMatch: '*', ChecksumAlgorithm: 'SHA256', ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
        Metadata: { 'atlas-alpha-binding': bindingFor(expected), 'atlas-output-sha256': sha256 } }), signal);
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      if (status && status < 500 && status !== 409 && status !== 412 || status === 501 || error?.name === 'NotImplemented') throw error;
    }
    signal.throwIfAborted();
    // A winner or uncertain write converges on the same create-only object.
    // Corruption is omitted, never repaired by overwriting private evidence.
    return read(expected, signal);
  }
  function pump() {
    if (active) return;
    const job = queue.shift();
    if (!job) return;
    if (job.signal.aborted) { jobs.delete(job.key); job.reject(job.signal.reason); clearTimeout(job.timer); pump(); return; }
    active = true;
    Promise.resolve().then(() => prepare(job.saved, job.source, job.signal)).then(job.resolve, job.reject).finally(() => {
      clearTimeout(job.timer); jobs.delete(job.key); active = false; pump();
    });
  }
  return Object.freeze({ async resolve({ saved, signal } = {}) {
    signal?.throwIfAborted();
    const expected = source(saved), key = keyFor(expected);
    let job = jobs.get(key);
    if (!job) {
      requireThat(jobs.size < maxJobs, 503, 'INSPECTION_ALPHA_BUSY');
      const controller = new AbortController();
      job = { key, saved: structuredClone(saved), source: expected, signal: controller.signal, deadline: Date.now() + timeoutMs };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      job.timer = setTimeout(() => controller.abort(Error('INSPECTION_ALPHA_TIMEOUT')), timeoutMs);
      jobs.set(key, job); queue.push(job); pump();
    }
    // Both the caller and the shared job have independent finite deadlines.
    const found = await cancellable(job.promise, signal ? AbortSignal.any([signal, job.signal]) : job.signal);
    signal?.throwIfAborted();
    const remaining = job.deadline - Date.now();
    requireThat(remaining > 0, 503, 'INSPECTION_ALPHA_TIMEOUT');
    const grantSignal = AbortSignal.any([job.signal, AbortSignal.timeout(remaining), ...(signal ? [signal] : [])]);
    // If-Match would sign a required browser header absent from the URL-only
    // access contract. Unversioned reads use the immutable create-only key;
    // the browser still verifies the exact output SHA before showing pixels.
    const url = await cancellable(sign(client, new GetObjectCommand({ Bucket: bucket, Key: found.key,
      ...(found.versionId ? { VersionId: found.versionId } : {}) }), { expiresIn: 120 }), grantSignal);
    check(typeof url === 'string' && new URL(url).protocol === 'https:');
    return { policyVersion: INSPECTION_ALPHA_PREVIEW_POLICY, sourceSha256: expected.sha256,
      width: 558, height: 768, mime: 'image/webp', sha256: found.sha256, byteCount: found.byteCount, url };
  } });
}
