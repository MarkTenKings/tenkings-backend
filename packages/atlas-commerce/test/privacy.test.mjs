import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CommerceService } from '../src/service.mjs';
import { customerCheckout, customerOrder, customerPayment } from '../src/projections.mjs';
import { source, memoryRepository, tax, payment, carrier, now } from './fixtures.mjs';

const internalKeys = new Set(['merchant','merchantId','accountId','dealerId','terminalId','terminalLocationId','packagePrinterId','entryToken','phone','profile','profileRevision','photoPairHash','contentHash','requestHash','commissionCents','request','calculationId','providerId','payment','quoteHash','observation','shippingPlans','privateFutureField']);
function safe(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { assert.equal(internalKeys.has(key), false, `private key ${key}`); safe(child); }
}
function fixture(channel = 'KIOSK', status = 'requires_payment_method') {
  const checkout = source(channel), repository = memoryRepository(checkout), provider = payment(status);
  checkout.cards[0].identity.privateFutureField = 'PRIVATE_IDENTITY';
  checkout.privateFutureField = 'PRIVATE_CHECKOUT';
  if (checkout.location) Object.assign(checkout.location, { packagePrinterId: 'PRIVATE_PRINTER', entryToken: 'PRIVATE_ENTRY', privateFutureField: 'PRIVATE_LOCATION', schedule: {
    ...checkout.location.schedule, privateFutureField: 'PRIVATE_SCHEDULE', pickups: [{ weekday: 3, time: '10:00', cutoff: '09:00', privateFutureField: 'PRIVATE_WEEKLY' }],
    returns: [{ weekday: 3, time: '11:00' }], exceptions: [{ date: '2026-10-07', kind: 'pickups', cancelled: true, reason: 'Closure', privateFutureField: 'PRIVATE_EXCEPTION' }] } });
  const service = new CommerceService({ repository, payment: provider, tax, carrier, clock: () => now, terms: { mailClockStart: 'ATLAS_RECEIPT', mailChargedLegs: 'INBOUND_ONLY' } });
  return { checkout, repository, service, input: { draftId: checkout.draftId, expectedRevision: checkout.revision, packingPresetId: 'measured-one', shippingServiceCode: 'FEDEX_GROUND' } };
}

test('customer quote and checkout allowlists preserve display fields while internal immutable evidence stays complete', async () => {
  const b = fixture(), quote = await b.service.quote(b.input), checkout = await b.service.checkout(b.checkout.draftId), stored = b.repository.quotes.get(quote.id);
  safe(quote); safe(checkout); assert.doesNotMatch(JSON.stringify([quote, checkout]), /PRIVATE_/);
  assert.equal(quote.location.name, stored.location.name); assert.equal(quote.totalCents, stored.totalCents); assert.equal(quote.cards[0].identity.title, stored.cards[0].identity.title);
  assert.deepEqual(quote.location.schedule.pickups, [{ weekday: 3, time: '10:00', cutoff: '09:00' }]);
  assert.equal(quote.location.schedule.exceptions[0].reason, 'Closure');
  assert.equal(stored.location.packagePrinterId, 'PRIVATE_PRINTER'); assert.equal(stored.location.terminalId, 'tmr_atlas'); assert.equal(stored.cards[0].commissionCents, 500); assert.ok(stored.contentHash); assert.ok(stored.tax.providerId);
  quote.cards[0].identity.title = 'Modified public object'; quote.location.schedule.pickups[0].time = '12:00';
  assert.equal(stored.cards[0].identity.title, 'Reviewed test card'); assert.equal(stored.location.schedule.pickups[0].time, '10:00');
});

test('mail quote exposes leg amounts without FedEx parties, accounts, requests or tax provider IDs', async () => {
  const b = fixture('MAIL_IN'); b.checkout.shippingPlans[0].legs.INBOUND.accountNumber = { value: 'PRIVATE_FEDEX_ACCOUNT' };
  const quote = await b.service.quote(b.input), stored = b.repository.quotes.get(quote.id); safe(quote);
  assert.deepEqual(Object.keys(quote.shipping[0]).sort(), ['amountCents','currency','expiresAt','leg']);
  assert.equal(quote.shipping[0].amountCents, 1250); assert.equal(stored.shipping[0].request.accountNumber.value, 'PRIVATE_FEDEX_ACCOUNT');
  assert.equal(stored.shipping[0].request.requestedShipment.shipper.contact.personName, b.checkout.profile.name);
});

