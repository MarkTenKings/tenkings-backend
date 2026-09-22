import { check, digest, canonical, uuid, sha } from './contract.mjs';
import { validatePreparedRequest, validateRequestEvidence, restorePreparedRequest, parseAstraResponse, normalizeUsage,
  LIMITS, MODEL, BACKGROUND_VERSION, BACKGROUND_POLICY } from './index.mjs';

export function analysisActionHash(evidence, actionId = evidence.analysisId, replacement = null) {
  if (replacement !== null) {
    check(replacement && Object.keys(replacement).sort().join(',') === 'analysisId,outcomeHash');
    uuid(replacement.analysisId); sha(replacement.outcomeHash);
  }
  const base = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { schemaVersion: 1, cardId: evidence.cardId,
    profile: evidence.profile, side, frame: evidence.binding.sides[side].frame, cornerShape: evidence.cornerShapes[side],
    findingRevision: evidence.binding.sides[side].findingRevision, reviewRevision: evidence.binding.sides[side].reviewRevision }]));
  return digest(canonical({ actionId, base, ...(replacement === null ? {} : { replacement }) }));
}

function verifiedResponse(response, analysisId, requestHash) {
  check(response?.state === 'RECEIVED' && response.bytes instanceof Uint8Array && response.bytes.length <= LIMITS.responseBytes
    && response.responseHash === digest(response.bytes) && response.analysisId === analysisId
    && response.requestHash === requestHash, 'DEFECT_ANALYSIS_RESPONSE_INVALID');
}
function backgroundBody(response) {
  check(response.httpStatus >= 200 && response.httpStatus < 300 && response.contentType === 'application/json',
    'DEFECT_ANALYSIS_RESPONSE_INVALID');
  let raw; try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)); }
  catch { check(false, 'DEFECT_ANALYSIS_RESPONSE_INVALID'); }
  check(raw && Object.getPrototypeOf(raw) === Object.prototype && raw.model === MODEL
    && typeof raw.id === 'string' && /^resp_[A-Za-z0-9_-]{1,180}$/.test(raw.id)
    && ['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete'].includes(raw.status),
  'DEFECT_ANALYSIS_RESPONSE_INVALID');
  return raw;
}
function unknownResponse(response = null) {
  return { state: 'UNKNOWN', responseRef: null, resultRef: null, responseHash: null,
    providerRequestId: response?.providerRequestId ?? null, responseId: null, httpStatus: response?.httpStatus ?? null,
    usage: null, code: 'DEFECT_ANALYSIS_OUTCOME_UNKNOWN' };
}

/** Store exact request bytes in <=6MiB chunks so the existing 16MiB immutable
 * JSON artifact limit remains unchanged. The manifest and all parts are hashed;
 * no model input bytes are inserted into PostgreSQL. */
export async function storeAnalysisRequest(prepared, artifacts) {
  validatePreparedRequest(prepared);
  const source = { cardId: prepared.evidence.cardId, sourceHash: prepared.evidence.sourceBindingSha256 };
  const bytes = Buffer.from(prepared.requestText), parts = [], size = 6 * 1024 * 1024;
  for (let start = 0; start < bytes.length; start += size) {
    const chunk = bytes.subarray(start, start + size), sha256 = digest(chunk);
    const ref = await artifacts.write({ version: 1, index: parts.length, sha256, base64: chunk.toString('base64') },
      { ...source, kind: 'DEFECT_REQUEST_PART' });
    parts.push({ ref, byteCount: chunk.length, sha256 });
  }
  return artifacts.write({ version: 1, requestHash: prepared.requestHash, byteCount: bytes.length, parts,
    evidence: prepared.evidence, evidenceHash: prepared.evidenceHash }, { ...source, kind: 'DEFECT_REQUEST' });
}

