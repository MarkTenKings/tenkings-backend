import { deny } from '../policy.mjs';

export const WORKSPACE_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const WORKSPACE_SHA = /^[a-f0-9]{64}$/;
export const PHOTO_SIDES = Object.freeze(['FRONT', 'BACK']);
export const PHOTO_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_PHOTO_BYTES = 50 * 1024 * 1024;
export const MAX_WORKSPACE_REVISION = 2147483646;
const INVALID = 'WORKSPACE_REQUEST_INVALID';

export function requireWorkspace(condition, status = 400, code = INVALID) {
    if (!condition) deny(status, code);
}
export function workspaceObject(value, required, optional = [], code = INVALID) {
    requireWorkspace(value && Object.getPrototypeOf(value) === Object.prototype
        && required.every(key => Object.hasOwn(value, key))
        && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 400, code);
    return value;
}
export function workspaceText(value, maximum, { blank = false } = {}) {
    requireWorkspace(typeof value === 'string' && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value));
    const text = value.trim();
    requireWorkspace(blank || text.length > 0);
    return text;
}
export function workspaceCardId(value) {
    requireWorkspace(typeof value === 'string' && WORKSPACE_UUID.test(value), 404, 'WORKSPACE_CARD_NOT_FOUND');
    return value;
}
export function workspaceOperationId(value) {
    requireWorkspace(typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value));
    return value;
}

/** Intake permits incomplete identity. The original category-aware identity
 * writer is still required before creating/preparing an authoritative session. */
export function parseWorkspaceDraftIdentity(value) {
    workspaceObject(value, [], ['category', 'cardName', 'playerName', 'year', 'manufacturer', 'productSet',
        'parallel', 'insert', 'cardNumber', 'layoutType']);
    if (Object.hasOwn(value, 'category')) requireWorkspace(['SPORTS', 'POKEMON'].includes(value.category));
    const sports = ['playerName', 'manufacturer', 'insert'], pokemon = ['cardName', 'layoutType'];
    if (value.category !== 'SPORTS') requireWorkspace(!sports.some(key => Object.hasOwn(value, key)));
    if (value.category !== 'POKEMON') requireWorkspace(!pokemon.some(key => Object.hasOwn(value, key)));
    const identity = {};
    for (const [key, entry] of Object.entries(value)) {
        if (key === 'layoutType') requireWorkspace(['POKEMON', 'TRAINER', 'ENERGY', ''].includes(entry));
        identity[key] = workspaceText(entry, ['cardNumber', 'year'].includes(key) ? 40 : 160, { blank: true });
    }
    return identity;
}

export function parseWorkspaceIntakeRequest(action, input) {
    const shape = {
        create: [['operationId', 'title', 'identity'], []],
        'upload-plan': [['operationId', 'expectedRevision', 'side', 'file'], []],
        'upload-complete': [['operationId', 'expectedRevision', 'uploadId'], []],
        queue: [['operationId', 'expectedRevision', 'pairConfirmed'], []],
        claim: [['operationId', 'expectedRevision', 'operator'], ['mode']],
    }[action];
    requireWorkspace(Boolean(shape));
    workspaceObject(input, ...shape);
    workspaceOperationId(input.operationId);
    if (action !== 'create') requireWorkspace(Number.isSafeInteger(input.expectedRevision)
        && input.expectedRevision > 0 && input.expectedRevision <= MAX_WORKSPACE_REVISION);
    const parsed = { ...input };
    if (action === 'create') {
        parsed.title = workspaceText(input.title, 200, { blank: true });
        parsed.identity = parseWorkspaceDraftIdentity(input.identity);
    } else if (action === 'upload-plan') {
        requireWorkspace(PHOTO_SIDES.includes(input.side));
        workspaceObject(input.file, ['name', 'contentType', 'byteCount', 'sha256']);
        const name = workspaceText(input.file.name, 255);
        requireWorkspace(!/[\\/]/.test(name) && PHOTO_TYPES.includes(input.file.contentType)
            && Number.isSafeInteger(input.file.byteCount) && input.file.byteCount > 0 && input.file.byteCount <= MAX_PHOTO_BYTES
            && typeof input.file.sha256 === 'string' && WORKSPACE_SHA.test(input.file.sha256));
        parsed.file = { ...input.file, name };
    } else if (action === 'upload-complete') {
        requireWorkspace(typeof input.uploadId === 'string' && WORKSPACE_UUID.test(input.uploadId));
    } else if (action === 'queue') {
        requireWorkspace(input.pairConfirmed === true, 409, 'WORKSPACE_PAIR_REQUIRED');
    } else if (action === 'claim') {
        requireWorkspace(['HUMAN', 'ASTRA'].includes(input.operator));
        if (input.operator === 'HUMAN') requireWorkspace(!Object.hasOwn(input, 'mode'));
        else if (Object.hasOwn(input, 'mode')) requireWorkspace(['CONTINUOUS', 'STEP'].includes(input.mode));
    }
    return parsed;
}

