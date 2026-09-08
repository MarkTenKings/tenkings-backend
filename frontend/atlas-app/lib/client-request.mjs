export const STAFF_RESPONSE_LIMIT = 8 * 1024 * 1024;
export const staffRequestDeadline = (path, body) => body !== undefined && /^cards\/[^/?#]+\/grade$/.test(path) ? 240_000 : 15_000;
const unknown = (code = 'REQUEST_OUTCOME_UNCONFIRMED', message = 'The reply could not be confirmed. Your notes and exact pending request are kept. Refresh access and retry the retained request.') => Object.assign(new Error(message), { code });
const cancelled = () => Object.assign(unknown('REQUEST_CANCELLED', 'The request was interrupted. Its outcome is unconfirmed; your exact pending request is kept.'), { name: 'AbortError' });
const ignore = action => { try { Promise.resolve(action()).catch(() => {}); } catch {} };

/** Browser-only staff transport. Cancellation is best effort; the independent
 * race releases callers even when fetch/read/cancel ignores AbortSignal. A late
 * reply is never adopted and a write is never automatically dispatched again. */
export async function staffClientRequest(path, { body, csrf, signal } = {}, {
    fetchImpl = globalThis.fetch, timers = globalThis, now = () => globalThis.performance.now()
} = {}) {
    const duration = staffRequestDeadline(path, body), started = now(), controller = new AbortController();
    let closed = false, reader, response, timer, rejectStopped;
    const stopped = new Promise((_, reject) => { rejectStopped = reject; });
    const cancelBody = () => {
        if (reader) ignore(() => reader.cancel());
        else if (response?.body) ignore(() => response.body.cancel());
    };
    const stop = error => {
        if (closed) return;
        closed = true; rejectStopped(error); controller.abort(); cancelBody();
    };
    const check = () => {
        if (closed || signal?.aborted) throw cancelled();
        if (now() - started >= duration) { stop(unknown()); throw unknown(); }
    };
    const abort = () => stop(cancelled());
    timer = timers.setTimeout(() => stop(unknown()), duration);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const work = (async () => {
        check();
        response = await fetchImpl(`/api/staff/${path}`, { method: body === undefined ? 'GET' : 'POST',
            credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
            headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Atlas-Csrf': csrf ?? '' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        // A fetch implementation may return after cancellation. Consume no late
        // data; cancel its newly available body without waiting for cleanup.
        if (closed) { cancelBody(); throw unknown(); }
        check();
        if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status > 599
            || typeof response.body?.getReader !== 'function') throw unknown();
        const length = response.headers?.get('content-length');
        if (length != null && (!/^\d+$/.test(length) || Number(length) > STAFF_RESPONSE_LIMIT)) throw unknown();
        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, text = '';
        while (true) {
            const part = await reader.read(); check();
            if (!part || typeof part.done !== 'boolean') throw unknown();
            if (part.done) break;
            if (!(part.value instanceof Uint8Array)) throw unknown();
            bytes += part.value.byteLength;
            if (bytes > STAFF_RESPONSE_LIMIT) throw unknown();
            text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode(); check();
        const data = JSON.parse(text); check();
        const ok = response.status >= 200 && response.status < 300;
        if (!data || typeof data !== 'object' || Array.isArray(data)
            || (!ok && (typeof data.error !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(data.error)))) throw unknown();
        return { data, ok, status: response.status };
    })();
    try { return await Promise.race([stopped, work]); }
    catch (error) {
        // No HTTP status is attached to unknown transport outcomes, including
        // invalid error bodies. A valid bounded server denial is mapped by api.
        if (error?.code === 'REQUEST_CANCELLED' || error?.code === 'REQUEST_OUTCOME_UNCONFIRMED') throw error;
        throw unknown();
    } finally {
        closed = true; timers.clearTimeout(timer); signal?.removeEventListener('abort', abort);
        controller.abort(); cancelBody();
        if (reader) ignore(() => reader.releaseLock());
    }
}
