import type { NextApiRequest, NextApiResponse } from 'next';
import { catalogApi } from '../../../../../lib/server/setCatalogEvidenceApi';
import { exportCatalogTaxonomy } from '../../../../../lib/server/setCatalogTaxonomyExport';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return catalogApi(req, res, ['GET'], 'reviewer', async actor => {
    const result = await exportCatalogTaxonomy({ setId: req.query.setId }, actor);
    res.setHeader('Content-Disposition', 'attachment; filename="setops-catalog-taxonomy.json"');
    res.status(200).json(result);
  });
}
