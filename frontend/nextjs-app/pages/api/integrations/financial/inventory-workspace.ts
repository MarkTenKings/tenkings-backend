import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma, readWorkflowHistoryV2, staffInventoryWorkspaceV2, matchesFinancialInventoryTokenV2, type StaffInventoryWorkspace } from '@tenkings/database';

export const config = { api: { bodyParser: false, responseLimit: '10mb' } };
/** Read-only operational snapshot. No user session, bank row or financial write capability. */
export function createFinancialInventoryWorkspaceHandler(deps: {
  readTokenHash(): string | undefined;
  readWorkspace(): Promise<StaffInventoryWorkspace>;
}) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!matchesFinancialInventoryTokenV2(req.headers.authorization, deps.readTokenHash())) return res.status(401).json({ message: 'Unauthorized' });
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ message: 'Read only' }); }
    if (Object.keys(req.query).length) return res.status(400).json({ message: 'No query parameters supported' });
    try {
      const view = await deps.readWorkspace();
      // Keep the existing snapshot wire shape; full descriptions remain in the immutable journal.
      const snapshot = { version: view.version, sequence: view.sequence, updated_at: view.updated_at, totals: view.totals, locations: view.locations, items: view.items.map((privateItem: StaffInventoryWorkspace['items'][number] & { photo_url?: string | null; back_photo_url?: string | null }) => {
        const { units: _units, unit_ids: _unitIds, photo_key: _photoKey, back_photo_key: _backPhotoKey, photo_url: _photoUrl, back_photo_url: _backPhotoUrl, card_details: _cardDetails, planned_sales_channel: _plannedSalesChannel, ...item } = privateItem;
        return item;
      }) };
      if (Buffer.byteLength(JSON.stringify(snapshot)) > 10 * 1024 * 1024) return res.status(503).json({ message: 'Inventory snapshot exceeds the read limit.' });
      return res.status(200).json(snapshot);
    } catch { return res.status(503).json({ message: 'Inventory snapshot could not be verified.' }); }
  };
}

export default createFinancialInventoryWorkspaceHandler({
  readTokenHash: () => process.env.FINANCIAL_INVENTORY_READ_TOKEN_SHA256,
  readWorkspace: () => prisma.$transaction(async tx => staffInventoryWorkspaceV2(await readWorkflowHistoryV2(tx), await tx.location.findMany({ select: { id: true, name: true, slug: true, address: true, locationType: true }, orderBy: { name: 'asc' } })), { isolationLevel: 'RepeatableRead', timeout: 30000 }),
});
