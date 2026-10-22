import { assertRegisteredOwnershipFoundation, captureOwnershipFoundation } from '../../atlas-standalone-database/test/ownership-foundation-fixture.mjs';
// Explicitly owned, synthetic PostgreSQL17 qualification. Never ambient DB URLs.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import { CustomerAuth } from '../../../frontend/atlas-customer/lib/server/auth.mjs';
import { CustomerDatabase } from '../../../frontend/atlas-customer/lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../../../frontend/atlas-customer/lib/server/fixture.mjs';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../atlas-manual-service/src/contract.mjs';
import { cardOwnershipGrantSQL, createCardOwnershipCustomerService, createCardOwnershipReviewService } from '../src/card-ownership-service.mjs';

const output = process.env.ATLAS_CARD_OWNERSHIP_EVIDENCE;
assert(output && resolve(output) === output, 'Absolute evidence directory required');
await mkdir(output, { recursive: true, mode: 0o700 });
await captureOwnershipFoundation(output);
const fixture = await createOwnedManualFixture(process.argv.slice(2)), checks = [], clients = [];
let result;
try {
  const proposal = await readFile(new URL('../sql/card-ownership-proposal.sql', import.meta.url), 'utf8');
  assert.equal(digest(proposal), '00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2');
  await assertRegisteredOwnershipFoundation(sql => fixture.cluster.sql(sql, [], fixture.database.name));
  const admin = fixture.admin, connection = fixture.connect(), { auth: staffAuth, boundary } = connection;
  await fixture.cluster.sql(cardOwnershipGrantSQL('atlas_fixture_manual', 'STAFF'), [], fixture.database.name);
  const review = createCardOwnershipReviewService({ auth: staffAuth, boundary });
  async function staffLogin(phone) {
    const boot = await staffAuth.bootstrap(''), initial = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await staffAuth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'ownership-fixture');
    const signed = await staffAuth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'ownership-fixture');
    return staffAuth.authenticate(`${initial}; ${fixture.config.cookies.session}=${signed.token}`, signed.csrf);
  }
  const reviewer = await staffLogin('+12025550141'), observer = await staffLogin('+12025550142'), peer = await staffLogin('+12025550143');
  const principal = await boundary.transaction(reviewer, ({ principal }) => principal);
  const peerPrincipal = await boundary.transaction(peer, ({ principal }) => principal);
  const customerClient = new PrismaClient({ datasources: { db: { url: fixture.database.customerUrl } } }); clients.push(customerClient);
  const config = localConfig({ databaseUrl: fixture.database.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
  const auth = new CustomerAuth({ database: new CustomerDatabase(customerClient, config), config, provider: fixtureProvider(config) });
  await admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)`, config.mode, config.origin, config.deploymentId, config.releaseSha, config.configHash);
  async function login(phone) {
    const boot = await auth.bootstrap('', 'ownership-fixture'), initial = `${config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'ownership-fixture');
    const signed = await auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'ownership-fixture');
    return { ...signed, cookie: `${initial}; ${config.cookies.session}=${signed.token}` };
  }
  const owner = await login('+12025550301'), recipient = await login('+12025550302'), outsider = await login('+12025550303'), self = await login('+12025550141');
  const password = randomBytes(24).toString('hex'), role = 'atlas_fixture_ownership';
  await fixture.cluster.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await fixture.cluster.sql(cardOwnershipGrantSQL(role, 'CUSTOMER'), [], fixture.database.name);
  const url = new URL(fixture.database.adminUrl); url.username = role; url.password = password;
  const client = new PrismaClient({ datasources: { db: { url: url.href } } }); clients.push(client);
  const service = createCardOwnershipCustomerService({ auth, client });
  const call = (action, data, who = owner) => service.call(who.cookie, action, data, who.csrf);
  const raw = async (action, data, who = owner, binding = config.binding, handle = auth.authority(who.cookie)) => {
    const [row] = await client.$queryRawUnsafe('SELECT atlas_ownership.customer_call($1,$2,$3::jsonb,$4,$5::jsonb) result', handle.sessionHash, handle.browserHash, JSON.stringify(binding), action, JSON.stringify(data));
    return row.result;
  };
  async function seed(actor = principal.id) {
    const card = { id: randomUUID(), createId: randomUUID(), token: `ar_${randomUUID().replaceAll('-', '').slice(0, 24)}`, actionId: randomUUID() };
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'Synthetic ownership fixture')`, card.id, randomUUID(), actor, card.createId, digest(card.createId));
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,'{}',$2,$3::uuid)`, card.id, digest('{}'), actor);
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)`, card.id, card.token, `ATLAS-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`);
    const report = canonical({ version: 'atlas-manual-report-snapshot-v2', identity: { playerName: 'Synthetic fixture only' }, finalGrade: 9 });
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,1,2,$4,'{}','{}')`, card.id, card.actionId, actor, digest('{}'));
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1::uuid,$2::uuid,$3::uuid,1,$4,$5,$6)`, card.id, card.actionId, actor, digest('synthetic-source'), digest(report), report);
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,1,'LOCAL_FIXTURE')`, card.id, card.actionId);
    await admin.$executeRawUnsafe(`UPDATE atlas_manual.publication SET state='PUBLISHED',manifest='{}',manifest_hash=$1,public_hash=$2,published_at=clock_timestamp() WHERE card_id=$3::uuid`, digest('{}'), digest('synthetic-public'), card.id);
    return card;
  }
  const card = await seed(), selfCard = await seed(), hidden = await seed(peerPrincipal.id), raceCard = await seed();
  const claimInput = c => ({ requestId: randomUUID(), cardId: c.id, expectedOwnershipRevision: 0, evidence: { referenceId: randomUUID(), sha256: digest('Synthetic documentary evidence, not legal proof') } });
  const reviewInput = (c, claim, decision = 'VERIFY') => ({ requestId: randomUUID(), cardId: c.id, claimId: claim.eventId, expectedOwnershipRevision: 0, decision,
    evidence: { referenceId: randomUUID(), sha256: digest('Synthetic independent reviewer receipt') } });
  const tables = ['atlas_manual.card', 'atlas_manual.action', 'atlas_manual.approval', 'atlas_manual.public_report_identity', 'atlas_manual.publication',
    'atlas_dealer.custody_event', 'atlas_dealer.manual_card_link', 'atlas_customer."CommerceOrder"', 'atlas_customer."CommercePayment"'];
  async function census() { const values = {}; for (const table of tables) values[table] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) value FROM ${table} t`))[0].value; return values; }
  const before = await census();

  assert.equal((await call('read_preferences', {})).offersDisabled, false);
  assert.deepEqual((await call('read_collection', { afterCardId: null, limit: 1 })).cards, []);
  await assert.rejects(call('read_card', { cardId: card.id }), { code: 'OWNERSHIP_NOT_FOUND' });
  assert.equal((await admin.$queryRawUnsafe('SELECT atlas_ownership.current_title($1::uuid) value', card.id))[0].value.status, 'UNKNOWN');
  const input = claimInput(card), claim = await call('submit_claim', input);
  assert.deepEqual(await call('submit_claim', input), claim);
  await assert.rejects(call('submit_claim', { ...input, evidence: { ...input.evidence, sha256: digest('different') } }), { code: 'OWNERSHIP_REQUEST_CONFLICT' });
  await assert.rejects(call('submit_claim', claimInput(card)), { code: 'OWNERSHIP_CLAIM_PENDING' });
  const decision = reviewInput(card, claim);
  await assert.rejects(review.review(reviewer, decision), { code: 'OWNERSHIP_REVIEW_REQUIRED' });
  await assert.rejects(review.review(observer, decision), { code: 'OWNERSHIP_REVIEW_REQUIRED' });
  await admin.$executeRawUnsafe(`INSERT INTO atlas_ownership.reviewer_authority(staff_id,customer_account_id,authorization_reference,authorized_until) VALUES($1::uuid,$2::uuid,'Synthetic adjudicator identity grant',clock_timestamp()+interval '1 hour')`, principal.id, self.customer.id);
  const selfClaim = await call('submit_claim', claimInput(selfCard), self);
  await assert.rejects(review.review(reviewer, reviewInput(selfCard, selfClaim)), { code: 'OWNERSHIP_INDEPENDENT_REVIEW_REQUIRED' });
  const hiddenClaim = await call('submit_claim', claimInput(hidden));
  await assert.rejects(review.review(reviewer, reviewInput(hidden, hiddenClaim)), { code: 'OWNERSHIP_NOT_FOUND' });
  const verified = await review.review(reviewer, decision); assert.equal(verified.kind, 'CLAIM_VERIFIED');
  assert.deepEqual(await review.review(reviewer, decision), verified);
  await assert.rejects(review.review(reviewer, { ...decision, requestId: randomUUID() }), { code: 'OWNERSHIP_CLAIM_DECIDED' });
  const initial = await call('read_card', { cardId: card.id });
  assert.equal(initial.ownership.ownerAccountId, owner.customer.id); assert.equal(initial.ownership.revision, 1);
  assert.equal(initial.custody.currentPhysicalHolder, 'UNKNOWN'); assert.equal(initial.offers.preference, 'OPEN_TO_OFFERS'); assert.equal(initial.visibility, 'PRIVATE');
  await assert.rejects(call('read_card', { cardId: card.id }, recipient), { code: 'OWNERSHIP_NOT_FOUND' });
  checks.push('real customer sessions; unknown title not inferred from staff creation/public report; bounded claim/idempotency; separate reviewer grant, card ACL and reviewed staff/customer identity binding prevent self-review; explicit verification yields one current owner');

  const prefs = { requestId: randomUUID(), expectedPreferenceRevision: 0, visibility: 'PUBLIC', offersDisabled: true };
  await call('set_collection_preferences', prefs);
  const cardPrefs = { requestId: randomUUID(), cardId: card.id, expectedOwnershipRevision: 1, expectedPreferenceRevision: 0, visibility: 'PUBLIC', offersDisabled: true };
  await call('set_card_preferences', cardPrefs);
  const publicDisabled = await call('read_card', { cardId: card.id });
  assert.equal(publicDisabled.visibility, 'PUBLIC'); assert.equal(publicDisabled.offers.preference, 'DISABLED'); assert.equal(publicDisabled.eligibility.canReceiveOffers, false);
  await assert.rejects(call('set_card_preferences', { ...cardPrefs, requestId: randomUUID() }), { code: 'OWNERSHIP_PREFERENCE_CHANGED' });
  await assert.rejects(call('set_card_preferences', { ...cardPrefs, requestId: randomUUID() }, recipient), { code: 'OWNERSHIP_NOT_FOUND' });
  const disabled = await call('set_collection_preferences', { ...prefs, requestId: randomUUID(), expectedPreferenceRevision: 1, visibility: 'PRIVATE', offersDisabled: false });
  assert.equal(disabled.kind, 'COLLECTION_PREFERENCES_SET');
  assert.equal((await call('read_card', { cardId: card.id })).offers.preference, 'DISABLED');
  checks.push('independent owner-only per-card/empty-collection preferences with CAS; default open preference never publishes a card or enables offer delivery; prior per-card opt-out retained');

  const transferInput = (recipientId, revision = 1) => ({ requestId: randomUUID(), cardId: card.id, expectedOwnershipRevision: revision, recipientAccountId: recipientId, expiresInMinutes: 10 });
  const transfer = await call('propose_transfer', transferInput(recipient.customer.id));
  const cancel = { requestId: randomUUID(), cardId: card.id, expectedOwnershipRevision: 1, transferId: transfer.eventId };
  await assert.rejects(call('accept_transfer', cancel, outsider), { code: 'OWNERSHIP_NOT_FOUND' });
  await call('cancel_transfer', cancel);
  await assert.rejects(call('accept_transfer', { ...cancel, requestId: randomUUID() }, recipient), { code: 'OWNERSHIP_TRANSFER_UNAVAILABLE' });
  const first = await call('propose_transfer', transferInput(recipient.customer.id)), second = await call('propose_transfer', transferInput(outsider.customer.id));
  const accepts = await Promise.allSettled([[first, recipient], [second, outsider]].map(([t, who]) => call('accept_transfer', { requestId: randomUUID(), cardId: card.id, expectedOwnershipRevision: 1, transferId: t.eventId }, who)));
  assert.equal(accepts.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(accepts.find(item => item.status === 'rejected').reason.code, 'OWNERSHIP_REVISION_CHANGED');
  const winner = accepts[0].status === 'fulfilled' ? recipient : outsider;
  await assert.rejects(call('read_card', { cardId: card.id }), { code: 'OWNERSHIP_NOT_FOUND' });
  const transferred = await call('read_card', { cardId: card.id }, winner);
  assert.equal(transferred.ownership.revision, 2); assert.equal(transferred.visibility, 'PRIVATE'); assert.equal(transferred.offers.preference, 'OPEN_TO_OFFERS');
  assert.equal(transferred.custody.currentPhysicalHolder, 'UNKNOWN');
  const back = await call('propose_transfer', transferInput(owner.customer.id, 2), winner);
  await call('accept_transfer', { requestId: randomUUID(), cardId: card.id, expectedOwnershipRevision: 2, transferId: back.eventId });
  assert.equal((await call('read_card', { cardId: card.id })).offers.cardDisabled, true);
  checks.push('authenticated directed transfer/cancel, wrong recipient denial, concurrent acceptance produces one title change; prior owner loses reads; transfer changes neither custody nor money; original owner opt-out survives reacquisition');

  const r1 = await call('submit_claim', claimInput(raceCard)), r2 = await call('submit_claim', claimInput(raceCard), recipient);
  const claims = await Promise.allSettled([r1, r2].map(c => review.review(reviewer, reviewInput(raceCard, c))));
  assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(claims.find(item => item.status === 'rejected').reason.code, 'OWNERSHIP_REVISION_CHANGED');
  const rejected = await review.review(reviewer, reviewInput(selfCard, await call('submit_claim', claimInput(selfCard), recipient), 'REJECT'));
  assert.equal(rejected.kind, 'CLAIM_REJECTED');
  assert.equal((await admin.$queryRawUnsafe('SELECT atlas_ownership.current_title($1::uuid) value', selfCard.id))[0].value.status, 'UNKNOWN');
  const page = await call('read_collection', { afterCardId: null, limit: 1 });
  assert.equal(page.cards.length, 1);
  if (page.nextCardId) assert.ok((await call('read_collection', { afterCardId: page.nextCardId, limit: 1 })).cards.every(c => c.cardId > page.nextCardId));
  checks.push('competing initial claim reviews commit only one owner; rejection leaves UNKNOWN; current-owner collection keyset pages bounded and account scoped');

  assert.deepEqual(await census(), before);
  // Independent review requested controlled lock races, not timing guesses.
  // This fixture alone intentionally changes synthetic ACL/tombstone/session
  // rows after the protected-row preservation comparison above.
  const blocker = new PrismaClient({ datasources: { db: { url: fixture.database.adminUrl } } }); clients.push(blocker);
  async function hold(sql, params) {
    let unlock, ready, lockedTx;
    const admitted = new Promise(resolve => { ready = resolve; });
    const gate = new Promise(resolve => { unlock = resolve; });
    const running = blocker.$transaction(async tx => { lockedTx = tx; await tx.$queryRawUnsafe(sql, ...params); ready(); await gate; }, { timeout: 10000 });
    await admitted;
    const release = async () => { unlock(); await running; };
    release.execute = (...args) => lockedTx.$executeRawUnsafe(...args);
    return release;
  }
  async function blocked(fn) {
    for (let index = 0; index < 100; index++) {
      const [row] = await admin.$queryRawUnsafe("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1) waiting", `%atlas_ownership.${fn}%`);
      if (row.waiting) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('Expected ownership operation did not reach controlled lock');
  }
  async function discardSynthetic(c, actorId = principal.id) {
    const request = randomUUID();
    await admin.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM atlas_manual_intake.card WHERE id=$1::uuid FOR UPDATE', c.id);
      await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash) VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`, actorId, request, digest('{}'));
      await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, actorId, c.createId, c.id, request);
    });
  }
  const revokedAcl = await seed(peerPrincipal.id);
  await admin.$executeRawUnsafe('UPDATE atlas_manual.card SET revision=revision+1,readers=ARRAY[$1::uuid] WHERE id=$2::uuid', principal.id, revokedAcl.id);
  const aclClaim = await call('submit_claim', claimInput(revokedAcl));
  let release = await hold('SELECT id FROM atlas_manual.card WHERE id=$1::uuid FOR UPDATE', [revokedAcl.id]);
  // The blocker itself removes ACL, so its commit wakes a review which must
  // evaluate the current row rather than its pre-wait access snapshot.
  const aclPending = review.review(reviewer, reviewInput(revokedAcl, aclClaim));
  const aclOutcome = aclPending.then(value => ({ value }), error => ({ error }));
  await blocked('staff_call');
  await release.execute("UPDATE atlas_manual.card SET revision=revision+1,readers='{}'::uuid[] WHERE id=$1::uuid", revokedAcl.id);
  await release(); assert.equal((await aclOutcome).error?.code, 'OWNERSHIP_NOT_FOUND');
  await assert.rejects(review.review(reviewer, reviewInput(revokedAcl, aclClaim)), { code: 'OWNERSHIP_NOT_FOUND' });

  const revokeDuringWait = await seed(), waitingClaim = await call('submit_claim', claimInput(revokeDuringWait));
  release = await hold('SELECT card_id FROM atlas_manual.public_report_identity WHERE card_id=$1::uuid FOR UPDATE', [revokeDuringWait.id]);
  const waitingReview = review.review(reviewer, reviewInput(revokeDuringWait, waitingClaim)).then(value => ({ value }), error => ({ error }));
  await blocked('staff_call'); await discardSynthetic(revokeDuringWait); await release();
  assert.equal((await waitingReview).error?.code, 'OWNERSHIP_NOT_FOUND');
  const revokeCustomer = await seed();
  release = await hold('SELECT card_id FROM atlas_manual.public_report_identity WHERE card_id=$1::uuid FOR UPDATE', [revokeCustomer.id]);
  const waitingCustomer = call('submit_claim', claimInput(revokeCustomer)).then(value => ({ value }), error => ({ error }));
  await blocked('customer_call'); await discardSynthetic(revokeCustomer); await release();
  assert.equal((await waitingCustomer).error?.code, 'OWNERSHIP_NOT_FOUND');
  assert.equal((await admin.$queryRawUnsafe('SELECT count(*)::integer count FROM atlas_ownership.event WHERE card_id=$1::uuid', revokeCustomer.id))[0].count, 0);
  const expiryCard = await seed(), expiryClaim = await call('submit_claim', claimInput(expiryCard));
  release = await hold('SELECT id FROM atlas_customer."CustomerAccount" WHERE id=$1::uuid FOR UPDATE', [owner.customer.id]);
  await admin.$executeRawUnsafe("UPDATE atlas_ownership.reviewer_authority SET authorized_until=clock_timestamp()+interval '700 milliseconds' WHERE staff_id=$1::uuid", principal.id);
  const expiresDuringWait = review.review(reviewer, reviewInput(expiryCard, expiryClaim)).then(value => ({ value }), error => ({ error }));
  await blocked('staff_call');
  await new Promise(resolve => setTimeout(resolve, 750));
  await release(); assert.equal((await expiresDuringWait).error?.code, 'OWNERSHIP_REVIEW_REQUIRED');
  assert.equal((await admin.$queryRawUnsafe('SELECT atlas_ownership.current_title($1::uuid) value', expiryCard.id))[0].value.status, 'UNKNOWN');
  await admin.$executeRawUnsafe("UPDATE atlas_ownership.reviewer_authority SET authorized_until=clock_timestamp()+interval '1 hour' WHERE staff_id=$1::uuid", principal.id);
  checks.push('controlled real PostgreSQL row waits: review and customer mutation refuse a tombstone committed while waiting on permanent identity; ACL row locks serialize access and current ACL revocation denies review/replay; no event on refused claim');
  checks.push('controlled claimant-account row wait spans reviewer grant expiry; final refresh rejects verification and title stays UNKNOWN');

  for (const table of ['atlas_ownership.event', 'atlas_ownership.reviewer_authority', 'atlas_customer."CustomerAccount"', 'atlas_manual.approval']) await assert.rejects(client.$queryRawUnsafe(`SELECT * FROM ${table}`));
  await assert.rejects(client.$queryRawUnsafe('SELECT atlas_ownership.current_title($1::uuid)', card.id));
  await assert.rejects(client.$executeRawUnsafe('DELETE FROM atlas_ownership.event'));
  await assert.rejects(admin.$executeRawUnsafe("UPDATE atlas_ownership.event SET kind='CLAIM_REJECTED' WHERE id=$1::uuid", claim.eventId));
  await assert.rejects(admin.$executeRawUnsafe('DELETE FROM atlas_ownership.event WHERE id=$1::uuid', claim.eventId));
  const handle = auth.authority(owner.cookie), readInput = { cardId: card.id };
  assert.equal((await raw('read_card', readInput, owner, { ...config.binding, releaseSha: 'f'.repeat(40) })).error.code, 'CUSTOMER_ACCESS_NOT_ENABLED');
  assert.equal((await raw('read_card', readInput, owner, config.binding, { ...handle, browserHash: 'e'.repeat(64) })).error.code, 'SIGN_IN_REQUIRED');
  assert.equal((await raw('set_card_preferences', { ...cardPrefs, accountId: recipient.customer.id })).error.code, 'INVALID_OWNERSHIP_REQUEST');
  assert.equal((await raw('submit_claim', { ...claimInput(selfCard), evidence: { referenceId: randomUUID(), sha256: Number('1'.repeat(64)) } })).error.code, 'INVALID_OWNERSHIP_REQUEST');
  const revokedSenderTransfer = await call('propose_transfer', transferInput(recipient.customer.id, 3));
  await admin.$executeRawUnsafe('UPDATE atlas_customer."CustomerAccount" SET "revokedAt"=clock_timestamp() WHERE id=$1::uuid', owner.customer.id);
  await assert.rejects(call('accept_transfer', { requestId: randomUUID(), cardId: card.id, expectedOwnershipRevision: 3, transferId: revokedSenderTransfer.eventId }, recipient), { code: 'OWNERSHIP_TRANSFER_UNAVAILABLE' });
  await admin.$executeRawUnsafe('UPDATE atlas_customer."CustomerSession" SET "revokedAt"=clock_timestamp() WHERE "tokenHash"=$1', handle.sessionHash);
  await assert.rejects(call('read_card', readInput), { code: 'SIGN_IN_REQUIRED' });
  await assert.rejects(call('set_collection_preferences', { ...prefs, requestId: randomUUID(), expectedPreferenceRevision: 2 }), { code: 'SIGN_IN_REQUIRED' });
  await admin.$executeRawUnsafe('UPDATE atlas_ownership.reviewer_authority SET revoked_at=clock_timestamp() WHERE staff_id=$1::uuid', principal.id);
  await assert.rejects(review.review(reviewer, decision), { code: 'OWNERSHIP_REVIEW_REQUIRED' });
  checks.push('least-privilege role cannot read private tables/helpers or mutate journal; append-only guards; forged account/binding/browser and revoked customer/reviewer fail; all protected grading/custody/commerce rows byte-for-byte preserved');
  result = { pass: true, checks, node: process.version, postgres: fixture.cluster.source?.version ?? '17', proposalSha256: digest(proposal),
    syntheticOnly: true, productionQueries: 0, externalProviderCalls: 0, notificationEffects: 0, financialEffects: 0, ownedCluster: fixture.cluster.directory };
} catch (error) {
  result = { pass: false, checks, error: { name: error.name, code: error.code, message: error.message }, syntheticOnly: true };
  throw error;
} finally {
  await Promise.all(clients.map(client => client.$disconnect()));
  await fixture.stop();
  const stopped = JSON.parse(await readFile(resolve(fixture.cluster.directory, 'cleanup.json'), 'utf8').catch(() => '{}'));
  result = { ...result, stoppedVerified: stopped.stoppedVerified ?? stopped.stopped ?? false };
  await writeFile(resolve(output, 'postgres-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify(result) + '\n');
}
