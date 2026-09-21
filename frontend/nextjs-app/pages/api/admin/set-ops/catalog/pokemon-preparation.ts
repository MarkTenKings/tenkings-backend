import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@tenkings/database';
import { z } from 'zod';
import { catalogApi, sendCatalogJson } from '../../../../../lib/server/setCatalogEvidenceApi';
import { createPokemonCatalogPreparationService, StalePokemonPreparationSnapshotError } from '../../../../../lib/server/setCatalogPokemonPreparation';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
type Service = ReturnType<typeof createPokemonCatalogPreparationService>;

/** An explicit human preparation action only. Neither operation publishes,
 * approves source jobs, replaces identities or invokes the generic draft build. */
export function createPokemonPreparationHandler(service: Service) {
  return async (req: NextApiRequest, res: NextApiResponse) => catalogApi(req, res, ['GET', 'POST'], 'reviewer', async actor => {
    z.object({}).strict().parse(req.query ?? {});
    if (req.method === 'GET') {
      sendCatalogJson(res, await service.preview(actor));
      return;
    }
    const body = z.object({ action: z.literal('stage'), request: z.unknown() }).strict().parse(req.body);
    try { sendCatalogJson(res, await service.stage(body.request, actor)); }
    catch (error) {
      if (!(error instanceof StalePokemonPreparationSnapshotError)) throw error;
      res.status(409).json({ message: error.message, code: 'POKEMON_PREPARATION_SNAPSHOT_STALE',
        idempotencyKey: error.idempotencyKey, expectedSnapshotSha256: error.expectedSnapshotSha256 });
    }
  });
}

export default createPokemonPreparationHandler(createPokemonCatalogPreparationService({ db: prisma }));
