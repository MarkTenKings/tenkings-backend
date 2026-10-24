import { createHmac } from 'node:crypto';
import { acceptsSiteRequest } from '@atlas/site-router/server';
import { deny, hash, parseApprovedPhones } from '../policy.mjs';
import { STAFF_APPLICATION, STAFF_BASE_PATH } from '../../routes.mjs';
import { STAFF_COOKIE_MAX_AGE } from './session-policy.mjs';

export const STAFF_ORIGIN = 'https://atlasgrading.com';
// Path scopes cookie delivery; customer/public scripts still share this origin.
// __Host- requires Path=/, so it cannot name these path-scoped cookies.
export const ACCESS_COOKIES = Object.freeze({ browser: '__Secure-atlas_browser', session: '__Secure-atlas_staff' });
function secret(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) deny(503, 'ACCESS_CONFIGURATION_INVALID');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length !== 32 || bytes.toString('base64') !== value) deny(503, 'ACCESS_CONFIGURATION_INVALID');
    return bytes;
}

function registryInput(value) {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length > 131072) deny(503, 'ACCESS_CONFIGURATION_INVALID');
    try { return JSON.parse(value); } catch { deny(503, 'ACCESS_CONFIGURATION_INVALID'); }
}

/** Server-only replacement-key roster. Its trusted ID/hash provenance must be
 * qualified before activation; this parser cannot establish roster ownership. */
function phoneIdentities(input, derive) {
    const supplied = input.phoneIdentityRegistry;
    const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
    const invalid = () => deny(503, 'ACCESS_CONFIGURATION_INVALID');
    if (!exact(supplied, ['version', 'keyVersion', 'entries']) || supplied.version !== 1
        || typeof supplied.keyVersion !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(supplied.keyVersion)
        || !Array.isArray(supplied.entries)) invalid();
    const phones = [...input.approvedPhones];
    if (!phones.length || phones.length > 256 || new Set(phones).size !== phones.length
        || phones.some(phone => typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone))
        || supplied.entries.length !== phones.length) invalid();
    const approved = new Map(phones.map(phone => [derive(phone), phone]));
    const aliases = new Map(), phoneByHash = new Map(), identityByHash = new Map(), ids = new Set();
    const entries = supplied.entries.map(entry => {
        if (!exact(entry, ['newPhoneHash', 'identityId', 'canonicalPhoneHash'])
            || !/^[a-f0-9]{64}$/.test(entry.newPhoneHash ?? '')
            || !/^[a-f0-9]{64}$/.test(entry.canonicalPhoneHash ?? '')
            || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(entry.identityId ?? '')
            || !approved.has(entry.newPhoneHash) || aliases.has(entry.newPhoneHash)
            || phoneByHash.has(entry.canonicalPhoneHash) || ids.has(entry.identityId)) invalid();
        aliases.set(entry.newPhoneHash, entry.canonicalPhoneHash);
        phoneByHash.set(entry.canonicalPhoneHash, approved.get(entry.newPhoneHash));
        identityByHash.set(entry.canonicalPhoneHash, entry.identityId);
        ids.add(entry.identityId);
        return Object.freeze({ newPhoneHash: entry.newPhoneHash, identityId: entry.identityId,
            canonicalPhoneHash: entry.canonicalPhoneHash });
    }).sort((a, b) => a.newPhoneHash < b.newPhoneHash ? -1 : a.newPhoneHash > b.newPhoneHash ? 1 : 0);
    const registry = Object.freeze({ version: 1, keyVersion: supplied.keyVersion, entries: Object.freeze(entries) });
    return { registry, phoneByHash, phoneHash: phone => aliases.get(derive(phone)) ?? null,
        identityIdForPhoneHash: phoneHash => identityByHash.get(phoneHash) ?? null };
}

/** No default credentials, legacy environment names, preview mode or fixture promotion. */
export function productionAccessConfig(env) {
    if (env.ATLAS_STAFF_RUNTIME !== 'postgres' || env.NODE_ENV !== 'production' || env.VERCEL_ENV !== 'production'
        || env.ATLAS_LOCAL_SYNTHETIC || env.ATLAS_LOCAL_POSTGRES || env.ATLAS_LOCAL_POSTGRES_FILE || env.ATLAS_STAFF_ORIGIN !== STAFF_ORIGIN
        || env.ATLAS_STAFF_BASE_PATH !== STAFF_BASE_PATH
        || !/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '')
        || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '')) deny(503, 'STAFF_ACCESS_NOT_ENABLED');
    return productionAccessDetails(env,env.VERCEL_URL,env.VERCEL_GIT_COMMIT_SHA);
}

/** The private CPU service verifies the same admitted web session/policy.
 * These are explicit web release bindings, not assertions that this host runs
 * on Vercel. It exposes no sign-in, roster, operations or account routes. */
