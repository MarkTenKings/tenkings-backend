import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { canonicalJson, prepareObservationProposal } from '@tenkings/card-catalog-evidence';
export const referenceActor = { producer: 'atlas' as const, actorKind: 'service' as const, actorRef: 'atlas:card-catalog:v1', userId: null };
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export async function referenceFixture() {
  const card = randomUUID(), action = randomUUID(), sourceHash = 'a'.repeat(64), identityHash = 'b'.repeat(64);
  const inputRevision = `identity:1:${identityHash}:source:${sourceHash}`, observedAt = '2026-10-09T00:00:00.000Z';
  const capture: any = { schemaVersion: 'atlas-variant-reference-capture/v1', physicalCardRef: card, actionId: action, inputRevision, sourceHash, identityHash, identityRevision: 1, observedAt,
    sourcePhotoPolicy: { version: 'atlas-variant-photo-input-v1', maxDimension: 2048, maxInputPixels: 52000000, maxOutputBytes: 4194304, quality: 92, chromaSubsampling: '4:4:4' },
    referencePhotoPolicy: { version: 'atlas-reference-photo-v1', maxDimension: 1600, quality: 85, fallbackQuality: 70, chromaSubsampling: '4:4:4', maxImageBytes: 1572864, maxTotalBytes: 3145728 }, photoDerivation: {} };
  const proposal: any = { schemaVersion: 'catalog-observation-proposal/v1', producer: 'atlas', observationId: `variant-reference:${action}`, inputRevision, physicalCardRef: card, observedAt,
    basedOnPublication: null, identity: { category: 'SPORTS', setId: null, programId: null, cardId: null, printingId: null, year: '2024', manufacturer: 'Panini', publisher: null,
      setLabel: 'Prizm', name: 'Example Player', cardNumber: '25', language: 'en', edition: null, format: null, channel: null }, sources: [], images: [], note: 'Synthetic private physical reference awaiting review.' };
  const images = [];
  for (const side of ['front', 'back']) {
    const bytes = await sharp({ create: { width: 2, height: side === 'front' ? 3 : 4, channels: 3, background: 'white' } }).jpeg().toBuffer(), sha256 = hash(bytes), sourceId = `photo-${side}`;
    const imageId = `atlas-reference:${side}:${sha256}`;
    capture.photoDerivation[side.toUpperCase()] = { originalSha256: sha256, frameSha256: sha256, comparisonSha256: sha256, referenceSha256: sha256, quality: 85 };
    proposal.sources.push({ sourceId, kind: 'DERIVED', sourceRef: `catalog:sha256:${sha256}`, sourceUrl: null, sha256, parentSourceIds: ['physical-review'], originKeys: [`physical:atlas:${card}`] });
    proposal.images.push({ imageId, mediaRef: `catalog:sha256:${sha256}`, sha256, mimeType: 'image/jpeg', width: 2, height: side === 'front' ? 3 : 4, role: side, sourceIds: [sourceId], parentImageIds: [] });
    images.push({ imageId, bytesBase64: bytes.toString('base64'), permission: { basis: 'owned_original', detail: 'Explicit test permission for private catalog review.', consumers: ['atlas', 'inventory'] } });
  }
  const captureBytes = Buffer.from(canonicalJson(capture)), sha256 = hash(captureBytes);
  const origins = [`physical:atlas:${card}`, ...new Set(Object.values(capture.photoDerivation).flatMap((v: any) => [`bytes:${v.originalSha256}`, `bytes:${v.frameSha256}`]).sort())];
  proposal.sources.unshift({ sourceId: 'physical-review', kind: 'PHYSICAL_OBSERVATION', sourceRef: `catalog:sha256:${sha256}`, sourceUrl: null, sha256, parentSourceIds: [], originKeys: origins });
  return { proposal, observation: { physicalCardRef: card, observationId: proposal.observationId, inputRevision, evidenceSha256: prepareObservationProposal(proposal).proposalSha256 },
    sourceArtifacts: [{ sourceId: 'physical-review', bytesBase64: captureBytes.toString('base64') }], images };
}
