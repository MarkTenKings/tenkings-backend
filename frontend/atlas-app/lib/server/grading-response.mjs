import { GRADING_STREAM_HEADER, GRADING_STREAM_PROTOCOL } from '../grading-response.mjs';

const HEARTBEAT_MS = 15_000, MAX_HEARTBEATS = 16;

/** Starts only after a grading dispatch reservation commits. The handler still
 * awaits the original worker and durable result; a closed socket stops only
 * transport writes, never the mutation or its existing recovery checks. */
export function createGradingResponse(res, timers = globalThis) {
    let started = false, closed = false, interval, heartbeats = 0;
    const stop = () => { if (interval !== undefined) timers.clearInterval(interval); interval = undefined; };
    const close = () => {
        closed = true; stop();
        res.removeListener('close', close); res.removeListener('finish', close); res.removeListener('error', close);
    };
    const unavailable = () => closed || res.destroyed || res.writableEnded;
    const heartbeat = () => {
        if (unavailable()) { close(); return; }
        try {
            res.write('\n');
            res.flush?.();
        } catch { close(); }
    };
    const start = () => {
        if (started) return;
        started = true;
        res.once('close', close); res.once('finish', close); res.once('error', close);
        if (unavailable()) { close(); return; }
        try {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader(GRADING_STREAM_HEADER, GRADING_STREAM_PROTOCOL);
            // Next's compression layer honors no-transform; buffering would
            // otherwise hide the heartbeat from the external path router.
            res.setHeader('Cache-Control', 'private, no-store, max-age=0, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            heartbeat();
            if (!closed) {
                interval = timers.setInterval(() => {
                    heartbeat();
                    if (++heartbeats >= MAX_HEARTBEATS) stop();
                }, HEARTBEAT_MS);
                interval.unref?.();
            }
        } catch { close(); }
    };
    const finish = (status, body) => {
        // Serialize first so an unexpected payload failure can still be mapped
        // by the handler to a bounded terminal error on the same stream.
        const payload = JSON.stringify({ protocol: GRADING_STREAM_PROTOCOL, status, body });
        stop();
        if (unavailable()) { close(); return; }
        try { res.end(payload); } catch { close(); }
    };
    return { get started() { return started; }, start, finish, stop };
}
