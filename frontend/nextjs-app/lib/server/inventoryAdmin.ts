import type { NextApiRequest } from 'next';
import { matchesFinancialInventoryTokenV2 } from '@tenkings/database';
import { requireAdminSession } from './admin';
import { HttpError, type AdminSession } from './adminSessionAuthority';

/** Same mobile admin allowlist as Ten Kings; scoped service keys cannot write stock. */
export function createInventoryAdminSessionRequirement(deps: {
  readTokenHash(): string | undefined;
  requireAdmin(req: NextApiRequest): Promise<AdminSession>;
}) {
  return async (req: NextApiRequest) => {
    if (req.headers['x-operator-key'] !== undefined) {
      throw new HttpError(403, 'Sign in with your Ten Kings admin account.');
    }
    const authorization = req.headers.authorization;
    const token = typeof authorization === 'string' ? /^\s*Bearer\s+([^\s]+)\s*$/i.exec(authorization)?.[1] : null;
    if (!token) throw new HttpError(401, 'Sign in with your Ten Kings admin account.');
    // Normalize the accepted session-header spelling before checking the read capability.
    if (matchesFinancialInventoryTokenV2(`Bearer ${token}`, deps.readTokenHash())) {
      throw new HttpError(403, 'Sign in with your Ten Kings admin account.');
    }
    const session = await deps.requireAdmin(req);
    if ((session.authority !== 'auth-service' && session.authority !== 'local-database') || session.tokenHash === 'operator-key' || session.sessionId.startsWith('operator-key:')) {
      throw new HttpError(403, 'Sign in with your Ten Kings admin account.');
    }
    return session;
  };
}

export const requireInventoryAdminSession = createInventoryAdminSessionRequirement({
  readTokenHash: () => process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256,
  requireAdmin: requireAdminSession,
});
