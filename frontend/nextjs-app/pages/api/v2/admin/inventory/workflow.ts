import type { NextApiRequest } from 'next';
import { createInventoryWorkflowAdminHandlerV2, readWorkflowWorkspaceV2, recordInventoryWorkflowEventV2, prisma, WorkflowCommandInputV2, CardInventoryErrorV2 } from '@tenkings/database';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';
import { verifyInventoryPhoto } from '../../../../../lib/server/inventoryPhoto';
export const config = { api: { bodyParser: { sizeLimit: '1mb' }, responseLimit: '10mb' } };

export function createInventoryWorkflowRoute(deps: Parameters<typeof createInventoryWorkflowAdminHandlerV2>[0] & { verifyPhoto: typeof verifyInventoryPhoto }) {
  return createInventoryWorkflowAdminHandlerV2({
    ...deps,
    record: async (input, adminId, preview) => {
      const parsed = WorkflowCommandInputV2.safeParse(input);
      if (parsed.success && parsed.data.event_kind === 'item_described' && parsed.data.data.description.photo_key && !await deps.verifyPhoto(parsed.data.data.description.photo_key)) {
        throw new CardInventoryErrorV2('INVALID_INPUT', 'Upload the inventory photo again before saving.');
      }
      return deps.record(input, adminId, preview);
    },
  });
}

export default createInventoryWorkflowRoute({
  requireAdmin: req => requireInventoryAdminSession(req as NextApiRequest),
  tokenHash: () => process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256,
  verifyPhoto: verifyInventoryPhoto,
  read: input => prisma.$transaction(async tx => ({ ...await readWorkflowWorkspaceV2(tx, input), locations: await tx.location.findMany({ select: { id: true, name: true, slug: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }) }), { isolationLevel: 'RepeatableRead', timeout: 30000 }),
  record: (input, adminId, preview) => prisma.$transaction(tx => recordInventoryWorkflowEventV2(tx, input, adminId, { preview }), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 }),
});
