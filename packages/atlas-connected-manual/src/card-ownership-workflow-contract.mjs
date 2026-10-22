import { requireThat } from '@atlas/manual-service/contract';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const PROOF = /^[A-Z][A-Z0-9_]{0,39}$/;
const record = v => v && Object.getPrototypeOf(v) === Object.prototype;
const id = v => typeof v === 'string' && UUID.test(v);
const date = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const revision = v => Number.isSafeInteger(v) && v >= 0 && v < 2147483647;
const input = ok => requireThat(ok, 400, 'INVALID_OWNERSHIP_WORKFLOW_REQUEST');
const response = ok => requireThat(ok, 503, 'OWNERSHIP_WORKFLOW_RESPONSE_INVALID');
const availability = ['AVAILABLE', 'EXPIRED', 'POLICY_CHANGED', 'POLICY_UNAVAILABLE', 'UNAVAILABLE'];
export const OWNERSHIP_WORKFLOW_ACTIONS = Object.freeze({
  CUSTOMER: Object.freeze(['resolve_certificate', 'list_claims', 'read_claim', 'recover_request']),
  REVIEWER: Object.freeze(['list_queue', 'read_claim', 'recover_request']),
});

export function ownershipWorkflowInput(audience, action, value) {
  requireThat(OWNERSHIP_WORKFLOW_ACTIONS[audience]?.includes(action), 403, 'OWNERSHIP_WORKFLOW_READ_ONLY');
  const names = action === 'resolve_certificate' ? ['certificateNumber'] : action === 'read_claim' ? ['claimId']
    : action === 'recover_request' ? ['requestId'] : ['afterClaimId', 'limit'];
  input(record(value) && Reflect.ownKeys(value).length === names.length
    && names.every(k => Object.hasOwn(value, k) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value')));
  if (action === 'resolve_certificate') input(typeof value.certificateNumber === 'string' && /^ATLAS-[A-F0-9]{12}$/.test(value.certificateNumber));
  else if (action === 'read_claim') input(id(value.claimId));
  else if (action === 'recover_request') input(id(value.requestId));
  else input((value.afterClaimId === null || id(value.afterClaimId)) && Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 50);
  return Object.fromEntries(names.map(k => [k, value[k]]));
}

function card(v) {
  if (v === null) return null;
  response(record(v) && id(v.cardId) && id(v.approvalActionId) && HASH.test(v.approvalReportHash) && /^ATLAS-[A-F0-9]{12}$/.test(v.certificateNumber)
    && record(v.report) && /^ar_[A-Za-z0-9_-]{24}$/.test(v.report.publicToken)
    && revision(v.report.version) && v.report.version > 0 && HASH.test(v.report.publicHash));
  return { cardId: v.cardId, approvalActionId: v.approvalActionId, approvalReportHash: v.approvalReportHash, certificateNumber: v.certificateNumber,
    report: { publicToken: v.report.publicToken, version: v.report.version, publicHash: v.report.publicHash } };
}
function claim(v, audience) {
  response(record(v) && id(v.claimId) && id(v.cardId) && id(v.requestId) && date(v.submittedAt)
    && record(v.decision) && ['PENDING', 'VERIFIED', 'REJECTED'].includes(v.decision.state)
    && (v.decision.state === 'PENDING' ? v.decision.decidedAt === null : date(v.decision.decidedAt))
    && record(v.evidence) && availability.includes(v.evidence.availability)
    && (v.evidence.referenceId === null || id(v.evidence.referenceId))
    && (v.evidence.usableUntil === null || date(v.evidence.usableUntil))
    && (v.evidence.proofKind === null || typeof v.evidence.proofKind === 'string' && PROOF.test(v.evidence.proofKind)));
  const boundCard = card(v.card);
  response(boundCard === null || boundCard.cardId === v.cardId);
  const present = v.evidence.referenceId !== null;
  response(present === (v.evidence.usableUntil !== null) && present === (v.evidence.proofKind !== null)
    && (v.evidence.availability === 'UNAVAILABLE' || present));
  const ready = boundCard !== null && v.evidence.availability === 'AVAILABLE';
  const status = v.decision.state !== 'PENDING' ? 'DECIDED' : ready ? 'PENDING' : 'BLOCKED';
  response(v.reviewStatus === status && record(v.actions) && v.actions.downloadEvidence === ready);
  const value = { claimId: v.claimId, cardId: v.cardId, requestId: v.requestId, submittedAt: v.submittedAt,
    card: boundCard, decision: { state: v.decision.state, decidedAt: v.decision.decidedAt },
    evidence: { referenceId: v.evidence.referenceId, availability: v.evidence.availability,
      usableUntil: v.evidence.usableUntil, proofKind: v.evidence.proofKind }, reviewStatus: status,
    actions: { downloadEvidence: ready } };
  if (audience === 'CUSTOMER') {
    response(typeof v.currentlyOwnedByYou === 'boolean');
    value.currentlyOwnedByYou = v.currentlyOwnedByYou;
  } else {
    response(revision(v.expectedOwnershipRevision) && typeof v.actions.verify === 'boolean'
      && v.actions.reject === (ready && status === 'PENDING')
      && v.actions.verify === (ready && status === 'PENDING' && v.expectedOwnershipRevision === 0)
      && (v.decision.evidenceReferenceId === null || id(v.decision.evidenceReferenceId))
      && (v.decision.state !== 'PENDING' || v.decision.evidenceReferenceId === null));
    value.expectedOwnershipRevision = v.expectedOwnershipRevision;
    value.actions.verify = v.actions.verify; value.actions.reject = v.actions.reject;
    value.decision.evidenceReferenceId = v.decision.evidenceReferenceId;
  }
  return value;
}

/** Projection only. Its booleans describe the read snapshot, never authority to
 * mutate. The immutable evidence gateway revalidates every decision itself. */
export function projectOwnershipWorkflow(audience, action, value, request) {
  response(OWNERSHIP_WORKFLOW_ACTIONS[audience]?.includes(action) && record(value) && id(value.actorId) && date(value.observedAt));
  const identity = audience === 'CUSTOMER' ? { accountId: value.actorId } : { reviewerId: value.actorId };
  const common = { ...identity, observedAt: value.observedAt };
  if (action === 'resolve_certificate') {
    const bound = card(value.card);
    response(bound && bound.certificateNumber === request.certificateNumber && typeof value.canSubmit === 'boolean'
      && value.expectedOwnershipRevision === (value.canSubmit ? 0 : null));
    return { schema: 'atlas-ownership-claim-target-v1', ...common, card: bound,
      canSubmit: value.canSubmit, expectedOwnershipRevision: value.expectedOwnershipRevision };
  }
  if (action === 'list_claims' || action === 'list_queue') {
    response(Array.isArray(value.claims) && value.claims.length <= request.limit
      && (value.nextClaimId === null || id(value.nextClaimId)));
    const claims = value.claims.map(v => claim(v, audience));
    response(claims.every((v, i) => (!request.afterClaimId || v.claimId > request.afterClaimId)
      && (!i || v.claimId > claims[i - 1].claimId) && (action !== 'list_queue' || v.decision.state === 'PENDING')));
    // Reviewer pages may lose rows to a concurrent ACL/decision change. The
    // cursor is the final scanned ID, not necessarily the final returned ID.
    response(value.nextClaimId === null || (!request.afterClaimId || value.nextClaimId > request.afterClaimId)
      && claims.every(v => v.claimId <= value.nextClaimId));
    return { schema: 'atlas-ownership-claims-v1', ...common, claims, nextClaimId: value.nextClaimId };
  }
  const result = claim(value.claim, audience);
  if (action === 'read_claim') {
    response(result.claimId === request.claimId);
    return { schema: 'atlas-ownership-claim-v1', ...common, claim: result };
  }
  const r = value.receipt, expected = audience === 'CUSTOMER' ? ['CLAIM_SUBMITTED'] : ['CLAIM_VERIFIED', 'CLAIM_REJECTED'];
  response(record(r) && id(r.eventId) && r.requestId === request.requestId && expected.includes(r.kind)
    && record(r.evidence) && id(r.evidence.referenceId) && HASH.test(r.evidence.sha256)
    && (audience !== 'CUSTOMER' || r.eventId === result.claimId && r.requestId === result.requestId));
  return { schema: 'atlas-ownership-request-v1', ...common, claim: result,
    receipt: { eventId: r.eventId, requestId: r.requestId, kind: r.kind,
      evidence: { referenceId: r.evidence.referenceId, sha256: r.evidence.sha256 } } };
}
