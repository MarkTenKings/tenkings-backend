import { z } from 'zod';
import { CardInventoryErrorV2 } from './cardInventoryV2';
import { matchesFinancialInventoryTokenV2, createFinancialInventoryReadHandlerV2 } from './cardInventoryV2Http';
import type { exportInventoryWorkflowPageV2, WorkflowWorkspaceV2 } from './inventoryWorkflowV2Read';
import type { recordInventoryWorkflowEventV2 } from './cardPlatformV2';
type Request = { method?: string; headers: { authorization?: string; 'x-operator-key'?: string | string[] }; query: Record<string, string | string[] | undefined>; body?: unknown };
type Response = { setHeader(name: string, value: string): unknown; status(code: number): Response; json(body: unknown): unknown };
const query = z.object({ lot_id: z.string().min(1).max(200).optional(), batch_id: z.string().min(1).max(200).optional(), lot_offset: z.string().regex(/^(0|[1-9][0-9]{0,8})$/).transform(Number).optional(), batch_offset: z.string().regex(/^(0|[1-9][0-9]{0,8})$/).transform(Number).optional(), event_offset: z.string().regex(/^(0|[1-9][0-9]{0,8})$/).transform(Number).optional() }).strict();
// Reuse the exact existing capability parser and bounded cursor boundary.
export function createFinancialWorkflowReadHandlerV2(deps: { tokenHash(): string | undefined; readPage(input: Parameters<typeof exportInventoryWorkflowPageV2>[1]): ReturnType<typeof exportInventoryWorkflowPageV2> }): (req: Request, res: Response) => Promise<unknown> {
  return createFinancialInventoryReadHandlerV2(deps as unknown as Parameters<typeof createFinancialInventoryReadHandlerV2>[0]);
}
export function createInventoryWorkflowAdminHandlerV2(deps: {
  requireAdmin(req: Request): Promise<{ user: { id: string }; authority?: string }>;
  tokenHash(): string | undefined;
  read(input: z.infer<typeof query>): Promise<WorkflowWorkspaceV2 & { locations: Array<{ id: string; name: string; slug: string }> }>;
  record(input: unknown, adminId: string, preview: boolean): ReturnType<typeof recordInventoryWorkflowEventV2>;
}) {
  return async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.headers['x-operator-key'] !== undefined) return res.status(403).json({ code: 'HUMAN_ADMIN_REQUIRED' });
    if (matchesFinancialInventoryTokenV2(req.headers.authorization, deps.tokenHash())) return res.status(403).json({ code: 'READ_ONLY_CAPABILITY' });
    let admin;
    try { admin = await deps.requireAdmin(req); }
    catch (error) { const status = error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : 503; return res.status(status).json({ code: status === 503 ? 'AUTH_UNAVAILABLE' : 'UNAUTHORIZED' }); }
    if (admin.authority === 'operator-key') return res.status(403).json({ code: 'HUMAN_ADMIN_REQUIRED' });
    if (!['GET', 'POST'].includes(req.method ?? '')) { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' }); }
    try {
      if (req.method === 'GET') return res.status(200).json(await deps.read(query.parse(req.query)));
      if (Object.keys(req.query).length) return res.status(400).json({ code: 'INVALID_QUERY' });
      const body = z.object({ mode: z.enum(['preview', 'record']), command: z.unknown() }).strict().parse(req.body);
      return res.status(200).json(await deps.record(body.command, admin.user.id, body.mode === 'preview'));
    } catch (error) {
      const code = error instanceof z.ZodError ? 'INVALID_INPUT' : error instanceof CardInventoryErrorV2 ? error.code : 'UNAVAILABLE';
      return res.status(code === 'INVALID_INPUT' ? 400 : code === 'CONFLICT' ? 409 : 503).json({ code: 'WORKFLOW_' + code, message: code === 'CONFLICT' && error instanceof Error ? error.message : code === 'INVALID_INPUT' ? 'The workflow fields are invalid.' : 'Workflow evidence is unavailable or failed integrity verification.' });
    }
  };
}
