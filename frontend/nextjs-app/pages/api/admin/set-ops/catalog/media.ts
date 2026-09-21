import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { catalogApi } from '../../../../../lib/server/setCatalogEvidenceApi';
import { readSetCatalogArtifact, stageSetCatalogArtifact } from '../../../../../lib/server/setCatalogEvidenceMedia';
export const config = { api: { bodyParser: { sizeLimit: '4300kb' }, responseLimit: '4300kb' } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return catalogApi(req, res, ['GET', 'POST'], 'reviewer', async actor => {
    if (req.method === 'POST') { res.status(200).json(await stageSetCatalogArtifact(req.body, actor)); return; }
    const { ref } = z.object({ ref: z.string().regex(/^catalog:sha256:[a-f0-9]{64}$/) }).strict().parse(req.query);
    const bytes = await readSetCatalogArtifact(ref);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="catalog-${ref.slice(-64)}.bin"`);
    res.status(200).send(bytes);
  });
}
