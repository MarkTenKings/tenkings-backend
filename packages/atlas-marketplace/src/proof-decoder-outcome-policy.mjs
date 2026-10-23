import {canonicalJSON, hash, requireValue} from './contract.mjs';
import {decoderContractData, decoderExact, decoderFreeze, decoderDigest, decoderToken} from './proof-decoder-profile.mjs';
import {assertProofDecoderPlan} from './proof-decoder-protocol.mjs';

// A pure review model for a future integration, never a validator or admission
// port. Every observation is a synthetic claim; no claim is verified here.
const SCHEMA = 'atlas-proof-decoder-outcome-review-v1';
const ROW_STATES = ['PREPARED', 'VALIDATING', 'VALIDATED', 'RETAINED', 'REJECTED'];
export const PROOF_DECODER_REVIEW_OUTCOMES = Object.freeze([
  'SUCCESS', 'INVALID_IMAGE', 'BUSY', 'CANCELLED', 'TIMEOUT', 'SETUP_FAILURE',
  'RESOURCE_FAILURE', 'TRANSPORT_FAILURE', 'PROTOCOL_FAILURE',
  'ADMISSION_EXPIRED', 'ADMISSION_REVOKED', 'CONTAINMENT_FAILURE', 'SOURCE_MISMATCH',
]);
const EFFECTS = ['NO_EFFECT_CLAIM', 'CLEANUP_CLAIM', 'UNKNOWN'];
const INPUTS = ['COMPLETE_CLAIM', 'INCOMPLETE', 'UNKNOWN'];
const REQUIREMENTS = Object.freeze([
  'AUTHENTICATED_TARGET_AND_JOB_PROVENANCE',
  'INDEPENDENT_NO_EFFECT_OR_WHOLE_JOB_CLEANUP_EVIDENCE',
  'CURRENT_ACTOR_AUTHORITY_AND_AUTHORITATIVE_ADMISSION_FENCE',
  'DURABLE_LEASE_BOUND_COMPARE_AND_SET_AND_IDEMPOTENCY',
]);
const check = value => requireValue(value, 'DECODER_OUTCOME_REVIEW_INVALID');
const uuid = value => check(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value));
const integer = (value, max = Number.MAX_SAFE_INTEGER) => check(Number.isSafeInteger(value) && value >= 0 && value <= max);

function originalInput(value) {
  decoderExact(value, ['uploadId', 'objectKey', 'plan']);
  decoderToken(value.uploadId); decoderDigest(value.objectKey); assertProofDecoderPlan(value.plan);
  return value;
}
function legacyInput(value) {
  decoderExact(value, ['status', 'attempts', 'manifestHash']);
  check(ROW_STATES.includes(value.status)); integer(value.attempts);
  if (['VALIDATED', 'RETAINED'].includes(value.status)) decoderDigest(value.manifestHash);
  else check(value.manifestHash === null);
  return value;
}
function envelope(value) {
  return decoderFreeze({schema: SCHEMA, classification: 'UNQUALIFIED', executionAllowed: false,
    authority: 'NOT_IMPLEMENTED', observations: 'UNVERIFIED_SYNTHETIC_CLAIMS', ...value});
}

/** Model candidate accounting under explicitly hypothetical evidence. The
 * counters are simulated only and cannot be committed to an intake row. */
