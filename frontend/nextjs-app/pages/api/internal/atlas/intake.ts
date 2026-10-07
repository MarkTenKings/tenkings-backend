import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@tenkings/database';
import { INTAKE_PATH } from '@atlas/service-bridge/intake';
import { requireBridge } from '@atlas/service-bridge/protocol';
import { atlasIntakeConfig, createAtlasIntake } from '../../../../lib/server/atlasIntake';

export const config = { api: { bodyParser: false }, maxDuration: 20 };
type IntakeHandlerPorts = {
    settings: () => ReturnType<typeof atlasIntakeConfig>;
    receive: (settings: ReturnType<typeof atlasIntakeConfig>, body: string, signature: string) => Promise<unknown>;
};
export function createAtlasIntakeHandler(ports: IntakeHandlerPorts) {
    return async function handler(req: NextApiRequest, res: NextApiResponse) {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            const settings = ports.settings(), host = new URL(settings.origin).host;
            const signature = req.headers['x-atlas-intake-signature'];
            requireBridge(req.method === 'POST' && req.url === INTAKE_PATH && req.headers.host === host
                && (!req.headers['x-forwarded-host'] || req.headers['x-forwarded-host'] === host)
                && req.headers['x-forwarded-proto'] === 'https' && !req.headers.cookie && !req.headers.authorization
                && req.headers['content-type'] === 'application/json' && typeof signature === 'string'
                && /^[a-f0-9]{64}$/.test(signature)
                && (req.headers['content-length'] === undefined || (typeof req.headers['content-length'] === 'string'
                    && /^[0-9]+$/.test(req.headers['content-length']) && Number(req.headers['content-length']) <= 8192)),
            'INTAKE_REQUEST_INVALID');
            let size = 0;
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
                const bytes = Buffer.from(chunk); size += bytes.length;
                requireBridge(size <= 8192, 'INTAKE_REQUEST_INVALID'); chunks.push(bytes);
            }
            const bytes = Buffer.concat(chunks), body = bytes.toString('utf8');
            requireBridge(Buffer.from(body, 'utf8').equals(bytes)
                && (req.headers['content-length'] === undefined || Number(req.headers['content-length']) === size), 'INTAKE_REQUEST_INVALID');
            // The service verifies canonical encoding and HMAC before its transaction.
            const result = await ports.receive(settings, body, signature as string);
            return res.status(200).json(result);
        } catch {
            return res.status(503).json({ error: 'ATLAS_INTAKE_UNAVAILABLE' });
        }
    };
}
export default createAtlasIntakeHandler({ settings: atlasIntakeConfig,
    receive: (settings, body, signature) => createAtlasIntake(prisma, settings).receive(body, signature),
});
