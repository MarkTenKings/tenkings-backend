import { deny, identifier, strictObject } from './policy.mjs';
export const SIDES = Object.freeze(['FRONT', 'BACK']);
export function canonical(value) {
    const normalize = entry => {
        if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return entry;
        if (typeof entry === 'number' && Number.isFinite(entry)) return Object.is(entry, -0) ? 0 : entry;
        if (Array.isArray(entry)) return entry.map(normalize);
        if (entry && Object.getPrototypeOf(entry) === Object.prototype)
            return Object.fromEntries(Object.keys(entry).sort().map(key => [key, normalize(entry[key])]));
        deny(400, 'INVALID_REQUEST');
    };
    return JSON.stringify(normalize(value));
}
export function validateDraft(input, evidence) {
    strictObject(input, ['operationId', 'expectedRevision', 'evidenceRevision', 'evidenceHash', 'observations', 'reviewedSides', 'identityReviewed', 'disposition']);
    identifier(input.operationId); strictObject(input.observations, SIDES);
    if (SIDES.some(side => typeof input.observations[side] !== 'string' || input.observations[side].length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.observations[side]))
        || !Array.isArray(input.reviewedSides) || input.reviewedSides.length > 2 || new Set(input.reviewedSides).size !== input.reviewedSides.length
        || input.reviewedSides.some(side => !SIDES.includes(side)) || typeof input.identityReviewed !== 'boolean'
        || !['IN_REVIEW', 'NEEDS_EVIDENCE', 'READY_FOR_HUMAN'].includes(input.disposition)
        || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision >= 2147483647
        || !Number.isSafeInteger(input.evidenceRevision) || input.evidenceRevision < 1 || input.evidenceRevision >= 2147483647
        || typeof input.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.evidenceHash)) deny(400, 'INVALID_DRAFT');
    if (input.reviewedSides.some(side => !evidence[side])) deny(409, 'EVIDENCE_REQUIRED');
    if (input.disposition === 'READY_FOR_HUMAN' && (!input.identityReviewed || input.reviewedSides.length !== 2 || !evidence.FRONT || !evidence.BACK))
        deny(409, 'REVIEW_CHECKLIST_REQUIRED');
}