export function modelProofDecoderAttemptAccounting(input) {
  const data = decoderContractData(input);
  decoderExact(data, ['original', 'legacy', 'maxOperationalAttempts', 'transcript']);
  const original = originalInput(data.original), legacy = legacyInput(data.legacy);
  integer(data.maxOperationalAttempts, 16); check(data.maxOperationalAttempts > 0);
  check(Array.isArray(data.transcript) && data.transcript.length <= 64);
  const originalHash = hash(original), starts = new Map(), requests = new Map(), outcomes = new Map(), reviews = [];
  let operations = 0, contentRejections = 0, activeLease = null;
  let state = legacy.status === 'PREPARED' && legacy.attempts < 3 ? 'READY_FOR_HYPOTHETICAL_ATTEMPT' :
    legacy.status === 'RETAINED' ? 'HISTORICAL_ORIGINAL_ONLY' :
    legacy.status === 'VALIDATED' ? 'LEGACY_VALIDATED_REVIEW_REQUIRED' :
    legacy.status === 'VALIDATING' ? 'LEGACY_UNRESOLVED_LEASE_HOLD' : 'LEGACY_REVIEW_REQUIRED';
  const initialState = state;
  for (const event of data.transcript) {
    check(event && ['BEGIN', 'OUTCOME'].includes(event.kind));
    decoderExact(event, event.kind === 'BEGIN' ? ['kind', 'leaseId', 'requestId', 'originalHash'] :
      ['kind', 'leaseId', 'requestId', 'originalHash', 'outcome', 'effectObservation', 'inputObservation']);
    uuid(event.leaseId); uuid(event.requestId); decoderDigest(event.originalHash);
    check(event.originalHash === originalHash);
    const eventText = canonicalJSON(event);
    if (event.kind === 'BEGIN') {
      if (starts.has(event.leaseId)) {
        requireValue(starts.get(event.leaseId) === eventText, 'DECODER_OUTCOME_IDEMPOTENCY_CONFLICT');
        continue;
      }
      requireValue(!requests.has(event.requestId), 'DECODER_OUTCOME_IDEMPOTENCY_CONFLICT');
      check(activeLease === null && ['READY_FOR_HYPOTHETICAL_ATTEMPT', 'OPERATIONAL_RETRY_REVIEW_REQUIRED'].includes(state));
      check(operations < data.maxOperationalAttempts && legacy.attempts < 3 - contentRejections);
      starts.set(event.leaseId, eventText); requests.set(event.requestId, event.leaseId);
      operations++; activeLease = event.leaseId; state = 'HYPOTHETICAL_ATTEMPT_OPEN';
      continue;
    }
    check(PROOF_DECODER_REVIEW_OUTCOMES.includes(event.outcome) && EFFECTS.includes(event.effectObservation) && INPUTS.includes(event.inputObservation));
    check(starts.has(event.leaseId) && requests.get(event.requestId) === event.leaseId);
    if (outcomes.has(event.leaseId)) {
      requireValue(outcomes.get(event.leaseId) === eventText, 'DECODER_OUTCOME_IDEMPOTENCY_CONFLICT');
      continue;
    }
    check(activeLease === event.leaseId);
    let delta = 0, reason;
    // Uncertainty dominates any result. A peer NOT_STARTED/REAPED string alone
    // cannot establish either modeled no-effect or whole-job cleanup claim.
    if (event.effectObservation === 'UNKNOWN' || event.outcome === 'CONTAINMENT_FAILURE') {
      state = 'UNRESOLVED_EFFECT_HOLD'; reason = 'NO_REPLACEMENT_JOB_OR_CAPACITY_RELEASE';
    } else if (['SUCCESS', 'INVALID_IMAGE'].includes(event.outcome)) {
      if (event.effectObservation !== 'CLEANUP_CLAIM' || event.inputObservation !== 'COMPLETE_CLAIM') {
        state = 'CONTRADICTORY_RESULT_HOLD'; reason = 'RESULT_REQUIRES_COMPLETE_INPUT_AND_INDEPENDENT_CLEANUP';
      } else if (event.outcome === 'SUCCESS') {
        state = 'VALIDATION_REVIEW_REQUIRED'; reason = 'VERIFY_ORIGINAL_RESULT_AND_FRESH_PUBLICATION_FENCE';
      } else {
        delta = 1; contentRejections++;
        state = 'CONTENT_REJECTION_REVIEW_REQUIRED'; reason = 'VERIFY_ACTUAL_IMAGE_INVALID_RECEIPT_BEFORE_CONTENT_DECISION';
      }
    } else if (event.outcome === 'SOURCE_MISMATCH') {
      state = 'ORIGINAL_BINDING_HOLD'; reason = 'NEVER_REPLACE_PLANNED_BYTES_OR_OBJECT_KEY';
    } else if (['ADMISSION_EXPIRED', 'ADMISSION_REVOKED'].includes(event.outcome)) {
      state = 'ADMISSION_REVIEW_REQUIRED'; reason = 'FRESH_AUTHORITY_REQUIRED_NO_CACHED_SNAPSHOT_BYPASS';
    } else {
      state = operations < data.maxOperationalAttempts ? 'OPERATIONAL_RETRY_REVIEW_REQUIRED' : 'OPERATIONAL_BUDGET_REVIEW_REQUIRED';
      reason = 'VERIFY_NO_EFFECT_OR_CLEANUP_BEFORE_SEPARATELY_BOUNDED_RETRY';
    }
    reviews.push({leaseId: event.leaseId, requestId: event.requestId, outcome: event.outcome,
      effectObservation: event.effectObservation, inputObservation: event.inputObservation,
      hypotheticalContentRejectionDelta: delta, candidateState: state, reason,
      unmetRequirements: [...REQUIREMENTS, ...(['SUCCESS', 'INVALID_IMAGE'].includes(event.outcome) ? ['EXACT_COMPLETE_ORIGINAL_AND_AUTHENTICATED_WORKER_RESULT'] : [])]});
    outcomes.set(event.leaseId, eventText); activeLease = null;
  }
  return envelope({original, originalHash, legacy, initialState,
    simulated: {startedOperations: operations, contentRejections,
      remainingConservativeContentBudget: Math.max(0, 3 - Math.min(3, legacy.attempts) - contentRejections),
      remainingOperationalBudget: data.maxOperationalAttempts - operations, state, activeLease},
    reviews, unmetRequirements: [...REQUIREMENTS],
    durableAccounting: 'NOT_IMPLEMENTED_PRESERVE_LEGACY_COUNTERS_AND_HISTORY'});
}

