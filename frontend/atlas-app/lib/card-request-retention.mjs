const fields = ['observations', 'reviewedSides', 'identityReviewed', 'disposition'];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
export const retainCardRequest = body => ({ body: freeze(structuredClone(body)), uncertain: false });
// A rejection of a later attempt cannot establish what happened to an earlier
// lost reply. Retain the original immutable operation until success is read.
export function afterCardRequestError(request, error) {
    request.uncertain ||= !Number.isInteger(error?.status) || error.status < 400 || error.status >= 500 || error.status === 408
        || /(?:UNCONFIRMED|UNKNOWN|UNRESOLVED)/.test(error?.code ?? '');
    return !request.uncertain && error.status >= 400 && error.status < 500 ? null : request;
}
export const hasDraftChanges = (form, draft) => fields.some(key => !equal(form[key], draft[key]));
// Adopt saved metadata and unchanged fields, preserving edits made locally
// since the submitted snapshot (or since the last loaded draft).
export function mergeCardDraft(form, baseline, saved, { resetReview = false } = {}) {
    const result = structuredClone(saved);
    for (const key of fields) {
        if (key === 'observations') {
            for (const side of ['FRONT', 'BACK']) if (!equal(form.observations[side], baseline.observations[side])) result.observations[side] = form.observations[side];
        } else if (!resetReview && !equal(form[key], baseline[key])) result[key] = structuredClone(form[key]);
    }
    return result;
}
