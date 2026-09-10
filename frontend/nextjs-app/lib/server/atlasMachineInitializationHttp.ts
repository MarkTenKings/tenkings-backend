import type { NextApiRequest, NextApiResponse } from 'next';
import { canonical, requireBridge } from '@atlas/service-bridge/protocol';
import { MACHINE_INITIALIZATION_ADMISSION_PATH, MACHINE_INITIALIZATION_EXECUTION_PATH,
    MACHINE_INITIALIZATION_ADMISSION_SIGNATURE_HEADER, MACHINE_INITIALIZATION_EXECUTION_SIGNATURE_HEADER } from '@atlas/service-bridge/machine-initialize-transport';

/** Named internal purpose only. No staff cookie, arbitrary operation or source
 * identifier is interpreted by this HTTP boundary. Services authenticate MACs.
 */
export function createAtlasMachineInitializationHandler<Config extends { origin: string }>(kind: 'ADMIT' | 'EXECUTE', ports: {
    settings: () => Config;
    receive: (settings: Config, body: string, signature: string, signal: AbortSignal) => Promise<unknown>;
}) {
    return async (req: NextApiRequest, res: NextApiResponse) => {
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableEnded) controller.abort(); };
        req.on('aborted', disconnected); res.on('close', disconnected);
        res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            const settings = ports.settings(), host = new URL(settings.origin).host;
            const path = kind === 'ADMIT' ? MACHINE_INITIALIZATION_ADMISSION_PATH : MACHINE_INITIALIZATION_EXECUTION_PATH;
            const header = kind === 'ADMIT' ? MACHINE_INITIALIZATION_ADMISSION_SIGNATURE_HEADER : MACHINE_INITIALIZATION_EXECUTION_SIGNATURE_HEADER;
            const signature = req.headers[header], length = req.headers['content-length'];
            requireBridge(req.method === 'POST' && req.url === path && req.headers.host === host
                && (!req.headers['x-forwarded-host'] || req.headers['x-forwarded-host'] === host) && req.headers['x-forwarded-proto'] === 'https'
                && !req.headers.cookie && !req.headers.authorization && req.headers['content-type'] === 'application/json'
                && typeof signature === 'string' && /^[a-f0-9]{64}$/.test(signature)
                && (length === undefined || typeof length === 'string' && /^\d+$/.test(length) && Number(length) <= 8192),
            'MACHINE_INITIALIZATION_REQUEST_INVALID');
            let size = 0; const chunks: Buffer[] = [];
            for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length;
                requireBridge(size <= 8192, 'MACHINE_INITIALIZATION_REQUEST_INVALID'); chunks.push(bytes); }
            const bytes = Buffer.concat(chunks), body = bytes.toString('utf8');
            requireBridge(Buffer.from(body, 'utf8').equals(bytes) && (length === undefined || Number(length) === size), 'MACHINE_INITIALIZATION_REQUEST_INVALID');
            controller.signal.throwIfAborted();
            const result = await ports.receive(settings, body, signature as string, controller.signal);
            res.setHeader('Content-Type', 'application/json'); return res.status(200).send(canonical(result));
        } catch { return res.status(503).json({ error: 'ATLAS_MACHINE_INITIALIZATION_UNAVAILABLE' }); }
        finally { req.off('aborted', disconnected); res.off('close', disconnected); }
    };
}
