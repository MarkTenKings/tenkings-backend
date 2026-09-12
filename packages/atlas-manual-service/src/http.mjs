import { inputCommand, ManualServiceError, requireThat } from './contract.mjs';

/** Mount alongside the existing staff app after its ordinary request routing.
 * Node/Next-style req/res, already bounded JSON req.body. This module owns only
 * /api/staff/manual/cards/:uuid[/actions/:uuid|/actions|/report-preview].
 * Return false for unrelated routes so the host can continue dispatching.
 */
export function createManualHandler({ service, boundary, origin, assertRequest }) {
  requireThat(typeof assertRequest === 'function', 500, 'MANUAL_REQUEST_BOUNDARY_REQUIRED');
  const id = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
  const pattern = new RegExp(`^/api/staff/manual/cards/(${id})(?:/(actions)(?:/(${id}))?|/(report-preview))?$`);
  return async (req, res) => {
    const url = new URL(req.url, origin), match = pattern.exec(url.pathname);
    if (!match) return false;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      await assertRequest(req); requireThat(!url.search && url.origin === origin, 400, 'MANUAL_REQUEST_INVALID');
      const write = req.method === 'POST' && match[2] === 'actions' && !match[3];
      requireThat(write || req.method === 'GET' && (!match[2] || match[3]), 405, 'MANUAL_METHOD_NOT_ALLOWED');
      if (write) {
        requireThat(req.headers.origin === origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')
          && typeof req.headers['x-atlas-csrf'] === 'string' && req.headers['x-atlas-csrf'].length > 0, 403, 'CSRF_REQUIRED');
        inputCommand(req.body);
      }
      const staff = await boundary.authenticate(req.headers.cookie ?? '', write ? req.headers['x-atlas-csrf'] : undefined);
      const result = write ? await service.execute(staff, match[1], req.body)
        : match[3] ? await service.status(staff, match[1], match[3])
          : match[4] ? await service.previewReport(staff, match[1]) : { card: await service.read(staff, match[1]) };
      res.status(200).json(result);
    } catch (error) {
      const expected = error instanceof ManualServiceError || Number.isInteger(error?.status) && typeof error?.code === 'string';
      res.status(expected ? error.status : 503).json({ error: expected ? error.code : 'MANUAL_TEMPORARILY_UNAVAILABLE' });
    }
    return true;
  };
}
