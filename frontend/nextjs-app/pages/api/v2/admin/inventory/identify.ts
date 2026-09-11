import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma, acquireStaffInventoryIntakeLeaseV2, releaseStaffInventoryIntakeLeaseV2 } from '@tenkings/database';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';
import { StaffInventoryIdentificationRequestSchema } from '../../../../../lib/staffInventoryIdentification';
import { identifyStaffInventoryCard, StaffInventoryIdentificationError } from '../../../../../lib/server/staffInventoryIdentification';

export const config = { api: { bodyParser: { sizeLimit: '2kb' } }, maxDuration: 45 };

export function createStaffInventoryIdentificationHandler(deps: {
  requireAdmin: typeof requireInventoryAdminSession;
  identify: typeof identifyStaffInventoryCard;
  acquireCapacity?: () => Promise<string>;
  releaseCapacity?: (leaseId: string) => Promise<void>;
}) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const controller = new AbortController();
    let capacityLease: string | undefined;
    const abort = () => controller.abort();
    const closed = () => { if (!res.writableEnded) abort(); };
    req.once?.('aborted', abort);
    res.once?.('close', closed);
    try {
      await deps.requireAdmin(req);
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ message: 'Method not allowed.' }); }
      const parsed = StaffInventoryIdentificationRequestSchema.safeParse(req.body);
      if (!parsed.success || Object.keys(req.query ?? {}).length !== 0) throw new StaffInventoryIdentificationError('invalid_input');
      // Intake stays available if the optional background-capacity service is
      // unavailable; expired leases recover without staff intervention.
      try { capacityLease = await deps.acquireCapacity?.(); } catch { /* Intake has priority. */ }
      const result = await deps.identify(parsed.data, {}, controller.signal);
      if (!controller.signal.aborted) return res.status(200).json(result);
    } catch (error) {
      if (controller.signal.aborted) return;
      const authStatus = error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : null;
      if (authStatus) return res.status(authStatus).json({ message: 'Sign in with your Ten Kings admin account.' });
      const safe = error instanceof StaffInventoryIdentificationError ? error : new StaffInventoryIdentificationError('provider_error');
      const status = safe.code === 'invalid_input' || safe.code === 'unverified_photo' ? 400 : safe.code === 'timeout' ? 504 : safe.code === 'unavailable' ? 503 : 502;
      return res.status(status).json({ code: safe.code, message: safe.message });
    } finally {
      if (capacityLease) { try { await deps.releaseCapacity?.(capacityLease); } catch { /* The bounded lease expires. */ } }
      req.removeListener?.('aborted', abort);
      res.removeListener?.('close', closed);
    }
  };
}

export default createStaffInventoryIdentificationHandler({
  requireAdmin: requireInventoryAdminSession, identify: identifyStaffInventoryCard,
  acquireCapacity: async () => (await prisma.$transaction(tx => acquireStaffInventoryIntakeLeaseV2(tx), { maxWait: 1000, timeout: 1500 })).leaseId,
  releaseCapacity: async leaseId => { await prisma.$transaction(tx => releaseStaffInventoryIntakeLeaseV2(tx, leaseId), { maxWait: 1000, timeout: 1500 }); },
});
