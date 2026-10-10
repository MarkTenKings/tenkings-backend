import type { NextApiRequest, NextApiResponse } from 'next';
import { catalogApi } from '../../../../../lib/server/setCatalogEvidenceApi';
import { reviewSetCatalogDemand } from '../../../../../lib/server/setCatalogDemandReview';
export const config = { api: { responseLimit: '4mb' } };
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return catalogApi(req, res, ['GET'], 'reviewer', async actor => {
    const result = await reviewSetCatalogDemand(req.query, actor);
    if (result.kind === 'json') { res.status(200).json(result.value); return; }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="catalog-demand-source-${result.sha256}.bin"`);
    res.setHeader('X-Catalog-Source-Sha256', result.sha256);
    res.setHeader('Content-Length', result.bytes.length); res.status(200).send(result.bytes);
  });
}
