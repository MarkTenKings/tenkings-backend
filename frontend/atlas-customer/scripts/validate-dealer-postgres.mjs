import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '../../atlas-app/.generated/staff-database/index.js';
import { disposablePostgres } from '../../atlas-app/scripts/disposable-postgres.mjs';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { CustomerDatabase } from '../lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../lib/server/fixture.mjs';
import { makeAccessConfig } from '../../atlas-app/lib/server/access/config.mjs';
import { BROWSER_COOKIE, SESSION_COOKIE, LOCAL_ORIGIN } from '../../atlas-app/lib/server/policy.mjs';
import { STAFF_BASE_PATH } from '../../atlas-app/lib/routes.mjs';
import { DurableStaffAuth } from '../../atlas-app/lib/server/access/auth.mjs';
import { StaffDatabase } from '../../atlas-app/lib/server/access/database.mjs';
import { createDurableStaffBoundary, manualGrantSQL } from '../../../packages/atlas-manual-service/src/staff-auth.mjs';
import { createManualRepository } from '../../../packages/atlas-manual-service/src/repository.mjs';
import { publicationGrantSQL } from '../../../packages/atlas-connected-manual/src/publication-repository.mjs';
import { createDealerStaffService, dealerStaffGrantSQL } from '../../../packages/atlas-connected-manual/src/dealer-operations.mjs';
import { customerPrivateGrantSQL, createCustomerPrivateDatabase } from '../../../packages/atlas-connected-manual/scripts/customer-database.mjs';
import { DealerOperations } from '../../../packages/atlas-dealer-operations/src/service.mjs';
import { CommerceService } from '../../../packages/atlas-commerce/src/service.mjs';
import { GatewayCommerceRepository } from '../../../packages/atlas-commerce/src/repository.mjs';
import { digest } from '../../../packages/atlas-commerce/src/contract.mjs';
import { profile } from '../../../packages/atlas-commerce/test/fixtures.mjs';

