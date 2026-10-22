// Browser-only consumer of the CUSTOMER list_claims projection. The qualified
// server projector remains server-only (its dependency imports node:crypto).
// Differential tests bind this parser to that projector; this is no authority.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const failure = (code, status) => Object.assign(new Error(code), { code, ...(status ? { status } : {}) });
const check = ok => { if (!ok) throw failure('OWNERSHIP_CLAIMS_UNAVAILABLE'); };
export const ownershipClaimsAccount = value => typeof value === 'string' && UUID.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const shape = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const date = value => typeof value === 'string' && value.length <= 80 && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const hash = value => typeof value === 'string' && HASH.test(value);
const availability = ['AVAILABLE', 'EXPIRED', 'POLICY_CHANGED', 'POLICY_UNAVAILABLE', 'UNAVAILABLE'];

// A fixture or future transport can ignore AbortSignal. Still settle this
// reader promptly, and dispose a response that arrives after cancellation.
function interruptible(work, signal, late) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const abort = () => { signal.removeEventListener('abort', abort); if (!finished) { finished = true; reject(failure('OWNERSHIP_CLAIMS_CANCELLED')); } };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(work).then(value => {
      signal.removeEventListener('abort', abort);
      if (finished) { late?.(value); return; }
      finished = true; resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      if (!finished) { finished = true; reject(error); }
    });
  });
}
const discardBody = response => { try { void response?.body?.cancel().catch(() => {}); } catch {} };

export function ownershipClaimsRequest(value = { afterClaimId: null, limit: 25 }) {
  if (!shape(value, ['afterClaimId', 'limit']) || !(value.afterClaimId === null || ownershipClaimsAccount(value.afterClaimId))
    || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 50) throw failure('OWNERSHIP_CLAIMS_REQUEST_INVALID');
  return { afterClaimId: value.afterClaimId, limit: value.limit };
}

function card(value, cardId) {
  if (value === null) return null;
  check(shape(value, ['cardId', 'approvalActionId', 'approvalReportHash', 'certificateNumber', 'report'])
    && value.cardId === cardId && ownershipClaimsAccount(value.approvalActionId) && hash(value.approvalReportHash)
    && typeof value.certificateNumber === 'string' && /^ATLAS-[A-F0-9]{12}$/.test(value.certificateNumber)
    && shape(value.report, ['publicToken', 'version', 'publicHash'])
    && typeof value.report.publicToken === 'string' && /^ar_[A-Za-z0-9_-]{24}$/.test(value.report.publicToken)
    && Number.isSafeInteger(value.report.version) && value.report.version > 0 && value.report.version < 2147483647 && hash(value.report.publicHash));
  return { cardId, approvalActionId: value.approvalActionId, approvalReportHash: value.approvalReportHash,
    certificateNumber: value.certificateNumber, report: { ...value.report } };
}

function claim(value) {
  check(shape(value, ['claimId', 'cardId', 'requestId', 'submittedAt', 'card', 'decision', 'evidence', 'reviewStatus', 'actions', 'currentlyOwnedByYou'])
    && ownershipClaimsAccount(value.claimId) && ownershipClaimsAccount(value.cardId) && ownershipClaimsAccount(value.requestId) && date(value.submittedAt)
    && shape(value.decision, ['state', 'decidedAt']) && ['PENDING', 'VERIFIED', 'REJECTED'].includes(value.decision.state)
    && (value.decision.state === 'PENDING' ? value.decision.decidedAt === null : date(value.decision.decidedAt))
    && shape(value.evidence, ['referenceId', 'availability', 'usableUntil', 'proofKind']) && availability.includes(value.evidence.availability)
    && (value.evidence.referenceId === null || ownershipClaimsAccount(value.evidence.referenceId))
    && (value.evidence.usableUntil === null || date(value.evidence.usableUntil))
    && (value.evidence.proofKind === null || typeof value.evidence.proofKind === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(value.evidence.proofKind))
    && typeof value.currentlyOwnedByYou === 'boolean');
  const boundCard = card(value.card, value.cardId), present = value.evidence.referenceId !== null;
  check(present === (value.evidence.usableUntil !== null) && present === (value.evidence.proofKind !== null)
    && (value.evidence.availability === 'UNAVAILABLE' || present));
  const ready = boundCard !== null && value.evidence.availability === 'AVAILABLE';
  const status = value.decision.state !== 'PENDING' ? 'DECIDED' : ready ? 'PENDING' : 'BLOCKED';
  check(value.reviewStatus === status && shape(value.actions, ['downloadEvidence']) && value.actions.downloadEvidence === ready);
  return { claimId: value.claimId, cardId: value.cardId, requestId: value.requestId, submittedAt: value.submittedAt, card: boundCard,
    decision: { ...value.decision }, evidence: { ...value.evidence }, reviewStatus: status,
    actions: { downloadEvidence: ready }, currentlyOwnedByYou: value.currentlyOwnedByYou };
}

