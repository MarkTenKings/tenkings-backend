import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';
import { HttpError } from '../../../../../lib/server/adminSessionAuthority';
import { providerQualificationPreviewHost } from '../../../../../lib/staffResearchQualificationHost';
import {
  EXACT_INPUT_ACK, exactInputQualificationPlan, runExactInputQualification, recoverExactInputQualification,
} from '../../../../../lib/server/staffResearchExactInputQualification';

// The engine keeps its existing 150-second bound; storage/read-only preflight and
// recovery share a finite invocation budget. Cancellation stops paid admission
// and closes owned provider/storage streams; it never schedules another attempt.
export const config = { api: { bodyParser: { sizeLimit: '2kb' }, responseLimit: '1mb' }, maxDuration: 180 };
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const recovery = z.object({ invocation_id: z.string().uuid(), plan_sha256: hash }).strict();
const command = recovery.extend({ acknowledge: z.literal(EXACT_INPUT_ACK) }).strict();
export function exactInputQualificationHost(host: string | undefined, env: Record<string, string | undefined>) {
  return Boolean(host && host === providerQualificationPreviewHost(env))
    || env.NODE_ENV === 'test' && /^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host ?? '');
}
export function createExactInputQualificationHandler(deps: {
  requireAdmin: typeof requireInventoryAdminSession; env(): Record<string, string | undefined>;
  plan: typeof exactInputQualificationPlan; run: typeof runExactInputQualification; recover: typeof recoverExactInputQualification; now?: () => number;
}) {
  // Local overlap protection only. This is neither an atomic claim nor an account quota.
  const active = new Set<string>();
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const send = (value: unknown) => {
      if (Buffer.byteLength(JSON.stringify(value)) > 800 * 1024) throw Error('Response exceeds the private metadata bound.');
      return res.status(200).json(value);
    };
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const actor = await deps.requireAdmin(req), env = deps.env();
      if (!['auth-service', 'local-database'].includes(actor.authority ?? '') || !actor.user.id || !actor.expiresAt
        || !Number.isFinite(actor.expiresAt.getTime()) || actor.expiresAt.getTime() <= (deps.now ?? Date.now)()) throw new HttpError(401, 'Current human session required.');
      if (!exactInputQualificationHost(req.headers.host, env)) return res.status(404).json({ message: 'Not found' });
      if (req.method === 'GET') {
        if (!Object.keys(req.query).length) return send(await deps.plan(env));
        const parsed = recovery.safeParse(req.query);
        if (!parsed.success) return res.status(400).json({ message: 'Use the exact saved invocation and plan identifiers.' });
        // Recovery remains read-only and available with execution disabled or a changed configuration.
        return send(await deps.recover(actor.user.id, parsed.data.plan_sha256, parsed.data.invocation_id));
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ message: 'Method not allowed' }); }
      if (Object.keys(req.query).length) return res.status(400).json({ message: 'Query parameters are not accepted for execution.' });
      if (env.STAFF_RESEARCH_EXACT_INPUT_QUALIFICATION_ENABLED !== 'true') return res.status(503).json({ message: 'Exact-input qualification is disabled.' });
      const origin = `${env.NODE_ENV === 'production' ? 'https' : 'http'}://${req.headers.host}`;
      if (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return res.status(403).json({ message: 'Use the signed-in qualification page on this site.' });
      const parsed = command.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: 'Review and acknowledge the current exact-input plan.' });
      const key = actor.user.id;
      if (active.size || active.has(key)) return res.status(409).json({ message: 'An invocation is already active in this process. Recover its receipt; do not submit another run.' });
      active.add(key);
      const disconnected = new AbortController(), abort = () => disconnected.abort();
      const closed = () => { if (!res.writableEnded) abort(); };
      req.once?.('aborted', abort); res.once?.('close', closed);
      try { return send(await deps.run(actor.user.id, parsed.data.plan_sha256, parsed.data.invocation_id, env, undefined, disconnected.signal)); }
      finally { active.delete(key); req.off?.('aborted', abort); res.off?.('close', closed); }
    } catch (error) {
      const status = error instanceof HttpError && [401, 403].includes(error.statusCode) ? error.statusCode : 503;
      return res.status(status).json({ message: status === 401 ? 'Sign in with your Ten Kings admin account.' : status === 403 ? 'Human inventory admin access is required.'
        : 'The diagnostic response is unavailable. Preserve the invocation and recover its receipt. Do not automatically retry.' });
    }
  };
}
export default createExactInputQualificationHandler({ requireAdmin: requireInventoryAdminSession, env: () => process.env,
  plan: exactInputQualificationPlan, run: runExactInputQualification, recover: recoverExactInputQualification });
