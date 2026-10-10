import { createHash } from 'node:crypto';
import { canonicalJson, normalizeVariantIdentity, prepareObservationProposal, validateVariantReviewSnapshot, variantSelectionParallel } from '@tenkings/card-catalog-evidence';

const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash = v => createHash('sha256').update(canonicalJson(v)).digest('hex');
const requireValue = ok => { if (!ok) throw Object.assign(new Error('VARIANT_CONTRIBUTION_INVALID'), { code: 'VARIANT_CONTRIBUTION_INVALID' }); };

/** Server-only: the outbox stores these exact bytes in the human-confirmation
 * transaction. This proposal cannot grant shared catalog or image authority.
 * The original photographs are represented only by their existing source hash. */
export function prepareVariantCatalogObservation(payload) {
  requireValue(payload && uuid(payload.cardId) && uuid(payload.actionId) && hex(payload.sourceHash) && hex(payload.identityHash)
    && Number.isSafeInteger(payload.identityRevision) && payload.identityRevision > 0
    && ['SELECTED', 'MANUAL'].includes(payload.decision) && typeof payload.parallel === 'string' && payload.parallel.trim() === payload.parallel
    && payload.parallel.length > 0 && payload.parallel.length <= 120
    && Number.isFinite(Date.parse(payload.observedAt)) && new Date(payload.observedAt).toISOString() === payload.observedAt);
  const identity = normalizeVariantIdentity(payload.identity);
  let candidate = null, snapshot = null;
  if (payload.decision === 'SELECTED') {
    snapshot = validateVariantReviewSnapshot(payload.catalog);
    candidate = snapshot.candidates.find(c => c.candidateId === payload.candidateId);
    requireValue(candidate && variantSelectionParallel(candidate) === payload.parallel);
  } else requireValue(payload.candidateId === null && typeof payload.observedFeatures === 'string' && payload.observedFeatures.trim().length > 0 && payload.observedFeatures.length <= 1000);
  const physicalSourceId = 'physical-review', sources = [{ sourceId: physicalSourceId, kind: 'PHYSICAL_OBSERVATION',
    sourceRef: `atlas:variant:${payload.actionId}`, sourceUrl: null, sha256: payload.sourceHash, parentSourceIds: [],
    originKeys: [`physical:atlas:${payload.cardId}`] }];
  if (snapshot) sources.push({ sourceId: 'comparison-observation', kind: 'DERIVED', sourceRef: `atlas:variant-snapshot:${snapshot.snapshotHash}`,
    sourceUrl: candidate.source.url, sha256: hash({ snapshotHash: snapshot.snapshotHash, candidateId: candidate.candidateId,
      source: candidate.source, actionId: payload.actionId, parallel: payload.parallel }), parentSourceIds: [physicalSourceId],
    originKeys: [`physical:atlas:${payload.cardId}`, `atlas:variant:${payload.actionId}`] });
  // The note is a human observation and an unreviewed comparison. Listing or
  // provider assertions cannot become APPROVED_SECONDARY through this path.
  const note = [`Human-confirmed physical observation: ${payload.parallel}.`,
    'Unreviewed shared contribution; no catalog publication or image permission.',
    candidate ? `Compared with ${candidate.source.provider} candidate ${candidate.candidateId}.` : null,
    payload.observedFeatures ? `Observed: ${payload.observedFeatures.trim().slice(0, 160)}` : null].filter(Boolean).join(' ').slice(0, 500);
  return prepareObservationProposal({ schemaVersion: 'catalog-observation-proposal/v1', producer: 'atlas', observationId: `variant:${payload.actionId}`,
    inputRevision: `identity:${payload.identityRevision}:${payload.identityHash}:source:${payload.sourceHash}`, physicalCardRef: payload.cardId,
    observedAt: payload.observedAt, basedOnPublication: candidate?.canonical?.publication ?? null,
    identity: { category: identity.category, setId: candidate?.canonical?.publication.setId ?? null, programId: null,
      cardId: candidate?.canonical?.cardId ?? null, printingId: candidate?.canonical?.printingId ?? null,
      year: identity.year, manufacturer: identity.category === 'SPORTS' ? identity.manufacturer : null,
      publisher: identity.category === 'POKEMON' ? identity.manufacturer : null, setLabel: identity.setName, name: identity.name, cardNumber: identity.cardNumber,
      language: candidate?.identity.language ?? identity.language, edition: null, format: null, channel: null },
    sources, images: [], note });
}
