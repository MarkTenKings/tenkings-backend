// One build-time mount for staff pages, data, API calls and static assets.
// Next Link/Router add this automatically; native browser URLs do not.
export const STAFF_BASE_PATH = '/admin';
export const STAFF_APPLICATION = 'atlas-staff';
export const STAFF_SIGN_IN_PATH = STAFF_BASE_PATH;
export const STAFF_REAUTHENTICATE_PATH = `${STAFF_BASE_PATH}?reauthenticate=1`;
export const STAFF_GRADING_PATH = `${STAFF_BASE_PATH}/grading`;
export function staffApiPath(path) {
    if (typeof path !== 'string' || path.length > 2048
        || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*(?:\?[a-zA-Z0-9_=&-]+)?$/.test(path))
        throw new Error('INVALID_STAFF_PATH');
    return `${STAFF_BASE_PATH}/api/staff/${path}`;
}
