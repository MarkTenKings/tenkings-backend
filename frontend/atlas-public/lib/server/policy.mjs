import { createHash } from 'node:crypto';
import { keyBytes } from '@atlas/service-bridge/protocol';
import { MANUAL_PUBLIC_ORIGIN } from '@atlas/service-bridge/manual-public';
export const PUBLIC_ORIGIN = 'https://atlasgrading.com';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function unavailable() { throw new Error('PUBLIC_REPORTS_UNAVAILABLE'); }
export function makePublicConfig(input) {
    const binding = { version: 'atlas-public-manual-reader-v1', mode: input.mode, origin: input.origin,
        manualOrigin: input.manualOrigin, manualKeyHash: digest(input.manualKey) };
    return Object.freeze({ ...input, configHash: digest(JSON.stringify(binding)) });
}
export function productionConfig(env) {
    if (env.NODE_ENV !== 'production' || env.VERCEL_ENV !== 'production'
        || env.ATLAS_PUBLIC_ORIGIN !== PUBLIC_ORIGIN || Object.keys(env).some(k => k.startsWith('ATLAS_LOCAL_'))
        || !/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '') || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '')) unavailable();
    if (env.ATLAS_PUBLIC_RUNTIME !== 'manual' || env.ATLAS_PUBLIC_MANUAL_ORIGIN !== MANUAL_PUBLIC_ORIGIN
        || ['ATLAS_PUBLIC_DATABASE_URL', 'ATLAS_PUBLIC_MEDIA_ORIGIN', 'ATLAS_PUBLIC_MEDIA_KEY'].some(key => env[key] !== undefined)) unavailable();
    return makePublicConfig({ mode: 'PRODUCTION', origin: PUBLIC_ORIGIN, deploymentId: env.VERCEL_URL,
        releaseSha: env.VERCEL_GIT_COMMIT_SHA, manualOrigin: MANUAL_PUBLIC_ORIGIN, manualKey: keyBytes(env.ATLAS_PUBLIC_MANUAL_KEY) });
}
export function assertPublicRequest(req, config) {
    if (!['GET', 'HEAD'].includes(req.method) || req.headers.authorization) unavailable();
    if (config.mode !== 'PRODUCTION' || req.headers.host !== 'atlasgrading.com' || req.headers['x-forwarded-host'] !== 'atlasgrading.com'
        || req.headers['x-forwarded-proto'] !== 'https' || config.origin !== PUBLIC_ORIGIN) unavailable();
}
export function reportSelector(token, version) {
    if (typeof token !== 'string' || !/^ar_[A-Za-z0-9_-]{24}$/.test(token)) throw new Error('REPORT_NOT_FOUND');
    if (version === undefined) return { token, version: null };
    if (typeof version !== 'string' || !/^[1-9][0-9]{0,9}$/.test(version) || Number(version) > 2147483647)
        throw new Error('REPORT_NOT_FOUND');
    return { token, version: Number(version) };
}
export function publicHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
}
