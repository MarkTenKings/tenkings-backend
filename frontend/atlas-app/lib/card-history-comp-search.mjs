// Explicit browser-only acquisition/status composition. Disabled by default;
// construction and reads never dispatch a search or a public-selection write.
import { cardHistoryCompScope } from './card-history-comp-curation.mjs';
import { curationStaff, curationError } from './staff-comp-curation-client.mjs';
import { staffClientRequest } from './client-request.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const record = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).every(key => keys.includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

export function createCardHistoryCompSearch(options = {}) {
  if (options.enabled !== true) return null;
  const { staff, cardId, fetchImpl, events, isCurrent } = options;
  const binding = cardHistoryCompScope(staff, cardId);
  if (!binding || typeof fetchImpl !== 'function' || typeof isCurrent !== 'function'
    || typeof events?.addEventListener !== 'function' || typeof events?.removeEventListener !== 'function'
    || !record(options, ['enabled', 'staff', 'cardId', 'fetchImpl', 'events', 'isCurrent'])) throw curationError('COMP_NOT_CONFIGURED');
  const actor = JSON.stringify(curationStaff(staff)), path = `/api/staff/manual-connected/cards/${cardId}/presentation`;
  let closed = false;
  const active = new Set();
  const current = () => {
    try { return !closed && options.enabled === true && options.staff === staff && options.cardId === cardId
      && options.fetchImpl === fetchImpl && options.events === events && options.isCurrent === isCurrent
      && record(options, ['enabled', 'staff', 'cardId', 'fetchImpl', 'events', 'isCurrent'])
      && cardHistoryCompScope(staff, cardId) === binding && isCurrent() === true; } catch { return false; }
  };
  const close = () => { closed = true; for (const controller of active) controller.abort(); events.removeEventListener('pagehide', close); };
  const assertCurrent = () => { if (!current()) { close(); throw curationError('COMP_ACCESS_ENDED'); } };
  const session = value => {
    try {
      if (value.status !== 200 || JSON.stringify(curationStaff(value.data?.staff)) !== actor
        || !text(value.data?.csrf, 512) || !text(value.data?.mode, 80)) throw curationError('COMP_ACCESS_ENDED');
    } catch { close(); throw curationError('COMP_ACCESS_ENDED'); }
    return { csrf: value.data.csrf, mode: value.data.mode };
  };
  assertCurrent(); events.addEventListener('pagehide', close);
  return Object.freeze({ close, isCurrent: current,
    async request(target, input = {}) {
      assertCurrent();
      if (!record(input, ['method', 'body', 'signal'])) throw curationError('COMP_REQUEST_INVALID');
      const { method = 'GET', body, signal } = input;
      const read = target === path && method === 'GET' && body === undefined;
      const write = target === `${path}/market/search` && method === 'POST'
        && record(body, ['requestId', 'approvalActionId', 'expectedRevision', 'afterPreviewId'])
        && Reflect.ownKeys(body).length === (Object.hasOwn(body, 'afterPreviewId') ? 4 : 3)
        && (!Object.hasOwn(body, 'afterPreviewId') || uuid(body.afterPreviewId))
        && uuid(body.requestId) && uuid(body.approvalActionId) && Number.isSafeInteger(body.expectedRevision)
        && body.expectedRevision >= 0 && body.expectedRevision <= 2147483646;
      if ((!read && !write) || signal != null && (typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw curationError('COMP_REQUEST_INVALID');
      // Copy before the first await: a retained caller cannot replace an intent
      // while session validation is in flight.
      const payload = write ? { ...body } : undefined, controller = new AbortController();
      const abort = () => controller.abort();
      active.add(controller); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      const timer = setTimeout(abort, 25_000);
      const fetchBound = (...args) => { assertCurrent(); return Reflect.apply(fetchImpl, undefined, args); };
      const send = async (route, args = {}) => {
        assertCurrent();
        const value = await staffClientRequest(route, { ...args, signal: controller.signal }, { fetchImpl: fetchBound });
        assertCurrent();
        if (value.status === 401 || value.status === 403) { close(); throw curationError('COMP_ACCESS_ENDED', value.status); }
        return value;
      };
      try {
        const before = session(await send('session'));
        const response = await send(target.slice('/api/staff/'.length), { body: payload, csrf: before.csrf });
        const after = session(await send('session'));
        if (after.csrf !== before.csrf || after.mode !== before.mode) { close(); throw curationError('COMP_ACCESS_ENDED'); }
        assertCurrent();
        // Only a bounded server denial with a confirmed final session carries
        // HTTP status. Unconfirmed POST outcomes retain the original intent.
        if (!response.ok) throw curationError(response.data.error, response.status);
        return response.data;
      } catch (error) {
        if (!current()) { close(); throw curationError('COMP_ACCESS_ENDED'); }
        throw error;
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); active.delete(controller);
      }
    },
  });
}
