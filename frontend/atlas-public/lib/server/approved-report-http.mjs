import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { digest, publicHeaders } from './policy.mjs';
import { runtime } from './runtime.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const route = /^\/api\/reports\/(ar_[A-Za-z0-9_-]{24})\?v=([1-9][0-9]{0,9})$/;
const pins = req => JSON.stringify([req.method, req.url, Object.entries(req.headers ?? {}).sort(([a], [b]) => a.localeCompare(b)), req.socket?.remoteAddress]);

/** The same saved public packet already embedded in the report page, with an
 * exact version and no optional presentation, explanation or private fields.
 * resolveReader performs the existing public ingress admission. No publication,
 * grading, database or provider capability is added by this endpoint. */
export function approvedReportHandler(resolveReader = runtime) {
    return async (req, res) => {
        publicHeaders(res);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!['GET', 'HEAD'].includes(req.method)) {
            res.setHeader('Allow', 'GET, HEAD'); return res.status(405).end();
        }
        const match = typeof req.url === 'string' && route.exec(req.url);
        if (!match || Number(match[2]) > 2147483647 || req.headers?.['transfer-encoding'] !== undefined
            || ![undefined, '0'].includes(req.headers?.['content-length'])) return res.status(404).end();
        try {
            const reader = resolveReader(req), read = reader?.read, admitted = pins(req);
            if (typeof read !== 'function') throw new Error();
            const selector = { token: match[1], version: Number(match[2]) };
            const value = await read.call(reader, selector);
            if (req.aborted || pins(req) !== admitted || reader.read !== read) throw new Error();
            if (!value) return res.status(404).end();
            const packet = parsePublicManualReport(value.packet);
            if (packet.publicToken !== selector.token || packet.approvalVersion !== selector.version
                || digest(JSON.stringify(packet)) !== value.publicHash) throw new Error();
            const bytes = Buffer.from(JSON.stringify({ packet, publicHash: value.publicHash }));
            if (bytes.length > MAX_BYTES) throw new Error();
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Length', String(bytes.length));
            return req.method === 'HEAD' ? res.status(200).end() : res.status(200).send(bytes);
        } catch { return res.status(503).end(); }
    };
}
