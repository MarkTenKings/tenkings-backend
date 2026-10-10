import { requireThat } from '@atlas/manual-service/contract';

const base = '/api/staff/manual-connected/order-desk';
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const orderRoute = new RegExp(`^${base}/orders/(${uuid})(?:/(acknowledge)|/cards/(${uuid})/photos/(FRONT|BACK))?$`);
const labelRoute = new RegExp(`^${base}/orders/(${uuid})/labels/(INBOUND)$`);

function query(url, allowed) {
  const result = {};
  for (const [key, value] of url.searchParams) {
    requireThat(allowed.includes(key) && !Object.hasOwn(result, key) && value.length <= (key === 'cursor' ? 512 : 160), 400, 'INVALID_ORDER_DESK_QUERY');
    result[key] = value;
  }
  return result;
}

/** Called only after the connected handler validates the signed request. */
export function createOrderDeskHandler({ connected, boundary, origin }) {
  return async (req, res, url) => {
    const list = url.pathname === base, found = orderRoute.exec(url.pathname), label = labelRoute.exec(url.pathname);
    if (!list && !found && !label) return false;
    const write = Boolean(found?.[2]);
    requireThat(req.method === (write ? 'POST' : 'GET'), 405, 'METHOD_NOT_ALLOWED');
    requireThat(connected.orderDesk, 503, 'ORDER_DESK_UNAVAILABLE');
    if (write) {
      requireThat(!url.search, 400, 'INVALID_ORDER_DESK_QUERY');
      requireThat(req.headers.origin === origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')
        && typeof req.headers['x-atlas-csrf'] === 'string' && req.headers['x-atlas-csrf'], 403, 'CSRF_REQUIRED');
      requireThat(req.body && !Array.isArray(req.body) && Object.keys(req.body).length === 1
        && new RegExp(`^${uuid}$`).test(req.body.requestId ?? ''), 400, 'INVALID_ORDER_ACKNOWLEDGMENT');
      requireThat(connected.orderDeskInbox, 503, 'ORDER_DESK_UNAVAILABLE');
    }
    let input;
    if (list) {
      input = query(url, ['q', 'stage', 'view', 'cursor', 'limit']);
      if (input.limit !== undefined) {
        requireThat(/^[1-9]\d?$/.test(input.limit) && Number(input.limit) <= 50, 400, 'INVALID_ORDER_DESK_QUERY');
        input.limit = Number(input.limit);
      }
    } else if (found?.[3]) {
      const options = query(url, ['size']);
      requireThat(options.size === undefined || ['thumbnail', 'detail'].includes(options.size), 400, 'INVALID_ORDER_DESK_QUERY');
      input = { orderId: found[1], cardId: found[3], side: found[4], size: options.size ?? 'thumbnail' };
    } else {
      requireThat(!url.search, 400, 'INVALID_ORDER_DESK_QUERY');
      input = label ? { orderId: label[1], leg: label[2] } : { orderId: found[1], ...(write ? { requestId: req.body.requestId } : {}) };
    }
    const staff = await boundary.authenticate(req.headers.cookie ?? '', write ? req.headers['x-atlas-csrf'] : undefined);
    res.setHeader('Cache-Control', 'private, no-store');
    if (label) {
      const saved = await connected.orderDesk.label(staff, input);
      requireThat(Buffer.isBuffer(saved?.bytes) && saved.bytes.length >= 5 && saved.bytes.length <= 4 * 1024 * 1024
        && saved.contentType === 'application/pdf' && saved.bytes.subarray(0, 5).toString('ascii') === '%PDF-'
        && /^[a-f0-9]{64}$/.test(saved.sha256 ?? ''), 409, 'LABEL_NOT_READY');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-ATLAS-Label-SHA256', saved.sha256);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(saved.bytes);
      return true;
    }
    if (found?.[3]) {
      const photo = await connected.orderDesk.photo(staff, input);
      requireThat(Buffer.isBuffer(photo?.bytes) && photo.bytes.length > 0 && photo.bytes.length <= 4 * 1024 * 1024
        && ['image/jpeg', 'image/png', 'image/webp'].includes(photo.contentType), 503, 'ORDER_PHOTO_UNAVAILABLE');
      res.setHeader('Content-Type', photo.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(photo.bytes);
      return true;
    }
    const result = write ? await connected.orderDeskInbox.acknowledge(staff, input)
      : await connected.orderDesk[list ? 'list' : 'detail'](staff, input);
    res.status(200).json(result);
    return true;
  };
}