export function workspaceTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value);
    requireWorkspace((typeof value === 'string' || value instanceof Date) && Number.isFinite(+date), 503, 'WORKSPACE_DATA_UNAVAILABLE');
    return date.toISOString();
}

export function verifiedWorkspaceUpload(value, upload) {
    // These values come only from a server verifier of the exact planned object.
    workspaceObject(value, ['objectRef', 'sha256', 'byteCount', 'contentType', 'width', 'height'], ['versionId'], 'WORKSPACE_UPLOAD_UNVERIFIED');
    requireWorkspace(value.objectRef === upload.objectRef && value.sha256 === upload.sha256
        && value.byteCount === upload.byteCount && value.contentType === upload.contentType
        && Number.isSafeInteger(value.width) && value.width >= 2 && value.width <= 16384
        && Number.isSafeInteger(value.height) && value.height >= 2 && value.height <= 16384
        && value.width * value.height <= 64 * 1024 * 1024
        && (!Object.hasOwn(value, 'versionId') || (typeof value.versionId === 'string'
            && value.versionId.length > 0 && value.versionId.length <= 256 && !/[\x00-\x1f\x7f]/.test(value.versionId))),
    409, 'WORKSPACE_UPLOAD_UNVERIFIED');
    return { ...value };
}

export function workspaceUploadGrant(value, upload, now) {
    workspaceObject(value, ['id', 'url', 'method', 'headers', 'expiresAt'], [], 'WORKSPACE_STORAGE_UNAVAILABLE');
    let url;
    try { url = new URL(value.url); } catch { requireWorkspace(false, 503, 'WORKSPACE_STORAGE_UNAVAILABLE'); }
    const expiry = new Date(value.expiresAt);
    requireWorkspace(value.id === upload.id && value.method === 'PUT' && typeof value.url === 'string' && value.url.length <= 8192
        && url.protocol === 'https:' && !url.username && !url.password && !url.hash
        && Number.isFinite(+expiry) && +expiry > +now && +expiry <= +now + 15 * 60_000,
    503, 'WORKSPACE_STORAGE_UNAVAILABLE');
    workspaceObject(value.headers, [], ['Content-Type', 'content-type', 'x-amz-checksum-sha256', 'x-amz-acl', 'If-None-Match'], 'WORKSPACE_STORAGE_UNAVAILABLE');
    const typeKeys = Object.keys(value.headers).filter(key => key.toLowerCase() === 'content-type');
    requireWorkspace(typeKeys.length === 1 && value.headers[typeKeys[0]] === upload.contentType
        && (!Object.hasOwn(value.headers, 'x-amz-acl') || value.headers['x-amz-acl'] === 'private')
        && (!Object.hasOwn(value.headers, 'If-None-Match') || value.headers['If-None-Match'] === '*')
        && (!Object.hasOwn(value.headers, 'x-amz-checksum-sha256')
            || value.headers['x-amz-checksum-sha256'] === Buffer.from(upload.sha256, 'hex').toString('base64')),
    503, 'WORKSPACE_STORAGE_UNAVAILABLE');
    // A grant is returned only from this transient path, never saved in a row.
    return { id: value.id, url: value.url, method: 'PUT', headers: { ...value.headers }, expiresAt: expiry.toISOString() };
}
