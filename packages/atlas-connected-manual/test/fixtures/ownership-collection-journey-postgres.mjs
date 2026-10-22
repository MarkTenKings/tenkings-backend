// Finite, explicit owned local PostgreSQL17 qualification. Never serving code.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '../../../../frontend/atlas-app/.generated/staff-database/index.js';
import { CustomerAuth } from '../../../../frontend/atlas-customer/lib/server/auth.mjs';
import { CustomerDatabase } from '../../../../frontend/atlas-customer/lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../../../../frontend/atlas-customer/lib/server/fixture.mjs';
import { createOwnershipReadHandler } from '../../../../frontend/atlas-customer/lib/server/ownership-read.mjs';
import { readCollectionPage } from '../../../../frontend/atlas-customer/lib/collection-client.mjs';
import { createOwnedManualFixture } from '../../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../../atlas-manual-service/src/contract.mjs';
import { createCardOwnershipLifecycleService, createOwnershipProofObjectGateway, cardOwnershipLifecycleGrantSQL } from '../../src/card-ownership-lifecycle-service.mjs';
import { createCardOwnershipLifecycleReadService, cardOwnershipLifecycleReadGrantSQL } from '../../src/card-ownership-lifecycle-read-service.mjs';
import { createCardOwnershipReadService, cardOwnershipReadGrantSQL } from '../../src/card-ownership-read-service.mjs';
import { createCardOwnershipCustomerService, cardOwnershipGrantSQL } from '../../src/card-ownership-service.mjs';
import { OWNERSHIP_PROOF_VALIDATORS } from '../../src/card-ownership-proof-contract.mjs';

const output = process.env.ATLAS_OWNERSHIP_COLLECTION_QUALIFICATION;
assert(output && resolve(output) === output, 'Absolute NEW evidence directory required');
assert(!process.argv.some(v => ['--serve', '--docker-image', '--ack-disposable-remote-pg17'].includes(v)), 'Finite local binary fixture only');
await mkdir(output, { mode: 0o700 });
const root = new URL('../../../../', import.meta.url), sources = {}, sourceSha256 = {};
const sqlFiles = ['card-ownership-proposal.sql', 'card-ownership-evidence-proposal.sql', 'card-ownership-workflow-reader-proposal.sql',
  'card-ownership-proof-objects-proposal.sql', 'card-ownership-lifecycle-successor-proposal.sql', 'card-ownership-lifecycle-reader-proposal.sql', 'card-ownership-reader-proposal.sql'];
