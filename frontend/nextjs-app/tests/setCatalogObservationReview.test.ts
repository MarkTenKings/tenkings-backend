import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalJson, prepareObservationProposal, validateManifest } from '@tenkings/card-catalog-evidence';
import { assertCatalogObservationLink, catalogObservationReviewSchema } from '../lib/server/setCatalogObservationReview';
import { parseCatalogVerification, hashCatalogVerification } from '../lib/server/setCatalogEvidenceMedia';
// @ts-expect-error Synthetic fixtures are outside the public package contract.
import { fixture, observationFixture } from '../../../packages/card-catalog-evidence/tests/fixtures.mjs';

const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
function sample(observation = observationFixture()) {
  const manifest = fixture('POKEMON'), prepared = prepareObservationProposal(observation);
  const p = prepared.proposal;
  const binding = { producer: p.producer, actorKind: 'service', actorRef: 'fixture:inventory', userId: null,
    binding: { physicalCardRef: p.physicalCardRef, observationId: p.observationId, inputRevision: p.inputRevision, evidenceSha256: prepared.proposalSha256 } };
  const row = { id: 'fixture-proposal', producer: p.producer, observationId: p.observationId, inputRevision: p.inputRevision,
    physicalCardRef: p.physicalCardRef, proposalJson: JSON.parse(canonicalJson(p)), proposalSha256: prepared.proposalSha256,
    bindingJson: binding, bindingSha256: hash(binding) };
  manifest.sources.push({ sourceId: 'reviewed-observation', kind: 'PHYSICAL_OBSERVATION', sourceRef: `catalog:sha256:${prepared.proposalSha256}`,
    sourceUrl: null, sha256: prepared.proposalSha256, parentSourceIds: [], originKeys: p.sources.flatMap(source => source.originKeys) });
  const link = { proposalId: row.id, proposalSha256: row.proposalSha256, sourceIds: ['reviewed-observation'], reviewNote: 'Reviewed this synthetic observation alongside independent checklist facts.' };
  return { manifest, row, link };
}

test('review links bind exact immutable proposal bytes and physical source lineage', () => {
  const f = sample();
  assertCatalogObservationLink(validateManifest(f.manifest), f.link, f.row);
  assert.throws(() => assertCatalogObservationLink(f.manifest, { ...f.link, proposalSha256: '0'.repeat(64) }, f.row));
  assert.throws(() => assertCatalogObservationLink(f.manifest, f.link, null));
  assert.throws(() => assertCatalogObservationLink(f.manifest, f.link, { ...f.row, physicalCardRef: 'wrong-physical-card' }));
  assert.throws(() => assertCatalogObservationLink(f.manifest, f.link, { ...f.row, bindingSha256: '0'.repeat(64) }));
  f.row.proposalJson.note = 'Changed immutable observation';
  assert.throws(() => assertCatalogObservationLink(f.manifest, f.link, f.row));
});

test('staged proposal JSON cannot become direct or indirect image provenance', () => {
  for (const indirect of [false, true]) {
    const f = sample();
    const sourceId = indirect ? 'derived-from-proposal' : 'reviewed-observation';
    if (indirect) f.manifest.sources.push({ sourceId, kind: 'DERIVED', sourceRef: 'fixture:derived', sourceUrl: null,
      sha256: 'a'.repeat(64), parentSourceIds: ['reviewed-observation'], originKeys: ['fixture:derived'] });
    f.manifest.images[0].sourceIds = [sourceId];
    assert.throws(() => assertCatalogObservationLink(f.manifest, f.link, f.row));
  }
});

test('proposal artifact aliases are excluded from image ancestry by exact bytes', () => {
  const f = sample();
  f.manifest.sources.push({ ...f.manifest.sources.at(-1), sourceId: 'same-proposal-other-id', originKeys: ['unrelated:alias'] });
  f.manifest.images[0].sourceIds = ['same-proposal-other-id'];
  assert.throws(() => assertCatalogObservationLink(f.manifest, f.link, f.row));
  const original = f.row.proposalJson.sources[0];
  f.manifest.sources.push({ ...original, sourceId: 'selected-actual-source' });
  f.link.sourceIds = ['selected-actual-source'];
  assert.throws(() => assertCatalogObservationLink(f.manifest, f.link, f.row));
});

