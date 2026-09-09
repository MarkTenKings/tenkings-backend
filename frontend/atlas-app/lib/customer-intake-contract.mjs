// Shared data contract only. This module carries no session, database or grading authority.
export const CUSTOMER_CARD_STAGES = Object.freeze(['SUBMITTED', 'RECEIVED', 'GRADING', 'FINAL_REVIEW', 'APPROVED', 'ENCAPSULATED', 'SHIPPED']);
export const CUSTOMER_ACTION_REASONS = Object.freeze({
    CONTACT_SUPPORT: 'Contact ATLAS', CONFIRM_RETURN_ADDRESS: 'Confirm return address', CARD_DETAILS_NEEDED: 'Confirm card details',
});
export const customerStageLabel = stage => ({ SUBMITTED: 'Submission created', RECEIVED: 'Received', GRADING: 'Grading',
    FINAL_REVIEW: 'Final review', APPROVED: 'Report approved', ENCAPSULATED: 'Encapsulated', SHIPPED: 'Shipped' })[stage];

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (request = false) => { throw Object.assign(new Error(request ? 'CUSTOMER_INTAKE_REQUEST_INVALID' : 'CUSTOMER_INTAKE_RESPONSE_INVALID'),
    { code: request ? 'CUSTOMER_INTAKE_REQUEST_INVALID' : 'CUSTOMER_INTAKE_RESPONSE_INVALID', status: request ? 400 : 0 }); };
const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const uuid = value => typeof value === 'string' && UUID.test(value);
const text = (value, min, max) => typeof value === 'string' && value.trim() === value && value.length >= min
    && [...value].length <= max && !/[\x00-\x1f\x7f]/.test(value);
// PostgreSQL renders timestamptz JSON in its current session timezone. Preserve
// that explicit ISO offset; a UTC-only parser would reject valid durable facts.
const time = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && Number.isFinite(Date.parse(value));
const reasons = reason => Object.hasOwn(CUSTOMER_ACTION_REASONS, reason);
export const customerCardId = uuid;

export function customerIntakeRequest(action, value) {
    const fields = { list: ['cursor'], bind: ['operationId', 'cardId', 'specimenId', 'physicalReceiptConfirmed'],
        action: ['operationId', 'cardId', 'reason', 'message', 'resolved'],
        ship: ['operationId', 'cardId', 'physicalDispatchConfirmed', 'carrier', 'trackingNumber'] }[action];
    if (!fields || !object(value, fields)) fail(true);
    if (action === 'list') {
        if (value.cursor !== null && !uuid(value.cursor)) fail(true);
    } else {
        if (!uuid(value.operationId) || !uuid(value.cardId)) fail(true);
        if (action === 'bind' && (!uuid(value.specimenId) || value.physicalReceiptConfirmed !== true)) fail(true);
        if (action === 'action' && (!reasons(value.reason) || typeof value.resolved !== 'boolean'
            || (value.resolved ? value.message !== null : !text(value.message, 1, 500)))) fail(true);
        if (action === 'ship' && (value.physicalDispatchConfirmed !== true || !text(value.carrier, 2, 60)
            || !text(value.trackingNumber, 3, 100))) fail(true);
    }
    // Copy only the exact reviewed command. Later form changes cannot edit a retry.
    return Object.fromEntries(fields.map(key => [key, value[key]]));
}

