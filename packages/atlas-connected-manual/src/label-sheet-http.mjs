import { requireThat } from '@atlas/manual-service/contract';

const base = '/api/staff/manual-connected';
const id = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const sheets = new RegExp(`^${base}/label-sheets(?:/(${id})(?:/(exports)(?:/(${id})(?:/(download))?)?|/(print-confirmations))?)?$`);
const items = new RegExp(`^${base}/labels/(${id})/(artwork|reprints|layout-retries|exports)(?:/(${id})(?:/(download))?)?$`);

/** The parent has already checked the signed ingress. This adapter retains
 * ordinary staff-session and CSRF authority for every label operation. */
export function createLabelSheetsHandler({ connected, boundary, origin }) {
  return async (req, res, url) => {
    const sheet = sheets.exec(url.pathname), item = items.exec(url.pathname);
    if (!sheet && !item) return false;
    const list = sheet && !sheet[1];
    const artwork = item?.[2] === 'artwork';
    requireThat(!item || !item[3] || item[2] === 'exports', 404, 'NOT_FOUND');
    const write = Boolean(sheet?.[5] || sheet?.[4] || sheet?.[2] && !sheet[3]
      || item?.[4] || ['reprints','layout-retries'].includes(item?.[2]) || item?.[2] === 'exports' && !item[3]);
    requireThat(req.method === (write ? 'POST' : 'GET'), 405, 'METHOD_NOT_ALLOWED');
    let cursor = 0, mode;
    if (list && url.search) {
      const entries = [...url.searchParams];
      requireThat(entries.length === 1 && entries[0][0] === 'cursor' && /^(0|[1-9]\d{0,6})$/.test(entries[0][1]), 400, 'LABEL_CURSOR_INVALID');
      cursor = Number(entries[0][1]);
    } else if (artwork) {
      const entries = [...url.searchParams];
      requireThat(entries.length === 1 && entries[0][0] === 'mode' && ['preview', 'print'].includes(entries[0][1]), 400, 'LABEL_ARTWORK_MODE_INVALID');
      mode = entries[0][1];
    } else requireThat(!url.search, 400, 'LABEL_QUERY_INVALID');
    if (write) {
      requireThat(req.headers.origin === origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')
        && typeof req.headers['x-atlas-csrf'] === 'string' && req.headers['x-atlas-csrf'], 403, 'CSRF_REQUIRED');
      requireThat(Buffer.byteLength(JSON.stringify(req.body ?? {})) <= 8192, 413, 'REQUEST_TOO_LARGE');
    }
    const staff = await boundary.authenticate(req.headers.cookie ?? '', write ? req.headers['x-atlas-csrf'] : undefined);
    const service = connected.labels;
    requireThat(service, 503, 'LABEL_SHEETS_UNAVAILABLE');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (artwork) {
      const result = await service.artwork(staff, { itemId: item[1], mode });
      requireThat(Buffer.isBuffer(result?.bytes) && result.bytes.length > 0 && result.bytes.length <= 1024 * 1024
        && result.contentType === 'image/svg+xml', 503, 'LABEL_ARTWORK_UNAVAILABLE');
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.status(200).send(result.bytes);
      return true;
    }
    let result;
    if (list) result = await service.list(staff, { cursor });
    else if (sheet) {
      const sheetId = sheet[1], exportId = sheet[3];
      if (sheet[5]) result = await service.confirmPrint(staff, sheetId, req.body);
      else if (sheet[4]) result = await service.download(staff, { sheetId, exportId, input: req.body });
      else if (exportId) result = await service.exportStatus(staff, { sheetId, exportId });
      else if (sheet[2]) result = await service.prepareSheetExport(staff, sheetId, req.body);
      else result = await service.sheet(staff, sheetId);
    } else {
      const itemId = item[1], exportId = item[3];
      if (item[2] === 'layout-retries') result = await service.retryLayout(staff, itemId, req.body);
      else if (item[2] === 'reprints') result = await service.reprint(staff, itemId, req.body);
      else if (item[4]) result = await service.download(staff, { itemId, exportId, input: req.body });
      else if (exportId) result = await service.exportStatus(staff, { itemId, exportId });
      else result = await service.prepareIndividualExport(staff, itemId, req.body);
    }
    if (write) void connected.labelWorker?.wake();
    res.status(200).json(result);
    return true;
  };
}
