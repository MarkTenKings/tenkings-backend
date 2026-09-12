import { createHash } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { completeUpload, descriptorSha256, parseDecodedFrame, parseDerivative, parseOriginal, parseUploadPlan } from '@atlas/photo-core';
import { describeDecodedFrame, verifyAndDecodePhoto } from '@atlas/photo-runtime';

export class PhotoStorageError extends Error {
  constructor(code) { super(code); this.name = 'PhotoStorageError'; this.code = code; }
}
const fail = code => { throw new PhotoStorageError(code); };
const check = (value, code = 'PHOTO_STORAGE_INVALID') => { if (!value) fail(code); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => structuredClone(value);
const digestBase64 = value => Buffer.from(value, 'hex').toString('base64');
const versionOf = response => response.VersionId === undefined ? null : response.VersionId;
const aborted = signal => { if (signal.aborted) throw signal.reason; };
const isMissing = error => error?.$metadata?.httpStatusCode === 404
  && ['NotFound', 'NoSuchKey'].includes(error.name);
const isConflict = error => error?.$metadata?.httpStatusCode === 412 || error?.name === 'PreconditionFailed';
function closeBody(body) { try { body?.destroy?.(); } catch { /* Do not expose native diagnostics. */ } }
function signalShape(signal) { check(signal === undefined || signal instanceof AbortSignal); }
function text(value) { check(typeof value === 'string' && value.length > 0 && value.length <= 512 && value === value.trim()); }
function decodedLimits(value) {
  const keys = ['maxInputBytes', 'maxPixels', 'maxRasterBytes', 'maxOutputBytes', 'timeoutMs'];
  check(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === keys.length
    && keys.every(key => Number.isSafeInteger(value[key]) && value[key] > 0) && value.timeoutMs <= 2_147_483_647);
  return { ...value };
}

// SDK abort normally settles the request. Also fence a noncooperative/late
// injected transport and destroy a late response body instead of adopting it.
function cancellable(promise, signal, onLate = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', cancel); fn(value);
    };
    const cancel = () => finish(reject, signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then(value => {
      if (settled) onLate(value); else finish(resolve, value);
    }, error => finish(reject, error));
    if (signal.aborted) cancel();
  });
}
async function bounded(signal, timeoutMs, operation) {
  signalShape(signal);
  if (signal?.aborted) fail('PHOTO_STORAGE_CANCELLED');
  const controller = new AbortController();
  const cancel = () => controller.abort(new PhotoStorageError('PHOTO_STORAGE_CANCELLED'));
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new PhotoStorageError('PHOTO_STORAGE_TIMEOUT')), timeoutMs);
  try { return await operation(controller.signal); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}

/** Server-owned S3/Spaces adapter. Authentication, durable unique plans,
 * compare-and-set adoption and private bucket policy remain host responsibilities.
 * No environment credential loading, delete, list, copy or filesystem store.
 */
