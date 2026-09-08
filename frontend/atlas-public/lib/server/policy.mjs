import { createHash } from 'node:crypto';
import { bridgeOrigin, keyBytes } from '@atlas/service-bridge/protocol';
export const PUBLIC_ORIGIN = 'https://atlasgrading.com';
export const LOCAL_ORIGIN = 'http://127.0.0.1:4319';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function unavailable() { throw new Error('PUBLIC_REPORTS_UNAVAILABLE'); }
export function makePublicConfig(input) {
    return Object.freeze({ ...input, configHash: digest(JSON.stringify({ version: 'atlas-public-reader-v1',
        mode: input.mode, origin: input.origin, databaseBindingHash: digest(input.databaseUrl),
        mediaOrigin: input.mediaOrigin ?? null, mediaKeyHash: input.mediaKey ? digest(input.mediaKey) : null })) });
}
export function productionConfig(env) {
    if (env.NODE_ENV !== 'production' || env.VERCEL_ENV !== 'production' || env.ATLAS_PUBLIC_RUNTIME !== 'postgres'
        || env.ATLAS_PUBLIC_ORIGIN !== PUBLIC_ORIGIN || Object.keys(env).some(k => k.startsWith('ATLAS_LOCAL_'))
        || !/^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '') || !/^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '')) unavailable();
    let url; try { url = new URL(env.ATLAS_PUBLIC_DATABASE_URL); } catch { unavailable(); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.searchParams.get('schema') !== 'atlas_staff'
        || url.searchParams.get('sslmode') !== 'require' || !url.username || !url.password || url.pathname.length < 2) unavailable();
    return makePublicConfig({ mode: 'PRODUCTION', origin: PUBLIC_ORIGIN, deploymentId: env.VERCEL_URL,
        releaseSha: env.VERCEL_GIT_COMMIT_SHA, databaseUrl: url.href,
        mediaOrigin: bridgeOrigin(env.ATLAS_PUBLIC_MEDIA_ORIGIN), mediaKey: keyBytes(env.ATLAS_PUBLIC_MEDIA_KEY) });
}
export function assertPublicRequest(req, config) {
    if (!['GET', 'HEAD'].includes(req.method) || req.headers.authorization) unavailable();
    if (config.mode === 'PRODUCTION') {
        if (req.headers.host !== 'atlasgrading.com' || req.headers['x-forwarded-host'] !== 'atlasgrading.com'
            || req.headers['x-forwarded-proto'] !== 'https' || config.origin !== PUBLIC_ORIGIN) unavailable();
    } else if (config.mode !== 'LOCAL_FIXTURE' || config.origin !== LOCAL_ORIGIN || req.headers.host !== '127.0.0.1:4319'
        || !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress)
        || (req.headers['x-forwarded-host'] && req.headers['x-forwarded-host'] !== '127.0.0.1:4319')
        || (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'http')) unavailable();
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
