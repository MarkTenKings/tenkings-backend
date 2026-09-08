import { publicHeaders, reportSelector } from './policy.mjs';
import { runtime } from './runtime.mjs';

export function approvedMediaHandler(kind) {
    return async function handler(req, res) {
        publicHeaders(res);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!['GET', 'HEAD'].includes(req.method)) {
            res.setHeader('Allow', 'GET, HEAD'); return res.status(405).end();
        }
        let selector;
        try {
            selector = reportSelector(req.query.token, req.query.v);
            if (selector.version === null) throw new Error();
            if (kind === 'image') {
                if (!['FRONT', 'BACK'].includes(req.query.side)) throw new Error();
                selector.side = req.query.side;
            } else {
                if (typeof req.query.findingId !== 'string' || !req.query.findingId.length || req.query.findingId.length > 180) throw new Error();
                selector.findingId = req.query.findingId;
            }
        } catch { return res.status(404).end(); }
        try {
            const reader = runtime(req);
            if (kind === 'image') {
                const result = req.method === 'HEAD' ? await reader.imageDescriptor(selector) : await reader.image(selector);
                if (!result) return res.status(404).end();
                res.setHeader('Content-Type', result.contentType ?? result.descriptor.contentType);
                res.setHeader('Content-Length', result.bytes?.length ?? result.descriptor.byteCount);
                res.setHeader('Content-Disposition', 'inline');
                return req.method === 'HEAD' ? res.status(200).end() : res.status(200).send(result.bytes);
            }
            const result = await reader.trace(selector);
            if (!result) return res.status(404).end();
            return req.method === 'HEAD' ? res.status(200).end() : res.status(200).json(result);
        } catch { return res.status(503).end(); }
    };
}
