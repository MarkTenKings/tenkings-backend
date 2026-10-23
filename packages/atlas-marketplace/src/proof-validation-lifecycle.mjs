import {canonicalJSON, hash, requireValue} from './contract.mjs';
import {decoderContractData, decoderExact, decoderFreeze, decoderDigest, decoderToken} from './proof-decoder-profile.mjs';
import {assertProofDecoderPlan} from './proof-decoder-protocol.mjs';
import {PROOF_DECODER_REVIEW_OUTCOMES} from './proof-decoder-outcome-policy.mjs';

// Store-neutral preparation only. All timestamps, identities and observations
// are unverified caller data. Hashes bind structural equality, never provenance.
// No action authenticates a receipt or grants submission/publication authority.
const MARKERS = {classification: 'UNQUALIFIED', executionAllowed: false,
  authority: 'NOT_IMPLEMENTED', observations: 'UNVERIFIED_STRUCTURAL_OBSERVATIONS'};
const STATE_SCHEMA = 'atlas-proof-validation-lifecycle-state-v1';
const CAS_SCHEMA = 'atlas-proof-validation-lifecycle-cas-v1';
const MAX_EVENTS = 64, MAX_LEASE_MS = 120000;
const KINDS = ['RESERVE', 'SUBMIT_INTENT', 'OBSERVE_OUTCOME', 'EXPIRE_LEASE'];
const COMMON = ['kind', 'actionId', 'at', 'attemptId', 'leaseId', 'requestId', 'originalHash'];
const EFFECTS = ['NO_EFFECT_CLAIM', 'CLEANUP_CLAIM', 'UNKNOWN'];
const SUBMISSIONS = ['NOT_SUBMITTED_CLAIM', 'SUBMITTED_CLAIM', 'UNKNOWN'];
const INPUTS = ['COMPLETE_CLAIM', 'INCOMPLETE', 'UNKNOWN'];
const check = value => requireValue(value, 'PROOF_VALIDATION_LIFECYCLE_INVALID');
const transition = value => requireValue(value, 'PROOF_VALIDATION_TRANSITION_DENIED');
const same = (a, b) => canonicalJSON(a) === canonicalJSON(b);
const integer = (value, max = Number.MAX_SAFE_INTEGER) => check(Number.isSafeInteger(value) && value >= 0 && value <= max);
const uuid = value => check(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value));

function initial(data) {
  decoderExact(data, ['original', 'legacy', 'operationalLimit']);
  const {original, legacy, operationalLimit} = data;
  decoderExact(original, ['uploadId', 'objectKey', 'plan']);
  decoderToken(original.uploadId); decoderDigest(original.objectKey); assertProofDecoderPlan(original.plan);
  decoderExact(legacy, ['status', 'attempts', 'snapshotHash', 'manifestHash']);
  check(['PREPARED', 'VALIDATING', 'VALIDATED', 'RETAINED', 'REJECTED'].includes(legacy.status));
  integer(legacy.attempts); decoderDigest(legacy.snapshotHash);
  if (['VALIDATED', 'RETAINED'].includes(legacy.status)) decoderDigest(legacy.manifestHash);
  else check(legacy.manifestHash === null);
  integer(operationalLimit, 16); check(operationalLimit > 0);
  const eligible = legacy.status === 'PREPARED' && legacy.attempts < 3;
  return {schema: STATE_SCHEMA, ...MARKERS,
    requirement: {original, originalHash: hash(original), legacy, operationalLimit}, revision: 0,
    accounting: {legacyAttempts: legacy.attempts, operationalLimit, operationalAttempts: 0, contentRejections: 0,
      activeAttemptId: null, disposition: eligible ? 'RESERVATION_CLAIM_ELIGIBLE' : 'LEGACY_REVIEW_HOLD',
      holdReason: eligible ? null : `LEGACY_${legacy.status}_${legacy.attempts >= 3 ? 'EXHAUSTED' : 'REVIEW_REQUIRED'}`},
    attempts: [], events: []};
}

