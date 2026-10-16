import type { NextApiRequest, NextApiResponse } from 'next';
export const config = { api: { bodyParser: false } };

// The ATLAS public-media bridge was retired. Retain its refusal response for
// historical callers without loading a database, storage client, or request body.
export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(503).json({ error: 'ATLAS_PUBLIC_IMAGE_UNAVAILABLE' });
}
