import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { CatalogContractError } from '@tenkings/card-catalog-evidence';
import { requireCatalogHuman } from './setCatalogEvidenceAuth';
import { HttpError } from './adminSessionAuthority';
import type { AdminSession } from './admin';

/** Keep full review evidence below the hosting response limit; never omit
 * predecessor/source fields merely to make an oversized review look complete. */
export function sendCatalogJson(res: NextApiResponse, value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) throw new HttpError(413, 'Catalog review response is too large. Prepare a smaller complete publication.');
  return res.status(200).json(value);
}

export async function catalogApi(req: NextApiRequest, res: NextApiResponse, methods: string[], role: 'reviewer' | 'approver',
  action: (actor: AdminSession) => Promise<void>) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!methods.includes(req.method ?? '')) { res.setHeader('Allow', methods.join(', ')); res.status(405).json({ message: 'Method not allowed' }); return; }
  try { await action(await requireCatalogHuman(req, role)); }
  catch (error) {
    if (error instanceof HttpError) { res.status(error.statusCode).json({ message: error.message }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ message: error.issues[0]?.message ?? 'Invalid catalog request' }); return; }
    if (error instanceof CatalogContractError) { res.status(400).json({ message: `Catalog evidence rejected: ${error.code} (${error.path})` }); return; }
    // Do not log source bytes, private refs, database URLs or request bodies.
    console.error('[set-catalog] request failed', { errorType: error instanceof Error ? error.name : 'unknown' });
    res.status(503).json({ message: 'Catalog evidence is unavailable. Keep the review packet and retry.' });
  }
}
