/** Browser-safe descriptive identity contract. Nothing here grants grading,
 * category correction after preparation, or report approval authority. */
export const IDENTIFICATION_VERSION = 'atlas-intake-identification-v1';
export const IDENTIFICATION_FIELDS = Object.freeze(['name', 'category', 'manufacturer', 'cardNumber', 'year', 'productSet', 'variant', 'cardType']);
export const IDENTITY_FIELDS = Object.freeze(['category', 'cardName', 'playerName', 'year', 'manufacturer', 'productSet', 'parallel', 'insert', 'cardNumber', 'layoutType']);
export const IDENTIFICATION_LIMITS = Object.freeze({ name: 160, category: 20, manufacturer: 160, cardNumber: 40, year: 40, productSet: 160, variant: 160, cardType: 160 });
const SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const object = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const check = condition => { if (!condition) throw Object.assign(new Error('The saved card details could not be verified.'), { code: 'WORKSPACE_IDENTIFICATION_INVALID' }); };
const safeText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && value === value.trim()
    && !/[\x00-\x1f\x7f]|https?:\/\/|data:|<\/?[a-z][^>]*>|\b(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}/i.test(value);

export function parseWorkspaceIdentificationSuggestions(value) {
    check(object(value, IDENTIFICATION_FIELDS));
    for (const field of IDENTIFICATION_FIELDS) {
        const entry = value[field];
        check(object(entry, ['value', 'confidence', 'evidence']) && ['high', 'medium', 'low', 'unknown'].includes(entry.confidence));
        check(entry.value === null ? entry.confidence === 'unknown' && entry.evidence === null
            : entry.confidence !== 'unknown' && safeText(entry.value, IDENTIFICATION_LIMITS[field]) && safeText(entry.evidence, 240));
    }
    check(value.category.value === null || ['SPORTS', 'POKEMON', 'UNSUPPORTED'].includes(value.category.value));
    return structuredClone(value);
}

export function parseWorkspaceIdentificationPhotos(value) {
    check(object(value, ['FRONT', 'BACK']));
    for (const side of ['FRONT', 'BACK']) check(object(value[side], ['uploadId', 'sha256'])
        && UUID.test(value[side].uploadId) && SHA.test(value[side].sha256));
    check(value.FRONT.uploadId !== value.BACK.uploadId && value.FRONT.sha256 !== value.BACK.sha256);
    return structuredClone(value);
}
export function workspaceIdentificationPhotos(card) {
    check(Array.isArray(card?.sides) && card.sides.length === 2);
    return parseWorkspaceIdentificationPhotos(Object.fromEntries(['FRONT', 'BACK'].map(side => {
        const photo = card.sides.find(entry => entry.side === side);
        check(photo?.status === 'VERIFIED');
        return [side, { uploadId: photo.uploadId, sha256: photo.sha256 }];
    })));
}
/** SHA-256 this exact UTF-8 string on the server. It stays stable when queueing
 * advances the capture revision and is independently reproducible in SQL. */
export function workspaceIdentificationPairKey(photos) {
    const pair = parseWorkspaceIdentificationPhotos(photos);
    return `FRONT:${pair.FRONT.uploadId}:${pair.FRONT.sha256}|BACK:${pair.BACK.uploadId}:${pair.BACK.sha256}`;
}
export function sameWorkspaceIdentificationPhotos(left, right) {
    try { return workspaceIdentificationPairKey(left) === workspaceIdentificationPairKey(right); } catch { return false; }
}

/** A category is necessary to interpret a name, but confidence is not a human
 * decision. Every edited field (including an intentionally blank one) wins.
 * Generic variant/cardType remain descriptive suggestions; neither is silently
 * relabelled as parallel/insert or Pokémon layoutType. */
export function adoptWorkspaceIdentitySuggestions({ identity = {}, suggestions, editedFields = [], requestIdentity = identity,
    currentPair, requestPair }) {
    const proposed = parseWorkspaceIdentificationSuggestions(suggestions), next = { ...identity }, adoptedFields = [], conflicts = [];
    const touched = new Set(editedFields);
    check([...touched].every(field => IDENTITY_FIELDS.includes(field)));
    if (!sameWorkspaceIdentificationPhotos(currentPair, requestPair)) return { identity: next, adoptedFields, conflicts, status: 'STALE_PAIR' };
    const changed = field => touched.has(field) || (identity[field] ?? '') !== (requestIdentity[field] ?? '');
    const useful = field => field.value !== null && ['high', 'medium'].includes(field.confidence);
    const category = proposed.category;
    if (useful(category) && category.value === 'UNSUPPORTED') return { identity: next, adoptedFields, conflicts: ['category'], status: 'UNSUPPORTED' };
    if (useful(category) && ['SPORTS', 'POKEMON'].includes(category.value)) {
        if (next.category && next.category !== category.value) return { identity: next, adoptedFields, conflicts: ['category'], status: 'CONFLICT' };
        if (!changed('category') && !next.category) { next.category = category.value; adoptedFields.push('category'); }
    }
    if (!['SPORTS', 'POKEMON'].includes(next.category)) return { identity: next, adoptedFields, conflicts, status: 'UNKNOWN' };
    // A changed category while this request ran makes even common-looking
    // names ambiguous. Preserve the newer draft and require its own review.
    if (changed('category') && identity.category !== requestIdentity.category) return { identity: next, adoptedFields, conflicts: ['category'], status: 'CONFLICT' };
    const mapping = { name: next.category === 'SPORTS' ? 'playerName' : 'cardName', cardNumber: 'cardNumber', year: 'year', productSet: 'productSet',
        ...(next.category === 'SPORTS' ? { manufacturer: 'manufacturer' } : {}) };
    for (const [source, target] of Object.entries(mapping)) {
        const field = proposed[source];
        if (useful(field) && !changed(target) && !(next[target] ?? '').trim()) { next[target] = field.value; adoptedFields.push(target); }
    }
    return { identity: next, adoptedFields, conflicts, status: 'READY' };
}

export function parseWorkspaceIdentificationResult(value, expectedPhotos) {
    check(value && ['SUCCEEDED', 'PENDING', 'UNKNOWN', 'UNAVAILABLE', 'EXISTING_CARD'].includes(value.status));
    check(sameWorkspaceIdentificationPhotos(value.photos, expectedPhotos));
    check(SHA.test(value.pairHash));
    if (value.status === 'EXISTING_CARD') check(UUID.test(value.existingCardId));
    if (value.status === 'SUCCEEDED') {
        parseWorkspaceIdentificationSuggestions(value.suggestions);
        check(Array.isArray(value.warnings) && value.warnings.length <= 8 && value.warnings.every(w => safeText(w, 300)));
        check(value.provenance?.version === IDENTIFICATION_VERSION && value.provenance?.model === 'gpt-6-astra'
            && value.provenance.reasoningEffort === 'low' && value.provenance.maxOutputTokens === 2400
            && value.provenance.authority === 'MACHINE' && Number.isSafeInteger(value.provenance.elapsedMs) && value.provenance.elapsedMs >= 0);
    }
    return structuredClone(value);
}
