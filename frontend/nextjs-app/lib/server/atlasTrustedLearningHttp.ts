import type { NextApiRequest, NextApiResponse } from 'next';
import { LEARNING_PATH } from '@atlas/service-bridge/trusted-learning';
import { canonical, requireBridge } from '@atlas/service-bridge/protocol';

export function createAtlasTrustedLearningHandler<Settings extends { origin: string }>(ports: {
    settings: () => Settings;
    receive: (settings: Settings, body: string, signature: string) => Promise<unknown>;
}) {
    return async (req: NextApiRequest, res: NextApiResponse) => {
        res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            const settings = ports.settings(), host = new URL(settings.origin).host;
            const signature = req.headers['x-atlas-learning-signature'], length = req.headers['content-length'];
            requireBridge(req.method === 'POST' && req.url === LEARNING_PATH && req.headers.host === host
                && (!req.headers['x-forwarded-host'] || req.headers['x-forwarded-host'] === host) && req.headers['x-forwarded-proto'] === 'https'
                && !req.headers.cookie && !req.headers.authorization && req.headers['content-type'] === 'application/json'
                && typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature)
                && (length === undefined || typeof length === 'string' && /^\d+$/.test(length) && Number(length) <= 8192), 'LEARNING_REQUEST_INVALID');
            const chunks: Buffer[] = []; let size = 0;
            for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length;
                requireBridge(size <= 8192, 'LEARNING_REQUEST_INVALID'); chunks.push(bytes); }
            const bytes = Buffer.concat(chunks), body = bytes.toString('utf8');
            requireBridge(!req.aborted && Buffer.from(body, 'utf8').equals(bytes) && (length === undefined || Number(length) === size)
                && canonical(JSON.parse(body)) === body, 'LEARNING_REQUEST_INVALID');
            // MAC, purpose, freshness and all durable human/source checks run in
            // the shared receipt service before returning its safe projection.
            const result = canonical(await ports.receive(settings, body, signature as string));
            requireBridge(Buffer.byteLength(result) <= 131072, 'LEARNING_RESPONSE_INVALID');
            res.setHeader('Content-Type', 'application/json'); return res.status(200).send(result);
        } catch { return res.status(503).json({ error: 'ATLAS_TRUSTED_LEARNING_UNAVAILABLE' }); }
    };
}
