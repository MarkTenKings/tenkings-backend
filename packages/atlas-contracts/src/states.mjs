import { immutable, requireThat as check } from './strict.mjs';

// Executable authority matrix for proposed production stage orchestration.
// The local reference stores draft/checklist and review transitions; it does not
// expose a certificate or learning transition/consumer.
export const CARD_TRANSITIONS = immutable([
  { from: 'PAIRED_INTAKE', event: 'VERIFY_ORIGINALS', to: 'EVIDENCE_VERIFIED', authority: 'DETERMINISTIC', proof: 'PAIRED_SOURCE_HASHES' },
  { from: 'EVIDENCE_VERIFIED', event: 'PROPOSE_IDENTITY', to: 'IDENTITY_PROPOSED', authority: 'MACHINE', proof: 'FIELD_SOURCE_REFERENCES' },
  { from: 'IDENTITY_PROPOSED', event: 'VALIDATE_GEOMETRY', to: 'GEOMETRY_VALIDATED_FOR_DRAFT', authority: 'DETERMINISTIC', proof: 'SOURCE_BOUND_GEOMETRY_RECEIPT' },
  { from: 'GEOMETRY_VALIDATED_FOR_DRAFT', event: 'ADMIT_DETECTION', to: 'DETECTION_COMPLETE', authority: 'DETERMINISTIC', proof: 'FROZEN_WORKER_AND_RAW_FINDING_LEDGER' },
  { from: 'DETECTION_COMPLETE', event: 'PROPOSE_REVIEW', to: 'AI_REVIEW_PROPOSALS', authority: 'MACHINE', proof: 'IMMUTABLE_PROPOSAL_REVISION' },
  { from: 'AI_REVIEW_PROPOSALS', event: 'RENDER_DRAFT', to: 'DRAFT_PACKAGE_READY', authority: 'DETERMINISTIC', proof: 'COMPLETE_BOUND_CHECKLIST' },
  { from: 'DRAFT_PACKAGE_READY', event: 'SUBMIT_REVIEW', to: 'READY_FOR_HUMAN', authority: 'MACHINE', proof: 'EXACT_PACKAGE_HASH' },
  { from: 'READY_FOR_HUMAN', event: 'CLAIM_REVIEW', to: 'HUMAN_REVIEW', authority: 'TRAINED_HUMAN', proof: 'ASSIGNMENT_FENCE' },
  { from: 'HUMAN_REVIEW', event: 'APPROVE_REVISION', to: 'HUMAN_APPROVED', authority: 'TRAINED_HUMAN', proof: 'FRESH_IDENTITY_EXACT_REVISION_AND_PACKAGE' },
  { from: 'HUMAN_APPROVED', event: 'EDIT_REVIEW', to: 'AI_REVIEW_PROPOSALS', authority: 'TRAINED_HUMAN', proof: 'NEW_REVISION_INVALIDATES_APPROVAL' },
]);
export function requireTransition(from, event, authority) {
  const transition = CARD_TRANSITIONS.find(t => t.from === from && t.event === event && t.authority === authority);
  check(transition, 'TRANSITION_FORBIDDEN');
  return transition;
}
export const EXCEPTION_STATES = immutable(['NEEDS_IDENTITY', 'NEEDS_CAPTURE', 'NEEDS_EXPERT', 'RETRY_WAIT', 'UNKNOWN_PENDING_RECONCILIATION', 'QUARANTINED', 'DEAD_LETTER']);
