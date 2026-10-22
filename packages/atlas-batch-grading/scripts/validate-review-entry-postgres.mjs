// Explicit disposable local PG17 qualification. No serving import or ambient DB.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../atlas-manual-service/src/contract.mjs';
import { createIntakeRepository, intakeGrantSQL } from '../../atlas-manual-intake/src/repository.mjs';
import { createBatchRepository, batchGrantSQL } from '../src/repository.mjs';
import { BATCH_POLICY, batchAnalysisActionId } from '../src/index.mjs';

const output = process.env.ATLAS_REVIEW_ENTRY_QUALIFICATION, args = process.argv.slice(2);
assert(output && resolve(output) === output, 'Fresh absolute qualification output required');
assert(args.includes('--postgres-bin') && args.includes('--ack-disposable-local-postgres'));
assert(!args.some(arg => ['--serve', '--docker-image', '--ack-disposable-remote-pg17'].includes(arg)));
await mkdir(output, { mode: 0o700 });
const sourceSha256 = {};
for (const [name, relative] of Object.entries({ repository: '../src/repository.mjs', connected: '../../atlas-connected-manual/src/index.mjs',
  startup: '../../../frontend/atlas-app/lib/manual-review-startup.mjs', component: '../../../frontend/atlas-app/components/ManualCards.jsx',
  fixture: './validate-review-entry-postgres.mjs' })) {
  const bytes = await readFile(new URL(relative, import.meta.url)); sourceSha256[name] = digest(bytes);
  await writeFile(resolve(output, `source-used-${name}.txt`), bytes, { mode: 0o600, flag: 'wx' });
}
const fixture = await createOwnedManualFixture(args), checks = [], preservation = [];
let result;
try {
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual') + '\nGRANT USAGE ON SCHEMA atlas_manual_connected TO atlas_fixture_manual;\n'
    + batchGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  const connection = fixture.connect(), admin = fixture.admin;
  const intake = createIntakeRepository({ boundary: connection.boundary, keyPrefix: 'review-entry-synthetic', maxOriginalBytes: 65536 });
  const repository = createBatchRepository({ boundary: connection.boundary, intakeRepository: intake });
  async function login(phone) {
    const boot = await connection.auth.bootstrap(''), initial = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await connection.auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'review-entry-fixture');
    const signed = await connection.auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'review-entry-fixture');
    const staff = await connection.auth.authenticate(`${initial}; ${fixture.config.cookies.session}=${signed.token}`, signed.csrf);
    return { staff, principal: await connection.boundary.transaction(staff, ({ principal }) => principal) };
  }
  const owner = await login('+12025550141'), other = await login('+12025550143');
  async function side(card, sideName) {
    const { upload } = await intake.plan(owner.staff, card.cardId, { requestId: randomUUID(), side: sideName,
      expectedVersion: card.sides[sideName].version, sha256: digest(`synthetic:${randomUUID()}`), byteCount: 16 });
    const verification = { object: { ...upload.plan.object, versionId: `synthetic-${upload.uploadId}` },
      sha256: upload.plan.expected.sha256, byteCount: 16, contentType: 'application/octet-stream' };
    await intake.recordVerification(owner.staff, card.cardId, upload.uploadId, verification);
    return (await intake.recordSource(owner.staff, card.cardId, upload.uploadId, { verificationHash: digest(canonical(verification)),
      source: { photoSourceHash: digest(`synthetic-source:${upload.uploadId}`), ref: { key: `synthetic-only/${upload.uploadId}` } } })).card;
  }
  async function seed({ manualOwner = owner, editors = [] } = {}) {
    let card = (await intake.create(owner.staff, { requestId: randomUUID(), label: 'SYNTHETIC REVIEW ENTRY' })).card;
    card = await side(await side(card, 'FRONT'), 'BACK');
    const draft = { source: { sourceHash: card.sourceHash,
      uploads: Object.fromEntries(['FRONT', 'BACK'].map(name => [name, card.sides[name].upload.uploadId])) }, identity: { playerName: 'SYNTHETIC' } };
    const text = canonical(draft), manual = { cardId: card.cardId, revision: 1, contentHash: digest(text), draft };
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,editors) VALUES($1::uuid,1,$2,$3,$4::uuid,$5::uuid[])',
      card.cardId, text, manual.contentHash, manualOwner.principal.id, editors);
    const { jobs: [job] } = await repository.enqueue(owner.staff, { actionId: randomUUID(), cards: [{ cardId: card.cardId, sourceHash: card.sourceHash }] });
    const evidence = { authority: 'MACHINE_PROPOSAL', sourceHash: card.sourceHash, reportHash: digest('synthetic-three-measured-findings'),
      manualRevision: 1, manualContentHash: manual.contentHash, findingCount: 3 };
    await admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='REVIEW',stage='REPORT',evidence=$2 WHERE key=$1", job.key, canonical(evidence));
    return { card, manual, job, evidence };
  }
  const current = await seed(), stale = await seed(), approved = await seed(), adopted = await seed(),
    acl = await seed({ manualOwner: other, editors: [owner.principal.id] }), discarded = await seed(), replaced = await seed();
  // Queue crowding is synthetic metadata only. No provider or worker runs and
  // these rows are never offered as valid photographs or complete reports.
  const extra = Array.from({ length: 251 }, () => {
    const cardId = randomUUID(), sourceHash = digest(cardId), key = digest(canonical([BATCH_POLICY, cardId, sourceHash]));
    const input = canonical({ policy: BATCH_POLICY, cardId, sourceHash, label: 'SYNTHETIC QUEUE CROWDING', uploads: { FRONT: null, BACK: null } });
    return { card_id: cardId, pair_id: randomUUID(), request_id: randomUUID(), request_hash: digest(cardId), source_hash: sourceHash,
      key, input, input_hash: digest(input), action_id: batchAnalysisActionId(key) };
  });
  await admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
    SELECT card_id::uuid,pair_id::uuid,$2::uuid,request_id::uuid,request_hash,'SYNTHETIC QUEUE CROWDING'
    FROM jsonb_to_recordset($1::jsonb) AS x(card_id text,pair_id text,request_id text,request_hash text)`, JSON.stringify(extra), owner.principal.id);
  await admin.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.batch_grading(key,card_id,source_hash,actor_id,access_version,analysis_action_id,input,input_hash,state,stage,created_at)
    SELECT key,card_id::uuid,source_hash,$2::uuid,$3,action_id::uuid,input,input_hash,'REVIEW','REPORT','2020-01-01'::timestamptz
    FROM jsonb_to_recordset($1::jsonb) AS x(key text,card_id text,source_hash text,action_id text,input text,input_hash text)`, JSON.stringify(extra), owner.principal.id, owner.principal.accessVersion);
  const tables = ['atlas_manual.card', 'atlas_manual.action', 'atlas_manual.approval', 'atlas_manual.publication',
    'atlas_manual_intake.card', 'atlas_manual_intake.upload', 'atlas_manual_intake.discard_request', 'atlas_manual_intake.discarded_card',
    'atlas_manual_connected.batch_grading', 'atlas_manual_connected.batch_request', 'atlas_manual_connected.batch_review',
    'atlas_defect_analysis.run', 'atlas_defect_analysis.receipt', 'atlas_staff."StaffIdentity"', 'atlas_staff."StaffSession"'];
  async function census() {
    const values = {};
    for (const table of tables) values[table] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) value FROM ${table} r`))[0].value;
    return digest(canonical(values, { maxBytes: 8 * 1024 * 1024 }));
  }
  async function reads(name, work) {
    const before = await census(); await work(); assert.equal(await census(), before, `${name}: read changed stored rows`);
    checks.push(name); preservation.push({ name, sha256: before, tableCount: tables.length });
  }
  await reads('exact current source lookup succeeds beyond 250-job queue cap without any writes', async () => {
    const listed = await repository.list(owner.staff); assert.equal(listed.jobs.length, 250); assert(!listed.jobs.some(job => job.key === current.job.key));
    assert.deepEqual(await repository.reviewEntry(owner.staff, current.manual), { key: current.job.key, cardId: current.card.cardId,
      state: 'REVIEW', sourceHash: current.card.sourceHash, manualRevision: 1, manualContentHash: current.manual.contentHash });
  });
  const updated = canonical({ ...stale.manual.draft, humanGeometryConfirmed: true });
  await admin.$executeRawUnsafe('UPDATE atlas_manual.card SET revision=2,content=$2,content_hash=$3 WHERE id=$1::uuid', stale.card.cardId, updated, digest(updated));
  await reads('new human revision is not rebased onto the old machine report; concurrent old view also receives no hint', async () => {
    assert.equal(await repository.reviewEntry(owner.staff, { ...stale.manual, revision: 2, contentHash: digest(updated), draft: JSON.parse(updated) }), null);
    assert.equal(await repository.reviewEntry(owner.staff, stale.manual), null);
  });
  const actionId = randomUUID(), report = canonical({ fixture: 'SYNTHETIC CURRENT APPROVAL' });
  await admin.$executeRawUnsafe("INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,1,2,$4,'{}','{}')",
    approved.card.cardId, actionId, owner.principal.id, digest('{}'));
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1::uuid,$2::uuid,$3::uuid,1,$4,$5,$6)',
    approved.card.cardId, actionId, owner.principal.id, approved.manual.contentHash, digest(report), report);
  const adoptedDraft = { ...adopted.manual.draft, finalReview: { fixture: 'SYNTHETIC SAVED HANDOFF' } }, adoptedText = canonical(adoptedDraft);
  await admin.$executeRawUnsafe('UPDATE atlas_manual.card SET revision=2,content=$2,content_hash=$3 WHERE id=$1::uuid', adopted.card.cardId, adoptedText, digest(adoptedText));
  await reads('current approval and adopted final review retain their history without a new entry', async () => {
    assert.equal(await repository.reviewEntry(owner.staff, approved.manual), null);
    assert.equal(await repository.reviewEntry(owner.staff, { ...adopted.manual, revision: 2, contentHash: digest(adoptedText), draft: adoptedDraft }), null);
  });
  await reads('foreign staff and copied or machine-shaped handles cannot borrow current-card context', async () => {
    assert.equal(await repository.reviewEntry(other.staff, current.manual), null);
    await assert.rejects(repository.reviewEntry({ ...owner.staff }, current.manual), { code: 'SIGN_IN_REQUIRED' });
    await assert.rejects(repository.reviewEntry({ actorKind: 'MACHINE', id: owner.principal.id }, current.manual), { code: 'SIGN_IN_REQUIRED' });
  });
  assert(await repository.reviewEntry(owner.staff, acl.manual));
  await admin.$executeRawUnsafe("UPDATE atlas_manual.card SET editors='{}'::uuid[],readers=$2::uuid[],revision=2 WHERE id=$1::uuid", acl.card.cardId, [owner.principal.id]);
  acl.manual.revision = 2; acl.evidence.manualRevision = 2;
  await admin.$executeRawUnsafe('UPDATE atlas_manual_connected.batch_grading SET evidence=$2 WHERE key=$1', acl.job.key, canonical(acl.evidence));
  await reads('current manual editor revocation removes adoption context even while read access and intake ownership remain', async () => {
    assert.equal(await repository.reviewEntry(owner.staff, acl.manual), null);
  });
  await intake.discard(owner.staff, { requestId: randomUUID(), scope: 'SELECTED', cardIds: [discarded.card.cardId], createRequestIds: [] });
  await side(replaced.card, 'FRONT');
  await reads('tombstoned card and replaced original source refuse the old report entry', async () => {
    await assert.rejects(repository.reviewEntry(owner.staff, discarded.manual), { code: 'INTAKE_CARD_DELETED' });
    await assert.rejects(repository.reviewEntry(owner.staff, replaced.manual), { code: 'BATCH_PHOTOS_CHANGED' });
  });
  const sessionHash = connection.auth.actors.get(owner.staff).sessionHash;
  await admin.$executeRawUnsafe('UPDATE atlas_staff."StaffSession" SET "revokedAt"=clock_timestamp() WHERE "tokenHash"=$1', sessionHash);
  await reads('revoked real session cannot read an otherwise eligible exact entry', async () => {
    await assert.rejects(repository.reviewEntry(owner.staff, current.manual), { code: 'SIGN_IN_REQUIRED' });
  });
  result = { pass: true, checks, preservation, sourceSha256, ownedCluster: fixture.cluster.directory, node: process.version,
    syntheticOnly: true, otherSyntheticJobs: 251, providerCalls: 0, mediaReads: 0, productionQueries: 0, workerStarts: 0 };
} catch (error) {
  result = { pass: false, checks, preservation, sourceSha256, error: { code: error.code, message: error.message }, syntheticOnly: true };
  throw error;
} finally {
  await fixture.stop();
  const cleanupPath = resolve(fixture.cluster.directory, 'cleanup.json'), cleanup = JSON.parse(await readFile(cleanupPath, 'utf8'));
  result = { ...result, stoppedVerified: cleanup.stoppedVerified === true, cleanupPath };
  for (const name of ['cleanup.json', 'validation.log']) {
    await copyFile(resolve(fixture.cluster.directory, name), resolve(output, name)); await chmod(resolve(output, name), 0o600);
  }
  await writeFile(resolve(output, 'postgres-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify(result) + '\n'); assert.equal(result.stoppedVerified, true);
}
