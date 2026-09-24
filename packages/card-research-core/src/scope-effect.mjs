// Extracted from Inventory 20643deae9b9b341fc7dfcd7fb703c53d0b73d0b. See SOURCE_MANIFEST.json.
import { createHash, randomUUID } from 'node:crypto';
export const CARD_CATALOG_SCOPE_ENDPOINT = 'https://api.openai.com/v1/responses';
export const CARD_CATALOG_SCOPE_LIMITS = { requestBytes: 32 * 1024 * 1024, responseBytes: 256 * 1024, timeoutMs: 15_000 };
export class CardCatalogScopeEffectError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'CardCatalogScopeEffectError';
    }
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const opaque = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,179}$/.test(value)
    && !/^(?:https?|file|data):|(?:sk|sess|proj)-[A-Za-z0-9_-]{8,}/i.test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
function fail(code) { throw new CardCatalogScopeEffectError(code); }
/** Snapshot only protocol fields. Neither a storage key nor source image bytes
 * are needed: transmitted bytes are verified, upstream lineage is caller-bound. */
function snapshotInput(input) {
    if (!input || input.schemaVersion !== 1 || input.engineVersion !== 'staff-inventory-research-v4' || input.stage !== 'printing_scope'
        || input.endpoint !== CARD_CATALOG_SCOPE_ENDPOINT || !opaque(input.attemptId) || !opaque(input.invocationId)
        || typeof input.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(input.model)
        || typeof input.requestBody !== 'string' || Buffer.byteLength(input.requestBody, 'utf8') > CARD_CATALOG_SCOPE_LIMITS.requestBytes
        || !hex(input.requestSha256) || hash(input.requestBody) !== input.requestSha256
        || !input.settings || input.settings.store !== false || input.settings.reasoning?.effort !== 'low'
        || !Number.isSafeInteger(input.settings.max_output_tokens) || input.settings.max_output_tokens < 1 || input.settings.max_output_tokens > 1600
        || !Array.isArray(input.images) || input.images.length !== 2)
        fail('invalid_request');
    let body;
    try {
        body = object(JSON.parse(input.requestBody));
    }
    catch {
        return fail('invalid_request');
    }
    if (!body || body.model !== input.model || body.store !== input.settings.store || body.max_output_tokens !== input.settings.max_output_tokens
        || object(body.reasoning)?.effort !== input.settings.reasoning.effort || Object.keys(object(body.reasoning) ?? {}).length !== 1 || !Array.isArray(body.input))
        fail('invalid_request');
    const transmitted = body.input.flatMap(message => {
        const content = object(message)?.content;
        return Array.isArray(content) ? content.filter(part => object(part)?.type === 'input_image') : [];
    });
    if (transmitted.length !== 2)
        fail('invalid_request');
    const images = input.images.map((image, index) => {
        if (!image || image.side !== (index === 0 ? 'front' : 'back') || !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)
            || !hex(image.transmittedSha256) || image.sourceSha256 !== null && !hex(image.sourceSha256))
            fail('invalid_request');
        const url = object(transmitted[index])?.image_url;
        const match = typeof url === 'string' ? /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url) : null;
        if (!match || match[1] !== image.mimeType)
            fail('invalid_request');
        const bytes = Buffer.from(match[2], 'base64');
        if (!bytes.length || bytes.toString('base64') !== match[2] || hash(bytes) !== image.transmittedSha256)
            fail('invalid_request');
        return Object.freeze({ side: image.side, mimeType: image.mimeType, transmittedSha256: image.transmittedSha256, sourceSha256: image.sourceSha256 });
    });
    return Object.freeze({ schemaVersion: 1, engineVersion: 'staff-inventory-research-v4', stage: 'printing_scope', attemptId: input.attemptId,
        invocationId: input.invocationId, endpoint: CARD_CATALOG_SCOPE_ENDPOINT, model: input.model,
        settings: Object.freeze({ store: false, reasoning: Object.freeze({ effort: 'low' }), max_output_tokens: input.settings.max_output_tokens }),
        requestBody: input.requestBody, requestSha256: input.requestSha256, images: Object.freeze(images) });
}
async function fetchRaw(input, deps, signal) {
    const response = await (deps.fetchImpl ?? fetch)(CARD_CATALOG_SCOPE_ENDPOINT, { method: 'POST', redirect: 'error', cache: 'no-store', signal,
        headers: { Authorization: `Bearer ${deps.apiKey.trim()}`, 'Content-Type': 'application/json' }, body: input.requestBody });
    if (response.redirected || response.url && response.url !== CARD_CATALOG_SCOPE_ENDPOINT) {
        void response.body?.cancel().catch(() => { });
        return fail('invalid_response');
    }
    const length = response.headers.get('content-length');
    if (length && /^\d+$/.test(length) && Number(length) > CARD_CATALOG_SCOPE_LIMITS.responseBytes) {
        void response.body?.cancel().catch(() => { });
        return fail('response_too_large');
    }
    const reader = response.body?.getReader(), chunks = [];
    let size = 0;
    const cancel = () => { void reader?.cancel().catch(() => { }); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        while (reader) {
            if (signal.aborted)
                fail('cancelled');
            const part = await reader.read();
            if (part.done)
                break;
            size += part.value.byteLength;
            if (size > CARD_CATALOG_SCOPE_LIMITS.responseBytes)
                fail('response_too_large');
            chunks.push(Buffer.from(part.value));
        }
        if (signal.aborted)
            fail('cancelled');
        return { httpStatus: response.status, contentType: response.headers.get('content-type') ?? '', responseBytes: Buffer.concat(chunks, size) };
    }
    finally {
        signal.removeEventListener('abort', cancel);
        cancel();
    }
}
/** One dispatch, then acknowledgement, then raw result. HTTP status, MIME and JSON
 * success are deliberately interpreted by the caller only after acknowledgement.
 * A process receipt is in-memory evidence, never a durable accounting claim. */
