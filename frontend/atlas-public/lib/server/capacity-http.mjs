import { customerCapacity } from '@atlas/commerce/capacity';
import { publicHeaders } from './policy.mjs';

/** Anonymous read: explicit aggregate allowlist; no query parameters or writes. */
export function capacityHandler(resolve) {
    return async (req, res) => {
        publicHeaders(res); res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return res.status(405).end(); }
        if (Object.keys(req.query ?? {}).length) return res.status(400).json({ error: 'INVALID_REQUEST' });
        try {
            const value = customerCapacity(await resolve(req).weeklyCapacity());
            return req.method === 'HEAD' ? res.status(200).end() : res.status(200).json(value);
        } catch {
            return req.method === 'HEAD' ? res.status(503).end() : res.status(503).json({ error: 'WEEKLY_CAPACITY_UNAVAILABLE' });
        }
    };
}
