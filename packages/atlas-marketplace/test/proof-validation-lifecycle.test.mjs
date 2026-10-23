import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/contract.mjs';
import {assertProofImageValidator} from '../src/proof-image.mjs';
import {instantiateMarketplacePhysical} from '../src/physical-runtime.mjs';
import {PROOF_DECODER_REVIEW_OUTCOMES} from '../src/proof-decoder-outcome-policy.mjs';
import {createProofValidationLifecycleContract as create, reduceProofValidationLifecycle as reduce} from '../src/proof-validation-lifecycle.mjs';

const id = n => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const original = () => ({uploadId: 'atlas_upload_fixture', objectKey: 'a'.repeat(64),
  plan: {byteCount: 11, sha256: 'b'.repeat(64), declaredType: 'image/png'}});
const legacy = (status = 'PREPARED', attempts = 0) => ({status, attempts, snapshotHash: 'c'.repeat(64),
  manifestHash: ['VALIDATED', 'RETAINED'].includes(status) ? 'd'.repeat(64) : null});
const start = (extra = {}) => create({original: original(), legacy: legacy(), operationalLimit: 3, ...extra});
const common = (kind, n, at) => ({kind, actionId: id(n * 10 + ['RESERVE', 'SUBMIT_INTENT', 'OBSERVE_OUTCOME', 'EXPIRE_LEASE'].indexOf(kind)),
  at, attemptId: id(n), leaseId: id(n + 100), requestId: id(n + 200), originalHash: hash(original())});
const reserve = (n = 1) => ({...common('RESERVE', n, n * 1000), leaseUntil: n * 1000 + 100});
const submit = (n = 1) => common('SUBMIT_INTENT', n, n * 1000 + 1);
const outcome = (n = 1, extra = {}) => ({...common('OBSERVE_OUTCOME', n, n * 1000 + 2), outcome: 'TIMEOUT',
  submissionObservation: 'SUBMITTED_CLAIM', effectObservation: 'CLEANUP_CLAIM', inputObservation: 'COMPLETE_CLAIM', ...extra});
const expire = (n = 1) => common('EXPIRE_LEASE', n, reserve(n).leaseUntil);
const proposal = (state, action, expectedRevision = state.revision) => reduce({state, action, expectedRevision});
const step = (state, action) => proposal(state, action).next;
const run = (actions, initial = start()) => actions.reduce(step, initial);
const opened = () => run([reserve(), submit()]);
const inert = value => {
  assert.equal(value.classification, 'UNQUALIFIED'); assert.equal(value.executionAllowed, false);
  assert.equal(value.authority, 'NOT_IMPLEMENTED'); assert.equal(value.observations, 'UNVERIFIED_STRUCTURAL_OBSERVATIONS');
  assert.equal(Object.isFrozen(value), true);
  assert.throws(() => assertProofImageValidator(value), {code: 'PROOF_DECODER_UNAVAILABLE'});
  assert.throws(() => instantiateMarketplacePhysical(value, {}), {code: 'PHYSICAL_FACTORY_UNQUALIFIED'});
};

test('new state and CAS proposals are inert data; immutable originals survive serialization and every transition', () => {
  const input = {original: original(), legacy: legacy('PREPARED', 2), operationalLimit: 3};
  const before = structuredClone(input), state = create(input);
  input.original.plan.sha256 = 'e'.repeat(64); input.legacy.attempts = 0;
  assert.deepEqual(state.requirement.original, before.original); assert.deepEqual(state.requirement.legacy, before.legacy);
  const reserved = proposal(state, reserve());
  inert(state); inert(reserved); inert(reserved.next);
  assert.deepEqual(reserved.comparison, {revision: 0, requirement: state.requirement});
  assert.equal(reserved.writeRequired, true); assert.equal(reserved.replay, false);
  assert.equal(state.revision, 0); assert.equal(reserved.next.revision, 1);
  assert.equal(Object.isFrozen(reserved.next.requirement.original.plan), true);
  const complete = run([submit(), outcome(1, {outcome: 'SUCCESS'})], JSON.parse(JSON.stringify(reserved.next)));
  assert.deepEqual(complete.requirement, state.requirement); assert.equal(complete.accounting.legacyAttempts, 2);
  assert.equal(complete.accounting.contentRejections, 0); assert.equal(complete.accounting.disposition, 'VALIDATION_REVIEW_REQUIRED');
  inert(complete);
  assert.throws(() => assertProofImageValidator({...complete, qualified: true, assertReady: () => true}), {code: 'PROOF_DECODER_UNAVAILABLE'});
  assert.throws(() => step(complete, reserve(2)), {code: 'PROOF_VALIDATION_TRANSITION_DENIED'});
});

