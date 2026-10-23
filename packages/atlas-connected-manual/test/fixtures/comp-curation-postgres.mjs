// Finite disposable native PostgreSQL qualification. Root must log the exact
// command before execution; never imported by serving code or ordinary units.
import assert from 'node:assert/strict';
import { assertRegisteredCompFoundation, captureCompFoundation } from '../../../atlas-standalone-database/test/comp-foundation-fixture.mjs';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOwnedManualFixture } from '../../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../../atlas-manual-service/src/contract.mjs';
import { createIntakeRepository, intakeGrantSQL } from '../../../atlas-manual-intake/src/repository.mjs';
import { publicationFixture } from '../publication-fixture.mjs';
import { createPublicationRepository } from '../../src/publication-repository.mjs';
import { createManualFinishing } from '../../src/finishing.mjs';
import { publishedResearchQuery } from '../../src/research-market-query.mjs';
import { marketPreviewHash } from '../../src/presentation-market.mjs';
import { COMP_CURATION_METHOD, compCurationPolicy } from '../../src/comp-curation-contract.mjs';
import { compCurationGrantSQL, createCompCurationService } from '../../src/comp-curation-service.mjs';

const output = process.env.ATLAS_COMP_CURATION_QUALIFICATION, args = process.argv.slice(2);
assert(output && resolve(output) === output, 'A new absolute qualification output directory is required');
assert(args.includes('--postgres-bin') && args.includes('--ack-disposable-local-postgres'));
assert(!args.some(arg => ['--serve', '--docker-image', '--ack-disposable-remote-pg17'].includes(arg)), 'Finite native local fixture only');
await mkdir(output, { mode: 0o700 });
const foundationSources = await captureCompFoundation(output);
const sourceSha256 = {};
for (const path of ['../../sql/comp-curation-proposal.sql', '../../src/comp-curation-contract.mjs', '../../src/comp-curation-service.mjs', '../comp-curation.test.mjs', './comp-curation-postgres.mjs'])
  sourceSha256[path] = digest(await readFile(new URL(path, import.meta.url)));
