import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { catalogApi } from '../../../../../lib/server/setCatalogEvidenceApi';
import { catalogPublishSchema, catalogRevokeSchema, loadCurrentSetCatalogPublication, publishSetCatalogEvidence, revokeSetCatalogEvidence } from '../../../../../lib/server/setCatalogEvidence';
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return catalogApi(req, res, ['GET', 'POST'], req.method === 'GET' ? 'reviewer' : 'approver', async actor => {
    if (req.method === 'GET') {
      const { setId } = z.object({ setId: z.string().min(1).max(256) }).strict().parse(req.query);
      res.status(200).json({ publication: await loadCurrentSetCatalogPublication({ setId }) }); return;
    }
    const body = z.union([catalogPublishSchema.extend({ action: z.literal('publish') }), catalogRevokeSchema.extend({ action: z.literal('revoke') })]).parse(req.body);
    const { action, ...input } = body;
    res.status(200).json(action === 'publish' ? await publishSetCatalogEvidence(input, actor) : await revokeSetCatalogEvidence(input, actor));
  });
}