const sourcePaths = [
  ...sqlFiles.map(p => 'packages/atlas-connected-manual/sql/' + p),
  ...['card-ownership-lifecycle-service.mjs', 'card-ownership-proof-contract.mjs', 'card-ownership-lifecycle-read-service.mjs',
    'card-ownership-lifecycle-read-contract.mjs', 'card-ownership-read-service.mjs', 'card-ownership-service.mjs', 'card-ownership-contract.mjs'].map(p => 'packages/atlas-connected-manual/src/' + p),
  'frontend/atlas-customer/lib/server/ownership-read.mjs', 'frontend/atlas-customer/lib/collection-client.mjs', 'frontend/atlas-customer/lib/collection-contract.mjs',
  'frontend/atlas-customer/lib/server/auth.mjs', 'frontend/atlas-customer/lib/server/database.mjs', 'frontend/atlas-customer/lib/server/fixture.mjs',
  'frontend/atlas-customer/lib/server/policy.mjs', 'frontend/atlas-app/lib/server/access/auth.mjs',
  'packages/atlas-manual-service/scripts/owned-fixture.mjs', 'frontend/atlas-app/scripts/disposable-postgres.mjs',
  'packages/atlas-connected-manual/test/fixtures/ownership-collection-journey-postgres.mjs',
];
for (const path of sourcePaths) {
  sources[path] = await readFile(new URL(path, root), 'utf8'); sourceSha256[path] = digest(sources[path]);
  await writeFile(resolve(output, 'source-used-' + path.replaceAll('/', '_')), sources[path], { mode: 0o600, flag: 'wx' });
}
await writeFile(resolve(output, 'fixture-used.mjs'), sources[sourcePaths.at(-1)], { mode: 0o600, flag: 'wx' });
const checks = [], preservationProofs = [], mutationProofs = [], clients = [], httpProofs = [];
let fixture, result, failure, protectedTables = [];
try {
  fixture = await createOwnedManualFixture(process.argv.slice(2));
  const admin = fixture.admin;
  for (const file of sqlFiles) await fixture.cluster.sql(sources['packages/atlas-connected-manual/sql/' + file], [], fixture.database.name);
  const staff = fixture.connect(), staffAuth = staff.auth;
  const boot = await staffAuth.bootstrap(''), initial = `${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge = await staffAuth.send(initial, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'journey-fixture');
  const signed = await staffAuth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'journey-fixture');
  const staffCookie = `${initial}; ${fixture.config.cookies.session}=${signed.token}`;
  const actor = await staffAuth.authenticate(staffCookie, signed.csrf);
  const principal = await staff.boundary.transaction(actor, ({ principal }) => principal);
  const authClient = new PrismaClient({ datasources: { db: { url: fixture.database.customerUrl } } }); clients.push(authClient);
  const config = localConfig({ databaseUrl: fixture.database.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
  const auth = new CustomerAuth({ database: new CustomerDatabase(authClient, config), config, provider: fixtureProvider(config) });
  await admin.$executeRawUnsafe('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)', config.mode, config.origin, config.deploymentId, config.releaseSha, config.configHash);
  async function login(phone) {
    const boot = await auth.bootstrap('', 'journey-fixture'), first = `${config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(first, boot.csrf, { phone, requestId: randomUUID() }, 'journey-fixture');
    const signed = await auth.verify(first, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'journey-fixture');
    return { ...signed, cookie: `${first}; ${config.cookies.session}=${signed.token}` };
  }
  const a = await login('+12025550371'), b = await login('+12025550372'), reviewerIdentity = await login('+12025550141');
  async function restricted(role, grant) {
    const password = randomBytes(24).toString('hex');
    await fixture.cluster.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await fixture.cluster.sql(grant(role), [], fixture.database.name);
    const url = new URL(fixture.database.adminUrl); url.username = role; url.password = password;
    const client = new PrismaClient({ datasources: { db: { url: url.href } } }); clients.push(client); return client;
  }
  const lifecycleClient = await restricted('atlas_journey_lifecycle', r => cardOwnershipLifecycleGrantSQL(r, 'CUSTOMER'));
  const reviewClient = await restricted('atlas_journey_reviewer', r => cardOwnershipLifecycleGrantSQL(r, 'REVIEWER'));
  const objectClient = await restricted('atlas_journey_ingestor', r => cardOwnershipLifecycleGrantSQL(r, 'INGESTOR'));
  const lifecycleReaderClient = await restricted('atlas_journey_history', cardOwnershipLifecycleReadGrantSQL);
  const collectionClient = await restricted('atlas_journey_collection', cardOwnershipReadGrantSQL);
  const transferClient = await restricted('atlas_journey_transfer', r => cardOwnershipGrantSQL(r, 'CUSTOMER'));
  const lifecycle = createCardOwnershipLifecycleService({ auth, client: lifecycleClient, audience: 'CUSTOMER' });
  const reviewer = createCardOwnershipLifecycleService({ auth: staffAuth, client: reviewClient, audience: 'REVIEWER' });
  const objects = createOwnershipProofObjectGateway({ customerAuth: auth, client: objectClient });
  const history = createCardOwnershipLifecycleReadService({ customerAuth: auth, client: lifecycleReaderClient });
  const collection = createCardOwnershipReadService({ auth, client: collectionClient });
  const transfers = createCardOwnershipCustomerService({ auth, client: transferClient });
  const call = (action, data, who = a) => lifecycle.call(who.cookie, who.csrf, action, data);
  const read = (action, data, who = a) => history.read(who.cookie, action, data);
  const page = (who = a) => collection.read(who.cookie, 'read_collection', { afterCardId: null, limit: 25 });

  // Only synthetic fixture setup creates published grading metadata. No grading,
  // generation, approval workflow, media service, or paid provider is invoked.
  async function publish(c, version = 1, published = true) {
    const actionId = randomUUID(), report = canonical({ version: 'atlas-manual-report-snapshot-v2', identity: { playerName: 'SYNTHETIC ownership collection' }, finalGrade: 9 });
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,$5,$5+1,$4,'{}','{}')", c.id, actionId, principal.id, digest('{}'), version);
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1::uuid,$2::uuid,$3::uuid,$7,$4,$5,$6)', c.id, actionId, principal.id, digest('synthetic-source'), digest(report), report, version);
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,$3,'LOCAL_FIXTURE')", c.id, actionId, version);
    if (published) await admin.$executeRawUnsafe("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest='{}',manifest_hash=$1,public_hash=$2,published_at=clock_timestamp() WHERE card_id=$3::uuid AND action_id=$4::uuid", digest('{}'), digest('public-' + actionId), c.id, actionId);
    return actionId;
  }
  async function seed() {
    const c = { id: randomUUID(), createId: randomUUID(), certificateNumber: 'ATLAS-' + randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase() };
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'SYNTHETIC ownership collection')", c.id, randomUUID(), principal.id, c.createId, digest(c.createId));
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,'{}',$2,$3::uuid)", c.id, digest('{}'), principal.id);
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)', c.id, 'ar_' + randomUUID().replaceAll('-', '').slice(0, 24), c.certificateNumber);
    return { ...c, approvalActionId: await publish(c) };
  }
  const card = await seed(), withdrawnCard = await seed(), pendingApproval = await publish(card, 2, false);
  await admin.$executeRawUnsafe("UPDATE atlas_ownership_evidence.policy SET enabled=true,revision=1,accepted_claim_kinds=ARRAY['FIXTURE_CLAIM'],accepted_review_kinds=ARRAY['FIXTURE_REVIEW'],policy_reference='SYNTHETIC ONLY',retention_reference='SYNTHETIC ONLY',retention_seconds=3600,valid_until=clock_timestamp()+interval '1 hour' WHERE id='active'");
  const validators = Object.entries(OWNERSHIP_PROOF_VALIDATORS.versions).map(([mime, decoderVersion]) => ({ recipe: OWNERSHIP_PROOF_VALIDATORS.recipe, decoderVersion, mime }));
  await admin.$executeRawUnsafe("UPDATE atlas_ownership_proof.policy SET enabled=true,revision=1,accepted_formats=ARRAY['image/png'],validators=$1::jsonb,policy_reference='SYNTHETIC ONLY',deletion_reference='SYNTHETIC ONLY NO DELETE',delete_after_seconds=7200,valid_until=clock_timestamp()+interval '1 hour' WHERE id='active'", JSON.stringify(validators));
  const grantExpiry = new Date(Date.now() + 3600000), identityReference = 'SYNTHETIC independent reviewer identity';
  await admin.$executeRawUnsafe('INSERT INTO atlas_ownership.reviewer_authority(staff_id,customer_account_id,authorization_reference,authorized_until) VALUES($1::uuid,$2::uuid,$3,$4)', principal.id, reviewerIdentity.customer.id, identityReference, grantExpiry);
  await admin.$executeRawUnsafe('INSERT INTO atlas_ownership_evidence.reviewer_grant(staff_id,customer_account_id,staff_access_version,customer_access_version,policy_revision,identity_reference,authorized_until) SELECT s.id,a.id,s."accessVersion",a."accessVersion",p.revision,$3,$4 FROM atlas_staff."StaffIdentity" s,atlas_customer."CustomerAccount" a,atlas_ownership_evidence.policy p WHERE s.id=$1::uuid AND a.id=$2::uuid AND p.id=\'active\'', principal.id, reviewerIdentity.customer.id, identityReference, grantExpiry);

  // Inventory every installed application table, including empty provider,
  // media, grading, auth, evidence and commerce tables. No field exclusion.
  protectedTables = (await admin.$queryRawUnsafe("SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname LIKE 'atlas_%' ORDER BY n.nspname,c.relname")).map(r => r.name);
  assert(protectedTables.length >= 36);
  async function census() {
    const rows = {};
    for (const table of protectedTables) rows[table] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) value FROM ${table} t`))[0].value;
    return rows;
  }
  const commitment = rows => Object.fromEntries(Object.entries(rows).map(([table, data]) => [table, { rowCount: data.length, sha256: digest(JSON.stringify(data)) }]));
  function delta(before, after) {
    const result = {};
    for (const table of protectedTables) {
      const old = before[table].map(r => JSON.stringify(r)), next = after[table].map(r => JSON.stringify(r));
      if (JSON.stringify(old) === JSON.stringify(next)) continue;
      const count = rows => { const m = new Map(); for (const r of rows) m.set(r, (m.get(r) ?? 0) + 1); return m; };
      const x = count(old), y = count(next);
      const removed = [...x].reduce((n, [r, c]) => n + Math.max(0, c - (y.get(r) ?? 0)), 0);
      const added = [...y].reduce((n, [r, c]) => n + Math.max(0, c - (x.get(r) ?? 0)), 0);
      result[table] = { added, removed };
    }
    return result;
  }
  async function unchanged(name, fn) {
    const before = await census(), value = await fn(), after = await census();
    assert.deepEqual(after, before, name);
    preservationProofs.push({ name, tableCount: protectedTables.length, sha256: digest(JSON.stringify(after)), tables: commitment(after) }); return value;
  }
  const adds = (...names) => Object.fromEntries(names.map(table => [table, { added: 1, removed: 0 }]));
  async function mutation(name, expected, fn) {
    const before = await census(), value = await fn(), after = await census(), changes = delta(before, after);
    assert.deepEqual(changes, expected, name + ': exact expected mutation set');
    mutationProofs.push({ name, expected, observed: changes, before: commitment(before), after: commitment(after) }); return value;
  }
  const journeyStart = await census();
  let expectedBinding;
  await unchanged('unknown title and staff intake ACL create no customer collection authority', async () => {
    assert.deepEqual((await page()).cards, []); assert.deepEqual((await page(b)).cards, []); assert.deepEqual((await page(reviewerIdentity)).cards, []);
    expectedBinding = (await read('resolve_certificate', { certificateNumber: card.certificateNumber })).card;
    assert.equal(expectedBinding.approvalActionId, card.approvalActionId); assert.equal(expectedBinding.report.version, 1); assert.notEqual(expectedBinding.approvalActionId, pendingApproval);
    await assert.rejects(collection.read(b.cookie, 'read_card', { cardId: card.id }), { code: 'OWNERSHIP_NOT_FOUND' });
  });
  async function bundle(c) {
    const binding = await unchanged('customer resolver selects current published binding', async () => (await read('resolve_certificate', { certificateNumber: c.certificateNumber })).card);
    const reservation = await mutation('reserve synthetic original', adds('atlas_ownership_proof.bundle', 'atlas_ownership_proof.object'), () => call('reserve_bundle', {
      requestId: randomUUID(), certificateNumber: c.certificateNumber, expectedPublishedBinding: binding, proofKind: 'FIXTURE_CLAIM',
      files: [{ clientFileId: randomUUID(), sha256: digest('SYNTHETIC ORIGINAL'), byteCount: 1024, declaredType: 'image/png' }],
    }));
    const ids = { bundleId: reservation.bundle.bundleId, objectId: reservation.bundle.files[0].objectId };
    const plan = await mutation('acquire synthetic original lease', adds('atlas_ownership_proof.upload_lease'), () => objects.readPlan(a.cookie, a.csrf, ids));
    // Explicit trusted synthetic ingestor observation: qualifies durable binding,
    // not storage authenticity, real upload, decoder execution or isolation.
    await mutation('retain synthetic ingestor observation', adds('atlas_ownership_proof.retained'), () => objects.retainObject(a.cookie, a.csrf, ids, {
      schema: 'atlas-ownership-proof-object-observation-v2', planHash: plan.planHash,
      object: { key: plan.key, versionId: 'synthetic-version', etag: '"synthetic-etag"' }, sha256: plan.sha256, byteCount: plan.byteCount, contentType: 'application/octet-stream',
      validation: { recipe: OWNERSHIP_PROOF_VALIDATORS.recipe, decoderVersion: OWNERSHIP_PROOF_VALIDATORS.versions[plan.declaredType], mime: plan.declaredType,
        width: 32, height: 32, pixels: 1024, originalSha256: plan.sha256, originalByteCount: plan.byteCount },
    }));
    return ids.bundleId;
  }
  const bundleId = await bundle(card);
  const submissionInput = { requestId: randomUUID(), bundleId, expectedOwnershipRevision: 0 };
  const submitted = await mutation('submit pending claim', adds('atlas_ownership.event', 'atlas_ownership_lifecycle.transition', 'atlas_ownership_proof.consumption'), () => call('submit_claim', submissionInput));
  const claimId = submitted.receipt.claimId;
  await unchanged('pending plus retained evidence is not current title', async () => {
    assert.equal((await read('read_claim', { claimId })).claim.state, 'PENDING'); assert.deepEqual((await page()).cards, []);
    await assert.rejects(read('read_claim', { claimId }, b), { code: 'OWNERSHIP_CLAIM_NOT_FOUND' });
  });
  const secondBundle = await bundle(withdrawnCard);
  const second = await mutation('submit later-withdrawn claim', adds('atlas_ownership.event', 'atlas_ownership_lifecycle.transition', 'atlas_ownership_proof.consumption'), () => call('submit_claim', { requestId: randomUUID(), bundleId: secondBundle, expectedOwnershipRevision: 0 }));
  await mutation('withdraw without creating title', adds('atlas_ownership_lifecycle.transition'), () => call('withdraw_claim', { requestId: randomUUID(), claimId: second.receipt.claimId, expectedClaimRevision: 1 }));
  await unchanged('withdrawn history is retained but neither card is owned', async () => {
    assert.equal((await read('read_claim', { claimId: second.receipt.claimId })).claim.state, 'WITHDRAWN'); assert.deepEqual((await page()).cards, []);
  });
  checks.push('unknown, staff intake access, retained originals, pending and withdrawn claims never imply customer ownership');

  const replacementBundle = await bundle(card);
  await mutation('replace evidence retaining claim identity', adds('atlas_ownership_lifecycle.transition', 'atlas_ownership_proof.consumption'), () => call('replace_evidence', { requestId: randomUUID(), claimId, expectedClaimRevision: 1, bundleId: replacementBundle }));
  const decisionInput = { requestId: randomUUID(), claimId, expectedClaimRevision: 2, expectedOwnershipRevision: 0, decision: 'VERIFY', reasonCode: 'FIXTURE_REVIEW', decisionReference: 'SYNTHETIC independent verification' };
  const verified = await mutation('independent v2 verification creates genuine synthetic title', adds('atlas_ownership.event', 'atlas_ownership_lifecycle.transition'), () => reviewer.call(staffCookie, signed.csrf, 'review_claim', decisionInput));
  assert.equal(verified.receipt.state, 'VERIFIED'); assert.equal(verified.receipt.claimRevision, 3);
  await unchanged('verified owner sees exactly one exact approved card with independent privacy and delivery', async () => {
    const current = (await page()).cards; assert.equal(current.length, 1); const item = current[0];
    assert.equal(item.cardId, card.id); assert.equal(item.ownership.ownerAccountId, a.customer.id); assert.equal(item.ownership.revision, 1);
    assert.deepEqual(item.approvedCard, { approvalActionId: expectedBinding.approvalActionId, certificateNumber: expectedBinding.certificateNumber, report: expectedBinding.report });
    assert.equal(item.visibility, 'PRIVATE'); assert.equal(item.offers.preference, 'OPEN_TO_OFFERS'); assert.equal(item.eligibility.canReceiveOffers, false);
    assert.equal(item.notificationDelivery, 'NOT_REQUESTED'); assert.deepEqual(item.custody, { status: 'UNKNOWN', currentPhysicalHolder: 'UNKNOWN' });
    assert.deepEqual((await page(b)).cards, []); assert.deepEqual((await page(reviewerIdentity)).cards, []);
    await assert.rejects(collection.read(b.cookie, 'read_card', { cardId: card.id }), { code: 'OWNERSHIP_NOT_FOUND' });
    const currentClaim = (await read('read_claim', { claimId })).claim;
    assert.equal(currentClaim.currentlyOwnedByYou, true); assert.equal(currentClaim.bundleId, replacementBundle); assert.equal(currentClaim.claimRevision, 3);
    const historyPage = await read('list_history', { claimId, afterRevision: 0, limit: 50 });
    assert.deepEqual(historyPage.transitions.map(t => t.claimRevision), [1, 2, 3]);
    assert.equal(historyPage.transitions[0].bundleId, bundleId); assert.equal(historyPage.transitions[1].bundleId, replacementBundle);
    assert.deepEqual((await call('recover_request', { requestId: submissionInput.requestId })).receipt, submitted.receipt);
    assert.deepEqual((await reviewer.call(staffCookie, signed.csrf, 'recover_request', { requestId: decisionInput.requestId })).receipt, verified.receipt);
  });
  checks.push('actual replacement and independent v2 reviewer verification feed restricted My Collection; original receipt and all earlier evidence revisions stay immutable');
  checks.push('both restricted readers bind the same latest PUBLISHED approval/report even with a newer PENDING publication; privacy, offer preference, delivery and custody remain independent');

  const transferInput = { requestId: randomUUID(), cardId: card.id, expectedOwnershipRevision: 1, recipientAccountId: b.customer.id, expiresInMinutes: 30 };
  const transfer = await mutation('propose participating transfer', adds('atlas_ownership.event'), () => transfers.call(a.cookie, 'propose_transfer', transferInput, a.csrf));
  await unchanged('transfer proposal alone does not move collection', async () => { assert.equal((await page()).cards.length, 1); assert.deepEqual((await page(b)).cards, []); });
  const acceptanceInput = { requestId: randomUUID(), cardId: card.id, expectedOwnershipRevision: 1, transferId: transfer.eventId };
  const accepted = await mutation('recipient accepts participating transfer', adds('atlas_ownership.event'), () => transfers.call(b.cookie, 'accept_transfer', acceptanceInput, b.csrf));
  await unchanged('current collection moves A to B while A verified claim remains historical', async () => {
    assert.deepEqual((await page()).cards, []); const ownedByB = (await page(b)).cards; assert.equal(ownedByB.length, 1);
    assert.equal(ownedByB[0].cardId, card.id); assert.equal(ownedByB[0].ownership.ownerAccountId, b.customer.id); assert.equal(ownedByB[0].ownership.revision, 2);
    assert.deepEqual(ownedByB[0].approvedCard.report, expectedBinding.report); assert.equal(ownedByB[0].approvedCard.approvalActionId, card.approvalActionId);
    const past = (await read('read_claim', { claimId })).claim; assert.equal(past.state, 'VERIFIED'); assert.equal(past.currentlyOwnedByYou, false);
    assert.doesNotMatch(JSON.stringify(past), new RegExp(b.customer.id + '|ownerAccountId|objectId|https:'));
    await assert.rejects(collection.read(a.cookie, 'read_card', { cardId: card.id }), { code: 'OWNERSHIP_NOT_FOUND' });
    assert.deepEqual(await transfers.call(b.cookie, 'accept_transfer', acceptanceInput, b.csrf), accepted);
  });
  checks.push('only accepted authenticated participation moves title/collection; prior VERIFIED claim remains historical and does not expose the recipient');

  // In-process browser/handler bridge, not an HTTP server or production router.
  // The trusted outer route hook is fixture-only; actual handler, auth, SQL read,
  // private headers, Response stream and client parser run unchanged.
  function fetcher(who, ownershipRead = collection) {
    const handler = createOwnershipReadHandler({ auth, ownershipRead, assertRequest(req) { assert.equal(req.headers.origin, config.origin); } });
    return async (path, init) => {
      assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
      assert(path.startsWith('/account/api/customer/collection'));
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ method: init.method, url: path.slice('/account'.length), body: '', headers: { cookie: who.cookie, origin: config.origin, 'sec-fetch-site': 'same-origin' } }, res);
      assert.equal(res.headers['Cache-Control'], 'private, no-store, max-age=0'); assert.equal(res.headers['Vary'], 'Cookie'); assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store'); assert.equal(res.headers['Set-Cookie'], undefined);
      httpProofs.push({ status: res.statusCode, bytes: Buffer.byteLength(JSON.stringify(res.body)), responseSha256: digest(JSON.stringify(res.body)), cacheControl: res.headers['Cache-Control'], vary: res.headers.Vary });
      return new Response(JSON.stringify(res.body), { status: res.statusCode, headers: { ...res.headers, 'Content-Type': 'application/json' } });
    };
  }
  await unchanged('actual handler and browser collection parser agree on owner/account and unavailable paths', async () => {
    assert.deepEqual((await readCollectionPage({ accountId: a.customer.id }, fetcher(a))).cards, []);
    assert.equal((await readCollectionPage({ accountId: b.customer.id }, fetcher(b))).cards[0].cardId, card.id);
    await assert.rejects(readCollectionPage({ accountId: a.customer.id }, fetcher(b)), { code: 'COLLECTION_UNAVAILABLE' });
    await assert.rejects(readCollectionPage({ accountId: b.customer.id }, fetcher(b, null)), { code: 'COLLECTION_UNAVAILABLE', status: 503 });
    await assert.rejects(readCollectionPage({ accountId: b.customer.id }, fetcher({ cookie: '' })), { code: 'COLLECTION_ACCESS_ENDED', status: 401 });
  });
  checks.push('actual GET handler plus bounded browser Response reader consume real restricted-service output in-process; foreign account refuses, unconfigured503 differs from empty200, missing session401 clears access');
  await mutation('explicit fixture-only account revocation', { 'atlas_customer."CustomerAccount"': { added: 1, removed: 1 } }, () => admin.$executeRawUnsafe('UPDATE atlas_customer."CustomerAccount" SET "revokedAt"=clock_timestamp() WHERE id=$1::uuid', b.customer.id));
  await unchanged('revoked current owner cannot read collection or lifecycle access', async () => {
    await assert.rejects(page(b), { code: 'SIGN_IN_REQUIRED' }); await assert.rejects(history.readAccess(b.cookie), { code: 'SIGN_IN_REQUIRED' });
    await assert.rejects(readCollectionPage({ accountId: b.customer.id }, fetcher(b)), { code: 'COLLECTION_ACCESS_ENDED', status: 401 });
    assert.deepEqual((await page()).cards, []);
  });
  checks.push('live account revocation is rechecked by collection/history SQL and becomes access-ended through actual HTTP/client boundaries');
  const journeyEnd = await census();
  for (const table of protectedTables) {
    if (!['atlas_ownership.event', 'atlas_ownership_lifecycle.transition', 'atlas_ownership_proof.bundle', 'atlas_ownership_proof.object',
      'atlas_ownership_proof.upload_lease', 'atlas_ownership_proof.retained', 'atlas_ownership_proof.consumption', 'atlas_customer."CustomerAccount"'].includes(table)) assert.deepEqual(journeyEnd[table], journeyStart[table], table + ': whole-journey preservation');
  }
  for (const path of sourcePaths) assert.equal(digest(await readFile(new URL(path, root), 'utf8')), sourceSha256[path], 'Source changed during qualification');
  result = { pass: true, checks, preservationProofs, mutationProofs, httpProofs, protectedTables, sourceSha256, node: process.version,
    wholeJourneyChanges: delta(journeyStart, journeyEnd), wholeJourneyBefore: commitment(journeyStart), wholeJourneyAfter: commitment(journeyEnd) };
} catch (error) {
  failure = error; result = { pass: false, checks, preservationProofs, mutationProofs, httpProofs, protectedTables, sourceSha256,
    error: { name: error.name, code: error.code, message: error.message } };
} finally {
  await Promise.allSettled(clients.map(client => client.$disconnect()));
  if (fixture) {
    try {
      await fixture.stop();
      const cleanupPath = resolve(fixture.cluster.directory, 'cleanup.json'), cleanup = JSON.parse(await readFile(cleanupPath, 'utf8'));
      result = { ...result, ownedCluster: fixture.cluster.directory, stoppedVerified: cleanup.stoppedVerified === true, cleanupPath };
      await copyFile(cleanupPath, resolve(output, 'cleanup.json')); await chmod(resolve(output, 'cleanup.json'), 0o600);
      for (const name of ['validation.log', 'postgres.log']) { try { await copyFile(resolve(fixture.cluster.directory, name), resolve(output, name)); await chmod(resolve(output, name), 0o600); } catch {} }
      assert.equal(result.stoppedVerified, true, 'Exact owned cluster shutdown required');
    } catch (error) { failure ??= error; result = { ...result, pass: false, cleanupError: error.message }; }
  }
  result = { ...result, syntheticOnly: true, productionQueries: 0, providerCalls: 0, storageEffects: 0, notificationEffects: 0, gradingWorkflowCommands: 0,
    qualificationLimits: 'Synthetic fixture-only policy and trusted retained observations. No operational policy, storage, decoder isolation, production gateway/runtime composition, browser UI or real ownership authenticity qualification.' };
  await writeFile(resolve(output, 'postgres-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify({ pass: result.pass, checks: checks.length, readPhases: preservationProofs.length, mutationPhases: mutationProofs.length, tableCount: protectedTables.length, stoppedVerified: result.stoppedVerified, output, error: result.error }) + '\n');
}
if (failure) throw failure;
