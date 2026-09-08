import { createHash, timingSafeEqual } from 'node:crypto';
export const LOCAL_ORIGIN = 'http://127.0.0.1:4318';
export const LOCAL_HOST = '127.0.0.1:4318';
export const BROWSER_COOKIE = 'atlas_local_browser';
export const SESSION_COOKIE = 'atlas_local_staff';
export const FIXTURE_PHONE = '+12025550141';
export const FIXTURE_CODE = '424242';
export class BoundaryError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; this[Symbol.for('atlas.staff.boundary.error.v1')] = true; }
}
// The fixture survives Next development reloads, which can load a new Error class.
export function isBoundaryError(error) { return error instanceof BoundaryError || error?.[Symbol.for('atlas.staff.boundary.error.v1')] === true; }
export function deny(status, code) { throw new BoundaryError(status, code); }
export const hash = value => createHash('sha256').update(value).digest('hex');
export function equal(a, b) {
    return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function parseApprovedPhones(value) {
    if (typeof value !== 'string' || value.length > 4096)
        deny(503, 'ACCESS_CONFIGURATION_INVALID');
    const entries = value.split(',').map(v => v.trim());
    if (!entries.length || entries.some(v => !/^\+[1-9]\d{7,14}$/.test(v)) || new Set(entries).size !== entries.length)
        deny(503, 'ACCESS_CONFIGURATION_INVALID');
    return new Set(entries);
}
export function assertLocalRequest(req, env) {
    // No deployment mode can enable this adapter, even with the local flag copied.
    if (env.NODE_ENV !== 'development' || env.ATLAS_LOCAL_SYNTHETIC !== '1' ||
        Object.keys(env).some(key => /^(VERCEL|NOW_|AWS_LAMBDA|FUNCTIONS_WORKER)/.test(key)))
        deny(503, 'STAFF_ACCESS_NOT_ENABLED');
    if (req.headers.host !== LOCAL_HOST || (req.headers['x-forwarded-host'] && req.headers['x-forwarded-host'] !== LOCAL_HOST) ||
        (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'http') ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress))
        deny(403, 'HOST_NOT_ALLOWED');
    if (req.headers.authorization)
        deny(403, 'STAFF_COOKIE_REQUIRED');
}
export function assertWrite(req, origin = LOCAL_ORIGIN) {
    if (req.headers.origin !== origin ||
        (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin'))
        deny(403, 'ORIGIN_NOT_ALLOWED');
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json')
        deny(415, 'JSON_REQUIRED');
}
export function strictObject(value, keys) {
    if (!value || Array.isArray(value) || typeof value !== 'object' ||
        Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k)))
        deny(400, 'INVALID_REQUEST');
    return value;
}
export function identifier(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(value))
        deny(400, 'INVALID_REQUEST');
    return value;
}
export function cookies(header = '') {
    if (typeof header !== 'string' || header.length > 8192)
        return {};
    const result = {};
    for (const part of header.split(';')) {
        const split = part.trim().indexOf('=');
        if (split < 1)
            continue;
        const name = part.trim().slice(0, split);
        if (Object.hasOwn(result, name))
            return {}; // Ambiguous cookies grant no authority.
        result[name] = part.trim().slice(split + 1);
    }
    return result;
}
export function fixtureCookie(name, token, maxAge) {
    // Deliberately different from the future Secure __Host-atlas_staff cookie.
    return `${name}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}
export function privateHeaders(res) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Cookie');
}
