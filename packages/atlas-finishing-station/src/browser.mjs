// Browser-safe relay. Credentials stay in this module's memory. Saved request
// identities contain no keys and fence a second card until exact reconciliation.
const BASE = 'http://127.0.0.1:47664', HOST = '/api/staff/manual-connected/stations';
const STORAGE = 'atlas:finishing-station:v1';
const secret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43,192}$/.test(value);
const check = (value, code) => { if (!value) throw Object.assign(new Error(code), { code }); };
export function stationMessage(error) {
  return ({ STATION_PAIRING_REQUIRED: 'Open the station launcher to reconnect this browser.',
    STATION_SETUP_PENDING: 'Station setup is pending.', STATION_PREVIOUS_CARD_UNRESOLVED: 'Finish or recover the previous card first.',
    STATION_PERSISTENCE_REQUIRED: 'Browser recovery storage is unavailable. Station dispatch is paused.',
    STATION_ARM_BINDING_INVALID: 'The saved approval changed. Open its current report.',
  })[error?.code] ?? 'Station needs attention. Check the saved operation before continuing.';
}
export function createStationBrowserClient({ fetchImpl = fetch, request, storage, uuid = () => crypto.randomUUID() }) {
  let credential = null, local = null, selected = false, pending = null, requester = request, busy = false;
  const listeners = new Set();
  try { const saved = JSON.parse(storage.getItem(STORAGE) ?? 'null'); if (saved?.version === 1) { selected = saved.selected === true; pending = saved.pending ?? null; } } catch { /* No effect before explicit persistence succeeds. */ }
  const snapshot = () => ({ selected, paired: Boolean(credential), local, pending: pending ? { planHash: pending.planHash, cardId: pending.body.cardId, approvalActionId: pending.body.approvalActionId } : null });
  const changed = () => { for (const listener of listeners) listener(snapshot()); };
  function persist(nextSelected = selected, nextPending = pending) {
    try { const text = JSON.stringify({ version: 1, selected: nextSelected, pending: nextPending }); storage.setItem(STORAGE, text); check(storage.getItem(STORAGE) === text, 'STATION_PERSISTENCE_REQUIRED'); }
    catch { check(false, 'STATION_PERSISTENCE_REQUIRED'); }
    selected = nextSelected; pending = nextPending; changed();
  }
  async function localRequest(path, body) {
    check(path === '/pair' || credential, 'STATION_PAIRING_REQUIRED');
    const response = await fetchImpl(`${BASE}/v1${path}`, { method: body === undefined ? 'GET' : 'POST', mode: 'cors', credentials: 'omit',
      cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000),
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(credential && path !== '/pair' ? { 'x-atlas-station-token': credential } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); check(text.length <= 131072, 'STATION_RESPONSE_INVALID');
    let value; try { value = JSON.parse(text); } catch { check(false, 'STATION_RESPONSE_INVALID'); }
    if (!response.ok || value.ok !== true) throw Object.assign(new Error('Station request refused'), { code: value?.error?.code ?? 'STATION_UNAVAILABLE', status: response.status }); return value.result;
  }
  async function relay(operation) {
    if (operation.write) {
      const authorization = await requester(`${HOST}/acknowledge`, { method: 'POST', body: operation.write });
      operation = await localRequest('/acknowledge', { authorization });
    }
    if (operation.removal) {
      const authorization = await requester(`${HOST}/complete`, { method: 'POST', body: operation.removal });
      operation = await localRequest('/acknowledge', { authorization });
    }
    if (operation.completed && pending?.planHash === operation.planHash) persist(selected, null);
    local = operation.completed ? await localRequest('/status') : { ...local, state: 'BUSY', activePlanHash: operation.planHash }; changed(); return operation;
  }
  async function resumePending() {
    let saved, missing = false;
    try { saved = await localRequest('/operation', { planHash: pending.planHash }); }
    catch (error) { if (error.status !== 404 || error.code !== 'STATION_INTENT_MISSING') throw error; missing = true; }
    if (!missing) { check(saved && typeof saved === 'object', 'STATION_RESPONSE_INVALID'); return relay(saved); }
    const armed = await requester(`${HOST}/arm`, { method: 'POST', body: pending.body });
    check(armed.plan?.planHash === pending.planHash, 'STATION_ARM_BINDING_INVALID'); return relay(await localRequest('/prepare', armed));
  }
  const client = {
    snapshot, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, setRequest(fn) { requester = fn; },
    async pair(code) {
      check(secret(code), 'STATION_PAIRING_INVALID');
      const result = await localRequest('/pair', { pairingCode: code }); check(secret(result.credential), 'STATION_RESPONSE_INVALID');
      credential = result.credential; const { credential: ignored, ...status } = result; local = status; changed(); return snapshot();
    },
    async read() { local = await localRequest('/status'); changed(); return snapshot(); },
    async enroll() {
      check(credential && local?.protectedKey, 'STATION_SETUP_PENDING');
      const hosted = await requester(HOST); check(hosted.enabled === true, 'STATION_SETUP_PENDING');
      const challenge = await requester(`${HOST}/challenge`, { method: 'POST', body: { requestId: uuid(), stationId: local.stationId } });
      const proof = await localRequest('/enrollment-proof', { authorization: challenge.authorization });
      const enrolled = await requester(`${HOST}/enroll`, { method: 'POST', body: proof });
      local = await localRequest('/enroll', { authorization: enrolled.authorization }); changed(); return snapshot();
    },
    select(value) {
      check(!busy && !pending && !local?.activePlanHash, 'STATION_PREVIOUS_CARD_UNRESOLVED');
      check(!value || credential && local?.ready === true && local.state === 'READY', 'STATION_SETUP_PENDING'); persist(value);
    },
    async finish(plan, staffId) {
      check(!busy, 'STATION_PREVIOUS_CARD_UNRESOLVED'); busy = true;
      try {
        check(selected && credential && local?.ready === true, 'STATION_SETUP_PENDING');
        check(!pending || pending.planHash === plan.planHash && pending.staffId === staffId, 'STATION_PREVIOUS_CARD_UNRESOLVED');
        if (pending) return await resumePending();
        if (!pending) {
          check(!local.activePlanHash || local.activePlanHash === plan.planHash, 'STATION_PREVIOUS_CARD_UNRESOLVED');
          check(typeof staffId === 'string' && staffId.length > 0, 'STATION_STAFF_REQUIRED');
          persist(true, { staffId, planHash: plan.planHash, body: { requestId: uuid(), stationId: local.stationId, enrollmentId: local.enrollmentId,
            cardId: plan.binding.cardId, approvalActionId: plan.binding.approvalActionId, physicalCardPresent: true } });
        }
        const armed = await requester(`${HOST}/arm`, { method: 'POST', body: pending.body });
        check(armed.plan?.planHash === plan.planHash && armed.association?.planHash === plan.planHash, 'STATION_ARM_BINDING_INVALID');
        return await relay(await localRequest('/prepare', armed));
      } finally { busy = false; }
    },
    async operation(planHash) {
      if (busy) return null; busy = true;
      try { return await relay(await localRequest('/operation', { planHash })); } finally { busy = false; }
    },
    async resume(staffId) {
      check(pending && pending.staffId === staffId && !busy, 'STATION_PREVIOUS_CARD_UNRESOLVED'); busy = true;
      try { return await resumePending(); } finally { busy = false; }
    },
    forgetCredential() { credential = null; local = null; changed(); },
  }; return Object.freeze(client);
}

let current = null;
export function configureStationBrowserClient(options) {
  if (!current) current = createStationBrowserClient(options); else current.setRequest(options.request); return current;
}
export const currentStationBrowserClient = () => current;
export function clearStationBrowserCredential() { current?.forgetCredential(); }
export function stationApprovalTarget() {
  if (!current?.snapshot().selected) return null;
  let closed = false;
  return Object.freeze({ type: 'atlas-native-finishing-target-v1', get closed() { return closed; }, close() { closed = true; } });
}
export const isStationApprovalTarget = value => value?.type === 'atlas-native-finishing-target-v1';

/** Remove the one-use secret before any request or React rendering. */
export function takeStationPairingCode(location, history) {
  const params = new URLSearchParams(location.hash.slice(1)), code = params.get('atlasStationPair');
  if (params.has('atlasStationPair') || params.has('atlasStationLaunch')) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  return params.get('atlasStationLaunch') === 'v1' && secret(code) ? code : null;
}
