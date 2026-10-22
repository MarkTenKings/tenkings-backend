import { clone, hash } from './contract.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const revision = value => Number.isSafeInteger(value) && value > 0 && value < 2147483647;
const pending = ['FINGERPRINT_ACTIVATION_REQUIRED', 'AUTHENTICATED_CURRENT_TITLE_RECHECK_REQUIRED', 'ATLAS_CUSTODY_EVIDENCE_REQUIRED', 'HOLD_AND_LIST_CONSIGNMENT_REQUIRED', 'SELLER_PAYMENT_ELIGIBILITY_REQUIRED', 'APPROVED_MARKETPLACE_POLICY_REQUIRED', 'APPROVED_BACK_AND_REPORT_BYTES_REQUIRED'];

/** Structural compatibility with R1's current-owner collection/display contracts.
 * A caller-supplied projection is not title authority. No network, credentials,
 * claims/history import, enable flag or real-to-demo identity conversion exists.
 */
export function inspectR1AuthorityCompatibility({ accountId, collectionCard: card, display } = {}) {
  const reasons = [...pending];
  const approved = card?.approvedCard, report = approved?.report, own = card?.ownership;
  const valid = UUID.test(accountId ?? '') && card?.schema === 'atlas-owner-collection-card-v1'
    && UUID.test(card.cardId ?? '') && own?.status === 'VERIFIED' && own.ownerAccountId === accountId && revision(own.revision)
    && UUID.test(approved?.approvalActionId ?? '') && /^ATLAS-[A-F0-9]{12}$/.test(approved?.certificateNumber ?? '')
    && /^ar_[A-Za-z0-9_-]{24}$/.test(report?.publicToken ?? '') && revision(report?.version) && SHA.test(report?.publicHash ?? '');
  if (!valid) return { available: false, compatible: false, reasonCodes: ['R1_OWNER_PROJECTION_INVALID', ...reasons], claimsEnabled: false, historyEnabled: false };
  const binding = { accountId, cardId: card.cardId, ownershipRevision: own.revision, approvalActionId: approved.approvalActionId, certificateNumber: approved.certificateNumber, report: clone(report) };
  const front = display?.front;
  const expectedPath = `/account/api/customer/collection/cards/${binding.cardId}/display/front?ownershipRevision=${binding.ownershipRevision}&approvalActionId=${binding.approvalActionId}&version=${report.version}&publicHash=${report.publicHash}`;
  const displayMatches = display?.schema === 'atlas-collection-display-v1' && hash(display.binding ?? null) === hash(binding)
    && typeof display.title === 'string' && display.title.length > 0 && display.title.length <= 500
    && Number.isFinite(display.finalGrade) && display.finalGrade >= 0 && display.finalGrade <= 10 && Number.isInteger(display.finalGrade * 2)
    && front?.provenance === 'APPROVED_GRADING_PHOTOGRAPH' && SHA.test(front.sha256 ?? '')
    && Number.isSafeInteger(front.byteCount) && front.byteCount > 0 && front.byteCount <= 50 * 1024 * 1024
    && front.width === 1350 && front.height === 1858 && front.contentType === 'image/webp'
    && (front.byteCount <= 2 * 1024 * 1024 ? front.status === 'AVAILABLE' && front.path === expectedPath : front.status === 'EXCEEDS_DISPLAY_LIMIT' && front.path === null);
  if (!displayMatches) reasons.unshift('R1_APPROVED_DISPLAY_BINDING_INVALID');
  // R1 explicitly reports currentPhysicalHolder UNKNOWN even when custody is
  // RECORDED. Never turn that label or a matching photo into ATLAS-held custody.
  return { available: false, compatible: Boolean(displayMatches), reasonCodes: reasons, binding: clone(binding), bindingHash: hash(binding), approvedFront: displayMatches ? { sha256: front.sha256, byteCount: front.byteCount, width: front.width, height: front.height } : null, claimsEnabled: false, historyEnabled: false };
}

export function createR1AuthorityCompatibilityAdapter() {
  return Object.freeze({
    inspect: inspectR1AuthorityCompatibility,
    async read() { return { available: false, reason: 'R1_MARKETPLACE_AUTHORITY_UNQUALIFIED', reasonCodes: [...pending], claimsEnabled: false, historyEnabled: false }; },
  });
}
