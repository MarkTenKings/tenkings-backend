const fail = code => Object.assign(new Error(code), { code });
const check = (value, code = 'VARIANT_RESPONSE_INVALID') => { if (!value) throw fail(code); };
const sha = value => /^[a-f0-9]{64}$/.test(value ?? '');
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value ?? '');
export const variantBindingKey = value => value && JSON.stringify([value.sourceHash, value.identityRevision, value.identityHash, value.jobId, value.resultHash]);
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
  return value;
}
export function variantConfirmationCurrent(value) {
  const proof = value?.confirmation;
  return Boolean(['SELECTED','MANUAL'].includes(proof?.decision)
    && proof.sourceHash === value.sourceHash && proof.identityRevision === value.identityRevision
    && proof.identityHash === value.identityHash && (proof.decision === 'MANUAL' || proof.selectedCandidateId));
}
export const variantApprovalReady = value => value?.enabled === false || Boolean(value?.approvalReady && variantConfirmationCurrent(value));
export function variantRecheckMessage(value) {
  if (!value?.confirmation?.reprocessRequired || value.confirmation.decision === 'UNRESOLVED') return null;
  if (value.confirmation.recheckReason === 'VARIANT_ANALYSIS_STALE') return 'Border geometry changed after the saved variant check. Review the confirmed identity to start a fresh check against the updated geometry. Your saved findings stay in place.';
  const state = value.confirmation.recheckState;
  if (['QUEUED','PREPARED','DISPATCHED'].includes(state)) return 'Checking the confirmed variant… Your saved photographs and human findings stay in place.';
  if (state === 'READY') return 'Fresh findings are available for the confirmed variant. Review the new proposals before final approval; nothing is approved automatically.';
  if (state === 'FAILED' || state === 'UNKNOWN' || state === 'REFUSED') return 'The variant check needs attention. Your saved photographs and findings are retained. Check its saved status before continuing.';
  return value.approvalReady ? null : 'The confirmed variant needs a grading check. Your saved photographs and human findings stay in place.';
}
export function createVariantReviewClient({ cardId, staffId, request, storage, cryptoImpl = globalThis.crypto }) {
  check(uuid(cardId) && uuid(staffId) && typeof request === 'function' && storage, 'VARIANT_CLIENT_INVALID');
  const key = `atlas-variant-review:${staffId}:${cardId}`, path = `/api/staff/manual-connected/cards/${cardId}/variants`;
  let running = false, latest = null;
  function retained() {
    let value; try { value = JSON.parse(storage.getItem(key) ?? 'null'); } catch { throw fail('VARIANT_LOCAL_INVALID'); }
    if (value) check(value.version === 1 && value.staffId === staffId && value.cardId === cardId
      && (!value.operation || ['CONFIRM','REFRESH'].includes(value.operation))
      && (!value.pending || (value.operation === 'REFRESH' ? uuid(value.pending.requestId) : uuid(value.pending.actionId) && value.pending.reviewed === true)), 'VARIANT_LOCAL_INVALID');
    return value;
  }
  function store(value) { try { storage.setItem(key, JSON.stringify({ version: 1, staffId, cardId, ...value })); } catch { throw fail('VARIANT_LOCAL_UNAVAILABLE'); } }
  const intentId = pending => pending?.requestId ?? pending?.actionId;
  function clearPending(id) { const value = retained(); if (intentId(value?.pending) === id) storage.removeItem(key); }
  function acknowledged(status, pending, operation = 'CONFIRM', allowReceipt = false) {
    const receipt = status.acknowledgedRequest;
    if (allowReceipt && receipt?.operation === operation && receipt.requestId === intentId(pending)
      && receipt.sourceHash === pending.sourceHash && receipt.identityRevision === pending.identityRevision
      && receipt.identityHash === pending.identityHash) return true;
    if (operation === 'REFRESH') return status.refreshRequestId === pending.requestId && status.sourceHash === pending.sourceHash
      && status.identityRevision === pending.identityRevision && status.identityHash === pending.identityHash;
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
      const result = variantStatus(await request(`${path}/${operation === 'REFRESH' ? 'refresh' : 'confirm'}`, { method: 'POST', body: input }));
      check(acknowledged(result, input, operation, true), 'VARIANT_SAVE_UNCONFIRMED'); clearPending(intentId(input)); latest = result; return result;
    } catch (error) {
      if (operation === 'REFRESH' && [400,409].includes(error?.status) && ['VARIANT_REFRESH_UNAVAILABLE','VARIANT_REFRESH_CONFLICT','VARIANT_REFRESH_INVALID'].includes(error.code)) {
        clearPending(intentId(input)); throw fail('VARIANT_REFRESH_UNAVAILABLE');
      }
      if (error?.status === 409 && error.code === 'VARIANT_FINISH_UNRESOLVED') { clearPending(input.actionId); throw error; }
      if (error?.status === 400 && error.code === 'VARIANT_REFERENCE_PERMISSION_INVALID') { clearPending(input.actionId); throw error; }
      if (error?.status === 409 && ['VARIANT_SOURCE_STALE','VARIANT_IDENTITY_STALE','VARIANT_RESULT_STALE','VARIANT_RECHECK_STALE','MANUAL_DRAFT_STALE'].includes(error.code)) {
        clearPending(intentId(input)); throw fail('VARIANT_REVIEW_CHANGED');
      }
      throw error;
    }
  }
  async function exclusive(work) { check(!running, 'VARIANT_SAVE_PENDING'); running = true; try { return await work(); } finally { running = false; } }
  return Object.freeze({ read, retained,
    choose(candidateId, outcome = null, manual = null, referencePermission = null) {
      check(latest && !retained()?.pending, 'VARIANT_SAVE_PENDING');
      check(candidateId === null || latest.result?.catalog.candidates.some(candidate => candidate.candidateId === candidateId), 'VARIANT_CANDIDATE_STALE');
      store({ draft: { binding: variantBindingKey(latest), candidateId, outcome, manual,
        ...(!outcome && referencePermission ? { referencePermission } : {}) } });
    },
    confirm: ({ candidateId, unresolved = false, manual = null, referencePermission = null }) => exclusive(async () => {
      check(latest && !retained()?.pending, 'VARIANT_SAVE_PENDING');
      const basis = latest, current = await read();
      check(variantBindingKey(basis) === variantBindingKey(current), 'VARIANT_REVIEW_CHANGED');
      check(unresolved || manual || current.state === 'READY' && current.result?.catalog.candidates.some(candidate => candidate.candidateId === candidateId), 'VARIANT_CANDIDATE_STALE');
      const permission = !unresolved && referencePermission ? referencePermission : null;
      check(!permission || Object.keys(permission).sort().join('|') === 'basis|consumers|detail'
        && ['owned_original','licensed','permission'].includes(permission.basis)
        && typeof permission.detail === 'string' && permission.detail.trim().length > 0 && permission.detail.trim().length <= 1000
        && Array.isArray(permission.consumers) && permission.consumers.join('|') === 'inventory|atlas', 'VARIANT_REFERENCE_PERMISSION_INVALID');
      const input = { actionId: cryptoImpl.randomUUID(), expectedRevision: current.revision, sourceHash: current.sourceHash,
        identityRevision: current.identityRevision, identityHash: current.identityHash, jobId: manual || unresolved ? null : current.jobId, resultHash: manual || unresolved ? null : current.resultHash,
        decision: manual ? 'MANUAL' : unresolved ? 'UNRESOLVED' : 'SELECTED', candidateId: manual || unresolved ? null : candidateId, reviewed: true,
        ...(manual ? { manualParallel: manual.parallel.trim(), observedFeatures: manual.features.trim() } : {}),
        ...(permission ? { referencePermission: { basis: permission.basis, detail: permission.detail.trim(), consumers: ['inventory','atlas'] } } : {}) };
      check(!manual || input.manualParallel.length > 0 && input.manualParallel.length <= 120 && input.observedFeatures.length > 0 && input.observedFeatures.length <= 1000, 'VARIANT_MANUAL_INVALID');
      store({ pending: input }); return send(input);
    }),
    refresh: () => exclusive(async () => {
      check(latest && !retained()?.pending, 'VARIANT_SAVE_PENDING');
      const basis = latest, current = await read();
      check(variantBindingKey(basis) === variantBindingKey(current), 'VARIANT_REVIEW_CHANGED');
      check(current.refreshable === true && sha(current.jobId), 'VARIANT_REFRESH_UNAVAILABLE');
      const input = { requestId: cryptoImpl.randomUUID(), sourceHash: current.sourceHash, identityRevision: current.identityRevision,
        identityHash: current.identityHash, jobId: current.jobId };
      store({ operation: 'REFRESH', pending: input }); return send(input, 'REFRESH');
    }),
    resume: () => exclusive(async () => {
      const saved = retained(), pending = saved?.pending; check(pending, 'VARIANT_NO_PENDING');
      const current = await read(); if (acknowledged(current, pending, saved.operation)) return current;
      return send(pending, saved.operation);
    }),
  });
}
export function variantError(error) {
  return ({ VARIANT_REVIEW_CHANGED: 'The photos, identity, grading evidence or available matches changed. Check the saved choices and review again.',
    VARIANT_LOCAL_UNAVAILABLE: 'This browser could not retain your decision. Enable local storage before saving; nothing was submitted.',
    VARIANT_LOCAL_INVALID: 'The retained decision could not be read. Keep this tab open and reload your access before continuing.',
    VARIANT_FINISH_UNRESOLVED: 'This reference does not identify a printing. Choose another match, or record the details you can verify on the physical card.',
    VARIANT_MANUAL_INVALID: 'Enter a printing and the visible details that confirm it before saving.',
    VARIANT_REFERENCE_PERMISSION_INVALID: 'Choose the photo rights basis and add a brief rights note, or turn off the optional photo contribution.',
    VARIANT_REFRESH_UNAVAILABLE: 'Reference preparation cannot be refreshed in its current state. Check the saved status first.',
    VARIANT_SAVE_PENDING: 'Check the retained decision before making another change.',
  })[error?.code] ?? 'The save is not confirmed. Your decision is retained. Check its saved status before trying another choice.';
}
