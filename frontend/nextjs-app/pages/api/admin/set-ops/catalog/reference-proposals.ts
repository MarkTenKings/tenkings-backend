import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { catalogApi } from '../../../../../lib/server/setCatalogEvidenceApi';
import { setCatalogReferenceService } from '../../../../../lib/server/setCatalogReferenceProposals';
export const config = { api: { bodyParser: { sizeLimit: '4mb' }, responseLimit: '4mb' } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return catalogApi(req, res, ['GET', 'POST'], 'reviewer', async actor => {
    if (req.method === 'POST') { res.status(200).json(await setCatalogReferenceService.prepare(req.body, actor)); return; }
    const input = z.object({ proposalId: z.string().uuid(), proposalSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.query);
    res.status(200).json(await setCatalogReferenceService.review(input, actor));
  });
}
