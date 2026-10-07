import { createHmac } from 'node:crypto';
import { deny, hash } from './policy.mjs';
export const ORIGIN = 'https://atlasgrading.com';
export const LOCAL_ORIGIN = 'http://127.0.0.1:4318';
export const COOKIE_NAMES = Object.freeze({ browser: '__Secure-atlas_customer_browser', session: '__Secure-atlas_customer_session' });
export const LOCAL_COOKIES = Object.freeze({ browser: 'atlas_customer_local_browser', session: 'atlas_customer_local_session' });
export function secret(value) {
    const bytes = typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value) ? Buffer.from(value, 'base64') : null;
    if (!bytes || bytes.length !== 32 || bytes.toString('base64') !== value) deny(503, 'CUSTOMER_CONFIGURATION_REQUIRED');
    return bytes;
}
export function makeConfig(input) {
    const phoneHash = phone => createHmac('sha256', input.phoneKey).update(`atlas-customer-phone-v1:${phone}`).digest('hex');
    const configHash = hash(JSON.stringify({ version: 1, purpose: 'ATLAS_CUSTOMER', basePath: '/account',
        mode: input.mode, origin: input.origin, accountSid: input.accountSid, serviceSid: input.serviceSid,
        providerLifetimeMs: 600000, sessionKeyHash: hash(input.sessionKey), phoneKeyHash: hash(input.phoneKey),
        routerKeyHash: input.routerKey ? hash(input.routerKey) : null }));
    return Object.freeze({ ...input, configHash, phoneHash,
        binding: Object.freeze({ mode: input.mode, origin: input.origin, deploymentId: input.deploymentId, releaseSha: input.releaseSha, configHash }) });
}
export function productionConfig(env) {
    if (env.NODE_ENV !== 'production' || env.VERCEL_ENV !== 'production' || env.ATLAS_CUSTOMER_RUNTIME !== 'postgres'
        || env.ATLAS_CUSTOMER_ORIGIN !== ORIGIN || Object.keys(env).some(key => key.startsWith('ATLAS_LOCAL_'))
        || !/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '')
        || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '')) deny(503, 'CUSTOMER_ACCESS_NOT_ENABLED');
    let url; try { url = new URL(env.ATLAS_CUSTOMER_DATABASE_URL); } catch { deny(503, 'CUSTOMER_CONFIGURATION_REQUIRED'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.searchParams.get('schema') !== 'atlas_customer'
        || url.searchParams.get('sslmode') !== 'require' || !url.username || !url.password || !url.pathname || url.pathname === '/'
        || url.hash || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) deny(503, 'CUSTOMER_CONFIGURATION_REQUIRED');
    const accountSid = env.ATLAS_CUSTOMER_TWILIO_ACCOUNT_SID, serviceSid = env.ATLAS_CUSTOMER_TWILIO_VERIFY_SERVICE_SID;
    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid ?? '') || !/^VA[0-9a-fA-F]{32}$/.test(serviceSid ?? '')
        || serviceSid === env.ATLAS_AUTH_TWILIO_VERIFY_SERVICE_SID) deny(503, 'CUSTOMER_CONFIGURATION_REQUIRED');
    return makeConfig({ mode: 'PRODUCTION', origin: ORIGIN, databaseUrl: url.href, deploymentId: env.VERCEL_URL,
        deploymentHost: env.VERCEL_URL, releaseSha: env.VERCEL_GIT_COMMIT_SHA, accountSid, serviceSid, cookies: COOKIE_NAMES,
        sessionKey: secret(env.ATLAS_CUSTOMER_SESSION_KEY), phoneKey: secret(env.ATLAS_CUSTOMER_PHONE_KEY),
        routerKey: secret(env.ATLAS_CUSTOMER_ROUTER_KEY) });
}
export function cookie(config, name, value, maxAge) {
    if (!Object.values(config.cookies).includes(name) || !/^[A-Za-z0-9_-]*$/.test(value)
        || !Number.isInteger(maxAge) || maxAge < 0 || maxAge > 604800) deny(503, 'CUSTOMER_CONFIGURATION_REQUIRED');
    return `${name}=${value}; HttpOnly;${config.mode === 'PRODUCTION' ? ' Secure;' : ''} Path=/account; SameSite=Lax; Max-Age=${maxAge}`;
}
