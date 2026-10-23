// Unregistered customer read contract. No credentials, storage or writer calls.
import { requireThat } from '@atlas/manual-service/contract';
import { OWNERSHIP_PROOF_LIMITS, projectOwnershipLifecycle } from './card-ownership-proof-contract.mjs';

export const OWNERSHIP_LIFECYCLE_READ_ACTIONS = Object.freeze([
  'read_access', 'configuration', 'resolve_certificate', 'list_claims', 'read_claim', 'list_history',
]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const id = v => typeof v === 'string' && UUID.test(v);
const revision = v => Number.isSafeInteger(v) && v >= 0 && v < 2147483647;
const date = v => typeof v === 'string' && v.length <= 80 && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim();
const code = v => typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,39}$/.test(v);
const need = ok => requireThat(ok, 400, 'INVALID_OWNERSHIP_LIFECYCLE_READ');
const response = ok => requireThat(ok, 503, 'OWNERSHIP_LIFECYCLE_READ_RESPONSE_INVALID');
const config = ok => requireThat(ok, 500, 'OWNERSHIP_LIFECYCLE_READ_CONFIG_INVALID');
const record = v => v && Object.getPrototypeOf(v) === Object.prototype;
function fields(v, keys, check = response) {
  check(record(v) && Reflect.ownKeys(v).length === keys.length
    && keys.every(k => Object.hasOwn(Object.getOwnPropertyDescriptor(v, k) ?? {}, 'value')));
}
function unique(values, max, predicate, check = response) {
  check(Array.isArray(values) && values.length <= max && values.every(predicate) && new Set(values).size === values.length);
}

export function ownershipLifecycleReadInput(action, value) {
  requireThat(OWNERSHIP_LIFECYCLE_READ_ACTIONS.includes(action), 403, 'OWNERSHIP_LIFECYCLE_READ_ONLY');
  const keys = { read_access: [], configuration: [], resolve_certificate: ['certificateNumber'],
    list_claims: ['afterClaimId', 'limit'], read_claim: ['claimId'], list_history: ['claimId', 'afterRevision', 'limit'] }[action];
  fields(value, keys, need);
  if (Object.hasOwn(value, 'claimId')) need(id(value.claimId));
  if (action === 'resolve_certificate') need(typeof value.certificateNumber === 'string' && /^ATLAS-[A-F0-9]{12}$/.test(value.certificateNumber));
  if (Object.hasOwn(value, 'limit')) need(Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 50);
  if (action === 'list_claims') need(value.afterClaimId === null || id(value.afterClaimId));
  if (action === 'list_history') need(revision(value.afterRevision));
  return structuredClone(value);
}

/** Explicit, trusted server settings; no implicit acceptance labels or policy.
 * proofPreparation is an operator-reviewed capability bound to the ENTIRE live
 * DB policy hash and a fixed storage origin. This constructor does not qualify
 * a provider/decoder or enable the DB policy. null permits management only.
 */
export function ownershipLifecycleReaderUI(value = null) {
  if (value === null) return null;
  fields(value, ['enabled', 'policyNotice', 'proofKinds', 'proofPreparation'], config);
  config(value.enabled === true && text(value.policyNotice, 2000) && Array.isArray(value.proofKinds) && value.proofKinds.length <= 20);
  for (const kind of value.proofKinds) { fields(kind, ['code', 'label'], config); config(code(kind.code) && text(kind.label, 120)); }
  config(new Set(value.proofKinds.map(k => k.code)).size === value.proofKinds.length);
  if (value.proofPreparation !== null) {
    const p = value.proofPreparation;
    fields(p, ['policyHash', 'formats', 'storageOrigin', 'storagePathPrefix'], config);
    config(typeof p.policyHash === 'string' && HASH.test(p.policyHash));
    unique(p.formats, 3, x => OWNERSHIP_PROOF_LIMITS.formats.includes(x), config); config(p.formats.length > 0);
    let origin; try { origin = new URL(p.storageOrigin); } catch { config(false); }
    config(typeof p.storageOrigin === 'string' && origin.protocol === 'https:' && origin.origin === p.storageOrigin && !origin.username && !origin.password
      && typeof p.storagePathPrefix === 'string' && /^(?:\/|\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/)$/i.test(p.storagePathPrefix) && !p.storagePathPrefix.includes('..'));
  }
  return structuredClone(value);
}

