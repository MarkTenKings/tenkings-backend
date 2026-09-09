import { createHash, timingSafeEqual } from 'node:crypto';
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const SHA = /^[a-f0-9]{64}$/;
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export class BoundaryError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const deny = (status, code) => { throw new BoundaryError(status, code); };
export const hash = input => createHash('sha256').update(input).digest('hex');
export function equal(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const x = Buffer.from(a), y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}
export function tokenShape(token) { return TOKEN.test(token ?? '') && Buffer.from(token, 'base64url').toString('base64url') === token; }
export function keys(input, expected) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== expected.length
        || expected.some(key => !Object.hasOwn(input, key))) deny(400, 'INVALID_REQUEST');
}
export function cookies(header) {
    const result = Object.create(null);
    if (header === undefined) return result;
    if (typeof header !== 'string' || header.length > 8192) deny(400, 'INVALID_COOKIE');
    for (const field of header.split(';')) {
        const match = /^\s*([^=\s]+)=([^;]*)\s*$/.exec(field);
        if (!match) continue;
        if (Object.hasOwn(result, match[1])) deny(400, 'INVALID_COOKIE');
        result[match[1]] = match[2];
    }
    return result;
}
// An explicit country code removes country-guessing and formatting aliases.
export function normalizePhone(value) {
    if (typeof value !== 'string' || value.length > 48 || !/^\s*\+[\d ().-]+\s*$/.test(value)) deny(400, 'USE_INTERNATIONAL_PHONE');
    const phone = value.replace(/[\s().-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) deny(400, 'USE_INTERNATIONAL_PHONE');
    return phone;
}
export function profile(input) {
    const fields = ['name', 'address1', 'address2', 'city', 'region', 'postalCode', 'country'];
    keys(input, fields);
    const result = {};
    const lengths = { name: 120, address1: 200, address2: 200, city: 100, region: 100, postalCode: 30, country: 2 };
    for (const field of fields) {
        const value = input[field];
        if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value) || value.length > lengths[field]) deny(400, 'RETURN_DETAILS_REQUIRED');
        result[field] = value.trim();
        if (!['address2', 'region'].includes(field) && !result[field]) deny(400, 'RETURN_DETAILS_REQUIRED');
    }
    result.country = result.country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(result.country)) deny(400, 'RETURN_DETAILS_REQUIRED');
    return result;
}
export function submission(input) {
    keys(input, ['requestId', 'profile', 'cards', 'confirmed', 'intakeMethod']);
    if (!UUID.test(input.requestId ?? '') || input.confirmed !== true || !Array.isArray(input.cards)
        || input.cards.length < 1 || input.cards.length > 25 || !['DEALER_DROP_OFF', 'MAIL_IN'].includes(input.intakeMethod)) deny(400, 'INVALID_SUBMISSION');
    return { requestId: input.requestId, profile: profile(input.profile), intakeMethod: input.intakeMethod, confirmed: true, cards: input.cards.map(card => {
        keys(card, ['title', 'category']);
        if (typeof card.title !== 'string' || !card.title.trim() || card.title.length > 180
            || /[\u0000-\u001f\u007f]/.test(card.title) || !['SPORTS', 'POKEMON'].includes(card.category)) deny(400, 'INVALID_SUBMISSION');
        return { title: card.title.trim(), category: card.category };
    }) };
}
export function privateHeaders(res) {
    for (const [name, value] of Object.entries({ 'Cache-Control': 'private, no-store, max-age=0',
        'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'Pragma': 'no-cache',
        'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie' })) res.setHeader(name, value);
}
