import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, hashManifest, validateManifest, printingIdentityId, lookupManifestCandidates,
  createPublishedCatalogReader, compareEvidenceLineage, prepareObservationProposal, observationRetryDisposition } from '../src/index.mjs';
import { fixture, queryFor, hostFixture, observationFixture, copy, sha } from './fixtures.mjs';

const error = code => ({ name: 'CatalogContractError', code });
for (const category of ['SPORTS', 'POKEMON']) {
  test(`${category}: complete manifest hash ignores object insertion order and retains every field`, () => {
    const manifest = fixture(category), reordered = Object.fromEntries(Object.entries(manifest).reverse());
    assert.equal(hashManifest(reordered), hashManifest(manifest));
    for (const alter of [value => { value.coverage.images.detail += ' changed'; },
      value => { value.images[0].sha256 = sha('other image bytes'); },
      value => { value.applicability[0].note += ' changed'; }, value => { value.sources[0].sha256 = sha('other source bytes'); },
      value => { value.aliases[0].value += ' changed'; }, value => { value.cards[0].name += ' changed'; }]) {
      const changed = copy(manifest); alter(changed);
      assert.notEqual(hashManifest(changed), hashManifest(manifest));
    }
    manifest.reviewed = true;
    assert.throws(() => hashManifest(manifest), error('INVALID_FIELDS'));
  });
  test(`${category}: exact reviewed applicability and representative depicted identity stay separate`, () => {
    const manifest = fixture(category), result = lookupManifestCandidates(manifest, queryFor(manifest));
    assert.equal(result.authority, 'unreviewed_manifest'); assert.equal(result.publication, null);
    assert.equal(result.outcome, 'one_candidate'); assert.equal(result.candidates[0].applicability, 'supported');
    const image = result.candidates[0].images[0];
    assert.equal(image.relationship, 'representative_finish'); assert.equal(image.depicted.cardId, manifest.cards[1].cardId);
    assert.notEqual(image.depicted.cardId, result.candidates[0].card.cardId);
    const exact = lookupManifestCandidates(manifest, { ...queryFor(manifest), cardNumber: manifest.cards[1].number });
    assert.equal(exact.candidates[0].images[0].relationship, 'depicts_candidate_identity');
    assert.equal(result.identityDecision, 'consumer_review_required');
  });
  test(`${category}: absent or incomplete scope never establishes support or exclusion`, () => {
    const manifest = fixture(category), query = queryFor(manifest);
    delete query.language;
    const incomplete = lookupManifestCandidates(manifest, query).candidates[0];
    assert.equal(incomplete.applicability, 'unknown'); assert.equal(incomplete.recordedApplicability, 'supported');
    assert.deepEqual(incomplete.unresolvedScopeFields, ['language']); assert.deepEqual(incomplete.images, []);
    const excluded = lookupManifestCandidates(manifest, { ...queryFor(manifest), printingLabel: manifest.printings[1].label });
    assert.equal(excluded.candidates[0].applicability, 'excluded'); assert.deepEqual(excluded.candidates[0].images, []);
    const unknown = lookupManifestCandidates(manifest, { ...queryFor(manifest), cardNumber: manifest.cards[1].number, printingLabel: manifest.printings[1].label });
    assert.equal(unknown.candidates[0].applicability, 'unknown');
    manifest.applicability = manifest.applicability.filter(row => row.cardId !== manifest.cards[0].cardId);
    assert.equal(lookupManifestCandidates(manifest, queryFor(manifest)).candidates[0].applicability, 'unknown');
    const absent = lookupManifestCandidates(manifest, { ...queryFor(manifest), cardNumber: 'DOES-NOT-EXIST' });
    assert.equal(absent.outcome, 'not_found'); assert.equal(absent.absenceEstablishesExclusion, false);
    assert.equal(absent.coverage.text.status, 'partial');
  });
  test(`${category}: exact host-loaded full hash and original review binding are required`, async () => {
    const manifest = fixture(category), { pin, loaded } = hostFixture(manifest);
    const reader = createPublishedCatalogReader({ loadAuthorizedPublication: async requested => {
      assert.deepEqual(requested, pin); return loaded;
    } });
    const result = await reader.lookup({ publication: pin, query: queryFor(manifest) });
    assert.equal(result.authority, 'host_authorized_setops_publication');
    assert.equal(result.publication.manifestSha256, hashManifest(manifest));
    assert.equal(result.publication.setApprovalId, 'fixture:setops:approval');
    loaded.manifest.images[0].sha256 = sha('unreviewed replacement');
    await assert.rejects(reader.lookup({ publication: pin, query: queryFor(manifest) }), error('MANIFEST_HASH_MISMATCH'));
  });
}

