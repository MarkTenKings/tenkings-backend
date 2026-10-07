import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@tenkings/database';
import { MEDIA_PATH, verifyPublicMediaRequest } from '@atlas/service-bridge/public-media';
import { requireBridge } from '@atlas/service-bridge/protocol';
import { atlasPublicMediaConfig, createAtlasPublicMedia } from '../../../../lib/server/atlasPublicMedia';
export const config = { api: { bodyParser: false }, maxDuration: 40 };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
        const settings = atlasPublicMediaConfig(), host = new URL(settings.origin).host;
        requireBridge(req.method === 'POST' && req.url === MEDIA_PATH && req.headers.host === host
            && (!req.headers['x-forwarded-host'] || req.headers['x-forwarded-host'] === host) && req.headers['x-forwarded-proto'] === 'https'
            && !req.headers.cookie && !req.headers.authorization && req.headers['content-type'] === 'application/json');
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; requireBridge(size <= 4096); chunks.push(Buffer.from(chunk)); }
        const claims = verifyPublicMediaRequest(settings, Buffer.concat(chunks).toString('utf8'), req.headers['x-atlas-public-media-signature']);
        const image = await createAtlasPublicMedia(prisma, settings).read(claims);
        res.setHeader('Content-Type', image.contentType); return res.status(200).send(image.bytes);
    } catch { return res.status(503).json({ error: 'ATLAS_PUBLIC_IMAGE_UNAVAILABLE' }); }
}
