import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import type { CatalogQuery } from '@tenkings/card-catalog-evidence';
import { catalogApi, sendCatalogJson } from '../../../../../lib/server/setCatalogEvidenceApi';
import { catalogPublicationPinSchema, lookupPublishedSetCatalogEvidence } from '../../../../../lib/server/setCatalogEvidence';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return catalogApi(req, res, ['POST'], 'reviewer', async () => {
    const body = z.object({ publication: catalogPublicationPinSchema, query: z.unknown() }).strict().parse(req.body);
    sendCatalogJson(res, await lookupPublishedSetCatalogEvidence({ publication: body.publication, query: body.query as CatalogQuery }));
  });
}
