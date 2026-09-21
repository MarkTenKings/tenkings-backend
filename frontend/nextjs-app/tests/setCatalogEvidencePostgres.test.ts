import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { canonicalJson, hashManifest, prepareObservationProposal, type PublicationPin } from '@tenkings/card-catalog-evidence';
import { createSetCatalogEvidenceService, type CatalogProposalAuthority } from '../lib/server/setCatalogEvidence';
import { assertNoRetainedCatalogHistory } from '../lib/server/setOps';
import type { AdminSession } from '../lib/server/admin';
import publicationApi from '../pages/api/admin/set-ops/catalog/publication';
import { recordStaffInventoryV2, claimStaffInventoryResearchV2, completeStaffInventoryResearchV2,
  acquireStaffInventoryIntakeLeaseV2, releaseStaffInventoryIntakeLeaseV2, inventoryHash } from '@tenkings/database';
import { createStaffInventoryCatalogReconciler, createCatalogProposalInbox } from '../lib/server/staffInventoryCatalogObservations';
import { source as completedSourceFixture } from './catalogObservationFixtures';

const hashBytes = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
test('real catalog writer, private lookup, exact retries, revoke races and retained history', { skip: process.env.TEN_KINGS_CATALOG_DISPOSABLE_VALIDATION !== '1' }, async t => {
  const url = new URL(process.env.DATABASE_URL!); assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/tenkings_set_catalog_disposable');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const { fixture, observationFixture, queryFor } = await import(pathToFileURL(resolve(dirname(require.resolve('@tenkings/card-catalog-evidence')), '../tests/fixtures.mjs')).href);
  const artifacts = new Map<string, Buffer>(), service = createSetCatalogEvidenceService({ db, readArtifact: async ref => { const bytes = artifacts.get(ref); assert.ok(bytes, 'only exact synthetic private bytes may be read'); return bytes; } });
  const user = await db.user.create({ data: { id: 'catalog-fixture-human', displayName: 'DISPOSABLE CATALOG HUMAN FIXTURE' } });
  const actor: AdminSession = { authority: 'local-database', sessionId: 'catalog-fixture-session', tokenHash: hashBytes('catalog-fixture-token'), expiresAt: new Date(Date.now() + 3600000), user: { id: user.id, phone: null, displayName: user.displayName } };
  await db.session.create({ data: { id: actor.sessionId, tokenHash: actor.tokenHash, expiresAt: actor.expiresAt!, userId: user.id } });
  const grant = { basis: 'owned_original', detail: 'Synthetic disposable test bytes. This grant is not real source authority.', consumers: ['inventory'] };
  async function seed(category: string) {
    const manifest = fixture(category);
    for (const source of manifest.sources) { const bytes = Buffer.from(`synthetic bytes ${source.sourceId}`); source.sourceRef = `catalog:sha256:${hashBytes(bytes)}`; artifacts.set(source.sourceRef, bytes); }
    const image = manifest.images[0], imageBytes = await sharp({ create: { width: image.width, height: image.height, channels: 3, background: 'white' } }).jpeg().toBuffer();
    image.sha256 = hashBytes(imageBytes); image.mediaRef = `catalog:sha256:${image.sha256}`; artifacts.set(image.mediaRef, imageBytes);
    await db.setDraft.create({ data: { id: manifest.setOps.draftId, setId: manifest.set.setId, status: 'APPROVED' } });
    await db.setDraftVersion.create({ data: { id: manifest.setOps.draftVersionId, draftId: manifest.setOps.draftId, version: 1, versionHash: manifest.setOps.legacyVersionHash, dataJson: { rows: [], fixture: true } } });
    await db.setApproval.create({ data: { id: `${category}-legacy-approval`, draftId: manifest.setOps.draftId, draftVersionId: manifest.setOps.draftVersionId, decision: 'APPROVED', versionHash: manifest.setOps.legacyVersionHash, approvedById: user.id } });
    const official = manifest.sources[0];
    await db.setTaxonomySource.create({ data: { id: official.sourceId, setId: manifest.set.setId, sourceKind: 'OFFICIAL_CHECKLIST', sourceUrl: official.sourceUrl } });
    for (const program of manifest.programs) await db.setProgram.create({ data: { id: program.rowId, setId: manifest.set.setId, programId: program.programId, label: program.label, sourceId: official.sourceId } });
    for (const card of manifest.cards) await db.setCard.create({ data: { id: card.cardId, setId: manifest.set.setId, programId: card.programId, cardNumber: card.number, playerName: card.name, sourceId: official.sourceId } });
    const inserted = new Set<string>();
    for (const printing of manifest.printings) {
      if (!inserted.has(printing.parallelRowId)) { await db.setParallel.create({ data: { id: printing.parallelRowId, setId: manifest.set.setId, parallelId: printing.parallelId, label: printing.label, sourceId: official.sourceId } }); inserted.add(printing.parallelRowId); }
      await db.setParallelScope.create({ data: { id: printing.scopeRowId, setId: manifest.set.setId, scopeKey: printing.scopeRowId, parallelId: printing.parallelId, programId: printing.programId, sourceId: official.sourceId } });
    }
    return { manifest, reviewEvidence: { sources: manifest.sources.map((s: { sourceId: string; kind: string }) => ({ sourceId: s.sourceId, taxonomySourceId: s.kind === 'OFFICIAL_CHECKLIST' ? s.sourceId : null, classificationNote: 'Synthetic fixture provenance only.', grant })), images: [{ imageId: image.imageId, grant }] } };
  }
  const sports = await seed('SPORTS'), pokemon = await seed('POKEMON');
  const request = async (packet: typeof sports) => { const p = await service.previewSetCatalogEvidence(packet, actor); return { ...packet, manifestSha256: p.manifestSha256, verificationSha256: p.verificationSha256, expectedCurrent: p.expectedCurrent, expectedHistory: p.expectedHistory, acknowledgement: 'PUBLISH REVIEWED CATALOG EVIDENCE' }; };
  const successor = (packet: typeof sports, pin: PublicationPin) => { const next = clone(packet); next.manifest.revision = pin.revision + 1; next.manifest.supersedes = pin; return next; };
  let pin: PublicationPin, sportsRequest: Awaited<ReturnType<typeof request>>;
  try {
    await t.test('legacy approval confers no new authority; wrong IDs/hash/grant/actor fail before publication', async () => {
      assert.equal(await service.loadCurrentSetCatalogPublication({ setId: sports.manifest.set.setId }), null);
      const invalid = clone(sports); invalid.manifest.cards[0].cardId = 'wrong-card';
      await assert.rejects(service.previewSetCatalogEvidence(invalid, actor));
      await assert.rejects(service.publishSetCatalogEvidence({}, { ...actor, authority: 'operator-key' }), /human admin/);
      const req = await request(sports);
      await assert.rejects(service.publishSetCatalogEvidence({ ...req, manifestSha256: 'a'.repeat(64) }, actor), /changed/);
      assert.equal(await db.setCatalogEvidencePublication.count(), 0);
    });
    await t.test('two actual DB connections serialize the first review; exact retry returns one row and one approval', async () => {
      sportsRequest = await request(sports);
      const [a, b] = await Promise.all([service.publishSetCatalogEvidence(sportsRequest, actor), service.publishSetCatalogEvidence(sportsRequest, actor)]);
      assert.deepEqual([a.outcome, b.outcome].sort(), ['recorded', 'replay']); assert.deepEqual(a.publication, b.publication); pin = a.publication;
      assert.equal(await db.setCatalogEvidencePublication.count(), 1); assert.equal(await db.setApproval.count({ where: { draftId: sports.manifest.setOps.draftId } }), 2);
      const row = await db.setCatalogEvidencePublication.findUniqueOrThrow({ where: { id: pin.publicationId } });
      assert.equal(hashManifest(row.manifestJson), row.manifestSha256);
      const result = await service.lookupPublishedSetCatalogEvidence({ publication: pin, query: queryFor(sports.manifest) });
      assert.equal(result.authority, 'host_authorized_setops_publication'); assert.equal(result.candidates[0].images[0].relationship, 'representative_finish');
      assert.deepEqual(await service.findCurrentSetCatalogPublications({ query: { category: 'SPORTS', setLabel: sports.manifest.aliases[0].value, year: '2024', manufacturer: 'Fixture Maker' } }), [pin]);
      assert.deepEqual(await service.findCurrentSetCatalogPublications({ query: { category: 'SPORTS', setLabel: 'Nearby product', year: '2024' } }), []);
      await assert.rejects(service.lookupPublishedSetCatalogEvidence({ publication: pin, query: queryFor(sports.manifest), consumer: 'atlas' }), /not granted/);
    });
    await t.test('database prevents content, review, actor, audit and cross-draft pointer mutation', async () => {
      const row = await db.setCatalogEvidencePublication.findUniqueOrThrow({ where: { id: pin.publicationId } });
      await assert.rejects(db.setCatalogEvidencePublication.update({ where: { id: row.id }, data: { manifestSha256: 'b'.repeat(64) } }), /append-only/);
      await assert.rejects(db.setCatalogEvidencePublication.delete({ where: { id: row.id } }), /append-only/);
      await assert.rejects(db.setDraftVersion.update({ where: { id: row.draftVersionId }, data: { dataJson: { changed: true } } }), /immutable/);
      await assert.rejects(db.setApproval.update({ where: { id: row.setApprovalId }, data: { approvedById: null } }), /immutable/);
      await assert.rejects(db.user.delete({ where: { id: user.id } }));
      await assert.rejects(db.setDraft.update({ where: { id: pokemon.manifest.setOps.draftId }, data: { currentCatalogPublicationId: row.id } }), /new reviewed/);
      await assert.rejects(db.setDraft.update({ where: { id: row.draftId }, data: { currentCatalogPublicationId: null } }), /atomic audit/);
      const audit = await db.setAuditEvent.findFirstOrThrow({ where: { draftId: row.draftId, action: 'set_ops.catalog.publish' } });
      await assert.rejects(db.setAuditEvent.delete({ where: { id: audit.id } }), /append-only/);
      await assert.rejects(assertNoRetainedCatalogHistory(db, [sports.manifest.set.setId]), /immutable catalog/);
      await assert.rejects(db.setDraft.delete({ where: { id: row.draftId } }));
      assert.equal((await db.setDraftVersion.findUniqueOrThrow({ where: { id: row.draftVersionId } })).versionHash, sports.manifest.setOps.legacyVersionHash);
    });
    await t.test('audit failure rolls approval, publication and current pointer back together', async () => {
      const next = successor(sports, pin), req = await request(next);
      const before = await db.setApproval.count();
      await db.$executeRawUnsafe(`CREATE FUNCTION catalog_fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='set_ops.catalog.publish' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER catalog_fixture_fail_audit BEFORE INSERT ON "SetAuditEvent" FOR EACH ROW EXECUTE FUNCTION catalog_fixture_fail_audit()`);
      try { await assert.rejects(service.publishSetCatalogEvidence(req, actor), /fixture audit failure/); }
      finally { await db.$executeRawUnsafe('DROP TRIGGER catalog_fixture_fail_audit ON "SetAuditEvent"'); await db.$executeRawUnsafe('DROP FUNCTION catalog_fixture_fail_audit()'); }
      assert.equal(await db.setApproval.count(), before); assert.equal(await db.setCatalogEvidencePublication.count(), 1);
      assert.deepEqual(await service.loadCurrentSetCatalogPublication({ setId: pin.setId }), pin);
    });
    await t.test('competing changed content has one winner; a real held row lock blocks a writer', async () => {
      const a = successor(sports, pin), b = clone(a); b.manifest.coverage.text.detail += ' Reviewed correction.';
      const [ra, rb] = await Promise.all([request(a), request(b)]);
      let settled = false; let pending: ReturnType<typeof service.publishSetCatalogEvidence> | undefined;
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "SetDraft" WHERE id=${sports.manifest.setOps.draftId} FOR UPDATE`;
        pending = service.publishSetCatalogEvidence(ra, actor).finally(() => { settled = true; });
        await delay(80); assert.equal(settled, false, 'second connection waits for the actual draft lock');
      });
      const results = await Promise.allSettled([pending!, service.publishSetCatalogEvidence(rb, actor)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
      pin = (results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<typeof pending>>).value!.publication;
      assert.equal(pin.revision, 2);
      await assert.rejects(service.lookupPublishedSetCatalogEvidence({ publication: { ...pin, revision: 1 }, query: queryFor(sports.manifest) }), (error: unknown) => (error as { statusCode?: number }).statusCode === 404);
      await assert.rejects(service.lookupPublishedSetCatalogEvidence({ publication: { ...pin, manifestSha256: '0'.repeat(64) }, query: queryFor(sports.manifest) }), (error: unknown) => (error as { statusCode?: number }).statusCode === 404);
    });
    await t.test('revocation, exact retry and history pin prevent null-pointer ABA or resurrection', async () => {
      const next = successor(sports, pin), beforeRevoke = await request(next);
      const outcomes = await Promise.all([service.revokeSetCatalogEvidence({ publication: pin, reason: 'Synthetic test revocation' }, actor), service.revokeSetCatalogEvidence({ publication: pin, reason: 'Synthetic test revocation' }, actor)]);
      assert.deepEqual(outcomes.map(x => x.outcome).sort(), ['recorded', 'replay']);
      assert.equal(await service.isSetCatalogPublicationCurrent(pin), false);
      await assert.rejects(service.lookupPublishedSetCatalogEvidence({ publication: pin, query: queryFor(sports.manifest) }), (error: unknown) => (error as { statusCode?: number }).statusCode === 404);
      assert.equal((await service.publishSetCatalogEvidence(sportsRequest, actor)).current, false);
      await assert.rejects(service.publishSetCatalogEvidence(beforeRevoke, actor), /pin changed/);
      await assert.rejects(service.readPublishedSetCatalogImage({ publication: pin, imageId: sports.manifest.images[0].imageId }), /unavailable/);
      await assert.rejects(db.setDraft.update({ where: { id: sports.manifest.setOps.draftId }, data: { currentCatalogPublicationId: pin.publicationId } }), /new reviewed/);
      const fresh = await request(next); assert.equal(fresh.expectedCurrent, null); assert.deepEqual(fresh.expectedHistory, pin);
      const oldPin = pin; pin = (await service.publishSetCatalogEvidence(fresh, actor)).publication;
      await service.revokeSetCatalogEvidence({ publication: oldPin, reason: 'Replay cannot clear a successor.' }, actor);
      assert.equal(await service.isSetCatalogPublicationCurrent(pin), true);
      await db.setDraft.update({ where: { id: sports.manifest.setOps.draftId }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
      assert.equal(await service.loadCurrentSetCatalogPublication({ setId: pin.setId }), null);
      await db.setDraft.update({ where: { id: sports.manifest.setOps.draftId }, data: { status: 'DRAFT', archivedAt: null } });
      assert.equal(await service.loadCurrentSetCatalogPublication({ setId: pin.setId }), null);
    });
    await t.test('Pokémon language and exact number stay explicit after publication', async () => {
      const result = await service.publishSetCatalogEvidence(await request(pokemon), actor);
      const query = queryFor(pokemon.manifest);
      const good = await service.lookupPublishedSetCatalogEvidence({ publication: result.publication, query });
      assert.equal(good.candidates[0].applicability, 'supported');
      const wrong = await service.lookupPublishedSetCatalogEvidence({ publication: result.publication, query: { ...query, language: 'en' } });
      assert.ok(wrong.candidates.every(c => c.applicability !== 'supported' && c.images.length === 0));
      const changed = await service.lookupPublishedSetCatalogEvidence({ publication: result.publication, query: { ...query, cardNumber: '1/165' } });
      assert.ok(changed.candidates.every(c => c.card.cardId !== pokemon.manifest.cards[0].cardId));
    });
    await t.test('authenticated service proposals need no fake User; concurrent replay never changes catalog', async () => {
      const proposal = observationFixture('atlas');
      const authority: CatalogProposalAuthority = { producer: 'atlas', actorKind: 'service', actorRef: 'fixture:atlas:service', userId: null,
        binding: { physicalCardRef: proposal.physicalCardRef, observationId: proposal.observationId, inputRevision: proposal.inputRevision, evidenceSha256: prepareObservationProposal(proposal).proposalSha256 } };
      const count = await db.setCatalogEvidencePublication.count();
      await assert.rejects(service.submitSetCatalogObservationProposal({ proposal, authority: { ...authority,
        binding: { ...authority.binding, evidenceSha256: hashBytes('incorrect fixture evidence') } } }), /authenticated/);
      const outcomes = await Promise.all([service.submitSetCatalogObservationProposal({ proposal, authority }), service.submitSetCatalogObservationProposal({ proposal, authority })]);
      assert.deepEqual(outcomes.map(x => x.outcome).sort(), ['recorded', 'replay']); assert.equal(outcomes[0].proposalId, outcomes[1].proposalId);
      const changed = { ...proposal, note: 'Different bytes' };
      await assert.rejects(service.submitSetCatalogObservationProposal({ proposal: changed,
        authority: { ...authority, binding: { ...authority.binding, evidenceSha256: prepareObservationProposal(changed).proposalSha256 } } }), /conflicts/);
      await assert.rejects(service.submitSetCatalogObservationProposal({ proposal, authority: { ...authority, actorRef: 'another-service' } }), /conflicts/);
      await assert.rejects(service.submitSetCatalogObservationProposal({ proposal: { ...proposal, physicalCardRef: 'forged' }, authority }), /authenticated/);
      const row = await db.setCatalogObservationProposal.findUniqueOrThrow({ where: { id: outcomes[0].proposalId } }); assert.equal(row.submittedById, null);
      await assert.rejects(db.setCatalogObservationProposal.delete({ where: { id: row.id } }), /append-only/);
      assert.equal(await db.setCatalogEvidencePublication.count(), count);
    });
    await t.test('actual admin API denies static keys and forged review bodies', async () => {
      const call = async (headers: Record<string, string>, body: unknown) => {
        let status = 0, result: unknown;
        const res = { setHeader() {}, status(n: number) { status = n; return this; }, json(value: unknown) { result = value; return this; } };
        await publicationApi({ method: 'POST', headers, body, query: {} } as never, res as never); return { status, result };
      };
      assert.equal((await call({ 'x-operator-key': 'fixture-static' }, sportsRequest)).status, 401);
      assert.equal((await call({ authorization: 'Bearer catalog-fixture-token' }, { action: 'publish', ...sportsRequest, reviewedById: 'forged' })).status, 400);
    });
    await t.test('new drafts and same-version legacy reapproval require a fresh complete publication', async () => {
      const setId = pokemon.manifest.set.setId, draftId = pokemon.manifest.setOps.draftId;
      const oldPin = (await service.loadCurrentSetCatalogPublication({ setId }))!; assert.ok(oldPin);
      const oldRow = await db.setCatalogEvidencePublication.findUniqueOrThrow({ where: { id: oldPin.publicationId } });
      const oldRequest = { ...pokemon, manifestSha256: oldRow.manifestSha256, verificationSha256: oldRow.verificationSha256,
        expectedCurrent: null, expectedHistory: null, acknowledgement: 'PUBLISH REVIEWED CATALOG EVIDENCE' };
      const newVersion = await db.setDraftVersion.create({ data: { id: 'pokemon-new-clean-version', draftId, version: 2,
        versionHash: hashBytes('new synthetic legacy draft'), dataJson: { rows: [], fixture: true } } });
      await db.setDraft.update({ where: { id: draftId }, data: { status: 'REVIEW_REQUIRED' } });
      await db.setApproval.create({ data: { draftId, draftVersionId: newVersion.id, decision: 'APPROVED', versionHash: newVersion.versionHash, approvedById: user.id } });
      await db.setDraft.update({ where: { id: draftId }, data: { status: 'APPROVED' } });
      assert.equal(await service.loadCurrentSetCatalogPublication({ setId }), null);
      assert.equal((await service.publishSetCatalogEvidence(oldRequest, actor)).current, false);
      await assert.rejects(service.lookupPublishedSetCatalogEvidence({ publication: oldPin, query: queryFor(pokemon.manifest) }), (error: unknown) => (error as { statusCode?: number }).statusCode === 404);
      const fresh = successor(pokemon, oldPin);
      fresh.manifest.setOps.draftVersionId = newVersion.id; fresh.manifest.setOps.legacyVersionHash = newVersion.versionHash;
      const freshRequest = await request(fresh), reviewed = await service.publishSetCatalogEvidence(freshRequest, actor);
      assert.deepEqual(await service.loadCurrentSetCatalogPublication({ setId }), reviewed.publication);
      await db.setDraft.update({ where: { id: draftId }, data: { archivedAt: new Date(), status: 'ARCHIVED' } });
      await db.setDraft.update({ where: { id: draftId }, data: { archivedAt: null, status: 'DRAFT' } });
      await db.setApproval.create({ data: { draftId, draftVersionId: newVersion.id, decision: 'APPROVED', versionHash: newVersion.versionHash, approvedById: user.id } });
      await db.setDraft.update({ where: { id: draftId }, data: { status: 'APPROVED' } });
      assert.equal(await service.loadCurrentSetCatalogPublication({ setId }), null);
      assert.equal((await service.publishSetCatalogEvidence(freshRequest, actor)).current, false);
      const renewed = await service.publishSetCatalogEvidence(await request(successor(fresh, reviewed.publication)), actor);
      assert.deepEqual(await service.loadCurrentSetCatalogPublication({ setId }), renewed.publication);
      assert.equal(await db.setCatalogEvidencePublication.count({ where: { draftId } }), 3, 'prior immutable publications remain retained');
    });
    await t.test('a reviewed successor retains exact observation lineage while an altered proposal pin is refused', async () => {
      const setId = pokemon.manifest.set.setId;
      const oldPin = (await service.loadCurrentSetCatalogPublication({ setId }))!;
      const oldRow = await db.setCatalogEvidencePublication.findUniqueOrThrow({ where: { id: oldPin.publicationId } });
      const observation = observationFixture('inventory');
      observation.observationId = 'fixture:linked:observation'; observation.images = [];
      const prepared = prepareObservationProposal(observation);
      const receipt = await service.submitSetCatalogObservationProposal({ proposal: observation,
        authority: { producer: 'inventory', actorKind: 'service', actorRef: 'inventory:catalog-observations:v1', userId: null,
          binding: { physicalCardRef: observation.physicalCardRef, observationId: observation.observationId, inputRevision: observation.inputRevision,
            evidenceSha256: prepared.proposalSha256 } } });
      const sourceId = 'fixture:linked:observation:source';
      const manifest = JSON.parse(canonicalJson(oldRow.manifestJson));
      manifest.revision++; manifest.supersedes = oldPin;
      const ref = `catalog:sha256:${prepared.proposalSha256}`;
      artifacts.set(ref, Buffer.from(canonicalJson(prepared.proposal)));
      manifest.sources.push({ sourceId, kind: 'PHYSICAL_OBSERVATION', sourceRef: ref, sourceUrl: null, sha256: prepared.proposalSha256,
        parentSourceIds: [], originKeys: prepared.proposal.sources.flatMap(source => source.originKeys) });
      const link = { proposalId: receipt.proposalId, proposalSha256: receipt.proposalSha256, sourceIds: [sourceId], reviewNote: 'Synthetic observation reviewed with separate official checklist evidence.' };
      const packet = { manifest, reviewEvidence: { ...pokemon.reviewEvidence,
        sources: [...pokemon.reviewEvidence.sources, { sourceId, taxonomySourceId: null, classificationNote: 'Unreviewed observation, now explicitly reviewed as supporting context only.', grant }],
        observations: [link] } };
      await assert.rejects(service.previewSetCatalogEvidence({ ...packet, reviewEvidence: { ...packet.reviewEvidence,
        observations: [{ ...link, proposalSha256: '0'.repeat(64) }] } }, actor), /immutable proposal/);
      const published = await service.publishSetCatalogEvidence(await request(packet), actor);
      assert.deepEqual(await service.loadCurrentSetCatalogPublication({ setId }), published.publication);
      const stored = await db.setCatalogEvidencePublication.findUniqueOrThrow({ where: { id: published.publication.publicationId } });
      assert.deepEqual((stored.verificationJson as { observations: unknown }).observations, [link]);
      const audit = await db.setAuditEvent.findFirstOrThrow({ where: { action: 'set_ops.catalog.publish', metadataJson: { path: ['publicationId'], equals: stored.id } } });
      assert.deepEqual((audit.metadataJson as { observations: unknown }).observations, [link]);
    });
    await t.test('actual Inventory saves contribute metadata after completion and pause for intake without changing saved cards', async () => {
      const location = await db.location.create({ data: { name: 'DISPOSABLE CATALOG INTAKE', slug: 'catalog-intake-fixture',
        address: 'Synthetic fixture', recentRips: [], locationType: 'hq' } });
      for (const category of ['Sports cards', 'Pokémon']) {
        const original = completedSourceFixture(category === 'Pokémon' ? 42 : 41, category);
        const fixtureInput = JSON.parse(original.input), flattened = fixtureInput.description;
        const description = { name: flattened.name, category, notes: 'PRIVATE FIXTURE NOTE', photo_key: fixtureInput.front_photo_key,
          back_photo_key: fixtureInput.back_photo_key, planned_sales_channel: 'eBay',
          card_details: { manufacturer: flattened.manufacturer, card_number: flattened.card_number, year: flattened.year,
            set_name: flattened.set_name, variant: null, card_type: null } };
        await db.$transaction(tx => recordStaffInventoryV2(tx, { action: 'add', request_id: randomUUID(), effective_at: new Date().toISOString(),
          note: 'Disposable catalog bridge check', origin: 'purchase', quantity: 1, total_cost_cents: 123, cost_method: 'documented_unit',
          expected_price_cents: null, destination: { location_id: location.id, kind: 'hq', machine_id: null, product_id: null, door_id: null },
          stage: 'unprocessed', description }, user.id));
        const claim = await db.$transaction(tx => claimStaffInventoryResearchV2(tx)); assert.ok(claim);
        assert.equal(claim.input.description_hash, inventoryHash(description));
        assert.notEqual(claim.input.description_hash, inventoryHash(claim.input.description));
        const result = { ...JSON.parse(original.result), unit_id: claim.input.unit_id, description_event_id: claim.input.description_event_id,
          description_hash: claim.input.description_hash, researched_at: new Date().toISOString() };
        assert.equal(await db.$transaction(tx => completeStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, result })), true);
      }
      const beforeEvents = await db.inventoryWorkflowEventV2.findMany({ orderBy: { sequence: 'asc' } });
      const beforeJobs = await db.staffInventoryResearchJobV2.findMany({ orderBy: { id: 'asc' } });
      const beforeProposals = await db.setCatalogObservationProposal.count();
      const scan = createStaffInventoryCatalogReconciler({ db,
        env: { SET_CATALOG_EVIDENCE_ENABLED: 'true', STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED: 'true' } });
      const lease = await db.$transaction(tx => acquireStaffInventoryIntakeLeaseV2(tx));
      assert.equal((await scan({ remainingBudgetMs: 30000 })).status, 'intake');
      assert.equal(await db.setCatalogObservationProposal.count(), beforeProposals);
      await db.$transaction(tx => releaseStaffInventoryIntakeLeaseV2(tx, lease.leaseId));
      const captured = await scan({ remainingBudgetMs: 30000 });
      assert.equal(captured.recorded, 2); assert.equal(captured.invalid, 0); assert.equal(captured.failed, 0);
      assert.equal((await scan({ remainingBudgetMs: 30000 })).status, 'wrapped');
      assert.equal((await scan({ remainingBudgetMs: 30000 })).status, 'idle');
      assert.equal(await db.setCatalogObservationProposal.count(), beforeProposals + 2);
      assert.deepEqual(await db.inventoryWorkflowEventV2.findMany({ orderBy: { sequence: 'asc' } }), beforeEvents);
      assert.deepEqual(await db.staffInventoryResearchJobV2.findMany({ orderBy: { id: 'asc' } }), beforeJobs);
      const inbox = createCatalogProposalInbox(db), page = await inbox.list({ producer: 'inventory' }, actor);
      const contributions = page.items.filter(item => item.physicalCardRef.startsWith('inventory-card:'));
      assert.equal(contributions.length, 2);
      for (const item of contributions) {
        const detail = await inbox.detail({ proposalId: item.proposalId, proposalSha256: item.proposalSha256 }, actor);
        assert.equal(hashBytes(detail.canonicalProposalJson), item.proposalSha256);
        assert.deepEqual(JSON.parse(detail.canonicalProposalJson).images, []);
        assert.equal(detail.canonicalProposalJson.includes('PRIVATE FIXTURE NOTE'), false);
      }
    });
  } finally { await db.$disconnect(); }
});
