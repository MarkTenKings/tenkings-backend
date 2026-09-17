import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { canonicalJson, type CatalogManifest, type DeepReadonly } from '@tenkings/card-catalog-evidence';
import { getStorageMode, openStorageObjectRead, uploadPrivateChecksumBuffer } from './storage';
import { HttpError } from './adminSessionAuthority';
import { assertCatalogHuman, requireCatalogEnabled } from './setCatalogEvidenceAuth';
import type { AdminSession } from './admin';
import { catalogObservationReviewSchema } from './setCatalogObservationReview';

export type CatalogConsumer = 'inventory' | 'atlas';
export const CATALOG_ARTIFACT_MAX_BYTES = 4 * 1024 * 1024;
// Base64 expands browser uploads by 4/3. Keep their JSON below Vercel's 4.5 MB limit.
export const CATALOG_BROWSER_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/);
const grantSchema = z.object({ basis: z.enum(['owned_original', 'licensed', 'permission']), detail: z.string().trim().min(1).max(1000),
  consumers: z.array(z.enum(['inventory', 'atlas'])).min(1).max(2).refine(a => new Set(a).size === a.length) }).strict();
export const catalogReviewEvidenceSchema = z.object({
  sources: z.array(z.object({ sourceId: z.string().min(1).max(256), taxonomySourceId: z.string().min(1).max(256).nullable(),
    classificationNote: z.string().trim().min(1).max(1000), grant: grantSchema }).strict()).max(5000),
  images: z.array(z.object({ imageId: z.string().min(1).max(256), grant: grantSchema }).strict()).max(5000),
  observations: catalogObservationReviewSchema.optional(),
}).strict();
export type CatalogReviewEvidence = z.infer<typeof catalogReviewEvidenceSchema>;
export type CatalogVerification = CatalogReviewEvidence & { schemaVersion: 'setops-catalog-verification/v1';
  artifacts: { ref: string; sha256: string; byteSize: number }[] };
export const hashCatalogVerification = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export function catalogArtifactKey(ref: string) {
  const match = /^catalog:sha256:([a-f0-9]{64})$/.exec(ref);
  if (!match) throw new HttpError(400, 'Artifact must name staged catalog checksum bytes.');
  return `set-catalog-evidence/${match[1]}.bin`;
}
export type CatalogArtifactReader = (ref: string) => Promise<Buffer>;

/** Private checksum namespace only. No caller URL, other-app key or signed URL. */
export async function readSetCatalogArtifact(ref: string): Promise<Buffer> {
  const key = catalogArtifactKey(ref);
  if (getStorageMode() !== 's3') throw new HttpError(503, 'Private catalog storage is unavailable.');
  let read: Awaited<ReturnType<typeof openStorageObjectRead>> | undefined;
  let expired = false;
  let cleanup = () => {};
  const deadline = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => { expired = true; read?.body.destroy?.(); reject(new HttpError(504, 'Catalog artifact read timed out.')); }, 10_000);
    timer.unref();
    cleanup = () => clearTimeout(timer);
  });
  try {
    return await Promise.race([deadline, (async () => {
      read = await openStorageObjectRead(key);
      if (expired) { read.body.destroy?.(); throw new HttpError(504, 'Catalog artifact read timed out.'); }
      if (read.storageKey !== key || !Number.isSafeInteger(read.byteSize) || !read.byteSize || read.byteSize > CATALOG_ARTIFACT_MAX_BYTES) throw new HttpError(400, 'Invalid artifact size.');
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of read.body) {
        if (!(chunk instanceof Uint8Array)) throw new HttpError(400, 'Invalid artifact stream.');
        size += chunk.byteLength;
        if (size > CATALOG_ARTIFACT_MAX_BYTES || size > read.byteSize) throw new HttpError(400, 'Artifact exceeds its size bound.');
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== read.byteSize || createHash('sha256').update(bytes).digest('hex') !== ref.slice(-64)) throw new HttpError(409, 'Stored artifact checksum mismatch.');
      return bytes;
    })()]);
  } finally { cleanup(); read?.body.destroy?.(); }
}

