import type { NextApiRequest } from 'next';
import { createInventoryWorkflowAdminHandlerV2, readWorkflowWorkspaceV2, recordInventoryWorkflowEventV2, prisma } from '@tenkings/database';
import { requireAdminSession } from '../../../../../lib/server/admin';
export const config = { api: { bodyParser: { sizeLimit: '1mb' }, responseLimit: '10mb' } };
export default createInventoryWorkflowAdminHandlerV2({
  requireAdmin: req => requireAdminSession(req as NextApiRequest),
  tokenHash: () => process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256,
  read: input => prisma.$transaction(async tx => ({ ...await readWorkflowWorkspaceV2(tx, input), locations: await tx.location.findMany({ select: { id: true, name: true, slug: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }) }), { isolationLevel: 'RepeatableRead', timeout: 30000 }),
  record: (input, adminId, preview) => prisma.$transaction(tx => recordInventoryWorkflowEventV2(tx, input, adminId, { preview }), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 }),
});
