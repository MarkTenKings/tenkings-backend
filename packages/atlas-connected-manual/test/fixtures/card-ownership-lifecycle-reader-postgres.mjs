import { assertRegisteredOwnershipFoundation, captureOwnershipFoundation } from '../../../atlas-standalone-database/test/ownership-foundation-fixture.mjs';
// Explicit owned local PostgreSQL17 qualification; never auto-run or imported.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '../../../../frontend/atlas-app/.generated/staff-database/index.js';
import { CustomerAuth } from '../../../../frontend/atlas-customer/lib/server/auth.mjs';
import { CustomerDatabase } from '../../../../frontend/atlas-customer/lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../../../../frontend/atlas-customer/lib/server/fixture.mjs';
import { createOwnedManualFixture } from '../../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../../atlas-manual-service/src/contract.mjs';
import { createCardOwnershipEvidenceService, cardOwnershipEvidenceGrantSQL } from '../../src/card-ownership-evidence-service.mjs';
import { createCardOwnershipLifecycleService, createOwnershipProofObjectGateway, cardOwnershipLifecycleGrantSQL } from '../../src/card-ownership-lifecycle-service.mjs';
import { OWNERSHIP_PROOF_VALIDATORS } from '../../src/card-ownership-proof-contract.mjs';
import { createCardOwnershipLifecycleReadService, cardOwnershipLifecycleReadGrantSQL } from '../../src/card-ownership-lifecycle-read-service.mjs';

const output = process.env.ATLAS_LIFECYCLE_READER_QUALIFICATION;
assert(output && resolve(output) === output, 'Absolute NEW evidence directory required');
assert(!process.argv.some(v => ['--serve', '--docker-image', '--ack-disposable-remote-pg17'].includes(v)), 'Local finite binary fixture only');
await mkdir(output, { mode: 0o700 });
const sources = {}, sourceSha256 = {};
for (const path of ['sql/card-ownership-proposal.sql', 'sql/card-ownership-evidence-proposal.sql', 'sql/card-ownership-workflow-reader-proposal.sql',
  'sql/card-ownership-proof-objects-proposal.sql', 'sql/card-ownership-lifecycle-successor-proposal.sql', 'sql/card-ownership-lifecycle-reader-proposal.sql',
  'src/card-ownership-lifecycle-read-contract.mjs', 'src/card-ownership-lifecycle-read-service.mjs', 'test/card-ownership-lifecycle-read.test.mjs']) {
  sources[path] = await readFile(new URL('../../' + path, import.meta.url), 'utf8'); sourceSha256[path] = digest(sources[path]);
  await writeFile(resolve(output, 'source-used-' + path.replaceAll('/', '_')), sources[path], { flag: 'wx', mode: 0o600 });
}
for (const [path, sha] of [['sql/card-ownership-proposal.sql', '00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2'],
  ['sql/card-ownership-evidence-proposal.sql', 'ba9171cae508f2561ed6c71d9231fdcc885c67f9980d6c771f92d275ecf1aa1d'],
  ['sql/card-ownership-proof-objects-proposal.sql', '0bf8dfd062fa36e7f0ac29c12a3d6248620e03a30cbd688081ee04539a1f6a8a'],
  ['sql/card-ownership-lifecycle-successor-proposal.sql', 'e4cd3109efff541670c23ef815a8eeab24122dbe4b669f5eae872e1b6cd8b1eb']]) assert.equal(sourceSha256[path], sha);
