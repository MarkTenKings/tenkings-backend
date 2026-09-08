import { createHash, timingSafeEqual } from 'node:crypto';
import { CardInventoryErrorV2 } from './cardInventoryV2';
import type { exportCardInventoryPageV2 } from './cardInventoryV2Read';
import type { recordCardInventoryEventV2 } from './cardPlatformV2';

type Request = { method?: string; headers: { authorization?: string }; query: Record<string, string | string[] | undefined>; body?: unknown };
type Response = { setHeader(name: string, value: string): unknown; status(code: number): Response; json(body: unknown): unknown };
const noStore = (res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
};
export function matchesFinancialInventoryTokenV2(authorization: unknown, tokenHash: unknown): boolean {
  if (typeof tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(tokenHash) || typeof authorization !== 'string') return false;
  const token = /^Bearer ([\x21-\x7e]{32,512})$/.exec(authorization)?.[1];
  if (!token || token.length > 512) return false;
  return timingSafeEqual(createHash('sha256').update(token).digest(), Buffer.from(tokenHash, 'hex'));
}
const failure = (res: Response, error: unknown) => {
  const code = error instanceof CardInventoryErrorV2 ? error.code : 'UNAVAILABLE';
  return res.status(code === 'INVALID_INPUT' ? 400 : code === 'CONFLICT' ? 409 : 503).json({
    code: 'INVENTORY_' + code,
    message: code === 'INVALID_INPUT' ? 'Invalid inventory request.' : code === 'CONFLICT' ? 'Inventory evidence conflicts with accepted physical facts.' : 'Inventory evidence is unavailable or failed integrity verification.',
  });
};

export function createFinancialInventoryReadHandlerV2(deps: {
  tokenHash(): string | undefined;
  readPage(input: Parameters<typeof exportCardInventoryPageV2>[1]): ReturnType<typeof exportCardInventoryPageV2>;
}) {
  return async (req: Request, res: Response) => {
    noStore(res);
    const configured = deps.tokenHash();
    if (!configured || !/^[a-f0-9]{64}$/.test(configured)) return res.status(503).json({ code: 'INVENTORY_READ_UNCONFIGURED' });
    if (!matchesFinancialInventoryTokenV2(req.headers.authorization, configured)) return res.status(401).json({ code: 'UNAUTHORIZED' });
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' }); }
    try {
      if (Object.keys(req.query).some(k => !['after_sequence', 'limit', 'snapshot_through_sequence'].includes(k))) throw new CardInventoryErrorV2('INVALID_INPUT', 'Unknown cursor parameter');
      const integer = (value: unknown, fallback?: number) => {
        if (value === undefined && fallback !== undefined) return fallback;
        if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(value) || !Number.isSafeInteger(Number(value))) throw new CardInventoryErrorV2('INVALID_INPUT', 'Invalid cursor parameter');
        return Number(value);
      };
      const input = { after_sequence: integer(req.query.after_sequence), limit: integer(req.query.limit, 1000),
        ...(req.query.snapshot_through_sequence === undefined ? {} : { snapshot_through_sequence: integer(req.query.snapshot_through_sequence) }) };
      if (input.limit < 1 || input.limit > 1000) throw new CardInventoryErrorV2('INVALID_INPUT', 'Invalid page size');
      return res.status(200).json(await deps.readPage(input));
    } catch (error) { return failure(res, error); }
  };
}

export function createPhysicalInventoryWriteHandlerV2(deps: {
  requireAdmin(req: Request): Promise<{ user: { id: string }; authority?: string }>;
  record(input: unknown, adminId: string): ReturnType<typeof recordCardInventoryEventV2>;
  readTokenHash(): string | undefined;
}) {
  return async (req: Request, res: Response) => {
    noStore(res);
    // A read capability is never promoted to a human/operator authority.
    if (matchesFinancialInventoryTokenV2(req.headers.authorization, deps.readTokenHash())) return res.status(403).json({ code: 'READ_ONLY_CAPABILITY' });
    let admin;
    try { admin = await deps.requireAdmin(req); }
    catch (error) {
      const status = error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : 503;
      return res.status(status).json({ code: status === 503 ? 'AUTH_UNAVAILABLE' : 'UNAUTHORIZED' });
    }
    if (admin.authority === 'operator-key') return res.status(403).json({ code: 'HUMAN_ADMIN_REQUIRED' });
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' }); }
    if (Object.keys(req.query).length) return res.status(400).json({ code: 'INVALID_QUERY' });
    try { return res.status(200).json(await deps.record(req.body, admin.user.id)); }
    catch (error) { return failure(res, error); }
  };
}
