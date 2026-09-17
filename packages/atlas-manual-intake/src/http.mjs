import { object, requireThat } from './contract.mjs';

/** Node/Next-shaped handler. Host bounds JSON to 8KiB BEFORE parsing and applies
 * its existing request/deployment assertion. Browser PUT goes directly to the
 * exact signed private object; no native image bytes enter these JSON routes.
 */
export function createIntakeHandler({ service, boundary, origin, assertRequest }) {
  requireThat(typeof assertRequest === 'function', 500, 'INTAKE_REQUEST_BOUNDARY_REQUIRED');
  const id = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
  const pattern = new RegExp(`^/api/staff/manual-intake/cards(?:/(${id})(?:/(uploads)(?:/(${id})(?:/(sign|complete|prepare|source))?)?)?)?$`);
  return async (req, res) => {
    const url = new URL(req.url, origin), match = pattern.exec(url.pathname);
    if (!match) return false;
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      await assertRequest(req); requireThat(url.origin === origin, 400, 'INTAKE_REQUEST_INVALID');
      const [, cardId, uploads, uploadId, action] = match;
      const write = req.method === 'POST';
      requireThat(write || req.method === 'GET', 405, 'INTAKE_METHOD_NOT_ALLOWED');
      const list = !write && !cardId;
      if (list) requireThat([...url.searchParams.keys()].every(key => ['limit', 'cursor'].includes(key))
        && new Set(url.searchParams.keys()).size === [...url.searchParams.keys()].length, 400, 'INTAKE_REQUEST_INVALID');
      else requireThat(!url.search, 400, 'INTAKE_REQUEST_INVALID');
      if (write) {
        requireThat(req.headers.origin === origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')
          && typeof req.headers['x-atlas-csrf'] === 'string' && req.headers['x-atlas-csrf'].length > 0, 403, 'CSRF_REQUIRED');
        requireThat(!cardId || uploads && (!uploadId || ['sign', 'complete', 'prepare'].includes(action)), 405, 'INTAKE_METHOD_NOT_ALLOWED');
        if (uploadId) object(req.body, []);
      } else requireThat(!uploads || uploadId && (!action || action === 'source'), 405, 'INTAKE_METHOD_NOT_ALLOWED');
      const staff = await boundary.authenticate(req.headers.cookie ?? '', write ? req.headers['x-atlas-csrf'] : undefined);
      const result = !cardId ? (write ? await service.create(staff, req.body) : await service.list(staff, {
        limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 30, cursor: url.searchParams.get('cursor') }))
        : !uploads ? await service.read(staff, cardId)
          : !uploadId ? await service.plan(staff, cardId, req.body)
            : action === 'source' ? await service.readSource(staff, cardId, uploadId)
              : action ? await service[action](staff, cardId, uploadId) : await service.upload(staff, cardId, uploadId);
      res.status(200).json(result);
    } catch (error) {
      const known = Number.isInteger(error?.status) && typeof error?.code === 'string';
      const photoConflict = ['PHOTO_STORAGE_CONFLICT', 'PHOTO_SOURCE_MISMATCH', 'PHOTO_UPLOAD_CONFLICT'].includes(error?.code);
      const photoRefused = /^PHOTO_(?:DECODE|HEIC|WORKING|COLOR|ICC|HDR)/.test(error?.code ?? '');
      res.status(known ? error.status : photoConflict ? 409 : photoRefused ? 422 : 503).json({
        error: known || photoConflict || photoRefused ? error.code : 'INTAKE_TEMPORARILY_UNAVAILABLE' });
    }
    return true;
  };
}