export async function readAnalysisRequest(ref, source, artifacts) {
  const manifest = await artifacts.read(ref, { ...source, kind: 'DEFECT_REQUEST' });
  check(manifest?.version === 1 && Array.isArray(manifest.parts) && manifest.parts.length > 0 && manifest.parts.length <= 8
    && Number.isSafeInteger(manifest.byteCount) && manifest.byteCount <= LIMITS.requestBytes
    && manifest.evidenceHash === digest(canonical(manifest.evidence)), 'DEFECT_ANALYSIS_REQUEST_ARTIFACT_INVALID');
  const parts = []; let length = 0;
  for (const [index, part] of manifest.parts.entries()) {
    check(Number.isSafeInteger(part.byteCount) && part.byteCount > 0 && part.byteCount <= 6 * 1024 * 1024);
    const saved = await artifacts.read(part.ref, { ...source, kind: 'DEFECT_REQUEST_PART' });
    check(saved?.version === 1 && saved.index === index && typeof saved.base64 === 'string'
      && saved.base64.length <= 8 * 1024 * 1024, 'DEFECT_ANALYSIS_REQUEST_ARTIFACT_INVALID');
    const bytes = Buffer.from(saved.base64, 'base64');
    check(bytes.toString('base64') === saved.base64 && bytes.length === part.byteCount && digest(bytes) === part.sha256
      && saved.sha256 === part.sha256, 'DEFECT_ANALYSIS_REQUEST_ARTIFACT_INVALID');
    length += bytes.length; check(length <= LIMITS.requestBytes); parts.push(bytes);
  }
  const bytes = Buffer.concat(parts, length);
  check(length === manifest.byteCount && digest(bytes) === manifest.requestHash, 'DEFECT_ANALYSIS_REQUEST_ARTIFACT_INVALID');
  return { bytes, manifest };
}

/** Verification of saved results requires no provider capability. A disabled
 * inference integration can still enforce deliberate review of retained READY
 * proposals without constructing a provider or allowing a new dispatch. */
export function createAnalysisResultReader({ repository, artifacts }) {
  check(repository && typeof artifacts?.read === 'function');
  return Object.freeze({
    async readResult(staff, { cardId, analysisId }) {
      const run = await repository.status(staff, { cardId, analysisId });
      if (!run || run.state !== 'READY') return { run, result: null };
      const receipt = run.receipts.find(x => x.kind === 'RESPONSE')?.evidence;
      check(receipt?.state === 'READY' && receipt.responseRef && receipt.resultRef, 'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID', 503);
      const source = { cardId, sourceHash: run.requestEvidence.sourceBindingSha256 };
      const raw = await artifacts.read(receipt.responseRef, { ...source, kind: 'DEFECT_RESPONSE' });
      check(raw?.version === 1 && raw.analysisId === analysisId && raw.requestHash === run.requestHash
        && typeof raw.base64 === 'string' && raw.base64.length <= Math.ceil(LIMITS.responseBytes / 3) * 4,
      'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID', 503);
      const bytes = Buffer.from(raw.base64, 'base64');
      check(bytes.toString('base64') === raw.base64 && digest(bytes) === raw.sha256 && raw.sha256 === receipt.responseHash,
        'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID', 503);
      const parsed = parseAstraResponse(bytes, run.requestEvidence);
      const result = await artifacts.read(receipt.resultRef, { ...source, kind: 'DEFECT_RESULT' });
      check(parsed.state === 'READY' && canonical(result, LIMITS.outputBytes) === canonical(parsed.result, LIMITS.outputBytes),
        'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID', 503);
      // Fresh read access is rechecked after potentially slow object reads.
      await repository.find(staff, { cardId, analysisId });
      return { run, result };
    },
  });
}

/** Narrow human-requested one-shot execution; no card mutation or proposal
 * adoption. A saved PREPARED request may claim once; DISPATCHED/UNKNOWN never
 * dispatches again. Root resolves exact existing actions before rebuilding.
 * All storage and provider work is outside repository transactions. */