test('actual source bytes retain ancestor hashes, roots and links under renamed source IDs', () => {
  const observation = observationFixture();
  const original = observation.sources[0]; original.originKeys = ['inventory-unit:target'];
  observation.sources.push({ sourceId: 'proposal-crop', kind: 'DERIVED', sourceRef: 'fixture:crop', sourceUrl: null,
    sha256: 'c'.repeat(64), parentSourceIds: [original.sourceId], originKeys: ['fixture:crop'] });
  const f = sample(observation);
  f.manifest.sources.push({ ...original, sourceId: 'published-original' },
    { ...observation.sources[1], sourceId: 'published-crop', parentSourceIds: ['published-original'] });
  f.link.sourceIds = ['published-crop'];
  assertCatalogObservationLink(f.manifest, f.link, f.row);
  const changed = () => JSON.parse(JSON.stringify(f.manifest));
  const wrongParent = changed(); wrongParent.sources.at(-1).parentSourceIds = [wrongParent.sources[0].sourceId];
  assert.throws(() => assertCatalogObservationLink(wrongParent, f.link, f.row));
  const erasedRoots = changed(); erasedRoots.sources.at(-2).originKeys = ['unrelated:physical:card'];
  assert.throws(() => assertCatalogObservationLink(erasedRoots, f.link, f.row));
  const wrongHash = changed(); wrongHash.sources.at(-2).sha256 = 'd'.repeat(64);
  assert.throws(() => assertCatalogObservationLink(wrongHash, f.link, f.row));
  for (const index of [-1, -2]) {
    const alias = changed();
    alias.sources.push({ ...alias.sources.at(index), sourceId: 'same-bytes-erased-lineage',
      originKeys: ['unrelated:alias'], parentSourceIds: index === -1 ? [alias.sources[0].sourceId] : [] });
    alias.images[0].sourceIds = ['same-bytes-erased-lineage'];
    assert.throws(() => assertCatalogObservationLink(alias, f.link, f.row));
    assert.throws(() => assertCatalogObservationLink(alias, { ...f.link, sourceIds: ['reviewed-observation'] }, f.row));
  }
});

test('selection does not grant official authority, erase lineage, or select another category/set', () => {
  for (const change of [
    (f: ReturnType<typeof sample>) => { f.manifest.sources.at(-1).kind = 'OFFICIAL_CHECKLIST'; },
    (f: ReturnType<typeof sample>) => { f.manifest.sources.at(-1).originKeys = ['different:card']; },
    (f: ReturnType<typeof sample>) => { f.manifest.set.category = 'SPORTS'; },
    (f: ReturnType<typeof sample>) => { f.link.sourceIds = ['absent']; },
  ]) { const f = sample(); change(f); assert.throws(() => assertCatalogObservationLink(f.manifest, f.link, f.row)); }
  assert.equal(catalogObservationReviewSchema.safeParse([{ ...sample().link, sourceIds: [] }]).success, false);
  const link = sample().link;
  assert.equal(catalogObservationReviewSchema.safeParse([link, link]).success, false);
});

test('legacy verification bytes stay identical; observation selections change the full verification hash', () => {
  const old = { schemaVersion: 'setops-catalog-verification/v1', sources: [], images: [], artifacts: [] };
  assert.equal(canonicalJson(parseCatalogVerification(old)), canonicalJson(old));
  assert.equal(Object.hasOwn(parseCatalogVerification(old), 'observations'), false);
  const next = parseCatalogVerification({ ...old, observations: [sample().link] });
  assert.notEqual(hashCatalogVerification(next), hashCatalogVerification(old));
});