export async function runCardCatalogScopeEffect(input, deps, signal) {
    if (signal.aborted)
        fail('cancelled');
    const request = snapshotInput(input);
    if (deps.dispatch && !deps.acknowledge)
        fail('invalid_request');
    if (!deps.dispatch && (typeof deps.apiKey !== 'string' || !deps.apiKey.trim() || /[\r\n]/.test(deps.apiKey)))
        fail('unavailable');
    if (signal.aborted)
        fail('cancelled');
    const controller = new AbortController();
    let timedOut = false, rejectAbort = () => { };
    const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = () => { controller.abort(); rejectAbort(new CardCatalogScopeEffectError(timedOut ? 'timeout' : 'cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    const timeout = typeof deps.timeoutMs === 'number' && Number.isFinite(deps.timeoutMs) ? Math.max(1, Math.min(CARD_CATALOG_SCOPE_LIMITS.timeoutMs, deps.timeoutMs)) : CARD_CATALOG_SCOPE_LIMITS.timeoutMs;
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeout);
    const operation = (async () => {
        let returned;
        try {
            returned = await (deps.dispatch ? deps.dispatch(request, controller.signal) : fetchRaw(request, deps, controller.signal));
        }
        catch (error) {
            if (error instanceof CardCatalogScopeEffectError)
                throw error;
            return fail('dispatch_failed');
        }
        if (!returned || !Number.isInteger(returned.httpStatus) || returned.httpStatus < 100 || returned.httpStatus > 599
            || typeof returned.contentType !== 'string' || returned.contentType.length > 512 || /[\u0000-\u001f\u007f]/.test(returned.contentType)
            || !Buffer.isBuffer(returned.responseBytes))
            fail('invalid_response');
        if (returned.responseBytes.length > CARD_CATALOG_SCOPE_LIMITS.responseBytes)
            fail('response_too_large');
        const responseBytes = Buffer.from(returned.responseBytes), httpStatus = returned.httpStatus, contentType = returned.contentType;
        const responseSha256 = hash(responseBytes);
        let receiptRef;
        if (deps.acknowledge) {
            try {
                // An adapter can retain a late reply for accounting even after the caller
                // cancelled. The raced operation can never adopt that late result.
                const ack = await deps.acknowledge({ ...request, requestBytes: Buffer.from(request.requestBody, 'utf8'),
                    responseBytes: Buffer.from(responseBytes), responseSha256, httpStatus, contentType }, controller.signal);
                if (!opaque(ack?.receiptRef))
                    fail('acknowledgement_failed');
                receiptRef = ack.receiptRef;
            }
            catch {
                return fail('acknowledgement_failed');
            }
        }
        else
            receiptRef = `process:${randomUUID()}`;
        if (controller.signal.aborted)
            fail(timedOut ? 'timeout' : 'cancelled');
        return { httpStatus, contentType, responseBytes, receipt: {
                attempt_id: request.attemptId, invocation_id: request.invocationId, receipt_ref: receiptRef,
                request_sha256: request.requestSha256, response_sha256: responseSha256, http_status: httpStatus,
                images: request.images.map(image => ({ side: image.side, mime_type: image.mimeType, transmitted_sha256: image.transmittedSha256, source_sha256: image.sourceSha256 })),
                acknowledgement: deps.acknowledge ? 'adapter' : 'process',
            } };
    })();
    try {
        return await Promise.race([operation, cancelled]);
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        controller.abort();
    }
}
