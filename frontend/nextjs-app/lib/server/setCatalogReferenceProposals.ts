import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@tenkings/database';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { canonicalJson, prepareObservationProposal } from '@tenkings/card-catalog-evidence';
import { HttpError } from './adminSessionAuthority';
import { catalogArtifactKey, verifyCatalogImageBytes, readSetCatalogArtifact } from './setCatalogEvidenceMedia';
import { getStorageMode, uploadPrivateChecksumBuffer, isStorageObjectNotFoundError } from './storage';
import { assertCatalogHuman, requireCatalogEnabled } from './setCatalogEvidenceAuth';
import type { AdminSession } from './admin';
import type { CatalogProposalAuthority } from './setCatalogEvidence';
import { attachCatalogReference, referenceAttachmentSchema } from './setCatalogReferenceAttachment';

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().min(1).max(256);
const permission = z.object({ basis: z.enum(['owned_original', 'licensed', 'permission']), detail: z.string().trim().min(1).max(1000),
  consumers: z.array(z.enum(['inventory', 'atlas'])).min(1).max(2).refine(items => new Set(items).size === items.length) }).strict();
const request = z.object({ proposal: z.unknown(), observation: z.object({ physicalCardRef: id, observationId: id, inputRevision: id, evidenceSha256: sha }).strict(),
  sourceArtifacts: z.array(z.object({ sourceId: z.literal('physical-review'), bytesBase64: z.string().min(4).max(24 * 1024) }).strict()).length(1),
  images: z.array(z.object({ imageId: id, bytesBase64: z.string().min(4).max(4 * 1024 * 1024), permission }).strict()).length(2) }).strict();
const photoDerivation = z.object({ originalSha256: sha, frameSha256: sha, comparisonSha256: sha, referenceSha256: sha, quality: z.union([z.literal(85), z.literal(70)]) }).strict();
const captureSchema = z.object({ schemaVersion: z.literal('atlas-variant-reference-capture/v1'), physicalCardRef: z.string().uuid(), actionId: z.string().uuid(),
  inputRevision: id, sourceHash: sha, identityHash: sha, identityRevision: z.number().int().positive(), observedAt: z.string().datetime(),
  sourcePhotoPolicy: z.object({ version: z.literal('atlas-variant-photo-input-v1'), maxDimension: z.literal(2048), maxInputPixels: z.literal(52000000),
    maxOutputBytes: z.literal(4194304), quality: z.literal(92), chromaSubsampling: z.literal('4:4:4') }).strict(),
  referencePhotoPolicy: z.object({ version: z.literal('atlas-reference-photo-v1'), maxDimension: z.literal(1600), quality: z.literal(85), fallbackQuality: z.literal(70),
    chromaSubsampling: z.literal('4:4:4'), maxImageBytes: z.literal(1572864), maxTotalBytes: z.literal(3145728) }).strict(),
  photoDerivation: z.object({ FRONT: photoDerivation, BACK: photoDerivation }).strict(),
}).strict();
type Prepared = ReturnType<typeof prepareReferenceProposal>;
type Submission = { proposalId: string; proposalSha256: string; submissionSha256: string; submissionJson: unknown };

/** Explicit permission assertions are pending review, never automatically a
 * catalog grant. Every upload is pinned to a physical observation and exact bytes. */
