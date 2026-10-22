// Browser-only, disabled until an explicit server configuration and transport
// are injected. No default endpoint, fetch, storage, auth or policy selection.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const TYPES = ['image/jpeg', 'image/png', 'image/heic'];
export const CLAIM_FILE_LIMITS = Object.freeze({ maxObjects: 6, maxObjectBytes: 20971520, maxBundleBytes: 62914560 });
export const claimIdValid = value => typeof value === 'string' && UUID.test(value);
export const claimCertificateValid = value => typeof value === 'string' && /^ATLAS-[A-F0-9]{12}$/.test(value);
const hash = value => typeof value === 'string' && HASH.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0 && value < 2147483647;
const date = value => typeof value === 'string' && value.length <= 80 && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const shape = (value, names) => record(value) && Reflect.ownKeys(value).length === names.length
  && names.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
export const claimFailure = (code, status, uncertain = false) => Object.assign(new Error(code), { code, ...(status ? { status } : {}), uncertain });
const need = (ok, code = 'CLAIM_RESPONSE_INVALID') => { if (!ok) throw claimFailure(code); };
export const claimCanonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? '[' + value.map(claimCanonical).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + claimCanonical(value[key])).join(',') + '}';
const same = (a, b) => claimCanonical(a) === claimCanonical(b);
const confirmedRefusals = new WeakSet();

/** Optional trusted-adapter result, never inferred from an HTTP status. The
 * adapter may emit this only after a validated server refusal and completed
 * transaction rollback. It says nothing about an earlier uncertain attempt. */
function confirmedRefusal(value, accountId, action, input) {
  need(value.accountId === accountId, 'CLAIM_ACCESS_ENDED');
  need(shape(value, ['schema', 'accountId', 'action', 'requestId', 'outcome']) && value.schema === 'atlas-ownership-claim-refusal-v2'
    && value.outcome === 'CONFIRMED_REFUSAL' && value.action === action && value.requestId === input.requestId && claimIdValid(input.requestId));
  const error = claimFailure('CLAIM_CONFIRMED_REFUSAL'); error.confirmedRefusal = true; confirmedRefusals.add(error); return error;
}

export function parseClaimConfiguration(value, accountId) {
  need(claimIdValid(accountId) && value?.accountId === accountId, 'CLAIM_ACCESS_ENDED');
  need(shape(value, ['schema', 'accountId', 'enabled', 'canPrepareEvidence', 'proofKinds', 'formats', 'limits', 'storageOrigin', 'storagePathPrefix', 'policyNotice'])
    && value.schema === 'atlas-ownership-claim-ui-config-v2' && value.enabled === true, 'CLAIM_DISABLED');
  need(typeof value.canPrepareEvidence === 'boolean' && Array.isArray(value.proofKinds) && (!value.canPrepareEvidence || value.proofKinds.length > 0) && value.proofKinds.length <= 20
    && value.proofKinds.every(kind => shape(kind, ['code', 'label']) && typeof kind.code === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(kind.code)
      && typeof kind.label === 'string' && kind.label.length > 0 && kind.label.length <= 120)
    && new Set(value.proofKinds.map(kind => kind.code)).size === value.proofKinds.length
    && Array.isArray(value.formats) && (!value.canPrepareEvidence || value.formats.length > 0) && value.formats.every(type => TYPES.includes(type))
    && new Set(value.formats).size === value.formats.length && shape(value.limits, Object.keys(CLAIM_FILE_LIMITS))
    && Object.entries(CLAIM_FILE_LIMITS).every(([key, max]) => Number.isSafeInteger(value.limits[key]) && value.limits[key] > 0 && value.limits[key] <= max)
    && typeof value.policyNotice === 'string' && value.policyNotice.trim().length > 0 && value.policyNotice.length <= 2000, 'CLAIM_CONFIGURATION_INVALID');
  if (!(value.canPrepareEvidence === false && value.storageOrigin === null && value.storagePathPrefix === null)) {
    let origin; try { origin = new URL(value.storageOrigin); } catch { need(false, 'CLAIM_CONFIGURATION_INVALID'); }
    need(origin.protocol === 'https:' && origin.origin === value.storageOrigin && !origin.username && !origin.password
      && typeof value.storagePathPrefix === 'string' && /^(?:\/|\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/)$/i.test(value.storagePathPrefix)
      && !value.storagePathPrefix.includes('..'), 'CLAIM_CONFIGURATION_INVALID');
  }
  return structuredClone(value);
}

