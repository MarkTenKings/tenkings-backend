// Explicitly owned PostgreSQL17 only. Not a serving dependency or automatic test.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '../../../../frontend/atlas-app/.generated/staff-database/index.js';
import { CustomerAuth } from '../../../../frontend/atlas-customer/lib/server/auth.mjs';
import { CustomerDatabase } from '../../../../frontend/atlas-customer/lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../../../../frontend/atlas-customer/lib/server/fixture.mjs';
import { createOwnedManualFixture } from '../../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../../atlas-manual-service/src/contract.mjs';
import { createCardOwnershipReadService, cardOwnershipReadGrantSQL } from '../../src/card-ownership-read-service.mjs';

const output = process.env.ATLAS_CARD_OWNERSHIP_READER_EVIDENCE;
assert(output && resolve(output) === output, 'Absolute new evidence directory required');
await mkdir(output, { mode: 0o700 });
const writer = await readFile(new URL('../../sql/card-ownership-proposal.sql', import.meta.url), 'utf8');
assert.equal(digest(writer), '00720728d42a1276d50c70998d22e9e309cec2b1bb5cdd9ba8c7126e16fc36a2');
const reader = await readFile(new URL('../../sql/card-ownership-reader-proposal.sql', import.meta.url), 'utf8');
const fixture = await createOwnedManualFixture(process.argv.slice(2)), clients = [], checks = [];
let result;
try {
  await fixture.cluster.sql(writer, [], fixture.database.name);
  await fixture.cluster.sql(reader, [], fixture.database.name);
  const admin = fixture.admin, staffId = (await admin.$queryRawUnsafe('SELECT id FROM atlas_staff."StaffIdentity" ORDER BY id LIMIT 1'))[0].id;
  const customerClient = new PrismaClient({ datasources: { db: { url: fixture.database.customerUrl } } }); clients.push(customerClient);
  const config = localConfig({ databaseUrl: fixture.database.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
  const auth = new CustomerAuth({ database: new CustomerDatabase(customerClient, config), config, provider: fixtureProvider(config) });
  await admin.$executeRawUnsafe('INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash") VALUES(true,$1,$2,$3,$4,$5)', config.mode, config.origin, config.deploymentId, config.releaseSha, config.configHash);
  async function login(phone) {
    const boot = await auth.bootstrap('', 'reader-fixture'), initial = `${config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'reader-fixture');
    const signed = await auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'reader-fixture');
    return { ...signed, cookie: `${initial}; ${config.cookies.session}=${signed.token}` };
  }
  const owner = await login('+12025550321'), other = await login('+12025550322'), revoked = await login('+12025550323'), expiring = await login('+12025550324');
  const role = 'atlas_fixture_ownership_reader', password = randomBytes(24).toString('hex');
  await fixture.cluster.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await fixture.cluster.sql(cardOwnershipReadGrantSQL(role), [], fixture.database.name);
  const url = new URL(fixture.database.adminUrl); url.username = role; url.password = password;
  const client = new PrismaClient({ datasources: { db: { url: url.href } } }); clients.push(client);
  const service = createCardOwnershipReadService({ auth, client });
  const read = (action, input, who = owner) => service.read(who.cookie, action, input);
  const raw = async (action, input, who = owner, binding = config.binding, proof = auth.authority(who.cookie)) =>
    (await client.$queryRawUnsafe('SELECT atlas_ownership.customer_read($1,$2,$3::jsonb,$4,$5::jsonb) result', proof.sessionHash, proof.browserHash, JSON.stringify(binding), action, JSON.stringify(input)))[0].result;
  async function publish(c, version = 1, published = true) {
    const actionId = randomUUID(), report = canonical({ version: 'atlas-manual-report-snapshot-v2', identity: { playerName: 'SYNTHETIC reader fixture' }, finalGrade: version + 6 });
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,$5,$5+1,$4,'{}','{}')", c.id, actionId, staffId, digest('{}'), version);
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1::uuid,$2::uuid,$3::uuid,$7,$4,$5,$6)', c.id, actionId, staffId, digest('fixture-source'), digest(report), report, version);
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,$3,'LOCAL_FIXTURE')", c.id, actionId, version);
    const publicHash = digest(`fixture-public-${actionId}`);
    if (published) await admin.$executeRawUnsafe("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest='{}',manifest_hash=$1,public_hash=$2,published_at=clock_timestamp() WHERE card_id=$3::uuid AND action_id=$4::uuid", digest('{}'), publicHash, c.id, actionId);
    return { actionId, version, publicHash };
  }
  async function seed({ published = true } = {}) {
    const c = { id: randomUUID(), createId: randomUUID(), token: `ar_${randomUUID().replaceAll('-', '').slice(0, 24)}` };
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)', c.id, randomUUID(), staffId, c.createId, digest(c.createId), 'SYNTHETIC reader fixture');
    await admin.$executeRawUnsafe("INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,'{}',$2,$3::uuid)", c.id, digest('{}'), staffId);
    await admin.$executeRawUnsafe('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)', c.id, c.token, `ATLAS-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`);
    return { ...c, approved: await publish(c, 1, published) };
  }
  // Direct synthetic title seeding belongs solely to this disposable fixture.
  // It is not an evidence review, production backfill or writer acceptance.
  async function title(c, accountId, revision = 1) {
    await admin.$executeRawUnsafe("INSERT INTO atlas_ownership.event(card_id,staff_id,request_id,action,input,input_hash,kind,owner_account_id,ownership_revision) VALUES($1::uuid,$2::uuid,$3::uuid,'fixture-only','{}',$4,'CLAIM_VERIFIED',$5::uuid,$6)", c.id, staffId, randomUUID(), digest('synthetic-event'), accountId, revision);
  }
  const first = await seed(), second = await seed(), unknown = await seed(), transferred = await seed(), unpublished = await seed({ published: false }), discarded = await seed();
  for (const c of [first, second, transferred, unpublished, discarded]) await title(c, owner.customer.id);
  await title(transferred, other.customer.id, 2);
  await publish(first, 2, false);
  const discardId = randomUUID();
  await admin.$executeRawUnsafe("INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash) VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)", staffId, discardId, digest('{}'));
  await admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)', staffId, discarded.createId, discarded.id, discardId);
  const tables = ['atlas_ownership.event', 'atlas_manual.card', 'atlas_manual.action', 'atlas_manual.approval', 'atlas_manual.publication', 'atlas_manual.public_report_identity',
    'atlas_manual_intake.card', 'atlas_manual_intake.discard_request', 'atlas_manual_intake.discarded_card', 'atlas_customer."CustomerAccount"', 'atlas_customer."CustomerSession"', 'atlas_customer."CustomerBrowser"', 'atlas_customer."CustomerControl"',
    'atlas_dealer.custody_event', 'atlas_dealer.manual_card_link', 'atlas_customer."CommerceOrder"', 'atlas_customer."CommercePayment"'];
  async function census() {
    const rows = {};
    for (const table of tables) rows[table] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) value FROM ${table} t`))[0].value;
    return digest(canonical(rows));
  }
  const before = await census(), all = await read('read_collection', { afterCardId: null, limit: 50 });
  assert.deepEqual(all.cards.map(c => c.cardId), [first.id, second.id].sort()); assert.equal(all.nextCardId, null);
  assert.equal(all.preferences.visibility, 'PRIVATE'); assert.equal(all.preferences.offersDisabled, false);
  const p1 = await read('read_collection', { afterCardId: null, limit: 1 }), p2 = await read('read_collection', { afterCardId: p1.nextCardId, limit: 1 });
  assert.equal(p1.nextCardId, p1.cards[0].cardId); assert.equal(p2.nextCardId, null); assert.ok(p1.cards[0].cardId < p2.cards[0].cardId);
  assert.equal((await read('read_preferences', {}, other)).accountId, other.customer.id);
  assert.deepEqual((await read('read_collection', { afterCardId: null, limit: 50 }, revoked)).cards, []);
  const view = await read('read_card', { cardId: first.id });
  assert.equal(view.approvedCard.approvalActionId, first.approved.actionId); assert.equal(view.approvedCard.report.version, 1); assert.equal(view.approvedCard.report.publicHash, first.approved.publicHash);
  assert.equal(view.offers.preference, 'OPEN_TO_OFFERS'); assert.equal(view.eligibility.canReceiveOffers, false); assert.equal(view.custody.currentPhysicalHolder, 'UNKNOWN');
  for (const c of [unknown, transferred, unpublished, discarded]) await assert.rejects(read('read_card', { cardId: c.id }), { code: 'OWNERSHIP_NOT_FOUND' });
  assert.equal((await read('read_card', { cardId: transferred.id }, other)).ownership.revision, 2);
  checks.push('real reader sessions; three read actions, empty and two-page current collection; latest owner wins globally; unknown/discarded/unpublished excluded; newer pending approval cannot splice published binding');

  for (const action of ['submit_claim', 'review_claim', 'propose_transfer', 'accept_transfer', 'cancel_transfer', 'set_card_preferences', 'set_collection_preferences']) assert.equal((await raw(action, {})).error.code, 'OWNERSHIP_READ_ONLY');
  for (const table of ['atlas_ownership.event', 'atlas_ownership.reviewer_authority', 'atlas_customer."CustomerAccount"', 'atlas_manual.approval']) await assert.rejects(client.$queryRawUnsafe(`SELECT * FROM ${table}`));
  for (const sql of ['SELECT atlas_ownership.customer_call(NULL,NULL,NULL,NULL,NULL)', 'SELECT atlas_ownership.staff_call(NULL,NULL,NULL,NULL,NULL)',
    'SELECT atlas_ownership.current_title(NULL)', "SELECT nextval('atlas_ownership.event_sequence_seq')", 'DELETE FROM atlas_ownership.event']) await assert.rejects(client.$queryRawUnsafe(sql));
  const proof = auth.authority(owner.cookie);
  assert.equal((await raw('read_preferences', {}, owner, { ...config.binding, releaseSha: 'f'.repeat(40) })).error.code, 'CUSTOMER_ACCESS_NOT_ENABLED');
  assert.equal((await raw('read_preferences', {}, owner, config.binding, { ...proof, browserHash: 'e'.repeat(64) })).error.code, 'SIGN_IN_REQUIRED');
  assert.equal((await raw('read_collection', { afterCardId: null, limit: 1, accountId: other.customer.id })).error.code, 'INVALID_OWNERSHIP_REQUEST');
  assert.equal((await raw('read_preferences', {}, owner, { ...config.binding, accountId: owner.customer.id })).error.code, 'CUSTOMER_ACCESS_NOT_ENABLED');
  checks.push('raw SQL reader refuses all mutation actions; serving role cannot call writers/helpers, read private tables, change journal or use identity sequence; forged binding/browser/account input rejected');

  await fixture.cluster.sql(`GRANT USAGE ON SEQUENCE atlas_ownership.event_sequence_seq TO ${role}`, [], fixture.database.name);
  await assert.rejects(read('read_preferences', {}), { code: 'OWNERSHIP_READ_DATABASE_ROLE_INVALID' });
  await fixture.cluster.sql(`REVOKE ALL ON SEQUENCE atlas_ownership.event_sequence_seq FROM ${role}`, [], fixture.database.name);
  await fixture.cluster.sql(`GRANT EXECUTE ON FUNCTION atlas_ownership.customer_call(text,text,jsonb,text,jsonb) TO ${role}`, [], fixture.database.name);
  await assert.rejects(read('read_preferences', {}), { code: 'OWNERSHIP_READ_DATABASE_ROLE_INVALID' });
  await fixture.cluster.sql(`REVOKE ALL ON FUNCTION atlas_ownership.customer_call(text,text,jsonb,text,jsonb) FROM ${role}`, [], fixture.database.name);
  assert.equal((await read('read_preferences', {})).accountId, owner.customer.id);
  assert.equal(await census(), before);
  checks.push('effective sequence or mutator privilege drift refuses before reader call; restored narrow role works; all17 protected fixture table commitments unchanged across reads/refusals');

  const revokedProof = auth.authority(revoked.cookie);
  await admin.$executeRawUnsafe('UPDATE atlas_customer."CustomerSession" SET "revokedAt"=clock_timestamp() WHERE "tokenHash"=$1', revokedProof.sessionHash);
  await assert.rejects(read('read_preferences', {}, revoked), { code: 'SIGN_IN_REQUIRED' });
  const blocker = new PrismaClient({ datasources: { db: { url: fixture.database.adminUrl } } }); clients.push(blocker);
  let unlock, ready;
  const held = new Promise(resolve => { ready = resolve; }), release = new Promise(resolve => { unlock = resolve; });
  const lock = blocker.$transaction(async tx => { await tx.$queryRawUnsafe('SELECT id FROM atlas_customer."CustomerAccount" WHERE id=$1::uuid FOR UPDATE', expiring.customer.id); ready(); await release; }, { timeout: 5000 });
  await held;
  const expiryProof = auth.authority(expiring.cookie);
  await admin.$executeRawUnsafe('UPDATE atlas_customer."CustomerSession" SET "expiresAt"=clock_timestamp()+interval \'650 milliseconds\' WHERE "tokenHash"=$1', expiryProof.sessionHash);
  const pending = read('read_preferences', {}, expiring).then(value => ({ value }), error => ({ error }));
  let waiting = false;
  try {
    for (let i = 0; i < 80; i++) {
      waiting = (await admin.$queryRawUnsafe("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%atlas_ownership.customer_read(%') waiting"))[0].waiting;
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert(waiting, 'Reader must reach controlled account lock');
    await new Promise(resolve => setTimeout(resolve, 700));
  } finally { unlock(); await lock; }
  assert.equal((await pending).error?.code, 'SIGN_IN_REQUIRED');
  checks.push('revoked session rejected; actual controlled account lock spans session expiry and final refresh refuses private response');
  result = { pass: true, checks, node: process.version, writerSha256: digest(writer), readerSha256: digest(reader), protectedTableCount: tables.length,
    preservationSha256: before, syntheticOnly: true, productionQueries: 0, externalProviderCalls: 0, notificationEffects: 0, financialEffects: 0, ownedCluster: fixture.cluster.directory };
} catch (error) {
  result = { pass: false, checks, error: { name: error.name, code: error.code, message: error.message }, syntheticOnly: true, productionQueries: 0, externalProviderCalls: 0 };
  throw error;
} finally {
  await Promise.all(clients.map(client => client.$disconnect()));
  await fixture.stop();
  const cleanup = JSON.parse(await readFile(resolve(fixture.cluster.directory, 'cleanup.json'), 'utf8'));
  result = { ...result, stoppedVerified: cleanup.stoppedVerified ?? cleanup.stopped ?? false, cleanupPath: resolve(fixture.cluster.directory, 'cleanup.json') };
  await writeFile(resolve(output, 'postgres-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify(result) + '\n');
}