export function createAnalysisExecutor({ repository, provider, artifacts }) {
  check(repository && typeof provider?.dispatch === 'function' && typeof provider.bindingHash === 'string'
    && typeof artifacts?.write === 'function');
  async function retainTerminal(response, evidence, requestHash, retained = () => {}) {
    const { analysisId, cardId, sourceBindingSha256 } = evidence;
    verifiedResponse(response, analysisId, requestHash);
    const source = { cardId, sourceHash: sourceBindingSha256 };
    // Save even a provider error, invalid JSON or unparseable usage before
    // interpretation. Exact original usage remains in this raw artifact.
    const responseRef = await artifacts.write({ version: 1, analysisId, requestHash,
      startedAt: response.startedAt, receivedAt: response.receivedAt, httpStatus: response.httpStatus,
      providerRequestId: response.providerRequestId, contentType: response.contentType,
      sha256: response.responseHash, base64: Buffer.from(response.bytes).toString('base64') }, { ...source, kind: 'DEFECT_RESPONSE' });
    let saved = { ...unknownResponse(response), responseRef, responseHash: response.responseHash };
    retained(saved);
    let result = null, responseId = null, usage = null, code = 'DEFECT_ANALYSIS_RESPONSE_INVALID', state = 'REFUSED';
    try {
      const raw = JSON.parse(Buffer.from(response.bytes).toString('utf8'));
      if (typeof raw?.id === 'string' && /^resp_[A-Za-z0-9_-]{1,180}$/.test(raw.id)) responseId = raw.id;
      usage = normalizeUsage(raw?.usage);
    } catch { /* Actual malformed usage remains in the immutable raw reply. */ }
    saved = { ...saved, responseId, usage }; retained(saved);
    if (response.httpStatus >= 200 && response.httpStatus < 300 && response.contentType === 'application/json') {
      try { ({ result, responseId, usage, code, state } = parseAstraResponse(response.bytes, evidence)); }
      catch (error) { code = /^DEFECT_ANALYSIS_[A-Z_]{1,120}$/.test(error?.code) ? error.code : 'DEFECT_ANALYSIS_RESPONSE_INVALID'; }
    } else code = 'DEFECT_ANALYSIS_PROVIDER_HTTP_ERROR';
    const resultRef = result ? await artifacts.write(result, { ...source, kind: 'DEFECT_RESULT' }) : null;
    const reply = { state, responseRef, resultRef, responseHash: response.responseHash, providerRequestId: response.providerRequestId,
      responseId, httpStatus: response.httpStatus, usage, code };
    await repository.recordReply({ analysisId, requestHash, kind: 'RESPONSE', evidence: reply });
    return reply;
  }
  const executor = {
    async run({ staff, prepared, actionId, expiresAt, signal, baseHash = null, replacement = null }) {
      validatePreparedRequest(prepared);
      const { analysisId, cardId, binding } = prepared.evidence;
      const actionHash = analysisActionHash(prepared.evidence, actionId, replacement);
      check(baseHash === null || baseHash === actionHash, 'DEFECT_ANALYSIS_ACTION_CONFLICT', 409);
      let run = await repository.find(staff, { cardId, actionId });
      if (run) {
        if (run.retired) {
          check(run.baseHash === actionHash, 'DEFECT_ANALYSIS_ACTION_CONFLICT', 409);
          return repository.status(staff, { cardId, analysisId: run.analysisId });
        }
        check(run.analysisId === analysisId && run.requestHash === prepared.requestHash && run.baseHash === actionHash
          && run.evidenceHash === digest(canonical({ ...prepared.evidence, providerBindingHash: provider.bindingHash })),
        'DEFECT_ANALYSIS_ACTION_CONFLICT', 409);
        if (run.state !== 'PREPARED') return repository.status(staff, { cardId, analysisId });
      } else {
        signal?.throwIfAborted();
        const requestRef = await storeAnalysisRequest(prepared, artifacts);
        run = await repository.prepare(staff, { analysisId, cardId, actionId, baseHash: actionHash, binding, requestHash: prepared.requestHash,
          requestRef, requestEvidence: { ...prepared.evidence, providerBindingHash: provider.bindingHash }, expiresAt,
          ...(replacement === null ? {} : { replacement }) });
      }
      signal?.throwIfAborted();
      const claim = await repository.claim(staff, { cardId, analysisId, requestHash: prepared.requestHash });
      if (!claim.claimed) return repository.status(staff, { cardId, analysisId });
      let response = null, retained = null;
      const unknown = () => unknownResponse(response);
      try {
        response = await provider.dispatch(prepared, { signal, deadlineMs: Date.parse(claim.run.expiresAt) });
        if (response.state !== 'RECEIVED') {
          await repository.recordReply({ analysisId, requestHash: prepared.requestHash, kind: 'OUTCOME', evidence: unknown() });
        } else if (prepared.evidence.version === BACKGROUND_VERSION && response.httpStatus >= 200 && response.httpStatus < 300) {
          verifiedResponse(response, analysisId, prepared.requestHash);
          const raw = backgroundBody(response);
          // If the acceptance transaction itself fails, a receipt can still
          // truthfully preserve the observed identity without claiming success.
          retained = { ...unknown(), responseId: raw.id, responseHash: response.responseHash };
          // Save the observed identity before any slow artifact operation. This
          // does not claim the ACK body was saved. Even an already completed ACK
          // is collected by exact-ID GET, independently of the browser/session.
          await repository.appendAcceptance({ analysisId, requestHash: prepared.requestHash, providerBindingHash: provider.bindingHash,
            evidence: { responseId: raw.id, providerRequestId: response.providerRequestId, httpStatus: response.httpStatus,
              providerStatus: raw.status, model: raw.model, responseHash: response.responseHash, receivedAt: response.receivedAt,
              pollUntil: new Date(Date.parse(response.receivedAt) + BACKGROUND_POLICY.pollWindowMs).toISOString() } });
        } else {
          await retainTerminal(response, prepared.evidence, prepared.requestHash, value => { retained = value; });
        }
      } catch {
        // Claim is already committed; never re-run the provider after failure to
        // persist or interpret the result. A later exact reply may still append.
        await repository.recordReply({ analysisId, requestHash: prepared.requestHash, kind: 'OUTCOME', evidence: retained ?? unknown() }).catch(() => {});
      }
      // May require sign-in again. Receipt retention above does not borrow an
      // expired session's card authority or make the proposals automatically live.
      return repository.status(staff, { cardId, analysisId });
    },
    async prepareAndRun(staff, { cardId, actionId, prepared, expiresAt, signal, baseHash = null, replacement = null }) {
      validatePreparedRequest(prepared); check(cardId === prepared.evidence.cardId, 'DEFECT_ANALYSIS_ACTION_CONFLICT', 409);
      return executor.run({ staff, actionId, prepared, expiresAt, signal, baseHash, replacement });
    },
    async resume(staff, { cardId, analysisId, signal }) {
      const run = await repository.find(staff, { cardId, analysisId });
      check(run, 'DEFECT_ANALYSIS_NOT_FOUND', 404);
      if (run.state !== 'PREPARED') return repository.status(staff, { cardId, analysisId });
      check(run.requestEvidence.providerBindingHash === provider.bindingHash, 'DEFECT_ANALYSIS_PROVIDER_BINDING_CHANGED', 409);
      const { bytes, manifest } = await readAnalysisRequest(run.requestRef,
        { cardId, sourceHash: run.requestEvidence.sourceBindingSha256 }, artifacts);
      check(manifest.requestHash === run.requestHash && digest(canonical({ ...manifest.evidence, providerBindingHash: provider.bindingHash })) === run.evidenceHash,
        'DEFECT_ANALYSIS_REQUEST_ARTIFACT_INVALID');
      const prepared = restorePreparedRequest({ requestText: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
        requestHash: manifest.requestHash, evidence: manifest.evidence, evidenceHash: manifest.evidenceHash });
      const replacement = run.replacesAnalysisId ? { analysisId: run.replacesAnalysisId, outcomeHash: run.replacesOutcomeHash } : null;
      return executor.run({ staff, actionId: run.actionId, prepared, expiresAt: run.expiresAt, signal, replacement, baseHash: run.baseHash });
    },
    pending({ limit = BACKGROUND_POLICY.batchSize, cursor = null } = {}) {
      return repository.listAcceptedPending({ providerBindingHash: provider.bindingHash, limit, cursor });
    },
    async reconcile({ analysisId, signal }) {
      uuid(analysisId); signal?.throwIfAborted();
      // This machine capability can read only already accepted, dispatched work
      // under the same provider binding. It never borrows staff edit authority.
      const accepted = await repository.findAccepted({ analysisId, providerBindingHash: provider.bindingHash });
      if (!accepted) return { analysisId, state: 'SKIPPED' };
      const { run, acceptance } = accepted;
      const evidence = validateRequestEvidence(run.requestEvidence);
      check(run.analysisId === analysisId && evidence.analysisId === analysisId && evidence.cardId === run.cardId
        && evidence.version === BACKGROUND_VERSION && evidence.providerBindingHash === provider.bindingHash
        && canonical(evidence.binding) === canonical(run.binding)
        && run.evidenceHash === digest(canonical(evidence)), 'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID', 503);
      check(acceptance.model === MODEL && /^resp_[A-Za-z0-9_-]{1,180}$/.test(acceptance.responseId)
        && Number.isFinite(Date.parse(acceptance.pollUntil)), 'DEFECT_ANALYSIS_STORED_EVIDENCE_INVALID', 503);
      if (Date.parse(acceptance.pollUntil) <= Date.now()) {
        await repository.recordReply({ analysisId, requestHash: run.requestHash, kind: 'OUTCOME', evidence: {
          ...unknownResponse(), providerRequestId: acceptance.providerRequestId, responseId: acceptance.responseId,
          httpStatus: acceptance.httpStatus, code: 'DEFECT_ANALYSIS_POLL_WINDOW_EXHAUSTED',
        } });
        return { analysisId, state: 'UNKNOWN' };
      }
      let response;
      try {
        response = await provider.retrieve({ analysisId, requestHash: run.requestHash, responseId: acceptance.responseId },
          { signal, deadlineMs: Date.parse(acceptance.pollUntil) });
        if (response.state !== 'RECEIVED' || response.httpStatus < 200 || response.httpStatus >= 300)
          return { analysisId, state: 'PENDING' };
        verifiedResponse(response, analysisId, run.requestHash);
        const raw = backgroundBody(response);
        check(raw.id === acceptance.responseId, 'DEFECT_ANALYSIS_RESPONSE_BINDING_MISMATCH');
        if (['queued', 'in_progress'].includes(raw.status)) return { analysisId, state: 'PENDING' };
      } catch {
        // Failed/aborted GETs and invalid identities cannot terminate accepted
        // work or authorize a paid retry. The bounded worker may GET again.
        return { analysisId, state: 'PENDING' };
      }
      // Before adopting a terminal reply, independently verify all retained
      // request chunks and exact reconstruction, including current V2 mode.
      try {
        const { bytes, manifest } = await readAnalysisRequest(run.requestRef,
          { cardId: run.cardId, sourceHash: evidence.sourceBindingSha256 }, artifacts);
        check(manifest.requestHash === run.requestHash
          && digest(canonical({ ...manifest.evidence, providerBindingHash: provider.bindingHash })) === run.evidenceHash,
        'DEFECT_ANALYSIS_REQUEST_ARTIFACT_INVALID');
        const prepared = restorePreparedRequest({ requestText: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          requestHash: manifest.requestHash, evidence: manifest.evidence, evidenceHash: manifest.evidenceHash });
        const reply = await retainTerminal(response, prepared.evidence, run.requestHash);
        return { analysisId, state: 'SETTLED', outcome: reply.state };
      } catch {
        // Artifact/DB failures remain eligible for GET collection. No guessed
        // terminal receipt can displace a later fully retained exact response.
        return { analysisId, state: 'PENDING' };
      }
    },
    ...createAnalysisResultReader({ repository, artifacts }),
  };
  return Object.freeze(executor);
}