function card(value) {
  need(shape(value, ['cardId', 'approvalActionId', 'approvalReportHash', 'certificateNumber', 'report'])
    && claimIdValid(value.cardId) && claimIdValid(value.approvalActionId) && hash(value.approvalReportHash) && claimCertificateValid(value.certificateNumber)
    && shape(value.report, ['publicToken', 'version', 'publicHash']) && typeof value.report.publicToken === 'string'
    && /^ar_[A-Za-z0-9_-]{24}$/.test(value.report.publicToken) && revision(value.report.version) && value.report.version > 0 && hash(value.report.publicHash));
  return structuredClone(value);
}
function identity(value, accountId) {
  need(record(value) && value.accountId === accountId, 'CLAIM_ACCESS_ENDED');
  need(date(value.observedAt));
}
export function parseClaimTarget(value, accountId, certificateNumber) {
  identity(value, accountId);
  need(shape(value, ['schema', 'accountId', 'observedAt', 'card', 'canSubmit', 'expectedOwnershipRevision'])
    && value.schema === 'atlas-ownership-claim-target-v1' && typeof value.canSubmit === 'boolean'
    && value.expectedOwnershipRevision === (value.canSubmit ? 0 : null));
  const bound = card(value.card); need(bound.certificateNumber === certificateNumber);
  return { ...value, card: bound };
}
const ACTION_FIELDS = {
  reserve_bundle: ['requestId', 'certificateNumber', 'expectedPublishedBinding', 'proofKind', 'files'], read_bundle: ['bundleId'],
  submit_claim: ['requestId', 'bundleId', 'expectedOwnershipRevision'], read_claim: ['claimId'],
  withdraw_claim: ['requestId', 'claimId', 'expectedClaimRevision'], replace_evidence: ['requestId', 'claimId', 'expectedClaimRevision', 'bundleId'], recover_request: ['requestId'],
};
export function claimLifecycleInput(action, value) {
  need(ACTION_FIELDS[action] && shape(value, ACTION_FIELDS[action]), 'CLAIM_REQUEST_INVALID');
  for (const key of ['requestId', 'bundleId', 'claimId']) if (Object.hasOwn(value, key)) need(claimIdValid(value[key]), 'CLAIM_REQUEST_INVALID');
  for (const key of ['expectedClaimRevision', 'expectedOwnershipRevision']) if (Object.hasOwn(value, key)) need(revision(value[key]) && (key !== 'expectedClaimRevision' || value[key] > 0), 'CLAIM_REQUEST_INVALID');
  if (action === 'reserve_bundle') {
    card(value.expectedPublishedBinding);
    need(claimCertificateValid(value.certificateNumber) && value.expectedPublishedBinding.certificateNumber === value.certificateNumber
      && typeof value.proofKind === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(value.proofKind)
      && Array.isArray(value.files) && value.files.length >= 1 && value.files.length <= 6, 'CLAIM_REQUEST_INVALID');
    for (const file of value.files) need(shape(file, ['clientFileId', 'byteCount', 'sha256', 'declaredType']) && claimIdValid(file.clientFileId)
      && Number.isSafeInteger(file.byteCount) && file.byteCount > 0 && file.byteCount <= CLAIM_FILE_LIMITS.maxObjectBytes && hash(file.sha256) && TYPES.includes(file.declaredType), 'CLAIM_REQUEST_INVALID');
    need(new Set(value.files.map(file => file.clientFileId)).size === value.files.length
      && value.files.reduce((sum, file) => sum + file.byteCount, 0) <= CLAIM_FILE_LIMITS.maxBundleBytes, 'CLAIM_REQUEST_INVALID');
  }
  return structuredClone(value);
}
export function parseClaimLifecycle(value, accountId, action, request) {
  identity(value, accountId); const input = claimLifecycleInput(action, request);
  if (value.schema === 'atlas-ownership-proof-bundle-v2') {
    need(['reserve_bundle', 'read_bundle', 'recover_request'].includes(action) && shape(value, ['schema', 'accountId', 'observedAt', 'bundle']));
    const b = value.bundle;
    need(shape(b, ['bundleId', 'requestId', 'card', 'proofKind', 'policyRevision', 'uploadPolicyRevision', 'expiresAt', 'usableUntil', 'deleteAfter', 'consumed', 'allRetained', 'files'])
      && claimIdValid(b.bundleId) && claimIdValid(b.requestId) && typeof b.proofKind === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(b.proofKind)
      && revision(b.policyRevision) && b.policyRevision > 0 && revision(b.uploadPolicyRevision) && b.uploadPolicyRevision > 0
      && date(b.expiresAt) && date(b.usableUntil) && date(b.deleteAfter) && Date.parse(b.expiresAt) <= Date.parse(b.usableUntil)
      && Date.parse(b.usableUntil) <= Date.parse(b.deleteAfter) && typeof b.consumed === 'boolean' && typeof b.allRetained === 'boolean'
      && Array.isArray(b.files) && b.files.length >= 1 && b.files.length <= 6);
    card(b.card);
    need(action === 'read_bundle' ? b.bundleId === input.bundleId : b.requestId === input.requestId);
    for (const f of b.files) need(shape(f, ['objectId', 'clientFileId', 'sha256', 'byteCount', 'declaredType', 'state']) && claimIdValid(f.objectId)
      && claimIdValid(f.clientFileId) && hash(f.sha256) && Number.isSafeInteger(f.byteCount) && f.byteCount > 0 && f.byteCount <= CLAIM_FILE_LIMITS.maxObjectBytes
      && TYPES.includes(f.declaredType) && ['RESERVED', 'RETAINED'].includes(f.state));
    need(new Set(b.files.map(f => f.objectId)).size === b.files.length && new Set(b.files.map(f => f.clientFileId)).size === b.files.length
      && b.files.reduce((sum, f) => sum + f.byteCount, 0) <= CLAIM_FILE_LIMITS.maxBundleBytes && b.allRetained === b.files.every(f => f.state === 'RETAINED'));
    if (action === 'reserve_bundle') need(same(b.card, input.expectedPublishedBinding) && b.proofKind === input.proofKind
      && b.files.length === input.files.length && b.files.every(f => input.files.some(want => Object.keys(want).every(key => want[key] === f[key]))));
    return structuredClone(value);
  }
  if (action === 'read_claim') {
    need(value.schema === 'atlas-ownership-claim-state-v2' && shape(value, ['schema', 'accountId', 'observedAt', 'claim']));
    const c = value.claim;
    need(shape(c, ['claimId', 'cardId', 'card', 'claimRevision', 'state', 'bundleId', 'blockedReasons', 'currentlyOwnedByYou'])
      && c.claimId === input.claimId && claimIdValid(c.cardId) && revision(c.claimRevision) && c.claimRevision > 0
      && ['PENDING', 'WITHDRAWN', 'VERIFIED', 'REJECTED'].includes(c.state) && (c.bundleId === null || claimIdValid(c.bundleId))
      && typeof c.currentlyOwnedByYou === 'boolean' && Array.isArray(c.blockedReasons)
      && c.blockedReasons.every(reason => ['EVIDENCE_UNAVAILABLE', 'EVIDENCE_EXPIRED', 'POLICY_CHANGED', 'POLICY_UNAVAILABLE', 'CARD_UNAVAILABLE', 'OWNERSHIP_CHANGED'].includes(reason)));
    if (c.card !== null) need(card(c.card).cardId === c.cardId);
    return structuredClone(value);
  }
  need(['submit_claim', 'withdraw_claim', 'replace_evidence', 'recover_request'].includes(action)
    && value.schema === 'atlas-ownership-lifecycle-receipt-v2' && shape(value, ['schema', 'accountId', 'observedAt', 'receipt']));
  const r = value.receipt;
  need(shape(r, ['receiptId', 'requestId', 'action', 'claimId', 'claimRevision', 'state', 'ownershipEventId', 'bundleId'])
    && claimIdValid(r.receiptId) && r.requestId === input.requestId && ['submit_claim', 'withdraw_claim', 'replace_evidence'].includes(r.action)
    && claimIdValid(r.claimId) && revision(r.claimRevision) && r.claimRevision > 0 && (r.ownershipEventId === null || claimIdValid(r.ownershipEventId))
    && (r.bundleId === null || claimIdValid(r.bundleId)) && r.state === (r.action === 'withdraw_claim' ? 'WITHDRAWN' : 'PENDING'));
  need(action === 'recover_request' || r.action === action);
  if (input.claimId) need(r.claimId === input.claimId);
  if (input.bundleId) need(r.bundleId === input.bundleId);
  need(r.action === 'submit_claim' ? r.claimRevision === 1 && r.ownershipEventId === r.claimId : r.ownershipEventId === null);
  if (r.action !== 'withdraw_claim') need(claimIdValid(r.bundleId));
  if (input.expectedClaimRevision !== undefined) need(r.claimRevision === input.expectedClaimRevision + 1);
  return structuredClone(value);
}

