import type { NextApiRequest, NextApiResponse } from 'next';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';

export function createStaffInventoryAccessHandler(requireAdmin: typeof requireInventoryAdminSession) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      const session = await requireAdmin(req);
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ message: 'Method not allowed.' }); }
      if (Object.keys(req.query).length) return res.status(400).json({ message: 'No parameters accepted.' });
      return res.status(200).json({ user: { id: session.user.id, displayName: session.user.displayName } });
    } catch (error) {
      const status = error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : 503;
      return res.status(status).json({ message: status === 503 ? 'Staff access could not be checked.' : 'Sign in with your authorized Ten Kings account.' });
    }
  };
}
export default createStaffInventoryAccessHandler(requireInventoryAdminSession);