const fixtureSource = await readFile(new URL(import.meta.url), 'utf8');
sourceSha256['test/fixtures/card-ownership-lifecycle-reader-postgres.mjs'] = digest(fixtureSource);
await writeFile(resolve(output, 'fixture-used.mjs'), fixtureSource, { flag: 'wx', mode: 0o600 });
await captureOwnershipFoundation(output);
const fixture = await createOwnedManualFixture(process.argv.slice(2)), clients = [], checks = [], preservationProofs = [], waitProofs = [];
let result;
try {
  const admin = fixture.admin;
  await assertRegisteredOwnershipFoundation(sql => fixture.cluster.sql(sql, [], fixture.database.name));
  for (const path of Object.keys(sources).filter(p => p.endsWith('.sql') && p !== 'sql/card-ownership-proposal.sql')) await fixture.cluster.sql(sources[path], [], fixture.database.name);
  const staffConnection = fixture.connect(), staffAuth = staffConnection.auth;
  const staffBoot = await staffAuth.bootstrap(''), staffInitial = `${fixture.config.cookies.browser}=${staffBoot.browserToken}`;
  const staffChallenge = await staffAuth.send(staffInitial, staffBoot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'reader-fixture');
  const staffSigned = await staffAuth.verify(staffInitial, staffBoot.csrf, { challengeId: staffChallenge.challengeId, code: '424242' }, 'reader-fixture');
  const staffCookie = `${staffInitial}; ${fixture.config.cookies.session}=${staffSigned.token}`;
  const staffActor = await staffAuth.authenticate(staffCookie, staffSigned.csrf);
  const principal = await staffConnection.boundary.transaction(staffActor, ({ principal }) => principal);
  const authClient = new PrismaClient({ datasources: { db: { url: fixture.database.customerUrl } } }); clients.push(authClient);
  const config = localConfig({ databaseUrl: fixture.database.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
  const auth = new CustomerAuth({ database: new CustomerDatabase(authClient, config), config, provider: fixtureProvider(config) });
  await admin.$executeRawUnsafe('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)', config.mode, config.origin, config.deploymentId, config.releaseSha, config.configHash);
  async function login(phone) {
    const boot = await auth.bootstrap('', 'reader-fixture'), initial = `${config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'reader-fixture');
    const signed = await auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'reader-fixture');
    return { ...signed, cookie: `${initial}; ${config.cookies.session}=${signed.token}` };
  }
  const owner = await login('+12025550361'), other = await login('+12025550362'), self = await login('+12025550141'), expiring = await login('+12025550363');
  async function restricted(role, grant) {
    const password = randomBytes(24).toString('hex');
    await fixture.cluster.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await fixture.cluster.sql(grant(role), [], fixture.database.name);
    const url = new URL(fixture.database.adminUrl); url.username = role; url.password = password;
    const client = new PrismaClient({ datasources: { db: { url: url.href } } }); clients.push(client); return client;
  }
  const readerRole = 'atlas_fixture_lifecycle_reader', readerClient = await restricted(readerRole, cardOwnershipLifecycleReadGrantSQL);
  const writerClient = await restricted('atlas_fixture_lifecycle_writer', r => cardOwnershipLifecycleGrantSQL(r, 'CUSTOMER'));
  const ingestorClient = await restricted('atlas_fixture_proof_ingestor', r => cardOwnershipLifecycleGrantSQL(r, 'INGESTOR'));
  const evidenceClient = await restricted('atlas_fixture_evidence_writer', r => cardOwnershipEvidenceGrantSQL(r, 'CUSTOMER'));
  const reviewerClient = await restricted('atlas_fixture_evidence_reviewer', r => cardOwnershipEvidenceGrantSQL(r, 'REVIEWER'));
  const writer = createCardOwnershipLifecycleService({ auth, client: writerClient, audience: 'CUSTOMER' });
  const objects = createOwnershipProofObjectGateway({ customerAuth: auth, client: ingestorClient });
  const evidence = createCardOwnershipEvidenceService({ auth, client: evidenceClient, audience: 'CUSTOMER' });
  const reviewer = createCardOwnershipEvidenceService({ auth: staffAuth, client: reviewerClient, audience: 'REVIEWER' });
  const managementUI = { enabled: true, policyNotice: 'SYNTHETIC fixture only. No operational proof policy is selected.', proofKinds: [{ code: 'FIXTURE_CLAIM', label: 'Synthetic proof' }], proofPreparation: null };
  const reader = createCardOwnershipLifecycleReadService({ customerAuth: auth, client: readerClient, uiConfig: managementUI });
  const read = (action, input, who = owner) => reader.read(who.cookie, action, input);
  const call = (action, input, who = owner) => writer.call(who.cookie, who.csrf, action, input);
  async function publish(c, version = 1, published = true) {
    const actionId = randomUUID(), report = canonical({ version: 'atlas-manual-report-snapshot-v2', identity: { playerName: 'SYNTHETIC lifecycle reader' }, finalGrade: 9 });
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,$5,$5+1,$4,'{}','{}')", c.id, actionId, principal.id, digest('{}'), version);
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1::uuid,$2::uuid,$3::uuid,$7,$4,$5,$6)', c.id, actionId, principal.id, digest('synthetic-source'), digest(report), report, version);
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,$3,'LOCAL_FIXTURE')", c.id, actionId, version);
    if (published) await admin.$executeRawUnsafe("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest='{}',manifest_hash=$1,public_hash=$2,published_at=clock_timestamp() WHERE card_id=$3::uuid AND action_id=$4::uuid", digest('{}'), digest('public-' + actionId), c.id, actionId);
    return { actionId, version };
  }
  async function seed(published = true) {
    const c = { id: randomUUID(), createId: randomUUID(), cert: 'ATLAS-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase() };
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'SYNTHETIC lifecycle reader')", c.id, randomUUID(), principal.id, c.createId, digest(c.createId));
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,'{}',$2,$3::uuid)", c.id, digest('{}'), principal.id);
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)', c.id, 'ar_' + randomUUID().replaceAll('-', '').slice(0, 24), c.cert);
    return { ...c, published: await publish(c, 1, published) };
  }
  const main = await seed(), legacy = await seed(), titled = await seed(), waitCard = await seed(), unpublished = await seed(false), discarded = await seed();
  const pending = await publish(main, 2, false);
  const protectedTables = ['atlas_manual.card', 'atlas_manual.action', 'atlas_manual.approval', 'atlas_manual.publication', 'atlas_manual.public_report_identity',
    'atlas_manual_intake.card', 'atlas_manual_intake.discard_request', 'atlas_manual_intake.discarded_card', 'atlas_dealer.custody_event', 'atlas_dealer.manual_card_link',
    'atlas_customer."CommerceOrder"', 'atlas_customer."CommercePayment"', 'atlas_customer."CustomerControl"', 'atlas_customer."CustomerAccount"', 'atlas_customer."CustomerBrowser"', 'atlas_customer."CustomerSession"',
    'atlas_staff."StaffIdentity"', 'atlas_staff."StaffBrowser"', 'atlas_staff."StaffSession"', 'atlas_ownership.event', 'atlas_ownership.reviewer_authority',
    'atlas_ownership_evidence.policy', 'atlas_ownership_evidence.reviewer_grant', 'atlas_ownership_evidence.reviewer_revocation', 'atlas_ownership_evidence.object', 'atlas_ownership_evidence.manifest', 'atlas_ownership_evidence.event_link', 'atlas_ownership_evidence.event_guard',
    'atlas_ownership_proof.policy', 'atlas_ownership_proof.bundle', 'atlas_ownership_proof.object', 'atlas_ownership_proof.upload_lease', 'atlas_ownership_proof.retained', 'atlas_ownership_proof.consumption', 'atlas_ownership_lifecycle.transition', 'atlas_ownership_lifecycle.event_guard'];
  async function census() {
    const all = {}; for (const table of protectedTables) all[table] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) value FROM ${table} t`))[0].value;
    // SQL returns jsonb objects and rows in deterministic order. Hash every
    // field; grading-document canonical() deliberately forbids keys like pixels.
    return digest(JSON.stringify(all));
  }
  async function unchanged(name, fn) { const before = await census(); await fn(); assert.equal(await census(), before); preservationProofs.push({ name, tables: protectedTables.length, sha256: before }); }
  await unchanged('disabled default and current published target', async () => {
    const target = await read('resolve_certificate', { certificateNumber: main.cert }); assert.equal(target.canSubmit, false); assert.equal(target.card.approvalActionId, main.published.actionId); assert.equal(target.card.report.version, 1); assert.notEqual(target.card.approvalActionId, pending.actionId);
    assert.equal((await reader.configuration(owner.cookie)).canPrepareEvidence, false);
    const unset = createCardOwnershipLifecycleReadService({ customerAuth: auth, client: readerClient });
    await assert.rejects(unset.configuration(owner.cookie), { code: 'OWNERSHIP_LIFECYCLE_CONFIGURATION_UNAVAILABLE' });
    assert.equal((await reader.readAccess(owner.cookie)).accountId, owner.customer.id);
    await assert.rejects(read('resolve_certificate', { certificateNumber: unpublished.cert }), { code: 'OWNERSHIP_NOT_FOUND' });
    assert.deepEqual((await read('list_claims', { afterClaimId: null, limit: 50 })).claims, []);
  });
  checks.push('actual installed reader defaults to no proof preparation; explicit management config and live access; latest PUBLISHED binding retained despite newer PENDING, unpublished target refused');
  await admin.$executeRawUnsafe("UPDATE atlas_ownership_evidence.policy SET enabled=true,revision=1,accepted_claim_kinds=ARRAY['FIXTURE_CLAIM'],accepted_review_kinds=ARRAY['FIXTURE_REVIEW'],policy_reference='SYNTHETIC ONLY',retention_reference='SYNTHETIC ONLY',retention_seconds=3600,valid_until=clock_timestamp()+interval '1 hour' WHERE id='active'");
  const validators = Object.entries(OWNERSHIP_PROOF_VALIDATORS.versions).map(([mime, decoderVersion]) => ({ recipe: OWNERSHIP_PROOF_VALIDATORS.recipe, decoderVersion, mime }));
  await admin.$executeRawUnsafe("UPDATE atlas_ownership_proof.policy SET enabled=true,revision=1,accepted_formats=ARRAY['image/png'],validators=$1::jsonb,policy_reference='SYNTHETIC ONLY',deletion_reference='SYNTHETIC ONLY NO DELETE',delete_after_seconds=7200,valid_until=clock_timestamp()+interval '1 hour' WHERE id='active'", JSON.stringify(validators));
  const policyHash = (await admin.$queryRawUnsafe('SELECT atlas_ownership_proof.digest(atlas_ownership_proof.policy_snapshot()) hash'))[0].hash;
  const preparedReader = createCardOwnershipLifecycleReadService({ customerAuth: auth, client: readerClient, uiConfig: { ...managementUI, proofPreparation: { policyHash, formats: ['image/png'], storageOrigin: 'https://proof.invalid', storagePathPrefix: '/fixture/' } } });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/a7X8AAAAASUVORK5CYII=', 'base64');
  const oldSubmit = (c, who = owner) => evidence.submit(who.cookie, who.csrf, { requestId: randomUUID(), cardId: c.id, expectedOwnershipRevision: 0, proofKind: 'FIXTURE_CLAIM' }, png);
  const legacyClaim = await oldSubmit(legacy), titleClaim = await oldSubmit(titled);
  const binding = async c => (await admin.$queryRawUnsafe('SELECT atlas_ownership_workflow.card_binding($1::uuid,$2) value', c.id, config.mode))[0].value;
  async function bundle(c, who = owner) {
    const bound = await binding(c), reservation = await call('reserve_bundle', { requestId: randomUUID(), certificateNumber: c.cert, expectedPublishedBinding: bound, proofKind: 'FIXTURE_CLAIM', files: [{ clientFileId: randomUUID(), sha256: digest('SYNTHETIC ORIGINAL'), byteCount: 1024, declaredType: 'image/png' }] }, who);
    const ids = { bundleId: reservation.bundle.bundleId, objectId: reservation.bundle.files[0].objectId }, p = await objects.readPlan(who.cookie, who.csrf, ids);
    await objects.retainObject(who.cookie, who.csrf, ids, { schema: 'atlas-ownership-proof-object-observation-v2', planHash: p.planHash,
      object: { key: p.key, versionId: 'synthetic-version', etag: '"synthetic-etag"' }, sha256: p.sha256, byteCount: p.byteCount, contentType: 'application/octet-stream',
      validation: { recipe: OWNERSHIP_PROOF_VALIDATORS.recipe, decoderVersion: OWNERSHIP_PROOF_VALIDATORS.versions[p.declaredType], mime: p.declaredType, width: 32, height: 32, pixels: 1024, originalSha256: p.sha256, originalByteCount: p.byteCount } });
    return ids.bundleId;
  }
  const initialBundle = await bundle(main), submitted = await call('submit_claim', { requestId: randomUUID(), bundleId: initialBundle, expectedOwnershipRevision: 0 });
  const competingBundle = await bundle(main, other), competing = await call('submit_claim', { requestId: randomUUID(), bundleId: competingBundle, expectedOwnershipRevision: 0 }, other);
  const claimId = submitted.receipt.claimId;
  await unchanged('own versus foreign claims and target', async () => {
    assert.equal((await preparedReader.configuration(owner.cookie)).canPrepareEvidence, true);
    const first = await read('list_claims', { afterClaimId: null, limit: 1 }); assert(first.nextClaimId); const rest = await read('list_claims', { afterClaimId: first.nextClaimId, limit: 50 });
    const all = [...first.claims, ...rest.claims]; assert.equal(all.length, 3); assert(all.some(c => c.claimId === claimId)); assert(!all.some(c => c.claimId === competing.receipt.claimId));
    await assert.rejects(read('read_claim', { claimId }, other), { code: 'OWNERSHIP_CLAIM_NOT_FOUND' });
    await assert.rejects(read('list_history', { claimId, afterRevision: 0, limit: 50 }, other), { code: 'OWNERSHIP_CLAIM_NOT_FOUND' });
    assert.equal((await read('resolve_certificate', { certificateNumber: main.cert })).canSubmit, false);
    const history = await read('list_history', { claimId, afterRevision: 0, limit: 50 }); assert.equal(history.origin, 'PROOF_V2'); assert.equal(history.transitions.length, 1);
    assert.doesNotMatch(JSON.stringify(history), new RegExp([other.customer.id, principal.id, 'objectId', 'ownerAccountId', 'https:', 'manifest_hash'].join('|')));
    const old = await read('list_history', { claimId: legacyClaim.eventId, afterRevision: 0, limit: 50 }); assert.equal(old.origin, 'LEGACY_V1'); assert.deepEqual(old.transitions, []);
  });
  checks.push('actual CustomerAuth sessions scope own claims/history and pagination; foreign histories refused; no competing identity/proof object disclosure; explicit live policy hash enables only synthetic configured formats');
  const replacement = await bundle(main); await call('replace_evidence', { requestId: randomUUID(), claimId, expectedClaimRevision: 1, bundleId: replacement });
  const legacyReplacement = await bundle(legacy); await call('replace_evidence', { requestId: randomUUID(), claimId: legacyClaim.eventId, expectedClaimRevision: 1, bundleId: legacyReplacement });
  await unchanged('replacement history and immutable earlier bundle', async () => {
    const first = await read('list_history', { claimId, afterRevision: 0, limit: 1 }); assert.equal(first.nextRevision, 1); assert.equal(first.transitions[0].bundleId, initialBundle); assert.equal(first.claim.bundleId, replacement);
    const next = await read('list_history', { claimId, afterRevision: first.nextRevision, limit: 1 }); assert.equal(next.transitions[0].claimRevision, 2); assert.equal(next.transitions[0].bundleId, replacement); assert.equal(next.nextRevision, null);
    const old = await read('list_history', { claimId: legacyClaim.eventId, afterRevision: 0, limit: 50 }); assert.equal(old.origin, 'LEGACY_V1'); assert.equal(old.transitions.length, 1); assert.equal(old.transitions[0].claimRevision, 2);
  });
  await call('withdraw_claim', { requestId: randomUUID(), claimId, expectedClaimRevision: 2 });
  await unchanged('withdrawal changes pending eligibility without changing title', async () => {
    const history = await read('list_history', { claimId, afterRevision: 0, limit: 50 }); assert.equal(history.claim.state, 'WITHDRAWN'); assert.equal(history.claim.claimRevision, 3); assert.equal(history.transitions.at(-1).action, 'withdraw_claim');
    assert.equal((await read('resolve_certificate', { certificateNumber: main.cert })).canSubmit, true);
    assert.equal((await read('resolve_certificate', { certificateNumber: main.cert }, other)).canSubmit, false);
    assert.equal(history.claim.currentlyOwnedByYou, false);
  });
  checks.push('real v2 replacement and withdrawal visible with exact current revision/bundle; legacy history starts actual transition2 only; original evidence metadata retained, withdrawn own claim stops blocking while other pending claim remains private');
  const reviewerReference = 'SYNTHETIC explicit independent identity', reviewerExpiry = new Date(Date.now() + 3600000);
  await admin.$executeRawUnsafe('INSERT INTO atlas_ownership.reviewer_authority(staff_id,customer_account_id,authorization_reference,authorized_until) VALUES($1::uuid,$2::uuid,$3,$4)', principal.id, self.customer.id, reviewerReference, reviewerExpiry);
  await admin.$executeRawUnsafe('INSERT INTO atlas_ownership_evidence.reviewer_grant(staff_id,customer_account_id,staff_access_version,customer_access_version,policy_revision,identity_reference,authorized_until) SELECT s.id,a.id,s."accessVersion",a."accessVersion",p.revision,$3,$4 FROM atlas_staff."StaffIdentity" s,atlas_customer."CustomerAccount" a,atlas_ownership_evidence.policy p WHERE s.id=$1::uuid AND a.id=$2::uuid AND p.id=\'active\'', principal.id, self.customer.id, reviewerReference, reviewerExpiry);
  await reviewer.review(staffCookie, staffSigned.csrf, { requestId: randomUUID(), cardId: titled.id, claimId: titleClaim.eventId, expectedOwnershipRevision: 0, decision: 'VERIFY', proofKind: 'FIXTURE_REVIEW' }, png);
  await unchanged('known current title and current published source', async () => {
    const ownerTarget = await read('resolve_certificate', { certificateNumber: titled.cert }), foreignTarget = await read('resolve_certificate', { certificateNumber: titled.cert }, other);
    assert.equal(ownerTarget.canSubmit, false); assert.equal(foreignTarget.canSubmit, false); assert.equal(foreignTarget.expectedOwnershipRevision, null);
    assert.equal((await read('read_claim', { claimId: titleClaim.eventId })).claim.currentlyOwnedByYou, true);
    assert.equal((await read('resolve_certificate', { certificateNumber: main.cert })).card.approvalActionId, main.published.actionId);
    assert.doesNotMatch(JSON.stringify(foreignTarget), new RegExp(owner.customer.id));
  });
  checks.push('actual verified title denies new claim hints without exposing owner/revision; newer pending report still does not replace current published approval');
  await admin.$executeRawUnsafe("UPDATE atlas_ownership_proof.policy SET enabled=false,revision=revision+1 WHERE id='active'");
  await unchanged('policy disabled management reads', async () => {
    const settings = await preparedReader.configuration(owner.cookie); assert.equal(settings.canPrepareEvidence, false); assert.equal(settings.storageOrigin, null);
    const current = (await read('read_claim', { claimId: legacyClaim.eventId })).claim; assert.equal(current.state, 'PENDING'); assert(current.blockedReasons.includes('POLICY_UNAVAILABLE'));
    assert.equal((await read('list_history', { claimId, afterRevision: 0, limit: 50 })).claim.state, 'WITHDRAWN');
    assert.equal((await read('resolve_certificate', { certificateNumber: main.cert })).canSubmit, false);
  });
  await call('withdraw_claim', { requestId: randomUUID(), claimId: legacyClaim.eventId, expectedClaimRevision: 2 });
  await unchanged('disabled policy withdrawal is visible', async () => { assert.equal((await read('read_claim', { claimId: legacyClaim.eventId })).claim.state, 'WITHDRAWN'); });
  const discardClaim = await oldSubmit(discarded); const discardId = randomUUID();
  await admin.$executeRawUnsafe("INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash) VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)", principal.id, discardId, digest('{}'));
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)', principal.id, discarded.createId, discarded.id, discardId);
  await unchanged('discard keeps private own history but denies target', async () => {
    const history = await read('list_history', { claimId: discardClaim.eventId, afterRevision: 0, limit: 50 }); assert.equal(history.claim.card, null); assert(history.claim.blockedReasons.includes('CARD_UNAVAILABLE'));
    await assert.rejects(read('resolve_certificate', { certificateNumber: discarded.cert }), { code: 'OWNERSHIP_NOT_FOUND' });
  });
  checks.push('policy disable removes proof preparation but preserves own status/history/withdrawal; discarded source denies target and returns explicit unavailable historical binding');
  await unchanged('restricted role and raw action refusal', async () => {
    for (const query of ['SELECT * FROM atlas_ownership.event', 'SELECT * FROM atlas_ownership_proof.retained', "SELECT nextval('atlas_ownership.event_sequence_seq')", 'SELECT atlas_ownership_lifecycle.claim_projection(NULL,NULL,false,NULL)',
      'SELECT atlas_ownership_lifecycle.customer_gateway(NULL,NULL,NULL,NULL,NULL)', 'SELECT atlas_ownership_proof.object_gateway(NULL,NULL,NULL,NULL,NULL)', 'SELECT atlas_ownership_workflow.customer_read(NULL,NULL,NULL,NULL,NULL)', 'SELECT atlas_ownership_evidence.enforce_event()']) await assert.rejects(readerClient.$queryRawUnsafe(query));
    const h = auth.authority(owner.cookie), args = [h.sessionHash, h.browserHash, JSON.stringify(config.binding)];
    const query = 'SELECT atlas_ownership_lifecycle_reader.customer_read($1,$2,$3::jsonb,$4,$5::jsonb) result';
    assert.equal((await readerClient.$queryRawUnsafe(query, ...args, 'submit_claim', '{}'))[0].result.error.code, 'OWNERSHIP_LIFECYCLE_READ_ONLY');
    assert.equal((await readerClient.$queryRawUnsafe(query, h.sessionHash, h.browserHash, JSON.stringify({ ...config.binding, releaseSha: 'f'.repeat(40) }), 'read_access', '{}'))[0].result.error.code, 'SIGN_IN_REQUIRED');
  });
  await fixture.cluster.sql(`GRANT USAGE ON SCHEMA atlas_ownership_lifecycle TO ${readerRole}; GRANT EXECUTE ON FUNCTION atlas_ownership_lifecycle.customer_gateway(text,text,jsonb,text,jsonb) TO ${readerRole}`, [], fixture.database.name);
  await assert.rejects(reader.readAccess(owner.cookie), { code: 'OWNERSHIP_LIFECYCLE_READ_DATABASE_ROLE_INVALID' });
  await fixture.cluster.sql(`REVOKE EXECUTE ON FUNCTION atlas_ownership_lifecycle.customer_gateway(text,text,jsonb,text,jsonb) FROM ${readerRole}`, [], fixture.database.name);
  checks.push('actual SQL role denies tables/sequences/helpers/private guard/old reader/all writers; raw mutator and forged binding refuse; service detects extra granted writer before reading');
  const waitingClaim = await oldSubmit(waitCard, expiring), h = auth.authority(expiring.cookie);
  const expiry = new Date(Date.now() + 2000); await admin.$executeRawUnsafe('UPDATE atlas_customer."CustomerSession" SET "expiresAt"=$1 WHERE "tokenHash"=$2', expiry, h.sessionHash);
  let entered, unlock; const ready = new Promise(r => entered = r), release = new Promise(r => unlock = r);
  const blocking = admin.$transaction(async tx => { const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() pid'); await tx.$queryRawUnsafe('SELECT card_id FROM atlas_manual.public_report_identity WHERE card_id=$1::uuid FOR UPDATE', waitCard.id); entered(pid); await release; }, { timeout: 8000 });
  const blocker = await ready; let waiterReady; const waiterStarted = new Promise(r => waiterReady = r);
  const waiting = readerClient.$transaction(async tx => { const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() pid'); waiterReady(pid);
    return (await tx.$queryRawUnsafe('SELECT atlas_ownership_lifecycle_reader.customer_read($1,$2,$3::jsonb,$4,$5::jsonb) result', h.sessionHash, h.browserHash, JSON.stringify(config.binding), 'read_claim', JSON.stringify({ claimId: waitingClaim.eventId })))[0].result;
  }, { timeout: 8000 }).then(value => ({ value }), error => ({ error }));
  const waiter = await waiterStarted;
  try {
    const deadline = Date.now() + 1500;
    for (;;) {
      const [row] = await admin.$queryRawUnsafe('SELECT a.wait_event_type,pg_blocking_pids(a.pid) blockers,clock_timestamp() observed_at,(SELECT "expiresAt">clock_timestamp() FROM atlas_customer."CustomerSession" WHERE "tokenHash"=$2) authorized FROM pg_stat_activity a WHERE a.pid=$1', waiter, h.sessionHash);
      if (row?.wait_event_type === 'Lock' && row.blockers.includes(blocker)) { assert.equal(row.authorized, true); waitProofs.push({ waiterPid: waiter, blockerPid: blocker, observedAt: row.observed_at, authorizedBeforeExpiry: true, expiresAt: expiry }); break; }
      assert(Date.now() < deadline, 'Exact still-authorized waiter not observed'); await new Promise(r => setTimeout(r, 20));
    }
    await new Promise(r => setTimeout(r, Math.max(0, expiry.getTime() - Date.now() + 100)));
  } finally { unlock(); await blocking; }
  const ended = await waiting; assert.ifError(ended.error); assert.equal(ended.value.error.code, 'SIGN_IN_REQUIRED');
  await admin.$executeRawUnsafe('UPDATE atlas_customer."CustomerAccount" SET "revokedAt"=clock_timestamp() WHERE id=$1::uuid', other.customer.id);
  await unchanged('revoked customer read refusal', async () => { await assert.rejects(reader.readAccess(other.cookie), { code: 'SIGN_IN_REQUIRED' }); await assert.rejects(read('list_history', { claimId: competing.receipt.claimId, afterRevision: 0, limit: 50 }, other), { code: 'SIGN_IN_REQUIRED' }); });
  checks.push('actual same-transaction waiter and exact blocker observed while customer session valid; after real expiry/unlock SQL refuses; revoked customer cannot read access or own history; complete read-phase preservation');
  result = { pass: true, checks, waitProofs, preservationProofs, protectedTables, sourceSha256, node: process.version, syntheticOnly: true,
    qualificationLimits: 'Synthetic trusted object observations only; no storage, native decoder, provider, operational proof policy, deployed migration or production usability qualification.',
    productionQueries: 0, providerCalls: 0, storageEffects: 0, notificationEffects: 0, ownedCluster: fixture.cluster.directory };
} catch (error) {
  result = { pass: false, checks, waitProofs, preservationProofs, sourceSha256, error: { name: error.name, code: error.code, message: error.message }, syntheticOnly: true, productionQueries: 0, providerCalls: 0, storageEffects: 0 };
  throw error;
} finally {
  await Promise.all(clients.map(c => c.$disconnect())); await fixture.stop();
  const cleanupPath = resolve(fixture.cluster.directory, 'cleanup.json'), cleanup = JSON.parse(await readFile(cleanupPath, 'utf8'));
  result = { ...result, stoppedVerified: cleanup.stoppedVerified === true, cleanupPath };
  await copyFile(cleanupPath, resolve(output, 'cleanup.json')); await chmod(resolve(output, 'cleanup.json'), 0o600);
  for (const name of ['validation.log', 'postgres.log']) { try { await copyFile(resolve(fixture.cluster.directory, name), resolve(output, name)); await chmod(resolve(output, name), 0o600); } catch {} }
  await writeFile(resolve(output, 'postgres-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify(result) + '\n'); assert.equal(result.stoppedVerified, true, 'Exact owned cluster shutdown required');
}