export function privateManualAccessConfig(env) {
    if(env.NODE_ENV!=='production'||env.ATLAS_MANUAL_RUNTIME!=='private-cpu'||env.ATLAS_STAFF_RUNTIME!=='postgres'
        || env.VERCEL || env.VERCEL_ENV || env.ATLAS_LOCAL_SYNTHETIC || env.ATLAS_LOCAL_POSTGRES || env.ATLAS_LOCAL_POSTGRES_FILE
        || env.ATLAS_STAFF_ORIGIN!==STAFF_ORIGIN || env.ATLAS_STAFF_BASE_PATH!==STAFF_BASE_PATH
        || !/^[a-z0-9-]+\.vercel\.app$/.test(env.ATLAS_MANUAL_WEB_DEPLOYMENT??'')
        || !/^[a-f0-9]{40}$/.test(env.ATLAS_MANUAL_WEB_RELEASE_SHA??''))deny(503,'STAFF_ACCESS_NOT_ENABLED');
    return productionAccessDetails(env,env.ATLAS_MANUAL_WEB_DEPLOYMENT,env.ATLAS_MANUAL_WEB_RELEASE_SHA);
}
function productionAccessDetails(env,deploymentId,releaseSha) {
    const accountSid = env.ATLAS_AUTH_TWILIO_ACCOUNT_SID, serviceSid = env.ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID;
    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid ?? '') || !/^VA[0-9a-fA-F]{32}$/.test(serviceSid ?? ''))
        deny(503, 'ACCESS_CONFIGURATION_INVALID');
    let database;
    try { database = new URL(env.ATLAS_DATABASE_URL); } catch { deny(503, 'ACCESS_CONFIGURATION_INVALID'); }
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.searchParams.get('schema') !== 'atlas_staff'
        || database.searchParams.get('sslmode') !== 'require' || !database.username || !database.password
        || !database.pathname || database.pathname === '/') deny(503, 'ACCESS_CONFIGURATION_INVALID');
    const sessionKey = secret(env.ATLAS_AUTH_SESSION_KEY), phoneKey = secret(env.ATLAS_AUTH_PHONE_KEY),
        routerKey = secret(env.ATLAS_STAFF_ROUTER_KEY);
    if (sessionKey.equals(phoneKey) || routerKey.equals(sessionKey) || routerKey.equals(phoneKey))
        deny(503, 'ACCESS_CONFIGURATION_INVALID');
    return makeAccessConfig({ mode: 'PRODUCTION', origin: STAFF_ORIGIN, basePath: STAFF_BASE_PATH, deploymentId,
        releaseSha, accountSid, serviceSid, databaseUrl: database.href, cookies: ACCESS_COOKIES,
        sessionKey, phoneKey, routerKey,
        approvedPhones: parseApprovedPhones(env.ATLAS_ADMIN_PHONES),
        phoneIdentityRegistry: registryInput(env.ATLAS_AUTH_PHONE_IDENTITY_REGISTRY),
        // Release activation must attest the actual Verify service lifetime.
        providerLifetimeMs: 600_000 });
}

export function makeAccessConfig(input) {
    if (input.basePath !== STAFF_BASE_PATH) deny(503, 'ACCESS_CONFIGURATION_INVALID');
    const derive = phone => createHmac('sha256', input.phoneKey).update(`atlas-phone-v1:${phone}`).digest('hex');
    const identities = input.phoneIdentityRegistry === undefined ? null : phoneIdentities(input, derive);
    const phoneHash = identities?.phoneHash ?? derive;
    const phoneByHash = identities?.phoneByHash ?? new Map([...input.approvedPhones].map(phone => [phoneHash(phone), phone]));
    const configHash = hash(JSON.stringify({ version: identities ? 3 : 2, application: STAFF_APPLICATION, basePath: STAFF_BASE_PATH,
        mode: input.mode, origin: input.origin, deploymentId: input.deploymentId, releaseSha: input.releaseSha,
        accountSid: input.accountSid, serviceSid: input.serviceSid, providerLifetimeMs: input.providerLifetimeMs,
        sessionKeyHash: hash(input.sessionKey), phoneKeyHash: hash(input.phoneKey),
        routerKeyHash: input.routerKey ? hash(input.routerKey) : null, approved: [...phoneByHash.keys()].sort(),
        ...(identities ? { phoneIdentityRegistry: identities.registry } : {}) }));
    return Object.freeze({ ...input, application: STAFF_APPLICATION, phoneHash, phoneByHash, configHash,
        phoneIdentityRegistry: identities?.registry, existingIdentityOnly: !!identities,
        identityIdForPhoneHash: identities?.identityIdForPhoneHash });
}

export function assertProductionStaffRequest(req, config) {
    if (config.mode !== 'PRODUCTION' || config.origin !== STAFF_ORIGIN || config.basePath !== STAFF_BASE_PATH
        || config.application !== STAFF_APPLICATION) deny(503, 'STAFF_ACCESS_NOT_ENABLED');
    if (!acceptsSiteRequest(req, { zone: 'staff', deploymentId: config.deploymentId, routerKey: config.routerKey }))
        deny(403, 'HOST_NOT_ALLOWED');
    if (req.headers.authorization) deny(403, 'STAFF_COOKIE_REQUIRED');
}

export function secureStaffCookie(name, value, maxAge) {
    if (!Object.values(ACCESS_COOKIES).includes(name) || !/^[A-Za-z0-9_-]*$/.test(value)
        || !Number.isInteger(maxAge) || maxAge < 0 || maxAge > STAFF_COOKIE_MAX_AGE) deny(503, 'ACCESS_CONFIGURATION_INVALID');
    return `${name}=${value}; HttpOnly; Secure; Path=${STAFF_BASE_PATH}; SameSite=Lax; Max-Age=${maxAge}`;
}
