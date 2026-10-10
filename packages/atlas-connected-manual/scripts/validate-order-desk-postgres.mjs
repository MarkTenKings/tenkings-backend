// Finite harness-owned PostgreSQL qualification; never accepts a database URL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createOrderDeskInboxService, orderDeskInboxGrantSQL } from '../src/order-desk-inbox.mjs';
import { createOrderDeskService, orderDeskGrantSQL } from '../src/order-desk.mjs';
import { createDealerStaffService, dealerStaffGrantSQL } from '../src/dealer-operations.mjs';
import { createConnectedHandler } from '../src/http.mjs';
import { qualifyOrderDeskLabels } from './order-desk-extra-postgres.mjs';

const output = process.env.ATLAS_ORDER_DESK_EVIDENCE;
assert(output && resolve(output) === output, 'Absolute evidence directory required');
await mkdir(output, { recursive: true, mode: 0o700 });
const fixture = await createOwnedManualFixture(process.argv.slice(2));
const connection = fixture.connect(), checks = [];
try {
  for (const grant of [orderDeskInboxGrantSQL, orderDeskGrantSQL, dealerStaffGrantSQL])
    await fixture.cluster.sql(grant('atlas_fixture_manual'), [], fixture.database.name);
  const { auth, boundary, manualClient } = connection;
  const service = createOrderDeskInboxService({ auth, boundary });
  const desk = createOrderDeskService({ auth, boundary });
  async function login(phone, connected = connection) {
    const boot = await connected.auth.bootstrap(''), browser = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await connected.auth.send(browser, boot.csrf, { phone, requestId: randomUUID() }, 'order-desk-fixture');
    const signed = await connected.auth.verify(browser, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'order-desk-fixture');
    const cookie = `${browser}; ${fixture.config.cookies.session}=${signed.token}`;
    return { staff: await connected.auth.authenticate(cookie, signed.csrf), cookie, csrf: signed.csrf };
  }
  const reviewer = await login('+12025550141'), observer = await login('+12025550142'), other = await login('+12025550143');
  const principal = await boundary.transaction(reviewer.staff, ({ principal }) => principal);
  const otherPrincipal = await boundary.transaction(other.staff, ({ principal }) => principal);
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_customer."WeeklyCapacitySharedPolicy"("effectiveWeekStartsAt","quotaCards","authorizationReference")
    SELECT "weekStartsAt",1000,'Owned synthetic order-desk fixture' FROM atlas_customer.weekly_capacity_week(statement_timestamp())`);
  const customerId = randomUUID();
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CustomerAccount"(id,"phoneHash",phone) VALUES($1::uuid,$2,$3)`, customerId, 'c'.repeat(64), '+12025550301');
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CustomerVerifiedEmail"("accountId",email) VALUES($1::uuid,'fixture@example.invalid')`, customerId);
  async function seedOrder({ count = 2, state = 'PAID', providerId = `pi_synthetic_${randomUUID()}`, order = true, paymentDraftMismatch = false, title = 'Synthetic Pikachu', photos = false } = {}) {
    const orderId = randomUUID(), draftId = randomUUID(), quoteId = randomUUID(), paymentId = randomUUID(), cards = [];
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CustomerIntakeDraft"(id,"accountId","requestId","inputHash","intakeMethod",state)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4,'MAIL_IN','ORDERED')`, draftId, customerId, randomUUID(), 'd'.repeat(64));
    for (let i = 0; i < count; i++) {
      const cardId = randomUUID(), pairId = randomUUID(), identity = { category: 'POKEMON', title: `${title} ${i + 1}`, playerName: '', year: '2024', manufacturer: '', setName: 'Synthetic fixture', cardNumber: String(i + 1), parallel: '', insert: '' };
      await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CustomerIntakeCard"(id,"draftId","requestId","pairId","inputHash",identity,"identityState","identitySource")
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::jsonb,'READY','CUSTOMER_CORRECTION')`, cardId, draftId, randomUUID(), pairId, 'e'.repeat(64), JSON.stringify(identity));
      const line = { cardId, identity, unitCents: 4000, commissionCents: 0 };
      if (photos && i === 0) {
        // Opaque synthetic descriptors qualify SQL bindings only. Actual
        // descriptor/raster validation belongs to the separate photo tests.
        for (const side of ['FRONT', 'BACK']) {
          const uploadId = randomUUID(), sha256 = (side === 'FRONT' ? '1' : '2').repeat(64);
          const plan = { schemaVersion: 1, uploadId, binding: { cardId, pairId, side, version: 1 },
            object: { key: `atlas-customer/originals/${customerId}/${cardId}/${uploadId}`, versionId: null }, expected: { sha256, byteCount: 100 } };
          const verification = { object: plan.object, sha256, byteCount: 100, contentType: 'application/octet-stream' };
          await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CustomerIntakeUpload"(id,"cardId",side,plan,"fileName",verification,prepared)
            VALUES($1::uuid,$2::uuid,$3,$4::jsonb,'synthetic-sql-only.bin',$5::jsonb,'{}'::jsonb)`, uploadId, cardId, side, JSON.stringify(plan), JSON.stringify(verification));
        }
        line.photoPairHash = (await fixture.admin.$queryRawUnsafe('SELECT atlas_dealer.order_desk_pair_hash($1::uuid) AS hash', cardId))[0].hash;
      }
      cards.push(line);
    }
    const snapshot = { channel: 'MAIL_IN', draftId, accountId: customerId, cards, profile: { name: 'Synthetic customer', email: 'fixture@example.invalid', address1: '1 Fixture Street', address2: '', city: 'Example', region: 'CA', postalCode: '90001', country: 'US' }, gradingCents: count * 4000, gradingTaxCents: 0, taxCents: 0, shippingCents: 0, totalCents: count * 4000, shippingStatus: 'UNQUOTED_UNPAID', terms: { mailClockStart: 'ATLAS_RECEIPT', shippingPayment: 'SEPARATE_PAYMENT' } };
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt")
      VALUES($1::uuid,$2::uuid,$3::uuid,1,$4,$5::jsonb,clock_timestamp()+interval '1 hour')`, quoteId, customerId, draftId, 'f'.repeat(64), JSON.stringify(snapshot));
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,"providerId",state)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'{}'::jsonb,$6,$7)`, paymentId, customerId, paymentDraftMismatch ? randomUUID() : draftId, quoteId, randomUUID(), providerId, state);
    if (order) await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CommerceOrder"(id,"accountId","draftId","quoteId","paymentId",reference,receipt,"paidAt")
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::jsonb,clock_timestamp())`, orderId, customerId, draftId, quoteId, paymentId, `SYN-${orderId.slice(0, 16)}`, JSON.stringify(snapshot));
    return { orderId, draftId, quoteId, paymentId, cards };
  }
  const first = await seedOrder({ title: 'Synthetic 100% Pikachu', photos: true }), raced = await seedOrder(), unused = await seedOrder();
  const blankProvider = await seedOrder({ providerId: '   ' }), mismatched = await seedOrder({ paymentDraftMismatch: true });
  const unpaid = await seedOrder({ state: 'PROCESSING', providerId: null, order: false });
  const custody = createDealerStaffService({ auth, boundary });
  await custody.call(reviewer.staff, 'custody_record', { cardId: first.cards[0].cardId, requestId: randomUUID(), kind: 'ATLAS_RECEIVED',
    occurredAt: new Date().toISOString(), evidence: { reference: 'Synthetic explicit receipt for one card only' } });
  const acknowledgment = async orderId => (await fixture.admin.$queryRawUnsafe('SELECT atlas_dealer.order_inbox_acknowledgment_projection($1::uuid) AS value', orderId))[0].value;
  const census = async () => {
    const result = {};
    for (const table of ['atlas_customer."CommerceOrder"', 'atlas_customer."CommercePayment"', 'atlas_customer."CommerceEffect"', 'atlas_customer."WeeklyCapacityReservation"',
      'atlas_customer."ProgressNotification"', 'atlas_customer."CustomerIntakeUpload"', 'atlas_dealer.order_card', 'atlas_dealer.custody_event', 'atlas_dealer.manual_card_link',
      'atlas_manual.card', 'atlas_manual.approval', 'atlas_manual.publication']) {
      const [row] = await fixture.admin.$queryRawUnsafe(`SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t`);
      result[table] = row.rows;
    }
    return result;
  };
  const before = await census();
  const newList = await desk.list(reviewer.staff, { view: 'new' });
  assert.equal(newList.orders.length, 3); assert.equal(newList.counts.new, 3); assert.equal(newList.counts.all, 3);
  assert(newList.orders.every(order => order.acknowledgment === null));
  const detail = (await desk.detail(reviewer.staff, { orderId: first.orderId })).order;
  assert.equal(detail.stage, 'MIXED'); assert.equal(detail.mixedStages, true);
  assert.deepEqual(detail.stageCounts, { RECEIVED: 1, WAITING_FOR_ARRIVAL: 1 });
  assert.equal(detail.group, 'ARRIVAL'); assert.equal(detail.acknowledgment, null);
  for (const card of detail.cards) {
    for (const side of ['FRONT', 'BACK']) {
      const hasPair = card.cardId === first.cards[0].cardId;
      assert.equal(card.photos[side].state, hasPair ? 'READY' : 'UNAVAILABLE');
      assert.equal(card.photos[side].thumbnailUrl, hasPair ? `/api/staff/manual-connected/order-desk/orders/${first.orderId}/cards/${card.cardId}/photos/${side}?size=thumbnail` : null);
    }
    assert.equal(card.finishing.assembly, 'NOT_RECORDED'); assert.equal(card.finishing.welding, 'NOT_RECORDED'); assert.equal(card.finishing.packing, 'NOT_RECORDED');
  }
  assert.equal(detail.shipping.inbound.artifactState, 'PENDING'); assert.equal(detail.shipping.inbound.labelUrl, null);
  assert.equal((await desk.list(reviewer.staff, { q: '100%' })).orders[0].id, first.orderId);
  assert.equal((await desk.list(reviewer.staff, { q: '%' })).orders.length, 1);
  assert.equal((await desk.list(reviewer.staff, { q: "' OR 1=1 --" })).orders.length, 0);
  assert.equal((await desk.list(reviewer.staff, { stage: 'RECEIVED' })).orders.length, 0, 'Stage group is the earliest unfinished group, not any received card');
  const paged = [];
  for (let cursor = null, pages = 0; pages < 3; pages++) {
    const page = await desk.list(reviewer.staff, { limit: 1, cursor });
    assert.equal(page.orders.length, 1); paged.push(page.orders[0].id); cursor = page.nextCursor;
    assert.equal(Boolean(cursor), pages < 2);
  }
  assert.equal(new Set(paged).size, 3);
  await assert.rejects(desk.list(observer.staff), { code: 'STAFF_REQUIRED' });
  await assert.rejects(desk.detail({ ...reviewer.staff }, { orderId: first.orderId }), { code: 'SIGN_IN_REQUIRED' });
  await assert.rejects(desk.detail(reviewer.staff, { orderId: blankProvider.orderId }), { code: 'NOT_FOUND' });
  await assert.rejects(desk.photo(reviewer.staff, { orderId: first.orderId, cardId: raced.cards[0].cardId, side: 'FRONT' }), { code: 'NOT_FOUND' });
  await assert.rejects(desk.label(reviewer.staff, { orderId: first.orderId, leg: 'INBOUND' }), { code: 'LABEL_NOT_READY' });
  checks.push('real list/detail remain cold, exclude unconfirmed/mismatched payments, preserve mixed per-card receipt stages, show missing photos/finishing/labels honestly, literal search and cursor pages have no duplicate orders');
  const requestId = randomUUID(), input = { orderId: first.orderId, requestId };
  assert.equal(await acknowledgment(first.orderId), null);
  assert.equal(await acknowledgment(first.orderId), null);
  await assert.rejects(service.acknowledge({ ...reviewer.staff }, input), { code: 'SIGN_IN_REQUIRED' });
  await assert.rejects(service.acknowledge(observer.staff, input), { code: 'STAFF_REQUIRED' });
  const handle = auth.actors.get(reviewer.staff), binding = Object.fromEntries(['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].map(key => [key, auth.config[key]]));
  for (const side of ['FRONT', 'BACK']) {
    const [row] = await manualClient.$queryRawUnsafe('SELECT atlas_dealer.order_desk_call($1,$2,$3,$4::jsonb,$5::text[],$6::jsonb) AS result',
      'photo_source', handle.sessionHash, handle.browserHash, JSON.stringify(binding), [...auth.config.phoneByHash.keys()], JSON.stringify({ orderId: first.orderId, cardId: first.cards[0].cardId, side }));
    assert.equal(row.result.upload.accountId, customerId); assert.equal(row.result.upload.cardId, first.cards[0].cardId); assert.equal(row.result.upload.side, side);
    assert.equal(row.result.uploadId, row.result.upload.plan.uploadId); assert.equal(row.result.paidPhotoPairHash, first.cards[0].photoPairHash); assert.equal(row.result.photoPairHash, first.cards[0].photoPairHash);
  }
  assert(!JSON.stringify(detail).includes('atlas-customer/originals'));
  checks.push('private SQL photo-source reads bind both original customer sides to the paid pair hash, exact order/card/account/upload; DTO exposes authenticated routes without storage keys');
  const rawAck = async (data, overrides = {}) => (await manualClient.$queryRawUnsafe('SELECT atlas_dealer.staff_order_acknowledge($1,$2,$3::jsonb,$4::text[],$5::jsonb) AS result',
    overrides.sessionHash ?? handle.sessionHash, overrides.browserHash ?? handle.browserHash, JSON.stringify(overrides.binding ?? binding), overrides.phones ?? [...auth.config.phoneByHash.keys()], JSON.stringify(data)))[0].result;
  for (const overrides of [{ sessionHash: 'a'.repeat(64) }, { browserHash: 'b'.repeat(64) }, { binding: { ...binding, releaseSha: '9'.repeat(40) } }, { phones: [] }])
    assert.equal((await rawAck(input, overrides)).error.code, 'STAFF_REQUIRED');
  const observerHandle = auth.actors.get(observer.staff);
  assert.equal((await rawAck(input, observerHandle)).error.code, 'STAFF_REQUIRED');
  for (const value of [{}, { ...input, actorId: principal.id }, { ...input, orderId: null }, { ...input, requestId: 'not-a-uuid' }])
    assert.equal((await rawAck(value)).error.code, 'INVALID_ORDER_ACKNOWLEDGMENT');
  for (const orderId of [randomUUID(), unpaid.orderId, blankProvider.orderId, mismatched.orderId])
    await assert.rejects(service.acknowledge(reviewer.staff, { orderId, requestId: randomUUID() }), { code: 'ORDER_NOT_FOUND' });
  assert.equal(await acknowledgment(first.orderId), null);
  checks.push('read leaves new order unacknowledged; forged capability, observer, stale session/browser/release/roster, malformed request, missing order, uncertain payment and invalid paid linkage rejected');

  const handler = createConnectedHandler({ origin: fixture.config.origin, boundary, assertRequest: req => assert.equal(req.fixturePrivate, true),
    connected: { workflow: {}, intake: {}, orderDesk: desk, orderDeskInbox: service } });
  async function http({ method = 'GET', path = '', body, origin = fixture.config.origin, cookie = reviewer.cookie, csrf = reviewer.csrf } = {}) {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; }, send(bytes) { this.bytes = bytes; } };
    await handler({ fixturePrivate: true, method, url: `/api/staff/manual-connected/order-desk${path}`, body,
      headers: { cookie, origin, 'content-type': 'application/json', 'x-atlas-csrf': csrf } }, res);
    return res;
  }
  const ackPath = `/orders/${first.orderId}/acknowledge`;
  for (const overrides of [{ origin: 'https://attacker.invalid' }, { csrf: '' }, { csrf: 'wrong-csrf' }, { cookie: '' }]) {
    const response = await http({ method: 'POST', path: ackPath, body: { requestId }, ...overrides });
    assert([401, 403].includes(response.code)); assert.equal(await acknowledgment(first.orderId), null);
  }
  const cold = await http({ path: `/orders/${first.orderId}` }); assert.equal(cold.code, 200); assert.equal(cold.body.order.acknowledgment, null);
  const response = await http({ method: 'POST', path: ackPath, body: { requestId } });
  assert.equal(response.code, 200); assert.equal(response.headers['Cache-Control'], 'private, no-store');
  const saved = response.body;
  checks.push('real connected HTTP route plus database boundary rejects wrong origin/missing or invalid CSRF/session; detail GET stays cold and explicit POST saves the authenticated acknowledgment');
  assert.equal(saved.outcome, 'ACKNOWLEDGED'); assert.equal(saved.acknowledgment.acknowledgedBy.id, principal.id);
  assert.equal((await desk.list(other.staff, { view: 'new' })).counts.new, 2);
  assert(!(await desk.list(other.staff, { view: 'new' })).orders.some(order => order.id === first.orderId));
  const acknowledgedDetail = (await desk.detail(other.staff, { orderId: first.orderId })).order;
  assert.deepEqual(acknowledgedDetail.acknowledgment, saved.acknowledgment);
  assert.equal(acknowledgedDetail.history.filter(event => event.kind === 'ORDER_ACKNOWLEDGED').length, 1);
  assert.deepEqual(await service.acknowledge(reviewer.staff, input), saved);
  const reloaded = fixture.connect();
  try {
    const restoredStaff = await reloaded.auth.authenticate(reviewer.cookie, reviewer.csrf);
    const restored = createOrderDeskInboxService({ auth: reloaded.auth, boundary: reloaded.boundary });
    assert.deepEqual(await restored.acknowledge(restoredStaff, input), saved);
    assert.deepEqual(await acknowledgment(first.orderId), saved.acknowledgment);
  } finally { await reloaded.close(); }
  const anotherRequest = randomUUID(), acknowledgedByOther = await service.acknowledge(other.staff, { orderId: first.orderId, requestId: anotherRequest });
  assert.equal(acknowledgedByOther.outcome, 'ALREADY_ACKNOWLEDGED'); assert.equal(acknowledgedByOther.requestId, anotherRequest);
  assert.deepEqual(acknowledgedByOther.acknowledgment, saved.acknowledgment);
  await assert.rejects(service.acknowledge(other.staff, input), { code: 'REQUEST_CONFLICT' });
  await assert.rejects(service.acknowledge(reviewer.staff, { orderId: unused.orderId, requestId }), { code: 'REQUEST_CONFLICT' });
  checks.push('exact request survives new connection and reauthentication; permanent team actor/time retained; another staff reply truthful; request reuse denied');

  const raceInputs = [{ orderId: raced.orderId, requestId: randomUUID() }, { orderId: raced.orderId, requestId: randomUUID() }];
  const race = await Promise.all([service.acknowledge(reviewer.staff, raceInputs[0]), service.acknowledge(other.staff, raceInputs[1])]);
  assert.deepEqual(race.map(value => value.outcome).sort(), ['ACKNOWLEDGED', 'ALREADY_ACKNOWLEDGED']);
  assert.deepEqual(race[0].acknowledgment, race[1].acknowledgment);
  assert([principal.id, otherPrincipal.id].includes(race[0].acknowledgment.acknowledgedBy.id));
  const repeatInput = { orderId: unused.orderId, requestId: randomUUID() };
  const repeat = await Promise.all([service.acknowledge(reviewer.staff, repeatInput), service.acknowledge(reviewer.staff, repeatInput)]);
  assert.deepEqual(repeat[0], repeat[1]); assert.equal(repeat[0].outcome, 'ACKNOWLEDGED');
  assert.equal(Number((await fixture.admin.$queryRawUnsafe('SELECT count(*) AS n FROM atlas_dealer.order_inbox_acknowledgment'))[0].n), 3);
  assert.equal((await desk.list(reviewer.staff, { view: 'new' })).orders.length, 0);
  assert.equal((await desk.list(reviewer.staff, { view: 'new' })).counts.new, 0);
  checks.push('simultaneous staff acknowledgment and simultaneous exact retry produce one row per order with original saved actor/time');

  for (const sql of [
    'SELECT * FROM atlas_dealer.order_inbox_acknowledgment',
    `INSERT INTO atlas_dealer.order_inbox_acknowledgment(order_id,request_id,actor_id) VALUES('${first.orderId}','${randomUUID()}','${principal.id}')`,
    'UPDATE atlas_dealer.order_inbox_acknowledgment SET acknowledged_at=clock_timestamp()',
    'DELETE FROM atlas_dealer.order_inbox_acknowledgment',
    `SELECT atlas_dealer.order_inbox_acknowledgment_projection('${first.orderId}'::uuid)`,
  ]) await assert.rejects(manualClient.$queryRawUnsafe(sql));
  for (const sql of ['UPDATE atlas_dealer.order_inbox_acknowledgment SET acknowledged_at=clock_timestamp()', 'DELETE FROM atlas_dealer.order_inbox_acknowledgment', 'TRUNCATE atlas_dealer.order_inbox_acknowledgment'])
    await assert.rejects(fixture.admin.$executeRawUnsafe(sql), /immutable/);
  const deniedPrivileges = (await fixture.admin.$queryRawUnsafe(`SELECT
    has_function_privilege('atlas_fixture_customer','atlas_dealer.staff_order_acknowledge(text,text,jsonb,text[],jsonb)','EXECUTE') AS customer,
    has_function_privilege('atlas_fixture_public','atlas_dealer.staff_order_acknowledge(text,text,jsonb,text[],jsonb)','EXECUTE') AS public,
    has_table_privilege('atlas_fixture_manual','atlas_dealer.order_inbox_acknowledgment','SELECT') AS direct_read`))[0];
  assert.deepEqual(deniedPrivileges, { customer: false, public: false, direct_read: false });
  assert.deepEqual(await census(), before);
  checks.push('manual role has no direct ledger/table or projection access; customer/public execution denied; immutable update/delete/truncate guards; payment/receipt/capacity/custody/grade/notification bytes unchanged');
  checks.push(...await qualifyOrderDeskLabels({ fixture, desk, staff: reviewer.staff, orderId: first.orderId }));

  const source = JSON.parse(await readFile(join(fixture.cluster.directory, 'source.json'), 'utf8'));
  assert(source.staffMigrations.some(row => row.name === '20261010001000_atlas_staff_order_inbox'));
  assert(source.staffMigrations.some(row => row.name === '20261010002000_atlas_staff_order_desk'));
  const result = { ok: true, checks, registeredStaffMigrations: source.staffMigrations.length, fixtureDirectory: fixture.cluster.directory,
    acknowledgmentRows: 3, externalProviderCalls: 0, productionEffects: 0 };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'ORDER_DESK_POSTGRES_PASS', checks: checks.length, evidence: output }));
} finally { await fixture.stop(); }
