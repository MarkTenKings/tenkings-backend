import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@tenkings/database';
import { BRIDGE_PATH, requireBridge, verifyRequest } from '@atlas/service-bridge/protocol';
import { atlasGradingBridgeConfig, createAtlasGradingBridge } from '../../../../lib/server/atlasGradingBridge';

export const config = { api: { bodyParser: false }, maxDuration: 240 };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
        const settings = atlasGradingBridgeConfig();
        const host = new URL(settings.origin).host;
        requireBridge(req.method === 'POST' && req.url === BRIDGE_PATH && req.headers.host === host
            && (!req.headers['x-forwarded-host'] || req.headers['x-forwarded-host'] === host)
            && req.headers['x-forwarded-proto'] === 'https' && !req.headers.cookie && !req.headers.authorization
            && req.headers['content-type'] === 'application/json', 'BRIDGE_REQUEST_INVALID');
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) {
            size += chunk.length; requireBridge(size <= 16_384, 'BRIDGE_REQUEST_INVALID'); chunks.push(Buffer.from(chunk));
        }
        const packet = verifyRequest(settings, Buffer.concat(chunks).toString('utf8'), req.headers['x-atlas-signature']);
        const bridge = createAtlasGradingBridge(prisma, settings);
        if (packet.payload.action === 'READ_EVIDENCE') {
            const result = await bridge.readEvidence(packet.claims, packet.payload.side);
            res.setHeader('Content-Type', result.contentType); return res.status(200).send(result.bytes);
        }
        requireBridge(packet.payload.action === 'RUN_REVIEW', 'BRIDGE_REQUEST_INVALID');
        return res.status(200).json(await bridge.run(packet.claims, packet.payload.operationId));
    } catch {
        return res.status(503).json({ error: 'ATLAS_BRIDGE_UNAVAILABLE' });
    }
}
