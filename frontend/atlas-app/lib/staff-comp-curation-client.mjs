// Inert browser adapter. A reviewed caller must supply transport; no fetch,
// route registration, market acquisition, storage or operational policy lives here.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const METHOD = 'selected-sold-price-arithmetic-mean-v1';
const EVIDENCE_METHOD = 'private-saved-sold-evidence-v1';
const evidencePolicy = v => v?.version === 'atlas-comp-evidence-selection-policy-v1';
const outcomes = ['SELECTED', 'SKIP', 'NO_SUITABLE_COMPS'];
export const curationError = (code, status) => Object.assign(new Error(code), { code, ...(status ? { status } : {}) });
const check = (ok, code = 'COMP_RESPONSE_INVALID') => { if (!ok) throw curationError(code); };
const shape = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype && Reflect.ownKeys(v).length === keys.length
  && keys.every(k => Object.hasOwn(v, k) && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), 'value'));
const uuid = v => typeof v === 'string' && UUID.test(v);
const hash = v => typeof v === 'string' && HASH.test(v);
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const integer = (v, min = 0, max = 2147483646) => Number.isSafeInteger(v) && v >= min && v <= max;
const date = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v));
export const curationSame = (a, b) => JSON.stringify(sort(a)) === JSON.stringify(sort(b));
function sort(v) { return Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v; }
const copy = v => JSON.parse(JSON.stringify(v));
export function curationStaff(value) {
  check(value && uuid(value.id) && value.role === 'REVIEWER' && text(value.mode, 80), 'COMP_ACCESS_ENDED');
  return { id: value.id, role: value.role, mode: value.mode };
}
export function curationReadInput(value) {
  check(shape(value, ['approvalActionId', 'previewId']) && uuid(value.approvalActionId)
    && (value.previewId === null || uuid(value.previewId)), 'COMP_REQUEST_INVALID');
  return { ...value };
}
export function curationDecisionInput(v) {
  check(shape(v, ['requestId', 'approvalActionId', 'expectedSelectionRevision', 'previewId', 'expectedPreviewHash', 'outcome', 'selectedIds', 'reviewedIds', 'expectedPolicyHash'])
    && uuid(v.requestId) && uuid(v.approvalActionId) && integer(v.expectedSelectionRevision, 0, 2147483645) && outcomes.includes(v.outcome)
    && (v.previewId === null ? v.expectedPreviewHash === null : uuid(v.previewId) && hash(v.expectedPreviewHash))
    && (v.expectedPolicyHash === null || hash(v.expectedPolicyHash)), 'COMP_REQUEST_INVALID');
  for (const key of ['selectedIds', 'reviewedIds']) check(Array.isArray(v[key]) && v[key].length <= 5
    && v[key].every(id => text(id, 180)) && new Set(v[key]).size === v[key].length, 'COMP_REQUEST_INVALID');
  check(v.outcome === 'SELECTED' ? v.previewId !== null && v.expectedPolicyHash !== null && v.selectedIds.length > 0
    && v.selectedIds.length === v.reviewedIds.length && v.selectedIds.every(id => v.reviewedIds.includes(id))
    : v.selectedIds.length === 0 && v.reviewedIds.length === 0, 'COMP_REQUEST_INVALID');
  return { ...v, selectedIds: [...v.selectedIds].sort(), reviewedIds: [...v.reviewedIds].sort() };
}
function binding(v, expected) {
  check(shape(v, ['cardId', 'approvalActionId', 'sourceRevision', 'sourceHash', 'reportHash', 'publicToken', 'publicVersion', 'publicHash', 'mode'])
    && uuid(v.cardId) && uuid(v.approvalActionId) && integer(v.sourceRevision, 1) && hash(v.sourceHash) && hash(v.reportHash)
    && /^ar_[A-Za-z0-9_-]{24}$/.test(v.publicToken) && integer(v.publicVersion, 1) && hash(v.publicHash) && text(v.mode, 80)
    && v.cardId === expected.cardId && v.approvalActionId === expected.approvalActionId && v.mode === expected.mode);
}
function source(v) {
  check(v === null || shape(v, ['previewId', 'requestHash', 'resultHash', 'artifactHash', 'previewHash']) && uuid(v.previewId)
    && ['requestHash', 'resultHash', 'artifactHash', 'previewHash'].every(k => hash(v[k])));
}
function policy(v, policyHash) {
  check(v === null ? policyHash === null : shape(v, ['version', 'status', 'method', 'recencyDays', 'rightsStatus'])
    && v.status === 'LOCAL_PROPOSAL' && v.rightsStatus === 'UNRESOLVED' && hash(policyHash)
    && (evidencePolicy(v) ? v.method === EVIDENCE_METHOD && v.recencyDays === null
      : v.version === 'atlas-comp-curation-policy-v1' && v.method === METHOD && integer(v.recencyDays, 1, 3650)));
}
const reasons = new Set(['IDENTITY_NOT_CONFIRMED', 'MATCH_EVIDENCE_UNRESOLVED', 'MULTI_CARD_OR_REPRODUCTION', 'LISTING_SOURCE_UNAVAILABLE',
  'ACCEPTED_OFFER_UNDISCLOSED', 'SOLD_AMOUNT_UNAVAILABLE', 'CURRENCY_UNAVAILABLE', 'SALE_DATE_UNAVAILABLE', 'SALE_DATE_IN_FUTURE',
  'SALE_OUTSIDE_RECENCY_WINDOW', 'GRADE_EVIDENCE_UNRESOLVED', 'GRADE_DESIGNATION_UNCONFIRMED', 'DUPLICATE_LISTING']);
