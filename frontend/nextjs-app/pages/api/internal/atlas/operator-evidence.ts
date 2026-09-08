import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@tenkings/database';
import { OPERATOR_EVIDENCE_PATH, verifyOperatorEvidenceRequest } from '@atlas/service-bridge/operator-evidence';
import { requireBridge } from '@atlas/service-bridge/protocol';
import { atlasOperatorEvidenceConfig, createAtlasOperatorEvidence } from '../../../../lib/server/atlasOperatorEvidence';
export const config = { api: { bodyParser: false }, maxDuration: 40 };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
        const settings = atlasOperatorEvidenceConfig(), host = new URL(settings.origin).host;
        requireBridge(req.method === 'POST' && req.url === OPERATOR_EVIDENCE_PATH && req.headers.host === host
            && (!req.headers['x-forwarded-host'] || req.headers['x-forwarded-host'] === host) && req.headers['x-forwarded-proto'] === 'https'
            && !req.headers.cookie && !req.headers.authorization && req.headers['content-type'] === 'application/json');
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; requireBridge(size <= 8192); chunks.push(Buffer.from(chunk)); }
        const claims = verifyOperatorEvidenceRequest(settings, Buffer.concat(chunks).toString('utf8'), req.headers['x-atlas-operator-evidence-signature']);
        const result = await createAtlasOperatorEvidence(prisma, settings).read(claims);
        res.setHeader('Content-Type', 'application/json'); res.setHeader('x-atlas-operator-evidence-signature', result.signature);
        return res.status(200).send(result.text);
    } catch { return res.status(503).json({ error: 'ATLAS_OPERATOR_EVIDENCE_UNAVAILABLE' }); }
}
