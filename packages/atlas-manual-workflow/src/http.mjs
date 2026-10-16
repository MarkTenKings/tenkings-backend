import { createManualHandler } from '@atlas/manual-service/http';
import { ManualServiceError, requireThat } from '@atlas/manual-service/contract';
import { actionWorkspaceVersion, hasActionWorkspace } from './action-workspace.mjs';

/** Host must bound request bytes before parsing (64KiB actions, 1MiB trace).
 * Mount behind the existing staff request boundary; no unauthenticated files
 * or full workspace mutation endpoints are provided here.
 */
export function createWorkflowHandler({ workflow, boundary, origin, assertRequest, imageDescriptors, workspaceExtras = null }) {
  const ordinary = createManualHandler({ service: workflow.service, boundary, origin, assertRequest });
  async function workspace(staff, card, imageScope) {
    const [state, approval] = await Promise.all([
      workflow.hydrate(card), workflow.service.latestApproval(staff, card.cardId),
    ]);
    const [images, extras] = await Promise.all([
      imageDescriptors({ card, state, staff, imageScope }),
      workspaceExtras ? workspaceExtras({ card, state, staff }) : {},
    ]);
    return { card, ...state, images, approval, ...extras };
  }
  function actionHandler(imageScope) {
    return createManualHandler({ boundary, origin, assertRequest, service: { ...workflow.service,
      async execute(staff, cardId, input) {
        const started = Date.now(), result = await workflow.service.execute(staff, cardId, input);
        if (!hasActionWorkspace(input.action.type)) return result;
        // The compact receipt remains the durable authority. The optional full
        // snapshot uses exactly the GET assembly (including extras and grants),
        // and is never persisted in the action journal. Old clients opt out.
        const remaining = Math.min(5000, Math.max(0, 200000 - (Date.now() - started)));
        if (!remaining) return result;
        let timer;
        const prepare = async () => {
          const view = await workspace(staff, result.card, imageScope);
          // Grant creation checks current photographs/access before and after
          // its reads. Also fence concurrent manual edits and old receipt replays.
          await workflow.assertViewCurrent(staff, result.card);
          return { version: actionWorkspaceVersion, imageScope, view };
        };
        const enriched = await Promise.race([prepare().catch(() => null),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), remaining); })]).finally(() => clearTimeout(timer));
        const response = enriched ? { ...result, workspace: enriched } : result;
        // The private JSON transport is capped at 2 MiB. Duplicating the compact
        // card in a large full view must not turn a committed save into a lost reply.
        try { return enriched && Buffer.byteLength(JSON.stringify(response)) > 2 * 1024 * 1024 ? result : response; }
        catch { return result; }
      },
    } });
  }
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
  const pattern = new RegExp(`^/api/staff/manual/cards/(${uuid})/(view|trace|proposal-trace)$`);
  return async (req, res) => {
    const url = new URL(req.url, origin), found = pattern.exec(url.pathname);
    if (!found) {
      const scope = req.headers['x-atlas-workspace'];
      return ['all', 'inspection'].includes(scope) ? actionHandler(scope)(req, res) : ordinary(req, res);
    }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      await assertRequest(req); requireThat(url.origin === origin
        && (!url.search || found[2] === 'view' && ['?images=inspection', '?scope=state'].includes(url.search)));
      const write = found[2] !== 'view';
      requireThat(req.method === (write ? 'POST' : 'GET'), 405, 'MANUAL_METHOD_NOT_ALLOWED');
      if (write) requireThat(req.headers.origin === origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')
        && typeof req.headers['x-atlas-csrf'] === 'string' && req.headers['x-atlas-csrf'], 403, 'CSRF_REQUIRED');
      const staff = await boundary.authenticate(req.headers.cookie ?? '', write ? req.headers['x-atlas-csrf'] : undefined);
      if (write) res.status(200).json(await (found[2] === 'proposal-trace' ? workflow.stageProposalTrace : workflow.stageTrace)(staff, found[1], req.body));
      else if (url.search === '?scope=state') res.status(200).json(await workflow.readState(staff, found[1]));
      else {
        const card = await workflow.service.read(staff, found[1]);
        res.status(200).json(await workspace(staff, card, url.search ? 'inspection' : 'all'));
      }
    } catch (error) {
      const known = error instanceof ManualServiceError || Number.isInteger(error?.status) && typeof error?.code === 'string';
      res.status(known ? error.status : 503).json({ error: known ? error.code : 'MANUAL_TEMPORARILY_UNAVAILABLE' });
    }
    return true;
  };
}