export function createPhotoStorage({ client, bucket, keyPrefix, limits,
  decode = verifyAndDecodePhoto, sign = getSignedUrl } = {}) {
  check(client && typeof client.send === 'function');
  text(bucket); check(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket));
  text(keyPrefix); check(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(keyPrefix));
  check(limits && Object.keys(limits).length === 2
    && ['maxObjectBytes', 'timeoutMs'].every(key => Number.isSafeInteger(limits[key]) && limits[key] > 0)
    && limits.timeoutMs <= 2_147_483_647);
  check(typeof decode === 'function' && typeof sign === 'function');
  const maximum = limits.maxObjectBytes, timeoutMs = limits.timeoutMs;

  function scoped(object, kind) {
    // Use the original descriptor's closed storage-key/version validator.
    parseOriginal({ schemaVersion: 1, kind: 'original', uploadId: 'storage-shape',
      binding: { cardId: 'storage-shape', pairId: 'storage-shape', side: 'FRONT', version: 1 },
      object, content: { mime: 'image/png', sha256: '0'.repeat(64), byteCount: 1 }, metadata: null });
    check(object.key.startsWith(`${keyPrefix}/${kind === 'original' ? 'originals' : 'derived'}/`), 'PHOTO_STORAGE_SCOPE');
  }
  function expectation(object, content, bindingSha256, kind) {
    scoped(object, kind);
    check(Number.isSafeInteger(content.byteCount) && content.byteCount > 0 && content.byteCount <= maximum, 'PHOTO_STORAGE_LIMIT');
    check(/^[a-f0-9]{64}$/.test(content.sha256) && /^[a-f0-9]{64}$/.test(bindingSha256));
    return { object: clone(object), content: clone(content), bindingSha256, kind };
  }
  function originalExpectation(plan, object = plan.object) {
    check(object.key === plan.object.key, 'PHOTO_STORAGE_CONFLICT');
    return expectation(object, { ...plan.expected, mime: 'application/octet-stream' }, descriptorSha256(plan), 'original');
  }
  function derivedExpectation(descriptor) {
    const planned = clone(descriptor); planned.raster.object.versionId = null;
    return expectation(descriptor.raster.object, descriptor.raster.content, descriptorSha256(planned), descriptor.kind);
  }
  function ownedBytes(bytes, expected) {
    check(bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer);
    check(bytes.byteLength > 0 && bytes.byteLength <= maximum, 'PHOTO_STORAGE_LIMIT');
    check(bytes.byteLength === expected.content.byteCount, 'PHOTO_STORAGE_CONFLICT');
    const owned = Buffer.from(bytes);
    check(sha256(owned) === expected.content.sha256, 'PHOTO_STORAGE_CONFLICT');
    return owned;
  }
  function putInput(expected, bytes) {
    return { Bucket: bucket, Key: expected.object.key, ...(bytes ? { Body: bytes } : {}),
      ContentLength: expected.content.byteCount, ContentType: expected.content.mime,
      ChecksumSHA256: digestBase64(expected.content.sha256), IfNoneMatch: '*',
      Metadata: { 'atlas-kind': expected.kind, 'atlas-binding-sha256': expected.bindingSha256 } };
  }
  function headers(response, expected, requiredVersion = expected.object.versionId) {
    check(response && response.DeleteMarker !== true && response.ContentRange === undefined
      && response.ContentEncoding === undefined, 'PHOTO_STORAGE_CONFLICT');
    check(response.ContentLength === expected.content.byteCount && response.ContentLength <= maximum,
      'PHOTO_STORAGE_CONFLICT');
    check(response.ContentType === expected.content.mime
      && response.Metadata?.['atlas-kind'] === expected.kind
      && response.Metadata?.['atlas-binding-sha256'] === expected.bindingSha256, 'PHOTO_STORAGE_CONFLICT');
    const versionId = versionOf(response);
    scoped({ key: expected.object.key, versionId }, expected.kind);
    check(requiredVersion === null || versionId === requiredVersion, 'PHOTO_STORAGE_CONFLICT');
    if (response.ChecksumSHA256 !== undefined) check(response.ChecksumSHA256 === digestBase64(expected.content.sha256), 'PHOTO_STORAGE_CONFLICT');
    check(typeof response.ETag === 'string' && response.ETag.length > 0 && response.ETag.length <= 512
      && !/[\x00-\x1f\x7f]/.test(response.ETag), 'PHOTO_STORAGE_CONFLICT');
    return { key: expected.object.key, versionId };
  }
  async function send(command, signal) {
    aborted(signal);
    return cancellable(client.send(command, { abortSignal: signal }), signal, value => closeBody(value?.Body));
  }
  async function readExpected(expected, signal) {
    return bounded(signal, timeoutMs, async activeSignal => {
      let body;
      try {
        const head = await send(new HeadObjectCommand({ Bucket: bucket, Key: expected.object.key,
          ...(expected.object.versionId !== null ? { VersionId: expected.object.versionId } : {}), ChecksumMode: 'ENABLED' }), activeSignal);
        const object = headers(head, expected);
        const result = await send(new GetObjectCommand({ Bucket: bucket, Key: object.key, ChecksumMode: 'ENABLED',
          ...(object.versionId !== null ? { VersionId: object.versionId } : { IfMatch: head.ETag }) }), activeSignal);
        body = result.Body;
        const observed = headers(result, expected, object.versionId);
        check(observed.versionId === object.versionId && result.ETag === head.ETag, 'PHOTO_STORAGE_CONFLICT');
        check(body && typeof body[Symbol.asyncIterator] === 'function' && typeof body.destroy === 'function', 'PHOTO_STORAGE_INVALID_RESPONSE');
        const chunks = [], hash = createHash('sha256'), iterator = body[Symbol.asyncIterator]();
        let count = 0;
        while (true) {
          const next = await cancellable(iterator.next(), activeSignal);
          if (next.done) break;
          check(next.value instanceof Uint8Array, 'PHOTO_STORAGE_INVALID_RESPONSE');
          count += next.value.byteLength;
          check(count <= expected.content.byteCount && count <= maximum, 'PHOTO_STORAGE_LIMIT');
          // Own each chunk: an injected reader may reuse its backing buffer.
          const chunk = Buffer.from(next.value); hash.update(chunk); chunks.push(chunk);
        }
        aborted(activeSignal);
        check(count === expected.content.byteCount && hash.digest('hex') === expected.content.sha256, 'PHOTO_STORAGE_CONFLICT');
        return { object: observed, byteCount: count, sha256: expected.content.sha256,
          contentType: expected.content.mime, bytes: Buffer.concat(chunks, count) };
      } catch (error) {
        if (error instanceof PhotoStorageError || error?.name === 'PhotoContractError') throw error;
        if (isMissing(error)) fail('PHOTO_OBJECT_NOT_FOUND');
        if (isConflict(error)) fail('PHOTO_STORAGE_CONFLICT');
        fail('PHOTO_STORAGE_UNAVAILABLE');
      } finally { closeBody(body); }
    });
  }
  async function writeExpected(expected, suppliedBytes, signal) {
    signalShape(signal);
    const bytes = ownedBytes(suppliedBytes, expected);
    // Readback makes replay cheap in writes and preserves provider version.
    try { return { ...await readExpected(expected, signal), disposition: 'EXISTING' }; }
    catch (error) { if (error.code !== 'PHOTO_OBJECT_NOT_FOUND') throw error; }
    check(expected.object.versionId === null, 'PHOTO_STORAGE_CONFLICT');
    let response, uncertain = false, putStarted = false;
    try {
      response = await bounded(signal, timeoutMs, activeSignal => {
        putStarted = true;
        return send(new PutObjectCommand(putInput(expected, bytes)), activeSignal);
      });
    } catch (error) {
      if (!putStarted) throw error;
      const status = error?.$metadata?.httpStatusCode;
      // A known refusal is not a successful or unknown upload. Never remove the
      // conditional/checksum header to "fix" an unsupported provider request.
      if (status && status < 500 && status !== 409 && status !== 412) fail('PHOTO_STORAGE_WRITE_REJECTED');
      if (status === 501 || error?.name === 'NotImplemented') fail('PHOTO_STORAGE_WRITE_REJECTED');
      uncertain = true;
    }
    if (signal?.aborted) fail('PHOTO_WRITE_UNKNOWN');
    try {
      // A known successful write supplies its version, if supported. After a
      // lost reply we look up the same current key, never allocate another one.
      const pinned = response?.VersionId === undefined ? expected
        : { ...expected, object: { ...expected.object, versionId: response.VersionId } };
      const observed = await readExpected(pinned, signal);
      return { ...observed, disposition: uncertain ? 'RECONCILED' : 'CREATED' };
    } catch (error) {
      if (error.code === 'PHOTO_STORAGE_CONFLICT' || error.code === 'PHOTO_STORAGE_SCOPE') throw error;
      fail('PHOTO_WRITE_UNKNOWN');
    }
  }

  async function createRead(expected, expiresIn, signal) {
    check(Number.isSafeInteger(expiresIn) && expiresIn > 0 && expiresIn <= 900);
    const found = await readExpected(expected, signal);
    try {
      const url = await bounded(signal, timeoutMs, activeSignal => cancellable(sign(client,
        new GetObjectCommand({ Bucket: bucket, Key: found.object.key,
          ...(found.object.versionId !== null ? { VersionId: found.object.versionId } : {}) }), { expiresIn }), activeSignal));
      check(typeof url === 'string' && new URL(url).protocol === 'https:');
      return { url, sha256: found.sha256, byteCount: found.byteCount, mime: found.contentType };
    } catch (error) {
      if (error instanceof PhotoStorageError) throw error;
      fail('PHOTO_STORAGE_UNAVAILABLE');
    }
  }

  return Object.freeze({
    async createOriginalUpload({ uploadPlan, expiresIn, signal } = {}) {
      const plan = parseUploadPlan(uploadPlan), expected = originalExpectation(plan);
      check(Number.isSafeInteger(expiresIn) && expiresIn > 0 && expiresIn <= 604800);
      const input = putInput(expected);
      const requiredHeaders = { 'Content-Type': input.ContentType, 'If-None-Match': '*',
        'x-amz-checksum-sha256': input.ChecksumSHA256,
        'x-amz-meta-atlas-kind': 'original', 'x-amz-meta-atlas-binding-sha256': expected.bindingSha256 };
      let url;
      try {
        url = await bounded(signal, timeoutMs, activeSignal => cancellable(sign(client, new PutObjectCommand(input), {
          expiresIn, unhoistableHeaders: new Set(Object.keys(requiredHeaders).map(name => name.toLowerCase())),
          signableHeaders: new Set(['content-type', 'if-none-match']),
        }), activeSignal));
        check(typeof url === 'string' && new URL(url).protocol === 'https:', 'PHOTO_STORAGE_INVALID');
      } catch (error) {
        if (error instanceof PhotoStorageError) throw error;
        fail('PHOTO_STORAGE_UNAVAILABLE');
      }
      return { uploadId: plan.uploadId, object: clone(plan.object), method: 'PUT', url, headers: requiredHeaders,
        byteCount: plan.expected.byteCount };
    },
    async writeOriginal({ uploadPlan, bytes, signal } = {}) {
      const plan = parseUploadPlan(uploadPlan);
      return writeExpected(originalExpectation(plan), bytes, signal);
    },
    async readOriginal({ uploadPlan, object, signal } = {}) {
      const plan = parseUploadPlan(uploadPlan);
      return readExpected(originalExpectation(plan, object ?? plan.object), signal);
    },
    async decodeOriginal({ uploadPlan, object, decodeLimits, existingOriginal = null, signal } = {}) {
      const plan = parseUploadPlan(uploadPlan);
      const limits = decodedLimits(decodeLimits);
      check(plan.expected.byteCount <= limits.maxInputBytes, 'PHOTO_STORAGE_LIMIT');
      if (existingOriginal !== null) {
        existingOriginal = parseOriginal(existingOriginal); completeUpload(plan, existingOriginal, existingOriginal);
        if (object) check(descriptorSha256(object) === descriptorSha256(existingOriginal.object), 'PHOTO_STORAGE_CONFLICT');
        object = existingOriginal.object;
      }
      const observed = await readExpected(originalExpectation(plan, object ?? plan.object), signal);
      // Decoder failure leaves the exact uploaded native object untouched.
      return decode({ uploadPlan: plan, observedObject: observed.object, bytes: observed.bytes,
        limits, existingOriginal, signal });
    },
    async writeDecodedFrame(decoded, { id, key, signal } = {}) {
      const planned = describeDecodedFrame(decoded, { id, object: { key, versionId: null } });
      const original = parseOriginal(decoded.original), decodePlan = clone(decoded.decodePlan);
      const stored = await writeExpected(derivedExpectation(planned), decoded.png, signal);
      return parseDecodedFrame({ ...planned, raster: { ...planned.raster, object: stored.object } }, original, decodePlan);
    },
    async readDecodedFrame({ frame, original, decodePlan, signal } = {}) {
      frame = parseDecodedFrame(frame, original, decodePlan);
      return readExpected(derivedExpectation(frame), signal);
    },
    async createDecodedFrameRead({frame,original,decodePlan,expiresIn=300,signal}={}) {
      frame=parseDecodedFrame(frame,original,decodePlan);
      return createRead(derivedExpectation(frame),expiresIn,signal);
    },
    async writeDerivative({ descriptor, frame, original, decodePlan, bytes, signal } = {}) {
      original = parseOriginal(original); decodePlan = clone(decodePlan);
      frame = parseDecodedFrame(frame, original, decodePlan);
      const planned = parseDerivative(descriptor, frame, original, decodePlan);
      check(planned.raster.object.versionId === null, 'PHOTO_STORAGE_CONFLICT');
      const stored = await writeExpected(derivedExpectation(planned), bytes, signal);
      return parseDerivative({ ...planned, raster: { ...planned.raster, object: stored.object } }, frame, original, decodePlan);
    },
    async readDerivative({ descriptor, frame, original, decodePlan, signal } = {}) {
      descriptor = parseDerivative(descriptor, frame, original, decodePlan);
      return readExpected(derivedExpectation(descriptor), signal);
    },
    async createDerivativeRead({descriptor,frame,original,decodePlan,expiresIn=300,signal}={}) {
      descriptor=parseDerivative(descriptor,frame,original,decodePlan);
      return createRead(derivedExpectation(descriptor),expiresIn,signal);
    },
  });
}
