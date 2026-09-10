import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const JSON_TYPE = 'application/json';
function check(value) { if (!value) throw new Error('ATLAS_PRIVATE_REQUEST_INVALID'); }

// Authenticate before resolving the current staff binding from the database.
// Peer release/config fields are subsequently checked by the original signed
// protocol and source authority against those database controls. A caller
// cannot choose a configuration, storage object, provider URL, or DB scope.
export function authenticatePrivatePacket(key, body, signature) {
    check(Buffer.isBuffer(key) && key.length === 32 && typeof signature === 'string'
        && /^[a-f0-9]{64}$/.test(signature));
    const actual = createHmac('sha256', key).update(body).digest();
    check(timingSafeEqual(actual, Buffer.from(signature, 'hex')));
}

function oneHeader(request, name) {
    const values = request.headersDistinct?.[name];
    if (values) { check(values.length === 1); return values[0]; }
    const value = request.headers[name]; check(value === undefined || typeof value === 'string'); return value;
}
async function readBody(request, maximum) {
    const declared = oneHeader(request, 'content-length');
    check(!declared || /^\d+$/.test(declared) && Number(declared) > 0 && Number(declared) <= maximum);
    const chunks = []; let length = 0;
    for await (const chunk of request) {
        length += chunk.length; check(length <= maximum); chunks.push(Buffer.from(chunk));
    }
    check(length > 0 && (!declared || Number(declared) === length));
    const bytes = Buffer.concat(chunks, length), text = bytes.toString('utf8');
    check(Buffer.from(text).equals(bytes)); return text;
}
export function createPrivateServer({ origin, routes, health, onError = () => {} }) {
    const address = new URL(origin);
    check(address.protocol === 'https:' && address.origin === origin && !address.username && !address.password);
    check(routes instanceof Map && routes.size > 0);
    const server = createServer(async (request, response) => {
        response.setHeader('Cache-Control', 'private, no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        try {
            check(oneHeader(request, 'host') === address.host
                && (!request.headers['x-forwarded-host'] || oneHeader(request, 'x-forwarded-host') === address.host)
                && oneHeader(request, 'x-forwarded-proto') === 'https'
                && !request.headers.cookie && !request.headers.authorization && !request.headers.origin);
            if (request.method === 'GET' && request.url === '/health') {
                response.setHeader('Content-Type', JSON_TYPE); response.end(JSON.stringify(health)); return;
            }
            const route = routes.get(request.url);
            check(request.method === 'POST' && route && oneHeader(request, 'content-type') === JSON_TYPE
                && !request.headers['content-encoding'] && !request.headers.expect);
            const body = await readBody(request, route.maximumBytes), signature = oneHeader(request, route.signatureHeader);
            authenticatePrivatePacket(route.key, body, signature);
            const result = await route.receive(body, signature);
            check(result && Buffer.isBuffer(result.bytes) && result.bytes.length <= route.maximumResponseBytes
                && ['application/json', 'image/jpeg', 'image/png', 'image/webp'].includes(result.contentType));
            response.setHeader('Content-Type', result.contentType);
            if (route.responseSignatureHeader) {
                check(typeof result.signature === 'string' && /^[a-f0-9]{64}$/.test(result.signature));
                response.setHeader(route.responseSignatureHeader, result.signature);
            }
            response.statusCode = 200; response.end(result.bytes);
        } catch {
            onError('ATLAS_PRIVATE_REQUEST_UNAVAILABLE');
            if (!response.headersSent) {
                response.statusCode = 503; response.setHeader('Content-Type', JSON_TYPE);
                response.end('{"error":"ATLAS_PRIVATE_REQUEST_UNAVAILABLE"}');
            } else response.destroy();
        }
    });
    server.headersTimeout = 10000;
    server.requestTimeout = 15000;
    server.keepAliveTimeout = 5000;
    server.maxRequestsPerSocket = 100;
    return server;
}
