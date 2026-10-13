// Finite owned local PostgreSQL qualification. No existing DB, provider, or production I/O.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createManualService } from '@atlas/manual-service';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createVariantJobStore, variantJobGrantSQL, variantBinding, variantJobKey,
  variantIdentityHash, variantCatalogIdentity, VARIANT_POLICY } from '../src/variant-job-store.mjs';
import { createVariantReviewService } from '../src/variant-service.mjs';
import { variantCatalog as catalog, variantCandidate as candidate } from '../test/variant-fixture.mjs';

const output = process.env.ATLAS_HUMAN_VARIANT_EVIDENCE;
assert(output && resolve(output) === output, 'An absolute evidence directory is required');
await mkdir(output, { recursive: true, mode: 0o700 });
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; assert.fail('This fixture never makes an external request'); };
const checks = [];
const identity = parallel => ({ cardName: 'Magikarp', year: '2020', productSet: 'Rebel Clash',
  cardNumber: '039/192', parallel, layoutType: 'POKEMON' });
const constraints = async sql => (await sql("SELECT conname,contype,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='atlas_manual_connected.variant_confirmation'::regclass ORDER BY conname")).rows;
const columns = async sql => (await sql("SELECT attname,attnotnull FROM pg_attribute WHERE attrelid='atlas_manual_connected.variant_confirmation'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum")).rows;
async function seedReadyJob(sql, card, actorId, accessVersion = 1) {
  const input = { ...variantBinding(card), identity: variantCatalogIdentity('POKEMON', card.draft.identity) }, key = variantJobKey(input);
  const text = canonical(input), result = canonical({ catalog, suggestion: null }, { maxBytes: 2097152 });
  await sql('INSERT INTO atlas_manual_connected.variant_job(key,card_id,actor_id,access_version,policy,source_hash,identity_revision,identity_hash,input,input_hash) VALUES($1,$2::uuid,$3::uuid,$4::int,$5,$6,$7::int,$8,$9,$10)',
    [key, card.cardId, actorId, accessVersion, VARIANT_POLICY, input.sourceHash, input.identityRevision, input.identityHash, text, digest(text)]);
  await sql("UPDATE atlas_manual_connected.variant_job SET state='READY',catalog=$2,catalog_hash=$3,result=$4,result_hash=$5 WHERE key=$1",
    [key, canonical(catalog, { maxBytes: 1048576 }), catalog.snapshotHash, result, digest(result)]);
  return { key, resultHash: digest(result), catalogHash: catalog.snapshotHash };
}
const fixture = await createOwnedManualFixture(process.argv.slice(2));
const connection = fixture.connect({ manualConnectionLimit: 1 });
let result;
try {
  await fixture.cluster.sql(variantJobGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  const { auth, boundary, manualClient } = connection;
  async function login(phone) {
    const boot = await auth.bootstrap(''), browser = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(browser, boot.csrf, { phone, requestId: randomUUID() }, 'human-variant-fixture');
    const verified = await auth.verify(browser, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'human-variant-fixture');
    return auth.authenticate(`${browser}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  }
  const staff = await login('+12025550141'), other = await login('+12025550142');
  const principal = await boundary.transaction(staff, async ({ principal }) => principal);
  const store = createVariantJobStore({ boundary: { ...boundary, machineTransaction: async () => assert.fail('Human confirmation never dispatches machine work') } });
  const repository = createManualRepository({ boundary, validateCommit: context => store.validateCommit(context) });
  // A metadata-only reducer isolates the real auth, CAS, immutable action,
  // variant service/store and SQL constraints; it makes no grading claim.
  const service = createManualService({ repository, reduce: async ({ card, action }, staff) => {
    const { identity } = await store.resolve(staff, card, action);
    return { ...card.draft, identity, identityRevision: card.draft.identityRevision + (variantIdentityHash(identity) === variantIdentityHash(card.draft.identity) ? 0 : 1) };
  } });
  const review = createVariantReviewService({ store, workflow: { service } });
  const sql = async (query, values = []) => ({ rows: await fixture.admin.$queryRawUnsafe(query, ...values) });
  assert.equal((await columns(sql)).find(row=>row.attname==='analysis_action_id').attnotnull,false);
  assert.equal((await constraints(sql)).some(row=>row.conname==='variant_confirmation_check1'),false);
  const countAnalysis = async () => (await fixture.admin.$queryRawUnsafe('SELECT count(*)::int n FROM atlas_defect_analysis.run'))[0].n;
  assert.equal(await countAnalysis(), 0);
  async function seed(parallel = null) {
    const cardId = randomUUID(), requestId = randomUUID();
    await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',
      cardId, randomUUID(), principal.id, requestId, digest(requestId), 'Synthetic human variant qualification');
    return repository.provision(staff, { cardId, draft: { source: { sourceHash: digest(cardId) }, identityRevision: 1, identity: identity(parallel),
      geometry: { syntheticPreservedReference: digest('geometry:' + cardId) }, defects: { syntheticPreservedReference: digest('findings:' + cardId) } } });
  }
  const inputFor = (status, fields) => ({ actionId: randomUUID(), expectedRevision: status.revision, sourceHash: status.sourceHash,
    identityRevision: status.identityRevision, identityHash: status.identityHash, jobId: null, resultHash: null,
    decision: 'MANUAL', candidateId: null, reviewed: true, ...fields });
  for (const parallel of ['Base', 'English Cosmos Holo']) {
    const card = await seed(), before = structuredClone(card.draft), status = await review.status(staff, card.cardId);
    await assert.rejects(review.status(other, card.cardId), { code: 'MANUAL_CARD_NOT_FOUND' });
    const input = inputFor(status, { manualParallel: parallel });
    const saved = await review.confirm(staff, card.cardId, input);
    assert.equal(saved.approvalReady, true); assert.equal(saved.reason, null); assert.equal(saved.confirmation.observedFeatures, null);
    assert.equal(saved.confirmation.decision, 'MANUAL'); assert.equal(saved.identityRevision, 2);
    const current = await service.read(staff, card.cardId);
    assert.deepEqual(current.draft.geometry, before.geometry); assert.deepEqual(current.draft.defects, before.defects);
    assert.deepEqual(current.draft.source, before.source); assert.equal(current.draft.identity.parallel, parallel);
    await store.assertApproval(staff, current);
    assert.deepEqual(await review.confirm(staff, card.cardId, input), saved);
    const [stored] = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.variant_confirmation WHERE action_id=$1::uuid', input.actionId);
    assert.equal(stored.analysis_action_id, null); assert.equal(stored.observed_features, null); assert.equal(stored.reprocess_required, false);
    const [recorded] = await fixture.admin.$queryRawUnsafe('SELECT request,result FROM atlas_manual.action WHERE action_id=$1::uuid', input.actionId);
    assert.equal(Object.hasOwn(JSON.parse(recorded.request).action, 'observedFeatures'), false);
    assert.equal(JSON.parse(recorded.result).card.draft.identity.parallel, parallel);
    const [retiredContribution] = await fixture.admin.$queryRawUnsafe("SELECT to_regclass('atlas_manual_connected.variant_contribution') IS NOT NULL AS exists");
    if(retiredContribution.exists){const [contributions] = await fixture.admin.$queryRawUnsafe('SELECT count(*)::int count FROM atlas_manual_connected.variant_contribution WHERE action_id=$1::uuid', input.actionId);assert.equal(contributions.count, 0);}
    await assert.rejects(review.confirm(staff, card.cardId, { ...input, manualParallel: 'Changed replay' }), { code: 'MANUAL_ACTION_ID_CONFLICT' });
    await assert.rejects(review.confirm(staff, card.cardId, { ...input, actionId: randomUUID() }), { code: 'MANUAL_DRAFT_STALE' });
    checks.push(`MANUAL ${parallel} commits without notes or analysis, retains geometry/findings/photos, and replays one immutable action`);
  }
  const selectedCard = await seed('Holo');
  const job = await seedReadyJob(sql, selectedCard, principal.id, principal.accessVersion);
  const jobBefore = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.variant_job WHERE key=$1', job.key);
  const selectedStatus = await review.status(staff, selectedCard.cardId);
  const selectedInput = inputFor(selectedStatus, { decision: 'SELECTED', jobId: job.key, resultHash: job.resultHash, candidateId: candidate.candidateId });
  const selected = await review.confirm(staff, selectedCard.cardId, selectedInput);
  assert.equal(selected.approvalReady, true); assert.equal(selected.confirmation.candidateId, candidate.candidateId);
  assert.equal(selected.confirmation.observedFeatures, null);
  assert.equal((await service.read(staff, selectedCard.cardId)).draft.identity.parallel, 'Reverse Holo');
  assert.deepEqual(await review.confirm(staff, selectedCard.cardId, selectedInput), selected);
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.variant_job WHERE key=$1', job.key), jobBefore);
  const changedInput = inputFor(selected, { manualParallel: 'Base' });
  const changed = await review.confirm(staff, selectedCard.cardId, changedInput);
  assert.equal(changed.approvalReady, true); assert.equal(changed.identityRevision, selected.identityRevision + 1);
  assert.equal(await countAnalysis(), 0);
  checks.push('SELECTED exact catalog printing and later MANUAL correction work with no notes/AI and preserve the saved catalog result');
  const unresolvedCard = await seed(), unresolvedStatus = await review.status(staff, unresolvedCard.cardId);
  const held = await review.confirm(staff, unresolvedCard.cardId, inputFor(unresolvedStatus, { decision: 'UNRESOLVED' }));
  assert.equal(held.approvalReady, false);
  await assert.rejects(store.assertApproval(staff, await service.read(staff, unresolvedCard.cardId)), { code: 'VARIANT_CONFIRMATION_REQUIRED' });
  const noBinding = inputFor(held, { manualParallel: 'Base', sourceHash: digest('wrong-photo-pair') });
  await assert.rejects(review.confirm(staff, unresolvedCard.cardId, noBinding), { code: 'VARIANT_SOURCE_STALE' });
  await assert.rejects(review.confirm(staff, unresolvedCard.cardId, { ...noBinding, actionId: randomUUID(), sourceHash: held.sourceHash, identityHash: digest('wrong-identity') }), { code: 'VARIANT_IDENTITY_STALE' });
  checks.push('unresolved and wrong-source/identity commands do not fabricate a physical variant confirmation');
  const confirmationBefore=await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.variant_confirmation WHERE action_id=$1::uuid',selectedInput.actionId);
  const actionBefore=await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.action WHERE action_id=$1::uuid',selectedInput.actionId);
  await assert.rejects(fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.variant_confirmation SET observed_features='changed' WHERE action_id=$1::uuid", selectedInput.actionId));
  await assert.rejects(fixture.admin.$executeRawUnsafe('DELETE FROM atlas_manual.action WHERE action_id=$1::uuid', selectedInput.actionId));
  await assert.rejects(manualClient.$executeRawUnsafe("UPDATE atlas_manual_connected.variant_confirmation SET decision='MANUAL' WHERE action_id=$1::uuid", selectedInput.actionId));
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.variant_confirmation WHERE action_id=$1::uuid',selectedInput.actionId),confirmationBefore);
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.action WHERE action_id=$1::uuid',selectedInput.actionId),actionBefore);
  const noAction = inputFor(held, { manualParallel: 'Base' });
  await assert.rejects(fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual_connected.variant_confirmation(card_id,action_id,actor_id,source_hash,identity_revision,identity_hash,decision,reprocess_required) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,\'MANUAL\',false)',
    unresolvedCard.cardId, noAction.actionId, principal.id, held.sourceHash, held.identityRevision, held.identityHash));
  await assert.rejects(fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual_connected.variant_confirmation(card_id,action_id,actor_id,source_hash,identity_revision,identity_hash,decision,reprocess_required) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,\'SELECTED\',false)',
    unresolvedCard.cardId, randomUUID(), principal.id, held.sourceHash, held.identityRevision, held.identityHash), error => error.meta?.code === '23514');
  checks.push('saved confirmation/actions remain byte-for-byte; immutable triggers, exact-action FK and SELECTED catalog constraint enforce');
   assert.equal(await countAnalysis(), 0); assert.equal(networkCalls, 0);
  const [currentRole] = await manualClient.$queryRawUnsafe('SELECT current_user AS role');
  result = { status: 'PASS', groups: checks.length, checks, schemaMode:'standalone',schemaSource:fixture.cluster.source, humanRole: currentRole.role,
    analysisRuns: 0, providerCalls: 0, productionCalls: 0, metadataOnlyQualification: true, fixtureDirectory: fixture.cluster.directory };
} finally {
  await connection.close(); await fixture.stop();
}
const cleanup = JSON.parse(await readFile(join(fixture.cluster.directory, 'cleanup.json'), 'utf8'));
assert.equal(cleanup.stoppedVerified, true); assert.equal(cleanup.removed, 'owned regenerable database files');
await writeFile(join(output, 'result.json'), JSON.stringify({ ...result, cleanup }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ status: result.status, groups: result.groups, schemaMode: result.schemaMode,
  providerCalls: 0, productionCalls: 0, cleanup, evidence: join(output, 'result.json') }));