function interruptible(work, signal, late = () => {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => { if (done) return; done = true; signal.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, claimFailure('CLAIM_CANCELLED'));
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    Promise.resolve(work).then(value => done ? late(value) : finish(resolve, value), error => finish(reject, error));
  });
}
const discard = response => { try { void response?.body?.cancel().catch(() => {}); } catch {} };
async function bounded(work, outer, { timeoutMs = 30000, writing = false, json = true, authenticated = true } = {}) {
  if (outer?.aborted) throw claimFailure('CLAIM_CANCELLED');
  const controller = new AbortController(), cancel = () => controller.abort(); let response;
  outer?.addEventListener('abort', cancel, { once: true }); const timer = setTimeout(cancel, timeoutMs);
  try {
    response = await interruptible(Promise.resolve().then(() => { if (controller.signal.aborted) throw claimFailure('CLAIM_CANCELLED'); return work(controller.signal); }), controller.signal, discard);
    if (controller.signal.aborted) throw claimFailure('CLAIM_CANCELLED');
    if (authenticated && [401, 403].includes(response?.status)) throw claimFailure('CLAIM_ACCESS_ENDED', response.status);
    if (!response?.ok) throw claimFailure(response?.status === 409 ? 'CLAIM_CONFLICT' : 'CLAIM_UNAVAILABLE', response?.status, writing);
    if (!json) { need([200, 201, 204].includes(response.status)); return; }
    need(response.body && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')
      && /\bprivate\b/i.test(response.headers.get('cache-control') ?? '') && /\bno-store\b/i.test(response.headers.get('cache-control') ?? ''));
    const reader = response.body.getReader(), parts = []; let length = 0;
    const stop = () => { try { void reader.cancel().catch(() => {}); } catch {} };
    controller.signal.addEventListener('abort', stop, { once: true });
    try {
      while (true) { const { done, value } = await interruptible(reader.read(), controller.signal); if (controller.signal.aborted) throw claimFailure('CLAIM_CANCELLED');
        if (done) break; length += value.byteLength; need(length <= 262144); parts.push(value); }
    } finally { controller.signal.removeEventListener('abort', stop); stop(); try { reader.releaseLock(); } catch {} }
    const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (outer?.aborted) throw claimFailure('CLAIM_CANCELLED', undefined, writing);
    if (error.code === 'CLAIM_ACCESS_ENDED') throw error;
    if (confirmedRefusals.has(error)) throw error;
    throw claimFailure(error.code === 'CLAIM_CONFLICT' ? error.code : 'CLAIM_UNAVAILABLE', authenticated ? error.status : undefined, writing);
  } finally { discard(response); clearTimeout(timer); outer?.removeEventListener('abort', cancel); }
}

