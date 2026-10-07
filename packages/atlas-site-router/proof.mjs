import { routeEnvelope } from './routes.mjs';
export const ROUTE_HEADERS = Object.freeze(['x-atlas-route-target', 'x-atlas-route-issued', 'x-atlas-route-proof']);

// Web Crypto keeps this signer usable in the edge router. These keys authorize
// forwarding only; staff/customer sessions and write CSRF remain mandatory.
export async function signRoute(input, key, cryptoImpl = globalThis.crypto) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error('INVALID_ROUTE_KEY');
    const bytes = Uint8Array.from(atob(key), c => c.charCodeAt(0));
    if (bytes.length !== 32 || btoa(String.fromCharCode(...bytes)) !== key) throw new Error('INVALID_ROUTE_KEY');
    const imported = await cryptoImpl.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = new Uint8Array(await cryptoImpl.subtle.sign('HMAC', imported, new TextEncoder().encode(routeEnvelope(input))));
    return { 'x-atlas-route-target': input.target, 'x-atlas-route-issued': String(input.issuedAt),
        'x-atlas-route-proof': [...signature].map(byte => byte.toString(16).padStart(2, '0')).join('') };
}

/** Prepare only server-to-server forwarding. Platform protection uses its own
 * secret; it does not replace ATLAS ingress proof or either user's session. */
export async function forwardingHeaders(incoming, input, key, bypassSecret, cryptoImpl = globalThis.crypto) {
    const headers = new Headers(incoming);
    for (const name of [...headers.keys()]) if (name.startsWith('x-atlas-route-') || name.startsWith('x-middleware-')
        || ['x-matched-path', 'x-now-route-matches', 'x-nextjs-data', 'x-vercel-protection-bypass', 'x-vercel-set-bypass-cookie'].includes(name)) headers.delete(name);
    if (bypassSecret !== undefined) {
        if (typeof bypassSecret !== 'string' || !/^[A-Za-z0-9_=-]{16,256}$/.test(bypassSecret)) throw Error('INVALID_DEPLOYMENT_BYPASS');
        headers.set('x-vercel-protection-bypass', bypassSecret);
    }
    for (const [name, value] of Object.entries(await signRoute(input, key, cryptoImpl))) headers.set(name, value);
    return headers;
}
