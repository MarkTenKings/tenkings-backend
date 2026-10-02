import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { notificationAdapter, sendGridEmailAdapter } from '../src/notifications.mjs';
import { inspectCommerceConfiguration } from '../src/readiness.mjs';
import { createCommerceProviders, COMMERCE_KEYS } from '../src/config.mjs';
import { CommerceService } from '../src/service.mjs';
import { receiptEffects } from '../src/contract.mjs';
import { createProgressNotificationWorker } from '../src/progress-notifications.mjs';
import { source, memoryRepository, tax, payment, now } from './fixtures.mjs';

const progress = () => ({ cardId: randomUUID(), reference: 'ATLAS-TEST', eventKind: 'ATLAS_RECEIVED', occurredAt: now.toISOString(), to: 'customer@example.test' });
const settings = () => ({ ATLAS_COMMERCE_ENABLED: 'true', ATLAS_COMMERCE_CONFIG_HASH: 'a'.repeat(64), ATLAS_COMMERCE_PROVIDER: 'STRIPE', ATLAS_COMMERCE_MODE: 'TEST',
    ATLAS_COMMERCE_STRIPE_ACCOUNT_ID: 'acct_fixture', ATLAS_COMMERCE_STRIPE_SECRET_KEY: 'rk_test_fixture', ATLAS_COMMERCE_STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture',
    ATLAS_COMMERCE_STRIPE_API_VERSION: '2026-08-26.dahlia', ATLAS_COMMERCE_STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    ATLAS_COMMERCE_TAX_CODE: 'txcd_20030000', ATLAS_COMMERCE_SHIPPING_TAX_CODE: 'txcd_92010001', ATLAS_COMMERCE_TAX_ADDRESS_SOURCE: 'shipping',
    ATLAS_COMMERCE_TAX_SOURCING_POLICY: 'MAIL_RETURN_ADDRESS_KIOSK_LOCATION', ATLAS_COMMERCE_EMAIL_PROVIDER: 'SENDGRID',
    ATLAS_COMMERCE_EMAIL_API_KEY: 'fixture-key', ATLAS_COMMERCE_EMAIL_FROM: 'receipts@example.test', ATLAS_COMMERCE_SMS_PROVIDER: 'DISABLED' });
const accepted = () => new Response(null, { status: 202, headers: { 'x-message-id': 'fixture-sendgrid-id' } });

test('explicit disabled SMS has no messaging credentials requirement; email remains mandatory and configuration check has no network', () => {
    const env = settings(), ready = inspectCommerceConfiguration(env, { channel: 'KIOSK' });
    assert.equal(ready.status, 'READY_FOR_PROVIDER_QUALIFICATION'); assert.deepEqual(ready.missing, []); assert.deepEqual(ready.invalid, []);
    assert.deepEqual(ready.notificationChannels, ['EMAIL']); assert.equal(ready.externalVerification, 'NOT_PERFORMED');
    assert(COMMERCE_KEYS.includes('ATLAS_COMMERCE_SMS_PROVIDER'));
    assert.doesNotMatch(JSON.stringify(ready), /fixture-key|receipts@example|rk_test_fixture/);
    for (const key of ['ATLAS_COMMERCE_EMAIL_API_KEY', 'ATLAS_COMMERCE_EMAIL_FROM', 'ATLAS_COMMERCE_EMAIL_PROVIDER', 'ATLAS_COMMERCE_SMS_PROVIDER']) {
        const missing = { ...env }; delete missing[key];
        assert.equal(inspectCommerceConfiguration(missing, { channel: 'KIOSK' }).status, 'INCOMPLETE');
        assert.throws(() => createCommerceProviders(missing), /RECEIPTS_NOT_CONFIGURED/);
    }
    const sms = { ...env, ATLAS_COMMERCE_SMS_PROVIDER: 'TWILIO' };
    assert.equal(inspectCommerceConfiguration(sms, { channel: 'KIOSK' }).status, 'INCOMPLETE');
    assert.throws(() => createCommerceProviders(sms), /RECEIPTS_NOT_CONFIGURED/);
    assert.throws(() => createCommerceProviders({ ...env, ATLAS_COMMERCE_SMS_PROVIDER: 'false' }), /RECEIPTS_NOT_CONFIGURED/);
});