/** Original File/Blob only. Hashing does not decode, resize, rotate or re-encode.
 * File names remain local; reserve metadata contains no name or upload URL. */
export async function prepareClaimOriginals(files, config, { signal, crypto = globalThis.crypto } = {}) {
  need(Array.isArray(files) && files.length > 0 && files.length <= config.limits.maxObjects, 'CLAIM_FILE_LIMIT');
  need(files.every(file => file instanceof Blob && typeof file.name === 'string' && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= config.limits.maxObjectBytes)
    && files.reduce((sum, file) => sum + file.size, 0) <= config.limits.maxBundleBytes, 'CLAIM_FILE_LIMIT');
  need(crypto?.subtle?.digest && typeof crypto.randomUUID === 'function', 'CLAIM_HASH_UNAVAILABLE');
  const result = [], controller = signal ?? new AbortController().signal;
  for (const file of files) {
    if (controller.aborted) throw claimFailure('CLAIM_CANCELLED');
    const declaredType = file.type || (/\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.png$/i.test(file.name) ? 'image/png' : /\.heic$/i.test(file.name) ? 'image/heic' : '');
    need(config.formats.includes(declaredType), 'CLAIM_FILE_TYPE');
    const bytes = new Uint8Array(await interruptible(file.arrayBuffer(), controller, value => new Uint8Array(value).fill(0)));
    let digest;
    try { need(bytes.byteLength === file.size, 'CLAIM_FILE_CHANGED'); digest = await interruptible(crypto.subtle.digest('SHA-256', bytes), controller); }
    finally { bytes.fill(0); }
    const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    need(!result.some(item => item.sha256 === sha256 && item.byteCount === file.size), 'CLAIM_DUPLICATE_FILE');
    result.push({ file, name: file.name.slice(0, 240), clientFileId: crypto.randomUUID(), byteCount: file.size, sha256, declaredType });
  }
  return result;
}
const checksum = hash => btoa(String.fromCharCode(...hash.match(/../g).map(pair => parseInt(pair, 16))));
export function parseClaimUpload(value, accountId, bundle, file, config) {
  need(value?.accountId === accountId, 'CLAIM_ACCESS_ENDED');
  need(shape(value, ['schema', 'accountId', 'bundleId', 'objectId', 'planHash', 'method', 'url', 'headers', 'byteCount', 'sha256', 'expiresIn'])
    && value.schema === 'atlas-ownership-proof-put-v2' && value.bundleId === bundle.bundleId && value.objectId === file.objectId
    && hash(value.planHash) && value.method === 'PUT' && value.byteCount === file.byteCount && value.sha256 === file.sha256
    && Number.isInteger(value.expiresIn) && value.expiresIn > 0 && value.expiresIn <= 300 && typeof value.url === 'string' && value.url.length <= 8192);
  const expectedHeaders = { 'content-type': 'application/octet-stream', 'if-none-match': '*', 'x-amz-checksum-sha256': checksum(file.sha256),
    'x-amz-meta-atlas-kind': 'ownership-proof-v2', 'x-amz-meta-atlas-binding-sha256': value.planHash };
  need(same(value.headers, expectedHeaders));
  let url; try { url = new URL(value.url); } catch { need(false); }
  need(url.origin === config.storageOrigin && !url.username && !url.password && !url.hash
    && url.pathname === `${config.storagePathPrefix}atlas-ownership-proof/v2/${bundle.bundleId}/${file.objectId}`
    && url.searchParams.getAll('X-Amz-Expires').length === 1 && url.searchParams.get('X-Amz-Expires') === String(value.expiresIn)
    && url.searchParams.getAll('X-Amz-SignedHeaders').length === 1);
  const signed = url.searchParams.get('X-Amz-SignedHeaders').split(';');
  need([...Object.keys(expectedHeaders), 'content-length', 'host'].every(key => signed.includes(key)));
  return { ...value, headers: expectedHeaders };
}
function retained(value, accountId, bundle, file) {
  need(value?.accountId === accountId, 'CLAIM_ACCESS_ENDED');
  need(shape(value, ['schema', 'accountId', 'bundleId', 'objectId', 'state', 'byteCount', 'sha256', 'declaredType']) && value.schema === 'atlas-ownership-proof-retained-v2'
    && value.bundleId === bundle.bundleId && value.objectId === file.objectId && value.state === 'RETAINED'
    && value.byteCount === file.byteCount && value.sha256 === file.sha256 && value.declaredType === file.declaredType);
  return structuredClone(value);
}
export function createClaimSubmissionClient({ accountId, configuration, transport }) {
  const config = parseClaimConfiguration(configuration, accountId);
  const methods = config.canPrepareEvidence ? ['resolve', 'lifecycle', 'sign', 'complete', 'put'] : ['resolve', 'lifecycle'];
  need(methods.every(key => typeof transport?.[key] === 'function'), 'CLAIM_TRANSPORT_UNAVAILABLE');
  const wire = Object.fromEntries(methods.map(key => [key, transport[key].bind(transport)]));
  return Object.freeze({ configuration: config,
    async resolve(certificateNumber, { signal } = {}) {
      need(claimCertificateValid(certificateNumber), 'CLAIM_CERTIFICATE_INVALID');
      return parseClaimTarget(await bounded(active => wire.resolve({ certificateNumber }, { signal: active }), signal), accountId, certificateNumber);
    },
    async call(action, request, { signal } = {}) {
      const input = claimLifecycleInput(action, request), writing = !['read_bundle', 'read_claim', 'recover_request'].includes(action);
      const value = await bounded(async active => {
        const result = await wire.lifecycle(action, structuredClone(input), { signal: active });
        if (writing && result?.schema === 'atlas-ownership-claim-refusal-v2') throw confirmedRefusal(result, accountId, action, input);
        return result;
      }, signal, { writing });
      try { return parseClaimLifecycle(value, accountId, action, input); }
      catch (error) { if (error.code === 'CLAIM_ACCESS_ENDED') throw error; throw claimFailure('CLAIM_RESPONSE_INVALID', undefined, writing); }
    },
    async retain(bundle, file, { signal } = {}) {
      need(config.canPrepareEvidence, 'CLAIM_SUBMISSION_UNAVAILABLE');
      const value = await bounded(active => wire.complete({ bundleId: bundle.bundleId, objectId: file.objectId }, { signal: active }), signal, { writing: true });
      return retained(value, accountId, bundle, file);
    },
    async upload(bundle, descriptor, original, { signal } = {}) {
      need(config.canPrepareEvidence, 'CLAIM_SUBMISSION_UNAVAILABLE');
      need(original.file instanceof Blob && original.file.size === descriptor.byteCount && original.clientFileId === descriptor.clientFileId
        && original.sha256 === descriptor.sha256 && original.declaredType === descriptor.declaredType, 'CLAIM_FILE_CHANGED');
      const value = await bounded(active => wire.sign({ bundleId: bundle.bundleId, objectId: descriptor.objectId }, { signal: active }), signal);
      const capability = parseClaimUpload(value, accountId, bundle, descriptor, config);
      await bounded(active => wire.put({ method: 'PUT', url: capability.url, headers: { ...capability.headers }, body: original.file,
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: active }), signal, { writing: true, json: false, authenticated: false, timeoutMs: 120000 });
      return this.retain(bundle, descriptor, { signal });
    },
  });
}
