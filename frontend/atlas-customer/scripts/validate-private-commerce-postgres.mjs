import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '../../atlas-app/.generated/staff-database/index.js';
import { disposablePostgres } from '../../atlas-app/scripts/disposable-postgres.mjs';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { CustomerDatabase } from '../lib/server/database.mjs';
import { localConfig, fixtureProvider } from '../lib/server/fixture.mjs';
import { customerPrivateGrantSQL, createCustomerPrivateDatabase } from '../../../packages/atlas-connected-manual/scripts/customer-database.mjs';
import { CommerceService } from '../../../packages/atlas-commerce/src/service.mjs';
import { GatewayCommerceRepository } from '../../../packages/atlas-commerce/src/repository.mjs';
import { digest } from '../../../packages/atlas-commerce/src/contract.mjs';
import { profile, source as syntheticSource } from '../../../packages/atlas-commerce/test/fixtures.mjs';

// Only this helper can create the target. No external database URL is accepted.
const fixture = await disposablePostgres(process.argv.slice(2));
let admin, customerClient, privateClient;
const checks = [];
try {
    const db = await fixture.database();
    await fixture.sql(readFileSync(new URL('../../../packages/atlas-dealer-operations/test/schedule-acceptance.sql', import.meta.url), 'utf8'), [], db.name);
    checks.push('dealer schedule SQL: owner example, cutoff, closures, extra route, DST and malformed schedules');
    admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } });
    customerClient = new PrismaClient({ datasources: { db: { url: db.customerUrl } } });
    const privateRole = 'atlas_fixture_private_customer', privatePassword = randomBytes(24).toString('hex');
    await fixture.sql(`CREATE ROLE ${privateRole} LOGIN PASSWORD '${privatePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    for (const statement of customerPrivateGrantSQL(privateRole).split(';').filter(value => value.trim())) await fixture.sql(statement, [], db.name);
    const privateUrl = new URL(db.customerUrl); privateUrl.username = privateRole; privateUrl.password = privatePassword;
    privateClient = new PrismaClient({ datasources: { db: { url: privateUrl.href } } });
    const config = localConfig({ databaseUrl: db.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
    const auth = new CustomerAuth({ database: new CustomerDatabase(customerClient, config), config, provider: fixtureProvider(config) });
    const privateDatabase = createCustomerPrivateDatabase({ client: privateClient, binding: config.binding });
    await admin.$executeRaw`INSERT INTO atlas_customer."CustomerControl"(enabled,mode,origin,"deploymentId","releaseSha","configHash")
        VALUES(true,${config.mode},${config.origin},${config.deploymentId},${config.releaseSha},${config.configHash})`;
    await assert.rejects(privateDatabase.call('directory', { input: {} }), { code: 'CUSTOMER_SERVICE_NOT_ENABLED' });
    await admin.$executeRaw`INSERT INTO atlas_customer."CustomerServiceControl"(enabled,binding,"identificationEnabled") VALUES(true,${JSON.stringify(config.binding)}::jsonb,false)`;
    assert.deepEqual((await privateDatabase.call('directory', { input: {} })).locations, []);
    await assert.rejects(privateDatabase.call('intake', { name: 'claim', input: {} }), { code: 'IDENTIFICATION_NOT_CONFIGURED' });
    await assert.rejects(privateDatabase.call('intake', { name: 'sql', input: {} }), { code: 'NOT_FOUND' });
    checks.push('private service cold by default; identification separately disabled; action allowlist enforced');
    await assert.rejects(privateClient.$queryRaw`SELECT * FROM atlas_customer."CustomerIntakeDraft"`);
    await assert.rejects(privateClient.$queryRaw`SELECT atlas_customer.intake_worker_call('claim','{}'::jsonb)`);
    await assert.rejects(privateClient.$queryRaw`SELECT atlas_customer.commerce_provider_call('commerce_pending_effects','{}'::jsonb,'{}'::jsonb)`);
    await assert.rejects(privateClient.$queryRaw`SELECT atlas_customer.customer_call('list','{}'::jsonb,'{}'::jsonb)`);
    await assert.rejects(customerClient.$queryRaw`SELECT atlas_customer.customer_private_call('directory','{}'::jsonb,'{}'::jsonb)`);
    checks.push('private role has only exact service function; customer role cannot enter private gateway');
    async function login(phone) {
        const boot = await auth.bootstrap(undefined, 'private-commerce-fixture'), initial = `${config.cookies.browser}=${boot.browserToken}`;
        const challenge = await auth.send(initial, boot.csrf, { phone, requestId: randomUUID() }, 'private-commerce-fixture');
        const signed = await auth.verify(initial, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'private-commerce-fixture');
        const cookie = `${initial}; ${config.cookies.session}=${signed.token}`;
        return { ...signed, cookie, authority: { binding: config.binding, ...auth.authority(cookie, signed.csrf) } };
    }
    const a = await login('+12025550201'), b = await login('+12025550202');
    const call = (action, input, who = a) => auth.call(who.cookie, action, input, who.csrf);
    await call('profile', { profile });
    let { draft } = await call('intake_create', { requestId: randomUUID(), intakeMethod: 'MAIL_IN', kioskId: null });
    const card = { requestId: randomUUID(), cardId: randomUUID(), pairId: randomUUID(),
        front: { uploadId: randomUUID(), sha256: '1'.repeat(64), byteCount: 10, fileName: 'synthetic-front.jpg' },
        back: { uploadId: randomUUID(), sha256: '2'.repeat(64), byteCount: 11, fileName: 'synthetic-back.jpg' } };
    draft = (await call('intake_card', { id: draft.id, card })).draft;
    for (const side of ['front','back']) {
        const input = { id: draft.id, cardId: card.cardId, uploadId: card[side].uploadId };
        const { upload } = await call('intake_upload', input);
        const verification = { object: upload.plan.object, ...upload.plan.expected, contentType: 'application/octet-stream' };
        await assert.rejects(privateDatabase.call('intake', { name: 'verify', input: { ...input, authority: b.authority, verification } }), { code: 'NOT_FOUND' });
        draft = (await privateDatabase.call('intake', { name: 'verify', input: { ...input, authority: a.authority, verification } })).draft;
    }
    const identity = { category: 'SPORTS', title: 'Synthetic acceptance card', playerName: 'Fixture Player', year: '2026', manufacturer: 'Fixture', setName: 'Fixture Set', cardNumber: '1', parallel: '', insert: '' };
    draft = (await call('intake_correct', { id: draft.id, cardId: card.cardId, expectedRevision: draft.cards[0].revision, identity })).draft;
    draft = (await call('intake_review', { id: draft.id, expectedRevision: draft.revision, profile })).draft;
    checks.push('real synthetic customer session required for private upload verification; foreign owner refused');
    const merchant = { provider: 'STRIPE', accountId: 'acct_synthetic_only', livemode: false };
    const providerBinding = { fixture: randomUUID() };
    // These are fixture-only alternatives, not an answer to the owner's open mail terms.
    const terms = { mailClockStart: 'ATLAS_RECEIPT', mailChargedLegs: 'INBOUND_ONLY' };
    const shippingPlans = syntheticSource('MAIL_IN', 1).shippingPlans;
    // Time-relative values are synthetic fixture inputs, never real shipping
    // dates, measurements, provider quotes or owner-selected mail terms.
    for (const plan of shippingPlans) {
        plan.validFrom = new Date(Date.now() - 60000).toISOString(); plan.validUntil = new Date(Date.now() + 3600000).toISOString();
        for (const leg of Object.values(plan.legs)) leg.requestedShipment.shipDatestamp = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    }
    await admin.$executeRaw`INSERT INTO atlas_customer."CommerceControl"(enabled,binding,merchant,terms,"shippingPlans")
        VALUES(true,${JSON.stringify(providerBinding)}::jsonb,${JSON.stringify(merchant)}::jsonb,${JSON.stringify(terms)}::jsonb,${JSON.stringify(shippingPlans)}::jsonb)`;
    const repositoryFor = who => new GatewayCommerceRepository((name, input) => privateDatabase.call('commerce', { name, providerBinding, input: { ...input, authority: who.authority } }));
    const repository = repositoryFor(a), otherRepository = repositoryFor(b);
    let creates = 0, retrieves = 0, known = false;
    const expires = () => new Date(Date.now() + 10 * 60_000).toISOString();
    const payment = { binding: merchant, publishableKey: 'pk_test_synthetic', async create() { creates++; throw Error('Synthetic lost response'); },
        async retrieve(attempt) { retrieves++; if (!known) throw Error('Synthetic unresolved provider state');
            return { source: 'PROVIDER_RETRIEVAL', provider: 'STRIPE', merchantId: merchant.accountId, livemode: false,
                providerId: `pi_synthetic_${attempt.id}`, status: 'succeeded', amountCents: attempt.quote.totalCents,
                receivedCents: attempt.quote.totalCents, currency: 'usd', quoteHash: attempt.quote.contentHash, attemptId: attempt.id, paymentMethodTypes: ['card'] }; } };
    const tax = { async calculate(input) { return { provider: 'SYNTHETIC', providerId: 'tax_synthetic', currency: 'usd', taxCents: 400,
        totalCents: input.subtotalCents + input.shippingCents + 400, requestHash: digest(input), expiresAt: expires() }; } };
    const carrier = { async quote(input) { return { provider: 'FEDEX', providerId: 'rate_synthetic', currency: 'usd', amountCents: 1250, requestHash: digest(input), expiresAt: expires() }; } };
    const service = new CommerceService({ repository, payment, tax, carrier, terms });
    await assert.rejects(otherRepository.loadCheckout(draft.id), { code: 'NOT_FOUND' });
    const internalSource = await repository.loadCheckout(draft.id);
    assert.equal(internalSource.accountId, a.customer.id); assert.deepEqual(internalSource.profile, profile);
    const privateKeys = new Set(['accountId','profile','phone','merchant','tax','payment','observation','providerId','provider','request',
        'photoPairHash','contentHash','commissionCents','dealerId','terminalId','terminalLocationId','packagePrinterId','entryToken','shippingPlans','shippingPlan','measurementReference']);
    function customerSafe(value) {
        function walk(node) {
            if (!node || typeof node !== 'object') return;
            for (const [key, item] of Object.entries(node)) { assert(!privateKeys.has(key), `Private customer DTO key: ${key}`); walk(item); }
        }
        walk(value);
        const text = JSON.stringify(value);
        for (const hidden of [profile.email,profile.address1,'+12025550201',merchant.accountId,'tax_synthetic','rate_synthetic',internalSource.cards[0].photoPairHash])
            assert(!text.includes(hidden), `Private customer DTO value: ${hidden}`);
    }
    const initialCustomerCheckout = await call('commerce_checkout', { draftId: draft.id });
    assert.equal(initialCustomerCheckout.version, 'atlas-commerce-checkout-v1'); customerSafe(initialCustomerCheckout);
    customerSafe(await service.checkout(draft.id));
    const quote = await service.quote({ draftId: draft.id, expectedRevision: draft.revision, packingPresetId: 'measured-one', shippingServiceCode: 'FEDEX_GROUND' });
    assert.equal(quote.totalCents, 5650); assert.equal(quote.cards[0].unitCents, 4000); customerSafe(quote);
    // The customer DTO deliberately omits private evidence. Independently inspect
    // the actual stored snapshot before forging otherwise valid internal quotes.
    const storedQuote = (await fixture.sql('SELECT snapshot FROM atlas_customer."CommerceQuote" WHERE id=$1::uuid', [quote.id], db.name)).rows[0].snapshot;
    assert.equal(storedQuote.cards[0].commissionCents, 0); assert.equal(storedQuote.cards[0].photoPairHash, internalSource.cards[0].photoPairHash);
    assert.deepEqual(storedQuote.cards[0].identity, identity); assert.deepEqual(storedQuote.profile, profile);
    assert.deepEqual(storedQuote.merchant, merchant); assert.equal(storedQuote.shipping[0].providerId, 'rate_synthetic');
    assert.equal(storedQuote.tax.providerId, 'tax_synthetic'); assert.equal(storedQuote.totalCents, 5650);
    assert.deepEqual(storedQuote.shippingPlan, shippingPlans[0]);
    const unsigned = structuredClone(storedQuote); delete unsigned.contentHash; assert.equal(storedQuote.contentHash, digest(unsigned));
    const forged = structuredClone(storedQuote); forged.id = randomUUID(); forged.totalCents--; delete forged.contentHash; forged.contentHash = digest(forged);
    await assert.rejects(repository.saveQuote(draft.revision, forged), { code: 'QUOTE_INVALID' });
    const changedPhoto = structuredClone(storedQuote); changedPhoto.id = randomUUID(); changedPhoto.cards[0].photoPairHash = '0'.repeat(64);
    delete changedPhoto.contentHash; changedPhoto.contentHash = digest(changedPhoto);
    await assert.rejects(repository.saveQuote(draft.revision, changedPhoto), { code: 'CHECKOUT_CHANGED' });
    for (const change of [q=>q.shippingPlan.cardCount=2,q=>q.shippingPlan.measurementReference='forged measurement',
        q=>q.shipping[0].request.requestedShipment.requestedPackageLineItems[0].weight.value=0.1,
        q=>q.shipping[0].request.requestedShipment.shipDatestamp='2026-01-01']) {
        const altered=structuredClone(storedQuote); altered.id=randomUUID(); change(altered);
        altered.shipping[0].requestHash=digest(altered.shipping[0].request); delete altered.contentHash; altered.contentHash=digest(altered);
        await assert.rejects(repository.saveQuote(draft.revision,altered),{code:'SHIPPING_PLAN_INVALID'});
    }
    const originalPlan=structuredClone(shippingPlans[0]);
    for (const change of [p=>p.cardCount=2,p=>p.validUntil=new Date(Date.now()-60000).toISOString(),
        p=>p.legs.INBOUND.requestedShipment.shipDatestamp='2026-01-01',p=>p.legs.INBOUND.requestedShipment.requestedPackageLineItems[0].weight.value=0]) {
        const invalid=structuredClone(originalPlan);change(invalid);
        await admin.$executeRaw`UPDATE atlas_customer."CommerceControl" SET "shippingPlans"=${JSON.stringify([invalid])}::jsonb WHERE id='active'`;
        assert.deepEqual((await repository.loadCheckout(draft.id)).shippingPlans,[]);
        assert.deepEqual((await call('commerce_checkout',{draftId:draft.id})).shippingOptions,[]);
        await assert.rejects(repository.saveQuote(draft.revision,storedQuote),{code:'SHIPPING_PLAN_INVALID'});
    }
    await admin.$executeRaw`UPDATE atlas_customer."CommerceControl" SET "shippingPlans"=${JSON.stringify(shippingPlans)}::jsonb WHERE id='active'`;
    checks.push('measured shipping plan binds exact card count, original weight/ship date and sourced measurement; SQL filters invalid/expired plans and refuses forged requests');
    checks.push('server price, photo/identity snapshot, tax and shipping total bound; foreign cart and forged total refused');
    checks.push('customer SQL checkout and service quote use safe DTOs; original provider, photo, account and profile evidence remains stored internally');
    const requestId = randomUUID();
    const pending = await service.pay({ quoteId: quote.id, requestId }); assert.equal(pending.state, 'UNKNOWN'); assert.equal(creates, 1);
    customerSafe(pending); customerSafe(await call('commerce_checkout', { draftId: draft.id }));
    assert.equal((await service.pay({ quoteId: quote.id, requestId })).attemptId, pending.attemptId);
    assert.equal((await service.pay({ quoteId: quote.id, requestId: randomUUID() })).attemptId, pending.attemptId); assert.equal(creates, 1);
    await assert.rejects(otherRepository.payment(pending.attemptId), { code: 'NOT_FOUND' });
    await assert.rejects(call('intake_correct', { id: draft.id, cardId: card.cardId, expectedRevision: draft.cards[0].revision, identity }), { code: 'INTAKE_ALREADY_ORDERED' });
    checks.push('unknown payment retains exact attempt; both same and changed browser request cannot charge again or edit locked cart');
    known = true;
    const paid = await service.reconcile(pending.attemptId); assert.equal(paid.state, 'PAID');
    customerSafe(paid);
    const retrievedAtPaid = retrieves;
    assert.equal((await service.reconcile(pending.attemptId)).order.id, paid.order.id); assert.equal(retrieves, retrievedAtPaid);
    assert.equal((await service.pay({ quoteId: quote.id, requestId })).order.id, paid.order.id); assert.equal(creates, 1);
    await assert.rejects(call('commerce_order', { orderId: paid.order.id }, b), { code: 'NOT_FOUND' });
    const census = await fixture.sql(`SELECT (SELECT count(*) FROM atlas_customer."CommercePayment") payments,
        (SELECT count(*) FROM atlas_customer."CommerceOrder") orders,(SELECT count(*) FROM atlas_customer."CommerceEffect") effects,
        (SELECT count(*) FROM atlas_dealer.order_card) cards,(SELECT count(*) FROM atlas_dealer.commission_event) commissions`, [], db.name);
    assert.deepEqual(census.rows[0], { payments: '1', orders: '1', effects: '4', cards: '1', commissions: '0' });
    const customerOrder = await call('commerce_order', { orderId: paid.order.id }); customerSafe(customerOrder);
    assert.equal(customerOrder.receipt.totalCents, 5650); assert.equal(customerOrder.receipt.cards[0].identity.title, identity.title);
    assert.deepEqual(customerOrder.effects.map(e => e.kind).sort(), ['EMAIL_RECEIPT','FEDEX_LABEL','SMS_RECEIPT']);
    const savedReceipt = (await fixture.sql('SELECT receipt FROM atlas_customer."CommerceOrder" WHERE id=$1::uuid', [paid.order.id], db.name)).rows[0].receipt;
    assert.deepEqual(savedReceipt.cards, storedQuote.cards); assert.deepEqual(savedReceipt.profile, profile);
    assert.equal(savedReceipt.payment.amountCents, 5650); assert.equal(savedReceipt.shipping[0].providerId, 'rate_synthetic');
    assert.deepEqual((await fixture.sql('SELECT snapshot FROM atlas_customer."CommerceQuote" WHERE id=$1::uuid', [quote.id], db.name)).rows[0].snapshot, storedQuote);
    checks.push('one immutable paid order, four durable receipt/tax/postage effects, one custody card and no mail-in commission');
    checks.push('customer paid order exposes safe totals/identity/delivery effects; immutable stored receipt retains money/photo/provider proof');
    await admin.$executeRaw`UPDATE atlas_customer."CommerceControl" SET enabled=false WHERE id='active'`;
    const historicalService = new CommerceService({ repository: new GatewayCommerceRepository((name, input) => privateDatabase.call('customer', { name, input, authority: a.authority })) });
    const historical = await historicalService.checkout(draft.id);
    assert.equal(historical.activePayment.state, 'PAID'); assert.equal(historical.activePayment.order.id, paid.order.id); assert.deepEqual(historical.blockers, []);
    customerSafe(historical); customerSafe(await call('commerce_checkout', { draftId: draft.id }));
    assert.equal(creates, 1); assert.equal(retrieves, retrievedAtPaid);
    checks.push('saved paid checkout remains readable with commerce providers disabled and no provider call');
    await admin.$executeRaw`UPDATE atlas_customer."CustomerServiceControl" SET enabled=false WHERE id='active'`;
    await assert.rejects(privateDatabase.call('directory', { input: {} }), { code: 'CUSTOMER_SERVICE_NOT_ENABLED' });
    const result = { pass: true, syntheticOnly: true, networkProviders: false, checks, publicMigrations: fixture.source.publicMigrations.length,
        staffMigrations: fixture.source.staffMigrations.length, evidenceDirectory: fixture.directory };
    writeFileSync(join(fixture.directory, 'private-commerce-result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
    writeFileSync(join(fixture.directory, 'private-commerce-result.json'), JSON.stringify({ pass: false, syntheticOnly: true, checks,
        error: fixture.safe(error.message), evidenceDirectory: fixture.directory }, null, 2));
    throw error;
} finally {
    await privateClient?.$disconnect(); await customerClient?.$disconnect(); await admin?.$disconnect(); await fixture.stop();
}