export function customerIntakeQueue(value) {
    if (!object(value, ['submissions', 'nextCursor']) || !Array.isArray(value.submissions) || value.submissions.length > 5
        || value.nextCursor !== null && !uuid(value.nextCursor)
        || new TextEncoder().encode(JSON.stringify(value)).byteLength > 524288) fail();
    const submissions = new Set(), cards = new Set();
    for (const submission of value.submissions) {
        if (!object(submission, ['id', 'reference', 'createdAt', 'intakeMethod', 'profileSnapshot', 'cards']) || !uuid(submission.id)
            || submissions.has(submission.id) || typeof submission.reference !== 'string' || !/^ATLAS-[A-F0-9]{12}$/.test(submission.reference)
            || !['DEALER_DROP_OFF', 'MAIL_IN'].includes(submission.intakeMethod) || !time(submission.createdAt)
            || !Array.isArray(submission.cards) || !submission.cards.length || submission.cards.length > 25) fail();
        submissions.add(submission.id);
        const profile = submission.profileSnapshot;
        if (!object(profile, ['name', 'address1', 'address2', 'city', 'region', 'postalCode', 'country'])
            || !text(profile.name, 1, 120) || !text(profile.address1, 1, 200) || !text(profile.address2, 0, 200)
            || !text(profile.city, 1, 100) || !text(profile.region, 0, 100) || !text(profile.postalCode, 1, 30)
            || typeof profile.country !== 'string' || !/^[A-Z]{2}$/.test(profile.country)) fail();
        for (const card of submission.cards) {
            if (!object(card, ['id', 'title', 'category', 'specimenId', 'stage', 'events', 'actionNeeded', 'shipment', 'reportUrl'])
                || !uuid(card.id) || cards.has(card.id) || !text(card.title, 1, 200) || !['SPORTS', 'POKEMON'].includes(card.category)
                || card.specimenId !== null && !uuid(card.specimenId) || !CUSTOMER_CARD_STAGES.includes(card.stage)
                || !Array.isArray(card.events) || !card.events.length || card.events.length > 7) fail();
            cards.add(card.id);
            const kinds = new Set();
            for (const event of card.events) {
                if (!object(event, ['kind', 'recordedAt']) || !CUSTOMER_CARD_STAGES.includes(event.kind)
                    || kinds.has(event.kind) || !time(event.recordedAt)) fail();
                kinds.add(event.kind);
            }
            if (!kinds.has('SUBMITTED') || !kinds.has(card.stage)) fail();
            if (card.actionNeeded !== null && (!object(card.actionNeeded, ['reason', 'message', 'recordedAt'])
                || !reasons(card.actionNeeded.reason) || !text(card.actionNeeded.message, 1, 500) || !time(card.actionNeeded.recordedAt))) fail();
            if (card.shipment !== null && (!object(card.shipment, ['carrier', 'trackingNumber', 'recordedAt'])
                || !text(card.shipment.carrier, 2, 60) || !text(card.shipment.trackingNumber, 3, 100) || !time(card.shipment.recordedAt))) fail();
            if ((card.stage === 'SHIPPED') !== (card.shipment !== null) || card.stage !== 'SUBMITTED' && card.specimenId === null) fail();
            if (card.reportUrl !== null && (typeof card.reportUrl !== 'string' || !/^\/reports\/ar_[A-Za-z0-9_-]{24}\?v=[1-9]\d{0,9}$/.test(card.reportUrl))) fail();
        }
    }
    if (value.nextCursor !== null && value.submissions.at(-1)?.id !== value.nextCursor) fail();
    return value;
}

export function customerIntakeReceipt(value, action, request) {
    const expectedKind = { bind: 'RECEIVED', action: request.resolved ? 'ACTION_RESOLVED' : 'ACTION_NEEDED', ship: 'SHIPPED' }[action];
    const receipt = value?.receipt;
    if (!expectedKind || !object(value, ['receipt']) || !object(receipt, ['id', 'operationId', 'cardId', 'kind', 'recordedAt'])
        || !uuid(receipt.id) || receipt.operationId !== request.operationId || receipt.cardId !== request.cardId
        || receipt.kind !== expectedKind || !time(receipt.recordedAt)) fail();
    return receipt;
}

// These actions are one DB transaction. A first definitive HTTP refusal means
// it did not save; no later refusal can erase an earlier missing/invalid reply.
export function retainCustomerIntakeRequest(request, error, dispatched = true) {
    if (dispatched) request.uncertain ||= !Number.isInteger(error?.status) || error.status < 400 || error.status >= 500
        || error.status === 408 || /UNKNOWN|UNCONFIRMED|UNRESOLVED/.test(error.code ?? '');
    return request.uncertain || !dispatched;
}
