// Inactive browser-only preference boundary. No default fetch, storage, account
// authority, generic ownership actions, automatic retry or refusal inference.
export const PREFERENCE_LIMITS = Object.freeze({ responseBytes: 32768, timeoutMs: 25000 });
export const preferenceError = (code = 'PREFERENCES_UNAVAILABLE', status) => Object.assign(new Error(code), { code, ...(status ? { status } : {}) });
const need = (ok, code = 'PREFERENCES_UNAVAILABLE') => { if (!ok) throw preferenceError(code); };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const preferenceId = v => typeof v === 'string' && UUID.test(v);
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).length === keys.length
  && keys.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, 'value'));
const rev = v => Number.isSafeInteger(v) && v >= 0 && v <= 2147483647;
const visibility = v => v === 'PRIVATE' || v === 'PUBLIC';
const date = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v) && Number.isFinite(Date.parse(v));
const shapes = { read_access: [], read_preferences: [], read_card: ['cardId'], recover_request: ['requestId'],
  set_collection_preferences: ['requestId', 'expectedPreferenceRevision', 'visibility', 'offersDisabled'],
  set_card_preferences: ['requestId', 'cardId', 'expectedOwnershipRevision', 'expectedPreferenceRevision', 'visibility', 'offersDisabled'] };
export const preferenceWrite = action => action === 'set_collection_preferences' || action === 'set_card_preferences';
export function preferenceInput(action, value) {
  need(Object.hasOwn(shapes, action) && exact(value, shapes[action]), 'PREFERENCES_REQUEST_INVALID');
  const out = Object.fromEntries(shapes[action].map(k => [k, value[k]]));
  for (const k of ['requestId', 'cardId']) if (Object.hasOwn(out, k)) need(preferenceId(out[k]), 'PREFERENCES_REQUEST_INVALID');
  for (const k of ['expectedOwnershipRevision', 'expectedPreferenceRevision']) if (Object.hasOwn(out, k)) need(rev(out[k]) && out[k] < 2147483647, 'PREFERENCES_REQUEST_INVALID');
  if (preferenceWrite(action)) need(visibility(out.visibility) && typeof out.offersDisabled === 'boolean', 'PREFERENCES_REQUEST_INVALID');
  return Object.freeze(out);
}
export const preferenceSameInput = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => a[k] === b[k]);
const prefs = (v, accountId) => {
  need(exact(v, ['accountId', 'revision', 'visibility', 'offersDisabled']) && v.accountId === accountId && rev(v.revision) && visibility(v.visibility) && typeof v.offersDisabled === 'boolean');
  return { ...v };
};
/** Parses ALREADY projected service values. Differential tests bind this browser
 * implementation to the unchanged server projector; the session supplies aid. */
