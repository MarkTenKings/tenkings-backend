// Harness-owned local PostgreSQL only. No provider, external database or live data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { canonical, digest } from '../../atlas-manual-service/src/contract.mjs';
import { createCardProvenanceService, cardProvenanceGrantSQL, validateCardProvenanceConfiguration, publicCardProvenance } from '../src/card-provenance-service.mjs';
import { cardProvenanceInput } from '../src/card-provenance-contract.mjs';
import { createConnectedHandler } from '../src/http.mjs';
import { registeredMigrations } from '../../atlas-standalone-database/registered-migrations.mjs';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../../atlas-standalone-database/migrate.mjs';

const output = process.env.ATLAS_CARD_PROVENANCE_EVIDENCE;
assert(output && resolve(output) === output, 'Absolute evidence directory required');
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2)), connection = fixture.connect(), checks = [];
let receipt;
try {
  await fixture.cluster.sql(cardProvenanceGrantSQL('atlas_fixture_manual'), [], fixture.database.name);
  const { auth, boundary, manualClient } = connection, admin = fixture.admin, service = createCardProvenanceService({ auth, boundary });
  await validateCardProvenanceConfiguration({ client: manualClient });
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
  const read = (card, input) => service.read(reviewer.staff, card.id, input);
  const tables = ['atlas_manual.card', 'atlas_manual.action', 'atlas_manual.approval', 'atlas_manual.public_report_identity', 'atlas_manual.publication',
    'atlas_dealer.custody_event', 'atlas_dealer.manual_card_link', 'atlas_customer."CommerceOrder"', 'atlas_customer."CommercePayment"', 'atlas_customer."CommerceEffect"'];
  const census = async () => {
    const rows = {};
    for (const table of tables) rows[table] = (await admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) rows FROM ${table} t`))[0].rows;
    return rows;
  };
  const before = await census(), initial = await read(first);
  assert.equal(initial.card.cardId, first.id); assert.equal(initial.card.certificateNumber, first.certificate);
  assert.equal(initial.ownership.status, 'UNKNOWN'); assert.equal(initial.custody.status, 'RECORDED');
  assert.equal(initial.custody.latestRecorded.kind, 'ATLAS_RECEIVED'); assert.equal(initial.custody.currentPhysicalHolder, 'UNKNOWN');
  assert.deepEqual(new Set(initial.history.events.map(e => e.kind)), new Set(['REPORT_APPROVED', 'REPORT_PUBLISHED', 'ATLAS_RECEIVED']));
  assert.doesNotMatch(JSON.stringify(initial), /private@example|Private address|synthetic-payment|Synthetic Submitter|accountId|ownerId|actorId|evidence_ref|UNAPPROVED SECRET/);
  assert.deepEqual(await census(), before);
  const publicValue = publicCardProvenance(initial);
  assert.equal(publicValue.history.events.length, 1); assert.equal(publicValue.history.events[0].reportPath, `/reports/${first.token}?v=1`);
  assert.doesNotMatch(JSON.stringify(publicValue), new RegExp(`${first.id}|${actor.id}|${customerId}|${customerCard}|source|custody|snapshot|cursor`, 'i'));
  assert.equal((await read(second)).card.report.path, null); assert.equal(publicCardProvenance(await read(second)), null);
  assert.equal((await read(third)).custody.status, 'UNKNOWN'); assert.equal((await read(shared)).card.cardId, shared.id);
  for (const denied of [hidden, deleted, { id: randomUUID() }]) await assert.rejects(read(denied), { code: 'CARD_PROVENANCE_NOT_FOUND' });
  checks.push('least-privilege per-card read preserves exact approval, report and custody source anchors; unknown ownership, no inferred live holder, pending reports private, hidden/discarded/unknown cards indistinguishable; no protected-row writes');

  // Fixed recorded-time pagination includes immutable prior versions while a
  // newly approved report cannot replace the selected snapshot between pages.
  const page1 = await read(first, { limit: 1 });
  const action2 = await approve(first, { identity: { playerName: 'Synthetic reapproval' } });
  let cursor = page1.history.nextCursor, events = [...page1.history.events];
  while (cursor) {
    const page = await read(first, { limit: 1, cursor });
    assert.equal(page.card.approvalActionId, page1.card.approvalActionId); assert.equal(page.history.snapshot, page1.history.snapshot);
    events.push(...page.history.events); cursor = page.history.nextCursor;
  }
  assert.equal(new Set(events.map(e => e.eventId)).size, 3); assert.equal(events.length, 3);
  const updated = await read(first);
  assert.equal(updated.card.approvalActionId, action2); assert.equal(updated.card.certificateNumber, first.certificate);
  assert.equal(updated.card.report.publicToken, first.token); assert.equal(updated.history.events.length, 5);
  assert.deepEqual(updated.history.events.filter(e => e.source.approvalActionId === first.actionId), initial.history.events.filter(e => e.source.approvalActionId === first.actionId));
  assert.deepEqual(publicCardProvenance(updated).history.events.map(e => e.reportVersion), [2, 1]);
  assert.equal(updated.capabilities.reholder, false);
  checks.push('microsecond cursor pages retain same approval/cert/report identity and exact initial source payloads while a new approval/publication appends separate events; no inferred regrade/reholder cause');

  // Completing a pending publication after the snapshot must not mutate its
  // earlier approval event or make the snapshot overview appear published.
  const pendingPage = await read(second, { limit: 1 });
  await admin.$executeRawUnsafe(`UPDATE atlas_manual.publication SET state='PUBLISHED',manifest='{}',manifest_hash=$1,public_hash=$2,published_at=clock_timestamp() WHERE card_id=$3::uuid AND action_id=$4::uuid`, hashes.content, hashes.public, second.id, second.actionId);
  const historical = cardProvenanceInput(second.id, { cursor: Buffer.from(JSON.stringify({ v: 1, cardId: second.id, snapshot: pendingPage.history.snapshot,
    recordedAt: pendingPage.history.events[0].recordedAt, eventId: pendingPage.history.events[0].eventId })).toString('base64url') });
  const historicalPage = await service.read(reviewer.staff, second.id, { cursor: Buffer.from(JSON.stringify(historical.page)).toString('base64url') });
  assert.equal(historicalPage.card.report.state, 'PENDING'); assert.deepEqual(historicalPage.card.media, {});
  const completed = await read(second); assert.deepEqual(completed.history.events.find(e => e.kind === 'REPORT_APPROVED'), pendingPage.history.events[0]);
  assert.equal(completed.history.events.filter(e => e.kind === 'REPORT_PUBLISHED').length, 1);
  checks.push('later publication appends one event without rewriting approval evidence or leaking publication into an earlier snapshot');

  const event = async (sequence, kind) => {
    const id = randomUUID();
    await admin.$executeRawUnsafe(`INSERT INTO atlas_dealer.custody_event(id,card_id,sequence,request_id,input_hash,kind,actor_id,customer_id,occurred_at,evidence)
      VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7::uuid,$8::uuid,clock_timestamp(),'{"reference":"Synthetic private evidence","customerAddress":"Never exposed"}')`,
      id, customerCard, sequence, randomUUID(), hashes.content, kind, kind === 'DEPOSIT_DECLARED' ? null : actor.id, kind === 'DEPOSIT_DECLARED' ? customerId : null);
    return id;
  };
  await event(2, 'DEPOSIT_DECLARED'); await event(3, 'DELAY_REPORTED');
  let custody = await read(first); assert.equal(custody.custody.latestRecorded.kind, 'ATLAS_RECEIVED');
  assert.equal(custody.history.events.find(e => e.kind === 'DEPOSIT_DECLARED').verification, 'SUBMITTER_REPORTED');
  assert.equal(custody.ownership.status, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(custody), /Never exposed|customerAddress/);
  await event(4, 'MAIL_DISPATCHED'); custody = await read(first);
  assert.equal(custody.custody.latestRecorded.kind, 'MAIL_DISPATCHED'); assert.equal(custody.custody.currentPhysicalHolder, 'UNKNOWN');
  assert.equal(publicCardProvenance(custody).history.events.length, 2);
  // Synthetic SQL-derived UI fixture; never inventory or customer data.
  await writeFile(output + '/synthetic-card-history.json', JSON.stringify(custody, null, 2) + '\n', { mode: 0o600 });
  for (const statement of [
    'UPDATE atlas_manual.approval SET source_hash=source_hash WHERE card_id=$1::uuid',
    'UPDATE atlas_manual.publication SET public_hash=public_hash WHERE card_id=$1::uuid',
    'UPDATE atlas_dealer.manual_card_link SET evidence_ref=evidence_ref WHERE manual_card_id=$1::uuid',
    'UPDATE atlas_dealer.custody_event SET evidence=evidence WHERE card_id=(SELECT card_id FROM atlas_dealer.manual_card_link WHERE manual_card_id=$1::uuid)'])
    await assert.rejects(admin.$executeRawUnsafe(statement, first.id), /immutable/i);
  checks.push('append-only source guards reject historical rewrites; customer declarations/delay notes never advance physical custody; recorded dispatch remains separate from ownership and current possession');

  await assert.rejects(service.read(observer.staff, first.id), { code: 'STAFF_REQUIRED' });
  await assert.rejects(service.read({ ...reviewer.staff }, first.id), { code: 'SIGN_IN_REQUIRED' });
  const handle = auth.actors.get(reviewer.staff), binding = Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(k => [k, auth.config[k]]));
  const direct = async (query = cardProvenanceInput(first.id), overrides = {}) => (await manualClient.$queryRawUnsafe('SELECT atlas_manual.card_provenance($1,$2,$3::jsonb,$4::text[],$5::jsonb) AS result',
    overrides.sessionHash ?? handle.sessionHash, overrides.browserHash ?? handle.browserHash, JSON.stringify(overrides.binding ?? binding), overrides.phones ?? [...auth.config.phoneByHash.keys()], JSON.stringify(query)))[0].result;
  for (const overrides of [{ sessionHash: '0'.repeat(64) }, { browserHash: '0'.repeat(64) }, { binding: { ...binding, releaseSha: '9'.repeat(40) } }, { phones: [] }, auth.actors.get(observer.staff)])
    assert.equal((await direct(undefined, overrides)).error.code, 'STAFF_REQUIRED');
  for (const query of [{ ...cardProvenanceInput(first.id), ownerId: customerId }, { ...cardProvenanceInput(first.id), limit: 101 }, { ...cardProvenanceInput(first.id), cardId: 'broken' },
    { ...cardProvenanceInput(first.id), page: { v: 1, cardId: first.id, snapshot: '2999-01-01T00:00:00.000000Z', recordedAt: '2026-01-01T00:00:00.000000Z', eventId: 'approval:' + first.actionId } }])
    assert.equal((await direct(query)).error.code, 'INVALID_CARD_PROVENANCE_QUERY');
  await assert.rejects(manualClient.$queryRawUnsafe('SELECT * FROM atlas_dealer.custody_event'), /permission denied/);
  await assert.rejects(manualClient.$queryRawUnsafe('SELECT * FROM atlas_customer."CommerceOrder"'), /permission denied/);
  const privilege = await admin.$queryRawUnsafe("SELECT has_function_privilege('atlas_fixture_customer','atlas_manual.card_provenance(text,text,jsonb,text[],jsonb)','EXECUTE') allowed");
  assert.equal(privilege[0].allowed, false);
  const sharedPage = await read(shared, { limit: 1 });
  await admin.$executeRawUnsafe('UPDATE atlas_manual.card SET readers=ARRAY[]::uuid[],revision=revision+1 WHERE id=$1::uuid', shared.id);
  await assert.rejects(read(shared, { cursor: sharedPage.history.nextCursor }), { code: 'CARD_PROVENANCE_NOT_FOUND' });
  checks.push('actual SQL independently rechecks session/browser/release/roster/reviewer and live card ACL; malformed direct arguments fail; customer cannot execute and manual role cannot read private source tables');

  const handler = createConnectedHandler({ connected: { intake: {}, workflow: {}, cardProvenance: service }, boundary, origin: fixture.config.origin, assertRequest: async () => {} });
  const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(body) { this.body = body; } };
  const beforeHttp = await census();
  await handler({ method: 'GET', url: `/api/staff/manual-connected/cards/${first.id}/provenance?limit=2`, headers: { cookie: reviewer.cookie } }, response);
  assert.equal(response.code, 200); assert.equal(response.body.card.cardId, first.id); assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(await census(), beforeHttp);
  await admin.$executeRawUnsafe('UPDATE atlas_staff."StaffSession" SET "revokedAt"=clock_timestamp() WHERE "tokenHash"=$1', handle.sessionHash);
  await assert.rejects(read(first), { code: 'SIGN_IN_REQUIRED' });
  checks.push('integrated authenticated HTTP handler returns exact source-bound projection with zero protected-row changes and fails immediately after session revocation');

  const manifest = await registeredMigrations(), current = manifest.at(-1); assert.equal(current.version, 'atlas-standalone-009-card-provenance');
  const { Client } = createRequire(import.meta.url)(process.argv[process.argv.indexOf('--pg-module') + 1]);
  const upgradeName = 'atlas_provenance_upgrade'; await fixture.cluster.sql(`CREATE DATABASE ${upgradeName}`);
  const upgrade = new Client({ connectionString: fixture.cluster.url(upgradeName) }); await upgrade.connect();
  try {
    await applyStandaloneBaseline(upgrade);
    for (const migration of manifest.slice(0, -1)) {
      await upgrade.query('BEGIN'); await upgrade.query(migration.sql);
      await upgrade.query('INSERT INTO atlas_staff._standalone_migrations(version,checksum) VALUES($1,$2)', [migration.version, migration.sqlSha256]); await upgrade.query('COMMIT');
    }
    const preservedTables = ['atlas_staff."StaffIdentity"', 'atlas_manual.card', 'atlas_manual.action', 'atlas_manual.approval', 'atlas_manual.public_report_identity', 'atlas_manual.publication'];
    for (const table of preservedTables) {
      const { rows: [source] } = await fixture.cluster.sql(`SELECT jsonb_agg(to_jsonb(t)) AS rows FROM ${table} t`, [], fixture.database.name);
      if (table === 'atlas_manual.publication') for (const row of source.rows) {
        await upgrade.query('INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1,$2,$3,$4)', [row.card_id, row.action_id, row.version, row.mode]);
        if (row.state === 'PUBLISHED') await upgrade.query('UPDATE atlas_manual.publication SET state=$1,manifest=$2,manifest_hash=$3,public_hash=$4,published_at=$5 WHERE card_id=$6 AND action_id=$7',
          [row.state, row.manifest, row.manifest_hash, row.public_hash, row.published_at, row.card_id, row.action_id]);
      } else await upgrade.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)`, [JSON.stringify(source.rows)]);
    }
    const upgradeCensus = async () => {
      const result = {};
      for (const table of preservedTables) result[table] = (await upgrade.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS rows FROM ${table} t`)).rows[0].rows;
      return result;
    };
    const beforeUpgrade = await upgradeCensus(), ledger = (await upgrade.query('SELECT version,checksum,applied_at FROM atlas_staff._standalone_migrations ORDER BY version')).rows;
    const applied = await applyStandaloneMigrations(upgrade); assert.deepEqual(applied.applied, [{ version: current.version, checksum: current.sqlSha256 }]);
    assert.deepEqual(await upgradeCensus(), beforeUpgrade);
    assert.deepEqual((await upgrade.query('SELECT version,checksum,applied_at FROM atlas_staff._standalone_migrations ORDER BY version')).rows.filter(row => row.version !== current.version), ledger);
    assert.equal((await applyStandaloneMigrations(upgrade)).status, 'NO_OP'); assert.deepEqual(await upgradeCensus(), beforeUpgrade);
  } finally { await upgrade.end(); }
  checks.push('actual registered009 upgrades exact prefix008 with prior approval/card/report/staff rows and ledger unchanged; clean baseline002–009 and repeated release no-op pass');
  receipt = { status: 'CARD_PROVENANCE_POSTGRES_PASS', migration: { version: current.version, checksum: current.sqlSha256 }, checks, groups: checks.length,
    productionQueries: 0, providerCalls: 0, ownershipWrites: 0, directory: fixture.cluster.directory };
} finally { await connection.close(); await fixture.stop(); }
receipt.cleanup = JSON.parse(await readFile(fixture.cluster.directory + '/cleanup.json', 'utf8')); assert.equal(receipt.cleanup.stoppedVerified, true);
await writeFile(output + '/postgres-result.json', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(receipt));
