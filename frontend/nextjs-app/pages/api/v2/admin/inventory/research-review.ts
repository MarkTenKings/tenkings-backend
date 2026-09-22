import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma, CardInventoryErrorV2, recordStaffInventoryResearchReviewV2 } from '@tenkings/database';
import { StaffInventoryResearchReviewCommandSchema, StaffInventoryResearchReviewResponseSchema } from '../../../../../lib/staffInventoryMarketValue';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';

export const config = { api: { bodyParser: { sizeLimit: '8kb' }, responseLimit: '256kb' } };

export function createStaffInventoryResearchReviewHandler(deps: {
  requireAdmin: typeof requireInventoryAdminSession;
  record(input: unknown, actor: string): ReturnType<typeof recordStaffInventoryResearchReviewV2>;
}) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      const admin = await deps.requireAdmin(req);
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ message: 'Method not allowed' }); }
      if (Object.keys(req.query).length) return res.status(400).json({ message: 'Comp review does not accept query parameters.' });
      const command = StaffInventoryResearchReviewCommandSchema.safeParse(req.body);
      if (!command.success) return res.status(400).json({ message: 'Review requires the exact saved research, candidate and review revision.' });
      const receipt = StaffInventoryResearchReviewResponseSchema.parse(await deps.record(command.data, admin.user.id));
      if (receipt.request_id !== command.data.requestId || receipt.review.job_id !== command.data.jobId
        || receipt.review.unit_id !== command.data.unitId || receipt.review.description_event_id !== command.data.descriptionEventId
        || receipt.review.input_hash !== command.data.inputHash || receipt.review.result_hash !== command.data.resultHash
        || receipt.recorded_revision !== command.data.expectedRevision + 1) throw new Error('Unbound review receipt.');
      if (receipt.outcome === 'RECORDED' && !receipt.review.decisions.some(decision => decision.request_id === command.data.requestId
        && decision.revision === receipt.recorded_revision && decision.candidate_id === command.data.candidateId
        && decision.decision === command.data.decision && decision.actor_id === admin.user.id)) throw new Error('Unbound recorded decision.');
      if (Buffer.byteLength(JSON.stringify(receipt)) > 256 * 1024) throw new Error('Review receipt exceeds the read limit.');
      return res.status(200).json(receipt);
    } catch (error) {
      const code = error instanceof CardInventoryErrorV2 ? error.code === 'INVALID_INPUT' ? 400 : error.code === 'CONFLICT' ? 409 : 503
        : error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : 503;
      return res.status(code).json({ message: code < 500 && error instanceof Error ? error.message : 'The comp review response is unavailable. Reload the saved review before trying again.' });
    }
  };
}

export default createStaffInventoryResearchReviewHandler({
  requireAdmin: requireInventoryAdminSession,
  record: (input, actor) => prisma.$transaction(tx => recordStaffInventoryResearchReviewV2(tx, input, actor), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 }),
});
