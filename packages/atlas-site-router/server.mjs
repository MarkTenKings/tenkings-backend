import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizedAppPath, routeEnvelope, routeTarget, SITE_ORIGIN, ZONES } from './routes.mjs';

/** Every private ingress must carry the gateway proof, whether the platform
 * preserves the apex Host or rewrites it to the exact deployment hostname. */
export function acceptsSiteRequest(req, { zone, deploymentId, routerKey }, now = Date.now()) {
    try {
        if (!ZONES[zone]) return false;
        const permittedHosts = [new URL(SITE_ORIGIN).host, deploymentId];
        if (!Buffer.isBuffer(routerKey) || routerKey.length !== 32
            || !permittedHosts.includes(req.headers.host)
            || (req.headers['x-forwarded-host'] !== undefined && !permittedHosts.includes(req.headers['x-forwarded-host']))
            || req.headers['x-forwarded-proto'] !== 'https') return false;
        const issued = req.headers['x-atlas-route-issued'], target = req.headers['x-atlas-route-target'], proof = req.headers['x-atlas-route-proof'];
        if (typeof issued !== 'string' || !/^[1-9][0-9]{12}$/.test(issued) || typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)
            || Math.abs(now - Number(issued)) > 30_000 || typeof req.url !== 'string') return false;
        const expected = createHmac('sha256', routerKey).update(routeEnvelope({ zone, deployment: `https://${deploymentId}`,
            method: req.method, target, issuedAt: Number(issued) })).digest();
        if (!timingSafeEqual(expected, Buffer.from(proof, 'hex'))) return false;
        routeTarget(req.url);
        const actual = new URL(req.url, SITE_ORIGIN), signed = new URL(target, SITE_ORIGIN);
        const internalPath = normalizedAppPath(target, zone);
        const expectedPaths = new Set([signed.pathname, signed.pathname.slice(ZONES[zone].length) || '/', internalPath]);
        if (!expectedPaths.has(actual.pathname)) return false;
        // Next normalizes data requests into SSR pages. Their query remains
        // data, never authorization; API transport must retain the full query.
        if (internalPath.startsWith('/api/')) {
            actual.searchParams.sort(); signed.searchParams.sort();
            if (actual.search !== signed.search) return false;
        }
        return true;
    } catch { return false; }
}
