import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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
        const repository = new GatewayCommerceRepository((name, input) => privateDatabase.call('commerce', { name, providerBinding, input: { ...input, authority: who.authority } }));
        let creates = 0;
        const payment = { binding: merchant, async create(attempt) { creates++; return { state: 'AWAITING_PAYMENT', providerId: `pi_synthetic_${attempt.id}` }; },
            async retrieve(attempt) { return { source: 'PROVIDER_RETRIEVAL', provider: 'STRIPE', merchantId: merchant.accountId, livemode: false,
                providerId: `pi_synthetic_${attempt.id}`, status: 'succeeded', amountCents: attempt.quote.totalCents, receivedCents: attempt.quote.totalCents,
                currency: 'usd', quoteHash: attempt.quote.contentHash, attemptId: attempt.id, paymentMethodTypes: ['card_present'] }; } };
        const tax = { async calculate(input) { return { provider: 'SYNTHETIC', providerId: 'tax_synthetic', currency: 'usd', taxCents: 888,
            totalCents: input.subtotalCents + 888, requestHash: digest(input), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }; } };
        const service = new CommerceService({ repository, payment, tax });
        const quote = await service.quote({ draftId: draft.id, expectedRevision: draft.revision });
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
    await assert.rejects(call(b, 'dealer_deposit', { orderId: orderA.order.id, cardId, requestId: randomUUID() }), { code: 'NOT_FOUND' });
    await assert.rejects(call(a, 'dealer_deposit', { orderId: orderB.order.id, cardId, requestId: randomUUID() }), { code: 'NOT_FOUND' });
    const declaration = { orderId: orderA.order.id, cardId, requestId: randomUUID() };
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
    await staffCall('membership_configure', { accountId: a.customer.id, locationId: locationA.id, enabled: false });
    await assert.rejects(dealer.read(enteredA.sessionToken, a.authority.browserHash), { code: 'DEALER_SIGN_IN_REQUIRED' });
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
