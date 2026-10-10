// One build-time mount for staff pages, data, API calls and static assets.
// Next Link/Router add this automatically; native browser URLs do not.
export const STAFF_BASE_PATH = '/admin';
export const STAFF_APPLICATION = 'atlas-staff';
export const STAFF_SIGN_IN_PATH = STAFF_BASE_PATH;
export const STAFF_REAUTHENTICATE_PATH = `${STAFF_BASE_PATH}?reauthenticate=1`;
export const STAFF_GRADING_PATH = `${STAFF_BASE_PATH}/grading`;
const orderDeskStages = new Set(['ARRIVAL', 'RECEIVED', 'GRADING_REVIEW', 'FINISHING_PACKING', 'RETURNING', 'COMPLETE', 'WAITING_FOR_ARRIVAL', 'GRADING', 'HUMAN_REVIEW', 'FINISHING', 'READY_FOR_RETURN', 'ATTENTION']);
export function validOrderDeskQueryPath(path) {
    if (typeof path !== 'string' || !path.startsWith('manual-connected/order-desk?') || path.length > 2048) return false;
    const query = path.slice('manual-connected/order-desk?'.length);
    if (!query || /[^a-zA-Z0-9_=&%+.-]/.test(query) || /%(?![a-fA-F0-9]{2})/.test(query)) return false;
    const values = new URLSearchParams(query), seen = new Set();
    for (const [key, value] of values) {
        if (seen.has(key) || !['q', 'stage', 'view', 'cursor', 'limit'].includes(key)) return false;
        seen.add(key);
        if (key === 'q' && (!value.trim() || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))) return false;
        if (key === 'stage' && !orderDeskStages.has(value)) return false;
        if (key === 'view' && !['all', 'new'].includes(value)) return false;
        if (key === 'limit' && (!/^[1-9][0-9]?$/.test(value) || Number(value) > 50)) return false;
        if (key === 'cursor' && (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))) return false;
    }
    // Reject alternate/double encodings instead of accepting ambiguous query text.
    return values.toString() === query;
}
export function staffApiPath(path) {
    if (typeof path !== 'string' || path.length > 2048
        || (path.startsWith('manual-connected/order-desk?') ? !validOrderDeskQueryPath(path) : !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*(?:\?[a-zA-Z0-9_=&-]+)?$/.test(path)))
        throw new Error('INVALID_STAFF_PATH');
    return `${STAFF_BASE_PATH}/api/staff/${path}`;
}
