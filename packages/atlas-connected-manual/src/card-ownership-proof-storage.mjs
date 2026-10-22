import { createHash } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { OWNERSHIP_PROOF_LIMITS, ownershipProofObjectPlan } from './card-ownership-proof-contract.mjs';

export class OwnershipProofStorageError extends Error {
  constructor(code) { super(code); this.name = 'OwnershipProofStorageError'; this.code = code; }
}
const need = (ok, code = 'OWNERSHIP_PROOF_STORAGE_INVALID') => { if (!ok) throw new OwnershipProofStorageError(code); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const checksum = plan => Buffer.from(plan.sha256, 'hex').toString('base64');
const close = body => { try { body?.destroy?.(); } catch { /* Never expose provider diagnostics. */ } };
const token = v => typeof v === 'string' && v.length > 0 && v.length <= 512 && /^[\x20-\x7e]+$/.test(v) && v === v.trim();

function interruptible(work, signal, late = () => {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => { if (done) return; done = true; signal.removeEventListener('abort', cancel); fn(value); };
    const cancel = () => finish(reject, signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(work).then(value => done ? late(value) : finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) cancel();
  });
}

/** Inert, injected private storage adapter. No credentials/environment, client
 * construction, upload execution, GET signing, deletion, listing or retries.
 * Conditional PUT/checksum enforcement still requires real provider qualification.
 */
export function createOwnershipProofStorage({ client, bucket, origin, timeoutMs = 30_000,
  sign = getSignedUrl, now = Date.now } = {}) {
  need(typeof client?.send === 'function' && typeof sign === 'function' && typeof now === 'function');
  need(typeof bucket === 'string' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket));
  let base;
  try { base = new URL(origin); } catch { need(false); }
  need(base.protocol === 'https:' && base.origin === origin && !base.username && !base.password);
  need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30_000);
  async function bounded(signal, fn) {
    need(signal === undefined || signal instanceof AbortSignal);
    need(!signal?.aborted, 'OWNERSHIP_PROOF_STORAGE_CANCELLED');
    const active = new AbortController();
    const cancel = () => active.abort(new OwnershipProofStorageError('OWNERSHIP_PROOF_STORAGE_CANCELLED'));
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => active.abort(new OwnershipProofStorageError('OWNERSHIP_PROOF_STORAGE_TIMEOUT')), timeoutMs);
    try { return await fn(active.signal); }
    catch (error) {
      if (error instanceof OwnershipProofStorageError) throw error;
      if (error?.$metadata?.httpStatusCode === 404 && ['NotFound', 'NoSuchKey', 'NoSuchVersion'].includes(error?.name))
        throw new OwnershipProofStorageError('OWNERSHIP_PROOF_OBJECT_NOT_FOUND');
      if (error?.$metadata?.httpStatusCode === 412) throw new OwnershipProofStorageError('OWNERSHIP_PROOF_STORAGE_CONFLICT');
      throw new OwnershipProofStorageError('OWNERSHIP_PROOF_STORAGE_UNAVAILABLE');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
  function live(plan) { need(Number.isFinite(now()) && Date.parse(plan.expiresAt) > now(), 'OWNERSHIP_PROOF_PLAN_EXPIRED'); }
  const metadata = plan => ({ 'atlas-kind': 'ownership-proof-v2', 'atlas-binding-sha256': plan.planHash });
  async function send(command, signal) {
    if (signal.aborted) throw signal.reason;
    return interruptible(client.send(command, { abortSignal: signal }), signal, result => close(result?.Body));
  }
  function identity(value, plan) {
    need(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 3
      && ['key', 'versionId', 'etag'].every(k => Object.hasOwn(value, k))
      && value.key === plan.key && (value.versionId === null || token(value.versionId)) && token(value.etag), 'OWNERSHIP_PROOF_STORAGE_CONFLICT');
    return { key: value.key, versionId: value.versionId, etag: value.etag };
  }
  function headers(reply, plan, pinned) {
    need(reply && reply.DeleteMarker !== true && reply.ContentRange === undefined && reply.ContentEncoding === undefined,
      'OWNERSHIP_PROOF_STORAGE_CONFLICT');
    need(reply.ContentLength === plan.byteCount && reply.ContentLength <= OWNERSHIP_PROOF_LIMITS.maxObjectBytes
      && reply.ContentType === 'application/octet-stream', 'OWNERSHIP_PROOF_STORAGE_CONFLICT');
    need(reply.Metadata && Object.keys(reply.Metadata).length === 2
      && Object.entries(metadata(plan)).every(([k, v]) => reply.Metadata[k] === v), 'OWNERSHIP_PROOF_STORAGE_CONFLICT');
    const found = identity({ key: plan.key, versionId: reply.VersionId ?? null, etag: reply.ETag }, plan);
    if (pinned) need(found.versionId === pinned.versionId && found.etag === pinned.etag, 'OWNERSHIP_PROOF_STORAGE_CONFLICT');
    if (reply.ChecksumSHA256 !== undefined) need(reply.ChecksumSHA256 === checksum(plan), 'OWNERSHIP_PROOF_STORAGE_CONFLICT');
    return found;
  }
  return Object.freeze({
    async signUpload({ plan: supplied, signal } = {}) {
      const plan = ownershipProofObjectPlan(supplied); live(plan);
      const issuedAt = now();
      const expiresIn = Math.min(OWNERSHIP_PROOF_LIMITS.uploadSeconds, Math.floor((Date.parse(plan.expiresAt) - issuedAt) / 1000));
      need(expiresIn >= 1, 'OWNERSHIP_PROOF_PLAN_EXPIRED');
      const input = { Bucket: bucket, Key: plan.key, ContentLength: plan.byteCount, ContentType: 'application/octet-stream',
        ChecksumAlgorithm: 'SHA256', ChecksumSHA256: checksum(plan), IfNoneMatch: '*', Metadata: metadata(plan) };
      const required = { 'content-type': input.ContentType, 'if-none-match': '*', 'x-amz-checksum-sha256': input.ChecksumSHA256,
        'x-amz-meta-atlas-kind': input.Metadata['atlas-kind'], 'x-amz-meta-atlas-binding-sha256': plan.planHash };
      const url = await bounded(signal, active => interruptible(sign(client, new PutObjectCommand(input), {
        expiresIn, signingDate: new Date(issuedAt), unhoistableHeaders: new Set(Object.keys(required)),
        signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
      }), active));
      let parsed;
      try { parsed = new URL(url); } catch { need(false); }
      need(typeof url === 'string' && parsed.origin === origin && !parsed.username && !parsed.password && !parsed.hash);
      // Only exact virtual-hosted or exact bucket/path-style object endpoints.
      need(parsed.pathname === `/${plan.key}` || parsed.pathname === `/${bucket}/${plan.key}`);
      const signedHeaders = parsed.searchParams.get('X-Amz-SignedHeaders')?.split(';');
      need(signedHeaders && [...Object.keys(required), 'content-length', 'host'].every(h => signedHeaders.includes(h)));
      need(parsed.searchParams.getAll('X-Amz-Expires').length === 1 && parsed.searchParams.get('X-Amz-Expires') === String(expiresIn));
      const signedAt = new Date(issuedAt).toISOString().replace(/[:-]|\.\d{3}/g, '');
      need(parsed.searchParams.getAll('X-Amz-Date').length === 1 && parsed.searchParams.get('X-Amz-Date') === signedAt);
      need(Math.floor(issuedAt / 1000) * 1000 + expiresIn * 1000 <= Date.parse(plan.expiresAt));
      live(plan);
      return { schema: 'atlas-ownership-proof-put-v2', bundleId: plan.bundleId, objectId: plan.objectId, planHash: plan.planHash,
        method: 'PUT', url, headers: required, byteCount: plan.byteCount, sha256: plan.sha256, expiresIn };
    },
    async readOriginal({ plan: supplied, object, signal } = {}) {
      const plan = ownershipProofObjectPlan(supplied), pinned = object === undefined ? null : identity(object, plan);
      // Reservation expiry gates adoption in the service. A retained immutable
      // version may be downloaded later under a separately live claim grant.
      return bounded(signal, async active => {
        let body;
        try {
          const head = await send(new HeadObjectCommand({ Bucket: bucket, Key: plan.key, ChecksumMode: 'ENABLED',
            ...(pinned?.versionId !== null && pinned ? { VersionId: pinned.versionId } : {}),
            ...(pinned ? { IfMatch: pinned.etag } : {}) }), active);
          const found = headers(head, plan, pinned);
          const reply = await send(new GetObjectCommand({ Bucket: bucket, Key: plan.key, ChecksumMode: 'ENABLED',
            ...(found.versionId !== null ? { VersionId: found.versionId } : {}), IfMatch: found.etag }), active);
          body = reply?.Body; headers(reply, plan, found);
          need(body && typeof body[Symbol.asyncIterator] === 'function' && typeof body.destroy === 'function', 'OWNERSHIP_PROOF_STORAGE_RESPONSE_INVALID');
          const chunks = [], iterator = body[Symbol.asyncIterator](); let length = 0;
          while (true) {
            const item = await interruptible(iterator.next(), active);
            if (item.done) break;
            need(item.value instanceof Uint8Array && item.value.buffer instanceof ArrayBuffer, 'OWNERSHIP_PROOF_STORAGE_RESPONSE_INVALID');
            length += item.value.byteLength;
            need(length <= plan.byteCount, 'OWNERSHIP_PROOF_STORAGE_LIMIT');
            chunks.push(Buffer.from(item.value));
          }
          if (active.aborted) throw active.reason;
          need(length === plan.byteCount, 'OWNERSHIP_PROOF_STORAGE_CONFLICT');
          const bytes = Buffer.concat(chunks, length);
          need(digest(bytes) === plan.sha256, 'OWNERSHIP_PROOF_STORAGE_CONFLICT');
          return { object: found, sha256: plan.sha256, byteCount: bytes.length, contentType: 'application/octet-stream', bytes };
        } finally { close(body); }
      });
    },
  });
}