export function parsePreferenceResult(value, accountId, action, raw) {
  const input = preferenceInput(action, raw);
  need(preferenceId(accountId) && value?.accountId === accountId, 'PREFERENCES_ACCESS_ENDED');
  need(date(value.observedAt));
  const base = { schema: value.schema, accountId, observedAt: value.observedAt };
  if (value.schema === 'atlas-ownership-preferences-stale-v1') {
    need(preferenceWrite(action) && exact(value, ['schema', 'accountId', 'observedAt', 'outcome', 'requestId', 'action', 'cardId', 'input', 'observedPreferenceRevision'])
      && value.outcome === 'NOT_APPLIED_STALE' && value.requestId === input.requestId && value.action === action && value.cardId === (input.cardId ?? null)
      && rev(value.observedPreferenceRevision) && value.observedPreferenceRevision > input.expectedPreferenceRevision);
    const original = preferenceInput(action, value.input); need(preferenceSameInput(original, input));
    return { ...base, outcome: 'NOT_APPLIED_STALE', requestId: input.requestId, action, cardId: input.cardId ?? null, input: original,
      observedPreferenceRevision: value.observedPreferenceRevision };
  }
  if (action === 'read_access') {
    need(exact(value, ['schema', 'accountId', 'observedAt']) && value.schema === 'atlas-ownership-preferences-access-v1'); return base;
  }
  if (action === 'read_preferences' || action === 'read_card') {
    need(exact(value, ['schema', 'accountId', 'observedAt', 'collectionPreferences', 'cardPreferences', 'effective']) && value.schema === 'atlas-ownership-preferences-current-v1');
    const collectionPreferences = prefs(value.collectionPreferences, accountId); let cardPreferences = null;
    if (action === 'read_card') {
      const c = value.cardPreferences;
      need(exact(c, ['cardId', 'ownershipRevision', 'revision', 'visibility', 'offersDisabled']) && c.cardId === input.cardId
        && rev(c.ownershipRevision) && c.ownershipRevision > 0 && rev(c.revision) && visibility(c.visibility) && typeof c.offersDisabled === 'boolean'); cardPreferences = { ...c };
    } else need(value.cardPreferences === null);
    const effective = { visibility: collectionPreferences.visibility === 'PRIVATE' || cardPreferences?.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
      preference: collectionPreferences.offersDisabled || cardPreferences?.offersDisabled ? 'DISABLED' : 'OPEN_TO_OFFERS', canReceiveOffers: false, notificationDelivery: 'NOT_REQUESTED' };
    need(exact(value.effective, Object.keys(effective)) && preferenceSameInput(value.effective, effective));
    return { ...base, collectionPreferences, cardPreferences, effective };
  }
  need(exact(value, ['schema', 'accountId', 'observedAt', 'requestId', 'outcome', 'receipt']) && value.schema === 'atlas-ownership-preferences-receipt-v1' && value.requestId === input.requestId);
  if (value.receipt === null) {
    need(action === 'recover_request' && value.outcome === 'ABSENT'); return { ...base, requestId: input.requestId, outcome: 'ABSENT', receipt: null };
  }
  const r = value.receipt;
  need(value.outcome === 'RECORDED' && exact(r, ['eventId', 'requestId', 'action', 'kind', 'cardId', 'input', 'preferenceRevision', 'recordedAt'])
    && preferenceId(r.eventId) && r.requestId === input.requestId && preferenceWrite(r.action) && date(r.recordedAt)
    && Date.parse(r.recordedAt) <= Date.parse(value.observedAt) && r.kind === (r.action === 'set_card_preferences' ? 'CARD_PREFERENCES_SET' : 'COLLECTION_PREFERENCES_SET'));
  const saved = preferenceInput(r.action, r.input);
  need(saved.requestId === r.requestId && r.cardId === (r.action === 'set_card_preferences' ? saved.cardId : null)
    && rev(r.preferenceRevision) && r.preferenceRevision === saved.expectedPreferenceRevision + 1);
  if (action !== 'recover_request') need(r.action === action && preferenceSameInput(saved, input));
  return { ...base, requestId: input.requestId, outcome: 'RECORDED', receipt: { ...r, input: saved } };
}
const ROOT = '/account/api/customer/collection/';
const currentPath = cardId => cardId === null ? ROOT + 'preferences' : ROOT + `cards/${cardId}/preferences`;
const discard = value => { try { void Promise.resolve(value?.body?.cancel()).catch(() => {}); } catch { /* closed */ } };
function interrupted(work, signal, late) {
  let abort; const promise = Promise.resolve(work);
  promise.then(value => { if (signal.aborted) late?.(value); }, () => {});
  const stopped = new Promise((_, reject) => { abort = () => reject(preferenceError('PREFERENCES_CANCELLED')); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
  return Promise.race([promise, stopped]).finally(() => signal.removeEventListener('abort', abort));
}
async function body(response, signal) {
  const length = response.headers.get('content-length');
  need(length === null || /^(0|[1-9][0-9]*)$/.test(length) && Number(length) <= PREFERENCE_LIMITS.responseBytes);
  need(response.body && typeof response.body.getReader === 'function');
  const reader = response.body.getReader(), parts = []; let total = 0;
  const cancel = () => { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* closed */ } };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) { const r = await interrupted(reader.read(), signal); if (r.done) break;
      need(r.value instanceof Uint8Array); total += r.value.byteLength; need(total <= PREFERENCE_LIMITS.responseBytes); parts.push(r.value); }
    need(length === null || Number(length) === total); const data = new Uint8Array(total); let offset = 0;
    for (const part of parts) { data.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } finally { signal.removeEventListener('abort', cancel); cancel(); try { reader.releaseLock(); } catch { /* pending read */ } }
}
export function createCollectionPreferencesClient({ request = null } = {}) {
  if (request === null) return null;
  need(typeof request === 'function');
  async function call(accountId, action, raw, csrf, signal) {
    need(preferenceId(accountId), 'PREFERENCES_ACCESS_ENDED'); const input = preferenceInput(action, raw), writing = preferenceWrite(action);
    if (writing) need(typeof csrf === 'string' && csrf.length > 0 && csrf.length <= 512, 'PREFERENCES_REQUEST_INVALID');
    need(signal === undefined || signal instanceof AbortSignal);
    const path = action === 'recover_request' ? ROOT + `preference-requests/${input.requestId}` : currentPath(input.cardId ?? null);
    const controller = new AbortController(), cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, PREFERENCE_LIMITS.timeoutMs); let response;
    try {
      response = await interrupted(Promise.resolve().then(() => { controller.signal.throwIfAborted(); return request(path, { method: writing ? 'POST' : 'GET',
        credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { accept: 'application/json', ...(writing ? { 'content-type': 'application/json', 'x-atlas-customer-csrf': csrf } : {}) }, ...(writing ? { body: JSON.stringify(input) } : {}) }); }), controller.signal, discard);
      if ([401, 403].includes(response.status)) throw preferenceError('PREFERENCES_ACCESS_ENDED', response.status);
      need(response.status === 200 && response.ok && !response.redirected && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')
        && /\bprivate\b/i.test(response.headers.get('cache-control') ?? '') && /\bno-store\b/i.test(response.headers.get('cache-control') ?? ''));
      return parsePreferenceResult(await body(response, controller.signal), accountId, action, input);
    } catch (error) {
      if (error.code === 'PREFERENCES_ACCESS_ENDED') throw error;
      throw preferenceError(signal?.aborted ? 'PREFERENCES_CANCELLED' : 'PREFERENCES_UNAVAILABLE');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); discard(response); }
  }
  return Object.freeze({ read: ({ accountId, cardId = null, signal }) => { need(cardId === null || preferenceId(cardId)); return call(accountId, cardId ? 'read_card' : 'read_preferences', cardId ? { cardId } : {}, undefined, signal); },
    recover: ({ accountId, requestId, signal }) => call(accountId, 'recover_request', { requestId }, undefined, signal),
    write: ({ accountId, action, input, csrf, signal }) => { need(preferenceWrite(action), 'PREFERENCES_REQUEST_INVALID'); return call(accountId, action, input, csrf, signal); } });
}
