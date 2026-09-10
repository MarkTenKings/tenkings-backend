import type { NextApiRequest } from 'next';
import { createPhysicalInventoryWriteHandlerV2, recordCardInventoryEventV2, prisma } from '@tenkings/database';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';

export const config = { api: { bodyParser: { sizeLimit: '64kb' }, responseLimit: '128kb' } };

export default createPhysicalInventoryWriteHandlerV2({
  requireAdmin: (req) => requireInventoryAdminSession(req as NextApiRequest),
  readTokenHash: () => process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256,
  record: (input, adminId) => prisma.$transaction(
    (tx) => recordCardInventoryEventV2(tx, input, adminId),
    { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 },
  ),
});
