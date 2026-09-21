import type { NextApiRequest } from 'next';
import { requireAdminSession, type AdminSession } from './admin';
import { HttpError } from './adminSessionAuthority';
import { canPerformSetOpsRole, type SetOpsRole } from './setOps';

export function catalogEvidenceEnabled() { return process.env.SET_CATALOG_EVIDENCE_ENABLED === 'true'; }
export function requireCatalogEnabled() {
  if (!catalogEvidenceEnabled()) throw new HttpError(503, 'Reviewed catalog evidence is not enabled.');
}
export function assertCatalogHuman(actor: AdminSession, role: SetOpsRole) {
  if (!actor || !['local-database', 'auth-service'].includes(actor.authority ?? '') || !actor.user?.id
    || !actor.expiresAt || actor.expiresAt.getTime() <= Date.now()) throw new HttpError(401, 'A current human admin session is required.');
  if (!canPerformSetOpsRole(actor, role)) throw new HttpError(403, `Set Ops ${role} role required.`);
}
export async function requireCatalogHuman(req: NextApiRequest, role: SetOpsRole) {
  if (req.headers['x-operator-key'] !== undefined) throw new HttpError(401, 'Static operator authority cannot review catalog evidence.');
  const actor = await requireAdminSession(req);
  assertCatalogHuman(actor, role);
  requireCatalogEnabled();
  return actor;
}