function listing(v) {
  if (v === null) return true;
  if (!text(v, 2048) || /[\s\\]/.test(v)) return false;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.search && !u.hash
    && /^(?:www\.)?ebay\.(?:com|ca|co\.uk|com\.au|de|fr|it|es|ie|nl|at|be|ch|pl)$/.test(u.hostname)
    && /^\/itm\/(?:[^/]+\/)?\d+(?:\/|$)/.test(u.pathname); } catch { return false; }
}
function candidate(v) {
  check(shape(v, ['id', 'title', 'listingUrl', 'soldAt', 'priceMinor', 'priceBasis', 'currency', 'raw', 'grader', 'grade', 'designation', 'group', 'eligible', 'reasonCodes'])
    && text(v.id, 180) && text(v.title, 500) && listing(v.listingUrl) && (v.soldAt === null || date(v.soldAt))
    && (v.priceMinor === null || integer(v.priceMinor, 1, 2147483647)) && ['sold', 'accepted_offer_unknown', 'unknown'].includes(v.priceBasis)
    && (v.priceBasis === 'sold' ? v.priceMinor !== null : v.priceMinor === null)
    && (v.currency === null || /^[A-Z]{3}$/.test(v.currency)) && typeof v.raw === 'boolean'
    && (v.grader === null || ['PSA', 'BGS', 'SGC', 'CGC', 'ATLAS'].includes(v.grader))
    && (v.grade === null || Number.isFinite(v.grade) && v.grade >= 1 && v.grade <= 10 && v.grade * 2 % 1 === 0)
    && (v.designation === null || text(v.designation, 80)) && text(v.group, 180) && typeof v.eligible === 'boolean'
    && Array.isArray(v.reasonCodes) && v.reasonCodes.length <= reasons.size && v.reasonCodes.every(r => reasons.has(r))
    && new Set(v.reasonCodes).size === v.reasonCodes.length && v.eligible === (v.reasonCodes.length === 0));
  if (v.eligible) check(v.listingUrl !== null && v.soldAt !== null && v.priceMinor !== null && v.currency !== null
    && (v.raw ? v.grader === null && v.grade === null && v.designation === null && v.group === 'RAW / condition unverified'
      : v.grader !== null && v.grade !== null && (v.designation === 'STANDARD' || v.grade === 10
        && (v.designation === 'BLACK_LABEL' && v.grader === 'BGS' || v.designation === 'PRISTINE' && ['BGS', 'CGC'].includes(v.grader)
          || v.designation === 'PERFECT' && v.grader === 'CGC'))
        && v.group === `${v.grader} / ${v.grade} / ${v.designation}`));
}
function guidance(v, selected) {
  check(shape(v, ['status', 'method', 'meanMinor', 'sumMinor', 'sampleCount', 'lowMinor', 'highMinor', 'currency', 'group', 'oldestSaleAt', 'newestSaleAt',
    'excludes', 'rounding', 'askingPriceMinor', 'sellerSetsAskingPrice', 'visibility', 'rightsStatus', 'listingPrice'])
    && v.status === 'LOCAL_PROPOSAL' && v.method === METHOD && v.visibility === 'PRIVATE_INTERNAL' && v.rightsStatus === 'UNRESOLVED'
    && v.askingPriceMinor === null && v.listingPrice === null && v.sellerSetsAskingPrice === true
    && curationSame(v.excludes, ['SHIPPING', 'TAX', 'FEES']) && v.rounding === 'NEAREST_MINOR_UNIT_HALF_UP'
    && selected.length > 0 && selected.every(c => c.eligible && c.currency === v.currency && c.group === v.group));
  const sum = selected.reduce((a, c) => a + c.priceMinor, 0), n = selected.length;
  check(v.sampleCount === n && v.sumMinor === sum && v.meanMinor === Math.floor(sum / n) + (sum % n * 2 >= n ? 1 : 0)
    && v.lowMinor === Math.min(...selected.map(c => c.priceMinor)) && v.highMinor === Math.max(...selected.map(c => c.priceMinor))
    && v.oldestSaleAt === selected.map(c => c.soldAt).sort()[0] && v.newestSaleAt === selected.map(c => c.soldAt).sort().at(-1));
}
export function parseCurationReceipt(v, expected) {
  check(shape(v, ['schema', 'status', 'visibility', 'requestId', 'revision', 'actorId', 'binding', 'source', 'sourceStatus', 'outcome', 'selected',
    'selectedFactsHash', 'asOf', 'policy', 'policyHash', 'guidance', 'reportSnapshotUnaffected'])
    && v.schema === 'atlas-comp-curation-receipt-v1' && v.status === 'LOCAL_PROPOSAL' && v.visibility === 'PRIVATE_INTERNAL'
    && uuid(v.requestId) && uuid(v.actorId) && integer(v.revision, 1) && outcomes.includes(v.outcome) && hash(v.selectedFactsHash)
    && date(v.asOf) && v.reportSnapshotUnaffected === true && Array.isArray(v.selected) && v.selected.length <= 5);
  binding(v.binding, expected); source(v.source); policy(v.policy, v.policyHash);
  check(v.sourceStatus === (v.source === null ? 'NO_SAVED_POOL' : 'SAVED_POOL'));
  v.selected.forEach(candidate); check(new Set(v.selected.map(c => c.id)).size === v.selected.length);
  if (v.outcome === 'SELECTED') {
    check(v.source !== null && v.policy !== null && v.selected.length > 0 && v.selected.every(c => c.eligible)
      && new Set(v.selected.map(c => c.group)).size === 1 && new Set(v.selected.map(c => c.currency)).size === 1);
    if (evidencePolicy(v.policy)) check(v.guidance === null);
    else guidance(v.guidance, v.selected);
  }
  else check(v.selected.length === 0 && v.guidance === null);
  return copy(v);
}
export function parseCurationState(v, expected) {
  check(shape(v, ['schema', 'status', 'visibility', 'binding', 'revision', 'selection', 'source', 'policy', 'policyHash', 'availability', 'preview'])
    && v.schema === 'atlas-comp-curation-state-v1' && v.status === 'LOCAL_PROPOSAL' && v.visibility === 'PRIVATE_INTERNAL' && integer(v.revision));
  binding(v.binding, expected); source(v.source); policy(v.policy, v.policyHash);
  check(v.source === null ? expected.previewId === null : v.source.previewId === expected.previewId);
  check(v.selection === null ? v.revision === 0 : parseCurationReceipt(v.selection, expected).revision === v.revision
    && curationSame(v.selection.binding, v.binding));
  check(v.availability === (v.source === null ? 'NO_SAVED_POOL' : v.policy === null ? 'POLICY_REQUIRED' : 'READY'));
  if (v.availability !== 'READY') check(v.preview === null);
  else {
    const p = v.preview;
    check(shape(p, ['schema', 'binding', 'source', 'policy', 'candidates']) && p.schema === 'atlas-curation-preview-v1'
      && curationSame(p.binding, { cardId: v.binding.cardId, approvalActionId: v.binding.approvalActionId,
        report: { publicToken: v.binding.publicToken, version: v.binding.publicVersion, publicHash: v.binding.publicHash } })
      && shape(p.source, ['previewId', 'sourceHash', 'observedAt']) && p.source.previewId === v.source.previewId
      && p.source.sourceHash === v.source.previewHash && date(p.source.observedAt)
      && shape(p.policy, ['asOf', 'recencyDays', 'method', 'status']) && date(p.policy.asOf) && p.policy.recencyDays === v.policy.recencyDays
      && p.policy.method === v.policy.method && p.policy.status === 'LOCAL_PROPOSAL' && Array.isArray(p.candidates) && p.candidates.length <= 1000);
    p.candidates.forEach(candidate); check(new Set(p.candidates.map(c => c.id)).size === p.candidates.length);
  }
  return copy(v);
}
export function parseCurationResponse(v, { staff, cardId, input, action }) {
  const actor = curationStaff(staff);
  check(shape(v, ['schema', 'staff', 'result']) && v.schema === 'atlas-staff-comp-curation-response-v1');
  check(curationSame(v.staff, actor), 'COMP_ACCESS_ENDED');
  const expected = { cardId, approvalActionId: input.approvalActionId, previewId: input.previewId, mode: actor.mode };
  const result = action === 'read' ? parseCurationState(v.result, expected) : parseCurationReceipt(v.result, expected);
  if (action === 'decide') check(result.actorId === actor.id && result.requestId === input.requestId
    && result.revision === input.expectedSelectionRevision + 1 && result.outcome === input.outcome
    && curationSame(result.selected.map(c => c.id).sort(), input.selectedIds)
    && (result.source === null ? input.previewId === null : result.source.previewId === input.previewId && result.source.previewHash === input.expectedPreviewHash)
    && (input.expectedPolicyHash === null || result.policyHash === input.expectedPolicyHash));
  return result;
}

