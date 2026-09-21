import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { catalogApi, sendCatalogJson } from '../../../../../lib/server/setCatalogEvidenceApi';
import { previewSetCatalogEvidence } from '../../../../../lib/server/setCatalogEvidence';
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return catalogApi(req, res, ['POST'], 'reviewer', async actor => {
    const body = z.object({ manifest: z.unknown(), reviewEvidence: z.unknown() }).strict().parse(req.body);
    sendCatalogJson(res, await previewSetCatalogEvidence(body, actor));
  });
}
