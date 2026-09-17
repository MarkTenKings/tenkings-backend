import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { requireCatalogHuman } from '../../../../../lib/server/setCatalogEvidenceAuth';
import { HttpError } from '../../../../../lib/server/adminSessionAuthority';
import { catalogProposalInbox } from '../../../../../lib/server/staffInventoryCatalogObservations';

export const config = { api: { responseLimit: '1mb' } };
export function createCatalogProposalsHandler(dependencies = { requireHuman: requireCatalogHuman, inbox: catalogProposalInbox }) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ message: 'Use GET to review proposals.' }); }
    try {
      const actor = await dependencies.requireHuman(req, 'reviewer');
      const query = z.union([
        z.object({ proposalId: z.string().uuid(), proposalSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
        z.object({ cursor: z.string().max(512).optional(), producer: z.enum(['inventory', 'atlas']).optional() }).strict(),
      ]).parse(req.query);
      const response = 'proposalId' in query ? await dependencies.inbox.detail(query, actor) : await dependencies.inbox.list(query, actor);
      return res.status(200).json(response);
    } catch (error) {
      const status = error instanceof HttpError ? error.statusCode : error instanceof z.ZodError ? 400 : 503;
      return res.status(status).json({ message: error instanceof HttpError && status < 500 ? error.message : status === 400 ? 'Invalid proposal request.' : 'Proposal review is unavailable.' });
    }
  };
}
export default createCatalogProposalsHandler();
