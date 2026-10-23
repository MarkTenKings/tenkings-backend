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
  const evidencePolicies = new Map();
  const policyKey = input => `${input?.approvalActionId}:${input?.previewId}`;
  const current = () => !closed && options.enabled === true && options.staff === staff && options.cardId === cardId
    && options.fetchImpl === fetchImpl && options.events === events && options.isCurrent === isCurrent
    && Reflect.ownKeys(options).every(key => ['enabled','staff','cardId','fetchImpl','events','isCurrent'].includes(key))
    && cardHistoryCompScope(staff, cardId) === binding && isCurrent() === true;
  const close = () => { closed = true; evidencePolicies.clear(); transport?.close(); events.removeEventListener('pagehide', close); };
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
      // Only a validated read from this mounted card may authorize an
      // evidence-policy hash. Historical priced receipts remain readable;
      // this composition cannot author pricing guidance.
      if (route.kind === 'decide') {
        const body = input?.body, evidenceHash = evidencePolicies.get(policyKey(body));
        if (!(body?.expectedPolicyHash !== null && evidenceHash && body.expectedPolicyHash === evidenceHash)
          && !(body?.expectedPolicyHash === null && ['SKIP','NO_SUITABLE_COMPS'].includes(body.outcome)))
          throw curationError('COMP_POLICY_REQUIRED');
      }
      const response = await transport.request(input);
      try {
        if (route.kind === 'read' && response.status === 200) {
          // The response transport has already parsed the exact state shape.
          const state = (await response.clone().json()).result;
          assertCurrent();
          if (state.policy?.version === 'atlas-comp-evidence-selection-policy-v1') evidencePolicies.set(policyKey(route.input), state.policyHash);
        }
        assertCurrent(); return response;
      } catch (error) { discard(response); throw error; }
    },
  });
}
