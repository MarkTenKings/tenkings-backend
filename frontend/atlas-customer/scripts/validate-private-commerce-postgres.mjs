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
import { createEmailVerificationService } from '../../../packages/atlas-customer-intake/src/email-verification.mjs';
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
    assert.equal(new URL(db.adminUrl).hostname, '127.0.0.1');
    assert.match(db.name, /^atlas_fixture_case_[1-9][0-9]*$/);
    const ownership = JSON.parse(readFileSync(join(fixture.directory, 'ownership.json'), 'utf8'));
    assert.equal(ownership.createdByHarness, true); assert.equal(ownership.uid, process.getuid());
    assert.match(ownership.nonce, /^[a-f0-9]{32}$/);
    for (const name of ['20261001006000_atlas_shared_weekly_card_capacity', '20261001008000_atlas_email_first_notifications', '20261001009000_atlas_customer_email_verification'])
        assert(fixture.source.staffMigrations.some(row => row.name === name), `Registered schema required: ${name}`);
    for (const [name, proposal] of [
        ['20261001001000_atlas_weekly_card_capacity', '../../../packages/atlas-commerce/sql/weekly-capacity-proposal.sql'],
        ['20261001002000_atlas_customer_phone_payments', '../../../packages/atlas-commerce/sql/customer-phone-proposal.sql'],
        ['20261001003000_atlas_dealer_phone_handoff', '../../../packages/atlas-dealer-operations/sql/handoff-proposal.sql'],
        ['20261001005000_atlas_shop_contact_profile', '../../../packages/atlas-customer-intake/sql/shop-profile-proposal.sql']]) {
        if (fixture.source.staffMigrations.some(row => row.name === name)) {
            assert(readFileSync(new URL(`../../atlas-app/prisma/migrations/${name}/migration.sql`, import.meta.url)).equals(readFileSync(new URL(proposal, import.meta.url))), `Registered migration differs from qualified proposal: ${name}`);
        } else await fixture.sql(readFileSync(new URL(proposal, import.meta.url), 'utf8'), [], db.name);
    }
    await fixture.sql(`INSERT INTO atlas_customer."WeeklyCapacitySharedWeek"("weekStartsAt","resetsAt","quotaCards")
        SELECT "weekStartsAt","resetsAt",100 FROM atlas_customer.weekly_capacity_week(clock_timestamp())`, [], db.name);
    checks.push('exact registered capacity, customer-phone, nullable shop hardware and compact contact proposals applied to disposable database with one fixture-only shared week quota');
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
    const repositoryFor = who => new GatewayCommerceRepository((name, input) => name === 'commerce_weekly_capacity' ? privateDatabase.call('capacity', { input: {} }) : privateDatabase.call('commerce', { name, providerBinding, input: { ...input, authority: who.authority } }));
    const repository = repositoryFor(a), otherRepository = repositoryFor(b);
    let creates = 0, retrieves = 0, taxCalculations = 0, carrierQuotes = 0, known = false;
    const expires = () => new Date(Date.now() + 10 * 60_000).toISOString();
    const payment = { binding: merchant, publishableKey: 'pk_test_synthetic', async create() { creates++; throw Error('Synthetic lost response'); },
        async retrieve(attempt) { retrieves++; if (!known) throw Error('Synthetic unresolved provider state');
            return { source: 'PROVIDER_RETRIEVAL', provider: 'STRIPE', merchantId: merchant.accountId, livemode: false,
                providerId: `pi_synthetic_${attempt.id}`, status: 'succeeded', amountCents: attempt.quote.totalCents,
                receivedCents: attempt.quote.totalCents, currency: 'usd', quoteHash: attempt.quote.contentHash, attemptId: attempt.id, paymentMethodTypes: ['card'] }; } };
    const tax = { async calculate(input) { taxCalculations++; return { provider: 'SYNTHETIC', providerId: 'tax_synthetic', currency: 'usd', taxCents: 400,
        totalCents: input.subtotalCents + input.shippingCents + 400, requestHash: digest(input), expiresAt: expires() }; } };
    const carrier = { async quote(input) { carrierQuotes++; return { provider: 'FEDEX', providerId: 'rate_synthetic', currency: 'usd', amountCents: 1250, requestHash: digest(input), expiresAt: expires() }; } };
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
    const quoteInput = { draftId: draft.id, expectedRevision: draft.revision, packingPresetId: 'measured-one', shippingServiceCode: 'FEDEX_GROUND' };
    assert.equal(internalSource.emailVerified, false);
    await assert.rejects(service.quote(quoteInput), { code: 'EMAIL_VERIFICATION_REQUIRED' });
    assert.equal(taxCalculations, 0); assert.equal(carrierQuotes, 0); assert.equal(creates, 0);
    let emailSends = 0, verificationUrl;
    const emailVerification = createEmailVerificationService({ enabled: true,
        call: (name, input) => privateDatabase.call('email', { name, input }),
        sender: { async sendVerification(input) {
            emailSends++; verificationUrl = input.verificationUrl;
            return { provider: 'SENDGRID', providerId: 'synthetic-private-commerce-email', deliveryStatus: 'ACCEPTED' };
        } } });
    const emailRequest = { draftId: draft.id, requestId: randomUUID() };
    assert.equal((await emailVerification.request(a.authority, emailRequest)).state, 'SENT');
    assert.equal((await emailVerification.request(a.authority, emailRequest)).verified, false); assert.equal(emailSends, 1);
    await assert.rejects(service.quote(quoteInput), { code: 'EMAIL_VERIFICATION_REQUIRED' });
    assert.equal(taxCalculations, 0); assert.equal(carrierQuotes, 0);
    assert.equal((await auth.confirmEmail(a.cookie, a.csrf, { token: new URL(verificationUrl).hash.slice('#token='.length), mode: 'AUTO' }, 'private-commerce-fixture')).verified, true);
    assert.equal((await repository.loadCheckout(draft.id)).emailVerified, true);
    const quote = await service.quote(quoteInput);
    checks.push('unverified and SENT-only email refuse new quotes before tax/carrier/payment; one durable synthetic email request confirms only the original phone account/address');
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
    assert.deepEqual(census.rows[0], { payments: '1', orders: '1', effects: '3', cards: '1', commissions: '0' });
    const customerOrder = await call('commerce_order', { orderId: paid.order.id }); customerSafe(customerOrder);
    assert.equal(customerOrder.receipt.totalCents, 5650); assert.equal(customerOrder.receipt.cards[0].identity.title, identity.title);
    assert.deepEqual(customerOrder.effects.map(e => e.kind).sort(), ['EMAIL_RECEIPT','FEDEX_LABEL']);
    const savedReceipt = (await fixture.sql('SELECT receipt FROM atlas_customer."CommerceOrder" WHERE id=$1::uuid', [paid.order.id], db.name)).rows[0].receipt;
    assert.deepEqual(savedReceipt.cards, storedQuote.cards); assert.deepEqual(savedReceipt.profile, profile);
    assert.equal(savedReceipt.payment.amountCents, 5650); assert.equal(savedReceipt.shipping[0].providerId, 'rate_synthetic');
    assert.deepEqual((await fixture.sql('SELECT snapshot FROM atlas_customer."CommerceQuote" WHERE id=$1::uuid', [quote.id], db.name)).rows[0].snapshot, storedQuote);
    checks.push('one immutable paid order, three durable email/tax/postage effects and no SMS effect, one custody card and no mail-in commission');
    checks.push('customer paid order exposes safe totals/identity/delivery effects; immutable stored receipt retains money/photo/provider proof');
    // Additive shop-phone qualification: no reader or package printer is
    // invented. The registry and every card/photo/session binding are real SQL
    // fixtures; all provider observations are synthetic and make no network call.
    const fixtureStaff = await admin.staffIdentity.create({ data: { phoneHash: 'f'.repeat(64), name: 'Synthetic capacity operator' } });
    const shopId = randomUUID(), shopDealer = randomUUID();
    const shopSchedule = { timeZone: 'America/Los_Angeles', pickups: [{ weekday: 3, time: '10:00', cutoff: '09:00' }], returns: [{ weekday: 3, time: '10:00' }], exceptions: [] };
    await fixture.sql(`INSERT INTO atlas_dealer.location(id,dealer_id,enabled,name,address,latitude,longitude,schedule,
        terminal_id,terminal_location_id,package_printer_id,entry_token,authorized_until,configured_by)
        VALUES($1::uuid,$2::uuid,true,'Synthetic phone checkout shop',$3::jsonb,34.05,-118.25,$4::jsonb,
        NULL,NULL,NULL,$5,clock_timestamp()+interval '30 days',$6::uuid)`, [shopId, shopDealer,
        JSON.stringify({ line1: '1 Fixture Street', city: 'Example', region: 'CA', postalCode: '90001', country: 'US' }),
        JSON.stringify(shopSchedule), randomBytes(32).toString('base64url'), fixtureStaff.id], db.name);
    async function reviewedShopCard(contact = profile, intakeMethod = 'DEALER_DROP_OFF') {
        let { draft: shopDraft } = await call('intake_create', { requestId: randomUUID(), intakeMethod, kioskId: intakeMethod === 'MAIL_IN' ? null : shopId });
        const shopCard = { requestId: randomUUID(), cardId: randomUUID(), pairId: randomUUID(),
            front: { uploadId: randomUUID(), sha256: '3'.repeat(64), byteCount: 10, fileName: 'synthetic-phone-front.jpg' },
            back: { uploadId: randomUUID(), sha256: '4'.repeat(64), byteCount: 11, fileName: 'synthetic-phone-back.jpg' } };
        shopDraft = (await call('intake_card', { id: shopDraft.id, card: shopCard })).draft;
        for (const side of ['front','back']) {
            const input = { id: shopDraft.id, cardId: shopCard.cardId, uploadId: shopCard[side].uploadId }, { upload } = await call('intake_upload', input);
            shopDraft = (await privateDatabase.call('intake', { name: 'verify', input: { ...input, authority: a.authority,
                verification: { object: upload.plan.object, ...upload.plan.expected, contentType: 'application/octet-stream' } } })).draft;
        }
        shopDraft = (await call('intake_correct', { id: shopDraft.id, cardId: shopCard.cardId, expectedRevision: shopDraft.cards[0].revision, identity })).draft;
        shopDraft = (await call('intake_review', { id: shopDraft.id, expectedRevision: shopDraft.revision, profile: contact })).draft;
        return shopDraft;
    }
    let phoneCreates = 0, phoneStatus = 'requires_payment_method', phoneMethod = 'card';
    const phoneProvider = { binding: merchant, publishableKey: 'pk_test_synthetic',
        async create(attempt) { phoneCreates++; return { state: 'AWAITING_PAYMENT', providerId: `pi_synthetic_${attempt.id}`, clientSecret: 'pi_own_phone_secret' }; },
        async retrieve(attempt) { return { source: 'PROVIDER_RETRIEVAL', provider: 'STRIPE', merchantId: merchant.accountId, livemode: false,
            providerId: `pi_synthetic_${attempt.id}`, status: phoneStatus, amountCents: attempt.quote.totalCents,
            receivedCents: phoneStatus === 'succeeded' ? attempt.quote.totalCents : 0, currency: 'usd', quoteHash: attempt.quote.contentHash,
            attemptId: attempt.id, paymentMethodTypes: [phoneMethod], clientSecret: 'pi_own_phone_secret' }; } };
    const phoneService = new CommerceService({ repository, payment: phoneProvider, tax });
    const compactContact = { name: 'Synthetic shop customer', email: profile.email };
    const savedContact = await call('profile', { profile: compactContact });
    assert.equal(savedContact.customer.profile.name, compactContact.name);assert.equal(savedContact.customer.profile.email, profile.email);
    assert.equal(savedContact.customer.profile.address1, profile.address1);assert.equal(savedContact.customer.profile.postalCode, profile.postalCode);
    await assert.rejects(reviewedShopCard(compactContact, 'MAIL_IN'), { code: 'RETURN_DETAILS_REQUIRED' });
    await assert.rejects(reviewedShopCard({ name: compactContact.name }), { code: 'CONTACT_DETAILS_REQUIRED' });
    await assert.rejects(reviewedShopCard({ name: compactContact.name, email: '' }), { code: 'CONTACT_DETAILS_REQUIRED' });
    await assert.rejects(reviewedShopCard({ name: '' }), { code: 'CONTACT_DETAILS_REQUIRED' });
    await assert.rejects(reviewedShopCard({ name: compactContact.name, email: 'invalid' }), { code: 'CONTACT_DETAILS_REQUIRED' });
    const phoneDraft = await reviewedShopCard(compactContact), phoneQuote = await phoneService.quote({ draftId: phoneDraft.id, expectedRevision: phoneDraft.revision });
    assert.equal(phoneQuote.terms.paymentFlow, 'CUSTOMER_PHONE'); assert.equal(phoneQuote.totalCents, 5400);
    const privatePhoneQuote = (await fixture.sql('SELECT snapshot FROM atlas_customer."CommerceQuote" WHERE id=$1::uuid', [phoneQuote.id], db.name)).rows[0].snapshot;
    assert.deepEqual(privatePhoneQuote.profile, compactContact);assert.equal(privatePhoneQuote.phone, '+12025550201');
    assert.equal(privatePhoneQuote.location.terminalId, null); assert.equal(privatePhoneQuote.location.terminalLocationId, null); assert.equal(privatePhoneQuote.location.packagePrinterId, null);
    const phoneRequest = { quoteId: phoneQuote.id, requestId: randomUUID() }, awaiting = await phoneService.pay(phoneRequest);
    assert.equal(awaiting.state, 'AWAITING_PAYMENT'); assert.equal(awaiting.channel, 'KIOSK'); assert.equal(awaiting.paymentFlow, 'CUSTOMER_PHONE');
    assert.equal(awaiting.clientSecret, 'pi_own_phone_secret'); assert.equal(awaiting.publishableKey, 'pk_test_synthetic');
    const phoneRow = (await fixture.sql('SELECT "readerId",state FROM atlas_customer."CommercePayment" WHERE id=$1::uuid', [awaiting.attemptId], db.name)).rows[0];
    assert.equal(phoneRow.readerId, null); assert.equal(phoneRow.state, 'AWAITING_PAYMENT');
    assert.equal((await phoneService.pay({ ...phoneRequest, requestId: randomUUID() })).attemptId, awaiting.attemptId); assert.equal(phoneCreates, 1);
    assert.equal((await phoneService.checkout(phoneDraft.id)).activePayment.clientSecret, 'pi_own_phone_secret');
    const safeRecovery = await call('commerce_checkout', { draftId: phoneDraft.id }); customerSafe(safeRecovery);
    assert.equal(safeRecovery.activePayment.paymentFlow, 'CUSTOMER_PHONE'); assert.equal(safeRecovery.activePayment.clientSecret, undefined);
    await assert.rejects(otherRepository.payment(awaiting.attemptId), { code: 'NOT_FOUND' });
    phoneStatus = 'succeeded'; phoneMethod = 'card_present';
    await assert.rejects(phoneService.reconcile(awaiting.attemptId), { code: 'PAYMENT_METHOD_MISMATCH' });
    await assert.rejects(repository.confirmPaid({ attemptId: awaiting.attemptId, receiptId: randomUUID(),
        evidence: await phoneProvider.retrieve(await repository.payment(awaiting.attemptId)) }), { code: 'PAYMENT_BINDING_MISMATCH' });
    assert.equal((await fixture.sql('SELECT state FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=$1::uuid', [awaiting.attemptId], db.name)).rows[0].state, 'HELD');
    phoneMethod = 'card'; const phonePaid = await phoneService.reconcile(awaiting.attemptId); assert.equal(phonePaid.state, 'PAID');
    assert.equal((await phoneService.pay(phoneRequest)).order.id, phonePaid.order.id); assert.equal(phoneCreates, 1);
    assert.equal((await fixture.sql('SELECT state FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=$1::uuid', [awaiting.attemptId], db.name)).rows[0].state, 'CONSUMED');
    const phoneEffects = (await fixture.sql('SELECT kind FROM atlas_customer."CommerceEffect" WHERE "orderId"=$1::uuid ORDER BY kind', [phonePaid.order.id], db.name)).rows.map(row => row.kind);
    assert.deepEqual(phoneEffects, ['EMAIL_RECEIPT','TAX_TRANSACTION']);
    const emailReceipt=(await fixture.sql('SELECT request FROM atlas_customer."CommerceEffect" WHERE "orderId"=$1::uuid AND kind=\'EMAIL_RECEIPT\'', [phonePaid.order.id], db.name)).rows[0].request;assert.equal(emailReceipt.to,compactContact.email);
    assert.equal(emailSends, 1); // The same verified account/address needs no second verification.
    assert.equal((await fixture.sql('SELECT count(*) AS n FROM atlas_dealer.custody_event WHERE card_id=$1::uuid', [phoneDraft.cards[0].id], db.name)).rows[0].n, '0');
    checks.push('new shop review requires name+email but no return address; compact contact retains saved return data and cannot bypass mail validation; the previously verified account/address produces email-only receipt effects; hardware-free shop quote pays on its own customer phone; exact safe recovery/owner-only form secret, no reader reservation or printer effect, duplicate pay is idempotent, card_present refused, payment consumes capacity once and never records custody');

    // Literal pre-email-required CUSTOMER_PHONE history. Only this nonce-owned
    // loopback fixture owner may seed it, with the two new INSERT guards
    // suspended in one transaction. All other guards remain enabled; both
    // verification guards are restored and asserted before any gateway test.
    const nameOnlyDraft = await reviewedShopCard(compactContact);
    const nameOnlyCurrent = await phoneService.quote({ draftId: nameOnlyDraft.id, expectedRevision: nameOnlyDraft.revision });
    const nameOnlyQuote = structuredClone((await fixture.sql('SELECT snapshot FROM atlas_customer."CommerceQuote" WHERE id=$1::uuid', [nameOnlyCurrent.id], db.name)).rows[0].snapshot);
    nameOnlyQuote.id = randomUUID(); nameOnlyQuote.profile = { name: 'Historical name-only customer' }; delete nameOnlyQuote.contentHash;
    nameOnlyQuote.tax.requestHash = digest({ quoteId: nameOnlyQuote.id, currency: 'usd', profile: nameOnlyQuote.profile,
        channel: nameOnlyQuote.channel, location: nameOnlyQuote.location, lines: nameOnlyQuote.cards,
        subtotalCents: nameOnlyQuote.subtotalCents, shippingCents: nameOnlyQuote.shippingCents });
    nameOnlyQuote.contentHash = digest(nameOnlyQuote);
    const nameOnlyAttempt = randomUUID(), nameOnlyRequest = randomUUID(), nameOnlyProviderId = `pi_historical_name_only_${nameOnlyAttempt}`;
    const enabledEmailGuards = tx => tx.$queryRaw`SELECT c.relname AS name,t.tgenabled::text AS enabled FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='atlas_customer' AND c.relname IN ('CommercePayment','CommerceQuote') AND t.tgname='verified_email' ORDER BY c.relname`;
    const expectedEmailGuards = [{ name: 'CommercePayment', enabled: 'O' }, { name: 'CommerceQuote', enabled: 'O' }];
    assert.deepEqual(JSON.parse(readFileSync(join(fixture.directory, 'ownership.json'), 'utf8')), ownership);
    await admin.$transaction(async tx => {
        const [target] = await tx.$queryRaw`SELECT current_database() AS database,current_user AS owner`;
        assert.deepEqual(target, { database: db.name, owner: new URL(db.adminUrl).username });
        assert.equal(target.owner, 'atlas_fixture_owner');
        assert.deepEqual(await enabledEmailGuards(tx), expectedEmailGuards);
        await tx.$executeRaw`ALTER TABLE atlas_customer."CommerceQuote" DISABLE TRIGGER verified_email`;
        await tx.$executeRaw`ALTER TABLE atlas_customer."CommercePayment" DISABLE TRIGGER verified_email`;
        await tx.$executeRaw`UPDATE atlas_customer."CustomerIntakeDraft" SET "profileSnapshot"=${JSON.stringify(nameOnlyQuote.profile)}::jsonb WHERE id=${nameOnlyDraft.id}::uuid`;
        await tx.$executeRaw`INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt")
            VALUES(${nameOnlyQuote.id}::uuid,${a.customer.id}::uuid,${nameOnlyDraft.id}::uuid,${nameOnlyDraft.revision},${nameOnlyQuote.contentHash},${JSON.stringify(nameOnlyQuote)}::jsonb,${nameOnlyQuote.expiresAt}::timestamptz)`;
        await tx.$executeRaw`INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,"providerId",state,observation)
            VALUES(${nameOnlyAttempt}::uuid,${a.customer.id}::uuid,${nameOnlyDraft.id}::uuid,${nameOnlyQuote.id}::uuid,${nameOnlyRequest}::uuid,
                ${JSON.stringify(merchant)}::jsonb,${nameOnlyProviderId},'UNKNOWN',${JSON.stringify({ state: 'UNKNOWN', providerId: nameOnlyProviderId })}::jsonb)`;
        await tx.$executeRaw`ALTER TABLE atlas_customer."CommerceQuote" ENABLE TRIGGER verified_email`;
        await tx.$executeRaw`ALTER TABLE atlas_customer."CommercePayment" ENABLE TRIGGER verified_email`;
        assert.deepEqual(await enabledEmailGuards(tx), expectedEmailGuards);
        const [proof] = await tx.$queryRaw`SELECT atlas_customer.email_verified(${a.customer.id}::uuid,${nameOnlyQuote.profile.email ?? null}::text) AS verified`;
        assert.equal(proof.verified, false);
    }, { isolationLevel: 'ReadCommitted', timeout: 15000 });
    assert.deepEqual(await enabledEmailGuards(admin), expectedEmailGuards);
    // Prove the restored guards reject another fresh row, without relying on
    // the service's earlier syntactic email check or the existing-attempt path.
    await assert.rejects(admin.$executeRaw`INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt")
        VALUES(${randomUUID()}::uuid,${a.customer.id}::uuid,${nameOnlyDraft.id}::uuid,${nameOnlyDraft.revision},${nameOnlyQuote.contentHash},${JSON.stringify(nameOnlyQuote)}::jsonb,${nameOnlyQuote.expiresAt}::timestamptz)`, /verified receipt email required/);
    await assert.rejects(admin.$executeRaw`INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,state)
        VALUES(${randomUUID()}::uuid,${a.customer.id}::uuid,${nameOnlyDraft.id}::uuid,${nameOnlyQuote.id}::uuid,${randomUUID()}::uuid,${JSON.stringify(merchant)}::jsonb,'DISPATCHED')`, /verified receipt email required/);
    assert.equal((await repository.loadCheckout(nameOnlyDraft.id)).emailVerified, false);
    const priorTax = taxCalculations;
    await assert.rejects(phoneService.quote({ draftId: nameOnlyDraft.id, expectedRevision: nameOnlyDraft.revision }), { code: 'PROFILE_EMAIL_REQUIRED' });
    assert.equal(taxCalculations, priorTax);
    assert.equal((await call('email_status', { draftId: nameOnlyDraft.id })).required, false);
    let nameOnlyCreates = 0, nameOnlyKnown = false;
    const nameOnlyProvider = { binding: merchant, publishableKey: 'pk_test_synthetic',
        async create() { nameOnlyCreates++; throw Error('must not create a historical name-only intent'); },
        async retrieve(attempt) {
            if (!nameOnlyKnown) throw Error('Synthetic unresolved historical name-only intent');
            return { source: 'PROVIDER_RETRIEVAL', provider: 'STRIPE', merchantId: merchant.accountId, livemode: false,
                providerId: nameOnlyProviderId, status: 'succeeded', amountCents: nameOnlyQuote.totalCents, receivedCents: nameOnlyQuote.totalCents,
                currency: 'usd', quoteHash: nameOnlyQuote.contentHash, attemptId: attempt.id, paymentMethodTypes: ['card'] };
        } };
    const nameOnlyService = new CommerceService({ repository, payment: nameOnlyProvider, tax });
    const nameOnlyPay = { quoteId: nameOnlyQuote.id, requestId: nameOnlyRequest };
    const nameOnlyRetry = await nameOnlyService.pay(nameOnlyPay);
    assert.equal(nameOnlyRetry.attemptId, nameOnlyAttempt); assert.equal(nameOnlyRetry.state, 'UNKNOWN');
    assert.equal((await nameOnlyService.pay({ ...nameOnlyPay, requestId: randomUUID() })).attemptId, nameOnlyAttempt);
    assert.equal((await nameOnlyService.checkout(nameOnlyDraft.id)).activePayment.attemptId, nameOnlyAttempt);
    await assert.rejects(otherRepository.payment(nameOnlyAttempt), { code: 'NOT_FOUND' });
    nameOnlyKnown = true;
    const nameOnlyPaid = await nameOnlyService.reconcile(nameOnlyAttempt); assert.equal(nameOnlyPaid.state, 'PAID');
    assert.equal((await nameOnlyService.pay(nameOnlyPay)).order.id, nameOnlyPaid.order.id); assert.equal(nameOnlyCreates, 0);
    assert.deepEqual(nameOnlyPaid.order.receipt.profile, undefined); // Safe DTO never exposes receipt contact.
    const nameOnlyStored = (await fixture.sql('SELECT receipt FROM atlas_customer."CommerceOrder" WHERE id=$1::uuid', [nameOnlyPaid.order.id], db.name)).rows[0].receipt;
    assert.deepEqual(nameOnlyStored.profile, nameOnlyQuote.profile);
    assert.deepEqual((await fixture.sql('SELECT snapshot FROM atlas_customer."CommerceQuote" WHERE id=$1::uuid', [nameOnlyQuote.id], db.name)).rows[0].snapshot, nameOnlyQuote);
    assert.deepEqual((await fixture.sql('SELECT kind FROM atlas_customer."CommerceEffect" WHERE "orderId"=$1::uuid ORDER BY kind', [nameOnlyPaid.order.id], db.name)).rows.map(row => row.kind), ['TAX_TRANSACTION']);
    assert.equal((await fixture.sql('SELECT state FROM atlas_customer."WeeklyCapacityReservation" WHERE "paymentId"=$1::uuid', [nameOnlyAttempt], db.name)).rows[0].state, 'CONSUMED');
    assert.equal((await repository.loadCheckout(nameOnlyDraft.id)).emailVerified, false); assert.equal(emailSends, 1);
    checks.push('literal historical name-only CUSTOMER_PHONE UNKNOWN payment recovers without new email proof or charge, settles once with original snapshot/provider, creates no invented email/SMS receipt, and leaves both fresh-insert email guards enabled');

    // Seed historical immutable terms deliberately through the disposable
    // owner fixture, never by weakening the new quote gateway. A fresh legacy
    // quote cannot begin a new terminal payment; an existing UNKNOWN one must
    // retain its original reader/provider/method until a qualified retrieval.
    async function legacyQuote(shopDraft, withReader = false) {
        const current = await phoneService.quote({ draftId: shopDraft.id, expectedRevision: shopDraft.revision });
        const historical = structuredClone((await fixture.sql('SELECT snapshot FROM atlas_customer."CommerceQuote" WHERE id=$1::uuid', [current.id], db.name)).rows[0].snapshot);
        historical.id = randomUUID(); delete historical.terms.paymentFlow; delete historical.contentHash;
        if (withReader) Object.assign(historical.location, { terminalId: 'tmr_original_historical', terminalLocationId: 'tml_original_historical', packagePrinterId: 'printer_original_historical' });
        historical.contentHash = digest(historical);
        await fixture.sql(`INSERT INTO atlas_customer."CommerceQuote"(id,"accountId","draftId","draftRevision","contentHash",snapshot,"expiresAt")
            VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb,$7::timestamptz)`, [historical.id,a.customer.id,shopDraft.id,shopDraft.revision,historical.contentHash,JSON.stringify(historical),historical.expiresAt], db.name);
        return historical;
    }
    const staleDraft = await reviewedShopCard(), staleQuote = await legacyQuote(staleDraft);
    await assert.rejects(repository.reservePayment({ quoteId: staleQuote.id, requestId: randomUUID(), attemptId: randomUUID(), merchant }), { code: 'PAYMENT_FLOW_CHANGED' });
    assert.equal((await fixture.sql('SELECT count(*) AS n FROM atlas_customer."CommercePayment" WHERE "draftId"=$1::uuid', [staleDraft.id], db.name)).rows[0].n, '0');
    const legacyDraft = await reviewedShopCard(), historicalQuote = await legacyQuote(legacyDraft, true);
    const legacyAttempt = randomUUID(), legacyRequest = randomUUID(), originalProvider = `pi_historical_${legacyAttempt}`;
    await fixture.sql(`INSERT INTO atlas_customer."CommercePayment"(id,"accountId","draftId","quoteId","requestId",merchant,"readerId","providerId",state,observation)
        VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::jsonb,'tmr_original_historical',$7,'UNKNOWN',$8::jsonb)`,
        [legacyAttempt,a.customer.id,legacyDraft.id,historicalQuote.id,legacyRequest,JSON.stringify(merchant),originalProvider,JSON.stringify({ state: 'UNKNOWN', providerId: originalProvider })], db.name);
    let legacyCreates = 0, legacyMethod = 'card';
    const legacyProvider = { binding: merchant, publishableKey: 'pk_test_synthetic', async create() { legacyCreates++; throw Error('must not create historical intent'); },
        async retrieve(attempt) { return { source: 'PROVIDER_RETRIEVAL', provider: 'STRIPE', merchantId: merchant.accountId, livemode: false,
            providerId: originalProvider, status: 'succeeded', amountCents: historicalQuote.totalCents, receivedCents: historicalQuote.totalCents,
            currency: 'usd', quoteHash: historicalQuote.contentHash, attemptId: attempt.id, paymentMethodTypes: [legacyMethod], clientSecret: 'pi_must_not_expose_legacy_secret' }; } };
    const legacyService = new CommerceService({ repository, payment: legacyProvider, tax });
    const legacyRetry = await legacyService.pay({ quoteId: historicalQuote.id, requestId: legacyRequest });
    assert.equal(legacyRetry.attemptId, legacyAttempt); assert.equal(legacyRetry.state, 'UNKNOWN'); assert.equal(legacyRetry.clientSecret, undefined);
    assert.equal((await legacyService.pay({ quoteId: historicalQuote.id, requestId: randomUUID() })).attemptId, legacyAttempt); assert.equal(legacyCreates, 0);
    await assert.rejects(legacyService.reconcile(legacyAttempt), { code: 'PAYMENT_METHOD_MISMATCH' });
    await assert.rejects(repository.confirmPaid({ attemptId: legacyAttempt, receiptId: randomUUID(),
        evidence: await legacyProvider.retrieve(await repository.payment(legacyAttempt)) }), { code: 'PAYMENT_BINDING_MISMATCH' });
    legacyMethod = 'card_present'; const legacyPaid = await legacyService.reconcile(legacyAttempt); assert.equal(legacyPaid.state, 'PAID');
    assert.equal((await legacyService.pay({ quoteId: historicalQuote.id, requestId: legacyRequest })).order.id, legacyPaid.order.id); assert.equal(legacyCreates, 0);
    const historicalRow = (await fixture.sql('SELECT "readerId","providerId",state FROM atlas_customer."CommercePayment" WHERE id=$1::uuid', [legacyAttempt], db.name)).rows[0];
    assert.deepEqual(historicalRow, { readerId: 'tmr_original_historical', providerId: originalProvider, state: 'PAID' });
    assert.deepEqual((await fixture.sql('SELECT snapshot FROM atlas_customer."CommerceQuote" WHERE id=$1::uuid', [historicalQuote.id], db.name)).rows[0].snapshot, historicalQuote);
    assert.equal(legacyPaid.order.receipt.terms.paymentFlow, undefined); assert.equal(legacyPaid.clientSecret, undefined);
    assert.equal((await fixture.sql('SELECT count(*) AS n FROM atlas_customer."CommerceEffect" WHERE "orderId"=$1::uuid AND kind=\'PACKAGE_LABEL\'', [legacyPaid.order.id], db.name)).rows[0].n, '1');
    checks.push('fresh legacy terminal quote refused before payment; existing UNKNOWN terminal replay keeps exact reader/provider/terms with no new charge, rejects card, accepts only original card_present evidence and preserves original package effect');

    assert.equal((await fixture.sql('SELECT count(*) AS n FROM atlas_customer."CommerceEffect" WHERE kind=\'SMS_RECEIPT\'', [], db.name)).rows[0].n, '0');
    assert.deepEqual(await enabledEmailGuards(admin), expectedEmailGuards);
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