function actionData(action) {
  check(action && typeof action.kind === 'string' && KINDS.includes(action.kind));
  decoderExact(action, [...COMMON, ...(action.kind === 'RESERVE' ? ['leaseUntil'] :
    action.kind === 'OBSERVE_OUTCOME' ? ['outcome', 'submissionObservation', 'effectObservation', 'inputObservation'] : [])]);
  for (const key of ['actionId', 'attemptId', 'leaseId', 'requestId']) uuid(action[key]);
  integer(action.at); decoderDigest(action.originalHash);
  if (action.kind === 'RESERVE') {
    integer(action.leaseUntil);
    check(action.leaseUntil > action.at && action.leaseUntil - action.at <= MAX_LEASE_MS);
  }
  if (action.kind === 'OBSERVE_OUTCOME') check(PROOF_DECODER_REVIEW_OUTCOMES.includes(action.outcome) &&
    SUBMISSIONS.includes(action.submissionObservation) && EFFECTS.includes(action.effectObservation) && INPUTS.includes(action.inputObservation));
}

function duplicate(state, action) {
  const previous = state.events.find(event => event.actionId === action.actionId ||
    (event.kind === action.kind && event.attemptId === action.attemptId));
  if (!previous) return false;
  // The stable actionId and original event timestamp belong to the logical
  // operation, not each delivery. A changed redelivery is a conflict.
  requireValue(same(previous, action), 'PROOF_VALIDATION_IDEMPOTENCY_CONFLICT');
  return true;
}
function hold(state, attempt, reason) {
  attempt.phase = 'HELD'; state.accounting.disposition = 'UNRESOLVED_HOLD';
  state.accounting.holdReason ??= reason; // A later claim cannot erase the first hold.
}
function apply(state, action) {
  actionData(action);
  check(action.originalHash === state.requirement.originalHash);
  check(state.events.length < MAX_EVENTS && (state.events.length === 0 || action.at >= state.events.at(-1).at));
  const accounting = state.accounting, legacy = state.requirement.legacy;
  if (action.kind === 'RESERVE') {
    transition(accounting.activeAttemptId === null && accounting.holdReason === null &&
      ['RESERVATION_CLAIM_ELIGIBLE', 'OPERATIONAL_RETRY_REVIEW_REQUIRED'].includes(accounting.disposition));
    transition(accounting.operationalAttempts < accounting.operationalLimit && legacy.attempts < 3 - accounting.contentRejections);
    requireValue(!state.attempts.some(attempt => attempt.attemptId === action.attemptId || attempt.leaseId === action.leaseId ||
      attempt.requestId === action.requestId), 'PROOF_VALIDATION_IDEMPOTENCY_CONFLICT');
    accounting.operationalAttempts++; accounting.activeAttemptId = action.attemptId;
    accounting.disposition = 'ATTEMPT_CLAIM_OPEN';
    state.attempts.push({attemptId: action.attemptId, leaseId: action.leaseId, requestId: action.requestId,
      createdAt: action.at, leaseUntil: action.leaseUntil, operationalOrdinal: accounting.operationalAttempts,
      phase: 'RESERVED', submitActionId: null, outcomeActionId: null, expiryActionId: null});
  } else {
    const attempt = state.attempts.find(value => value.attemptId === action.attemptId);
    transition(attempt && accounting.activeAttemptId === attempt.attemptId);
    check(attempt.leaseId === action.leaseId && attempt.requestId === action.requestId);
    if (action.kind === 'SUBMIT_INTENT') {
      transition(attempt.phase === 'RESERVED' && action.at < attempt.leaseUntil);
      attempt.phase = 'SUBMIT_INTENT'; attempt.submitActionId = action.actionId;
    } else if (action.kind === 'EXPIRE_LEASE') {
      transition(action.at >= attempt.leaseUntil && attempt.expiryActionId === null);
      attempt.expiryActionId = action.actionId; hold(state, attempt, 'LEASE_EXPIRED');
    } else {
      transition(attempt.outcomeActionId === null);
      attempt.outcomeActionId = action.actionId;
      // Expiry and existing holds absorb even a later successful/clean claim.
      if (attempt.phase === 'HELD' || action.at >= attempt.leaseUntil) hold(state, attempt, 'LEASE_EXPIRED');
      else if (action.submissionObservation === 'UNKNOWN' || action.effectObservation === 'UNKNOWN') hold(state, attempt, 'UNKNOWN_SUBMISSION_OR_CLEANUP');
      else if (action.outcome === 'CONTAINMENT_FAILURE') hold(state, attempt, 'CONTAINMENT_FAILURE');
      else if ((action.submissionObservation === 'SUBMITTED_CLAIM' &&
          (attempt.submitActionId === null || action.effectObservation !== 'CLEANUP_CLAIM')) ||
          (action.submissionObservation === 'NOT_SUBMITTED_CLAIM' &&
          (action.effectObservation !== 'NO_EFFECT_CLAIM' || action.inputObservation === 'COMPLETE_CLAIM'))) {
        hold(state, attempt, 'CONTRADICTORY_EFFECT_CLAIMS');
      } else if (['SUCCESS', 'INVALID_IMAGE'].includes(action.outcome)) {
        if (attempt.submitActionId === null || action.submissionObservation !== 'SUBMITTED_CLAIM' ||
            action.effectObservation !== 'CLEANUP_CLAIM' || action.inputObservation !== 'COMPLETE_CLAIM') {
          hold(state, attempt, 'INCOMPLETE_RESULT_CLAIMS');
        } else {
          if (action.outcome === 'INVALID_IMAGE') accounting.contentRejections++;
          attempt.phase = 'OUTCOME_RECORDED'; accounting.activeAttemptId = null;
          accounting.disposition = action.outcome === 'SUCCESS' ? 'VALIDATION_REVIEW_REQUIRED' : 'CONTENT_REJECTION_REVIEW_REQUIRED';
        }
      } else if (['SOURCE_MISMATCH', 'ADMISSION_EXPIRED', 'ADMISSION_REVOKED'].includes(action.outcome)) {
        hold(state, attempt, action.outcome);
      } else {
        attempt.phase = 'OUTCOME_RECORDED'; accounting.activeAttemptId = null;
        accounting.disposition = accounting.operationalAttempts < accounting.operationalLimit ?
          'OPERATIONAL_RETRY_REVIEW_REQUIRED' : 'OPERATIONAL_BUDGET_REVIEW_REQUIRED';
      }
    }
  }
  state.events.push(action); state.revision++;
  return state;
}

