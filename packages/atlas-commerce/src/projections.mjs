// Customer responses are independent DTOs. Never subtract a few private keys
// from an immutable provider snapshot: new internal fields must stay private.
const scalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value);
const fields = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value ?? {}, key) && scalar(value[key])).map(key => [key, value[key]]));
const array = value => Array.isArray(value) ? value : [];
const identities = ['category', 'title', 'playerName', 'year', 'manufacturer', 'setName', 'cardNumber', 'parallel', 'insert'];
const amounts = ['currency', 'subtotalCents', 'shippingCents', 'taxCents', 'totalCents'];
export function customerLocation(value) {
    if (!value || typeof value !== 'object') return null;
    const schedule = value.schedule ?? {};
    return { ...fields(value, ['id', 'name', 'revision']), address: fields(value.address, ['line1', 'city', 'region', 'postalCode', 'country']),
        schedule: { ...fields(schedule, ['timeZone', 'nextCollectionAt', 'projectedReturnAt', 'cutoffAt']),
            pickups: array(schedule.pickups).map(row => fields(row, ['weekday', 'time', 'cutoff'])),
            returns: array(schedule.returns).map(row => fields(row, ['weekday', 'time'])),
            exceptions: array(schedule.exceptions).map(row => fields(row, ['date', 'kind', 'cancelled', 'time', 'cutoff', 'reason'])) } };
}
export const customerCards = value => array(value).map(card => ({ ...fields(card, ['id', 'cardId', 'revision', 'unitCents']), identity: fields(card.identity, identities) }));
const customerTerms = value => fields(value, ['days', 'clockStart', 'mailChargedLegs']);
export function customerQuote(value) {
    return { ...fields(value, ['id', 'draftId', 'draftRevision', 'channel', ...amounts, 'createdAt', 'expiresAt']),
        cards: customerCards(value?.cards), location: customerLocation(value?.location), terms: customerTerms(value?.terms),
        shipping: array(value?.shipping).map(row => fields(row, ['leg', 'amountCents', 'currency', 'expiresAt'])) };
}
export function customerOrder(value) {
    if (!value) return null;
    return { ...fields(value, ['id', 'reference', 'paidAt']), receipt: customerQuote(value.receipt),
        effects: array(value.effects).filter(effect => ['EMAIL_RECEIPT', 'SMS_RECEIPT', 'FEDEX_LABEL', 'PACKAGE_LABEL'].includes(effect.kind))
            .map(effect => fields(effect, ['id', 'kind', 'state', 'trackingNumber', 'deliveryStatus', 'artifactState'])) };
}
export function customerPayment(value, publishableKey) {
    if (!value) return null;
    const channel = value.quote?.channel ?? value.channel ?? value.order?.receipt?.channel;
    const result = { attemptId: value.id ?? value.attemptId, state: value.state, ...(channel ? { channel } : {}) };
    const clientSecret = value.observation?.clientSecret;
    if (value.state === 'AWAITING_PAYMENT' && channel === 'MAIL_IN' && typeof clientSecret === 'string' && typeof publishableKey === 'string') {
        result.clientSecret = clientSecret; result.publishableKey = publishableKey;
    }
    if (value.state === 'PAID' && value.order) result.order = customerOrder(value.order);
    return result;
}
export function customerCheckout(value, { activePayment = customerPayment(value?.activePayment), blockers = [], unitCents, turnaroundDays } = {}) {
    return { version: 'atlas-commerce-checkout-v1', ...fields(value, ['draftId', 'revision', 'channel']), cards: customerCards(value?.cards),
        location: customerLocation(value?.location), activePayment,
        unitCents: unitCents ?? value.unitCents, turnaroundDays: turnaroundDays ?? value.turnaroundDays,
        shippingOptions: array(value?.shippingOptions ?? value?.shippingPlans).map(row => fields(row, ['packingPresetId', 'shippingServiceCode', 'label', 'packaging'])), blockers };
}
