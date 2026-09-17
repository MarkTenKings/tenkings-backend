import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { prepareObservationProposal, type CatalogQuery, type PublicationPin } from '@tenkings/card-catalog-evidence';
import { HttpError } from './adminSessionAuthority';

export const CARD_CATALOG_SERVICE_VERSION = 'card-catalog-service/v1' as const;
export const CARD_CATALOG_SERVICE_LIMITS = { deadlineMs: 25_000, jsonResponseBytes: 1024 * 1024, imageBytes: 4 * 1024 * 1024 } as const;
const operations = ['discover', 'lookup', 'media', 'proposals'] as const;
export type CatalogServiceOperation = typeof operations[number];
const identifier = z.string().min(1).max(256).refine(v => v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const pin = z.object({ publicationId: identifier, setId: identifier, revision: z.number().int().positive(), manifestSha256: digest }).strict();
const query = z.object({
  category: z.enum(['SPORTS', 'POKEMON']), setId: identifier.optional(), setLabel: identifier.optional(), year: identifier.optional(),
  manufacturer: identifier.optional(), publisher: identifier.optional(), programId: identifier.optional(), programLabel: identifier.optional(),
  cardId: identifier.optional(), cardNumber: identifier.optional(), cardName: identifier.optional(), printingId: identifier.optional(),
  printingLabel: identifier.optional(), language: identifier.optional(), edition: identifier.optional(), format: identifier.optional(),
  channel: identifier.optional(), limit: z.number().int().min(1).max(24).optional(),
}).strict();
const discovery = z.object({ query }).strict().refine(v => Boolean(v.query.setId || (v.query.setLabel && v.query.year)), 'An exact set or label and year is required.');
const lookup = z.object({ publication: pin, query }).strict();
const media = z.object({ publication: pin, imageId: identifier }).strict();
const proposal = z.object({ proposal: z.unknown(), observation: z.object({
  physicalCardRef: identifier, observationId: identifier, inputRevision: identifier, evidenceSha256: digest,
}).strict() }).strict();

/** A separate, least-privilege principal. Neither staff cookies nor operator keys
 * establish cross-application authority. Only the token digest is configured here. */
export function authorizeCatalogService(req: Pick<NextApiRequest, 'headers'>, operation: CatalogServiceOperation, env: Record<string, string | undefined> = process.env) {
  if (env.SET_CATALOG_EVIDENCE_ENABLED !== 'true' || env.CATALOG_ATLAS_SERVICE_ENABLED !== 'true') throw new HttpError(503, 'Catalog service unavailable.');
  const expected = env.CATALOG_ATLAS_SERVICE_TOKEN_SHA256;
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new HttpError(503, 'Catalog service unavailable.');
  const header = req.headers.authorization;
  const token = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(header)?.[1] : undefined;
  const supplied = createHash('sha256').update(token ?? '').digest();
  if (!token || !timingSafeEqual(supplied, Buffer.from(expected, 'hex'))) throw new HttpError(401, 'Catalog service authentication required.');
  const granted = (env.CATALOG_ATLAS_SERVICE_SCOPES ?? '').split(',').map(s => s.trim());
  if (!granted.includes(operation)) throw new HttpError(403, 'Catalog service operation is not granted.');
  return { producer: 'atlas' as const, actorKind: 'service' as const, actorRef: 'atlas:card-catalog:v1', userId: null };
}

type Service = Pick<typeof import('./setCatalogEvidence'), 'findCurrentSetCatalogPublications' | 'lookupPublishedSetCatalogEvidence' | 'readPublishedSetCatalogImage' | 'submitSetCatalogObservationProposal'>;
async function deadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new HttpError(503, 'Catalog deadline exceeded.')), CARD_CATALOG_SERVICE_LIMITS.deadlineMs); })]); }
  finally { clearTimeout(timer); }
}
function json(res: NextApiResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > CARD_CATALOG_SERVICE_LIMITS.jsonResponseBytes) throw new HttpError(503, 'Catalog response exceeds its bound.');
  return res.status(status).json(value);
}
export function createCardCatalogServiceHandler(operation: CatalogServiceOperation, dependencies: { env?: Record<string, string | undefined>; service?: Service } = {}) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Authorization');
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new HttpError(405, 'Use POST.'); }
      const actor = authorizeCatalogService(req, operation, dependencies.env);
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'JSON is required.');
      const service = dependencies.service ?? await import('./setCatalogEvidence');
      if (operation === 'discover') {
        const input = discovery.parse(req.body);
        const publications = await deadline(service.findCurrentSetCatalogPublications({ query: input.query as CatalogQuery, consumer: 'atlas' }));
        return json(res, 200, { schemaVersion: CARD_CATALOG_SERVICE_VERSION, publications });
      }
      if (operation === 'lookup') {
        const input = lookup.parse(req.body);
        const result = await deadline(service.lookupPublishedSetCatalogEvidence({ publication: input.publication as PublicationPin, query: input.query, consumer: 'atlas' }));
        return json(res, 200, { schemaVersion: CARD_CATALOG_SERVICE_VERSION, result });
      }
      if (operation === 'media') {
        const input = media.parse(req.body);
        const image = await deadline(service.readPublishedSetCatalogImage({ ...input, consumer: 'atlas' }));
        if (image.bytes.length > CARD_CATALOG_SERVICE_LIMITS.imageBytes) throw new HttpError(503, 'Catalog image exceeds its bound.');
        // Exact reviewed bytes only. No storage URL or private bucket key crosses this boundary.
        res.setHeader('Content-Type', image.mimeType);
        res.setHeader('Content-Length', image.bytes.length);
        res.setHeader('X-Catalog-Image-Sha256', image.sha256);
        res.setHeader('X-Catalog-Image-Width', image.width);
        res.setHeader('X-Catalog-Image-Height', image.height);
        return res.status(200).send(image.bytes);
      }
      const input = proposal.parse(req.body);
      const prepared = prepareObservationProposal(input.proposal), p = prepared.proposal;
      const binding = input.observation;
      // Atlas authenticates its physical observation. Bind the assertion to the
      // complete canonical proposal, including its original source/image hashes.
      if (p.producer !== actor.producer || p.physicalCardRef !== binding.physicalCardRef || p.observationId !== binding.observationId
        || p.inputRevision !== binding.inputRevision || prepared.proposalSha256 !== binding.evidenceSha256) throw new HttpError(403, 'Observation binding differs from the proposal.');
      const receipt = await deadline(service.submitSetCatalogObservationProposal({ proposal: p, authority: { ...actor, binding } }));
      return json(res, receipt.outcome === 'recorded' ? 201 : 200, { schemaVersion: CARD_CATALOG_SERVICE_VERSION, disposition: 'requires_authorized_review', receipt });
    } catch (error) {
      const status = error instanceof HttpError ? error.statusCode : error instanceof z.ZodError || (error instanceof Error && error.name === 'CatalogContractError') ? 400 : 503;
      // Never expose SQL, storage identifiers, source payloads, credentials, or stack traces.
      return res.status(status).json({ schemaVersion: CARD_CATALOG_SERVICE_VERSION, error: status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 409 ? 'conflict' : status === 404 ? 'unavailable_publication' : status === 400 ? 'invalid_request' : status === 405 ? 'method_not_allowed' : status === 415 ? 'unsupported_media_type' : 'unavailable' });
    }
  };
}
