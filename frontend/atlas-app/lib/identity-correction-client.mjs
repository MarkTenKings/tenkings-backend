import { canonicalizeSpeedsterSessionIdentity } from '@atlas/grading-core/identity';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/, SHA = /^[a-f0-9]{64}$/;
const reasons = ['CATEGORY_CHANGED', 'LAYOUT_CHANGED', 'EXACT_MAP_KEY_CHANGED', 'FAMILY_MAP_KEY_CHANGED'];
export const identityFields = {
    SPORTS: [['playerName', 'Player name', true], ['year', 'Year', true], ['manufacturer', 'Manufacturer', true],
        ['productSet', 'Product / set', true], ['parallel', 'Parallel'], ['insert', 'Insert'], ['cardNumber', 'Card number']],
    POKEMON: [['cardName', 'Card name', true], ['year', 'Year', true], ['productSet', 'Set', true], ['parallel', 'Parallel'], ['cardNumber', 'Card number']],
};
const fail = () => { throw Object.assign(new Error('IDENTITY_RESPONSE_INVALID'), { code: 'IDENTITY_RESPONSE_INVALID', status: 0 }); };
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function correctionAvailable(card) {
    return UUID.test(card?.id ?? '') && ['SPORTS', 'POKEMON'].includes(card?.grading?.report?.cardProfile)
        && iso(card?.grading?.sourceRevision) && [card?.grading?.analysisRevision, card?.draft?.revision, card?.evidenceRevision]
            .every(value => Number.isSafeInteger(value) && value > 0)
        && [card?.grading?.analysisHash, card?.reviewHash, card?.evidenceHash].every(value => SHA.test(value ?? ''));
}
export function correctionRequest(card, cardProfile, values, reason, operationId) {
    if (!correctionAvailable(card) || !UUID.test(operationId) || !identityFields[cardProfile]
        || typeof reason !== 'string' || !reason.trim() || reason.length > 1000 || /[\x00-\x1f\x7f]/.test(reason)) throw Error('Complete the identity fields and reason.');
    const identity = Object.fromEntries(identityFields[cardProfile].map(([key, , required]) => [key, values[key] || (required ? '' : null)]));
    if (cardProfile === 'POKEMON' && values.layoutType) identity.layoutType = values.layoutType;
    return { operationId, expectedAnalysisRevision: card.grading.analysisRevision, expectedReviewRevision: card.draft.revision,
        expectedEvidenceRevision: card.evidenceRevision, analysisHash: card.grading.analysisHash, reviewHash: card.reviewHash,
        evidenceHash: card.evidenceHash, sourceRevision: card.grading.sourceRevision,
        next: { cardProfile, identity: canonicalizeSpeedsterSessionIdentity(cardProfile, identity) }, reason };
}
export function correctionResult(data, request) {
    const result = data?.correction;
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail();
    if (result.status === 'CORRECTED') {
        const keys = ['status', 'receiptId', 'operationId', 'analysisRevision', 'reviewRevision', 'evidenceRevision', 'evidenceHash', 'sourceHash', 'reviewHash', 'createdAt'];
        if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))
            || !UUID.test(result.receiptId ?? '') || result.operationId !== request.operationId
            || result.analysisRevision !== request.expectedAnalysisRevision + 1 || result.reviewRevision !== request.expectedReviewRevision + 1
            || result.evidenceRevision !== request.expectedEvidenceRevision + 1 || !iso(result.createdAt)
            || ![result.sourceHash, result.reviewHash, result.evidenceHash].every(value => SHA.test(value ?? ''))) fail();
        return result;
    }
    const fields = ['cardProfile', 'layoutType', ...new Set(Object.values(identityFields).flat().map(([key]) => key))];
    if (!['NO_CHANGE', 'REPROCESS_REQUIRED'].includes(result.status) || result.advisory !== true || Object.keys(result).length !== 5
        || !Array.isArray(result.reasons) || result.reasons.some(value => !reasons.includes(value)) || new Set(result.reasons).size !== result.reasons.length
        || !Array.isArray(result.changedFields) || result.changedFields.some(value => !fields.includes(value)) || new Set(result.changedFields).size !== result.changedFields.length
        || (result.status === 'NO_CHANGE' ? result.reasons.length !== 0 || result.changedFields.length !== 0 : result.reasons.length === 0)) fail();
    let identity;
    try { identity = canonicalizeSpeedsterSessionIdentity(request.next.cardProfile, result.identity); } catch { fail(); }
    if (JSON.stringify(identity) !== JSON.stringify(request.next.identity)) fail();
    return result;
}
// The receipt confirms one mutation; the follow-up read must reach that exact
// specimen and at least those saved heads before the parent can resume review.
export function correctionReloadResult(data, { specimenId, receipt }) {
    const card = data?.card;
    if (card?.id !== specimenId || !correctionAvailable(card) || receipt?.status !== 'CORRECTED'
        || ![receipt.analysisRevision, receipt.reviewRevision, receipt.evidenceRevision].every(value => Number.isSafeInteger(value) && value > 0)
        || ![receipt.sourceHash, receipt.reviewHash, receipt.evidenceHash].every(value => SHA.test(value ?? ''))) fail();
    for (const [revision, expected, actualHash, expectedHash] of [
        [card.grading.analysisRevision, receipt.analysisRevision, card.grading.analysisHash, receipt.sourceHash],
        [card.draft.revision, receipt.reviewRevision, card.reviewHash, receipt.reviewHash],
        [card.evidenceRevision, receipt.evidenceRevision, card.evidenceHash, receipt.evidenceHash],
    ]) if (revision < expected || revision === expected && actualHash !== expectedHash) fail();
    return card;
}
// Fresh authority is checked again after the external correction may commit.
// HTTP 401/403/409 therefore cannot prove a dispatched correction did not save.
// Only these two explicit service refusals are guaranteed to precede the bridge.
export function retainCorrectionAfterError(request, error, { dispatched = true } = {}) {
    if (!dispatched) return Boolean(request.uncertain);
    const definitive = error?.status === 503 && error.code === 'IDENTITY_NOT_CONFIGURED'
        || error?.status === 400 && error.code === 'IDENTITY_REQUEST_INVALID';
    request.uncertain ||= !definitive;
    return request.uncertain;
}