/** Review the future publication split without reading storage, verifying a
 * fence, authorizing a read, or modifying the legacy binding/manifest. */
export function assessProofDecoderPublicationReview(input) {
  const data = decoderContractData(input);
  decoderExact(data, ['original', 'legacy', 'operation', 'objectObservation', 'admissionObservation']);
  const original = originalInput(data.original), legacy = legacyInput(data.legacy);
  check(['HISTORICAL_READ', 'UPLOAD', 'RECOVER', 'BEFORE_RETAIN'].includes(data.operation));
  check(['ABSENT_CLAIM', 'MATCHING_ORIGINAL_CLAIM', 'UNKNOWN', 'MISMATCH_CLAIM'].includes(data.objectObservation));
  check(['MISSING', 'CACHED_UNEXPIRED', 'FENCE_SHAPED_CLAIM', 'REVOKED', 'EXPIRED', 'UNAVAILABLE'].includes(data.admissionObservation));
  let decision, requirements, decoderNeeded;
  if (legacy.status === 'RETAINED') {
    decision = 'EXISTING_AUTHORIZED_ORIGINAL_READ_PATH'; decoderNeeded = false;
    requirements = ['EXISTING_CURRENT_ACTOR_POLICY_STORAGE_AND_MANIFEST_CHECKS'];
  } else if (data.operation === 'HISTORICAL_READ') {
    decision = 'RETAINED_ORIGINAL_REQUIRED'; decoderNeeded = false; requirements = ['DO_NOT_PUBLISH_FROM_A_READ'];
  } else if (data.objectObservation === 'MISMATCH_CLAIM') {
    decision = 'ORIGINAL_CONFLICT_HOLD'; decoderNeeded = false; requirements = ['NO_OVERWRITE_DELETE_OR_NEW_KEY'];
  } else if (data.objectObservation === 'UNKNOWN') {
    decision = 'RECONCILE_ORIGINAL_WITHOUT_NEW_PUBLICATION'; decoderNeeded = false;
    requirements = ['EXACT_ORIGINAL_KEY_LOOKUP_ONLY', 'NO_INFERENCE_OF_ABSENCE_OR_CLEANUP'];
  } else if (data.objectObservation === 'MATCHING_ORIGINAL_CLAIM') {
    decision = legacy.status === 'VALIDATED' ? 'RECONCILE_EXISTING_ORIGINAL_ONLY' : 'UNEXPECTED_ORIGINAL_HOLD';
    decoderNeeded = false;
    requirements = ['EXACT_EXISTING_MANIFEST_AND_ORIGINAL_PROVENANCE', 'SEPARATE_LEASE_ORIGINAL_MANIFEST_BOUND_AUDIT',
      'CURRENT_ACTOR_AUTHORITY_AND_AUTHORITATIVE_ADMISSION_FENCE', 'NO_OVERWRITE_DELETE_OR_NEW_KEY'];
  } else if (legacy.attempts >= 3 || legacy.status === 'REJECTED') {
    decision = 'LEGACY_REVIEW_REQUIRED'; decoderNeeded = false;
    requirements = ['SEPARATELY_REVIEWED_LEGACY_POLICY_NO_COUNTER_RESET_OR_CAUSE_INFERENCE'];
  } else if (legacy.status === 'VALIDATING') {
    decision = 'LEGACY_UNRESOLVED_LEASE_HOLD'; decoderNeeded = false;
    requirements = ['ORIGINAL_JOB_RECONCILIATION_NO_REPLACEMENT'];
  } else {
    decision = 'FRESH_ISOLATED_VALIDATION_REQUIRED'; decoderNeeded = true;
    requirements = ['FRESH_ORIGINAL_VALIDATION_EVEN_FOR_LEGACY_VALIDATED', 'SEPARATE_LEASE_ORIGINAL_MANIFEST_BOUND_AUDIT',
      'AUTHORITATIVE_FENCE_BEFORE_DECODE_AFTER_DECODE_BEFORE_PUBLISH_AND_BEFORE_RETAIN',
      'CURRENT_ACTOR_POLICY_STORAGE_AND_EXPIRY_CHECKS'];
  }
  return envelope({original, originalHash: hash(original), legacy, operation: data.operation,
    objectObservation: data.objectObservation, admissionObservation: data.admissionObservation,
    decision, decoderNeeded, unmetRequirements: requirements,
    admissionVerification: 'NOT_IMPLEMENTED_NO_SNAPSHOT_OR_FENCE_SHAPED_CLAIM_IS_AUTHORITY',
    publicationAllowed: false, historyMutationAllowed: false,
    atomicity: 'NO_FILESYSTEM_STORE_OR_AUTHORITY_ATOMICITY_CLAIM'});
}
