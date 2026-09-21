import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { canonicalJson, prepareObservationProposal, type CatalogManifest, type DeepReadonly } from '@tenkings/card-catalog-evidence';
import { HttpError } from './adminSessionAuthority';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(256);
export const catalogObservationReviewSchema = z.array(z.object({
  proposalId: id, proposalSha256: sha,
  sourceIds: z.array(id).min(1).max(32).refine(ids => new Set(ids).size === ids.length),
  reviewNote: z.string().trim().min(1).max(1000),
}).strict()).max(8).refine(links => new Set(links.map(link => link.proposalId)).size === links.length);
export type CatalogObservationReview = z.infer<typeof catalogObservationReviewSchema>;
type ProposalRow = Pick<Awaited<ReturnType<Prisma.TransactionClient['setCatalogObservationProposal']['findUniqueOrThrow']>>,
  'id' | 'producer' | 'observationId' | 'inputRevision' | 'physicalCardRef' | 'proposalJson' | 'proposalSha256' | 'bindingJson' | 'bindingSha256'>;
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
function invalid(): never { throw new HttpError(409, 'Reviewed observation does not match its immutable proposal and source lineage.'); }

/** A proposal is a review input, never independent identity or image authority.
 * The complete link is covered by the separate verification hash. */
export function assertCatalogObservationLink(manifest: DeepReadonly<CatalogManifest>, link: CatalogObservationReview[number], row: ProposalRow | null) {
  if (!row || row.id !== link.proposalId || row.proposalSha256 !== link.proposalSha256) invalid();
  try {
    const prepared = prepareObservationProposal(row.proposalJson), p = prepared.proposal;
    if (Buffer.byteLength(canonicalJson(p)) > 512 * 1024 || prepared.proposalSha256 !== row.proposalSha256
      || hash(row.bindingJson) !== row.bindingSha256 || p.producer !== row.producer || p.observationId !== row.observationId
      || p.inputRevision !== row.inputRevision || p.physicalCardRef !== row.physicalCardRef) invalid();
    const authority = row.bindingJson as { producer?: string; binding?: { physicalCardRef?: string; observationId?: string; inputRevision?: string; evidenceSha256?: string } };
    if (authority.producer !== p.producer || authority.binding?.physicalCardRef !== p.physicalCardRef
      || authority.binding.observationId !== p.observationId || authority.binding.inputRevision !== p.inputRevision
      || authority.binding.evidenceSha256 !== prepared.proposalSha256 || p.identity.category !== manifest.set.category
      || p.identity.setId !== null && p.identity.setId !== manifest.set.setId) invalid();
    const manifestSources = new Map(manifest.sources.map(source => [source.sourceId, source]));
    const proposalSources = new Map(p.sources.map(source => [source.sourceId, source]));
    type Source = DeepReadonly<CatalogManifest>['sources'][number];
    const sameBytes = (a: Source, b: Source) => a.sha256 === b.sha256 && a.kind === b.kind && a.sourceUrl === b.sourceUrl;
    const matches = new Map<string, boolean>();
    const preservesSource = (source: Source, original: Source): boolean => {
      const key = JSON.stringify([source.sourceId, original.sourceId]);
      if (matches.has(key)) return matches.get(key)!;
      matches.set(key, false);
      const preserved = sameBytes(source, original) && original.originKeys.every(root => source.originKeys.includes(root))
        && original.parentSourceIds.every(parentId => {
          const parent = proposalSources.get(parentId);
          return parent && source.parentSourceIds.some(id => {
            const retained = manifestSources.get(id); return retained && preservesSource(retained, parent);
          });
        });
      matches.set(key, Boolean(preserved)); return Boolean(preserved);
    };
    // Check every known byte alias, including ancestors and sources that were
    // not selected in the UI. A second ID must not erase known card lineage.
    const closure = new Map<string, Source>();
    const visit = (original: Source) => {
      if (closure.has(original.sourceId)) return; closure.set(original.sourceId, original);
      p.sources.filter(item => item.sha256 === original.sha256).forEach(visit);
      original.parentSourceIds.forEach(id => { const parent = proposalSources.get(id); if (!parent) invalid(); visit(parent); });
    };
    p.sources.filter(original => manifest.sources.some(source => source.sha256 === original.sha256)).forEach(visit);
    for (const original of closure.values()) {
      const aliases = manifest.sources.filter(item => item.sha256 === original.sha256);
      if (!aliases.length || !aliases.every(alias => preservesSource(alias, original))) invalid();
    }
    // Canonical JSON is review context, never the source of an image. Check by
    // bytes, regardless of which source IDs the reviewer selected.
    const seen = new Set<string>();
    const reachesArtifact = (id: string): boolean => {
      if (manifestSources.get(id)?.sha256 === prepared.proposalSha256) return true;
      if (seen.has(id)) return false; seen.add(id);
      return Boolean(manifestSources.get(id)?.parentSourceIds.some(reachesArtifact));
    };
    if (manifest.images.some(image => image.sourceIds.some(reachesArtifact))) invalid();
    for (const sourceId of link.sourceIds) {
      const source = manifest.sources.find(item => item.sourceId === sourceId);
      if (!source || !['PHYSICAL_OBSERVATION', 'DERIVED', 'LISTING'].includes(source.kind)) invalid();
      // Reviewers may stage the exact canonical proposal JSON as an observation
      // artifact, or deliberately stage one of its actual source byte streams.
      const proposalArtifact = source.kind === 'PHYSICAL_OBSERVATION' && source.sha256 === prepared.proposalSha256
        && source.sourceRef === `catalog:sha256:${prepared.proposalSha256}` && source.sourceUrl === null;
      if (proposalArtifact) {
        const roots = [...new Set(p.sources.flatMap(item => item.originKeys))];
        if (!roots.length || !roots.every(root => source.originKeys.includes(root))) invalid();
      } else {
        if (!p.sources.some(item => item.sha256 === source.sha256)) invalid();
      }
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    invalid();
  }
}

export async function assertCatalogObservationReviews(tx: Pick<Prisma.TransactionClient, 'setCatalogObservationProposal'>,
  manifest: DeepReadonly<CatalogManifest>, input: CatalogObservationReview | undefined) {
  if (input === undefined) return;
  for (const link of catalogObservationReviewSchema.parse(input)) {
    const row = await tx.setCatalogObservationProposal.findUnique({ where: { id: link.proposalId } });
    assertCatalogObservationLink(manifest, link, row);
  }
}
