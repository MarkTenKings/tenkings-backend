import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, prepareObservationProposal, validateManifest, type CatalogManifest } from '@tenkings/card-catalog-evidence';
import { catalogReviewEvidenceSchema } from './setCatalogEvidenceMedia';
import { assertCatalogObservationLink } from './setCatalogObservationReview';
import { HttpError } from './adminSessionAuthority';
const sha = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().min(1).max(256);
export const referenceAttachmentSchema = z.object({ action: z.literal('prepare'), proposalId: z.string().uuid(), proposalSha256: sha, submissionSha256: sha,
  packet: z.object({ manifest: z.unknown(), reviewEvidence: z.unknown() }).strict(), imageId: id,
  depicted: z.object({ cardId: id, printingId: id }).strict(),
  representsPrintingIds: z.array(id).min(1).max(100).refine(v => new Set(v).size === v.length),
  visibleDiagnosticIds: z.array(id).max(30).refine(v => new Set(v).size === v.length), reviewNote: z.string().trim().min(1).max(1000),
  acknowledgement: z.literal('PREPARE PHOTO FOR FULL CATALOG REVIEW'),
}).strict();
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
type ProposalRow = Parameters<typeof assertCatalogObservationLink>[2];

/** Pure human preparation. Existing canonical facts, applicability and approval
 * bindings are retained; normal preview/publish must still verify every byte. */
export function attachCatalogReference(input: unknown, row: NonNullable<ProposalRow>, receipt: { submissionSha256: string; submissionJson: unknown }) {
  const value = referenceAttachmentSchema.parse(input), m = structuredClone(validateManifest(value.packet.manifest)) as CatalogManifest;
  const review = catalogReviewEvidenceSchema.parse(value.packet.reviewEvidence), prepared = prepareObservationProposal(row.proposalJson), p = prepared.proposal;
  const submission = receipt.submissionJson as { proposalSha256?: string; authoritySha256?: string; images?: { imageId: string; sha256: string; proposedPermission: unknown }[]; sourceArtifacts?: { sourceId: string; sha256: string }[] };
  if (row.id !== value.proposalId || row.proposalSha256 !== value.proposalSha256 || prepared.proposalSha256 !== value.proposalSha256
    || receipt.submissionSha256 !== value.submissionSha256 || hash(submission) !== value.submissionSha256 || submission.proposalSha256 !== value.proposalSha256
    || submission.authoritySha256 !== row.bindingSha256 || p.identity.category !== m.set.category || p.identity.setId !== null && p.identity.setId !== m.set.setId) throw new HttpError(409, 'The exact pending reference and matching catalog are required.');
  const image = p.images.find(i => i.imageId === value.imageId), pending = submission.images?.find(i => i.imageId === value.imageId);
  if (!image || !pending || pending.sha256 !== image.sha256 || !p.sources.every(s => s.sourceRef === `catalog:sha256:${s.sha256}`)
    || !submission.sourceArtifacts?.some(s => s.sourceId === 'physical-review' && p.sources.some(root => root.sourceId === s.sourceId && root.sha256 === s.sha256))) throw new HttpError(409, 'Reference capture or image evidence is missing.');
  const grant = catalogReviewEvidenceSchema.parse({ sources: [], images: [{ imageId: image.imageId, grant: pending.proposedPermission }] }).images[0].grant;
  if (!m.applicability.some(a => a.cardId === value.depicted.cardId && a.printingId === value.depicted.printingId && a.status === 'supported')) throw new HttpError(400, 'Choose an existing supported depicted identity.');
  if (m.images.some(i => i.sha256 === image.sha256)) throw new HttpError(409, 'These photo bytes are already in the packet; review their existing image mapping.');
  const sourceIds = new Map(p.sources.map(s => [s.sourceId, `observation:${row.id}:${s.sourceId}`]));
  for (const source of p.sources) {
    const added = { ...source, sourceId: sourceIds.get(source.sourceId)!, originKeys: [...source.originKeys], parentSourceIds: source.parentSourceIds.map(id => sourceIds.get(id)!) };
    const prior = m.sources.find(s => s.sourceId === added.sourceId);
    if (prior) { if (canonicalJson(prior) !== canonicalJson(added)) throw new HttpError(409, 'An existing observation source mapping differs.'); continue; }
    m.sources.push(added);
    const common = { sourceId: added.sourceId, taxonomySourceId: null, classificationNote: 'Human-reviewed physical capture or derived photo; not canonical identity authority.' };
    if ('schemaVersion' in review) review.sources.push({ ...common, factUse: { purpose: 'catalog_facts', sourceSha256: added.sha256, detail: value.reviewNote, consumers: grant.consumers } });
    else review.sources.push({ ...common, grant });
  }
  const imageId = `observation:${row.id}:${image.role}`;
  m.images.push({ ...image, imageId, sourceIds: image.sourceIds.map(id => sourceIds.get(id)!), parentImageIds: [], depicted: value.depicted,
    representsPrintingIds: value.representsPrintingIds, visibleDiagnosticIds: value.visibleDiagnosticIds });
  review.images.push({ imageId, grant });
  const link = { proposalId: row.id, proposalSha256: row.proposalSha256, sourceIds: [...sourceIds.values()], reviewNote: value.reviewNote };
  review.observations = [...(review.observations ?? []).filter(o => o.proposalId !== row.id), link];
  m.coverage.images = { status: m.coverage.images.status === 'truncated' ? 'truncated' : 'partial',
    detail: 'Includes explicitly mapped submitted physical references; no complete image coverage is asserted.', sourceIds: [...new Set([...m.coverage.images.sourceIds, ...sourceIds.values()])] };
  const manifest = validateManifest(m), reviewEvidence = catalogReviewEvidenceSchema.parse(review);
  assertCatalogObservationLink(manifest, link, row);
  const packet = { manifest, reviewEvidence };
  if (Buffer.byteLength(canonicalJson(packet)) > 3 * 1024 * 1024) throw new HttpError(413, 'Prepared packet exceeds its review bound.');
  return { disposition: 'requires_authorized_review', packet };
}
