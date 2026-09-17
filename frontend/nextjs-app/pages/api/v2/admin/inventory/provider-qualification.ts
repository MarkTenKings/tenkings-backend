import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';
import { HttpError } from '../../../../../lib/server/adminSessionAuthority';
import {
  PROVIDER_QUALIFICATION_ACK, PROVIDER_QUALIFICATION_PLAN, PROVIDER_QUALIFICATION_PLAN_HASH,
  providerQualificationHost, qualifyStaffResearchProvider,
} from '../../../../../lib/server/staffResearchProviderQualification';

export const config = { api: { bodyParser: { sizeLimit: '2kb' }, responseLimit: '256kb' }, maxDuration: 60 };
const command = z.object({
  cohort: z.enum(['sports_anniversary', 'pokemon', 'sports_parallel', 'active_control']),
  plan_sha256: z.literal(PROVIDER_QUALIFICATION_PLAN_HASH), acknowledge: z.literal(PROVIDER_QUALIFICATION_ACK),
}).strict();

export function createProviderQualificationHandler(deps: {
  requireAdmin: typeof requireInventoryAdminSession; env(): Record<string, string | undefined>;
  run: typeof qualifyStaffResearchProvider; now?: () => number;
}) {
  // Convenience overlap protection only, not a cross-instance/account quota.
  let active = false, nextAllowed = 0;
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const actor = await deps.requireAdmin(req), env = deps.env(), now = deps.now ?? Date.now;
      if (!['auth-service', 'local-database'].includes(actor.authority ?? '') || !actor.user.id || !actor.expiresAt || !Number.isFinite(actor.expiresAt.getTime()) || actor.expiresAt.getTime() <= now()) throw new HttpError(401, 'A current human admin session is required.');
      if (!providerQualificationHost(req.headers.host, env.NODE_ENV === 'production', env)) return res.status(404).json({ message: 'Not found' });
      if (Object.keys(req.query).length) return res.status(400).json({ message: 'Query parameters are not accepted.' });
      const enabled = env.STAFF_RESEARCH_PROVIDER_QUALIFICATION_ENABLED === 'true';
      if (req.method === 'GET') return res.status(200).json({ plan: PROVIDER_QUALIFICATION_PLAN, plan_sha256: PROVIDER_QUALIFICATION_PLAN_HASH, acknowledge: PROVIDER_QUALIFICATION_ACK, enabled });
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ message: 'Method not allowed' }); }
      if (!enabled) return res.status(503).json({ message: 'Provider qualification is disabled.' });
      const origin = `${env.NODE_ENV === 'production' ? 'https' : 'http'}://${req.headers.host}`;
      if (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return res.status(403).json({ message: 'Use the signed-in qualification page on this site.' });
      const parsed = command.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: 'Review the current fixed plan and acknowledge one cohort.' });
      if (!env.SOLDCOMPS_API_KEY?.trim()) return res.status(503).json({ message: 'Provider qualification is unavailable.' });
      if (active || now() < nextAllowed) { res.setHeader('Retry-After', '60'); return res.status(429).json({ message: 'A provider check is running or cooling down. Wait before another deliberate check.' }); }
      active = true;
      try { return res.status(200).json(await deps.run(parsed.data.cohort, { apiKey: env.SOLDCOMPS_API_KEY })); }
      finally { active = false; nextAllowed = now() + 60000; }
    } catch (error) {
      const code = error instanceof HttpError && [401, 403].includes(error.statusCode) ? error.statusCode : 503;
      return res.status(code).json({ message: code === 401 ? 'Sign in with your Ten Kings admin account.' : code === 403 ? 'Human inventory admin access is required.' : 'The bounded provider check could not complete.' });
    }
  };
}
export default createProviderQualificationHandler({ requireAdmin: requireInventoryAdminSession, env: () => process.env, run: qualifyStaffResearchProvider });
