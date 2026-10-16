const candidateIdentityKey = candidate => candidate && JSON.stringify([candidate.identity, candidate.parallel]);
const fail = code => Object.assign(new Error(code), { code });
const check = (value, code = 'VARIANT_RESPONSE_INVALID') => { if (!value) throw fail(code); };
const sha = value => /^[a-f0-9]{64}$/.test(value ?? '');
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value ?? '');
export const variantBindingKey = value => value && JSON.stringify([value.sourceHash, value.identityRevision, value.identityHash]);
export function variantStatus(value) {
  check(value && typeof value.enabled === 'boolean' && typeof value.approvalReady === 'boolean');
  check(['NOT_REQUESTED','QUEUED','SEARCHING','READY','UNKNOWN','FAILED','STALE'].includes(value.state));
  check(Number.isSafeInteger(value.revision) && value.revision > 0 && sha(value.sourceHash)
    && Number.isSafeInteger(value.identityRevision) && value.identityRevision > 0 && sha(value.identityHash));
  if (value.result) {
    const catalog = value.result.catalog;
    check(catalog?.schemaVersion === 'atlas-variant-catalog/v1' && sha(catalog.snapshotHash) && Array.isArray(catalog.candidates));
    check(new Set(catalog.candidates.map(candidate => candidate.candidateId)).size === catalog.candidates.length);
    for (const candidate of catalog.candidates) check(typeof candidate.candidateId === 'string' && candidate.candidateId.length > 0
      && typeof candidate.label === 'string' && candidate.identity && Array.isArray(candidate.images) && Array.isArray(candidate.diagnostics));
  }
  if (value.labelFailure != null) check(value.labelFailure.code === 'VARIANT_OPENAI_CREDITS_EXHAUSTED'
    && typeof value.labelFailure.retryable === 'boolean' && typeof value.labelFailure.labelRequestKey === 'string'
    && value.labelFailure.labelRequestKey.length > 0 && value.labelFailure.labelRequestKey.length <= 300
    && sha(value.labelFailure.labelResponseHash) && sha(value.catalogManifestHash) && sha(value.jobId));
  if (value.labelRetryRequestId != null) check(uuid(value.labelRetryRequestId));
  return value;
}
export function variantConfirmationCurrent(value) {
  const proof = value?.confirmation;
  return Boolean(['SELECTED','MANUAL','UNRESOLVED'].includes(proof?.decision)
    && proof.sourceHash === value.sourceHash && proof.identityRevision === value.identityRevision
    && proof.identityHash === value.identityHash && (proof.decision !== 'SELECTED' || proof.selectedCandidateId));
}
export const variantApprovalReady = value => value?.enabled === false || Boolean(value?.approvalReady && variantConfirmationCurrent(value));
export function createVariantReviewClient({ cardId, staffId, request, storage, cryptoImpl = globalThis.crypto }) {
  check(uuid(cardId) && uuid(staffId) && typeof request === 'function' && storage, 'VARIANT_CLIENT_INVALID');
  const key = `atlas-variant-review:${staffId}:${cardId}`, path = `/api/staff/manual-connected/cards/${cardId}/variants`;
  let running = false, latest = null;
  function retained() {
    let value; try { value = JSON.parse(storage.getItem(key) ?? 'null'); } catch { throw fail('VARIANT_LOCAL_INVALID'); }
    if (value) check(value.version === 1 && value.staffId === staffId && value.cardId === cardId
      && (!value.operation || ['CONFIRM','REFRESH','RETRY_LABELS'].includes(value.operation))
      && (!value.pending || (['REFRESH','RETRY_LABELS'].includes(value.operation) ? uuid(value.pending.requestId) : uuid(value.pending.actionId) && value.pending.reviewed === true)), 'VARIANT_LOCAL_INVALID');
    return value;
  }
  function store(value) { try { storage.setItem(key, JSON.stringify({ version: 1, staffId, cardId, ...value })); } catch { throw fail('VARIANT_LOCAL_UNAVAILABLE'); } }
  const intentId = pending => pending?.requestId ?? pending?.actionId;
  function clearPending(id) { const value = retained(); if (intentId(value?.pending) === id) {
    if (value.operation === 'RETRY_LABELS' && value.draft) store({draft:value.draft}); else storage.removeItem(key);
  } }
  function acknowledged(status, pending, operation = 'CONFIRM', allowReceipt = false) {
    const receipt = status.acknowledgedRequest;
    if (allowReceipt && receipt?.operation === operation && receipt.requestId === intentId(pending)
      && receipt.sourceHash === pending.sourceHash && receipt.identityRevision === pending.identityRevision
      && receipt.identityHash === pending.identityHash) return true;
    if (operation === 'REFRESH') return status.refreshRequestId === pending.requestId && status.sourceHash === pending.sourceHash
      && status.identityRevision === pending.identityRevision && status.identityHash === pending.identityHash;
    if (operation === 'RETRY_LABELS') return status.labelRetryRequestId === pending.requestId && status.jobId === pending.jobId
      && status.catalogManifestHash === pending.catalogManifestHash && variantBindingKey(status) === variantBindingKey(pending);
    return status.confirmation?.actionId === pending.actionId && status.confirmation.decision === pending.decision
      && status.confirmation.selectedCandidateId === pending.candidateId && status.confirmation.sourceHash === pending.sourceHash;
  }
  async function read() {
    const result = variantStatus(await request(path)); latest = result;
    const saved = retained(); if (saved?.pending && acknowledged(result, saved.pending, saved.operation)) clearPending(intentId(saved.pending));
    return result;
  }
  async function send(input, operation = 'CONFIRM') {
    try {
      const result = variantStatus(await request(`${path}/${({REFRESH:'refresh',RETRY_LABELS:'retry-labels',CONFIRM:'confirm'})[operation]}`, { method: 'POST', body: input }));
      check(acknowledged(result, input, operation, true), 'VARIANT_SAVE_UNCONFIRMED'); clearPending(intentId(input)); latest = result; return result;
    } catch (error) {
      if (operation === 'REFRESH' && error?.status === 409 && error.code === 'VARIANT_LABEL_RETRY_REQUIRED') {
        clearPending(intentId(input)); throw fail('VARIANT_LABEL_RETRY_REQUIRED');
      }
      if (operation === 'REFRESH' && [400,409].includes(error?.status) && ['VARIANT_REFRESH_UNAVAILABLE','VARIANT_REFRESH_CONFLICT','VARIANT_REFRESH_INVALID'].includes(error.code)) {
        clearPending(intentId(input)); throw fail('VARIANT_REFRESH_UNAVAILABLE');
      }
      if (operation === 'RETRY_LABELS' && [400,409].includes(error?.status)
        && ['VARIANT_LABEL_RETRY_UNAVAILABLE','VARIANT_LABEL_RETRY_CONFLICT','VARIANT_LABEL_RETRY_INVALID'].includes(error.code)) {
        clearPending(intentId(input)); throw fail('VARIANT_LABEL_RETRY_UNAVAILABLE');
      }
      if (error?.status === 409 && error.code === 'VARIANT_FINISH_UNRESOLVED') { clearPending(input.actionId); throw error; }
      if (operation === 'CONFIRM' && error?.status === 400 && ['MANUAL_REQUEST_INVALID','VARIANT_CONFIRMATION_INVALID'].includes(error.code)) {
        // A previous application version can retain a request with retired
        // fields. A definitive contract refusal did not commit that request.
        // Release only that intent; never rewrite and replay it under its ID.
        clearPending(input.actionId); throw fail('VARIANT_REQUEST_RETIRED');
      }
      if (error?.status === 409 && ['VARIANT_SOURCE_STALE','VARIANT_IDENTITY_STALE','VARIANT_RESULT_STALE','MANUAL_DRAFT_STALE'].includes(error.code)) {
        clearPending(intentId(input)); throw fail('VARIANT_REVIEW_CHANGED');
      }
      throw error;
    }
  }
  async function exclusive(work) { check(!running, 'VARIANT_SAVE_PENDING'); running = true; try { return await work(); } finally { running = false; } }
  return Object.freeze({ read, retained,
    choose(candidateId, outcome = null, manual = null) {
      check(latest && !retained()?.pending, 'VARIANT_SAVE_PENDING');
      check(candidateId === null || latest.result?.catalog.candidates.some(candidate => candidate.candidateId === candidateId), 'VARIANT_CANDIDATE_STALE');
      store({ draft: { binding: variantBindingKey(latest), candidateId, outcome, manual,
        candidateIdentityKey: candidateIdentityKey(latest.result?.catalog.candidates.find(candidate => candidate.candidateId === candidateId)) } });
    },
    confirm: ({ candidateId, unresolved = false, manual = null }) => exclusive(async () => {
      check(latest && !retained()?.pending, 'VARIANT_SAVE_PENDING');
      const basis = latest, current = await read();
      check(variantBindingKey(basis) === variantBindingKey(current), 'VARIANT_REVIEW_CHANGED');
      const chosen = current.result?.catalog.candidates.find(candidate => candidate.candidateId === candidateId);
      const expectedChoice = retained()?.draft?.candidateIdentityKey ?? candidateIdentityKey(basis.result?.catalog.candidates.find(candidate => candidate.candidateId === candidateId));
      check(unresolved || manual || chosen && expectedChoice === candidateIdentityKey(chosen), 'VARIANT_CANDIDATE_STALE');
      const input = { actionId: cryptoImpl.randomUUID(), expectedRevision: current.revision, sourceHash: current.sourceHash,
        identityRevision: current.identityRevision, identityHash: current.identityHash, jobId: manual || unresolved ? null : current.jobId, resultHash: manual || unresolved ? null : current.resultHash,
        decision: manual ? 'MANUAL' : unresolved ? 'UNRESOLVED' : 'SELECTED', candidateId: manual || unresolved ? null : candidateId, reviewed: true,
        ...(manual ? { manualParallel: manual.parallel.trim() } : {}) };
      check(!manual || input.manualParallel.length > 0 && input.manualParallel.length <= 120, 'VARIANT_MANUAL_INVALID');
      store({ pending: input }); return send(input);
    }),
    refresh: () => exclusive(async () => {
      check(latest && !retained()?.pending, 'VARIANT_SAVE_PENDING');
      const basis = latest, current = await read();
      check(variantBindingKey(basis) === variantBindingKey(current), 'VARIANT_REVIEW_CHANGED');
      check(!current.labelFailure && current.refreshable === true && (sha(current.jobId) || current.jobId === null && current.state === 'NOT_REQUESTED'), 'VARIANT_REFRESH_UNAVAILABLE');
      const input = { requestId: cryptoImpl.randomUUID(), sourceHash: current.sourceHash, identityRevision: current.identityRevision,
        identityHash: current.identityHash, jobId: current.jobId };
      store({ operation: 'REFRESH', pending: input }); return send(input, 'REFRESH');
    }),
    retryLabels: () => exclusive(async () => {
      check(latest && !retained()?.pending, 'VARIANT_SAVE_PENDING');
      const basis = latest, current = await read();
      check(variantBindingKey(basis) === variantBindingKey(current) && basis.jobId === current.jobId
        && basis.catalogManifestHash === current.catalogManifestHash, 'VARIANT_REVIEW_CHANGED');
      const failure = current.labelFailure;
      check(current.state === 'FAILED' && failure?.retryable === true, 'VARIANT_LABEL_RETRY_UNAVAILABLE');
      check(basis.labelFailure?.labelRequestKey === failure.labelRequestKey && basis.labelFailure?.labelResponseHash === failure.labelResponseHash,
        'VARIANT_REVIEW_CHANGED');
      const input = { requestId: cryptoImpl.randomUUID(), sourceHash: current.sourceHash, identityRevision: current.identityRevision,
        identityHash: current.identityHash, jobId: current.jobId, catalogManifestHash: current.catalogManifestHash,
        labelRequestKey: failure.labelRequestKey, labelResponseHash: failure.labelResponseHash };
      const draft = retained()?.draft;
      store({ ...(draft ? {draft} : {}), operation: 'RETRY_LABELS', pending: input });
      return send(input, 'RETRY_LABELS');
    }),
    resume: () => exclusive(async () => {
      const saved = retained(), pending = saved?.pending; check(pending, 'VARIANT_NO_PENDING');
      const current = await read(); if (acknowledged(current, pending, saved.operation)) return current;
      return send(pending, saved.operation);
    }),
  });
}
export function variantError(error) {
  return ({ VARIANT_REVIEW_CHANGED: 'The photos or saved card identity changed. Check the saved choices and review again.',
    VARIANT_REQUEST_RETIRED: 'The earlier save was not accepted. Choose the variant again to submit a new confirmation.',
    VARIANT_LOCAL_UNAVAILABLE: 'This browser could not retain your decision. Enable local storage before saving; nothing was submitted.',
    VARIANT_LOCAL_INVALID: 'The retained decision could not be read. Keep this tab open and reload your access before continuing.',
    VARIANT_FINISH_UNRESOLVED: 'This reference does not identify a printing. Choose another match, or record the details you can verify on the physical card.',
    VARIANT_MANUAL_INVALID: 'Choose Base or enter the printing visible on the physical card.',
    VARIANT_REFRESH_UNAVAILABLE: 'Reference preparation cannot be refreshed in its current state. Check the saved status first.',
    VARIANT_LABEL_RETRY_REQUIRED: 'Your saved photos need Astra labeling. Check saved matches, then use Retry Astra labeling after restoring OpenAI API credits.',
    VARIANT_LABEL_RETRY_UNAVAILABLE: 'Astra labeling cannot be retried from this saved state. Check the saved status before trying again.',
    VARIANT_SAVE_PENDING: 'Check the retained decision before making another change.',
  })[error?.code] ?? 'The save is not confirmed. Your decision is retained. Check its saved status before trying another choice.';
}
