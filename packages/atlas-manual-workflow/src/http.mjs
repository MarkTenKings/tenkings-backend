import { createManualHandler } from '@atlas/manual-service/http';
import { ManualServiceError, requireThat } from '@atlas/manual-service/contract';

/** Host must bound request bytes before parsing (64KiB actions, 1MiB trace).
 * Mount behind the existing staff request boundary; no unauthenticated files
 * or full workspace mutation endpoints are provided here.
 */
export function createWorkflowHandler({ workflow, boundary, origin, assertRequest, imageDescriptors, workspaceExtras = null }) {
  const ordinary = createManualHandler({ service: workflow.service, boundary, origin, assertRequest });
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
  const pattern = new RegExp(`^/api/staff/manual/cards/(${uuid})/(view|trace|proposal-trace)$`);
  return async (req, res) => {
    const url = new URL(req.url, origin), found = pattern.exec(url.pathname);
    if (!found) return ordinary(req, res);
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      await assertRequest(req); requireThat(url.origin === origin && !url.search);
      const write = found[2] !== 'view';
      requireThat(req.method === (write ? 'POST' : 'GET'), 405, 'MANUAL_METHOD_NOT_ALLOWED');
      if (write) requireThat(req.headers.origin === origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')
        && typeof req.headers['x-atlas-csrf'] === 'string' && req.headers['x-atlas-csrf'], 403, 'CSRF_REQUIRED');
      const staff = await boundary.authenticate(req.headers.cookie ?? '', write ? req.headers['x-atlas-csrf'] : undefined);
      if (write) res.status(200).json(await (found[2] === 'proposal-trace' ? workflow.stageProposalTrace : workflow.stageTrace)(staff, found[1], req.body));
      else {
        const card = await workflow.service.read(staff, found[1]);
        const [state, approval] = await Promise.all([
          workflow.hydrate(card), workflow.service.latestApproval(staff, found[1]),
        ]);
        const [images, extras] = await Promise.all([
          imageDescriptors({ card, state, staff }),
          workspaceExtras ? workspaceExtras({ card, state, staff }) : {},
        ]);
        res.status(200).json({ card, ...state, images, approval, ...extras });
      }
    } catch (error) {
      const known = error instanceof ManualServiceError || Number.isInteger(error?.status) && typeof error?.code === 'string';
      res.status(known ? error.status : 503).json({ error: known ? error.code : 'MANUAL_TEMPORARILY_UNAVAILABLE' });
    }
    return true;
  };
}
