import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma, CardInventoryErrorV2, inventoryHash, readStaffInventoryResearchV2, readStaffInventoryResearchReviewsV2, readStaffInventoryResearchRecoveryV2, retryStaffInventoryResearchV2, startStaffInventoryResearchV2, StaffInventoryResearchRetryV2, StaffInventoryResearchStartV2, type StaffInventoryResearchStatusV2 } from '@tenkings/database';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';
import { presignReadUrl } from '../../../../../lib/server/storage';
import { StaffInventoryMarketValueResponseSchema, StaffInventoryResearchReviewSnapshotSchema, StaffInventoryResearchRecoverySnapshotSchema, bindStaffInventoryResearchRecovery, summarizeStaffInventoryResearchMarketValue, type StaffInventoryResearchJobWithReview } from '../../../../../lib/staffInventoryMarketValue';

export const config = { api: { bodyParser: { sizeLimit: '8kb' }, responseLimit: '4mb' } };
export function createStaffInventoryResearchHandler(deps: {
  requireAdmin: typeof requireInventoryAdminSession;
  read(unitIds: string[]): Promise<StaffInventoryResearchStatusV2[]>;
  readReviews(jobIds: string[]): ReturnType<typeof readStaffInventoryResearchReviewsV2>;
  readRecovery?(jobIds: string[]): ReturnType<typeof readStaffInventoryResearchRecoveryV2>;
  recoveryEnabled?(): boolean;
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
        if (Object.keys(req.query).some(key => key !== 'unit_id' && key !== 'view') || req.query.view !== undefined && req.query.view !== 'summary') return res.status(400).json({ message: 'Only unit_id and view=summary are supported.' });
        const input = req.query.unit_id;
        const unitIds = typeof input === 'string' ? [input] : input;
        if (!unitIds?.length || unitIds.length > 50 || new Set(unitIds).size !== unitIds.length || unitIds.some(id => typeof id !== 'string' || id.length > 200 || !id.trim() || id !== id.trim() || /[\u0000-\u001f\u007f]/.test(id))) return res.status(400).json({ message: 'Choose up to 50 distinct inventory cards.' });
        const savedJobs = await deps.read(unitIds);
        if (savedJobs.length > 50 || new Set(savedJobs.map(job => job.unit_id)).size !== savedJobs.length
          || new Set(savedJobs.map(job => job.job_id)).size !== savedJobs.length
          || savedJobs.some(job => !unitIds.includes(job.unit_id))) throw new Error('Unexpected research unit.');
        const complete = savedJobs.filter(job => job.status === 'complete' && job.result !== null);
        const completeIds = new Set(complete.map(job => job.job_id));
        const recoveryEnabled = deps.recoveryEnabled?.() === true;
        const [loadedReviews, loadedRecovery] = await Promise.all([
          complete.length ? deps.readReviews([...completeIds]) : Promise.resolve([]),
          savedJobs.length && deps.readRecovery ? deps.readRecovery(savedJobs.map(job => job.job_id)) : Promise.resolve([]),
        ]);
        const reviews = loadedReviews.map(review => StaffInventoryResearchReviewSnapshotSchema.parse(review));
        if (reviews.length !== complete.length || new Set(reviews.map(review => review.job_id)).size !== reviews.length
          || reviews.some(review => !completeIds.has(review.job_id))) throw new Error('Incomplete current review evidence.');
        const byJob = new Map(reviews.map(review => [review.job_id, review]));
        const recoveries = loadedRecovery.map(snapshot => StaffInventoryResearchRecoverySnapshotSchema.parse(snapshot));
        if (recoveries.length > savedJobs.length || new Set(recoveries.map(snapshot => snapshot.job_id)).size !== recoveries.length
          || recoveries.some(snapshot => !savedJobs.some(job => job.job_id === snapshot.job_id))) throw new Error('Unexpected recovery snapshot.');
        const recoveryByJob = new Map(recoveries.map(snapshot => [snapshot.job_id, snapshot]));
        const jobs: StaffInventoryResearchJobWithReview[] = savedJobs.map(job => {
          const review = byJob.get(job.job_id) ?? null;
          if (review && (review.unit_id !== job.unit_id || review.description_event_id !== job.description_event_id
            || review.input_hash !== job.input_hash || review.result_hash !== inventoryHash(job.result))) throw new Error('Research changed while loading its review.');
          return { ...job, result_hash: review?.result_hash ?? null, review, recovery: bindStaffInventoryResearchRecovery(recoveryByJob.get(job.job_id), job) };
        });
        if (req.query.view === 'summary') {
          return res.status(200).json(StaffInventoryMarketValueResponseSchema.parse({ version: 1, summaries: jobs.map(job => summarizeStaffInventoryResearchMarketValue(job, recoveryEnabled)) }));
        }
        // Originally selected evidence stays reviewable after an exclusion. Sign
        // it first, then other retained candidates, without reading any images.
        const candidates = jobs.flatMap(job => job.result?.candidates ?? []);
        const selectedIds = new Set(jobs.flatMap(job => job.result?.selected_candidate_ids ?? []));
        const prioritized = [...candidates.filter(candidate => selectedIds.has(candidate.id)), ...candidates.filter(candidate => !selectedIds.has(candidate.id))];
        const keys = [...new Set(prioritized.flatMap(candidate => {
          const image = candidate.image;
          return image?.storage_key && /^research-evidence\/[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(image.storage_key) && image.storage_key.split('/')[1].split('.')[0] === image.sha256 ? [image.storage_key] : [];
        }))].slice(0, 24);
        const previews = deps.signImage ? await Promise.all(keys.map(async key => {
          try { return [key, await deps.signImage!(key)] as const; } catch { return null; }
        })) : [];
        const image_previews = Object.fromEntries(previews.filter((entry): entry is readonly [string, string] => entry !== null));
        // Older panels read the immutable AI estimate and do not understand
        // staff exclusions. Their version-1 guard must reject reviewed reads.
        const result = { version: jobs.some(job => (job.review?.revision ?? 0) > 0) ? 2 : 1, jobs, image_previews, recovery_enabled: recoveryEnabled };
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
  readReviews: jobIds => readStaffInventoryResearchReviewsV2(prisma, { jobIds }),
  readRecovery: jobIds => readStaffInventoryResearchRecoveryV2(prisma, { jobIds }),
  recoveryEnabled: () => process.env.STAFF_INVENTORY_RESEARCH_RECOVERY_ENABLED === 'true',
  signImage: key => presignReadUrl(key, 600),
  retry: (input, actor) => prisma.$transaction(tx => retryStaffInventoryResearchV2(tx, input, actor), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 }),
  start: (input, actor) => prisma.$transaction(tx => startStaffInventoryResearchV2(tx, input, actor), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 }),
});