function interruptible(work, signal, late) {
  return new Promise((resolve, reject) => {
    let ended = false;
    const abort = () => { signal.removeEventListener('abort', abort); if (!ended) { ended = true; reject(curationError('COMP_CANCELLED')); } };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    Promise.resolve(work).then(value => { signal.removeEventListener('abort', abort); if (ended) { late?.(value); return; } ended = true; resolve(value); },
      error => { signal.removeEventListener('abort', abort); if (!ended) { ended = true; reject(error); } });
  });
}
const discard = response => { try { void response?.body?.cancel().catch(() => {}); } catch {} };
/** request receives a relative proposed path and JSON only. Future wiring owns
 * cookie credentials and real CSRF headers. Merely importing this is disabled. */
export function createStaffCompCurationClient({ request } = {}) {
  async function call(action, { staff, cardId, input: raw, signal } = {}) {
    if (typeof request !== 'function') throw curationError('COMP_NOT_CONFIGURED');
    const actor = curationStaff(staff); check(uuid(cardId), 'COMP_REQUEST_INVALID');
    const input = action === 'read' ? curationReadInput(raw) : curationDecisionInput(raw);
    const controller = new AbortController(), abort = () => controller.abort();
    if (signal?.aborted) throw curationError('COMP_CANCELLED');
    signal?.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, 25000);
    let response;
    try {
      const path = `/api/staff/comp-curation/cards/${cardId}` + (action === 'decide' ? '/decision' : `?approvalActionId=${input.approvalActionId}&previewId=${input.previewId ?? 'none'}`);
      response = await interruptible(Promise.resolve().then(() => {
        if (controller.signal.aborted) throw curationError('COMP_CANCELLED');
        return request({ method: action === 'read' ? 'GET' : 'POST', path, ...(action === 'decide' ? { body: input } : {}), signal: controller.signal });
      }), controller.signal, discard);
      if ([401, 403].includes(response?.status)) throw curationError('COMP_ACCESS_ENDED', response.status);
      check(response?.ok && response.body && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')
        && /\bprivate\b/i.test(response.headers.get('cache-control') ?? '') && /\bno-store\b/i.test(response.headers.get('cache-control') ?? ''));
      const reader = response.body.getReader(), chunks = []; let size = 0;
      const cancel = () => { try { void reader.cancel().catch(() => {}); } catch {} };
      controller.signal.addEventListener('abort', cancel, { once: true });
      try {
        while (true) {
          const { done, value } = await interruptible(reader.read(), controller.signal); if (done) break;
          size += value.byteLength; check(size <= 2097152); chunks.push(value);
        }
      } finally { controller.signal.removeEventListener('abort', cancel); cancel(); try { reader.releaseLock(); } catch {} }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return parseCurationResponse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), { staff: actor, cardId, input, action });
    } catch (error) {
      if (error.code === 'COMP_ACCESS_ENDED') throw error;
      // A proxy failure, timeout or refused HTTP status does not prove rollback.
      throw curationError(action === 'decide' ? 'COMP_OUTCOME_UNKNOWN' : signal?.aborted ? 'COMP_CANCELLED' : 'COMP_UNAVAILABLE');
    } finally { discard(response); clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return Object.freeze({ read: options => call('read', options), decide: options => call('decide', options) });
}
