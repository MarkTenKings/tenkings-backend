import { claimFailure, claimCanonical, prepareClaimOriginals } from './ownership-claim-submission-client.mjs';

/** Memory-only local coordinator. All success comes from validated server
 * projections. No automatic mutation retry; uncertain writes retain one exact
 * request until read-only recovery or an explicit same-request retry. */
export function createClaimSubmissionState({ client, accountId, onAccessLost, now = Date.now, uuid = () => globalThis.crypto.randomUUID() }) {
  const config = client.configuration, listeners = new Set();
  let originals = [], closed = false, generation = 0, controller = null, attempt = null, busy = false;
  const initial = () => ({ accountId, mode: 'NEW', status: 'READY', operation: null, target: null, claim: null, bundle: null, receipt: null,
    files: [], error: null, pendingRequestId: null, recoveryMissing: false, fileProgress: null });
  let state = initial();
  const snapshot = () => structuredClone(state);
  const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(snapshot()); };
  const metadata = files => files.map(({ name, clientFileId, byteCount, sha256, declaredType }) => ({ name, clientFileId, byteCount, sha256, declaredType }));
  const end = () => {
    closed = true; generation++; controller?.abort(); controller = null; originals = []; attempt = null; busy = false;
    state = { ...initial(), status: 'ENDED' }; for (const listener of listeners) listener(snapshot());
  };
  const allowed = () => !closed && !busy;
  const require = (ok, code) => { if (!ok) throw claimFailure(code); };
  const currentCard = () => state.mode === 'REPLACE' ? state.claim?.card : state.target?.card;
  const immutableBundle = b => ({ ...b, consumed: undefined, allRetained: undefined,
    files: b.files.map(({ state: _state, ...file }) => file).sort((a, b) => a.objectId.localeCompare(b.objectId)) });
  function acceptRefresh(value, expected) {
    require(expected && claimCanonical(immutableBundle(value)) === claimCanonical(immutableBundle(expected)), 'CLAIM_SOURCE_CHANGED');
    require(!expected.consumed || value.consumed, 'CLAIM_SOURCE_CHANGED');
    require(expected.files.every(file => file.state !== 'RETAINED' || value.files.some(next => next.objectId === file.objectId && next.state === 'RETAINED')), 'CLAIM_SOURCE_CHANGED');
    return value;
  }
  const usable = (uploading = false) => {
    const b = state.bundle;
    require(b && !b.consumed && Date.parse(b.usableUntil) > now() && Date.parse(b.deleteAfter) > now()
      && (!uploading || Date.parse(b.expiresAt) > now()), 'CLAIM_BUNDLE_EXPIRED');
    require(currentCard() && claimCanonical(b.card) === claimCanonical(currentCard()), 'CLAIM_SOURCE_CHANGED');
    return b;
  };
  async function run(operation, work, { recovery = false } = {}) {
    if (!allowed() || attempt && !recovery) return;
    const id = ++generation; controller?.abort(); controller = new AbortController(); const signal = controller.signal; busy = true;
    const current = () => !closed && generation === id && !signal.aborted;
    publish({ status: 'BUSY', operation, error: null });
    try { await work(signal, current); if (current()) publish({ status: attempt ? 'UNKNOWN' : 'READY', operation: null, fileProgress: null }); }
    catch (error) {
      if (!current()) return;
      if (error.code === 'CLAIM_ACCESS_ENDED' || error.status === 401 || error.status === 403) { end(); onAccessLost?.(); return; }
      publish({ status: attempt ? 'UNKNOWN' : 'READY', operation: null, fileProgress: null, error: error.code ?? 'CLAIM_UNAVAILABLE' });
    } finally { if (generation === id) busy = false; }
  }
  function checkRecovered(value, pending) {
    if (!pending) return;
    if (pending.action === 'reserve_bundle') {
      require(value.schema === 'atlas-ownership-proof-bundle-v2', 'CLAIM_RECOVERY_MISMATCH'); const b = value.bundle;
      require(b.requestId === pending.input.requestId && claimCanonical(b.card) === claimCanonical(pending.input.expectedPublishedBinding)
        && b.proofKind === pending.input.proofKind && b.files.length === pending.input.files.length
        && b.files.every(file => pending.input.files.some(want => Object.keys(want).every(key => file[key] === want[key]))), 'CLAIM_RECOVERY_MISMATCH');
    } else {
      const r = value.receipt;
      require(value.schema === 'atlas-ownership-lifecycle-receipt-v2' && r.action === pending.action && r.requestId === pending.input.requestId
        && (!pending.input.claimId || r.claimId === pending.input.claimId) && (!pending.input.bundleId || r.bundleId === pending.input.bundleId)
        && (pending.input.expectedClaimRevision === undefined || r.claimRevision === pending.input.expectedClaimRevision + 1), 'CLAIM_RECOVERY_MISMATCH');
    }
  }
  async function apply(value, signal, current) {
    const pending = attempt;
    checkRecovered(value, pending);
    if (value.schema === 'atlas-ownership-proof-bundle-v2' && state.bundle?.bundleId === value.bundle.bundleId) acceptRefresh(value.bundle, state.bundle);
    attempt = null;
    publish({ pendingRequestId: null, recoveryMissing: false });
    if (value.schema === 'atlas-ownership-proof-bundle-v2') {
      if (!pending && state.bundle?.bundleId !== value.bundle.bundleId) {
        originals = []; publish({ target: null, claim: null, mode: 'NEW', files: [], fileProgress: null });
      }
      publish({ bundle: value.bundle, receipt: null }); return;
    }
    originals = []; publish({ receipt: value.receipt, files: [], bundle: null, fileProgress: null, claim: null, target: null, mode: 'MANAGE' });
    // Receipt is immutable history; only a separate fresh read can state title.
    const result = await client.call('read_claim', { claimId: value.receipt.claimId }, { signal });
    if (current()) publish({ claim: result.claim, mode: 'MANAGE', target: null });
  }
  async function write(action, input, signal, current) {
    const earlierUncertain = attempt?.input.requestId === input.requestId && attempt.uncertain;
    attempt = { action, input: structuredClone(input), uncertain: Boolean(earlierUncertain) };
    publish({ pendingRequestId: input.requestId, recoveryMissing: false });
    try {
      const result = await client.call(action, input, { signal });
      if (current()) await apply(result, signal, current);
    } catch (error) {
      if (current() && attempt) {
        if (error.confirmedRefusal && !attempt.uncertain) {
          attempt = null; originals = [];
          publish({ pendingRequestId: null, recoveryMissing: false, target: null, claim: null, bundle: null, files: [], fileProgress: null });
        } else attempt.uncertain = true;
      }
      throw error;
    }
  }
  return Object.freeze({
    snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose: end,
    startNew() { if (!allowed() || attempt) return; originals = []; state = initial(); publish({}); },
    lookup(certificateNumber) { return run('Checking card', async (signal, current) => {
      publish({ target: null, claim: null, receipt: null, mode: 'NEW' });
      const target = await client.resolve(certificateNumber, { signal }); if (!current()) return;
      const preserve = state.bundle && claimCanonical(state.bundle.card) === claimCanonical(target.card);
      if (!preserve) originals = [];
      publish({ target, mode: 'NEW', claim: null, receipt: null, ...(preserve ? {} : { bundle: null, files: [], fileProgress: null }) });
    }); },
    loadClaim(claimId) { return run('Checking claim', async (signal, current) => {
      const previousBundle = state.bundle, previousOriginals = originals;
      originals = []; publish({ claim: null, target: null, bundle: null, receipt: null, files: [], fileProgress: null, mode: 'MANAGE' });
      const value = await client.call('read_claim', { claimId }, { signal }); if (!current()) return;
      const preserve = previousBundle && value.claim.state === 'PENDING' && value.claim.card
        && claimCanonical(previousBundle.card) === claimCanonical(value.claim.card);
      originals = preserve ? previousOriginals : [];
      publish({ claim: value.claim, mode: preserve ? 'REPLACE' : 'MANAGE', target: null, bundle: preserve ? previousBundle : null,
        receipt: null, files: metadata(originals), fileProgress: null });
    }); },
    beginReplacement() {
      if (!allowed() || attempt) return;
      if (!config.canPrepareEvidence || state.claim?.state !== 'PENDING' || !state.claim.card) { publish({ error: 'CLAIM_REPLACEMENT_UNAVAILABLE' }); return; }
      originals = []; publish({ mode: 'REPLACE', bundle: null, files: [], receipt: null, fileProgress: null, error: null });
    },
    selectFiles(files) { return run('Checking originals', async (signal, current) => {
      require(config.canPrepareEvidence, 'CLAIM_SUBMISSION_UNAVAILABLE');
      require(currentCard(), 'CLAIM_CARD_REQUIRED');
      const selected = await prepareClaimOriginals(files, config, { signal }); if (!current()) return;
      if (state.bundle) {
        require(selected.length === state.bundle.files.length && selected.every(file => state.bundle.files.some(saved => saved.sha256 === file.sha256
          && saved.byteCount === file.byteCount && saved.declaredType === file.declaredType)), 'CLAIM_FILE_CHANGED');
        for (const file of selected) file.clientFileId = state.bundle.files.find(saved => saved.sha256 === file.sha256).clientFileId;
      }
      originals = selected; publish({ files: metadata(selected), error: null });
    }); },
    reserve(proofKind) { return run('Preparing upload', async (signal, current) => {
      require(config.canPrepareEvidence, 'CLAIM_SUBMISSION_UNAVAILABLE');
      require(currentCard() && originals.length > 0 && !state.bundle, 'CLAIM_CARD_REQUIRED');
      require(config.proofKinds.some(kind => kind.code === proofKind), 'CLAIM_PROOF_KIND_REQUIRED');
      require(state.mode === 'REPLACE' ? state.claim?.state === 'PENDING' : state.target?.canSubmit, 'CLAIM_SUBMISSION_UNAVAILABLE');
      const files = originals.map(({ clientFileId, byteCount, sha256, declaredType }) => ({ clientFileId, byteCount, sha256, declaredType }));
      await write('reserve_bundle', { requestId: uuid(), certificateNumber: currentCard().certificateNumber,
        expectedPublishedBinding: currentCard(), proofKind, files }, signal, current);
    }); },
    upload() { return run('Uploading originals', async (signal, current) => {
      require(config.canPrepareEvidence, 'CLAIM_SUBMISSION_UNAVAILABLE');
      const bundle = usable(true);
      for (const file of bundle.files.filter(file => file.state !== 'RETAINED')) {
        require(current(), 'CLAIM_CANCELLED');
        const original = originals.find(candidate => candidate.clientFileId === file.clientFileId);
        require(original, 'CLAIM_RESELECT_ORIGINALS'); publish({ fileProgress: { clientFileId: file.clientFileId, stage: 'UPLOADING' } });
        await client.upload(bundle, file, original, { signal }); if (!current()) return;
        publish({ fileProgress: { clientFileId: file.clientFileId, stage: 'RETAINED' } });
      }
      const result = await client.call('read_bundle', { bundleId: bundle.bundleId }, { signal });
      if (current()) publish({ bundle: acceptRefresh(result.bundle, bundle), fileProgress: null });
    }); },
    verifyUploads() { return run('Verifying uploaded originals', async (signal, current) => {
      require(config.canPrepareEvidence, 'CLAIM_SUBMISSION_UNAVAILABLE');
      const bundle = usable(true);
      for (const file of bundle.files.filter(file => file.state !== 'RETAINED')) {
        publish({ fileProgress: { clientFileId: file.clientFileId, stage: 'VERIFYING' } });
        await client.retain(bundle, file, { signal }); if (!current()) return;
      }
      const value = await client.call('read_bundle', { bundleId: bundle.bundleId }, { signal });
      if (current()) publish({ bundle: acceptRefresh(value.bundle, bundle), fileProgress: null });
    }); },
    checkBundle() { return run('Checking retained evidence', async (signal, current) => {
      require(state.bundle, 'CLAIM_CARD_REQUIRED'); const expected = state.bundle, value = await client.call('read_bundle', { bundleId: expected.bundleId }, { signal });
      if (current()) publish({ bundle: acceptRefresh(value.bundle, expected), fileProgress: null });
    }); },
    submit() { return run(state.mode === 'REPLACE' ? 'Replacing evidence' : 'Submitting claim', async (signal, current) => {
      require(config.canPrepareEvidence, 'CLAIM_SUBMISSION_UNAVAILABLE');
      const b = usable(); require(b.allRetained, 'CLAIM_EVIDENCE_NOT_RETAINED');
      // Re-read retention immediately before the explicit lifecycle mutation.
      const result = await client.call('read_bundle', { bundleId: b.bundleId }, { signal }); if (!current()) return;
      acceptRefresh(result.bundle, b);
      require(result.bundle.allRetained && !result.bundle.consumed && claimCanonical(result.bundle.card) === claimCanonical(currentCard()), 'CLAIM_SOURCE_CHANGED');
      publish({ bundle: result.bundle }); usable();
      if (state.mode === 'REPLACE') {
        require(state.claim?.state === 'PENDING', 'CLAIM_REPLACEMENT_UNAVAILABLE');
        await write('replace_evidence', { requestId: uuid(), claimId: state.claim.claimId, expectedClaimRevision: state.claim.claimRevision, bundleId: b.bundleId }, signal, current);
      } else {
        require(state.target?.canSubmit && state.target.expectedOwnershipRevision === 0, 'CLAIM_SUBMISSION_UNAVAILABLE');
        await write('submit_claim', { requestId: uuid(), bundleId: b.bundleId, expectedOwnershipRevision: state.target.expectedOwnershipRevision }, signal, current);
      }
    }); },
    withdraw() { return run('Withdrawing claim', async (signal, current) => {
      require(state.claim?.state === 'PENDING', 'CLAIM_WITHDRAW_UNAVAILABLE');
      await write('withdraw_claim', { requestId: uuid(), claimId: state.claim.claimId, expectedClaimRevision: state.claim.claimRevision }, signal, current);
    }); },
    recover(requestId = state.pendingRequestId) { return run('Checking request', async (signal, current) => {
      try { const value = await client.call('recover_request', { requestId }, { signal }); if (current()) await apply(value, signal, current); }
      catch (error) { if (current() && error.status === 404 && attempt && requestId === attempt.input.requestId) publish({ recoveryMissing: true }); throw error; }
    }, { recovery: true }); },
    retrySameRequest() { return run('Retrying the same request', async (signal, current) => {
      require(attempt && state.recoveryMissing, 'CLAIM_RECOVERY_REQUIRED');
      const pending = structuredClone(attempt); await write(pending.action, pending.input, signal, current);
    }, { recovery: true }); },
  });
}