function claim(raw, value) {
  fields(value, ['claimId', 'cardId', 'card', 'claimRevision', 'state', 'bundleId', 'blockedReasons', 'currentlyOwnedByYou']);
  const projected = projectOwnershipLifecycle('CUSTOMER', 'read_claim', { actorId: raw.actorId, observedAt: raw.observedAt, claim: value }, { claimId: value.claimId }).claim;
  response(id(projected.claimId) && new Set(projected.blockedReasons).size === projected.blockedReasons.length);
  return projected;
}
function approvedCard(value) {
  fields(value, ['cardId', 'approvalActionId', 'approvalReportHash', 'certificateNumber', 'report']);
  fields(value.report, ['publicToken', 'version', 'publicHash']);
  response(id(value.cardId) && id(value.approvalActionId) && typeof value.approvalReportHash === 'string' && HASH.test(value.approvalReportHash)
    && typeof value.certificateNumber === 'string' && /^ATLAS-[A-F0-9]{12}$/.test(value.certificateNumber)
    && typeof value.report.publicToken === 'string' && /^ar_[A-Za-z0-9_-]{24}$/.test(value.report.publicToken)
    && revision(value.report.version) && value.report.version > 0 && typeof value.report.publicHash === 'string' && HASH.test(value.report.publicHash));
  return structuredClone(value);
}
function configuration(raw, ui) {
  ui = ownershipLifecycleReaderUI(ui);
  const p = raw.configuration;
  fields(p, ['policiesPresent', 'live', 'policyHash', 'acceptedClaimKinds', 'acceptedFormats']);
  response(typeof p.policiesPresent === 'boolean' && typeof p.live === 'boolean'
    && (p.policiesPresent ? typeof p.policyHash === 'string' && HASH.test(p.policyHash) : p.policyHash === null && p.live === false));
  unique(p.acceptedClaimKinds, 20, code); unique(p.acceptedFormats, 3, x => OWNERSHIP_PROOF_LIMITS.formats.includes(x));
  requireThat(ui !== null && p.policiesPresent, 503, 'OWNERSHIP_LIFECYCLE_CONFIGURATION_UNAVAILABLE');
  const kinds = ui.proofKinds.filter(k => p.acceptedClaimKinds.includes(k.code));
  const preparation = ui.proofPreparation;
  const formats = preparation?.formats.filter(f => p.acceptedFormats.includes(f)) ?? [];
  const canPrepareEvidence = p.live && preparation !== null && preparation.policyHash === p.policyHash && kinds.length > 0 && formats.length > 0;
  return { schema: 'atlas-ownership-claim-ui-config-v2', accountId: raw.actorId, enabled: true, canPrepareEvidence,
    proofKinds: canPrepareEvidence ? structuredClone(kinds) : [], formats: canPrepareEvidence ? [...formats] : [],
    limits: { maxObjectBytes: OWNERSHIP_PROOF_LIMITS.maxObjectBytes, maxObjects: OWNERSHIP_PROOF_LIMITS.maxObjects, maxBundleBytes: OWNERSHIP_PROOF_LIMITS.maxBundleBytes },
    storageOrigin: canPrepareEvidence ? preparation.storageOrigin : null, storagePathPrefix: canPrepareEvidence ? preparation.storagePathPrefix : null,
    policyNotice: ui.policyNotice };
}

