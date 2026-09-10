import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma, readWorkflowHistoryV2, staffInventoryWorkspaceV2, recordStaffInventoryV2, StaffInventoryCommandV2, CardInventoryErrorV2, type StaffInventoryWorkspace } from '@tenkings/database';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';
import { presignReadUrl } from '../../../../../lib/server/storage';
import { inventoryDescriptionPhotoKeys, verifyInventoryPhoto } from '../../../../../lib/server/inventoryPhoto';

export const config = { api: { bodyParser: { sizeLimit: '1mb' }, responseLimit: '10mb' } };
const MAX_WORKSPACE_BYTES = 10 * 1024 * 1024;

export function createStaffInventoryWorkspaceHandler(deps: {
  requireAdmin: typeof requireInventoryAdminSession;
  readWorkspace(): Promise<StaffInventoryWorkspace>;
  signPhoto(key: string): Promise<string>;
  verifyPhoto(key: string): Promise<boolean>;
  record(command: Parameters<typeof recordStaffInventoryV2>[1], adminId: string): ReturnType<typeof recordStaffInventoryV2>;
}) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      const admin = await deps.requireAdmin(req);
      if (req.method === 'GET') {
        if (Object.keys(req.query).length) return res.status(400).json({ message: 'No query parameters supported.' });
        const workspace = await deps.readWorkspace();
        if (Buffer.byteLength(JSON.stringify(workspace)) > MAX_WORKSPACE_BYTES) return res.status(503).json({ message: 'Inventory exceeds the workspace read limit.' });
        const photoKeys = [...new Set(workspace.items.flatMap(inventoryDescriptionPhotoKeys))];
        const photos = new Map<string, string>();
        // Upload, save and identification verify bytes. Refreshes only sign the
        // persisted references, so an unavailable photo cannot hide inventory.
        for (let offset = 0; offset < photoKeys.length; offset += 12) {
          for (const [key, url] of await Promise.all(photoKeys.slice(offset, offset + 12).map(async key => [key, await deps.signPhoto(key)] as const))) photos.set(key, url);
        }
        const result = { ...workspace, items: workspace.items.map(i => ({ ...i, photo_url: i.photo_key ? photos.get(i.photo_key) : null, back_photo_url: i.back_photo_key ? photos.get(i.back_photo_key) : null })) };
        if (Buffer.byteLength(JSON.stringify(result)) > MAX_WORKSPACE_BYTES) return res.status(503).json({ message: 'Inventory exceeds the workspace read limit.' });
        return res.status(200).json(result);
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ message: 'Method not allowed' }); }
      const parsed = StaffInventoryCommandV2.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Invalid inventory entry.' });
      const command = parsed.data;
      if ('description' in command) for (const key of inventoryDescriptionPhotoKeys(command.description)) {
        if (!await deps.verifyPhoto(key)) return res.status(400).json({ message: 'Upload the inventory photo again before saving.' });
      }
      return res.status(200).json(await deps.record(command, admin.user.id));
    } catch (error) {
      const status = error instanceof CardInventoryErrorV2 ? error.code === 'INVALID_INPUT' ? 400 : error.code === 'CONFLICT' ? 409 : 503
        : error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : 503;
      return res.status(status).json({ message: status < 500 && error instanceof Error ? error.message : 'Inventory could not be loaded or saved. Your entry is preserved; please retry.' });
    }
  };
}

export default createStaffInventoryWorkspaceHandler({
  requireAdmin: requireInventoryAdminSession,
  readWorkspace: () => prisma.$transaction(async tx => staffInventoryWorkspaceV2(await readWorkflowHistoryV2(tx), await tx.location.findMany({ select: { id: true, name: true, slug: true, address: true, locationType: true, latitude: true, longitude: true, geofenceRadiusM: true }, orderBy: { name: 'asc' } })), { isolationLevel: 'RepeatableRead', timeout: 30000 }),
  signPhoto: presignReadUrl,
  verifyPhoto: verifyInventoryPhoto,
  record: (command, adminId) => prisma.$transaction(tx => recordStaffInventoryV2(tx, command, adminId), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 }),
});