export function prepareReferenceProposal(input: unknown, actor: Omit<CatalogProposalAuthority, 'binding'>) {
  const value = request.parse(input), prepared = prepareObservationProposal(value.proposal), p = prepared.proposal;
  if (p.producer !== actor.producer || p.physicalCardRef !== value.observation.physicalCardRef || p.observationId !== value.observation.observationId
    || p.inputRevision !== value.observation.inputRevision || prepared.proposalSha256 !== value.observation.evidenceSha256
    || Buffer.byteLength(canonicalJson(p)) > 512 * 1024) throw new HttpError(403, 'Reference proposal binding mismatch.');
  if (p.images.length !== value.images.length || new Set(value.images.map(image => image.imageId)).size !== value.images.length) throw new HttpError(400, 'The exact image roster is required.');
  if (p.sources.some(source => !['PHYSICAL_OBSERVATION', 'DERIVED'].includes(source.kind) || source.sourceUrl !== null)) throw new HttpError(400, 'Private physical-reference lineage is required.');
  const physical = new Set(p.sources.filter(s => s.kind === 'PHYSICAL_OBSERVATION').map(s => s.sourceId));
  const reachesPhysical = (sourceId: string): boolean => physical.has(sourceId) || Boolean(p.sources.find(s => s.sourceId === sourceId)?.parentSourceIds.some(reachesPhysical));
  if (p.sources.filter(s => s.kind === 'PHYSICAL_OBSERVATION').some(s => !s.originKeys.includes(`physical:${p.producer}:${p.physicalCardRef}`))) throw new HttpError(400, 'Physical source origin does not match its authenticated card.');
  if (!physical.size) throw new HttpError(400, 'Physical observation source required.');
  const root = p.sources.find(s => s.sourceId === 'physical-review'), captureBytes = Buffer.from(value.sourceArtifacts[0].bytesBase64, 'base64');
  if (physical.size !== 1 || !physical.has('physical-review') || p.sources.length !== 3 || !root || !captureBytes.length || captureBytes.length > 16384
    || captureBytes.toString('base64') !== value.sourceArtifacts[0].bytesBase64 || createHash('sha256').update(captureBytes).digest('hex') !== root.sha256
    || root.sourceRef !== `catalog:sha256:${root.sha256}` || root.parentSourceIds.length) throw new HttpError(400, 'Exact staged physical capture descriptor required.');
  const capture = captureSchema.parse(JSON.parse(captureBytes.toString('utf8')));
  const origins = [`physical:atlas:${p.physicalCardRef}`, ...new Set(Object.values(capture.photoDerivation).flatMap(v => [`bytes:${v.originalSha256}`, `bytes:${v.frameSha256}`]).sort())];
  if (canonicalJson(capture) !== captureBytes.toString('utf8') || capture.physicalCardRef !== p.physicalCardRef || p.observationId !== `variant-reference:${capture.actionId}`
    || capture.inputRevision !== p.inputRevision || capture.observedAt !== p.observedAt
    || capture.inputRevision !== `identity:${capture.identityRevision}:${capture.identityHash}:source:${capture.sourceHash}`
    || canonicalJson(root.originKeys) !== canonicalJson(origins)) throw new HttpError(400, 'Capture descriptor observation binding mismatch.');
  const sourceArtifacts = [{ source: root, image: { mediaRef: root.sourceRef, sha256: root.sha256 }, bytes: captureBytes }];
  let total = 0;
  const artifacts = p.images.map(image => {
    const supplied = value.images.find(item => item.imageId === image.imageId);
    if (!supplied || image.mediaRef !== `catalog:sha256:${image.sha256}` || image.width * image.height > 40_000_000
      || !image.sourceIds.some(sourceId => reachesPhysical(sourceId) && p.sources.find(source => source.sourceId === sourceId)?.sha256 === image.sha256)) throw new HttpError(400, 'Image bytes must retain their physical source lineage.');
    const bytes = Buffer.from(supplied.bytesBase64, 'base64'); total += bytes.length;
    if (!bytes.length || total > 3 * 1024 * 1024 || bytes.toString('base64') !== supplied.bytesBase64 || createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new HttpError(400, 'Image checksum or byte bound mismatch.');
    if (!['front', 'back'].includes(image.role) || image.mimeType !== 'image/jpeg' || image.width > 1600 || image.height > 1600 || bytes.length > 1572864) throw new HttpError(400, 'Capture reference image policy mismatch.');
    const side = image.role.toUpperCase() as 'FRONT' | 'BACK', sourceId = `photo-${image.role}`, source = p.sources.find(s => s.sourceId === sourceId);
    if (capture.photoDerivation[side].referenceSha256 !== image.sha256 || image.imageId !== `atlas-reference:${image.role}:${image.sha256}`
      || canonicalJson(image.sourceIds) !== canonicalJson([sourceId]) || image.parentImageIds.length || !source
      || canonicalJson(source) !== canonicalJson({ sourceId, kind: 'DERIVED', sourceRef: image.mediaRef, sourceUrl: null, sha256: image.sha256,
        parentSourceIds: ['physical-review'], originKeys: [`physical:atlas:${p.physicalCardRef}`] })) throw new HttpError(400, 'Capture image derivation mismatch.');
    return { image, bytes, permission: supplied.permission };
  });
  if (new Set(artifacts.map(a => a.image.role)).size !== 2) throw new HttpError(400, 'Both capture sides are required.');
  const authority: CatalogProposalAuthority = { ...actor, binding: value.observation };
  const submission = { schemaVersion: 'catalog-reference-proposal/v1', disposition: 'requires_authorized_review', proposalSha256: prepared.proposalSha256,
    authoritySha256: digest(authority), sourceArtifacts: sourceArtifacts.map(a => ({ sourceId: a.source.sourceId, sha256: a.source.sha256 })),
    images: artifacts.map(a => ({ imageId: a.image.imageId, sha256: a.image.sha256, proposedPermission: a.permission })) };
  return { prepared, authority, artifacts, sourceArtifacts, submission, submissionSha256: digest(submission) };
}

export async function stageReferenceProposalArtifact(artifact: { image: { mediaRef: string; sha256: string }; bytes: Buffer }, dependencies: {
  mode?: string; read?: typeof readSetCatalogArtifact; put?: typeof uploadPrivateChecksumBuffer;
} = {}) {
  if ((dependencies.mode ?? getStorageMode()) !== 's3') throw new HttpError(503, 'Private catalog storage unavailable.');
  const verifyStored = async () => {
    const bytes = await (dependencies.read ?? readSetCatalogArtifact)(artifact.image.mediaRef);
    if (!Buffer.isBuffer(bytes) || bytes.length !== artifact.bytes.length || createHash('sha256').update(bytes).digest('hex') !== artifact.image.sha256) throw new HttpError(409, 'Stored reference bytes differ from the proposal.');
  };
  try { await verifyStored(); return; }
  catch (error) { if (!isStorageObjectNotFoundError(error)) throw error; }
  try {
    await (dependencies.put ?? uploadPrivateChecksumBuffer)(catalogArtifactKey(artifact.image.mediaRef), artifact.bytes, 'application/octet-stream', {
      checksumSha256: artifact.image.sha256, ifAbsent: true, cacheControl: 'private, max-age=31536000, immutable', signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    const known = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (!['PreconditionFailed', 'ConditionalRequestConflict'].includes(known.name ?? '') && ![409, 412].includes(known.$metadata?.httpStatusCode ?? 0)) throw error;
  }
  // The pending receipt records verified stored bytes, not just a PUT response.
  // Reconcile an unknown/competing creation by reading its exact checksum object.
  await verifyStored();
}
const stage = stageReferenceProposalArtifact;

function checkedSubmission(row: Submission, input: Prepared) {
  if (row.proposalSha256 !== input.prepared.proposalSha256 || row.submissionSha256 !== input.submissionSha256 || digest(row.submissionJson) !== input.submissionSha256) throw new HttpError(409, 'Reference replay differs from the immutable proposal or permission assertion.');
}

export function createSetCatalogReferenceService(dependencies: { db?: PrismaClient; stage?: typeof stage; verify?: typeof verifyCatalogImageBytes } = {}) {
  const db = dependencies.db ?? prisma;
  return {
    async submit(input: unknown, actor: Omit<CatalogProposalAuthority, 'binding'>) {
      const value = prepareReferenceProposal(input, actor), p = value.prepared.proposal;
      const find = () => db.$queryRaw<Submission[]>`SELECT r.* FROM "SetCatalogReferenceSubmission" r JOIN "SetCatalogObservationProposal" p ON p.id=r."proposalId"
        WHERE p.producer=${p.producer} AND p."observationId"=${p.observationId} AND p."inputRevision"=${p.inputRevision}`;
      const prior = (await find())[0];
      const receipt = (proposalId: string, outcome: 'recorded' | 'replay') => ({ proposalId, proposalSha256: value.prepared.proposalSha256,
        idempotencyKey: value.prepared.idempotencyKey, outcome, submissionSha256: value.submissionSha256 });
      if (prior) { checkedSubmission(prior, value); return receipt(prior.proposalId, 'replay'); }
      // Inspect every image before staging any. Content-addressed storage and an
      // immutable submission key make an unknown response safe to retry.
      const deadline = Date.now() + 12000;
      for (const artifact of value.artifacts) await (dependencies.verify ?? verifyCatalogImageBytes)(artifact.bytes, artifact.image, deadline);
      for (const artifact of value.sourceArtifacts) await (dependencies.stage ?? stage)(artifact);
      for (const artifact of value.artifacts) await (dependencies.stage ?? stage)(artifact);
      const proposalId = randomUUID(), bindingSha256 = digest(value.authority);
      return db.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`INSERT INTO "SetCatalogObservationProposal" (id,producer,"observationId","inputRevision","physicalCardRef","proposalJson","proposalSha256","actorKind","actorRef","bindingJson","bindingSha256","submittedById")
          VALUES (${proposalId},${p.producer},${p.observationId},${p.inputRevision},${p.physicalCardRef},${canonicalJson(p)}::jsonb,${value.prepared.proposalSha256},${actor.actorKind},${actor.actorRef},${canonicalJson(value.authority)}::jsonb,${bindingSha256},${actor.userId})
          ON CONFLICT (producer,"observationId","inputRevision") DO NOTHING`);
        const [row] = await tx.$queryRaw<{ id: string; proposalSha256: string; bindingSha256: string; proposalJson: unknown; bindingJson: unknown }[]>`SELECT id,"proposalSha256","bindingSha256","proposalJson","bindingJson"
          FROM "SetCatalogObservationProposal" WHERE producer=${p.producer} AND "observationId"=${p.observationId} AND "inputRevision"=${p.inputRevision}`;
        if (!row || row.proposalSha256 !== value.prepared.proposalSha256 || row.bindingSha256 !== bindingSha256 || digest(row.proposalJson) !== row.proposalSha256 || digest(row.bindingJson) !== bindingSha256) throw new HttpError(409, 'Immutable observation conflict.');
        await tx.$executeRaw`INSERT INTO "SetCatalogReferenceSubmission" ("proposalId","proposalSha256","submissionSha256","submissionJson")
          VALUES (${row.id},${row.proposalSha256},${value.submissionSha256},${canonicalJson(value.submission)}::jsonb) ON CONFLICT ("proposalId") DO NOTHING`;
        const [saved] = await tx.$queryRaw<Submission[]>`SELECT * FROM "SetCatalogReferenceSubmission" WHERE "proposalId"=${row.id}`;
        checkedSubmission(saved, value); return receipt(row.id, row.id === proposalId ? 'recorded' : 'replay');
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 5000 });
    },
    async review(input: { proposalId: string; proposalSha256: string }, actor: AdminSession) {
      requireCatalogEnabled(); assertCatalogHuman(actor, 'reviewer');
      const pin = z.object({ proposalId: z.string().uuid(), proposalSha256: sha }).strict().parse(input);
      const [row] = await db.$queryRaw<Submission[]>`SELECT * FROM "SetCatalogReferenceSubmission" WHERE "proposalId"=${pin.proposalId}`;
      if (!row) throw new HttpError(404, 'No submitted reference bytes for this proposal.');
      if (row.proposalSha256 !== pin.proposalSha256 || digest(row.submissionJson) !== row.submissionSha256) throw new HttpError(409, 'Reference submission integrity mismatch.');
      return { disposition: 'requires_authorized_review', proposalId: row.proposalId, submissionSha256: row.submissionSha256, submission: row.submissionJson };
    },
    async prepare(input: unknown, actor: AdminSession) {
      requireCatalogEnabled(); assertCatalogHuman(actor, 'reviewer');
      const value = referenceAttachmentSchema.parse(input);
      const [submission] = await db.$queryRaw<Submission[]>`SELECT * FROM "SetCatalogReferenceSubmission" WHERE "proposalId"=${value.proposalId}`;
      const proposal = await db.setCatalogObservationProposal.findUnique({ where: { id: value.proposalId } });
      if (!submission || !proposal) throw new HttpError(404, 'Pending physical reference not found.');
      return attachCatalogReference(value, proposal, submission);
    },
  };
}
export const setCatalogReferenceService = createSetCatalogReferenceService();