test('only current CAS can append; exact old delivery replays without another revision or count', () => {
  const initial = start(), first = proposal(initial, reserve()), rival = proposal(initial, {...reserve(2), at: 1000, leaseUntil: 1100});
  assert.equal(first.comparison.revision, rival.comparison.revision); // Actual store must select one winner.
  const state = run([submit(), outcome()], first.next);
  assert.equal(state.revision, 3);
  for (const action of [reserve(), submit(), outcome()]) {
    const replay = proposal(state, action, 0);
    assert.equal(replay.writeRequired, false); assert.equal(replay.replay, true); assert.deepEqual(replay.next, state);
    assert.equal(replay.comparison.revision, 3);
  }
  assert.throws(() => proposal(state, reserve(2), 0), {code: 'PROOF_VALIDATION_CAS_CONFLICT'});
  assert.throws(() => proposal(state, outcome(), 4), {code: 'PROOF_VALIDATION_CAS_CONFLICT'});
  for (const change of [{outcome: 'SUCCESS'}, {at: 1003}, {actionId: id(999)}, {originalHash: 'f'.repeat(64)}]) {
    assert.throws(() => proposal(state, {...outcome(), ...change}), {code: 'PROOF_VALIDATION_IDEMPOTENCY_CONFLICT'});
  }
  const next = step(state, reserve(2));
  assert.equal(next.accounting.operationalAttempts, 2); assert.equal(next.revision, 4);
  assert.throws(() => proposal(next, {...submit(2), actionId: reserve().actionId}), {code: 'PROOF_VALIDATION_IDEMPOTENCY_CONFLICT'});
});

test('unknown submission or cleanup dominates every result and retains the active attempt permanently', () => {
  for (const result of PROOF_DECODER_REVIEW_OUTCOMES) for (const field of ['submissionObservation', 'effectObservation']) {
    const event = outcome(1, {outcome: result, [field]: 'UNKNOWN'}), state = step(opened(), event);
    assert.equal(state.accounting.disposition, 'UNRESOLVED_HOLD'); assert.equal(state.accounting.activeAttemptId, id(1));
    assert.equal(state.accounting.contentRejections, 0); assert.equal(state.attempts[0].phase, 'HELD');
    assert.throws(() => step(state, reserve(2)), {code: 'PROOF_VALIDATION_TRANSITION_DENIED'});
    const expired = step(state, expire());
    assert.equal(expired.accounting.holdReason, 'UNKNOWN_SUBMISSION_OR_CLEANUP');
    assert.equal(expired.accounting.activeAttemptId, id(1));
    assert.deepEqual(proposal(expired, event, 0).next, expired);
    assert.throws(() => step(expired, outcome(1, {outcome: 'SUCCESS'})), {code: 'PROOF_VALIDATION_IDEMPOTENCY_CONFLICT'});
  }
});

test('expiry never grants retry, including before submission and when clean success or invalid arrives late', () => {
  for (const actions of [[reserve()], [reserve(), submit()]]) {
    const state = run(actions);
    assert.throws(() => step(state, {...expire(), at: reserve().leaseUntil - 1}), {code: 'PROOF_VALIDATION_TRANSITION_DENIED'});
    const held = step(state, expire());
    assert.equal(held.accounting.holdReason, 'LEASE_EXPIRED'); assert.equal(held.accounting.activeAttemptId, id(1));
    assert.throws(() => step(held, reserve(2)), {code: 'PROOF_VALIDATION_TRANSITION_DENIED'});
    assert.throws(() => step(held, {...submit(), at: 1101}));
    for (const result of ['SUCCESS', 'INVALID_IMAGE', 'TIMEOUT']) {
      const late = step(held, outcome(1, {at: 1101, outcome: result}));
      assert.equal(late.accounting.holdReason, 'LEASE_EXPIRED'); assert.equal(late.accounting.contentRejections, 0);
      assert.equal(late.accounting.activeAttemptId, id(1));
    }
  }
  for (const result of ['SUCCESS', 'INVALID_IMAGE', 'TIMEOUT']) {
    const atBoundary = step(opened(), outcome(1, {at: 1100, outcome: result}));
    assert.equal(atBoundary.accounting.holdReason, 'LEASE_EXPIRED'); assert.equal(atBoundary.accounting.contentRejections, 0);
    assert.equal(atBoundary.accounting.activeAttemptId, id(1));
    assert.throws(() => step(atBoundary, reserve(2)));
  }
  assert.throws(() => run([reserve(), {...submit(), at: 1100}]), {code: 'PROOF_VALIDATION_TRANSITION_DENIED'});
});

