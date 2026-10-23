import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/contract.mjs';
import {assertProofImageValidator} from '../src/proof-image.mjs';
import {instantiateMarketplacePhysical} from '../src/physical-runtime.mjs';
import {PROOF_DECODER_REVIEW_OUTCOMES, modelProofDecoderAttemptAccounting as model,
  assessProofDecoderPublicationReview as publication} from '../src/proof-decoder-outcome-policy.mjs';

const id = n => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const original = () => ({uploadId: 'atlas_upload_fixture', objectKey: 'a'.repeat(64),
  plan: {byteCount: 11, sha256: 'b'.repeat(64), declaredType: 'image/png'}});
const legacy = (status = 'PREPARED', attempts = 0) => ({status, attempts,
  manifestHash: ['VALIDATED', 'RETAINED'].includes(status) ? 'c'.repeat(64) : null});
const begin = (n = 1) => ({kind: 'BEGIN', leaseId: id(n), requestId: id(n + 100), originalHash: hash(original())});
const outcome = (outcome = 'TIMEOUT', effectObservation = 'CLEANUP_CLAIM', inputObservation = 'COMPLETE_CLAIM', n = 1) =>
  ({...begin(n), kind: 'OUTCOME', outcome, effectObservation, inputObservation});
const run = (transcript = [], extra = {}) => model({original: original(), legacy: legacy(), maxOperationalAttempts: 3, transcript, ...extra});
const pub = (extra = {}) => publication({original: original(), legacy: legacy('VALIDATED'), operation: 'UPLOAD',
  objectObservation: 'ABSENT_CLAIM', admissionObservation: 'MISSING', ...extra});
const inert = value => {
  assert.equal(value.classification, 'UNQUALIFIED'); assert.equal(value.executionAllowed, false);
  assert.equal(value.authority, 'NOT_IMPLEMENTED'); assert.equal(Object.isFrozen(value), true);
  assert.throws(() => assertProofImageValidator(value), {code: 'PROOF_DECODER_UNAVAILABLE'});
  assert.throws(() => instantiateMarketplacePhysical(value, {}), {code: 'PHYSICAL_FACTORY_UNQUALIFIED'});
};

test('the pure model cannot supply a validator, factory or admission, even when serialized or decorated', () => {
  for (const value of [run(), pub(), run([begin(), outcome('SUCCESS')])]) {
    inert(value); inert(Object.freeze({...JSON.parse(JSON.stringify(value))}));
    assert.throws(() => assertProofImageValidator({...value, qualified: true, assertReady: () => true}), {code: 'PROOF_DECODER_UNAVAILABLE'});
  }
});

test('unknown effect or cleanup dominates every worker outcome and preserves an absorbing hold', () => {
  for (const result of PROOF_DECODER_REVIEW_OUTCOMES) {
    const transcript = [begin(), outcome(result, 'UNKNOWN')];
    const value = run(transcript);
    assert.equal(value.simulated.state, 'UNRESOLVED_EFFECT_HOLD');
    assert.equal(value.simulated.contentRejections, 0); assert.equal(value.simulated.startedOperations, 1);
    assert.throws(() => run([...transcript, begin(2)]));
    assert.deepEqual(run([...transcript, ...transcript]), value);
  }
});

test('reported image verdict needs complete original and independent cleanup evidence before a content decision', () => {
  for (const result of ['SUCCESS', 'INVALID_IMAGE']) {
    for (const effect of ['NO_EFFECT_CLAIM', 'CLEANUP_CLAIM']) for (const input of ['COMPLETE_CLAIM', 'INCOMPLETE', 'UNKNOWN']) {
      const value = run([begin(), outcome(result, effect, input)]);
      const completeScenario = effect === 'CLEANUP_CLAIM' && input === 'COMPLETE_CLAIM';
      assert.equal(value.simulated.contentRejections, completeScenario && result === 'INVALID_IMAGE' ? 1 : 0);
      assert.ok(value.unmetRequirements.includes('INDEPENDENT_NO_EFFECT_OR_WHOLE_JOB_CLEANUP_EVIDENCE'));
      assert.equal(value.reviews[0].unmetRequirements.includes('EXACT_COMPLETE_ORIGINAL_AND_AUTHENTICATED_WORKER_RESULT'), true);
      if (!completeScenario) assert.equal(value.simulated.state, 'CONTRADICTORY_RESULT_HOLD');
      assert.throws(() => run([begin(), outcome(result, effect, input), begin(2)]));
    }
  }
});

