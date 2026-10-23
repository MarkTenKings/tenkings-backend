import { createCollectionPreferencesClient, preferenceId, preferenceInput, preferenceSameInput, preferenceError } from './collection-preferences-client.mjs';
const copy = value => structuredClone(value);
const need = (ok, code) => { if (!ok) throw preferenceError(code); };
/** One mounted account + optional card. Caller must dispose/assertScope BEFORE
 * render on session object/access/capability changes, tab exit or unmount.
 * No persistence, automatic retries or generic-error reset. An unresolved save
 * is destroyed on access teardown; its destruction never proves it failed. */
export function createCollectionPreferencesController({ session, cardId = null, request = null, onChange = () => {}, onAccessLost = () => {} } = {}) {
  need(session && preferenceId(session.customer?.id) && (cardId === null || preferenceId(cardId)), 'PREFERENCES_ACCESS_ENDED');
  const customer = session.customer, accountId = customer.id, csrf = session.csrf;
  need(typeof csrf === 'string' && csrf.length > 0 && csrf.length <= 512, 'PREFERENCES_ACCESS_ENDED');
  const client = createCollectionPreferencesClient({ request }); let ended = false, generation = 0, active = null, pending = null;
  let view = { phase: client ? 'IDLE' : 'DISABLED', current: null, receipt: null, stale: null, pending: null, recovery: null, error: null };
  const publish = () => onChange(copy(view));
  function dispose() { if (ended) return; ended = true; generation++; active?.abort(); active = null; pending = null;
    view = { phase: 'ENDED', current: null, receipt: null, stale: null, pending: null, recovery: null, error: null }; publish(); }
  const matches = () => !ended && session.customer === customer && customer.id === accountId && session.csrf === csrf;
  function scope() { if (!matches()) dispose(); return !ended; }
  const emit = patch => { if (scope()) { view = { ...view, ...patch }; publish(); } };
  function ready() { need(scope(), 'PREFERENCES_ACCESS_ENDED'); need(client, 'PREFERENCES_NOT_CONFIGURED'); need(!active, 'PREFERENCES_BUSY'); }
  function exactReceipt(value, record) { need(value.outcome === 'RECORDED' && value.receipt.action === record.action
    && preferenceSameInput(value.receipt.input, record.input), 'PREFERENCES_OUTCOME_UNKNOWN'); return value; }
  async function run(phase, work) {
    ready(); const controller = new AbortController(), turn = ++generation; active = controller; emit({ phase, error: null });
    const current = () => scope() && turn === generation && !controller.signal.aborted;
    try { const value = await work(controller.signal); if (!current()) return null; return value; }
    catch (error) {
      if (!current()) return null;
      if (error.code === 'PREFERENCES_ACCESS_ENDED') { dispose(); onAccessLost(); return null; }
      emit({ phase: pending ? 'UNKNOWN' : 'UNAVAILABLE', current: null, error: pending ? 'PREFERENCES_OUTCOME_UNKNOWN' : 'PREFERENCES_UNAVAILABLE' }); return null;
    } finally { if (turn === generation) active = null; }
  }
  async function load() {
    return run('READING', async signal => {
      const value = await client.read({ accountId, cardId, signal }); if (!scope() || signal.aborted) return null;
      // Newer current settings never replace proof of an older request.
      emit({ phase: pending ? 'UNKNOWN' : 'READY', current: value, error: pending ? 'PREFERENCES_OUTCOME_UNKNOWN' : null }); return value;
    });
  }
  async function send(record) {
    return run('SAVING', async signal => {
      const value = await client.write({ accountId, action: record.action, input: record.input, csrf, signal });
      if (!scope() || signal.aborted) return null;
      if (value.schema === 'atlas-ownership-preferences-stale-v1') {
        // Only the SQL-authenticated strictly monotone witness closes this exact
        // request, even if an earlier attempt's reply was lost. No status inference.
        need(value.action === record.action && preferenceSameInput(value.input, record.input), 'PREFERENCES_OUTCOME_UNKNOWN');
        pending = null; emit({ phase: 'STALE_REQUIRES_REFRESH', current: null, receipt: null, stale: value, pending: null, recovery: null, error: 'PREFERENCES_REFRESH_REQUIRED' });
      } else { exactReceipt(value, record); pending = null;
        emit({ phase: 'CONFIRMED', current: null, receipt: value, stale: null, pending: null, recovery: null }); }
      return value;
    });
  }
  async function save(raw) {
    ready(); need(!pending, 'PREFERENCES_RECOVERY_REQUIRED'); need(view.phase === 'READY' && view.current, 'PREFERENCES_READ_REQUIRED');
    need(raw && Object.getPrototypeOf(raw) === Object.prototype && Reflect.ownKeys(raw).length === 3
      && ['requestId', 'visibility', 'offersDisabled'].every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(raw, k) ?? {}, 'value')), 'PREFERENCES_REQUEST_INVALID');
    const action = cardId ? 'set_card_preferences' : 'set_collection_preferences', current = view.current;
    const input = preferenceInput(action, { ...raw, expectedPreferenceRevision: cardId ? current.cardPreferences.revision : current.collectionPreferences.revision,
      ...(cardId ? { cardId, expectedOwnershipRevision: current.cardPreferences.ownershipRevision } : {}) });
    pending = Object.freeze({ action, input });
    emit({ pending: { requestId: input.requestId, action }, receipt: null, stale: null, recovery: null }); return send(pending);
  }
  async function recover() {
    ready(); need(pending, 'PREFERENCES_NO_PENDING_REQUEST'); const record = pending;
    return run('RECOVERING', async signal => {
      const value = await client.recover({ accountId, requestId: record.input.requestId, signal }); if (!scope() || signal.aborted) return null;
      if (value.outcome === 'RECORDED') { exactReceipt(value, record); pending = null;
        emit({ phase: 'CONFIRMED', receipt: value, stale: null, pending: null, recovery: 'RECORDED', error: null }); }
      else emit({ phase: 'UNKNOWN', recovery: 'ABSENT', error: 'PREFERENCES_OUTCOME_UNKNOWN' });
      return value;
    });
  }
  async function retry() { ready(); need(pending, 'PREFERENCES_NO_PENDING_REQUEST'); return send(pending); }
  return Object.freeze({ load, save, recover, retry, dispose, snapshot() { return copy(matches() ? view : { phase: 'ENDED', current: null, receipt: null, stale: null, pending: null, recovery: null, error: null }); },
    isCurrent(nextSession = session, nextRequest = request, nextCardId = cardId, accessState = 'READY') {
      return matches() && nextSession === session && nextRequest === request && nextCardId === cardId && accessState === 'READY';
    },
    assertScope(nextSession, nextRequest = request, nextCardId = cardId, accessState = 'READY') {
      if (nextSession !== session || nextRequest !== request || nextCardId !== cardId || accessState !== 'READY') dispose(); return scope();
    } });
}
