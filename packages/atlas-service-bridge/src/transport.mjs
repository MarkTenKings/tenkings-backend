import { BRIDGE_PATH, bridgeOrigin, digest, requireBridge, signRequest } from './protocol.mjs';

export async function boundedBytes(response, limit) {
    requireBridge(response.body && (!response.headers.has('content-length')
        || (/^\d+$/.test(response.headers.get('content-length')) && Number(response.headers.get('content-length')) <= limit)), 'BRIDGE_RESPONSE_INVALID');
    const reader = response.body.getReader(), chunks = []; let total = 0;
    try {
        while (true) {
            const { value, done } = await reader.read(); if (done) break;
            total += value.length; requireBridge(total <= limit, 'BRIDGE_RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(value));
        }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    return Buffer.concat(chunks, total);
}
/** Fixed destination, no redirects or retries. A transport failure is unknown. */
export function bridgeClient(config, fetchImpl = fetch) {
    bridgeOrigin(config.origin);
    return { binding: { origin: config.origin, clientKeyHash: digest(config.key) }, async call(scope, payload) {
        const signed = signRequest(config, scope, payload);
        const response = await fetchImpl(`${config.origin}${BRIDGE_PATH}`, { method: 'POST', redirect: 'error',
            headers: { 'content-type': 'application/json', 'x-atlas-signature': signed.signature }, body: signed.body,
            signal: AbortSignal.timeout(payload.action === 'RUN_REVIEW' ? 210_000 : 30_000) });
        requireBridge(response.status === 200, 'BRIDGE_OUTCOME_UNCONFIRMED');
        const bytes = await boundedBytes(response, payload.action === 'READ_EVIDENCE' ? 50 * 1024 * 1024 : 2 * 1024 * 1024);
        return payload.action === 'READ_EVIDENCE' ? bytes : JSON.parse(bytes.toString('utf8'));
    } };
}
/** Wrap the existing worker transport without changing its parser/measurements. */
export function boundedWorkerFetch({ serviceUrl, maxCalls, signal, fetchImpl = fetch }) {
    const base = new URL(serviceUrl);
    requireBridge(base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash, 'WORKER_CONFIGURATION_INVALID');
    const allowed = new Set(['/detect', '/measure'].map(path => `${serviceUrl.replace(/\/$/, '')}${path}`));
    let calls = 0;
    return async (url, init) => {
        requireBridge(typeof url === 'string' && allowed.has(url) && init?.method === 'POST'
            && typeof init.body === 'string' && Buffer.byteLength(init.body) <= 32 * 1024 * 1024, 'WORKER_REQUEST_INVALID');
        requireBridge(++calls <= maxCalls, 'WORKER_CALL_LIMIT');
        signal.throwIfAborted();
        const response = await fetchImpl(url, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
        const bytes = await boundedBytes(response, 32 * 1024 * 1024);
        return new Response(bytes, { status: response.status, headers: response.headers });
    };
}