test('email-first receipts and progress use SendGrid; both SMS kinds fail before fetch even with retained old secrets', async () => {
    const requests = [], env = { ...settings(), ATLAS_COMMERCE_SMS_ACCOUNT_SID: 'old', ATLAS_COMMERCE_SMS_API_KEY_SID: 'old', ATLAS_COMMERCE_SMS_API_KEY_SECRET: 'retained', ATLAS_COMMERCE_SMS_SERVICE_SID: 'old' };
    assert.equal(inspectCommerceConfiguration(env, { channel: 'KIOSK' }).status, 'READY_FOR_PROVIDER_QUALIFICATION');
    const { notifications } = createCommerceProviders(env, { fetchImpl: async (url, options) => { requests.push({ url, options }); return accepted(); } });
    assert.equal(notifications.canSend('SMS_RECEIPT'), false); assert.equal(notifications.canSend('EMAIL_PROGRESS'), true);
    for (const kind of ['SMS_RECEIPT', 'SMS_PROGRESS']) await assert.rejects(notifications.send(kind, { ...progress(), to: '+12025550123' }, randomUUID()), { code: 'SMS_NOTIFICATIONS_DISABLED' });
    assert.equal(requests.length, 0);
    for (const kind of ['EMAIL_RECEIPT', 'EMAIL_PROGRESS']) assert.equal((await notifications.send(kind, { ...progress(), totalCents: 5400 }, randomUUID())).deliveryStatus, 'ACCEPTED');
    assert.equal(requests.length, 2); assert(requests.every(r => r.url === 'https://api.sendgrid.com/v3/mail/send' && r.options.redirect === 'error'));
    assert(requests.every(r => !JSON.parse(r.options.body).content[0].value.includes('STOP')));
});

test('receipt SMS is refused before a durable claim even if a caller explicitly addresses old effect', async () => {
    const effect = { id: 'old:sms', kind: 'SMS_RECEIPT', state: 'PENDING', request: { to: '+12025550123' } };
    const snapshot = structuredClone(effect); let claims = 0, sends = 0, finishes = 0;
    const service = new CommerceService({ repository: { async effect() { return effect; }, async claimEffect() { claims++; }, async finishEffect() { finishes++; } }, notifications: { async send() { sends++; } } });
    await assert.rejects(service.runEffect(effect.id), { code: 'SMS_NOTIFICATIONS_DISABLED' });
    assert.deepEqual(effect, snapshot); assert.equal(claims + sends + finishes, 0);
});

test('missing or false email verification blocks quote before tax or shipping', async () => {
    for (const verified of [undefined, false, 'true']) {
        const checkout = source(), repository = memoryRepository(checkout); if (verified === undefined) delete checkout.emailVerified; else checkout.emailVerified = verified;
        let costs = 0; const service = new CommerceService({ repository, payment: payment(), tax: { async calculate() { costs++; } }, carrier: { async quote() { costs++; } }, clock: () => now });
        await assert.rejects(service.quote({ draftId: checkout.draftId, expectedRevision: checkout.revision }), { code: 'EMAIL_VERIFICATION_REQUIRED' });
        assert.equal(costs, 0); assert.equal(repository.quotes.size, 0);
    }
});

test('historical name-only pending payment resolves without revalidating new checkout email and never fabricates an email or SMS', async () => {
    const checkout = source(), repository = memoryRepository(checkout), provider = payment();
    const service = new CommerceService({ repository, payment: provider, tax, clock: () => now });
    const quoted = await service.quote({ draftId: checkout.draftId, expectedRevision: checkout.revision });
    const saved = repository.quotes.get(quoted.id); delete saved.profile.email;
    const request = { quoteId: quoted.id, requestId: randomUUID() }, pending = await service.pay(request);
    checkout.emailVerified = false; delete checkout.profile.email;
    checkout.activePayment = { id: pending.attemptId, state: 'AWAITING_PAYMENT' };
    const recovered = await service.checkout(checkout.draftId); assert.equal(recovered.activePayment.attemptId, pending.attemptId);
    service.payment = payment('succeeded');
    const paid = await service.reconcile(pending.attemptId), repeated = await service.pay(request);
    assert.equal(paid.order.id, repeated.order.id); assert.equal(provider.creates, 1);
    assert.deepEqual([...repository.effects.values()].map(e => e.kind), ['TAX_TRANSACTION']);
    assert.equal(receiptEffects(randomUUID(), saved).some(e => e.kind === 'SMS_RECEIPT'), false);
});

test('progress worker never passes an unexpected SMS claim to a sender', async () => {
    let sends = 0; const finishes = [];
    const worker = createProgressNotificationWorker({ enabled: true, notifications: { async send() { sends++; } }, call: async (action, input) => {
        if (action === 'pending') return { ids: ['legacy:sms'] };
        if (action === 'claim') return { dispatch: true, effect: { id: input.id, kind: 'SMS_PROGRESS', request: progress() } };
        finishes.push(input); return {};
    } });
    await worker.runOnce(); assert.equal(sends, 0); assert.equal(finishes[0].state, 'UNKNOWN');
});

