const KEY = 'atlas-customer-pending-submission-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** Tab-lifetime recovery of one exact customer-initiated request. No SMS code,
 * session cookie or staff data is stored. Clear only on confirmed commit/logout
 * or a first attempt's definitive validation rejection. */
export function retainSubmission(storage, customerId, submission, uncertain = false) {
    if (!UUID.test(customerId) || !UUID.test(submission?.requestId)) throw Error('The submission could not be retained. Refresh before continuing.');
    const text = JSON.stringify({ version: 1, customerId, submission, uncertain });
    if (new TextEncoder().encode(text).length > 32768) throw Error('This submission is too large. Use shorter card descriptions.');
    storage.setItem(KEY, text);
    if (storage.getItem(KEY) !== text) throw Error('The submission could not be retained. Refresh before continuing.');
}
export function readRetainedSubmission(storage, customerId) {
    const text = storage.getItem(KEY); if (!text) return null;
    const value = JSON.parse(text);
    if (!value || value.version !== 1 || !UUID.test(value.customerId) || !UUID.test(value.submission?.requestId)
        || new TextEncoder().encode(text).length > 32768) throw Error('The retained submission could not be read. Contact ATLAS before creating another submission.');
    if (value.customerId !== customerId) return null;
    return { ...value, uncertain: true };
}
export function clearRetainedSubmission(storage) { storage.removeItem(KEY); }
