import { createHmac } from 'node:crypto';
import { deny, hash, parseApprovedPhones } from '../policy.mjs';

export const STAFF_ORIGIN = 'https://app.atlasgrading.com';
export const ACCESS_COOKIES = Object.freeze({ browser: '__Host-atlas_browser', session: '__Host-atlas_staff' });
function secret(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) deny(503, 'ACCESS_CONFIGURATION_INVALID');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length !== 32 || bytes.toString('base64') !== value) deny(503, 'ACCESS_CONFIGURATION_INVALID');
    return bytes;
}

/** No default credentials, legacy environment names, preview mode or fixture promotion. */
export function productionAccessConfig(env) {
    if (env.ATLAS_STAFF_RUNTIME !== 'postgres' || env.NODE_ENV !== 'production' || env.VERCEL_ENV !== 'production'
        || env.ATLAS_LOCAL_SYNTHETIC || env.ATLAS_LOCAL_POSTGRES || env.ATLAS_LOCAL_POSTGRES_FILE || env.ATLAS_STAFF_ORIGIN !== STAFF_ORIGIN
        || !/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '')
        || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '')) deny(503, 'STAFF_ACCESS_NOT_ENABLED');
    const accountSid = env.ATLAS_AUTH_TWILIO_ACCOUNT_SID, serviceSid = env.ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID;
    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid ?? '') || !/^VA[0-9a-fA-F]{32}$/.test(serviceSid ?? ''))
        deny(503, 'ACCESS_CONFIGURATION_INVALID');
    let database;
    try { database = new URL(env.ATLAS_DATABASE_URL); } catch { deny(503, 'ACCESS_CONFIGURATION_INVALID'); }
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.searchParams.get('schema') !== 'atlas_staff'
        || database.searchParams.get('sslmode') !== 'require' || !database.username || !database.password
        || !database.pathname || database.pathname === '/') deny(503, 'ACCESS_CONFIGURATION_INVALID');
    return makeAccessConfig({ mode: 'PRODUCTION', origin: STAFF_ORIGIN, deploymentId: env.VERCEL_URL,
        releaseSha: env.VERCEL_GIT_COMMIT_SHA, accountSid, serviceSid, databaseUrl: database.href, cookies: ACCESS_COOKIES,
        sessionKey: secret(env.ATLAS_AUTH_SESSION_KEY), phoneKey: secret(env.ATLAS_AUTH_PHONE_KEY),
        approvedPhones: parseApprovedPhones(env.ATLAS_ADMIN_PHONES),
        // Release activation must attest the actual Verify service lifetime.
        providerLifetimeMs: 600_000 });
}

export function makeAccessConfig(input) {
    const phoneHash = phone => createHmac('sha256', input.phoneKey).update(`atlas-phone-v1:${phone}`).digest('hex');
    const phoneByHash = new Map([...input.approvedPhones].map(phone => [phoneHash(phone), phone]));
    const configHash = hash(JSON.stringify({ version: 1, mode: input.mode, origin: input.origin,
        accountSid: input.accountSid, serviceSid: input.serviceSid, providerLifetimeMs: input.providerLifetimeMs,
        sessionKeyHash: hash(input.sessionKey), phoneKeyHash: hash(input.phoneKey), approved: [...phoneByHash.keys()].sort() }));
    return Object.freeze({ ...input, phoneHash, phoneByHash, configHash });
}

export function assertProductionStaffRequest(req, config) {
    if (config.mode !== 'PRODUCTION' || config.origin !== STAFF_ORIGIN) deny(503, 'STAFF_ACCESS_NOT_ENABLED');
    if (req.headers.host !== 'app.atlasgrading.com' || req.headers['x-forwarded-host'] !== 'app.atlasgrading.com'
        || req.headers['x-forwarded-proto'] !== 'https') deny(403, 'HOST_NOT_ALLOWED');
    if (req.headers.authorization) deny(403, 'STAFF_COOKIE_REQUIRED');
}

export function secureStaffCookie(name, value, maxAge) {
    if (!Object.values(ACCESS_COOKIES).includes(name) || !/^[A-Za-z0-9_-]*$/.test(value)
        || !Number.isInteger(maxAge) || maxAge < 0 || maxAge > 3600) deny(503, 'ACCESS_CONFIGURATION_INVALID');
    return `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}
