// Harness-owned local PostgreSQL only. No provider, external database or live data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../atlas-manual-service/src/contract.mjs';
import { createGradedCardsService, gradedCardsGrantSQL, gradedCardsListInput, validateGradedCardsConfiguration } from '../src/graded-cards.mjs';
import { createConnectedHandler } from '../src/http.mjs';
import { registeredMigrations } from '../../atlas-standalone-database/registered-migrations.mjs';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../../atlas-standalone-database/migrate.mjs';

const output = process.env.ATLAS_GRADED_CARDS_EVIDENCE;
assert(output && resolve(output) === output, 'Absolute evidence directory required');
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2)), connection = fixture.connect(), checks = [];
let receipt;
try {
  await fixture.cluster.sql(gradedCardsGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  const { auth, boundary, manualClient } = connection, admin = fixture.admin, service = createGradedCardsService({ auth, boundary });
  await validateGradedCardsConfiguration({ client: manualClient });
  async function login(phone) {
    const boot = await auth.bootstrap(''), browser = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(browser, boot.csrf, { phone, requestId: randomUUID() }, 'archive-fixture');
    const signed = await auth.verify(browser, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'archive-fixture');
    const cookie = `${browser}; ${fixture.config.cookies.session}=${signed.token}`;
    return { staff: await auth.authenticate(cookie, signed.csrf), cookie };
  }
  const reviewer = await login('+12025550141'), observer = await login('+12025550142'), other = await login('+12025550143');
  const actor = await boundary.transaction(reviewer.staff, ({ principal }) => principal), peer = await boundary.transaction(other.staff, ({ principal }) => principal);
  await admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET name=$1 WHERE id=$2::uuid', 'Approval Specialist', actor.id);
  await admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET name=$1 WHERE id=$2::uuid', 'Review Colleague', peer.id);
  const hashes = { content: digest('{}'), source: digest('approved-source'), public: digest('approved-public') };
  async function approve(card, { identity = card.identity, approvedAt = null, published = true } = {}) {
    const actionId = randomUUID(), version = ++card.version, sourceRevision = version * 2;
    const report = canonical({ version: 'atlas-manual-report-snapshot-v2', identity, finalGrade: version === 1 ? 9.5 : 8, ruleVersion: 'SYNTHETIC_ONLY' });
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)`, card.id, randomUUID(), peer.id, sourceRevision - 1, sourceRevision,
      digest('{"action":{"type":"CONFIRM_FINDINGS"}}'), '{"action":{"type":"CONFIRM_FINDINGS"}}', '{"receipt":{"actorKind":"HUMAN"}}');
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)`, card.id, actionId, actor.id, sourceRevision, sourceRevision + 1,
      digest('{"action":{"type":"APPROVE_REPORT"}}'), '{"action":{"type":"APPROVE_REPORT"}}', '{"receipt":{"actorKind":"HUMAN"}}');
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report,approved_at)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,COALESCE($8::timestamptz,clock_timestamp()))`, card.id, actionId, actor.id, sourceRevision, hashes.source, digest(report), report, approvedAt);
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,$3,'LOCAL_FIXTURE')`, card.id, actionId, version);
    if (published) await admin.$executeRawUnsafe(`UPDATE atlas_manual.publication SET state='PUBLISHED',manifest='{}',manifest_hash=$1,public_hash=$2,published_at=clock_timestamp() WHERE card_id=$3::uuid AND action_id=$4::uuid`, hashes.content, hashes.public, card.id, actionId);
    return actionId;
  }
  async function seed({ identity = { playerName: 'Synthetic Jordan', year: '1992', manufacturer: 'Fleer', productSet: 'Fixture', cardNumber: '23' }, owner = actor.id, readers = [], approvedAt = '2026-01-10T23:59:59.999999Z', published = true, approved = true } = {}) {
    const card = { id: randomUUID(), createId: randomUUID(), identity, owner, version: 0, token: `ar_${randomUUID().replaceAll('-', '').slice(0, 24)}`, certificate: `ATLAS-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}` };
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'Synthetic archive')`, card.id, randomUUID(), owner, card.createId, digest(card.createId));
    const mutable = '{"identity":{"playerName":"UNAPPROVED SECRET DRAFT"}}';
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,readers) VALUES($1::uuid,10,$2,$3,$4::uuid,$5::uuid[])`, card.id, mutable, digest(mutable), owner, readers);
    if (approved) {
      await admin.$executeRawUnsafe('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)', card.id, card.token, card.certificate);
      card.actionId = await approve(card, { approvedAt, published });
    }
    return card;
  }
  async function discard(card) {
    const requestId = randomUUID();
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash) VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`, card.owner, requestId, hashes.content);
    await admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, card.owner, card.createId, card.id, requestId);
  }
  const first = await seed({ identity: { playerName: 'Synthetic 100%_Jordan', year: '1992', productSet: 'Fixture', cardNumber: '23' } });
  const second = await seed({ identity: { cardName: 'Synthetic Mewtwo', year: '1999', productSet: 'Base', cardNumber: '10' }, approvedAt: '2026-01-10T00:00:00.000000Z', published: false });
  const third = await seed({ approvedAt: '2026-01-09T23:59:59.999999Z' });
  const hidden = await seed({ owner: peer.id }), shared = await seed({ owner: peer.id, readers: [actor.id], approvedAt: '2026-01-08T01:00:00.123456Z' });
  const deleted = await seed(); await discard(deleted); await seed({ approved: false });

  // Actual immutable paid order -> intake card -> physical receipt -> manual card link.
  await admin.$executeRawUnsafe(`INSERT INTO atlas_customer."WeeklyCapacitySharedPolicy"("effectiveWeekStartsAt","quotaCards","authorizationReference") SELECT "weekStartsAt",1000,'Synthetic archive fixture' FROM atlas_customer.weekly_capacity_week(statement_timestamp())`);
  await admin.$executeRawUnsafe(`INSERT INTO atlas_customer."WeeklyCapacityConfig"(channel) VALUES('DEALER_DROP_OFF') ON CONFLICT DO NOTHING`);
  const customerId = randomUUID(), orderId = randomUUID(), draftId = randomUUID(), quoteId = randomUUID(), paymentId = randomUUID(), customerCard = randomUUID(), dealerId = randomUUID(), locationId = randomUUID();
  await admin.$executeRawUnsafe('INSERT INTO atlas_customer."CustomerAccount"(id,"phoneHash",phone) VALUES($1::uuid,$2,$3)', customerId, digest(customerId), '+12025550301');
  await admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CustomerVerifiedEmail"("accountId",email) VALUES($1::uuid,'private@example.invalid')`, customerId);
  await admin.$executeRawUnsafe(`INSERT INTO atlas_dealer.location(id,dealer_id,name,address,latitude,longitude,schedule,terminal_id,terminal_location_id,package_printer_id,entry_token,authorized_until,configured_by)
   VALUES($1::uuid,$2::uuid,'Synthetic Cedar Cards','{"line1":"1 Fixture Lane","city":"Example","region":"CA","postalCode":"90001","country":"US"}',0,0,'{"timeZone":"America/Los_Angeles","pickups":[{"weekday":1,"time":"12:00","cutoff":"11:00"}],"returns":[{"weekday":2,"time":"12:00"}],"exceptions":[]}','synthetic','synthetic','synthetic',$3,clock_timestamp()+interval '1 day',$4::uuid)`, locationId, dealerId, 'A'.repeat(32), actor.id);
  await admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CustomerIntakeDraft"(id,"accountId","requestId","inputHash","intakeMethod","kioskId",state) VALUES($1::uuid,$2::uuid,$3::uuid,$4,'DEALER_DROP_OFF',$5::uuid,'ORDERED')`, draftId, customerId, randomUUID(), hashes.content, locationId);
  const identity = { category: 'SPORTS', title: 'Synthetic submitted card', playerName: 'Synthetic player', year: '', manufacturer: '', setName: '', cardNumber: '', parallel: '', insert: '' };
  await admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CustomerIntakeCard"(id,"draftId","requestId","pairId","inputHash",identity,"identityState","identitySource") VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::jsonb,'READY','CUSTOMER_CORRECTION')`, customerCard, draftId, randomUUID(), randomUUID(), hashes.content, JSON.stringify(identity));
  const snapshot = { channel: 'KIOSK', draftId, accountId: customerId, cards: [{ cardId: customerCard, identity, unitCents: 5000, commissionCents: 500 }],
    location: { id: locationId, dealerId, name: 'Synthetic Cedar Cards' }, profile: { name: 'Synthetic Submitter', email: 'private@example.invalid', address1: 'Private address' },
    gradingCents: 5000, gradingTaxCents: 0, taxCents: 0, shippingCents: 0, totalCents: 5000, terms: {} };
  await admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt") VALUES($1::uuid,$2::uuid,$3::uuid,1,$4,$5::jsonb,clock_timestamp()+interval '1 hour')`, quoteId, customerId, draftId, hashes.content, JSON.stringify(snapshot));
  await admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,"providerId",state) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'{}','synthetic-payment-only','PAID')`, paymentId, customerId, draftId, quoteId, randomUUID());
  await admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CommerceOrder"(id,"accountId","draftId","quoteId","paymentId",reference,receipt,"paidAt") VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'SYN-ARCHIVE-ORDER',$6::jsonb,clock_timestamp())`, orderId, customerId, draftId, quoteId, paymentId, JSON.stringify(snapshot));
  const receiptId = randomUUID();
  await admin.$executeRawUnsafe(`INSERT INTO atlas_dealer.custody_event(id,card_id,sequence,request_id,input_hash,kind,actor_id,occurred_at,evidence) VALUES($1::uuid,$2::uuid,1,$3::uuid,$4,'ATLAS_RECEIVED',$5::uuid,clock_timestamp(),'{"reference":"Synthetic actual-receipt fixture"}')`, receiptId, customerCard, randomUUID(), hashes.content, actor.id);
  await admin.$executeRawUnsafe(`INSERT INTO atlas_dealer.manual_card_link(card_id,manual_card_id,received_event_id,actor_id,evidence_ref) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'Synthetic immutable binding')`, customerCard, first.id, receiptId, actor.id);
  const census = async () => {
    const rows = {};
    for (const table of ['atlas_manual.card', 'atlas_manual.action', 'atlas_manual.approval', 'atlas_manual.public_report_identity', 'atlas_manual.publication', 'atlas_manual_intake.card', 'atlas_manual_intake.discarded_card', 'atlas_dealer.manual_card_link', 'atlas_dealer.custody_event', 'atlas_customer."CommerceOrder"', 'atlas_customer."CommercePayment"', 'atlas_customer."CommerceEffect"'])
      rows[table] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) rows FROM ${table} t`))[0].rows;
    return rows;
  };
  const before = await census(), all = await service.list(reviewer.staff);
  assert.equal(all.cards.length, 4); assert(!all.cards.some(c => [hidden.id, deleted.id].includes(c.cardId)));
  const one = all.cards.find(c => c.cardId === first.id);
  assert.equal(one.identity.playerName, 'Synthetic 100%_Jordan'); assert.equal(one.finalGrade, 9.5); assert.equal(one.certificateNumber, first.certificate);
  assert.deepEqual(one.submission.customer, { name: 'Synthetic Submitter' }); assert.equal(one.submission.orderId, orderId); assert.equal(one.submission.dealer.name, 'Synthetic Cedar Cards');
  assert.equal(one.approver.name, 'Approval Specialist'); assert.deepEqual(one.reviewers, [{ id: peer.id, name: 'Review Colleague' }]);
  assert.equal(all.cards.find(c => c.cardId === second.id).report.path, null); assert.deepEqual(all.cards.find(c => c.cardId === second.id).media, {});
  assert.doesNotMatch(JSON.stringify(all), /private@example|Private address|synthetic-payment|accountId|ownerId|sourceHash|mediaEvidence|UNAPPROVED SECRET/);
  checks.push('actual least-privilege staff service reads approved immutable identity, grade/cert/version, named review actors and minimal paid submission; excludes drafts, inaccessible and discarded cards');
  for (const q of ['100%', '_Jordan', first.certificate, 'Synthetic Submitter', 'SYN-ARCHIVE-ORDER', 'Cedar Cards', 'drop-off']) assert.deepEqual((await service.list(reviewer.staff, { q })).cards.map(c => c.cardId), [first.id], q);
  for (const q of ['Approval Specialist', 'Review Colleague']) assert.equal((await service.list(reviewer.staff, { q })).cards.length, 4);
  for (const q of ["' OR true --", 'private@example.invalid', 'Private address', 'UNAPPROVED SECRET']) assert.equal((await service.list(reviewer.staff, { q })).cards.length, 0, q);
  assert.deepEqual((await service.list(reviewer.staff, { category: 'POKEMON' })).cards.map(c => c.cardId), [second.id]);
  assert.deepEqual((await service.list(reviewer.staff, { from: '2026-01-10', to: '2026-01-10' })).cards.map(c => c.cardId), [first.id, second.id]);
  assert.deepEqual(await census(), before);
  checks.push('literal punctuation/SQL-like search, cert/name/reviewer/approver/submission/dealer/channel search, category and inclusive UTC microsecond date boundaries pass with zero protected-row changes');

  const page1 = await service.list(reviewer.staff, { limit: 1 }); assert.equal(page1.cards[0].cardId, first.id);
  await approve(third, { identity: { playerName: 'NEW APPROVAL AFTER SNAPSHOT' } });
  const newcomers = await seed({ identity: { playerName: 'NEW CARD AFTER SNAPSHOT' }, approvedAt: null });
  const ids = [first.id]; let cursor = page1.nextCursor, historicalThird;
  while (cursor) { const page = await service.list(reviewer.staff, { limit: 1, cursor }); assert.equal(page.cards.length, 1); ids.push(page.cards[0].cardId); if (page.cards[0].cardId === third.id) historicalThird = page.cards[0]; cursor = page.nextCursor; }
  assert.deepEqual(ids, [first.id, second.id, third.id, shared.id]); assert.equal(historicalThird.report.version, 1); assert.equal(historicalThird.identity.playerName, 'Synthetic Jordan');
  const latest = await service.list(reviewer.staff); assert.equal(latest.cards[0].cardId, newcomers.id); assert.equal(latest.cards.find(c => c.cardId === third.id).report.version, 2);
  const revokePage = await service.list(reviewer.staff, { limit: 1 });
  await admin.$executeRawUnsafe('UPDATE atlas_manual.card SET readers=ARRAY[]::uuid[],revision=revision+1 WHERE id=$1::uuid', shared.id);
  const revoked = await service.list(reviewer.staff, { cursor: revokePage.nextCursor }); assert(!revoked.cards.some(c => c.cardId === shared.id));
  checks.push('fixed snapshot keyset pages retain microseconds and one physical card across new approvals/new cards without skips or duplicates; current ACL revocation still applies');

  await assert.rejects(service.list(observer.staff), { code: 'STAFF_REQUIRED' }); await assert.rejects(service.list({ ...reviewer.staff }), { code: 'SIGN_IN_REQUIRED' });
  const handle = auth.actors.get(reviewer.staff), binding = Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(k => [k, auth.config[k]]));
  const direct = async (query = gradedCardsListInput(), overrides = {}) => (await manualClient.$queryRawUnsafe('SELECT atlas_manual.graded_cards($1,$2,$3::jsonb,$4::text[],$5::jsonb) AS result',
    overrides.sessionHash ?? handle.sessionHash, overrides.browserHash ?? handle.browserHash, JSON.stringify(overrides.binding ?? binding), overrides.phones ?? [...auth.config.phoneByHash.keys()], JSON.stringify(query)))[0].result;
  for (const overrides of [{ sessionHash: '0'.repeat(64) }, { browserHash: '0'.repeat(64) }, { binding: { ...binding, releaseSha: '9'.repeat(40) } }, { phones: [] }, auth.actors.get(observer.staff)]) assert.equal((await direct(undefined, overrides)).error.code, 'STAFF_REQUIRED');
  for (const query of [{ ...gradedCardsListInput(), accountId: customerId }, { ...gradedCardsListInput(), limit: 51 }, { ...gradedCardsListInput(), from: '2026-02-30' }, { ...gradedCardsListInput(), page: { v: 1, filter: 'a'.repeat(64), snapshot: '2999-01-01T00:00:00.000000Z', approvedAt: '2026-01-10T00:00:00.000000Z', cardId: first.id } }]) assert.equal((await direct(query)).error.code, 'INVALID_GRADED_CARDS_QUERY');
  await assert.rejects(manualClient.$queryRawUnsafe('SELECT * FROM atlas_customer."CommerceOrder"'), /permission denied/);
  await assert.rejects(manualClient.$queryRawUnsafe('SELECT * FROM atlas_staff."StaffIdentity"'), /permission denied/);
  const privilege = await admin.$queryRawUnsafe("SELECT has_function_privilege('atlas_fixture_customer','atlas_manual.graded_cards(text,text,jsonb,text[],jsonb)','EXECUTE') allowed"); assert.equal(privilege[0].allowed, false);
  checks.push('actual SQL independently rejects forged session/browser/release/roster, observer and malformed arguments; customer cannot execute; manual role gains no private table SELECT');

  const handler = createConnectedHandler({ connected: { intake: {}, workflow: {}, gradedCards: service }, boundary, origin: fixture.config.origin, assertRequest: async () => {} });
  const result = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(body) { this.body = body; } };
  await handler({ method: 'GET', url: '/api/staff/manual-connected/graded-cards?q=SYN-ARCHIVE-ORDER', headers: { cookie: reviewer.cookie } }, result);
  assert.equal(result.code, 200); assert.equal(result.body.cards[0].cardId, first.id); assert.equal(result.headers['Cache-Control'], 'private, no-store');
  await admin.$executeRawUnsafe('UPDATE atlas_staff."StaffSession" SET "revokedAt"=clock_timestamp() WHERE "tokenHash"=$1', handle.sessionHash);
  await assert.rejects(service.list(reviewer.staff), { code: 'SIGN_IN_REQUIRED' });
  checks.push('actual connected HTTP handler reaches authenticated database service and cache-private DTO; revoked session fails on the next list read');

  const manifest = await registeredMigrations(), current = manifest.at(-1); assert.equal(current.version, 'atlas-standalone-008-graded-cards-archive');
  // Replay the additive release against a separately owned prefix-007 database.
  // Its rows come only from the synthetic database above, never a live source.
  const { Client } = createRequire(import.meta.url)(process.argv[process.argv.indexOf('--pg-module') + 1]);
  const upgradeName = 'atlas_archive_upgrade';
  await fixture.cluster.sql(`CREATE DATABASE ${upgradeName}`);
  const upgrade = new Client({ connectionString: fixture.cluster.url(upgradeName) });
  await upgrade.connect();
  try {
    await applyStandaloneBaseline(upgrade);
    for (const migration of manifest.slice(0, -1)) {
      await upgrade.query('BEGIN');
      await upgrade.query(migration.sql);
      await upgrade.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)', [migration.version, migration.sqlSha256]);
      await upgrade.query('COMMIT');
    }
    const tables = ['atlas_staff."StaffIdentity"', 'atlas_manual.card', 'atlas_manual.action', 'atlas_manual.approval', 'atlas_manual.public_report_identity', 'atlas_manual.publication'];
    for (const table of tables) {
      const { rows: [source] } = await fixture.cluster.sql(`SELECT jsonb_agg(to_jsonb(t)) AS rows FROM ${table} t`, [], fixture.database.name);
      if (table === 'atlas_manual.publication') {
        for (const row of source.rows) {
          await upgrade.query('INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1,$2,$3,$4)', [row.card_id, row.action_id, row.version, row.mode]);
          if (row.state === 'PUBLISHED') await upgrade.query('UPDATE atlas_manual.publication SET state=$1,manifest=$2,manifest_hash=$3,public_hash=$4,published_at=$5 WHERE card_id=$6 AND action_id=$7',
            [row.state, row.manifest, row.manifest_hash, row.public_hash, row.published_at, row.card_id, row.action_id]);
        }
      } else await upgrade.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`, [JSON.stringify(source.rows)]);
    }
    const censusUpgrade = async () => {
      const value = {};
      for (const table of tables) value[table] = (await upgrade.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS rows FROM ${table} t`)).rows[0].rows;
      return value;
    };
    const preserved = await censusUpgrade(), ledger = (await upgrade.query('SELECT version,checksum,applied_at FROM atlas_staff._standalone_migrations ORDER BY version')).rows;
    const applied = await applyStandaloneMigrations(upgrade);
    assert.equal(applied.status, 'APPLIED'); assert.deepEqual(applied.applied, [{ version: current.version, checksum: current.sqlSha256 }]);
    assert.deepEqual(await censusUpgrade(), preserved);
    assert.deepEqual((await upgrade.query('SELECT version,checksum,applied_at FROM atlas_staff._standalone_migrations ORDER BY version')).rows.filter(row => row.version !== current.version), ledger);
    assert.equal((await applyStandaloneMigrations(upgrade)).status, 'NO_OP');
    assert.deepEqual(await censusUpgrade(), preserved);
  } finally { await upgrade.end(); }
  checks.push('registered008 upgrades actual prefix007 with approval/report/card/staff rows and prior ledger unchanged; complete baseline plus002–008 and repeated release no-op pass');
  receipt = { status: 'GRADED_CARDS_POSTGRES_PASS', migration: { version: current.version, checksum: current.sqlSha256 }, checks, groups: checks.length, productionQueries: 0, providerCalls: 0, directory: fixture.cluster.directory };
} finally { await connection.close(); await fixture.stop(); }
receipt.cleanup = JSON.parse(await readFile(fixture.cluster.directory + '/cleanup.json', 'utf8')); assert.equal(receipt.cleanup.stoppedVerified, true);
await writeFile(output + '/postgres-result.json', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(receipt));
