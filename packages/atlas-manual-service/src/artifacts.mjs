import { digest, canonical, object, requireThat, uuid } from './contract.mjs';

const LIMIT = 16 * 1024 * 1024;
function lineage(value) {
  object(value, ['cardId', 'kind', 'sourceHash']); uuid(value.cardId);
  requireThat(typeof value.kind === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(value.kind)
    && /^[a-f0-9]{64}$/.test(value.sourceHash));
  return canonical(value);
}
function reference(ref) {
  object(ref, ['key', 'sha256', 'byteCount', 'lineageSha256', 'cardId', 'kind']); uuid(ref.cardId);
  requireThat(/^[a-f0-9]{64}$/.test(ref.sha256) && /^[a-f0-9]{64}$/.test(ref.lineageSha256)
    && Number.isSafeInteger(ref.byteCount) && ref.byteCount > 0 && ref.byteCount <= LIMIT
    && /^[A-Z][A-Z0-9_]{0,39}$/.test(ref.kind));
}

/** Immutable JSON artifacts are independent of photo originals/derivatives.
 * Effects finish and exact bytes are verified before a repository transaction.
 * Transport contract: create-only put, bounded complete read, private namespace.
 */
export function createManualArtifactStore({ transport, prefix = 'atlas-manual-artifacts/v1' }) {
  requireThat(transport && typeof transport.putIfAbsent === 'function' && typeof transport.read === 'function', 500, 'MANUAL_STORAGE_INVALID');
  requireThat(/^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,120}$/.test(prefix) && !prefix.includes('..') && !prefix.endsWith('/'));
  function key(ref) { return `${prefix}/${ref.cardId}/${ref.kind}/${ref.lineageSha256}-${ref.sha256}.json`; }
  async function read(ref, expected, options = {}) {
    ref = structuredClone(ref); reference(ref);
    const expectedHash = digest(lineage(expected));
    requireThat(ref.key === key(ref) && ref.cardId === expected.cardId && ref.kind === expected.kind
      && ref.lineageSha256 === expectedHash, 409, 'MANUAL_ARTIFACT_LINEAGE_CONFLICT');
    const found = await transport.read({ key: ref.key, maxBytes: ref.byteCount, signal: options.signal });
    requireThat(found && Buffer.isBuffer(found.bytes) && found.bytes.length === ref.byteCount
      && digest(found.bytes) === ref.sha256 && found.contentType === 'application/json'
      && found.lineageSha256 === expectedHash, 503, 'MANUAL_ARTIFACT_UNVERIFIED');
    let content; try { content = JSON.parse(found.bytes.toString('utf8')); } catch { requireThat(false, 503, 'MANUAL_ARTIFACT_UNVERIFIED'); }
    return content;
  }
  return Object.freeze({
    read,
    async write(content, source, options = {}) {
      const sourceText = lineage(source), sourceSnapshot = JSON.parse(sourceText);
      // Full measured contours/RLE belong here, not in PostgreSQL. Ordinary
      // JSON serialization preserves exact numeric values without image codecs.
      const serialized = JSON.stringify(content, (_key, value) => {
        requireThat(value === null || ['string', 'boolean'].includes(typeof value)
          || typeof value === 'number' && Number.isFinite(value)
          || Array.isArray(value) || value && Object.getPrototypeOf(value) === Object.prototype,
        400, 'MANUAL_ARTIFACT_INVALID');
        return value;
      });
      requireThat(typeof serialized === 'string', 400, 'MANUAL_ARTIFACT_INVALID');
      const bytes = Buffer.from(serialized);
      requireThat(bytes.length > 0 && bytes.length <= LIMIT, 413, 'MANUAL_ARTIFACT_TOO_LARGE');
      const ref = { key: '', sha256: digest(bytes), byteCount: bytes.length,
        lineageSha256: digest(sourceText), cardId: sourceSnapshot.cardId, kind: sourceSnapshot.kind };
      ref.key = key(ref);
      try {
        await transport.putIfAbsent({ key: ref.key, bytes: Buffer.from(bytes), sha256: ref.sha256,
          lineageSha256: ref.lineageSha256, contentType: 'application/json', signal: options.signal });
      } catch (error) {
        // A timeout may have committed. Reconcile only this same immutable key;
        // the subsequent read must prove the whole content and lineage.
        if (options.signal?.aborted) throw error;
      }
      await read(ref, sourceSnapshot, options);
      return Object.freeze(ref);
    },
  });
}

/** Uses caller-injected locked AWS SDK constructors; does not load credentials.
 * Intended provider conditional PUT/GET support still needs live acceptance.
 */
export function createS3ManualArtifactTransport({ client, bucket, PutObjectCommand, GetObjectCommand }) {
  requireThat(client && typeof client.send === 'function' && typeof bucket === 'string' && bucket.length > 0);
  return Object.freeze({
    putIfAbsent: ({ key, bytes, sha256, lineageSha256, signal }) => client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.length, ContentType: 'application/json',
      IfNoneMatch: '*', ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      Metadata: { 'atlas-manual-lineage-sha256': lineageSha256 },
    }), { abortSignal: signal }),
    async read({ key, maxBytes, signal }) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
      const body = result.Body; let length = 0; const chunks = [];
      try {
        requireThat(result.ContentLength === maxBytes && result.ContentType === 'application/json'
          && !result.ContentEncoding && !result.ContentRange && body?.[Symbol.asyncIterator], 503, 'MANUAL_ARTIFACT_UNVERIFIED');
        for await (const chunk of body) {
          requireThat(!signal?.aborted, 503, 'MANUAL_ARTIFACT_READ_ABORTED');
          const bytes = Buffer.from(chunk); length += bytes.length;
          requireThat(length <= maxBytes, 503, 'MANUAL_ARTIFACT_UNVERIFIED'); chunks.push(bytes);
        }
        return { bytes: Buffer.concat(chunks), contentType: result.ContentType,
          lineageSha256: result.Metadata?.['atlas-manual-lineage-sha256'] };
      } finally { body?.destroy?.(); }
    },
  });
}