test('separate operational accounting reaches its explicit limit without changing legacy/content counters', () => {
  for (const limit of [1, 3, 16]) for (const result of ['BUSY', 'CANCELLED', 'TIMEOUT', 'SETUP_FAILURE', 'RESOURCE_FAILURE', 'TRANSPORT_FAILURE', 'PROTOCOL_FAILURE']) {
    let state = start({legacy: legacy('PREPARED', 2), operationalLimit: limit});
    for (let n = 1; n <= limit; n++) state = run([reserve(n), submit(n), outcome(n, {outcome: result})], state);
    assert.equal(state.accounting.operationalAttempts, limit); assert.equal(state.accounting.contentRejections, 0);
    assert.equal(state.accounting.legacyAttempts, 2); assert.equal(state.requirement.legacy.attempts, 2);
    assert.equal(state.accounting.disposition, 'OPERATIONAL_BUDGET_REVIEW_REQUIRED');
    assert.equal(state.accounting.activeAttemptId, null); assert.equal(state.events.length, limit * 3);
    assert.throws(() => step(state, reserve(limit + 1)), {code: 'PROOF_VALIDATION_TRANSITION_DENIED'});
  }
  for (const operationalLimit of [0, 17, -1, 1.5, true, Number.MAX_SAFE_INTEGER]) assert.throws(() => start({operationalLimit}));
  const noSubmission = run([reserve(), outcome(1, {submissionObservation: 'NOT_SUBMITTED_CLAIM', effectObservation: 'NO_EFFECT_CLAIM', inputObservation: 'UNKNOWN'})]);
  assert.equal(noSubmission.accounting.operationalAttempts, 1); assert.equal(noSubmission.accounting.contentRejections, 0);
  assert.equal(noSubmission.accounting.disposition, 'OPERATIONAL_RETRY_REVIEW_REQUIRED');
  assert.equal(step(noSubmission, reserve(2)).accounting.operationalAttempts, 2);
});

test('image-invalid increments only the new content counter once with complete submitted/cleanup claims', () => {
  for (const result of ['SUCCESS', 'INVALID_IMAGE']) for (const submissionObservation of ['NOT_SUBMITTED_CLAIM', 'SUBMITTED_CLAIM'])
    for (const effectObservation of ['NO_EFFECT_CLAIM', 'CLEANUP_CLAIM']) for (const inputObservation of ['COMPLETE_CLAIM', 'INCOMPLETE', 'UNKNOWN']) {
      const event = outcome(1, {outcome: result, submissionObservation, effectObservation, inputObservation});
      const state = run([reserve(), submit(), event], start({legacy: legacy('PREPARED', 2)}));
      const complete = submissionObservation === 'SUBMITTED_CLAIM' && effectObservation === 'CLEANUP_CLAIM' && inputObservation === 'COMPLETE_CLAIM';
      assert.equal(state.accounting.contentRejections, complete && result === 'INVALID_IMAGE' ? 1 : 0);
      assert.equal(state.accounting.legacyAttempts, 2); assert.equal(state.accounting.operationalAttempts, 1);
      assert.equal(state.accounting.activeAttemptId, complete ? null : id(1));
      assert.deepEqual(proposal(state, event, 0).next, state);
      assert.throws(() => step(state, reserve(2)), {code: 'PROOF_VALIDATION_TRANSITION_DENIED'});
    }
  const missingIntent = run([reserve(), outcome(1, {outcome: 'INVALID_IMAGE'})]);
  assert.equal(missingIntent.accounting.contentRejections, 0); assert.equal(missingIntent.accounting.activeAttemptId, id(1));
});

test('source/admission/containment failures cannot become content failure or be cleared by a new lease', () => {
  for (const result of ['SOURCE_MISMATCH', 'ADMISSION_EXPIRED', 'ADMISSION_REVOKED', 'CONTAINMENT_FAILURE']) {
    const state = run([reserve(), submit(), outcome(1, {outcome: result})]);
    assert.equal(state.accounting.contentRejections, 0); assert.equal(state.accounting.holdReason, result);
    assert.equal(state.accounting.activeAttemptId, id(1));
    assert.throws(() => step(state, reserve(2)), {code: 'PROOF_VALIDATION_TRANSITION_DENIED'});
    assert.throws(() => step(state, {...common('CLEAR_HOLD', 1, 1003), kind: 'CLEAR_HOLD'}));
  }
});