export function projectOwnershipLifecycleRead(action, raw, request, ui = null) {
  response(OWNERSHIP_LIFECYCLE_READ_ACTIONS.includes(action));
  const extra = { read_access: [], configuration: ['configuration'], resolve_certificate: ['card', 'canSubmit', 'expectedOwnershipRevision'],
    list_claims: ['claims', 'nextClaimId'], read_claim: ['claim'], list_history: ['claim', 'submittedAt', 'origin', 'transitions', 'nextRevision'] }[action];
  fields(raw, ['actorId', 'observedAt', ...extra]); response(id(raw.actorId) && date(raw.observedAt));
  const base = { accountId: raw.actorId, observedAt: raw.observedAt };
  if (action === 'read_access') return { schema: 'atlas-ownership-customer-access-v1', accountId: raw.actorId };
  if (action === 'configuration') return configuration(raw, ui);
  if (action === 'resolve_certificate') {
    // target-v1 names the existing approved-binding wire shape only. The SQL
    // eligibility is v2; no legacy workflow state or gateway is used.
    const bound = approvedCard(raw.card);
    response(bound.certificateNumber === request.certificateNumber && typeof raw.canSubmit === 'boolean'
      && raw.expectedOwnershipRevision === (raw.canSubmit ? 0 : null));
    return { schema: 'atlas-ownership-claim-target-v1', ...base, card: bound, canSubmit: raw.canSubmit, expectedOwnershipRevision: raw.expectedOwnershipRevision };
  }
  if (action === 'list_claims') {
    response(Array.isArray(raw.claims) && raw.claims.length <= request.limit);
    const claims = raw.claims.map(c => claim(raw, c)); let prior = request.afterClaimId;
    for (const c of claims) { response(prior === null || c.claimId > prior); prior = c.claimId; }
    response(raw.nextClaimId === null || raw.claims.length === request.limit && id(raw.nextClaimId) && raw.nextClaimId === prior);
    return { schema: 'atlas-ownership-claims-page-v2', ...base, claims, nextClaimId: raw.nextClaimId };
  }
  const current = claim(raw, raw.claim); response(current.claimId === request.claimId);
  if (action === 'read_claim') return { schema: 'atlas-ownership-claim-state-v2', ...base, claim: current };
  response(date(raw.submittedAt) && ['PROOF_V2', 'LEGACY_V1'].includes(raw.origin) && Array.isArray(raw.transitions) && raw.transitions.length <= request.limit);
  let prior = request.afterRevision;
  const transitions = raw.transitions.map(t => {
    fields(t, ['claimRevision', 'action', 'state', 'bundleId', 'occurredAt']);
    const expectedRevision = prior === 0 && raw.origin === 'LEGACY_V1' ? 2 : prior + 1;
    response(revision(t.claimRevision) && t.claimRevision === expectedRevision && t.claimRevision <= current.claimRevision && date(t.occurredAt)
      && Date.parse(t.occurredAt) >= Date.parse(raw.submittedAt) && (t.bundleId === null || id(t.bundleId)));
    const states = { submit_claim: ['PENDING'], withdraw_claim: ['WITHDRAWN'], replace_evidence: ['PENDING'], review_claim: ['VERIFIED', 'REJECTED'] };
    response(Object.hasOwn(states, t.action) && states[t.action].includes(t.state)
      && (!['submit_claim', 'replace_evidence'].includes(t.action) || id(t.bundleId))
      && (t.claimRevision === 1 ? t.action === 'submit_claim' && raw.origin === 'PROOF_V2' : t.action !== 'submit_claim'));
    prior = t.claimRevision; return structuredClone(t);
  });
  response(raw.nextRevision === null || transitions.length === request.limit && raw.nextRevision === prior && prior < current.claimRevision);
  if (request.afterRevision < current.claimRevision && (raw.origin === 'PROOF_V2' || current.claimRevision > 1)) response(transitions.length > 0);
  if (transitions.length && raw.nextRevision === null) {
    const last = transitions.at(-1); response(last.claimRevision === current.claimRevision && last.state === current.state && last.bundleId === current.bundleId);
  }
  return { schema: 'atlas-ownership-claim-history-v2', ...base, claim: current, submittedAt: raw.submittedAt,
    origin: raw.origin, transitions, nextRevision: raw.nextRevision };
}
