import { assertBatch } from './index.mjs';

export const BATCH_PATH = '/api/staff/manual-connected/cards/batch';
export const isBatchPath = path => path === BATCH_PATH || path === `${BATCH_PATH}/resume`
  || new RegExp(`^${BATCH_PATH}/[a-f0-9]{64}(?:/review)?$`).test(path);
export function createBatchHandler({ service, boundary, origin, assertRequest }) {
  return async (req, res) => {
    const url = new URL(req.url, origin);
    if (!isBatchPath(url.pathname)) return false;
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      await assertRequest(req);
      assertBatch(url.origin === origin && !url.search, 'BATCH_INPUT_INVALID');
      const resume = url.pathname.endsWith('/resume'), detail = new RegExp(`^${BATCH_PATH}/([a-f0-9]{64})(/review)?$`).exec(url.pathname);
      const review = Boolean(detail?.[2]), write = req.method === 'POST';
      assertBatch(req.method === (resume || review ? 'POST' : detail ? 'GET' : write ? 'POST' : 'GET'), 'METHOD_NOT_ALLOWED', 405);
      if (write) {
        assertBatch(req.headers.origin === origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')
          && typeof req.headers['x-atlas-csrf'] === 'string' && req.headers['x-atlas-csrf'], 'CSRF_REQUIRED', 403);
        assertBatch(Buffer.byteLength(JSON.stringify(req.body ?? {})) <= 16384, 'REQUEST_TOO_LARGE', 413);
      }
      const staff = await boundary.authenticate(req.headers.cookie ?? '', write ? req.headers['x-atlas-csrf'] : undefined);
      const result = detail ? review ? await service.approve(staff, detail[1], req.body) : await service.detail(staff, detail[1])
        : write ? resume ? await service.resume(staff, req.body) : await service.enqueue(staff, req.body) : await service.list(staff);
      res.status(200).json(result);
    } catch (error) {
      const known = Number.isInteger(error?.status) && typeof error?.code === 'string';
      res.status(known ? error.status : 503).json({ error: known ? error.code : 'BATCH_UNAVAILABLE' });
    }
    return true;
  };
}