test('standalone verification sender works with commerce cold and disables link/open tracking', async () => {
    const calls = [], sender = sendGridEmailAdapter({ emailApiKey: 'fixture-key', emailFrom: 'receipts@example.test', fetchImpl: async (url, options) => { calls.push({ url, options }); return accepted(); } });
    const verificationUrl = `https://atlasgrading.com/account/verify-email#token=${'A'.repeat(43)}`;
    assert.equal(createCommerceProviders({}).enabled, false);
    const result = await sender.sendVerification({ to: 'Name+cards@example.test', verificationUrl }, 'verify:fixture');
    assert.deepEqual(result, { provider: 'SENDGRID', providerId: 'fixture-sendgrid-id', deliveryStatus: 'ACCEPTED' });
    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(body.tracking_settings, { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } });
    assert.match(body.content.find(c => c.type === 'text/html').value, />Verify email<\/a>/);
    assert(body.content.every(c => c.value.includes(verificationUrl))); assert.equal(body.personalizations[0].to[0].email, 'Name+cards@example.test');
    assert.doesNotMatch(JSON.stringify(body.personalizations[0].custom_args), /token|Name\+cards/);
});

test('verification links enforce the exact fragment-only route before sending', async () => {
    let calls = 0; const sender = sendGridEmailAdapter({ emailApiKey: 'fixture', emailFrom: 'receipts@example.test', fetchImpl: async () => { calls++; return accepted(); } });
    const token = 'A'.repeat(43), base = `https://atlasgrading.com/account/verify-email#token=${token}`;
    for (const verificationUrl of [undefined, 'not-a-url', base.replace('https:', 'http:'), base.replace('atlasgrading.com', 'other.test'), base.replace('/account/verify-email', '/account'),
        base.replace('#token=', '?token='), base.replace('#token=', '?x=1#token='), base.replace('atlasgrading.com', 'user@atlasgrading.com'), base.replace('atlasgrading.com', 'atlasgrading.com:443'),
        base.replace('atlasgrading.com', 'atlasgrading.com:8443'), base.slice(0, -1), `${base}&redirect=other`, `${base}\n`]) {
        await assert.rejects(sender.sendVerification({ to: 'customer@example.test', verificationUrl }, 'verify:fixture'), { code: 'EMAIL_VERIFICATION_LINK_INVALID' });
    }
    await assert.rejects(sender.sendVerification({ to: 'bad\n@example.test', verificationUrl: base }, 'verify:fixture'));
    await assert.rejects(sender.sendVerification({ to: 'customer@example.test', verificationUrl: base }, `token=${token}`));
    assert.equal(calls, 0);
});

test('SendGrid missing sender and ambiguous response stay failures; accepted never implies delivery', async () => {
    for (const invalid of [{}, { emailApiKey: 'fixture' }, { emailApiKey: 'fixture', emailFrom: 'sender@example.test', publicOrigin: 'https://other.test' }]) assert.throws(() => sendGridEmailAdapter(invalid));
    for (const response of [new Response(null, { status: 200 }), new Response(null, { status: 202 }), new Response(null, { status: 400 })]) {
        const sender = sendGridEmailAdapter({ emailApiKey: 'fixture', emailFrom: 'receipts@example.test', fetchImpl: async () => response });
        await assert.rejects(sender.send('EMAIL_RECEIPT', { to: 'customer@example.test', reference: 'ATLAS-TEST', totalCents: 5400 }, 'fixture'), { code: 'EMAIL_OUTCOME_UNKNOWN' });
    }
    assert.throws(() => notificationAdapter({ emailApiKey: 'fixture', emailFrom: 'receipts@example.test', smsEnabled: false, publicOrigin: 'https://other.test' }));
});

test('historical nonpending SMS receipts are returned unchanged without any provider call or finish', async () => {
    for (const state of ['DISPATCHED', 'UNKNOWN', 'SUCCEEDED', 'FAILED']) {
        const effect = { id: `historical:${state}`, kind: 'SMS_RECEIPT', state, claimId: randomUUID(), request: { to: '+12025550123' },
            result: { historical: true }, updatedAt: '2020-01-01T00:00:00.000Z' };
        const before = structuredClone(effect); let sends = 0, finishes = 0;
        const service = new CommerceService({ repository: { async effect() { return effect; }, async claimEffect() { return { dispatch: false, effect }; }, async finishEffect() { finishes++; } },
            notifications: { async send() { sends++; } } });
        assert.deepEqual(await service.runEffect(effect.id), before); assert.deepEqual(effect, before); assert.equal(sends + finishes, 0);
    }
});
