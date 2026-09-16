import { createPublishedCatalogReader, lookupManifestCandidates, printingIdentityId,
  prepareObservationProposal, type CatalogQuery, type PublicationPin } from '@tenkings/card-catalog-evidence';

// Compile-only consumer compatibility; no external authority or provider call.
const pin: PublicationPin = { publicationId: 'fixture', setId: 'fixture', revision: 1, manifestSha256: 'fixture' };
const query: CatalogQuery = { category: 'POKEMON', cardNumber: '001/165', language: 'en' };
const reader = createPublishedCatalogReader({ loadAuthorizedPublication: async requested => {
  requested.manifestSha256.toUpperCase();
  // @ts-expect-error The exact request pin cannot be mutated by a host loader.
  requested.revision = 2;
  return null;
} });
void reader.lookup({ publication: pin, query });
// @ts-expect-error A caller cannot self-attest publication authority.
void reader.lookup({ publication: pin, query, approved: true });
const preview = lookupManifestCandidates({}, query);
preview.candidates.map(candidate => printingIdentityId(preview.set.category, preview.set.setId, candidate.printing));
// @ts-expect-error Returned evidence is immutable.
preview.candidates[0].card.name = 'changed';
prepareObservationProposal({}).idempotencyKey.toUpperCase();