test('pay, repeated pay and reconcile project paid receipts and never expose provider/payment evidence', async () => {
  const b = fixture('KIOSK', 'succeeded'), quote = await b.service.quote(b.input), first = await b.service.pay({ quoteId: quote.id, requestId: randomUUID() });
  const attempt = b.repository.attempts.get(first.attemptId);
  attempt.order.receipt.payment = { merchantId: 'PRIVATE_MERCHANT', providerId: 'PRIVATE_PAYMENT', clientSecret: 'PRIVATE_SECRET' };
  attempt.order.privateFutureField = 'PRIVATE_ORDER';
  attempt.order.effects = [{ id: 'label', kind: 'FEDEX_LABEL', state: 'SUCCEEDED', trackingNumber: '123456', result: { jobId: 'PRIVATE_JOB', labelBase64: 'PRIVATE_BYTES' }, request: { accountId: 'PRIVATE_ACCOUNT' } }, { id: 'tax', kind: 'TAX_TRANSACTION', state: 'PENDING' }];
  const retry = await b.service.pay({ quoteId: quote.id, requestId: randomUUID() }), reconcile = await b.service.reconcile(first.attemptId);
  for (const output of [first, retry, reconcile]) { safe(output); assert.equal(output.state, 'PAID'); assert.equal(output.order.receipt.totalCents, 10800); assert.equal(output.clientSecret, undefined); assert.doesNotMatch(JSON.stringify(output), /PRIVATE_/); }
  assert.deepEqual(reconcile.order.effects, [{ id: 'label', kind: 'FEDEX_LABEL', state: 'SUCCEEDED', trackingNumber: '123456' }]);
  assert.equal(attempt.order.receipt.payment.clientSecret, 'PRIVATE_SECRET'); assert.equal(attempt.order.receipt.location.packagePrinterId, 'PRIVATE_PRINTER');
});

test('historical receipt recovery projects both raw private source and safe SQL DTO when providers/kiosk are disabled', async () => {
  const b = fixture('KIOSK', 'succeeded'), quote = await b.service.quote(b.input), paid = await b.service.pay({ quoteId: quote.id, requestId: randomUUID() });
  const internalOrder = b.repository.attempts.get(paid.attemptId).order;
  b.checkout.activePayment = { id: paid.attemptId, state: 'PAID', order: internalOrder }; b.checkout.location = null; b.service.payment = null; b.service.tax = null;
  const rawRecovered = await b.service.checkout(b.checkout.draftId); safe(rawRecovered); assert.equal(rawRecovered.location.name, 'Configured Test Kiosk'); assert.equal(rawRecovered.blockers.length, 0);
  b.repository.loadCheckout = async () => customerCheckout(b.checkout);
  const sqlRecovered = await b.service.checkout(b.checkout.draftId); safe(sqlRecovered); assert.equal(sqlRecovered.activePayment.attemptId, paid.attemptId); assert.equal(sqlRecovered.location.name, 'Configured Test Kiosk'); assert.deepEqual(sqlRecovered.blockers, []);
});

test('disabled safe checkout remains readable; only the active online awaiting-payment response gets its form secret', async () => {
  const b = fixture('MAIL_IN'); b.service.payment = null; b.service.tax = null;
  b.repository.loadCheckout = async () => customerCheckout(b.checkout);
  const view = await b.service.checkout(b.checkout.draftId); safe(view); assert.ok(view.blockers.includes('PAYMENT_NOT_CONFIGURED')); assert.ok(view.shippingOptions.length);
  const attempt = { id: randomUUID(), state: 'AWAITING_PAYMENT', quote: { channel: 'MAIL_IN' }, observation: { clientSecret: 'pi_active_secret', merchantId: 'PRIVATE_MERCHANT' } };
  assert.equal(customerPayment(attempt, 'pk_test_fixture').clientSecret, 'pi_active_secret');
  assert.equal(customerPayment({ ...attempt, quote: { channel: 'KIOSK' } }, 'pk_test_fixture').clientSecret, undefined);
  assert.equal(customerPayment({ ...attempt, state: 'UNKNOWN' }, 'pk_test_fixture').clientSecret, undefined);
  assert.deepEqual(customerOrder({ id: randomUUID(), receipt: { location: null } }).effects, []);
});
