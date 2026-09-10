export const SITE_ORIGIN = 'https://atlasgrading.com';
export const LOCAL_SITE_ORIGIN = 'http://127.0.0.1:4318';
export const ZONES = Object.freeze({ staff: '/admin', customer: '/account' });

// Classify whole path segments. Encoded separators and dot segments must never
// select a different zone after another proxy or Next normalizes the URL.
export function routeTarget(target) {
    if (typeof target !== 'string' || target.length > 8192 || !target.startsWith('/') || target.startsWith('//')
        || /[\\\u0000-\u0020\u007f#]/.test(target)) throw new Error('INVALID_SITE_PATH');
    const path = target.split('?')[0];
    if (/%(?:2f|5c|2e|00|25)/i.test(path) || path.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path))
        throw new Error('INVALID_SITE_PATH');
    // Routing prefixes are ASCII literals, never an encoded alias.
    if (/%/.test(path.split('/')[1] ?? '')) throw new Error('INVALID_SITE_PATH');
    for (const [zone, basePath] of Object.entries(ZONES)) if (path === basePath || path.startsWith(`${basePath}/`))
        return { zone, basePath, target };
    return { zone: 'public', basePath: '', target };
}

export function deploymentOrigin(value) {
    if (typeof value !== 'string' || !/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(value))
        throw new Error('INVALID_SITE_DEPLOYMENT');
    return value;
}

export function routeEnvelope({ zone, deployment, method, target, issuedAt }) {
    if (!ZONES[zone] || routeTarget(target).zone !== zone || !/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)
        || !Number.isSafeInteger(issuedAt) || issuedAt < 1) throw new Error('INVALID_ROUTE_PROOF');
    return JSON.stringify(['atlas-site-route-v1', zone, SITE_ORIGIN, deploymentOrigin(deployment), method, target, issuedAt]);
}

export function normalizedAppPath(target, zone) {
    const { basePath } = routeTarget(target);
    if (basePath !== ZONES[zone]) throw new Error('INVALID_ROUTE_PROOF');
    let path = target.split('?')[0].slice(basePath.length) || '/';
    const data = /^\/_next\/data\/[A-Za-z0-9_-]{1,200}\/(.+)\.json$/.exec(path);
    if (data) path = data[1] === 'index' ? '/' : `/${data[1]}`;
    return path;
}
