import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createManualService } from '@atlas/manual-service';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createPublicationRepository, publicationGrantSQL } from '../src/publication-repository.mjs';
import { createManualPublication } from '../src/publication.mjs';
import { createApprovedManualReader } from '../src/publication-reader.mjs';
import { createPresentationRepository, presentationGrantSQL } from '../src/presentation-repository.mjs';
import { createManualFinishing } from '../src/finishing.mjs';
import { createDealerOfferService } from '../src/dealer-offers.mjs';
import { publicationFixture } from '../test/publication-fixture.mjs';

const output = process.env.ATLAS_PRESENTATION_EVIDENCE;
assert(output && resolve(output) === output, 'New absolute owned evidence directory required');
await mkdir(output, { mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2));
try {
  const checks = [];
  const [installed] = await fixture.admin.$queryRawUnsafe("SELECT to_regclass('atlas_manual.presentation')::text AS relation");
  assert.equal(installed.relation, 'atlas_manual.presentation', 'Presentation must be installed by the tracked staff migration chain');
  for (const grants of [publicationGrantSQL, presentationGrantSQL]) await fixture.cluster.sql(grants('atlas_fixture_manual'), [], fixture.database.name);
  const { boundary, auth, manualClient } = fixture.connect();
  async function login(phone) {
    const boot = await auth.bootstrap(''), browserCookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(browserCookie, boot.csrf, { phone, requestId: randomUUID() }, 'fixture-presentation');
    const verified = await auth.verify(browserCookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'fixture-presentation');
    return auth.authenticate(`${browserCookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  }
  const staff = await login('+12025550141'), other = await login('+12025550142');
  const f = await publicationFixture(), publicationRepository = createPublicationRepository({ boundary });
  const repository = createManualRepository({ boundary, approvalCommitted: publicationRepository.approvalCommitted });
  await repository.provision(staff, { cardId: f.cardId, draft: f.draft });
  const service = createManualService({ repository, reduce: ({ card }) => card.draft, buildReport: async () => f.approval });
  const publication = createManualPublication({ repository: publicationRepository, artifacts: f.artifacts, storage: f.storage,
    readSource: async (_staff, _id, upload) => ({ photo: f.photos[upload.side] }) });
  const approve = { actionId: f.actionId, expectedRevision: 1, action: { type: 'APPROVE_REPORT', reportHash: f.row.report_hash, reviewed: true } };
  await service.execute(staff, f.cardId, approve); const published = await publication.publish(staff, f.cardId, f.actionId);
  const unchangedApproval = await repository.readApproval(staff, f.cardId, f.actionId);
  const finishing = createManualFinishing({ repository: publicationRepository, artifacts: f.artifacts });
  const plan = await finishing.load(staff, f.cardId, f.actionId);
  assert.equal(plan.binding.publicHash, published.publicHash); assert.equal(plan.label.finalGrade, f.full.finalGrade);
  await assert.rejects(finishing.load(other, f.cardId, f.actionId));
  checks.push('actual authenticated manual approval loads exact finishing label; unrelated staff cannot read it');

  const presentation = createPresentationRepository({ boundary, keyPrefix: 'fixture/presentation' });
  assert.deepEqual(await presentation.status(staff, f.cardId), { presentation: null, revision: 0, approvalActionId: f.actionId });
  const input = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 0, sha256: 'e'.repeat(64), byteCount: 3, alt: 'Synthetic slab photo' };
  const upload = await presentation.plan(staff, f.cardId, input);
  assert.deepEqual(await presentation.plan(staff, f.cardId, input), upload);
  await assert.rejects(presentation.plan(staff, f.cardId, { ...input, alt: 'Changed retry' }));
  assert.equal((await presentation.loadUpload(staff, f.cardId, upload.uploadId)).upload.plan.expected.sha256, input.sha256);
  await assert.rejects(presentation.status(other, f.cardId)); await assert.rejects(presentation.loadUpload(other, f.cardId, upload.uploadId));
  checks.push('photo upload plans are durable exact retries; changed request and unrelated staff fail');

  const photoBytes = Buffer.from('synthetic presentation media; no actual storage or photograph');
  const photo = { descriptor: { sha256: digest(photoBytes), byteCount: photoBytes.length, contentType: 'image/webp', width: 1200, height: 800, alt: input.alt }, media: { fixture: 'exact synthetic object' } };
  const commit = { requestId: input.requestId, approvalActionId: input.approvalActionId, expectedRevision: input.expectedRevision };
  const first = await presentation.commit(staff, f.cardId, commit, photo);
  assert.equal(first.revision, 1); assert.deepEqual(await presentation.commit(staff, f.cardId, commit, photo), first);
  assert.deepEqual((await presentation.loadUpload(staff, f.cardId, upload.uploadId)).done, first);
  await assert.rejects(presentation.commit(staff, f.cardId, commit, { ...photo, descriptor: { ...photo.descriptor, alt: 'Different retry' } }));
  assert.deepEqual(await repository.readApproval(staff, f.cardId, f.actionId), unchangedApproval);
  checks.push('append-only photo publication replays once, conflicts on changed bytes, and preserves exact grading approval');

  const control = { deploymentId: 'local-public-fixture', releaseSha: 'a'.repeat(40), configHash: 'b'.repeat(64) };
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_staff."PublicReaderControl"(id,mode,origin,enabled,revision,"deploymentId","releaseSha","configHash") VALUES('active','LOCAL_FIXTURE','http://127.0.0.1:4319',true,1,$1,$2,$3)`, control.deploymentId, control.releaseSha, control.configHash);
  const claims = { ...control, expiresAt: Date.now() + 60000, request: { kind: 'REPORT', token: plan.binding.publicToken, version: 1, side: null, findingId: null } };
  const replacementBytes = Buffer.from('different synthetic presentation media');
  const reader = createApprovedManualReader({ client: manualClient, artifacts: f.artifacts, storage: {
    readDerivative: async input => ({ bytes: input.fixture === 'replacement object' ? replacementBytes : photoBytes }),
  }, presentationEnabled: true });
  const report = JSON.parse((await reader.read(claims)).bytes); assert.deepEqual(report.presentation, first.presentation); assert.equal(report.packet.report.finalGrade, plan.label.finalGrade);
  const imageClaims = { ...claims, request: { ...claims.request, kind: 'PRESENTATION_IMAGE', presentationRevision: 1 } };
  assert.deepEqual((await reader.read(imageClaims)).bytes, photoBytes);
  assert.equal(await reader.read({ ...imageClaims, request: { ...imageClaims.request, presentationRevision: 2 } }), null);
  const disabled = createApprovedManualReader({ client: manualClient, artifacts: f.artifacts, storage: f.storage });
  assert.equal(JSON.parse((await disabled.read(claims)).bytes).presentation, undefined);
  checks.push('public optional photo uses exact approval/revision/hash; disabled presentation stays absent and wrong revision is not found');

  const marketInput = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 1 };
  const reservations = await Promise.all([1, 2].map(() => presentation.reserveMarket(staff, f.cardId, marketInput)));
  assert.equal(reservations.filter(value => value.created).length, 1);
  assert.equal((await presentation.reserveMarket(staff, f.cardId, marketInput)).created, false);
  await assert.rejects(presentation.reserveMarket(staff, f.cardId, { ...marketInput, expectedRevision: 0 }));
  await assert.rejects(presentation.market(other, f.cardId, marketInput.requestId));
  const marketResult = { state: 'READY', previewId: marketInput.requestId, fixture: 'synthetic provider result; no provider called' };
  await presentation.finishMarket(staff, f.cardId, marketInput.requestId, marketResult);
  await presentation.finishMarket(staff, f.cardId, marketInput.requestId, marketResult);
  await assert.rejects(presentation.finishMarket(staff, f.cardId, marketInput.requestId, { state: 'UNKNOWN' }));
  assert.deepEqual((await presentation.market(staff, f.cardId, marketInput.requestId)).saved, marketResult);
  const uncertainInput = { ...marketInput, requestId: randomUUID() };
  await presentation.reserveMarket(staff, f.cardId, uncertainInput);
  await presentation.finishMarket(staff, f.cardId, uncertainInput.requestId, { state: 'UNKNOWN' });
  const uncertainRetry = await presentation.reserveMarket(staff, f.cardId, uncertainInput);
  assert.equal(uncertainRetry.created, false); assert.equal(uncertainRetry.state, 'UNKNOWN');
  checks.push('concurrent market search reservation authorizes exactly one dispatcher; READY/UNKNOWN are immutable and exact retries never grant redispatch');

  const selectedIds = ['fixture-sold-1'], market = { observedAt: new Date().toISOString(), sales: [{
    id: selectedIds[0], title: 'OWNED FIXTURE ONLY — synthetic sold reference', listingUrl: 'https://www.ebay.com/itm/123456789012',
    grader: 'Fixture grader', grade: '9', soldAt: '2026-09-21T12:00:00.000Z', priceMinor: 10000, currency: 'USD', priceBasis: 'sold',
  }] };
  const marketSource = { version: 'atlas-selected-market-source-v1', previewId: marketInput.requestId, selectedIds,
    fixture: 'synthetic immutable artifact reference' };
  const marketCommit = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 1 };
  const withMarket = await presentation.commit(staff, f.cardId, marketCommit, null, { market, source: marketSource });
  assert.equal(withMarket.revision, 2); assert.deepEqual(withMarket.presentation.market, market);
  assert.equal(withMarket.presentation.slabPhoto.sha256, first.presentation.slabPhoto.sha256);
  assert.match(withMarket.presentation.slabPhoto.url, /revision=2$/);
  const selection = { ...marketCommit, previewId: marketInput.requestId, selectedIds };
  assert.deepEqual(await presentation.marketCommitStatus(staff, f.cardId, selection), withMarket);
  await assert.rejects(presentation.marketCommitStatus(staff, f.cardId, { ...selection, selectedIds: [] }));
  const imageAt = revision => ({ ...imageClaims, request: { ...imageClaims.request, presentationRevision: revision } });
  assert.deepEqual((await reader.read(imageAt(2))).bytes, photoBytes); assert.equal(await reader.read(imageClaims), null);
  assert.deepEqual(JSON.parse((await reader.read(claims)).bytes).presentation.market, market);
  assert.deepEqual(await repository.readApproval(staff, f.cardId, f.actionId), unchangedApproval);
  checks.push('selected market evidence commits separately with exact replay, preserving photo bytes/media and immutable grade while moving the image revision');

  const replacement = { descriptor: { ...photo.descriptor, sha256: digest(replacementBytes), byteCount: replacementBytes.length,
    alt: 'Second owned fixture image' }, media: { fixture: 'replacement object' } };
  const changedPhoto = await presentation.commit(staff, f.cardId, { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 2 }, replacement);
  assert.equal(changedPhoto.revision, 3); assert.deepEqual(changedPhoto.presentation.market, market);
  assert.deepEqual((await reader.read(imageAt(3))).bytes, replacementBytes);
  const [selectedRow] = await fixture.admin.$queryRawUnsafe('SELECT market_source,market_source_hash FROM atlas_manual.presentation WHERE card_id=$1::uuid AND revision=3', f.cardId);
  assert.equal(selectedRow.market_source, canonical(marketSource)); assert.equal(selectedRow.market_source_hash, digest(selectedRow.market_source));
  assert.deepEqual(await presentation.marketCommitStatus(staff, f.cardId, selection), withMarket);
  checks.push('replacing the photo preserves selected market/source hashes; an older exact selection receipt still replays unchanged after later presentation edits');

  const race = await Promise.allSettled([1, 2].map(() => presentation.commit(staff, f.cardId, { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 3 })));
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1); assert.equal(race.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await presentation.status(staff, f.cardId)).revision, 4); assert.equal((await presentation.status(staff, f.cardId)).presentation.slabPhoto, undefined);
  assert.deepEqual((await presentation.status(staff, f.cardId)).presentation.market, market);
  assert.equal(await reader.read(imageClaims), null); assert.deepEqual(await repository.readApproval(staff, f.cardId, f.actionId), unchangedApproval);
  checks.push('two competing photo removals serialize with one CAS winner; old photo URL is withdrawn without modifying grade');

  let offerClock = new Date();
  const offerConfiguration = { directory: { version: 'atlas-dealer-directory-v1', updatedAt: offerClock.toISOString(), dealers: [{
    id: 'owned-fixture-shop', name: 'OWNED FIXTURE ONLY — dealer', authorizedAt: new Date(offerClock.getTime() - 60000).toISOString(), authorizationExpiresAt: null,
    services: ['BUY'], address: { line1: '1 Synthetic Street', city: 'Fixture', region: 'CA', postalCode: '90000', country: 'US' }, position: null,
    website: 'https://example.com/', phone: null, programs: [],
  }] }, offers: { version: 'atlas-dealer-offers-v1', offers: [{ id: 'fixture-offer', dealerId: 'owned-fixture-shop',
    binding: { publicToken: plan.binding.publicToken, approvalVersion: plan.binding.approvalVersion, publicHash: plan.binding.publicHash },
    amountMinor: 3000, currency: 'USD', kind: 'indicative', terms: 'Synthetic dealer terms only. No real commercial commitment.',
    expiresAt: new Date(offerClock.getTime() + 3600000).toISOString(), source: { reference: 'OWNED FIXTURE ONLY — written terms', receivedAt: offerClock.toISOString() },
  }] } };
  const offers = createDealerOfferService({ repository: presentation, approved: finishing,
    loadConfiguration: async () => structuredClone(offerConfiguration), now: () => offerClock });
  const availableOffers = await offers.status(staff, f.cardId);
  assert.equal(availableOffers.offers.length, 1); assert.equal(availableOffers.revision, 4);
  const offerSelection = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 4,
    sourceHash: availableOffers.sourceHash, selectedIds: ['fixture-offer'] };
  const concurrentOffers = await Promise.all([1, 2].map(() => offers.select(staff, f.cardId, offerSelection)));
  assert.deepEqual(concurrentOffers[0], concurrentOffers[1]); assert.equal(concurrentOffers[0].revision, 5);
  const [offerRow] = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.presentation WHERE card_id=$1::uuid AND revision=5', f.cardId);
  const offerSources = JSON.parse(offerRow.market_source);
  assert.deepEqual(offerSources.soldReferences, marketSource); assert.equal(offerSources.dealerOffers.sources[0].reference, 'OWNED FIXTURE ONLY — written terms');
  assert.equal(offerRow.market_source_hash, digest(offerRow.market_source));
  await assert.rejects(offers.select(other, f.cardId, offerSelection));
  await assert.rejects(offers.select(staff, f.cardId, { ...offerSelection, selectedIds: [] }));
  assert.deepEqual(await presentation.marketCommitStatus(staff, f.cardId, selection), withMarket);
  assert.deepEqual(await repository.readApproval(staff, f.cardId, f.actionId), unchangedApproval);
  checks.push('concurrent exact sourced offer publication creates one revision through real reviewer/card authorization; legacy comps source and grade stay immutable');

  const offerReader = createApprovedManualReader({ client: manualClient, artifacts: f.artifacts, storage: f.storage, presentationEnabled: true, dealerOffers: offers });
  const withOffers = JSON.parse((await offerReader.read(claims)).bytes);
  assert.equal(withOffers.presentation.dealerOffers[0].amountMinor, 3000); assert.deepEqual(withOffers.presentation.market, market);
  assert.equal(withOffers.presentation.dealerOffers[0].source, undefined);
  const unchangedPublicHash = digest(JSON.stringify(withOffers.packet)); assert.equal(unchangedPublicHash, plan.binding.publicHash);
  offerConfiguration.offers.offers[0].terms += ' Changed.';
  assert.deepEqual(JSON.parse((await offerReader.read(claims)).bytes).presentation.dealerOffers, []);
  await assert.rejects(offers.select(staff, f.cardId, { ...offerSelection, requestId: randomUUID(), expectedRevision: 5 }), { code: 'DEALER_OFFER_SOURCE_CHANGED' });
  offerConfiguration.offers.offers[0].terms = 'Synthetic dealer terms only. No real commercial commitment.';
  offerConfiguration.directory.dealers[0].contactOnly = true; offerConfiguration.directory.dealers[0].services = [];
  assert.deepEqual((await offers.status(staff, f.cardId)).offers, []);
  assert.deepEqual(JSON.parse((await offerReader.read(claims)).bytes).presentation.dealerOffers, []);
  delete offerConfiguration.directory.dealers[0].contactOnly; offerConfiguration.directory.dealers[0].services = ['BUY'];
  offerClock = new Date(offerClock.getTime() + 3600001);
  const expired = JSON.parse((await offerReader.read(claims)).bytes);
  assert.deepEqual(expired.presentation.dealerOffers, []); assert.equal(digest(JSON.stringify(expired.packet)), unchangedPublicHash);
  assert.deepEqual(await offers.select(staff, f.cardId, offerSelection), concurrentOffers[0]);
  const expiredStatus = await offers.status(staff, f.cardId);
  const removeOffers = { requestId: randomUUID(), approvalActionId: f.actionId, expectedRevision: 5, sourceHash: expiredStatus.sourceHash, selectedIds: [] };
  const removedOffers = await offers.select(staff, f.cardId, removeOffers);
  assert.equal(removedOffers.revision, 6); assert.deepEqual(removedOffers.presentation.dealerOffers, []); assert.deepEqual(removedOffers.presentation.market, market);
  assert.deepEqual(await offers.select(staff, f.cardId, removeOffers), removedOffers);
  checks.push('public reader removes changed/revoked/expired offers without changing report bytes; exact committed replay and explicit removal remain idempotent after expiry');

  for (const table of ['presentation', 'presentation_upload', 'presentation_market']) {
    await assert.rejects(fixture.admin.$executeRawUnsafe(`UPDATE atlas_manual.${table} SET actor_id=$1::uuid WHERE card_id=$2::uuid`, randomUUID(), f.cardId));
    await assert.rejects(fixture.admin.$executeRawUnsafe(`DELETE FROM atlas_manual.${table} WHERE card_id=$1::uuid`, f.cardId));
    const privilege = await fixture.admin.$queryRawUnsafe(`SELECT has_table_privilege('atlas_fixture_public','atlas_manual.${table}','SELECT') AS allowed`);
    assert.equal(privilege[0].allowed, false);
  }
  checks.push('SQL rejects update/delete of photo history and the public web database role has no table access');

  const nextUpload = await presentation.plan(staff, f.cardId, { ...input, requestId: randomUUID(), expectedRevision: 6 });
  const staleMarket = { ...marketInput, requestId: randomUUID(), expectedRevision: 6 };
  await presentation.reserveMarket(staff, f.cardId, staleMarket);
  const nextAction = randomUUID(); await service.execute(staff, f.cardId, { ...approve, actionId: nextAction, expectedRevision: (await service.read(staff, f.cardId)).revision });
  await assert.rejects(presentation.loadUpload(staff, f.cardId, nextUpload.uploadId));
  await publication.publish(staff, f.cardId, nextAction);
  await assert.rejects(presentation.finishMarket(staff, f.cardId, staleMarket.requestId, { state: 'UNKNOWN' }));
  await assert.rejects(presentation.market(staff, f.cardId, marketInput.requestId));
  assert.equal((await presentation.status(staff, f.cardId)).revision, 0);
  assert.deepEqual(await repository.readApproval(staff, f.cardId, f.actionId), unchangedApproval);
  checks.push('a new approval fences prior pending uploads and starts a separate optional presentation without rewriting old approval');
  const result = { status: 'PASS', checks, schema: 'tracked staff migration chain in owned disposable PostgreSQL', paidEffects: 0, hardwareEffects: 0, remoteEffects: 0 };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 }); console.log(JSON.stringify(result));
} finally {
  await fixture.stop(); await copyFile(join(fixture.cluster.directory, 'cleanup.json'), join(output, 'cleanup.json'));
}
