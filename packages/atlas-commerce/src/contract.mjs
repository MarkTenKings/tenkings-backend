import { createHash } from 'node:crypto';

export class CommerceError extends Error {
    constructor(code, status = 409) { super(code); this.name = 'CommerceError'; this.code = code; this.status = status; }
}
export const fail = (code, status) => { throw new CommerceError(code, status); };
export const requireValue = (condition, code, status) => { if (!condition) fail(code, status); };
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const HASH = /^[a-f0-9]{64}$/;
export const minor = value => Number.isSafeInteger(value) && value >= 0;
export const canonical = value => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    requireValue(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)), 'INVALID_SNAPSHOT');
    return JSON.stringify(value);
};
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const clone = value => JSON.parse(canonical(value));
export const SERVICE = Object.freeze({ MAIL_IN: Object.freeze({ unitCents: 4000, days: 14, commissionCents: 0 }),
    KIOSK: Object.freeze({ unitCents: 5000, days: 7, commissionCents: 500 }) });
// Saved pre-cutover KIOSK attempts retain their original terminal semantics.
export const customerPhonePayment = quote => quote?.channel === 'MAIL_IN' || quote?.terms?.paymentFlow === 'CUSTOMER_PHONE';
export const receiptEmail = value => typeof value === 'string' && value.length <= 254 && !/[\x00-\x1f\x7f]/.test(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function assertCheckout(source) {
    requireValue(source && UUID.test(source.draftId) && UUID.test(source.accountId), 'INVALID_CHECKOUT_SOURCE');
    requireValue(Number.isSafeInteger(source.revision) && source.revision > 0 && SERVICE[source.channel], 'INVALID_CHECKOUT_SOURCE');
    requireValue(Array.isArray(source.cards) && source.cards.length > 0 && source.cards.length <= 100, 'CARDS_REQUIRED');
    requireValue(new Set(source.cards.map(card => card.id)).size === source.cards.length, 'DUPLICATE_CARD');
    for (const card of source.cards) requireValue(UUID.test(card.id) && Number.isInteger(card.revision) && card.revision > 0
        && HASH.test(card.photoPairHash) && card.identity && typeof card.identity === 'object', 'CARD_REVIEW_REQUIRED');
    requireValue(source.profile && typeof source.profile === 'object' && !Array.isArray(source.profile)
        && typeof source.profile.name === 'string' && source.profile.name.trim()
        && /^\+[1-9][0-9]{7,14}$/.test(source.phone), 'PROFILE_INCOMPLETE');
    if (source.channel === 'MAIL_IN') {
        requireValue(['email','address1','city','region','postalCode','country'].every(key => typeof source.profile[key] === 'string' && source.profile[key].trim())
            && receiptEmail(source.profile.email), 'PROFILE_INCOMPLETE');
    } else {
        // The shop returns cards through its configured route. The customer's
        // verified account phone is authoritative; no home/shipping data is
        // fabricated merely to satisfy the existing online payment adapter.
        requireValue(!Object.hasOwn(source.profile, 'email') || source.profile.email === '' || receiptEmail(source.profile.email), 'PROFILE_INCOMPLETE');
    }
    requireValue(Number.isInteger(source.profileRevision) && source.profileRevision > 0, 'PROFILE_REVISION_REQUIRED');
    if (source.channel === 'KIOSK') requireValue(source.location && source.location.id && source.location.dealerId
        && source.location.revision && source.location.schedule
        && source.location.schedule.timeZone && source.location.schedule.nextCollectionAt && source.location.schedule.projectedReturnAt,
    'KIOSK_NOT_AVAILABLE');
    return source;
}

export function assertPaymentBinding(attempt, evidence) {
    const q = attempt.quote;
    requireValue(evidence && evidence.source === 'PROVIDER_RETRIEVAL', 'PAYMENT_NOT_CONFIRMED');
    requireValue(evidence.provider === attempt.merchant.provider && evidence.merchantId === attempt.merchant.accountId
        && evidence.livemode === attempt.merchant.livemode, 'PAYMENT_MERCHANT_MISMATCH');
    requireValue(evidence.amountCents === q.totalCents
        && evidence.currency === q.currency && evidence.quoteHash === q.contentHash && evidence.attemptId === attempt.id,
    'PAYMENT_BINDING_MISMATCH');
    requireValue(typeof evidence.providerId === 'string' && evidence.providerId.length > 0
        && (!attempt.providerId || attempt.providerId === evidence.providerId), 'PAYMENT_ID_MISMATCH');
    requireValue(evidence.paymentMethodTypes?.includes(customerPhonePayment(q) ? 'card' : 'card_present'), 'PAYMENT_METHOD_MISMATCH');
    return evidence;
}
export function assertPaidEvidence(attempt, evidence) {
    assertPaymentBinding(attempt,evidence);
    requireValue(evidence.status === 'succeeded' && evidence.receivedCents === attempt.quote.totalCents, 'PAYMENT_NOT_CONFIRMED');
    return evidence;
}

export function receiptEffects(orderId, quote) {
    const receipt = { orderId, quoteHash: quote.contentHash, currency: quote.currency, totalCents: quote.totalCents };
    return [
        ...(quote.channel === 'KIOSK' && customerPhonePayment(quote) && !receiptEmail(quote.profile.email) ? []
            : [{ id: `${orderId}:email:v1`, kind: 'EMAIL_RECEIPT', request: { ...receipt, to: quote.profile.email } }]),
        { id: `${orderId}:tax:v1`, kind: 'TAX_TRANSACTION', request: { ...receipt, calculationId: quote.tax.providerId } },
        ...quote.shipping.map(line => ({ id: `${orderId}:fedex:${line.leg}:v1`, kind: 'FEDEX_LABEL',
            request: { ...receipt, shipment: line.request, leg: line.leg, rateId: line.providerId } })),
        ...(quote.channel === 'KIOSK' && !customerPhonePayment(quote) ? [{ id: `${orderId}:package:v1`, kind: 'PACKAGE_LABEL', request: { ...receipt, locationId: quote.location.id } }] : []),
    ];
}