function reconstruct(state) {
  decoderExact(state, ['schema', ...Object.keys(MARKERS), 'requirement', 'revision', 'accounting', 'attempts', 'events']);
  decoderExact(state.requirement, ['original', 'originalHash', 'legacy', 'operationalLimit']);
  check(Array.isArray(state.events) && state.events.length <= MAX_EVENTS);
  const {original, legacy, operationalLimit} = state.requirement;
  const rebuilt = initial({original, legacy, operationalLimit});
  for (const action of state.events) {
    actionData(action); check(!duplicate(rebuilt, action)); apply(rebuilt, action);
  }
  // Derived rows/counters must agree with the entire bounded event history.
  // This detects structural edits, not an attacker replacing a whole history.
  requireValue(same(state, rebuilt), 'PROOF_VALIDATION_STATE_CHANGED');
  return rebuilt;
}

/** Pure initial snapshot. It does not adopt an intake row, persist a lease or
 * permit legacy VALIDATED/rejected/exhausted recovery. No migration/reset API. */
export function createProofValidationLifecycleContract(input) {
  return decoderFreeze(initial(decoderContractData(input)));
}

/** Returns an inert CAS proposal. A future private integration must authenticate
 * all observations and durably compare BOTH revision and immutable requirement
 * before atomically replacing its record. No store, callback or adapter is used.
 * Exact delivery replay needs no write, even with an older expected revision;
 * a future revision or any stale new action refuses. Rehydrate the saved action
 * (including actionId/time), never manufacture a fresh outcome on recovery.
 * This contract has no publication, hold-clear, lease-renewal or reset action. */
export function reduceProofValidationLifecycle(input) {
  const data = decoderContractData(input);
  decoderExact(data, ['state', 'expectedRevision', 'action']);
  integer(data.expectedRevision, MAX_EVENTS); actionData(data.action);
  const state = reconstruct(data.state);
  requireValue(data.expectedRevision <= state.revision, 'PROOF_VALIDATION_CAS_CONFLICT');
  const replay = duplicate(state, data.action);
  requireValue(replay || data.expectedRevision === state.revision, 'PROOF_VALIDATION_CAS_CONFLICT');
  const comparison = {revision: state.revision, requirement: state.requirement};
  const next = replay ? state : apply(state, data.action);
  return decoderFreeze({schema: CAS_SCHEMA, ...MARKERS, comparison, next, writeRequired: !replay, replay});
}