test('legacy snapshots/counters/keys stay unchanged; exhausted, unresolved, validated and retained rows never auto-adopt', () => {
  for (const status of ['PREPARED', 'VALIDATING', 'VALIDATED', 'RETAINED', 'REJECTED']) for (const attempts of [0, 2, 3, Number.MAX_SAFE_INTEGER]) {
    const row = legacy(status, attempts), before = structuredClone(row), state = start({legacy: row});
    assert.deepEqual(state.requirement.legacy, before); assert.deepEqual(state.requirement.original, original());
    assert.equal(state.accounting.legacyAttempts, attempts); assert.equal(state.accounting.operationalAttempts, 0);
    if (status !== 'PREPARED' || attempts >= 3) assert.throws(() => step(state, reserve()), {code: 'PROOF_VALIDATION_TRANSITION_DENIED'});
    else assert.deepEqual(step(state, reserve()).requirement.legacy, before);
    assert.deepEqual(row, before);
  }
});

test('attempt, lease, request and original bindings refuse overlap, reuse and cross-attempt results', () => {
  const active = opened();
  assert.throws(() => step(active, reserve(2)), {code: 'PROOF_VALIDATION_TRANSITION_DENIED'});
  for (const change of [{attemptId: id(2)}, {leaseId: id(102)}, {requestId: id(202)}, {originalHash: 'e'.repeat(64)}]) assert.throws(() => step(active, {...outcome(), ...change}));
  assert.throws(() => step(start(), outcome()));
  const finished = step(active, outcome());
  for (const change of [{leaseId: reserve().leaseId}, {requestId: reserve().requestId}]) {
    assert.throws(() => step(finished, {...reserve(2), ...change}), {code: 'PROOF_VALIDATION_IDEMPOTENCY_CONFLICT'});
  }
  assert.throws(() => step(finished, {...reserve(2), at: 1001, leaseUntil: 1101}));
});

test('rehydration checks all derived fields against the bounded history and forbids reset-shaped edits', () => {
  const held = run([reserve(), submit(), outcome(1, {effectObservation: 'UNKNOWN'})]);
  for (const edit of [
    state => { state.accounting.activeAttemptId = null; },
    state => { state.accounting.operationalAttempts = 0; },
    state => { state.accounting.contentRejections = 1; },
    state => { state.accounting.legacyAttempts = 1; },
    state => { state.accounting.holdReason = null; },
    state => { state.attempts[0].phase = 'OUTCOME_RECORDED'; },
    state => { state.attempts[0].leaseUntil++; },
    state => { state.revision++; },
    state => { state.requirement.original.objectKey = 'e'.repeat(64); },
    state => { state.events.pop(); },
    state => { state.events.push(state.events.at(-1)); },
    state => { state.authority = 'QUALIFIED'; },
  ]) {
    const altered = structuredClone(held); edit(altered);
    assert.throws(() => proposal(altered, expire()));
  }
  assert.deepEqual(step(JSON.parse(JSON.stringify(held)), expire()).requirement, held.requirement);
});

test('closed bounded contracts reject arbitrary authority, callbacks, accessors and malformed action data', () => {
  let calls = 0;
  const accessor = {original: original(), operationalLimit: 3};
  Object.defineProperty(accessor, 'legacy', {enumerable: true, get() { calls++; return legacy(); }});
  assert.throws(() => create(accessor)); assert.equal(calls, 0);
  const coercion = {[Symbol.toPrimitive]() { calls++; return 'RESERVE'; }};
  assert.throws(() => step(start(), {...reserve(), kind: coercion})); assert.equal(calls, 0);
  for (const extra of [{qualified: true}, {authority: {current: true}}, {verify: () => true}, {original: {...original(), newKey: 'e'.repeat(64)}}]) assert.throws(() => start(extra));
  for (const change of [{kind: 'PUBLISH'}, {kind: 'CLEAR_HOLD'}, {kind: 'RESET'}, {qualified: true}, {leaseUntil: 121001},
    {leaseUntil: 1000}, {at: -1}, {actionId: 'not-a-uuid'}, {at: 1.5}]) assert.throws(() => step(start(), {...reserve(), ...change}));
  for (const change of [{effectObservation: 'REAPED'}, {effectObservation: 'NOT_STARTED'}, {submissionObservation: true},
    {outcome: 'UNKNOWN_ERROR'}, {inputObservation: () => true}]) assert.throws(() => step(opened(), outcome(1, change)));
  const oversized = structuredClone(start()); oversized.events = Array.from({length: 65}, () => reserve());
  assert.throws(() => proposal(oversized, reserve()));
});