export async function stageSetCatalogArtifact(input: unknown, actor: AdminSession) {
  requireCatalogEnabled(); assertCatalogHuman(actor, 'reviewer');
  const value = z.object({ sha256: shaSchema, bytesBase64: z.string().min(4).max(Math.ceil(CATALOG_BROWSER_UPLOAD_MAX_BYTES / 3) * 4) }).strict().parse(input);
  const bytes = Buffer.from(value.bytesBase64, 'base64');
  if (!bytes.length || bytes.length > CATALOG_BROWSER_UPLOAD_MAX_BYTES || bytes.toString('base64') !== value.bytesBase64
    || createHash('sha256').update(bytes).digest('hex') !== value.sha256) throw new HttpError(400, 'Artifact bytes and checksum differ.');
  if (getStorageMode() !== 's3') throw new HttpError(503, 'Private catalog storage is unavailable.');
  const ref = `catalog:sha256:${value.sha256}`;
  await uploadPrivateChecksumBuffer(catalogArtifactKey(ref), bytes, 'application/octet-stream', {
    checksumSha256: value.sha256, cacheControl: 'private, max-age=31536000, immutable', signal: AbortSignal.timeout(10_000),
  });
  return { ref, sha256: value.sha256, byteSize: bytes.length };
}

export function parseCatalogVerification(value: unknown): CatalogVerification {
  const parsed = z.object({ schemaVersion: z.literal('setops-catalog-verification/v1'), sources: catalogReviewEvidenceSchema.shape.sources,
    images: catalogReviewEvidenceSchema.shape.images, observations: catalogReviewEvidenceSchema.shape.observations,
    artifacts: z.array(z.object({ ref: z.string(), sha256: shaSchema,
      byteSize: z.number().int().min(1).max(CATALOG_ARTIFACT_MAX_BYTES) }).strict()).max(10000) }).strict().parse(value);
  if (Buffer.byteLength(canonicalJson(parsed)) > 800_000) throw new HttpError(400, 'Catalog verification is too large.');
  for (const item of parsed.artifacts) if (catalogArtifactKey(item.ref) !== `set-catalog-evidence/${item.sha256}.bin`) throw new HttpError(400, 'Artifact verification mismatch.');
  if (new Set(parsed.artifacts.map(a => a.ref)).size !== parsed.artifacts.length) throw new HttpError(400, 'Duplicate artifact verification.');
  return parsed;
}

export function assertCatalogGrants(manifest: DeepReadonly<CatalogManifest>, verification: CatalogVerification, consumer?: CatalogConsumer) {
  const assertRoster = (expected: readonly string[], actual: string[]) => {
    if (expected.length !== actual.length || new Set(actual).size !== actual.length || expected.some(id => !actual.includes(id))) throw new HttpError(400, 'The full source and image grant rosters are required.');
  };
  assertRoster(manifest.sources.map(s => s.sourceId), verification.sources.map(s => s.sourceId));
  assertRoster(manifest.images.map(i => i.imageId), verification.images.map(i => i.imageId));
  for (const item of [...verification.sources, ...verification.images]) if (consumer && !item.grant.consumers.includes(consumer)) throw new HttpError(403, 'Catalog usage is not granted to this app.');
  const refs = [...manifest.sources.map(s => [s.sourceRef, s.sha256]), ...manifest.images.map(i => [i.mediaRef, i.sha256])];
  assertRoster([...new Set(refs.map(r => r[0]))], verification.artifacts.map(a => a.ref));
  for (const [ref, sha256] of refs) if (verification.artifacts.find(a => a.ref === ref)?.sha256 !== sha256) throw new HttpError(409, 'Artifact verification is not bound to the manifest.');
}