const fixture = await createOwnedManualFixture(args), checks = [], preservation = [], waitProofs = [];
let result;
try {
  await fixture.admin.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL search_path=pg_catalog');
    await assertRegisteredCompFoundation(async (sql, ...values) => ({ rows: await tx.$queryRawUnsafe(sql, ...values) }));
  });
  // No publication/market writer grants: the tested service needs these reads
  // plus INSERT on its own receipt table and the existing staff boundary.
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual') + '\n' + compCurationGrantSQL('atlas_fixture_manual')
    + '\nGRANT SELECT ON atlas_manual.publication,atlas_manual.public_report_identity,atlas_manual.presentation_market TO atlas_fixture_manual;', [], fixture.database.name);
  const connection = fixture.connect(), admin = fixture.admin;
  const intake = createIntakeRepository({ boundary: connection.boundary, keyPrefix: 'curation-synthetic', maxOriginalBytes: 65536 });
  const validateAccess = ({ tx, cardId }) => intake.assertActiveInTransaction(tx, cardId);
  const policy = { version: 'atlas-comp-curation-policy-v1', status: 'LOCAL_PROPOSAL', method: COMP_CURATION_METHOD, recencyDays: 90, rightsStatus: 'UNRESOLVED' };
  async function login(phone) {
    const boot = await connection.auth.bootstrap(''), initial = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await connection.auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'curation-fixture');
    const signed = await connection.auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'curation-fixture');
    const cookie = `${initial}; ${fixture.config.cookies.session}=${signed.token}`;
    const staff = await connection.auth.authenticate(cookie, signed.csrf);
    const principal = await connection.boundary.transaction(staff, ({ principal }) => principal);
    return { staff, principal, sessionHash: connection.auth.actors.get(staff).sessionHash };
  }
  const owner = await login('+12025550141'), other = await login('+12025550143');
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  const row = f.row, actionResult = JSON.parse(row.result); actionResult.receipt.actorId = owner.principal.id;
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,approvers) VALUES($1::uuid,11,$2,$3,$4::uuid,$5::uuid[])',
    f.cardId, canonical(f.draft), row.source_hash, owner.principal.id, [other.principal.id]);
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',
    f.cardId, randomUUID(), owner.principal.id, randomUUID(), digest('synthetic-intake'), 'SYNTHETIC CURATION ONLY');
  async function seedApproval(actionId, version, published) {
    const result = structuredClone(actionResult); result.receipt.actionId = actionId;
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)',
      f.cardId, actionId, owner.principal.id, version === 1 ? 10 : 11, version === 1 ? 11 : 12, digest('{}'), '{}', canonical(result));
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report,approved_at) VALUES($1::uuid,$2::uuid,$3::uuid,10,$4,$5,$6,$7::timestamptz)',
      f.cardId, actionId, owner.principal.id, row.source_hash, row.report_hash, row.report, row.approved_at);
    if (version === 1) await admin.$executeRawUnsafe('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)', f.cardId, row.public_token, row.report_number);
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,$3,'LOCAL_FIXTURE')", f.cardId, actionId, version);
    if (published) await publish(actionId, row.manifest, row.public_hash);
  }
  async function publish(actionId, manifest, publicHash) {
    await admin.$executeRawUnsafe("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$1,manifest_hash=$2,public_hash=$3,published_at=clock_timestamp() WHERE card_id=$4::uuid AND action_id=$5::uuid",
      manifest, digest(manifest), publicHash, f.cardId, actionId);
  }
  await seedApproval(f.actionId, 1, true);
  const manifest = JSON.parse(row.manifest), packet = await f.artifacts.read(manifest.packet.ref, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  const previewId = randomUUID(), timestamp = new Date(), preview = { version: 'atlas-market-preview-v1', ...publishedResearchQuery({ packet, publicHash: row.public_hash }),
    source: 'EBAY_SOLD', engineVersion: 'ebay-sold-comps-v2.3.0', retrievedAt: timestamp.toISOString(), candidates: [1000,2001,3000].map((priceMinor, i) => ({
      match: 'MATCH', sale: { id: `ebay:${123456789000 + i}`, title: '2026 Fixture Local only Synthetic report PSA 9',
        listingUrl: `https://www.ebay.com/itm/${123456789000 + i}`, soldAt: new Date(+timestamp - 86400000).toISOString(), identityStatus: 'MATCH',
        priceBasis: 'sold', priceMinor, currency: 'USD', raw: false, grader: 'PSA', grade: '9', designation: 'STANDARD' } })) };
  const artifactHash = digest(JSON.stringify(preview)), ref = await f.artifacts.write(preview, { cardId: f.cardId, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
  const marketRequest = canonical({ requestId: previewId, approvalActionId: f.actionId, expectedRevision: 0 });
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.presentation_market(card_id,approval_action_id,request_id,actor_id,request,request_hash) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',
    f.cardId, f.actionId, previewId, owner.principal.id, marketRequest, digest(marketRequest));
  const marketResult = canonical({ state: 'READY', ref, artifactHash, sourceHash: marketPreviewHash(preview) });
  await admin.$executeRawUnsafe("UPDATE atlas_manual.presentation_market SET state='READY',result=$1,result_hash=$2 WHERE card_id=$3::uuid AND request_id=$4::uuid", marketResult, digest(marketResult), f.cardId, previewId);
  const approved = createManualFinishing({ repository: createPublicationRepository({ boundary: connection.boundary, validateAccess }), artifacts: f.artifacts });
  const service = createCompCurationService({ boundary: connection.boundary, approved, artifacts: f.artifacts, validateAccess, policy });
  const input = (revision, overrides = {}) => ({ requestId: randomUUID(), approvalActionId: f.actionId, expectedSelectionRevision: revision, previewId,
    expectedPreviewHash: marketPreviewHash(preview), outcome: 'SELECTED', selectedIds: preview.candidates.map(c => c.sale.id),
    reviewedIds: preview.candidates.map(c => c.sale.id), expectedPolicyHash: compCurationPolicy(policy).hash, ...overrides });
  const protectedTables = ['atlas_manual.card','atlas_manual.action','atlas_manual.approval','atlas_manual.publication','atlas_manual.public_report_identity',
    'atlas_manual.presentation','atlas_manual.presentation_market','atlas_manual_intake.card','atlas_manual_intake.upload'];
  async function census(selectedTables = protectedTables) {
    const values = {};
    for (const table of selectedTables) values[table] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) value FROM ${table} r`))[0].value;
    return digest(canonical(values, { maxBytes: 2097152 }));
  }
  async function preserved(name, work) {
    const before = await census(); await work(); assert.equal(await census(), before, name);
    checks.push(name); preservation.push({ name, sha256: before, tableCount: protectedTables.length });
  }
  const firstInput = input(0); let first;
  await preserved('actual auth, finishing packet and READY artifact produce one private bound receipt; exact retry is immutable', async () => {
    const state = await service.read(owner.staff, f.cardId, { approvalActionId: f.actionId, previewId }); assert.equal(state.availability, 'READY');
    first = await service.decide(owner.staff, f.cardId, firstInput); assert.equal(first.guidance.meanMinor, 2000); assert.equal(first.revision, 1);
    assert.deepEqual(await service.decide(owner.staff, f.cardId, firstInput), first);
    await assert.rejects(service.decide(other.staff, f.cardId, firstInput), { code: 'COMP_REQUEST_CONFLICT' });
    assert.equal(Number((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual.comp_curation'))[0].n), 1);
  });
  await preserved('actual concurrent revision claims allow one append; same-input retry returns the winning receipt', async () => {
    const requests = [input(1), input(1)], settled = await Promise.allSettled(requests.map(value => service.decide(owner.staff, f.cardId, value)));
    assert.equal(settled.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(settled.find(value => value.status === 'rejected').reason.code, 'COMP_SELECTION_REVISION_STALE');
    const winner = settled.findIndex(value => value.status === 'fulfilled');
    assert.deepEqual(await service.decide(owner.staff, f.cardId, requests[winner]), settled[winner].value);
    assert.equal(Number((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual.comp_curation'))[0].n), 2);
  });
  await preserved('no-pool Skip stays explicit with null guidance', async () => {
    const skipped = await service.decide(owner.staff, f.cardId, input(2, { outcome: 'SKIP', previewId: null, expectedPreviewHash: null, expectedPolicyHash: null, selectedIds: [], reviewedIds: [] }));
    assert.equal(skipped.revision, 3); assert.equal(skipped.guidance, null); assert.equal(skipped.sourceStatus, 'NO_SAVED_POOL');
    assert.equal(skipped.binding.approvalActionId, f.actionId);
  });
  await preserved('database independently refuses history mutation, truncation, stale revision and mismatched approval binding', async () => {
    for (const sql of ['UPDATE atlas_manual.comp_curation SET receipt=receipt', 'DELETE FROM atlas_manual.comp_curation', 'TRUNCATE atlas_manual.comp_curation']) await assert.rejects(admin.$executeRawUnsafe(sql), /immutable/);
    await assert.rejects(admin.$executeRawUnsafe(`INSERT INTO atlas_manual.comp_curation SELECT * FROM atlas_manual.comp_curation LIMIT 1`), /revision conflict/);
    const [original] = await admin.$queryRawUnsafe('SELECT * FROM atlas_manual.comp_curation ORDER BY revision LIMIT 1');
    const wrong = { ...JSON.parse(original.binding), publicHash: 'f'.repeat(64) }, value = canonical(wrong);
    await assert.rejects(admin.$executeRawUnsafe(`INSERT INTO atlas_manual.comp_curation(card_id,approval_action_id,revision,request_id,actor_id,request,request_hash,binding,binding_hash,source,source_hash,selected_facts,selected_facts_hash,receipt,receipt_hash)
      SELECT card_id,approval_action_id,4,$1::uuid,actor_id,request,request_hash,$2,$3,source,source_hash,selected_facts,selected_facts_hash,receipt,receipt_hash FROM atlas_manual.comp_curation ORDER BY revision LIMIT 1`, randomUUID(), value, digest(value)), /approval mismatch/);
  });
  const otherInput = input(3, { outcome: 'NO_SUITABLE_COMPS', previewId: null, expectedPreviewHash: null, expectedPolicyHash: null, selectedIds: [], reviewedIds: [] });
  await service.decide(other.staff, f.cardId, otherInput);
  await admin.$executeRawUnsafe("UPDATE atlas_manual.card SET approvers='{}'::uuid[],revision=revision+1 WHERE id=$1::uuid", f.cardId);
  await preserved('current ACL revocation refuses both replay and read', async () => {
    await assert.rejects(service.decide(other.staff, f.cardId, otherInput), { code: 'MANUAL_CARD_NOT_FOUND' });
    await assert.rejects(service.read(other.staff, f.cardId, { approvalActionId: f.actionId, previewId }), { code: 'MANUAL_CARD_NOT_FOUND' });
  });
  // Current normal staff issuance is persistent. Test real ACL revocation
  // across a lock wait; do not alter immutable expiry or claim a PG expiry test.
  await admin.$executeRawUnsafe('UPDATE atlas_manual.card SET approvers=$1::uuid[],revision=revision+1 WHERE id=$2::uuid', [other.principal.id], f.cardId);
  const [beforeCard] = await admin.$queryRawUnsafe('SELECT * FROM atlas_manual.card WHERE id=$1::uuid', f.cardId);
  let unlock, entered; const ready = new Promise(resolve => { entered = resolve; }), released = new Promise(resolve => { unlock = resolve; });
  const held = admin.$transaction(async tx => { const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() pid');
    await tx.$queryRawUnsafe('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE', f.cardId); entered(pid); await released;
    await tx.$executeRawUnsafe("UPDATE atlas_manual.card SET approvers='{}'::uuid[],revision=revision+1 WHERE id=$1::uuid", f.cardId);
  }, { timeout: 5000 });
  const blocker = await ready; let pending;
  const waitProtected = protectedTables.filter(table => table !== 'atlas_manual.card'), beforeWait = await census(waitProtected);
  try {
    pending = service.decide(other.staff, f.cardId, otherInput).then(value => ({ value }), error => ({ error }));
    const deadline = Date.now() + 700;
    for (;;) {
      const [observed] = await admin.$queryRawUnsafe(`SELECT pid,wait_event_type,pg_blocking_pids(pid) blockers,clock_timestamp() observed_at
        FROM pg_stat_activity WHERE query LIKE '/* curation:card */%' AND $1=ANY(pg_blocking_pids(pid))`, blocker);
      if (observed) {
        const [{ allowed }] = await admin.$queryRawUnsafe('SELECT $1::uuid=ANY(approvers) allowed FROM atlas_manual.card WHERE id=$2::uuid', other.principal.id, f.cardId);
        assert.equal(allowed, true, 'Observe exact waiter while approver access is still valid');
        waitProofs.push({ ...observed, beforeRevocation: true, type: 'MANUAL_APPROVER_ACL' }); break; }
      assert(Date.now() < deadline, 'Exact card wait was not observed'); await new Promise(resolve => setTimeout(resolve, 20));
    }
  } finally { unlock(); await held; }
  const ended = await pending; assert.equal(ended.error?.code, 'MANUAL_CARD_NOT_FOUND'); assert.equal(await census(waitProtected), beforeWait);
  const [afterCard] = await admin.$queryRawUnsafe('SELECT * FROM atlas_manual.card WHERE id=$1::uuid', f.cardId);
  assert.deepEqual(afterCard, { ...beforeCard, revision: beforeCard.revision + 1, approvers: [] });
  assert.equal(Number((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual.comp_curation'))[0].n), 4);
  preservation.push({ name: 'Controlled approver ACL revocation while replay waits', sha256: beforeWait, tableCount: waitProtected.length,
    allowedFixtureChange: 'Exact manual card approvers cleared; revision incremented once' });
  checks.push('actual observed card-lock wait spans approver ACL revocation; replay refused after lock without new receipt');
  await admin.$executeRawUnsafe('UPDATE atlas_staff."StaffSession" SET "revokedAt"=clock_timestamp() WHERE "tokenHash"=$1', other.sessionHash);
  await preserved('real staff session revocation refuses read and idempotent replay', async () => {
    await assert.rejects(service.decide(other.staff, f.cardId, otherInput), { code: 'SIGN_IN_REQUIRED' });
    await assert.rejects(service.read(other.staff, f.cardId, { approvalActionId: f.actionId, previewId }), { code: 'SIGN_IN_REQUIRED' });
  });
  const pendingId = randomUUID(); await seedApproval(pendingId, 2, false);
  await preserved('newer pending publication refuses old approval reads, new curation and idempotent replay', async () => {
    const count = Number((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual.comp_curation'))[0].n);
    await assert.rejects(service.decide(owner.staff, f.cardId, firstInput), { code: 'COMP_APPROVAL_STALE' });
    await assert.rejects(service.decide(owner.staff, f.cardId, input(4)), { code: 'COMP_APPROVAL_STALE' });
    await assert.rejects(service.read(owner.staff, f.cardId, { approvalActionId: f.actionId, previewId }), { code: 'COMP_APPROVAL_STALE' });
    assert.equal(Number((await admin.$queryRawUnsafe('SELECT count(*) n FROM atlas_manual.comp_curation'))[0].n), count);
  });
  const nextPacket = { ...packet, approvalVersion: 2 }, publicHash = digest(JSON.stringify(nextPacket));
  const nextRef = await f.artifacts.write(nextPacket, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: publicHash });
  await publish(pendingId, canonical({ ...manifest, packet: { ref: nextRef, sourceHash: publicHash }, publicHash }), publicHash);
  await preserved('new actual published approval invalidates old selection and old replay without rewriting history', async () => {
    await assert.rejects(service.decide(owner.staff, f.cardId, firstInput), { code: 'COMP_APPROVAL_STALE' });
    await assert.rejects(service.read(owner.staff, f.cardId, { approvalActionId: f.actionId, previewId }), { code: 'COMP_APPROVAL_STALE' });
  });
  await intake.discard(owner.staff, { requestId: randomUUID(), scope: 'SELECTED', cardIds: [f.cardId], createRequestIds: [] });
  await preserved('actual intake tombstone remains an independent access fence', async () => {
    await assert.rejects(service.read(owner.staff, f.cardId, { approvalActionId: pendingId, previewId: null }), { code: 'INTAKE_CARD_DELETED' });
  });
  result = { pass: true, checks, preservation, waitProofs, protectedTables, sourceSha256, node: process.version,
    syntheticOnly: true, actualTimeExpiryQualified: false, currentPersistentStaffSessions: true,
    productionQueries: 0, providerCalls: 0, notificationEffects: 0, financialEffects: 0, ownedCluster: fixture.cluster.directory };
} catch (error) {
  result = { pass: false, checks, preservation, waitProofs, sourceSha256, syntheticOnly: true,
    error: { name: error.name, code: error.code, message: error.message }, productionQueries: 0, providerCalls: 0 }; throw error;
} finally {
  await fixture.stop();
  const cleanupPath = resolve(fixture.cluster.directory, 'cleanup.json'), cleanup = JSON.parse(await readFile(cleanupPath, 'utf8'));
  result = { ...result, foundationSources, stoppedVerified: cleanup.stoppedVerified === true, cleanupPath };
  await copyFile(cleanupPath, resolve(output, 'cleanup.json')); await chmod(resolve(output, 'cleanup.json'), 0o600);
  await copyFile(resolve(fixture.cluster.directory, 'validation.log'), resolve(output, 'harness-validation.log'));
  await writeFile(resolve(output, 'postgres-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify(result) + '\n'); assert.equal(result.stoppedVerified, true);
}
