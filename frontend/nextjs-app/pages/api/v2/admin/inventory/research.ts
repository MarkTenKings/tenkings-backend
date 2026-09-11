import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma, CardInventoryErrorV2, readStaffInventoryResearchV2, retryStaffInventoryResearchV2, startStaffInventoryResearchV2, StaffInventoryResearchRetryV2, StaffInventoryResearchStartV2, type StaffInventoryResearchStatusV2 } from '@tenkings/database';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';
import { presignReadUrl } from '../../../../../lib/server/storage';

export const config = { api: { bodyParser: { sizeLimit: '8kb' }, responseLimit: '4mb' } };
export function createStaffInventoryResearchHandler(deps: {
  requireAdmin: typeof requireInventoryAdminSession;
  read(unitIds: string[]): Promise<StaffInventoryResearchStatusV2[]>;
  retry(input: unknown, actor: string): ReturnType<typeof retryStaffInventoryResearchV2>;
  start(input: unknown, actor: string): ReturnType<typeof startStaffInventoryResearchV2>;
  signImage?(key: string): Promise<string>;
}) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      const admin = await deps.requireAdmin(req);
      if (req.method === 'GET') {
        if (Object.keys(req.query).some(key => key !== 'unit_id')) return res.status(400).json({ message: 'Only unit_id is supported.' });
        const input = req.query.unit_id;
        const unitIds = typeof input === 'string' ? [input] : input;
        if (!unitIds?.length || unitIds.length > 50 || new Set(unitIds).size !== unitIds.length || unitIds.some(id => typeof id !== 'string' || id.length > 200 || !id.trim() || id !== id.trim() || /[\u0000-\u001f\u007f]/.test(id))) return res.status(400).json({ message: 'Choose up to 50 distinct inventory cards.' });
        const jobs = await deps.read(unitIds);
        const keys = [...new Set(jobs.flatMap(job => job.result?.candidates.flatMap(candidate => {
          const image = candidate.image;
          return image?.storage_key && /^research-evidence\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(image.storage_key) && image.storage_key.split('/')[1].split('.')[0] === image.sha256 ? [image.storage_key] : [];
        }) ?? []))].slice(0, 12);
        const previews = deps.signImage ? await Promise.all(keys.map(async key => {
          try { return [key, await deps.signImage!(key)] as const; } catch { return null; }
        })) : [];
        const image_previews = Object.fromEntries(previews.filter((entry): entry is readonly [string, string] => entry !== null));
        const result = { version: 1, jobs, image_previews };
        if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024) return res.status(503).json({ message: 'Research exceeds the read limit. Choose fewer cards.' });
        return res.status(200).json(result);
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ message: 'Method not allowed' }); }
      if (Object.keys(req.query).length) return res.status(400).json({ message: 'Retry does not accept query parameters.' });
      if (req.body?.action === 'start') {
        const parsed = StaffInventoryResearchStartV2.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: 'Research requires the exact current individual card and description.' });
        return res.status(200).json(await deps.start(parsed.data, admin.user.id));
      }
      const parsed = StaffInventoryResearchRetryV2.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: 'Research retry requires the exact current card, revision and attempt.' });
      return res.status(200).json(await deps.retry(parsed.data, admin.user.id));
    } catch (error) {
      const code = error instanceof CardInventoryErrorV2 ? error.code === 'INVALID_INPUT' ? 400 : error.code === 'CONFLICT' ? 409 : 503
        : error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : 503;
      return res.status(code).json({ message: code < 500 && error instanceof Error ? error.message : 'Card research is unavailable. Your inventory is saved.' });
    }
  };
}
export default createStaffInventoryResearchHandler({
  requireAdmin: requireInventoryAdminSession,
  read: unitIds => readStaffInventoryResearchV2(prisma, { unitIds }),
  signImage: key => presignReadUrl(key, 600),
  retry: (input, actor) => prisma.$transaction(tx => retryStaffInventoryResearchV2(tx, input, actor), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 }),
  start: (input, actor) => prisma.$transaction(tx => startStaffInventoryResearchV2(tx, input, actor), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 }),
});
