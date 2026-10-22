// Explicit browser-only Card History composition. No default fetch, pricing
// policy, acquisition, route registration or work on import.
import { historyCardId } from './card-history-client.mjs';
import { curationStaff, curationError } from './staff-comp-curation-client.mjs';
import { requireCompTransportRoute } from './staff-comp-curation-transport-contract.mjs';
import { createStaffCompCurationResponseTransport } from './staff-comp-curation-response-transport.mjs';

export function cardHistoryCompScope(staff, cardId) {
  try { return historyCardId(cardId) ? JSON.stringify([curationStaff(staff), cardId]) : null; } catch { return null; }
}
const discard = value => { try { void Promise.resolve(value?.body?.cancel()).catch(() => {}); } catch {} };

export function createCardHistoryCompCuration(options = {}) {
  if (options.enabled !== true) return null;
  const { staff, cardId, fetchImpl, events, isCurrent } = options;
  const binding = cardHistoryCompScope(staff, cardId);
  if (!binding || typeof fetchImpl !== 'function' || typeof isCurrent !== 'function'
    || typeof events?.addEventListener !== 'function' || typeof events?.removeEventListener !== 'function') throw curationError('COMP_NOT_CONFIGURED');
  let closed = false, transport;
  const current = () => !closed && options.enabled === true && options.staff === staff && options.cardId === cardId
    && options.fetchImpl === fetchImpl && options.events === events && options.isCurrent === isCurrent
    && Reflect.ownKeys(options).every(key => ['enabled','staff','cardId','fetchImpl','events','isCurrent'].includes(key))
    && cardHistoryCompScope(staff, cardId) === binding && isCurrent() === true;
  const close = () => { closed = true; transport?.close(); events.removeEventListener('pagehide', close); };
  const assertCurrent = () => { if (!current()) { close(); throw curationError('COMP_ACCESS_ENDED'); } };
  assertCurrent();
  transport = createStaffCompCurationResponseTransport({ enabled: true, staff, events,
    fetchImpl(...args) { assertCurrent(); return Reflect.apply(fetchImpl, undefined, args); } });
  events.addEventListener('pagehide', close);
  return Object.freeze({ close, isCurrent: current,
    async request(input) {
      assertCurrent();
      const route = requireCompTransportRoute(input?.path, { includeReads: true });
      if (route.cardId && route.cardId !== cardId) throw curationError('COMP_REQUEST_INVALID');
      // The pilot composition has no operational pricing policy. Existing
      // saved reads/receipts remain readable, but it cannot author guidance.
      if (route.kind === 'decide' && (!['SKIP','NO_SUITABLE_COMPS'].includes(input?.body?.outcome)
        || input.body.expectedPolicyHash !== null)) throw curationError('COMP_POLICY_REQUIRED');
      const response = await transport.request(input);
      try { assertCurrent(); return response; } catch (error) { discard(response); throw error; }
    },
  });
}