/** Only own history. A verified historical claim does not establish title. */
export function parseOwnershipClaimsPage(value, accountId, request = { afterClaimId: null, limit: 25 }) {
  const input = ownershipClaimsRequest(request);
  if (!ownershipClaimsAccount(accountId) || !record(value) || value.accountId !== accountId) throw failure('OWNERSHIP_CLAIMS_ACCESS_ENDED');
  check(shape(value, ['schema', 'accountId', 'observedAt', 'claims', 'nextClaimId'])
    && value.schema === 'atlas-ownership-claims-v1' && date(value.observedAt) && Array.isArray(value.claims) && value.claims.length <= input.limit
    && (value.nextClaimId === null || ownershipClaimsAccount(value.nextClaimId)));
  const claims = value.claims.map(claim);
  check(claims.every((entry, index) => (input.afterClaimId === null || entry.claimId > input.afterClaimId)
    && (!index || entry.claimId > claims[index - 1].claimId)));
  // Customer SQL returns every scanned history row, including unavailable
  // cards. Unlike reviewer queues, it cannot skip rows after ACL filtering.
  check(value.nextClaimId === null || claims.length === input.limit && value.nextClaimId === claims.at(-1).claimId);
  return { schema: value.schema, accountId, observedAt: value.observedAt, claims, nextClaimId: value.nextClaimId };
}

/** Explicit transport injection only: there is no default URL, fetch, auth
 * bootstrap, storage or writer. Future route wiring supplies a same-origin GET
 * that returns a Response. accountId stays local and is never transport input.
 * The component independently validates injected fixture readers as well. */
export function createOwnershipClaimsReader(requestPage) {
  if (typeof requestPage !== 'function') throw failure('OWNERSHIP_CLAIMS_ADAPTER_INVALID');
  return async ({ accountId, afterClaimId = null, limit = 25, signal } = {}) => {
    if (!ownershipClaimsAccount(accountId)) throw failure('OWNERSHIP_CLAIMS_ACCESS_ENDED');
    const input = ownershipClaimsRequest({ afterClaimId, limit }), controller = new AbortController();
    if (signal?.aborted) throw failure('OWNERSHIP_CLAIMS_CANCELLED');
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 25000);
    let received;
    try {
      const response = received = await interruptible(Promise.resolve().then(() => {
        if (controller.signal.aborted) throw failure('OWNERSHIP_CLAIMS_CANCELLED');
        return requestPage({ ...input, signal: controller.signal });
      }), controller.signal, discardBody);
      if (controller.signal.aborted) throw failure('OWNERSHIP_CLAIMS_CANCELLED');
      if (response.status === 401 || response.status === 403) throw failure('OWNERSHIP_CLAIMS_ACCESS_ENDED', response.status);
      check(response.ok && response.body && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')
        && /\bprivate\b/i.test(response.headers.get('cache-control') ?? '') && /\bno-store\b/i.test(response.headers.get('cache-control') ?? ''));
      const reader = response.body.getReader(), parts = []; let length = 0;
      const cancelBody = () => { try { void reader.cancel().catch(() => {}); } catch {} };
      controller.signal.addEventListener('abort', cancelBody, { once: true });
      try {
        while (true) {
          const { done, value } = await interruptible(reader.read(), controller.signal);
          if (controller.signal.aborted) throw failure('OWNERSHIP_CLAIMS_CANCELLED');
          if (done) break;
          length += value.byteLength; check(length <= 262144); parts.push(value);
        }
      } finally {
        controller.signal.removeEventListener('abort', cancelBody); cancelBody();
        try { reader.releaseLock(); } catch {}
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
      return parseOwnershipClaimsPage(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), accountId, input);
    } catch (error) {
      if (controller.signal.aborted) throw failure(signal?.aborted ? 'OWNERSHIP_CLAIMS_CANCELLED' : 'OWNERSHIP_CLAIMS_UNAVAILABLE');
      if (error.code === 'OWNERSHIP_CLAIMS_ACCESS_ENDED') throw error;
      throw failure('OWNERSHIP_CLAIMS_UNAVAILABLE');
    } finally { discardBody(received); clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  };
}