const fixture = await disposablePostgres(process.argv.slice(2));
const clients = [], checks = [];
try {
    const db = await fixture.database();
    // Rehearse the real registered head chain; older fixture baselines apply exact proposal bytes.
    for(const [name,proposal] of [
      ['20261001001000_atlas_weekly_card_capacity','atlas-commerce/sql/weekly-capacity-proposal.sql'],
      ['20261001002000_atlas_customer_phone_payments','atlas-commerce/sql/customer-phone-proposal.sql'],
      ['20261001003000_atlas_dealer_phone_handoff','atlas-dealer-operations/sql/handoff-proposal.sql'],
      ['20261001004000_customer_progress_notifications','atlas-commerce/sql/progress-notifications-proposal.sql'],
      ['20261001005000_atlas_shop_contact_profile','atlas-customer-intake/sql/shop-profile-proposal.sql']])
      assert.equal(readFileSync(new URL(`../../atlas-app/prisma/migrations/${name}/migration.sql`,import.meta.url),'utf8'),readFileSync(new URL(`../../../packages/${proposal}`,import.meta.url),'utf8'));
    const installedCapacity=(await fixture.sql(`SELECT to_regclass('atlas_customer."WeeklyCapacityConfig"') IS NOT NULL installed`,[],db.name)).rows[0].installed;
    if(!installedCapacity){
      await fixture.sql(readFileSync(new URL('../../../packages/atlas-commerce/sql/weekly-capacity-proposal.sql', import.meta.url), 'utf8'), [], db.name);
      await fixture.sql(readFileSync(new URL('../../../packages/atlas-commerce/sql/customer-phone-proposal.sql', import.meta.url), 'utf8'), [], db.name);
    }
    const installedHandoff=(await fixture.sql(`SELECT to_regclass('atlas_dealer.handoff') IS NOT NULL installed`,[],db.name)).rows[0].installed;
    const installedProgress=(await fixture.sql(`SELECT to_regclass('atlas_customer."ProgressNotification"') IS NOT NULL installed`,[],db.name)).rows[0].installed;
    await fixture.sql(`UPDATE atlas_customer."WeeklyCapacityConfig" SET "quotaCards"=100 WHERE channel IN ('MAIL_IN','DEALER_DROP_OFF')`, [], db.name);
    checks.push('additive card capacity and customer-phone payment proposals with explicit fixture-only quotas');
    const client = url => { const value = new PrismaClient({ datasources: { db: { url } } }); clients.push(value); return value; };
    const admin = client(db.adminUrl), customerClient = client(db.customerUrl), staffClient = client(db.staffUrl);
    async function restricted(name, grants) {
        const password = randomBytes(24).toString('hex');
        await fixture.sql(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
        for (const statement of grants.map(g => g(name)).join('\n').split(';').filter(s => s.trim())) await fixture.sql(statement, [], db.name);
        const url = new URL(db.adminUrl); url.username = name; url.password = password; return client(url.href);
    }
    const manualClient = await restricted('atlas_fixture_dealer_staff', [manualGrantSQL, dealerStaffGrantSQL]);
    const privateClient = await restricted('atlas_fixture_dealer_private', [customerPrivateGrantSQL]);
    const config = localConfig({ databaseUrl: db.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
    const customerDatabase = new CustomerDatabase(customerClient, config);
    const auth = new CustomerAuth({ database: customerDatabase, config, provider: fixtureProvider(config) });
    const privateDatabase = createCustomerPrivateDatabase({ client: privateClient, binding: config.binding });
    await admin.$executeRaw`INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash")
        VALUES(true,${config.mode},${config.origin},${config.deploymentId},${config.releaseSha},${config.configHash})`;
    await admin.$executeRaw`INSERT INTO atlas_customer."CustomerServiceControl"(enabled,binding,"identificationEnabled") VALUES(true,${JSON.stringify(config.binding)}::jsonb,false)`;
    const staffConfig = makeAccessConfig({ mode: 'LOCAL_FIXTURE', origin: LOCAL_ORIGIN, basePath: STAFF_BASE_PATH, deploymentId: 'local-postgres-fixture',
        releaseSha: '0'.repeat(40), accountSid: `AC${'1'.repeat(32)}`, serviceSid: `VA${'2'.repeat(32)}`, databaseUrl: db.staffUrl,
        cookies: { browser: BROWSER_COOKIE, session: SESSION_COOKIE }, sessionKey: randomBytes(32), phoneKey: randomBytes(32),
        approvedPhones: new Set(['+12025550141','+12025550142','+12025550143']), providerLifetimeMs: 600_000 });
    // Seed only explicit owned-fixture authority, with no grading/report rows.
    await admin.staffControl.create({ data: { enabled: true, mode: staffConfig.mode, origin: staffConfig.origin,
        deploymentId: staffConfig.deploymentId, releaseSha: staffConfig.releaseSha, configHash: staffConfig.configHash } });
    for (const [index, phoneHash] of [...staffConfig.phoneByHash.keys()].entries())
        await admin.staffIdentity.create({ data: { id: randomUUID(), phoneHash, name: `Synthetic staff ${index}`, role: index === 1 ? 'OBSERVER' : 'REVIEWER' } });
    const staffAuth = new DurableStaffAuth({ config: staffConfig, database: new StaffDatabase(staffClient, staffConfig), provider: fixtureProvider(staffConfig) });
    const boundary = createDurableStaffBoundary({ auth: staffAuth, manualClient });
    const staffOperations = createDealerStaffService({ auth: staffAuth, boundary });
    const manual = createManualRepository({ boundary });
    async function login(which, configuration, phone) {
        const boot = await which.bootstrap(undefined, 'dealer-postgres-fixture'), initial = `${configuration.cookies.browser}=${boot.browserToken}`;
        const challenge = await which.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'dealer-postgres-fixture');
        const signed = await which.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'dealer-postgres-fixture');
        return { ...signed, cookie: `${initial}; ${configuration.cookies.session}=${signed.token}` };
    }
    const reviewer = await login(staffAuth, staffConfig, '+12025550141');
    const observer = await login(staffAuth, staffConfig, '+12025550142');
    const otherReviewer = await login(staffAuth, staffConfig, '+12025550143');
    const a = await login(auth, config, '+12025550301'), b = await login(auth, config, '+12025550302');
    for (const who of [a,b]) who.authority = { binding: config.binding, ...auth.authority(who.cookie, who.csrf) };
    const call = (who, action, input) => auth.call(who.cookie, action, input, who.csrf);
    const staffCall = (action, input, who = reviewer) => staffOperations.call(who.staff, action, input);
    await assert.rejects(staffOperations.call({ ...reviewer.staff }, 'read', {}), { code: 'SIGN_IN_REQUIRED' });
    await assert.rejects(staffCall('read', {}, observer), { code: 'STAFF_REQUIRED' });
    await assert.rejects(customerClient.$queryRaw`SELECT atlas_dealer.staff_call('read','','','{}'::jsonb,ARRAY[]::text[],'{}'::jsonb)`);
    const locationInput = label => ({ id: randomUUID(), dealerId: randomUUID(), expectedRevision: 0, name: `Synthetic Kiosk ${label}`, enabled: true,
        address: { line1: `${label} Fixture Street`, city: 'Example', region: 'CA', postalCode: '90001', country: 'US' },
        position: { lat: 34.05, lng: -118.25 }, schedule: { timeZone: 'America/Los_Angeles', pickups: [{ weekday: 3, time: '10:00', cutoff: '09:00' }], returns: [{ weekday: 3, time: '10:00' }], exceptions: [] },
        terminalId: `tmr_synthetic_${label}`, terminalLocationId: `tml_synthetic_${label}`, packagePrinterId: `printer_synthetic_${label}`,
        entryToken: randomBytes(32).toString('base64url'), authorizedUntil: new Date(Date.now() + 86400_000 * 60).toISOString() });
    const locationA = locationInput('A'), locationB = locationInput('B');
    await assert.rejects(staffCall('location_configure', locationA), { code: 'FRESH_HUMAN_OPERATIONS_REQUIRED' });
    const ctl = await admin.staffControl.findUnique({ where: { id: 'active' } });
    const staffIdentity = await admin.staffIdentity.findUnique({ where: { id: reviewer.staff.id } });
    const now = new Date();
    const grant = await admin.staffOperationsGrant.create({ data: { id: randomUUID(), identityId: reviewer.staff.id,
        accessVersion: staffIdentity.accessVersion, controlRevision: ctl.revision, mode: staffConfig.mode, origin: staffConfig.origin,
        deploymentId: staffConfig.deploymentId, releaseSha: staffConfig.releaseSha, configHash: staffConfig.configHash,
        authorizationEvidenceHash: 'a'.repeat(64), createdAt: new Date(+now - 1000), expiresAt: new Date(+now + 3600_000) } });
    await staffCall('location_configure', locationA); await staffCall('location_configure', locationB);
    await staffCall('membership_configure', { accountId: a.customer.id, locationId: locationA.id, enabled: true });
    await staffCall('membership_configure', { accountId: b.customer.id, locationId: locationB.id, enabled: true });
    checks.push('actual staff WeakMap/session, reviewer role and fresh operations grant required for location/member configuration');
    const dealer = new DealerOperations({ call: (action, input) => customerDatabase.call(action, input), sessionKey: randomBytes(32) });
    await assert.rejects(call(a, 'dealer_read', {}), { code: 'DEALER_SIGN_IN_REQUIRED' });
    await assert.rejects(dealer.enter(a.authority, locationB.id), { code: 'DEALER_MEMBERSHIP_REQUIRED' });
    assert.deepEqual((await call(a, 'dealer_memberships', {})).memberships.map(m => m.locationId), [locationA.id]);
    assert.deepEqual((await call(b, 'dealer_memberships', {})).memberships.map(m => m.locationId), [locationB.id]);
    const enteredA = await dealer.enter(a.authority, locationA.id), enteredB = await dealer.enter(b.authority, locationB.id);
    await assert.rejects(dealer.read(enteredA.sessionToken, b.authority.browserHash), { code: 'DEALER_SIGN_IN_REQUIRED' });
    assert.equal((await dealer.read(enteredA.sessionToken, a.authority.browserHash)).location.id, locationA.id);
    checks.push('customer sign-in cannot replace separate dealer session; membership and browser bind exact location');
    const merchant = { provider: 'STRIPE', accountId: 'acct_synthetic_dealer', livemode: false }, providerBinding = { fixture: randomUUID() };
    await admin.$executeRaw`INSERT INTO atlas_customer."CommerceControl"(enabled,binding,merchant) VALUES(true,${JSON.stringify(providerBinding)}::jsonb,${JSON.stringify(merchant)}::jsonb)`;
    function publicLocation(value, expected) {
        assert.equal(value.id, expected.id); assert.equal(value.name, expected.name);
        assert.equal(value.address.line1, expected.address.line1); assert.equal(value.schedule.timeZone, expected.schedule.timeZone);
        assert.deepEqual(value.schedule.pickups, expected.schedule.pickups); assert.deepEqual(value.schedule.returns, expected.schedule.returns);
        const text = JSON.stringify(value);
        for (const name of ['dealerId','terminalId','terminalLocationId','packagePrinterId','entryToken']) {
            assert(!text.includes(`"${name}"`), `Private location key: ${name}`);
            assert(!text.includes(expected[name]), `Private location binding: ${name}`);
        }
    }
    async function paidKiosk(who, location, count) {
        await call(who, 'profile', { profile });
        let { draft } = await call(who, 'intake_create', { requestId: randomUUID(), intakeMethod: 'DEALER_DROP_OFF', kioskId: location.id });
        publicLocation(draft.locationSnapshot, location);
        publicLocation((await call(who, 'intake_read', { id: draft.id })).draft.locationSnapshot, location);
        const listed = (await call(who, 'intake_list', {})).drafts.find(item => item.id === draft.id);
        assert(listed); publicLocation(listed.locationSnapshot, location);
        const storedLocation = (await fixture.sql('SELECT "locationSnapshot" AS location FROM atlas_customer."CustomerIntakeDraft" WHERE id=$1::uuid', [draft.id], db.name)).rows[0].location;
        for (const name of ['dealerId','terminalId','terminalLocationId','packagePrinterId']) assert.equal(storedLocation[name], location[name]);
        const cardIds = [];
        for (let i = 0; i < count; i++) {
            const card = { requestId: randomUUID(), cardId: randomUUID(), pairId: randomUUID(),
                front: { uploadId: randomUUID(), sha256: '1'.repeat(64), byteCount: 10, fileName: 'synthetic-front.jpg' },
                back: { uploadId: randomUUID(), sha256: '2'.repeat(64), byteCount: 11, fileName: 'synthetic-back.jpg' } };
            draft = (await call(who, 'intake_card', { id: draft.id, card })).draft; cardIds.push(card.cardId); publicLocation(draft.locationSnapshot, location);
            for (const side of ['front','back']) {
                const input = { id: draft.id, cardId: card.cardId, uploadId: card[side].uploadId }, { upload } = await call(who, 'intake_upload', input);
                draft = (await privateDatabase.call('intake', { name: 'verify', input: { ...input, authority: who.authority,
                    verification: { object: upload.plan.object, ...upload.plan.expected, contentType: 'application/octet-stream' } } })).draft;
                publicLocation(draft.locationSnapshot, location);
            }
            const identity = { category: 'SPORTS', title: `Synthetic ${location.name} card ${i+1}`, playerName: 'Fixture Player', year: '2026', manufacturer: 'Fixture', setName: 'Fixture Set', cardNumber: String(i+1), parallel: '', insert: '' };
            draft = (await call(who, 'intake_correct', { id: draft.id, cardId: card.cardId, expectedRevision: draft.cards.find(c => c.id === card.cardId).revision, identity })).draft;
            publicLocation(draft.locationSnapshot, location);
        }
        draft = (await call(who, 'intake_review', { id: draft.id, expectedRevision: draft.revision, profile })).draft;
        publicLocation(draft.locationSnapshot, location);
        const repository = new GatewayCommerceRepository((name, input) => name === 'commerce_weekly_capacity' ? privateDatabase.call('capacity', { input: {} }) : privateDatabase.call('commerce', { name, providerBinding, input: { ...input, authority: who.authority } }));
        let creates = 0;
        const payment = { binding: merchant, async create(attempt) { creates++; return { state: 'AWAITING_PAYMENT', providerId: `pi_synthetic_${attempt.id}` }; },
            async retrieve(attempt) { return { source: 'PROVIDER_RETRIEVAL', provider: 'STRIPE', merchantId: merchant.accountId, livemode: false,
                providerId: `pi_synthetic_${attempt.id}`, status: 'succeeded', amountCents: attempt.quote.totalCents, receivedCents: attempt.quote.totalCents,
                currency: 'usd', quoteHash: attempt.quote.contentHash, attemptId: attempt.id, paymentMethodTypes: ['card'] }; } };
        const tax = { async calculate(input) { return { provider: 'SYNTHETIC', providerId: 'tax_synthetic', currency: 'usd', taxCents: 888,
            totalCents: input.subtotalCents + 888, requestHash: digest(input), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }; } };
        const service = new CommerceService({ repository, payment, tax });
        const quote = await service.quote({ draftId: draft.id, expectedRevision: draft.revision });
        assert.equal(quote.terms.paymentFlow, 'CUSTOMER_PHONE');
        assert.equal(quote.shippingCents, 0); assert.equal(quote.totalCents, count * 5000 + 888);
        publicLocation(quote.location, location);
        const input = { quoteId: quote.id, requestId: randomUUID() }, paid = await service.pay(input);
        assert.equal(paid.state, 'PAID'); assert.equal((await service.pay(input)).order.id, paid.order.id); assert.equal(creates, 1);
        publicLocation(paid.order.receipt.location, location);
        publicLocation((await call(who, 'commerce_order', { orderId: paid.order.id })).receipt.location, location);
        publicLocation((await call(who, 'commerce_checkout', { draftId: draft.id })).location, location);
        assert.deepEqual((await fixture.sql('SELECT "locationSnapshot" AS location FROM atlas_customer."CustomerIntakeDraft" WHERE id=$1::uuid', [draft.id], db.name)).rows[0].location, storedLocation);
        return { ...paid, cardIds, quote, draft, service };
    }
    const orderA = await paidKiosk(a, locationA, 2), orderB = await paidKiosk(b, locationB, 1);
    checks.push('intake create/read/list/card/verify/correct/review and customer checkout/quote/order hide dealer/device IDs while stored location snapshot retains exact binding');
    let projectionA = await dealer.read(enteredA.sessionToken, a.authority.browserHash), projectionB = await dealer.read(enteredB.sessionToken, b.authority.browserHash);
    assert.equal(projectionA.commission.accruedCents, 1000); assert.equal(projectionB.commission.accruedCents, 500);
    assert.equal(projectionA.cardCount, 2); assert.equal(projectionB.cardCount, 1); assert.equal(projectionA.customerCount, 1);
    assert.equal(projectionA.orderCount, 1); assert.deepEqual(projectionA.orders.map(o => o.reference), [orderA.order.reference]);
    assert(!JSON.stringify(projectionA).includes(orderB.order.reference)); assert(!JSON.stringify(projectionB).includes(orderA.order.reference));
    assert.equal(projectionA.commission.transferStatus, 'NO_TRANSFER_RECORDED');
    checks.push('two kiosk locations stay isolated; exact500 cents per full-price card accrue once, tax888 cents excluded and shipping0');
    const historyA = await call(a, 'dealer_orders', {}), historyB = await call(b, 'dealer_orders', {});
    assert.deepEqual(historyA.orders.map(o => o.id), [orderA.order.id]);
    assert.deepEqual(historyB.orders.map(o => o.id), [orderB.order.id]);
    assert.equal(historyA.orders[0].cardCount, 2); assert.equal(historyA.orders[0].channel, 'KIOSK');
    assert.equal(historyA.nextCursor, null);
    assert.deepEqual((await call(a, 'dealer_orders', { cursor: orderA.order.id })).orders, []);
    await assert.rejects(call(a, 'dealer_orders', { cursor: orderB.order.id }), { code: 'NOT_FOUND' });
    checks.push('customer order history contains only owned orders and rejects another owner’s pagination cursor');
    const cardId = orderA.cardIds[0], manualCardId = randomUUID(), foreignManualId = randomUUID();
    await manual.provision(reviewer.staff, { cardId: manualCardId, draft: { syntheticOnly: true, privateNotes: 'PRIVATE_MANUAL_FIXTURE_NOTE' } });
    await manual.provision(otherReviewer.staff, { cardId: foreignManualId, draft: { syntheticOnly: true, privateNotes: 'FOREIGN_MANUAL_FIXTURE_NOTE' } });
    const binding = { cardId, manualCardId, evidenceRef: 'SYNTHETIC_PHYSICAL_ASSOCIATION_ONLY' };
    await assert.rejects(staffCall('bind_manual', binding), { code: 'PHYSICAL_RECEIPT_AND_CARD_ACCESS_REQUIRED' });
    const custody = (kind, extra = {}) => ({ cardId, requestId: randomUUID(), kind, occurredAt: new Date().toISOString(),
        evidence: { reference: `SYNTHETIC_${kind}`, note: 'PRIVATE_CUSTODY_FIXTURE_NOTE' }, ...extra });
    for (const kind of ['RETURNED_TO_KIOSK','CUSTOMER_COLLECTED','ATLAS_RECEIVED'])
        await assert.rejects(staffCall('custody_record', custody(kind)), { code: 'CUSTODY_TRANSITION_INVALID' });
    assert.equal((await fixture.sql('SELECT count(*) AS n FROM atlas_dealer.custody_event', [], db.name)).rows[0].n, '0');
    checks.push('NULL predecessor cannot bypass first-event rules; manual link refused before actual synthetic receipt');
    await assert.rejects(call(b, 'dealer_deposit', { orderId: orderA.order.id, cardId, requestId: randomUUID() }), { code: installedHandoff?'STAFF_HANDOFF_REQUIRED':'NOT_FOUND' });
    await assert.rejects(call(a, 'dealer_deposit', { orderId: orderB.order.id, cardId, requestId: randomUUID() }), { code: installedHandoff?'STAFF_HANDOFF_REQUIRED':'NOT_FOUND' });
    const declaration = { orderId: orderA.order.id, cardId, requestId: randomUUID() };
    // Historical evidence seeding is restricted to this owned synthetic DB. It is never
    // manufactured through current customer mutation, which correctly rejects fresh deposits.
    if(installedHandoff)await fixture.sql(`INSERT INTO atlas_dealer.custody_event(card_id,sequence,request_id,input_hash,kind,customer_id,occurred_at,evidence)
      VALUES($1::uuid,1,$2::uuid,atlas_customer.commerce_hash($3::jsonb),'DEPOSIT_DECLARED',$4::uuid,clock_timestamp(),'{"meaning":"CUSTOMER_DECLARATION_ONLY"}'::jsonb)`,
      [cardId,declaration.requestId,JSON.stringify(declaration),a.customer.id],db.name);
    let deposited;
    try { deposited = await call(a, 'dealer_deposit', declaration); }
    catch (error) {
        const rows = await fixture.sql('SELECT c.card_id,c.channel,c.order_id,o."accountId" FROM atlas_dealer.order_card c JOIN atlas_customer."CommerceOrder" o ON o.id=c.order_id', [], db.name);
        writeFileSync(join(fixture.directory, 'dealer-ownership-census.json'), JSON.stringify({ expected: { cardId, accountId: a.customer.id }, observed: rows.rows, accountOrders: await call(a, 'dealer_orders', {}) }, null, 2));
        throw error;
    }
    assert.deepEqual(await call(a, 'dealer_deposit', declaration), deposited);
    let tracking = await call(a, 'dealer_tracking', { orderId: orderA.order.id });
    assert.equal(tracking.cards.find(c => c.cardId === cardId).collectedAt, null);
    assert.equal(tracking.cards.find(c => c.cardId === cardId).grading, 'NOT_STARTED');
    const collect = custody('COLLECTED'), collected = await staffCall('custody_record', collect);
    assert.deepEqual(await staffCall('custody_record', collect), collected);
    await assert.rejects(staffCall('custody_record', { ...collect, evidence: { reference: 'CHANGED_SYNTHETIC_REF' } }), { code: 'REQUEST_CONFLICT' });
    await assert.rejects(staffCall('custody_record', custody('ATLAS_RECEIVED', { occurredAt: new Date(Date.parse(collect.occurredAt) - 1).toISOString() })), { code: 'CUSTODY_EVENT_ORDER' });
    const received = custody('ATLAS_RECEIVED'); await staffCall('custody_record', received);
    await assert.rejects(staffCall('bind_manual', { ...binding, manualCardId: foreignManualId }), { code: 'PHYSICAL_RECEIPT_AND_CARD_ACCESS_REQUIRED' });
    const linked = await staffCall('bind_manual', binding); assert.deepEqual(await staffCall('bind_manual', binding), linked);
    await assert.rejects(staffCall('bind_manual', { ...binding, manualCardId: foreignManualId }), { code: 'MANUAL_CARD_ALREADY_BOUND' });
    await assert.rejects(staffCall('custody_record', custody('RETURN_DISPATCHED')), { code: 'CUSTODY_TRANSITION_INVALID' });
    checks.push('declaration proves no collection; custody order and exact retry enforced; received card binds only to accessible manual card; no return before approval');
    tracking = await call(a, 'dealer_tracking', { orderId: orderA.order.id });
    const tracked = tracking.cards.find(c => c.cardId === cardId);
    assert.deepEqual(tracked.events.map(e => e.kind), ['DEPOSIT_DECLARED','COLLECTED','ATLAS_RECEIVED']);
    assert.equal(tracked.grading, 'IN_GRADING'); assert.equal(tracked.approvedAt, null); assert.equal(tracked.reportUrl, null);
    assert.equal(Date.parse(tracked.turnaroundTarget) - Date.parse(tracked.collectedAt), 7 * 86400_000);
    await assert.rejects(call(b, 'dealer_tracking', { orderId: orderA.order.id }), { code: 'NOT_FOUND' });
    await assert.rejects(call(b, 'commerce_order', { orderId: orderA.order.id }), { code: 'NOT_FOUND' });
    projectionA = await dealer.read(enteredA.sessionToken, a.authority.browserHash);
    for (const text of [JSON.stringify(tracking), JSON.stringify(projectionA), JSON.stringify(historyA)]) {
        for (const hidden of ['PRIVATE_MANUAL_FIXTURE_NOTE','PRIVATE_CUSTODY_FIXTURE_NOTE','SYNTHETIC_PHYSICAL_ASSOCIATION_ONLY',profile.email,profile.address1,'+12025550301','clientSecret','sessionHash'])
            if (hidden) assert(!text.includes(hidden), `Private field leaked: ${hidden}`);
        assert(!text.includes(foreignManualId));
    }
    checks.push('owner-only tracker exposes actual collection-based week and current manual status, excludes private notes/addresses/payment/session data');
    // Owner-approved phone-paid shop handoff: additive schema in this disposable fixture only.
    if(!installedHandoff)await fixture.sql(readFileSync(new URL('../../../packages/atlas-dealer-operations/sql/handoff-proposal.sql', import.meta.url), 'utf8'), [], db.name);
    if(!installedProgress)await fixture.sql(readFileSync(new URL('../../../packages/atlas-commerce/sql/progress-notifications-proposal.sql', import.meta.url), 'utf8'), [], db.name);
    assert.deepEqual(await call(a,'progress_preferences',{}),{revision:0,email:false,sms:false,deliveryEnabled:false});
    await assert.rejects(call(a,'progress_preferences',{accountId:b.customer.id}),{code:'INVALID_REQUEST'});
    const preferenceInput={requestId:randomUUID(),expectedRevision:0,email:true,sms:true};
    const preference=await call(a,'progress_preferences_save',preferenceInput);
    assert.equal(preference.revision,1);assert.equal(preference.email,true);assert.equal(preference.sms,true);
    assert.deepEqual(await call(a,'progress_preferences_save',preferenceInput),preference);
    await assert.rejects(call(a,'progress_preferences_save',{...preferenceInput,sms:false}),{code:'REQUEST_CONFLICT'});
    assert.equal((await call(b,'progress_preferences',{})).revision,0);
    assert.equal((await fixture.sql('SELECT count(*)::int n FROM atlas_customer."ProgressNotification"',[],db.name)).rows[0].n,0);
    checks.push('progress preferences default off, are account-scoped and immutable-audited, and exact retries do not change revision; prior custody history is not replayed');

    assert.deepEqual(await call(a, 'dealer_deposit', declaration), deposited);
    await assert.rejects(call(a, 'dealer_deposit', { ...declaration, requestId: randomUUID() }), { code: 'STAFF_HANDOFF_REQUIRED' });
    await assert.rejects(dealer.issueHandoff(a.authority, orderA.order.id), { code: 'HANDOFF_ALREADY_ADVANCED' });
    await assert.rejects(dealer.issueHandoff(a.authority, orderB.order.id), { code: 'NOT_FOUND' });
    const phoneOnlyShop = {...locationInput('PHONE'), terminalId:null, terminalLocationId:null, packagePrinterId:null};
    await staffCall('location_configure', phoneOnlyShop);
    const phoneLocation=(await fixture.sql('SELECT terminal_id,terminal_location_id,package_printer_id FROM atlas_dealer.location WHERE id=$1::uuid',[phoneOnlyShop.id],db.name)).rows[0];
    assert.deepEqual(phoneLocation,{terminal_id:null,terminal_location_id:null,package_printer_id:null});
    const nextOrder=await paidKiosk(a,locationA,2);
    const issued=await dealer.issueHandoff(a.authority,nextOrder.order.id),issuedAgain=await dealer.issueHandoff(a.authority,nextOrder.order.id);
    assert.equal(issued.token,issuedAgain.token);assert.equal(issued.handoff.status,'AWAITING_SHOP_RECEIPT');assert.equal(issued.handoff.receipt,null);
    assert.equal(issued.handoff.cardCount,2);assert.equal(issued.handoff.location.id,locationA.id);
    let nextTracking=await call(a,'dealer_tracking',{orderId:nextOrder.order.id});
    assert(nextTracking.cards.every(c=>c.events.length===0&&!c.collectedAt));
    await assert.rejects(dealer.handoffRead(enteredB.sessionToken,b.authority.browserHash,enteredB.csrf,issued.token),{code:'HANDOFF_NOT_FOUND'});
    await assert.rejects(dealer.handoffRead(enteredA.sessionToken,b.authority.browserHash,enteredA.csrf,issued.token),{code:'DEALER_SIGN_IN_REQUIRED'});
    const detail=(await dealer.handoffRead(enteredA.sessionToken,a.authority.browserHash,enteredA.csrf,issued.token)).handoff;
    assert.deepEqual(detail.cards.map(c=>c.cardId),[...nextOrder.cardIds].sort());
    assert(!JSON.stringify(detail).includes(profile.email));assert(!JSON.stringify(detail).includes(profile.address1));
    const confirmInput={requestId:randomUUID(),cardIds:nextOrder.cardIds,confirmedCount:2};
    await assert.rejects(dealer.handoffConfirm(enteredA.sessionToken,a.authority.browserHash,enteredA.csrf,issued.token,{...confirmInput,cardIds:[nextOrder.cardIds[0]],confirmedCount:1}),{code:'HANDOFF_CARD_COUNT_MISMATCH'});
    await assert.rejects(dealer.handoffConfirm(enteredA.sessionToken,a.authority.browserHash,enteredA.csrf,issued.token,{...confirmInput,cardIds:[nextOrder.cardIds[0],orderA.cardIds[0]]}),{code:'HANDOFF_CARD_COUNT_MISMATCH'});
    const confirmed=await Promise.all([confirmInput,{...confirmInput,requestId:randomUUID()}].map(input=>dealer.handoffConfirm(enteredA.sessionToken,a.authority.browserHash,enteredA.csrf,issued.token,input)));
    assert.equal(confirmed[0].handoff.receipt.id,confirmed[1].handoff.receipt.id);
    assert.equal(confirmed[0].handoff.status,'RECEIVED');assert.equal(confirmed[0].handoff.receipt.cardCount,2);
    assert.deepEqual(await dealer.handoffConfirm(enteredA.sessionToken,a.authority.browserHash,enteredA.csrf,issued.token,confirmInput),confirmed[0]);
    const receiptCount=(await fixture.sql('SELECT count(*)::int AS n FROM atlas_dealer.handoff_receipt WHERE handoff_id=$1::uuid',[issued.handoff.id],db.name)).rows[0].n;
    assert.equal(receiptCount,1);
    const receiptOrder=(await dealer.read(enteredA.sessionToken,a.authority.browserHash)).orders.find(o=>o.reference===nextOrder.order.reference);
    assert(receiptOrder.cards.every(c=>c.custody==='DEALER_RECEIVED'));
    const progressRows=(await fixture.sql('SELECT id,channel,"eventKind",request FROM atlas_customer."ProgressNotification" ORDER BY id',[],db.name)).rows;
    assert.equal(progressRows.length,4);assert(progressRows.every(e=>e.eventKind==='DEALER_RECEIVED'));
    assert.equal(progressRows.filter(e=>e.channel==='EMAIL').length,2);assert.equal(progressRows.filter(e=>e.channel==='SMS').length,2);
    const progressCall=(name,input)=>privateDatabase.call('progress',{name,input});
    await assert.rejects(progressCall('pending',{}),{code:'PROGRESS_NOT_ENABLED'});
    for(const table of ['ProgressPreference','ProgressPreferenceEvent','ProgressNotification'])await assert.rejects(customerClient.$queryRawUnsafe(`SELECT * FROM atlas_customer."${table}"`));
    await fixture.sql(`UPDATE atlas_customer."ProgressNotificationControl" SET enabled=true WHERE id='active'`,[],db.name);
    assert.equal((await progressCall('pending',{})).ids.length,4);
    const emailRows=progressRows.filter(e=>e.channel==='EMAIL'),claimId=randomUUID();
    const claims=await Promise.all([claimId,randomUUID()].map(claimId=>progressCall('claim',{id:emailRows[0].id,claimId})));
    assert.equal(claims.filter(c=>c.dispatch).length,1);
    const savedClaim=(await fixture.sql('SELECT "claimId" FROM atlas_customer."ProgressNotification" WHERE id=$1',[emailRows[0].id],db.name)).rows[0].claimId;
    await progressCall('finish',{id:emailRows[0].id,claimId:savedClaim,state:'UNKNOWN',result:{code:'PROGRESS_OUTCOME_UNKNOWN'}});
    assert.equal((await progressCall('claim',{id:emailRows[0].id,claimId:randomUUID()})).dispatch,false);
    const successClaim=randomUUID();assert.equal((await progressCall('claim',{id:emailRows[1].id,claimId:successClaim})).dispatch,true);
    const finish={id:emailRows[1].id,claimId:successClaim,state:'ACCEPTED',result:{provider:'SENDGRID',providerId:'synthetic-progress-id',deliveryStatus:'ACCEPTED'}};
    assert.deepEqual(await progressCall('finish',finish),{state:'ACCEPTED'});assert.deepEqual(await progressCall('finish',finish),{state:'ACCEPTED'});
    await call(a,'progress_preferences_save',{requestId:randomUUID(),expectedRevision:1,email:true,sms:false});
    for(const row of progressRows.filter(e=>e.channel==='SMS'))assert.equal((await progressCall('claim',{id:row.id,claimId:randomUUID()})).dispatch,false);
    assert.equal((await progressCall('pending',{})).ids.length,0);
    checks.push('actual handoff INSERT atomically enqueues exactly one row per card/channel; default-disabled worker cannot claim; concurrent claim wins once; UNKNOWN is quarantined; accepted finish replays; opt-out suppresses pending sends; restricted role cannot read tables');

    nextTracking=await call(a,'dealer_tracking',{orderId:nextOrder.order.id});
    assert(nextTracking.cards.every(c=>c.events.length===1&&c.events[0].kind==='DEALER_RECEIVED'&&!c.collectedAt&&!c.turnaroundTarget));
    const persistedHandoffRequest=(await fixture.sql('SELECT request_id FROM atlas_dealer.handoff_receipt WHERE handoff_id=$1::uuid',[issued.handoff.id],db.name)).rows[0].request_id;
    const later=await paidKiosk(a,locationA,1),laterHandoff=await dealer.issueHandoff(a.authority,later.order.id);
    await assert.rejects(dealer.handoffConfirm(enteredA.sessionToken,a.authority.browserHash,enteredA.csrf,laterHandoff.token,{...confirmInput,requestId:persistedHandoffRequest,cardIds:later.cardIds,confirmedCount:1}),{code:'REQUEST_CONFLICT'});
    for(const table of ['handoff','handoff_receipt']){
      await assert.rejects(customerClient.$queryRawUnsafe(`SELECT * FROM atlas_dealer.${table}`));
      await assert.rejects(fixture.sql(`UPDATE atlas_dealer.${table} SET id=id`,[],db.name),/Immutable/iu);
    }
    await assert.rejects(customerClient.$queryRaw`SELECT atlas_dealer.handoff_projection(${issued.handoff.id}::uuid,true)`);
    // Existing collector still advances actual custody once; the seven-day clock starts here.
    const handoffCollectedAt=new Date().toISOString();
    await staffCall('custody_record',{cardId:nextOrder.cardIds[0],requestId:randomUUID(),kind:'COLLECTED',occurredAt:handoffCollectedAt,evidence:{reference:'SYNTHETIC_SHOP_COLLECTION'}});
    nextTracking=await call(a,'dealer_tracking',{orderId:nextOrder.order.id});
    const nowCollected=nextTracking.cards.find(c=>c.cardId===nextOrder.cardIds[0]);
    assert.deepEqual(nowCollected.events.map(e=>e.kind),['DEALER_RECEIVED','COLLECTED']);
    assert.equal(Date.parse(nowCollected.turnaroundTarget)-Date.parse(nowCollected.collectedAt),7*86400_000);
    const collectedNotice=(await fixture.sql(`SELECT id,"eventKind",channel FROM atlas_customer."ProgressNotification" WHERE state='PENDING'`,[],db.name)).rows;
    assert.equal(collectedNotice.length,1);assert.equal(collectedNotice[0].eventKind,'COLLECTED');assert.equal(collectedNotice[0].channel,'EMAIL');
    const contactCleared=(await call(a,'profile',{profile:{name:profile.name,email:''}})).customer;
    assert.equal(Object.hasOwn(contactCleared.profile,'email'),false);assert.equal(contactCleared.profile.address1,profile.address1);
    assert.equal((await progressCall('claim',{id:collectedNotice[0].id,claimId:randomUUID()})).dispatch,false);
    assert.equal((await progressCall('pending',{})).ids.length,0);
    assert.equal((await fixture.sql('SELECT count(*)::int n FROM atlas_customer."ProgressNotification"',[],db.name)).rows[0].n,5);
    checks.push('subsequent physical collection creates only the opted-in email event; clearing optional email suppresses pending delivery while preserving the mailing address');
    await staffCall('custody_record',{cardId:nextOrder.cardIds[0],requestId:randomUUID(),kind:'ATLAS_RECEIVED',occurredAt:new Date().toISOString(),evidence:{reference:'SYNTHETIC_PROGRESS_ARRIVAL'}});
    assert.equal((await fixture.sql('SELECT count(*)::int n FROM atlas_customer."ProgressNotification"',[],db.name)).rows[0].n,5);
    await call(a,'profile',{profile:{name:profile.name,email:'changed-synthetic@example.test'}});
    checks.push('recorded arrival after email removal does not enqueue an empty email destination despite retained preference; adding contact email preserves subsequent real event delivery');
    const gradingCard=randomUUID();await manual.provision(reviewer.staff,{cardId:gradingCard,draft:{syntheticOnly:true}});
    const gradingLink={cardId:nextOrder.cardIds[0],manualCardId:gradingCard,evidenceRef:'SYNTHETIC_PROGRESS_CARD_LINK'};
    await staffCall('bind_manual',gradingLink);await staffCall('bind_manual',gradingLink);
    const gradingNotices=(await fixture.sql(`SELECT id,request FROM atlas_customer."ProgressNotification" WHERE "eventKind"='GRADING_STARTED'`,[],db.name)).rows;
    assert.equal(gradingNotices.length,1);assert.match(gradingNotices[0].request.title,/Synthetic/);
    const gradingClaim=await progressCall('claim',{id:gradingNotices[0].id,claimId:randomUUID()});assert.equal(gradingClaim.dispatch,true);
    assert.equal(gradingClaim.effect.request.cardId,nextOrder.cardIds[0]);assert.equal(gradingClaim.effect.request.eventKind,'GRADING_STARTED');
    checks.push('actual received-card manual link atomically creates one grading-start notification with the saved paid-card title; exact bind replay creates no duplicate');

    // Seed publication prerequisites explicitly in this disposable database, then
    // perform the actual PRODUCTION-mode transition under the real publication grants.
    // This tests trigger privileges, not a human certification or external publication.
    const publicationClient=await restricted('atlas_fixture_progress_publisher',[
      role=>`GRANT USAGE ON SCHEMA atlas_manual TO "${role}";`,publicationGrantSQL]);
    const publishAction=randomUUID(),publicToken='ar_'+randomBytes(18).toString('base64url'),reportNumber='ATLAS-'+randomBytes(6).toString('hex').toUpperCase();
    await fixture.sql(`INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result)
      VALUES($1::uuid,$2::uuid,$3::uuid,1,2,encode(sha256(convert_to($4,'UTF8')),'hex'),$4,'{"syntheticOnly":true}')`,
      [gradingCard,publishAction,reviewer.staff.id,'{"action":{"type":"APPROVE_REPORT"},"syntheticOnly":true}'],db.name);
    await fixture.sql(`INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report)
      SELECT id,$2::uuid,$3::uuid,revision,content_hash,encode(sha256(convert_to($4,'UTF8')),'hex'),$4 FROM atlas_manual.card WHERE id=$1::uuid`,
      [gradingCard,publishAction,reviewer.staff.id,'{"syntheticOnly":true}'],db.name);
    await fixture.sql('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)',[gradingCard,publicToken,reportNumber],db.name);
    await fixture.sql("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,1,'PRODUCTION')",[gradingCard,publishAction],db.name);
    await assert.rejects(publicationClient.$queryRaw`SELECT * FROM atlas_dealer.order_card`);
    await assert.rejects(publicationClient.$queryRaw`SELECT * FROM atlas_customer."ProgressNotification"`);
    await assert.rejects(publicationClient.$queryRaw`SELECT atlas_customer.enqueue_progress(${nextOrder.cardIds[0]}::uuid,'REPORT_PUBLISHED','forged',clock_timestamp(),'{}'::jsonb)`);
    const manifest='{"syntheticOnly":true}';
    assert.equal(await publicationClient.$executeRawUnsafe(`UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$1,manifest_hash=$2,public_hash=$3,published_at=clock_timestamp()
      WHERE card_id=$4::uuid AND action_id=$5::uuid AND state='PENDING'`,manifest,createHash('sha256').update(manifest).digest('hex'),'f'.repeat(64),gradingCard,publishAction),1);
    assert.equal(await publicationClient.$executeRawUnsafe(`UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$1,manifest_hash=$2,public_hash=$3,published_at=clock_timestamp()
      WHERE card_id=$4::uuid AND action_id=$5::uuid AND state='PENDING'`,manifest,createHash('sha256').update(manifest).digest('hex'),'f'.repeat(64),gradingCard,publishAction),0);
    const publicationNotices=(await fixture.sql(`SELECT id,"accountId","cardId",channel,source FROM atlas_customer."ProgressNotification" WHERE "eventKind"='REPORT_PUBLISHED'`,[],db.name)).rows;
    assert.equal(publicationNotices.length,1);assert.equal(publicationNotices[0].accountId,a.customer.id);assert.equal(publicationNotices[0].cardId,nextOrder.cardIds[0]);assert.equal(publicationNotices[0].channel,'EMAIL');
    assert.deepEqual(publicationNotices[0].source,{type:'PUBLICATION',cardId:gradingCard,actionId:publishAction,version:1});
    const publicationClaim=await progressCall('claim',{id:publicationNotices[0].id,claimId:randomUUID()});assert.equal(publicationClaim.dispatch,true);assert.equal(publicationClaim.effect.request.eventKind,'REPORT_PUBLISHED');
    assert.equal((await call(a,'dealer_tracking',{orderId:nextOrder.order.id})).cards.find(c=>c.cardId===nextOrder.cardIds[0]).reportUrl,`/reports/${publicToken}?v=1`);
    // The writer still has no arbitrary cross-schema read/enqueue privilege afterward.
    await assert.rejects(publicationClient.$queryRaw`SELECT * FROM atlas_customer."ProgressNotification"`);
    checks.push('real publicationGrantSQL role completes synthetic PRODUCTION publication and enqueues one scoped opted-in notice; duplicate transition is inert; customer/dealer tables and enqueue helper remain inaccessible');

    checks.push('shop QR issue proves no custody; exact paid order/account/location/card set, count and existing dealer session are rechecked; concurrent scans produce one immutable receipt; collection starts clock separately');
    // The real head-chain profile gateway supports first-time contact without
    // giving a caller authority to change verified phone, account or intake type.
    const contactCustomer=await login(auth,config,'+12025550303');
    const freshContact=(await call(contactCustomer,'profile',{profile:{name:'Synthetic First Shop Customer'}})).customer;
    assert.deepEqual(freshContact.profile,{name:'Synthetic First Shop Customer'});assert.equal(freshContact.phone,'+12025550303');
    for(const invalid of [{name:''},{name:'Synthetic',email:null},{name:'Synthetic',email:'bad'},
      {name:'Synthetic',phone:'+12025550302'},{name:'Synthetic',accountId:b.customer.id}])
      await assert.rejects(call(contactCustomer,'profile',{profile:invalid}),{code:'CONTACT_DETAILS_REQUIRED'});
    await assert.rejects(call(contactCustomer,'profile',{profile:{name:'Synthetic'},accountId:b.customer.id}),{code:'INVALID_REQUEST'});
    await assert.rejects(call(contactCustomer,'progress_preferences_save',{requestId:randomUUID(),expectedRevision:0,email:true,sms:false}),{code:'PROFILE_EMAIL_REQUIRED'});
    const contactPreferences=await call(contactCustomer,'progress_preferences_save',{requestId:randomUUID(),expectedRevision:0,email:false,sms:true});
    assert.equal(contactPreferences.email,false);assert.equal(contactPreferences.sms,true);
    const {draft:mailDraft}=await call(contactCustomer,'intake_create',{requestId:randomUUID(),intakeMethod:'MAIL_IN',kioskId:null});
    await assert.rejects(call(contactCustomer,'intake_review',{id:mailDraft.id,expectedRevision:mailDraft.revision,profile:{name:'Synthetic'},intakeMethod:'DEALER_DROP_OFF'}),{code:'RETURN_DETAILS_REQUIRED'});
    await assert.rejects(call(contactCustomer,'intake_review',{id:mailDraft.id,expectedRevision:mailDraft.revision,profile}),{code:'INTAKE_REVIEW_NOT_READY'});
    const {draft:shopDraft}=await call(contactCustomer,'intake_create',{requestId:randomUUID(),intakeMethod:'DEALER_DROP_OFF',kioskId:locationA.id});
    await assert.rejects(call(contactCustomer,'intake_review',{id:shopDraft.id,expectedRevision:shopDraft.revision,profile:{name:'Synthetic'}}),{code:'INTAKE_REVIEW_NOT_READY'});
    await assert.rejects(call(contactCustomer,'intake_review',{id:shopDraft.id,expectedRevision:shopDraft.revision,profile:{name:'Synthetic',email:'bad'}}),{code:'CONTACT_DETAILS_REQUIRED'});
    const immutablePaid=(await call(a,'commerce_order',{orderId:orderA.order.id})).receipt;
    await call(a,'profile',{profile:{name:'Updated synthetic contact'}});
    const updatedAccount=(await auth.bootstrap(a.cookie,'dealer-postgres-fixture')).customer;
    assert.equal(updatedAccount.profile.email,'changed-synthetic@example.test');assert.equal(updatedAccount.profile.address1,profile.address1);
    assert.deepEqual((await call(a,'commerce_order',{orderId:orderA.order.id})).receipt,immutablePaid);
    assert.deepEqual((await auth.bootstrap(b.cookie,'dealer-postgres-fixture')).customer.profile,profile);
    for(const fn of ['valid_contact_profile','valid_shop_profile'])await assert.rejects(customerClient.$queryRawUnsafe(`SELECT atlas_customer.${fn}('{"name":"forged"}'::jsonb)`));
    await assert.rejects(customerClient.$queryRaw`SELECT atlas_customer.customer_call_before_shop_profile('profile','{}'::jsonb,'{}'::jsonb)`);
    checks.push('first-time name-only contact uses verified phone; optional email validates, omitted email and saved shipping persist, paid receipts and other accounts stay immutable; stored MAIL_IN requires address, shop does not; no-email email opt-in is denied while SMS opt-in succeeds; old gateway/helpers remain uncallable');
    await staffCall('membership_configure', { accountId: a.customer.id, locationId: locationA.id, enabled: false });
    await assert.rejects(dealer.read(enteredA.sessionToken, a.authority.browserHash), { code: 'DEALER_SIGN_IN_REQUIRED' });
    await assert.rejects(dealer.handoffRead(enteredA.sessionToken,a.authority.browserHash,enteredA.csrf,issued.token),{code:'DEALER_SIGN_IN_REQUIRED'});
    assert.equal((await dealer.read(enteredB.sessionToken, b.authority.browserHash)).location.id, locationB.id);
    assert.throws(() => dealer.logout(enteredB.sessionToken, b.authority.browserHash, '0'.repeat(64)), { code: 'CSRF_REQUIRED' });
    await dealer.logout(enteredB.sessionToken, b.authority.browserHash, enteredB.csrf);
    await assert.rejects(dealer.read(enteredB.sessionToken, b.authority.browserHash), { code: 'DEALER_SIGN_IN_REQUIRED' });
    await admin.staffOperationsGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    await assert.rejects(staffCall('membership_configure', { accountId: a.customer.id, locationId: locationA.id, enabled: true }), { code: 'FRESH_HUMAN_OPERATIONS_REQUIRED' });
    checks.push('membership revocation invalidates only its dealer session; CSRF/logout and operations grant revocation enforced');
    const result = { pass: true, syntheticOnly: true, networkProviders: false, humanOrPhysicalAcceptance: false, checks,
        publicMigrations: fixture.source.publicMigrations.length, staffMigrations: fixture.source.staffMigrations.length, evidenceDirectory: fixture.directory };
    writeFileSync(join(fixture.directory, 'dealer-result.json'), JSON.stringify(result, null, 2)); process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
    writeFileSync(join(fixture.directory, 'dealer-result.json'), JSON.stringify({ pass: false, syntheticOnly: true, checks, error: fixture.safe(error.message), evidenceDirectory: fixture.directory }, null, 2));
    throw error;
} finally {
    await Promise.all(clients.map(c => c.$disconnect())); await fixture.stop();
}