test('canonical hashing rejects lossy or executable JavaScript values instead of omitting them', () => {
  for (const value of [{ ignored: undefined }, { ignored: () => {} }, { number: NaN }, { number: -0 }, { number: 1.2 }, new Date(), [undefined], Array(1)]) {
    assert.throws(() => canonicalJson(value), { name: 'CatalogContractError' });
  }
  const cycle = {}; cycle.parent = cycle;
  assert.throws(() => canonicalJson(cycle), error('CIRCULAR_JSON'));
  let invoked = false;
  const getter = {}; Object.defineProperty(getter, 'x', { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => canonicalJson(getter), error('INVALID_JSON_ACCESSOR')); assert.equal(invoked, false);
  const array = [1]; Object.defineProperty(array, Symbol('unhashed'), { value: 2 });
  assert.throws(() => canonicalJson(array), error('INVALID_JSON_ARRAY'));
});

test('SetOps identity stays stable across label changes but cannot drift across language/edition', () => {
  const manifest = fixture(), oldId = manifest.printings[0].printingId;
  manifest.printings[0].label = 'Source-backed updated display label';
  assert.equal(validateManifest(manifest).printings[0].printingId, oldId);
  manifest.printings[0].language = 'ja';
  assert.notEqual(printingIdentityId(manifest.set.category, manifest.set.setId, manifest.printings[0]), oldId);
  assert.throws(() => validateManifest(manifest), error('PRINTING_ID_MISMATCH'));
});

test('SetOps row collisions, cross-program applicability and category field mixing fail validation', () => {
  const collision = fixture(); collision.printings[2].parallelRowId = 'different:row';
  assert.throws(() => validateManifest(collision), error('SETOPS_ID_COLLISION'));
  const crossProgram = fixture(); crossProgram.applicability[0].cardId = crossProgram.cards[2].cardId;
  assert.throws(() => validateManifest(crossProgram), error('PROGRAM_SCOPE_MISMATCH'));
  const category = fixture('POKEMON'); category.set.manufacturer = 'Sports manufacturer';
  assert.throws(() => validateManifest(category), error('CATEGORY_FIELD_MISMATCH'));
});

test('malformed relationship rows and ambiguous diagnostic identifiers cannot bypass strict validation', () => {
  const malformed = fixture(); malformed.applicability[0] = null;
  assert.throws(() => validateManifest(malformed), { name: 'CatalogContractError' });
  const diagnostic = fixture(); diagnostic.printings[0].diagnostics[0] = null;
  assert.throws(() => validateManifest(diagnostic), { name: 'CatalogContractError' });
  const collision = fixture(); collision.printings[1].diagnostics[0].id = collision.printings[0].diagnostics[0].id;
  assert.throws(() => validateManifest(collision), error('DUPLICATE'));
});

test('unknown source dimensions retain a candidate without certifying requested language or exposing images', () => {
  const manifest = fixture(), printing = manifest.printings[0], priorId = printing.printingId;
  printing.language = null;
  printing.printingId = printingIdentityId(manifest.set.category, manifest.set.setId, printing);
  for (const row of manifest.applicability) if (row.printingId === priorId) row.printingId = printing.printingId;
  manifest.images[0].depicted.printingId = printing.printingId;
  manifest.images[0].representsPrintingIds = [printing.printingId];
  const result = lookupManifestCandidates(manifest, { ...queryFor(manifest), language: 'en' });
  assert.equal(result.totalCandidateCount, 1); assert.equal(result.candidates[0].applicability, 'unknown');
  assert.equal(result.candidates[0].recordedApplicability, 'supported'); assert.deepEqual(result.candidates[0].images, []);
});

test('number prefixes, punctuation, leading zeroes and Pokémon denominators are significant', () => {
  const pokemon = fixture('POKEMON');
  for (const [number, id] of [['001/165', pokemon.cards[0].cardId], ['1/165', pokemon.cards[1].cardId]]) {
    const result = lookupManifestCandidates(pokemon, { ...queryFor(pokemon), cardNumber: number });
    assert.equal(result.candidates[0].card.cardId, id); assert.equal(result.totalCandidateCount, 1);
  }
  for (const number of ['001/0165', '001', '001-165', '001 / 165']) {
    assert.equal(lookupManifestCandidates(pokemon, { ...queryFor(pokemon), cardNumber: number }).outcome, 'not_found');
  }
  const sports = fixture();
  for (const number of ['HMCF', 'CF', 'HM-CF/99']) assert.equal(lookupManifestCandidates(sports, { ...queryFor(sports), cardNumber: number }).outcome, 'not_found');
});

test('Unicode composition is equivalent; an accent-less spelling needs its own scoped source alias', () => {
  const manifest = fixture('POKEMON'), query = queryFor(manifest);
  assert.equal(lookupManifestCandidates(manifest, { ...query, cardName: 'E\u0301voli' }).totalCandidateCount, 1);
  assert.equal(lookupManifestCandidates(manifest, { ...query, cardName: 'Evoli' }).totalCandidateCount, 1);
  manifest.aliases = manifest.aliases.filter(alias => alias.kind !== 'card_name');
  assert.equal(lookupManifestCandidates(manifest, { ...query, cardName: 'Evoli' }).totalCandidateCount, 0);
});

test('number collisions and colliding aliases remain ambiguous even when the response is truncated', () => {
  const manifest = fixture(), query = queryFor(manifest); delete query.programId;
  const acrossPrograms = lookupManifestCandidates(manifest, { ...query, limit: 1 });
  assert.equal(acrossPrograms.outcome, 'ambiguous'); assert.equal(acrossPrograms.totalCandidateCount, 2);
  assert.equal(acrossPrograms.returnedCount, 1); assert.equal(acrossPrograms.truncated, true);
  manifest.aliases.push({ ...copy(manifest.aliases[1]), targetId: manifest.cards[1].cardId });
  const aliases = lookupManifestCandidates(manifest, { ...queryFor(manifest), cardNumber: 'HM-CF-ALT' });
  assert.equal(aliases.outcome, 'ambiguous'); assert.deepEqual(aliases.candidates.map(row => row.card.cardId), [manifest.cards[0].cardId, manifest.cards[1].cardId]);
});

test('wrong set/category/program/language and guessed product names do not inherit aliases', () => {
  const manifest = fixture(), query = { ...queryFor(manifest), cardNumber: 'HM-CF-ALT' };
  for (const changed of [{ setId: 'other:set' }, { category: 'POKEMON' }, { programId: 'insert' }, { language: 'ja' }, { setLabel: 'Synthetic sports' }]) {
    assert.equal(lookupManifestCandidates(manifest, { ...query, ...changed }).outcome, 'not_found');
  }
  assert.equal(lookupManifestCandidates(manifest, { ...query, setLabel: 'Fixture sports alias' }).outcome, 'one_candidate');
  manifest.aliases[1].scope.programId = 'insert';
  assert.throws(() => validateManifest(manifest), error('ALIAS_SCOPE_MISMATCH'));
});

test('sources cannot launder a listing or machine observation into canonical alias authority', () => {
  const manifest = fixture(); manifest.aliases[0].sourceIds = [manifest.sources[1].sourceId];
  assert.throws(() => validateManifest(manifest), error('NON_AUTHORITATIVE_SOURCE'));
  manifest.aliases[0].sourceIds = [manifest.sources[0].sourceId];
  manifest.sources[0].parentSourceIds = [manifest.sources[1].sourceId];
  assert.throws(() => validateManifest(manifest), error('NON_AUTHORITATIVE_SOURCE'));
});

test('source and crop cycles are rejected; the same listing, bytes or parent image is shared evidence', () => {
  const manifest = fixture(), source = copy(manifest.sources[1]);
  source.sourceId = 'fixture:syndicated'; source.sourceRef = 'fixture:syndicated:ref'; source.sha256 = sha('different wrapper');
  manifest.sources.push(source);
  assert.equal(compareEvidenceLineage(manifest, { sourceIds: [source.sourceId], imageIds: [] }, { sourceIds: [manifest.sources[1].sourceId], imageIds: [] }).relationship, 'shared_lineage');
  source.originKeys = ['different:declared:origin']; source.sha256 = manifest.sources[1].sha256;
  assert.equal(compareEvidenceLineage(manifest, { sourceIds: [source.sourceId], imageIds: [] }, { sourceIds: [manifest.sources[1].sourceId], imageIds: [] }).relationship, 'shared_lineage');
  const crop = copy(manifest.images[0]); crop.imageId = 'fixture:crop'; crop.sha256 = sha('cropped image bytes'); crop.parentImageIds = [manifest.images[0].imageId];
  manifest.images.push(crop);
  assert.equal(compareEvidenceLineage(manifest, { sourceIds: [], imageIds: [crop.imageId] }, { sourceIds: [], imageIds: [manifest.images[0].imageId] }).relationship, 'shared_lineage');
  manifest.images[0].parentImageIds = [crop.imageId];
  assert.throws(() => validateManifest(manifest), error('CIRCULAR_EVIDENCE'));
  const cycle = fixture(); cycle.sources[0].parentSourceIds = [cycle.sources[1].sourceId]; cycle.sources[1].parentSourceIds = [cycle.sources[0].sourceId];
  assert.throws(() => validateManifest(cycle), error('CIRCULAR_EVIDENCE'));
});

test('distinct roots are described conservatively and image references remain opaque', () => {
  const manifest = fixture();
  assert.equal(compareEvidenceLineage(manifest, { sourceIds: [manifest.sources[0].sourceId], imageIds: [] }, { sourceIds: [manifest.sources[1].sourceId], imageIds: [] }).relationship, 'distinct_declared_roots');
  manifest.images[0].mediaRef = 'https://private.example/image?signature=secret';
  assert.throws(() => validateManifest(manifest), error('INVALID_OPAQUE_REFERENCE'));
  manifest.images[0].mediaRef = 'fixture:private:media'; manifest.images[0].depicted.printingId = manifest.printings[1].printingId;
  assert.throws(() => validateManifest(manifest), error('UNSUPPORTED_DEPICTED_IDENTITY'));
});

test('partial/truncated source coverage survives lookup independently from response pagination', () => {
  const manifest = fixture(); manifest.coverage.text.status = 'truncated';
  const result = lookupManifestCandidates(manifest, queryFor(manifest));
  assert.equal(result.truncated, false); assert.equal(result.coverage.text.status, 'truncated');
  assert.equal(result.coverage.applicability.status, 'partial'); assert.equal(result.absenceEstablishesExclusion, false);
  assert.throws(() => { result.candidates[0].card.name = 'mutable'; }, TypeError);
});

test('publication cannot be supplied as an HTTP-style self-attested JSON approval', async () => {
  assert.throws(() => createPublishedCatalogReader({}), error('HOST_AUTHORITY_REQUIRED'));
  const manifest = fixture(), { pin } = hostFixture(manifest);
  const reader = createPublishedCatalogReader({ loadAuthorizedPublication: async () => null });
  await assert.rejects(reader.lookup({ publication: pin, query: queryFor(manifest) }), error('PUBLICATION_UNAVAILABLE'));
  await assert.rejects(reader.lookup({ publication: pin, query: queryFor(manifest), approved: true }), error('INVALID_FIELDS'));
});

test('revoked/superseded records, wrong pins and unrelated draft review fail closed', async () => {
  for (const [mutate, code] of [
    [value => { value.loaded.authority.state = 'superseded'; }, 'PUBLICATION_NOT_CURRENT'],
    [value => { value.loaded.authority.state = 'revoked'; }, 'PUBLICATION_NOT_CURRENT'],
    [value => { value.loaded.authority.draftVersionId = 'other:version'; }, 'AUTHORITY_BINDING_MISMATCH'],
    [value => { value.pin.manifestSha256 = sha('different pin'); }, 'PUBLICATION_PIN_MISMATCH'],
  ]) {
    const manifest = fixture(), value = hostFixture(manifest); mutate(value);
    const reader = createPublishedCatalogReader({ loadAuthorizedPublication: async () => value.loaded });
    await assert.rejects(reader.lookup({ publication: value.pin, query: queryFor(manifest) }), error(code));
  }
});

test('supersession is full-hash-bound and sequential; history is not overwritten', () => {
  const prior = fixture(), { pin } = hostFixture(prior), next = copy(prior);
  next.revision = 2; next.supersedes = pin; next.setOps.draftVersionId = 'fixture:new:draft-version';
  assert.equal(validateManifest(next).supersedes.manifestSha256, hashManifest(prior));
  assert.notEqual(hashManifest(prior), hashManifest(next)); assert.equal(prior.revision, 1);
  next.revision = 3;
  assert.throws(() => validateManifest(next), error('INVALID_SUPERSESSION'));
});

test('observation retries are exact, producer/revision scoped and never image/reference approval', () => {
  const proposal = observationFixture(), first = prepareObservationProposal(proposal);
  assert.equal(first.disposition, 'requires_authorized_review'); assert.equal(first.proposal.images[0].mediaRef, proposal.images[0].mediaRef);
  assert.equal(observationRetryDisposition(null, proposal).disposition, 'new');
  const receipt = { idempotencyKey: first.idempotencyKey, proposalSha256: first.proposalSha256 };
  assert.equal(observationRetryDisposition(receipt, copy(proposal)).disposition, 'replay');
  const changed = copy(proposal); changed.images[0].sha256 = sha('different source image');
  assert.throws(() => observationRetryDisposition(receipt, changed), error('IDEMPOTENCY_CONFLICT'));
  changed.inputRevision = 'capture:2';
  assert.notEqual(prepareObservationProposal(changed).idempotencyKey, first.idempotencyKey);
  assert.notEqual(prepareObservationProposal(observationFixture('atlas')).idempotencyKey, first.idempotencyKey);
  proposal.approvedByReviewer = true;
  assert.throws(() => prepareObservationProposal(proposal), error('INVALID_FIELDS'));
});
