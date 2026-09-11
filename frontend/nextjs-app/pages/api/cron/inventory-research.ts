import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { runStaffInventoryResearchWorker } from '../../../lib/server/staffInventoryResearchWorker';

export const config = { api: { bodyParser: false }, maxDuration: 300 };
export function createInventoryResearchCronHandler(deps: { secret: () => string | undefined; run: typeof runStaffInventoryResearchWorker }) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const secret = deps.secret(), authorization = req.headers.authorization;
    const digest = (text: string) => createHash('sha256').update(text).digest();
    if (!secret || secret.length < 32 || typeof authorization !== 'string' || authorization.length > 1024 || !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) return res.status(401).json({ message: 'Unauthorized.' });
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ message: 'Method not allowed.' }); }
    if (Object.keys(req.query ?? {}).length) return res.status(400).json({ message: 'No parameters are accepted.' });
    try { return res.status(200).json({ ok: true, ...await deps.run() }); }
    catch { return res.status(503).json({ message: 'The research worker could not complete this run.' }); }
  };
}
export default createInventoryResearchCronHandler({ secret: () => process.env.CRON_SECRET, run: runStaffInventoryResearchWorker });