test('infrastructure outcomes use a separate bounded hypothetical operational counter', () => {
  for (const result of ['BUSY', 'CANCELLED', 'TIMEOUT', 'SETUP_FAILURE', 'RESOURCE_FAILURE', 'TRANSPORT_FAILURE', 'PROTOCOL_FAILURE']) {
    for (const effect of ['NO_EFFECT_CLAIM', 'CLEANUP_CLAIM']) {
      const transcript = [1, 2, 3].flatMap(n => [begin(n), outcome(result, effect, 'UNKNOWN', n)]);
      const value = run(transcript, {legacy: legacy('PREPARED', 2)});
      assert.equal(value.simulated.startedOperations, 3); assert.equal(value.simulated.contentRejections, 0);
      assert.equal(value.legacy.attempts, 2); assert.equal(value.simulated.remainingConservativeContentBudget, 1);
      assert.equal(value.simulated.state, 'OPERATIONAL_BUDGET_REVIEW_REQUIRED');
      assert.throws(() => run([...transcript, begin(4)], {legacy: legacy('PREPARED', 2)}));
    }
  }
  assert.throws(() => run([], {maxOperationalAttempts: 0}));
  assert.throws(() => run([], {maxOperationalAttempts: 17}));
});

test('exact lease/request replay is idempotent; changed results and reused identity refuse', () => {
  const first = [begin(), outcome()];
  assert.deepEqual(run([...first, ...first]), run(first));
  assert.throws(() => run([...first, {...begin(2), requestId: begin().requestId}]), {code: 'DECODER_OUTCOME_IDEMPOTENCY_CONFLICT'});
  assert.throws(() => run([...first, {...begin(), requestId: id(999)}]), {code: 'DECODER_OUTCOME_IDEMPOTENCY_CONFLICT'});
  assert.throws(() => run([...first, outcome('SUCCESS')]), {code: 'DECODER_OUTCOME_IDEMPOTENCY_CONFLICT'});
  assert.throws(() => run([{...begin(), originalHash: 'd'.repeat(64)}]));
  assert.throws(() => run([begin(), {...outcome(), originalHash: 'd'.repeat(64)}]));
  assert.throws(() => run([outcome()]));
  const open = run([begin()]);
  assert.equal(open.simulated.activeLease, begin().leaseId);
  assert.equal(open.simulated.state, 'HYPOTHETICAL_ATTEMPT_OPEN');
  assert.throws(() => run([begin(), begin(2)]));
});

test('legacy attempts and statuses never reset, infer causes, reopen rejection or discard unresolved leases', () => {
  for (const attempts of [3, 4, Number.MAX_SAFE_INTEGER]) {
    const row = legacy('PREPARED', attempts), before = structuredClone(row), value = run([], {legacy: row});
    assert.equal(value.simulated.state, 'LEGACY_REVIEW_REQUIRED'); assert.deepEqual(row, before);
    assert.deepEqual(value.legacy, before); assert.equal(value.simulated.remainingConservativeContentBudget, 0);
    assert.throws(() => run([begin()], {legacy: row}));
  }
  for (const status of ['VALIDATING', 'VALIDATED', 'RETAINED', 'REJECTED']) {
    const row = legacy(status, 1); assert.deepEqual(run([], {legacy: row}).legacy, row);
    assert.throws(() => run([begin()], {legacy: row}));
  }
  assert.equal(run([begin(), outcome('INVALID_IMAGE')], {legacy: legacy('PREPARED', 2)}).simulated.remainingConservativeContentBudget, 0);
});

test('admission loss, source mismatch and containment failure never become image rejection or automatic retry', () => {
  for (const result of ['ADMISSION_EXPIRED', 'ADMISSION_REVOKED', 'SOURCE_MISMATCH', 'CONTAINMENT_FAILURE']) {
    const transcript = [begin(), outcome(result)];
    assert.equal(run(transcript).simulated.contentRejections, 0);
    assert.throws(() => run([...transcript, begin(2)]));
  }
  assert.throws(() => run([begin(), {...outcome(), outcome: 'UNRECOGNIZED_ERROR'}]));
  assert.throws(() => run([begin(), {...outcome(), effectObservation: 'REAPED'}]));
  assert.throws(() => run([begin(), {...outcome(), effectObservation: 'NOT_STARTED'}]));
});

