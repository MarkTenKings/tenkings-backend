import { COLLECTION_DISPLAY_LIMITS, displayCheck, displayError } from '../collection-display-contract.mjs';

const ORIGIN = 'https://atlasgrading.com';
const own = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === names.length
    && names.every(name => Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, 'value'));
const discard = value => { try { void Promise.resolve(value?.body?.cancel()).catch(() => {}); } catch { /* already closed */ } };
function interrupt(work, signal, late) {
    const promise = Promise.resolve(work);
    promise.then(value => { if (signal.aborted) late?.(value); }, () => {});
    let abort;
    const stopped = new Promise((_, reject) => {
        abort = () => reject(displayError());
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
    });
    return Promise.race([promise, stopped]).finally(() => signal.removeEventListener('abort', abort));
}
async function boundedBody(response, limit, signal) {
    const length = response.headers.get('content-length');
    displayCheck(length === null || /^(?:0|[1-9][0-9]*)$/.test(length) && Number(length) <= limit);
    displayCheck(response.body && typeof response.body.getReader === 'function');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    const cancel = () => { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* closed */ } };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        while (true) {
            signal.throwIfAborted();
            const part = await interrupt(reader.read(), signal);
            if (part.done) break;
            displayCheck(part.value instanceof Uint8Array);
            size += part.value.byteLength; displayCheck(size <= limit); chunks.push(Buffer.from(part.value));
        }
        // Fetch may decompress an encoded response; enforce the actual decoded
        // byte cap, and compare Content-Length only when it describes these bytes.
        const encoding = response.headers.get('content-encoding');
        displayCheck(length === null || encoding && encoding !== 'identity' || Number(length) === size);
        return Buffer.concat(chunks, size);
    } finally { signal.removeEventListener('abort', cancel); cancel(); try { reader.releaseLock(); } catch { /* pending read */ } }
}

/** Optional server adapter to already published evidence. No customer cookie,
 * service key, arbitrary URL, storage credential or native grading import.
 * The surrounding display service remains responsible for current ownership,
 * exact packet/photo hashes and a second ownership check before serving. */
export function createCollectionApprovedReader({ enabled = false, request = fetch } = {}) {
    if (enabled === false) return null;
    displayCheck(enabled === true && typeof request === 'function');
    async function read(input, image) {
        displayCheck(own(input, image ? ['token', 'version', 'side', 'signal', 'maxBytes'] : ['token', 'version', 'signal', 'maxBytes'])
            && typeof input.token === 'string' && /^ar_[A-Za-z0-9_-]{24}$/.test(input.token) && Number.isSafeInteger(input.version) && input.version > 0 && input.version < 2147483647
            && (!image || input.side === 'FRONT') && input.signal instanceof AbortSignal
            && Number.isSafeInteger(input.maxBytes) && input.maxBytes > 0
            && input.maxBytes <= (image ? COLLECTION_DISPLAY_LIMITS.imageBytes : COLLECTION_DISPLAY_LIMITS.packetBytes));
        const signal = AbortSignal.any([input.signal, AbortSignal.timeout(20000)]);
        const path = `/api/reports/${input.token}${image ? '/images/FRONT' : ''}?v=${input.version}`;
        const url = ORIGIN + path, type = image ? 'image/webp' : 'application/json'; let response;
        try {
            signal.throwIfAborted();
            response = await interrupt(Promise.resolve().then(() => {
                signal.throwIfAborted();
                return request(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
                    headers: { accept: type, 'accept-encoding': 'identity' }, signal });
            }), signal, discard);
            displayCheck(response.status === 200 && response.ok && !response.redirected
                && (!response.url || response.url === url) && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === type
                && /\bno-store\b/i.test(response.headers.get('cache-control') ?? ''));
            const bytes = await boundedBody(response, input.maxBytes, signal); signal.throwIfAborted();
            if (image) return { bytes, contentType: type };
            const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
            displayCheck(own(value, ['packet', 'publicHash']) && /^[a-f0-9]{64}$/.test(value.publicHash));
            return value;
        } catch { throw displayError(); }
        finally { discard(response); }
    }
    return Object.freeze({ readReport: input => read(input, false), readImage: input => read(input, true) });
}
