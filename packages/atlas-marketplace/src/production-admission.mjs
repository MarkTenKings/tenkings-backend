import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { requireValue } from './contract.mjs';

/** Process-local admission bounds supplement the canonical session gateway.
 * No header can choose the principal, bypass the global limit or evict a live
 * bucket. Counts never stand in for authentication or durable C0 authority. */
export function createProductionAdmission(assertReady) {
    requireValue(typeof assertReady === 'function', 'PRODUCTION_ADMISSION_REQUIRED');
    const buckets = new Map(); let window = -1, total = 0, publicCount = 0, closed = false;
    function current() {
        requireValue(!closed && assertReady() === true, 'PRODUCTION_ADMISSION_CLOSED');
        const now = Math.floor(performance.now() / 60000);
        if (now !== window) { window = now; total = 0; publicCount = 0; buckets.clear(); }
        return total < 1200;
    }
    return Object.freeze({
        async admitPublicRequest(input) {
            if (!current() || !['GET', 'HEAD'].includes(input?.method) || input.path !== '/marketplace/catalog'
                || !Number.isInteger(input.queryLength) || input.queryLength < 0 || input.queryLength > 4096 || publicCount >= 600) return false;
            total++; publicCount++; return true;
        },
        async admitRequest(input) {
            if (!current() || !/^r1_[a-f0-9]{64}$/.test(input?.sessionId ?? '')
                || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input?.actorId ?? '')
                || !['STAFF', 'BUYER', 'SELLER'].includes(input.role) || !['GET', 'POST'].includes(input.method)
                || typeof input.originalTarget !== 'string' || input.originalTarget.length > 8192) return false;
            const key = createHash('sha256').update(input.role + ':' + input.sessionId).digest('hex');
            if (!buckets.has(key) && buckets.size >= 1000 || (buckets.get(key) ?? 0) >= 120) return false;
            buckets.set(key, (buckets.get(key) ?? 0) + 1); total++; return true;
        },
        close() { closed = true; buckets.clear(); },
    });
}