test('retained historical reads preserve original bindings and never require decoder liveness', () => {
  for (const admissionObservation of ['MISSING', 'CACHED_UNEXPIRED', 'FENCE_SHAPED_CLAIM', 'REVOKED', 'EXPIRED', 'UNAVAILABLE']) {
    const value = pub({legacy: legacy('RETAINED', 3), operation: 'HISTORICAL_READ',
      objectObservation: 'MATCHING_ORIGINAL_CLAIM', admissionObservation});
    assert.equal(value.decision, 'EXISTING_AUTHORIZED_ORIGINAL_READ_PATH');
    assert.equal(value.decoderNeeded, false); assert.deepEqual(value.original, original());
    assert.deepEqual(value.legacy, legacy('RETAINED', 3));
    assert.deepEqual(value.unmetRequirements, ['EXISTING_CURRENT_ACTOR_POLICY_STORAGE_AND_MANIFEST_CHECKS']);
    assert.equal(value.publicationAllowed, false); assert.equal(value.historyMutationAllowed, false);
  }
});

test('legacy VALIDATED upload and recovery cannot bypass fresh validation for an absent original', () => {
  for (const operation of ['UPLOAD', 'RECOVER', 'BEFORE_RETAIN']) {
    const value = pub({operation});
    assert.equal(value.decision, 'FRESH_ISOLATED_VALIDATION_REQUIRED'); assert.equal(value.decoderNeeded, true);
    assert.ok(value.unmetRequirements.includes('FRESH_ORIGINAL_VALIDATION_EVEN_FOR_LEGACY_VALIDATED'));
    assert.equal(pub({operation, legacy: legacy('VALIDATED', 3)}).decision, 'LEGACY_REVIEW_REQUIRED');
  }
  assert.equal(pub({operation: 'HISTORICAL_READ'}).decision, 'RETAINED_ORIGINAL_REQUIRED');
});

test('published or uncertain originals reconcile their same key without delete, overwrite or replacement', () => {
  for (const operation of ['UPLOAD', 'RECOVER', 'BEFORE_RETAIN']) {
    for (const admissionObservation of ['REVOKED', 'EXPIRED', 'UNAVAILABLE', 'CACHED_UNEXPIRED', 'FENCE_SHAPED_CLAIM']) {
      const value = pub({operation, admissionObservation, objectObservation: 'MATCHING_ORIGINAL_CLAIM'});
      assert.equal(value.decision, 'RECONCILE_EXISTING_ORIGINAL_ONLY'); assert.equal(value.decoderNeeded, false);
      assert.equal(value.original.objectKey, original().objectKey); assert.equal(value.legacy.manifestHash, legacy('VALIDATED').manifestHash);
      assert.ok(value.unmetRequirements.includes('NO_OVERWRITE_DELETE_OR_NEW_KEY'));
      assert.equal(value.publicationAllowed, false);
    }
    assert.equal(pub({operation, objectObservation: 'UNKNOWN'}).decision, 'RECONCILE_ORIGINAL_WITHOUT_NEW_PUBLICATION');
    assert.equal(pub({operation, objectObservation: 'MISMATCH_CLAIM'}).decision, 'ORIGINAL_CONFLICT_HOLD');
  }
});

test('cached snapshots and fence-shaped claims cannot confer publication or retention authority', () => {
  for (const admissionObservation of ['MISSING', 'CACHED_UNEXPIRED', 'FENCE_SHAPED_CLAIM', 'REVOKED', 'EXPIRED', 'UNAVAILABLE']) {
    const value = pub({admissionObservation}); inert(value);
    assert.equal(value.publicationAllowed, false);
    assert.equal(value.admissionVerification, 'NOT_IMPLEMENTED_NO_SNAPSHOT_OR_FENCE_SHAPED_CLAIM_IS_AUTHORITY');
  }
  assert.throws(() => pub({admissionObservation: true}));
  assert.throws(() => pub({admissionObservation: {revision: 7, current: true}}));
  assert.throws(() => pub({admissionObservation: () => true}));
});

test('closed bounded data contracts snapshot inputs, reject accessors and preserve frozen originals', () => {
  const input = {original: original(), legacy: legacy(), maxOperationalAttempts: 3, transcript: []};
  const value = model(input); input.original.plan.sha256 = 'd'.repeat(64); input.legacy.attempts = 3;
  assert.deepEqual(value.original, original()); assert.equal(value.legacy.attempts, 0);
  assert.throws(() => { value.original.plan.sha256 = 'e'.repeat(64); });
  let called = 0;
  const unsafe = {...input, get authorize() { called++; return true; }};
  assert.throws(() => model(unsafe)); assert.equal(called, 0);
  assert.throws(() => run([], {qualified: true}));
  assert.throws(() => run(Array.from({length: 65}, () => begin())));
  assert.throws(() => pub({legacy: {...legacy('VALIDATED'), manifestHash: null}}));
  assert.throws(() => pub({original: {...original(), decoderEpoch: 'new-epoch'}}));
});