export async function verifyCatalogImageBytes(bytes: Buffer, image: { sha256: string; width: number; height: number; mimeType: string }, deadline = Date.now() + 6_000) {
  if (!bytes.length || bytes.length > CATALOG_ARTIFACT_MAX_BYTES) throw new HttpError(400, 'Catalog image exceeds its byte bound.');
  if (createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new HttpError(409, 'Catalog image checksum mismatch.');
  const remainingMs = Math.min(6_000, deadline - Date.now());
  if (remainingMs <= 0) throw new HttpError(504, 'Catalog image decode timed out.');
  const decoder = sharp(bytes, { limitInputPixels: 40_000_000, animated: false, failOn: 'warning' })
    .timeout({ seconds: Math.max(1, Math.ceil(remainingMs / 1000)) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([(async () => {
      const meta = await decoder.metadata();
      const mime = ({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[meta.format ?? ''];
      if (!mime || mime !== image.mimeType || meta.width !== image.width || meta.height !== image.height || (meta.pages ?? 1) !== 1) throw new HttpError(409, 'Catalog image dimensions or type mismatch.');
      // Header metadata can survive a truncated/corrupt body. Decode every pixel
      // before these exact bytes can become reviewed reference evidence.
      await decoder.stats();
    })(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { decoder.destroy(); reject(new HttpError(504, 'Catalog image decode timed out.')); }, remainingMs);
    })]);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(409, 'Catalog image could not be fully decoded.');
  } finally { clearTimeout(timer); decoder.destroy(); }
}

export async function prepareCatalogVerification(manifest: DeepReadonly<CatalogManifest>, input: unknown, read: CatalogArtifactReader = readSetCatalogArtifact) {
  const review = catalogReviewEvidenceSchema.parse(input);
  const refs = [...new Set([...manifest.sources.map(s => s.sourceRef), ...manifest.images.map(i => i.mediaRef)])];
  // A single review is bounded in aggregate as well as per file.
  if (refs.length > 100) throw new HttpError(400, 'One catalog review supports at most 100 source/image artifacts.');
  const artifacts: CatalogVerification['artifacts'] = []; const excerpts: { sourceId: string; text: string | null }[] = [];
  let totalBytes = 0; const deadline = Date.now() + 20_000;
  for (const ref of refs) {
    if (Date.now() >= deadline) throw new HttpError(504, 'Catalog review exceeded its preparation deadline.');
    catalogArtifactKey(ref);
    const bytes = await read(ref); totalBytes += bytes.length;
    if (Date.now() >= deadline) throw new HttpError(504, 'Catalog review exceeded its preparation deadline.');
    if (!bytes.length || bytes.length > CATALOG_ARTIFACT_MAX_BYTES || totalBytes > 32 * 1024 * 1024) throw new HttpError(400, 'Catalog review artifact budget exceeded.');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (ref !== `catalog:sha256:${sha256}`) throw new HttpError(409, 'Source bytes do not match their reference.');
    artifacts.push({ ref, sha256, byteSize: bytes.length });
    const verifiedImages = new Set<string>();
    for (const image of manifest.images.filter(i => i.mediaRef === ref)) {
      const identity = `${image.sha256}:${image.width}:${image.height}:${image.mimeType}`;
      if (!verifiedImages.has(identity)) await verifyCatalogImageBytes(bytes, image, deadline);
      verifiedImages.add(identity);
    }
    if (Date.now() >= deadline) throw new HttpError(504, 'Catalog review exceeded its preparation deadline.');
    for (const source of manifest.sources.filter(s => s.sourceRef === ref)) {
      const text = bytes.subarray(0, 6000).toString('utf8');
      excerpts.push({ sourceId: source.sourceId, text: text.includes('\ufffd') || text.includes('\u0000') ? null : text });
    }
  }
  const verification = parseCatalogVerification({ schemaVersion: 'setops-catalog-verification/v1', ...review, artifacts });
  assertCatalogGrants(manifest, verification);
  return { verification, verificationSha256: hashCatalogVerification(verification), excerpts };
}
