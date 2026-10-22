import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaimSubmissionClient } from '../lib/ownership-claim-submission-client.mjs';
import { createClaimSubmissionState } from '../lib/ownership-claim-submission-state.mjs';
import { createClaimSubmissionFixture, CLAIM_SUBMISSION_CARD, CLAIM_SUBMISSION_OTHER_ACCOUNT, claimOriginal, claimResponse, pendingClaim } from './ownership-claim-submission-fixture.mjs';
const setup = options => { const f = createClaimSubmissionFixture(options), lost = [];
  const client = createClaimSubmissionClient({ accountId: f.accountId, configuration: f.config, transport: f.transport });
  return { f, lost, state: createClaimSubmissionState({ client, accountId: f.accountId, onAccessLost: () => lost.push(true), now: () => f.now(), uuid: f.uuid }) }; };
async function prepared({ f, state }) { await state.lookup(CLAIM_SUBMISSION_CARD.certificateNumber); await state.selectFiles([claimOriginal()]); await state.reserve(f.config.proofKinds[0].code); }
const writes = f => f.calls.filter(call => ['reserve_bundle', 'submit_claim', 'withdraw_claim', 'replace_evidence', 'put'].includes(call.action));

test('lookup, original checking, reservation, retention and submission are separate explicit steps', async () => {
  const h = setup(), { f, state } = h; assert.equal(f.calls.length, 0);
  await state.lookup(CLAIM_SUBMISSION_CARD.certificateNumber); await state.selectFiles([claimOriginal()]); assert.equal(writes(f).length, 0);
  assert.equal(state.snapshot().files.length, 1); assert.equal(Object.hasOwn(state.snapshot().files[0], 'file'), false);
  await state.reserve(f.config.proofKinds[0].code); assert.equal(state.snapshot().bundle.allRetained, false); assert.equal(state.snapshot().claim, null);
  await state.submit(); assert.equal(f.calls.some(call => call.action === 'submit_claim'), false);
  await state.upload(); assert.equal(state.snapshot().bundle.allRetained, true); assert.equal(state.snapshot().claim, null);
  await state.submit(); const snap = state.snapshot(); assert.equal(snap.receipt.action, 'submit_claim'); assert.equal(snap.claim.state, 'PENDING'); assert.equal(snap.claim.currentlyOwnedByYou, false);
  assert.equal(snap.files.length, 0); assert.equal(snap.bundle, null); assert.equal(writes(f).length, 3);
});

test('finished upload and verification failures clear transient progress; retention recovery sends no further PUT', async () => {
  for (const failureAt of ['complete', 'read_bundle']) {
    const h = setup(), { f, state } = h, observed = []; await prepared(h);
    state.subscribe(value => observed.push(value));
    f.faults.set(failureAt, async ({ next }) => { await next(); throw Error('response lost'); });
    await state.upload(); const failed = state.snapshot();
    assert.equal(failed.status, 'READY'); assert.equal(failed.operation, null); assert.equal(failed.fileProgress, null);
    assert.equal(failed.bundle.allRetained, false); assert(failed.error);
    assert(observed.some(value => value.fileProgress?.stage === 'UPLOADING'));
    assert.equal(f.calls.filter(call => call.action === 'put').length, 1);
    f.faults.delete(failureAt); f.faults.set('complete', () => { throw Error('verification unavailable'); });
    await state.verifyUploads();
    assert(observed.some(value => value.fileProgress?.stage === 'VERIFYING'));
    assert.equal(state.snapshot().fileProgress, null); assert.equal(state.snapshot().status, 'READY');
    assert.equal(state.snapshot().bundle.allRetained, false);
    f.faults.delete('complete'); await state.verifyUploads();
    assert.equal(state.snapshot().bundle.allRetained, true); assert.equal(state.snapshot().fileProgress, null);
    assert.equal(state.snapshot().error, null); assert.equal(f.calls.filter(call => call.action === 'put').length, 1);
    assert.equal(f.calls.some(call => call.action === 'submit_claim'), false);
  }
});

test('uncertain reservation is recovered without another mutation; no edits or writes while its outcome is unknown', async () => {
  const h = setup(), { f, state } = h;
  f.faults.set('reserve_bundle', async ({ next }) => { await next(); throw Error('response lost'); }); await prepared(h);
  const requestId = state.snapshot().pendingRequestId; assert.equal(state.snapshot().status, 'UNKNOWN'); assert(requestId);
  await state.lookup(CLAIM_SUBMISSION_CARD.certificateNumber); await state.selectFiles([claimOriginal('other.png', 2)]); await state.reserve(f.config.proofKinds[0].code); await state.submit(); state.startNew();
  assert.equal(writes(f).length, 1); assert.equal(state.snapshot().pendingRequestId, requestId);
  await state.recover(); assert.equal(state.snapshot().status, 'READY'); assert.equal(state.snapshot().bundle.requestId, requestId); assert.equal(writes(f).length, 1);
});

test('explicit retry is offered only after recovery finds no receipt and reuses byte-equivalent request', async () => {
  const h = setup(), { f, state } = h; f.faults.set('reserve_bundle', () => { throw Error('not dispatched'); }); await prepared(h);
  const original = structuredClone(writes(f)[0].input); await state.retrySameRequest(); assert.equal(writes(f).length, 1);
  await state.recover(); assert.equal(state.snapshot().recoveryMissing, true); assert.equal(writes(f).length, 1);
  f.faults.delete('reserve_bundle'); await state.retrySameRequest(); assert.deepEqual(writes(f)[1].input, original); assert.equal(state.snapshot().status, 'READY');
});

test('uncertain submitted outcome recovers original receipt, then separately reads current state without inferring title', async () => {
  const h = setup(), { f, state } = h; await prepared(h); await state.upload();
  f.faults.set('submit_claim', async ({ next }) => { await next(); throw Error('response lost'); }); await state.submit();
  assert.equal(state.snapshot().status, 'UNKNOWN'); f.claim = { ...f.claim, state: 'VERIFIED', claimRevision: 2, currentlyOwnedByYou: false };
  await state.recover(); assert.equal(state.snapshot().receipt.state, 'PENDING'); assert.equal(state.snapshot().claim.state, 'VERIFIED'); assert.equal(state.snapshot().claim.currentlyOwnedByYou, false);
  assert.equal(f.calls.filter(c => c.action === 'submit_claim').length, 1);
});

test('withdraw works on blocked pending history; replacement uses fresh retained bundle and exact claim revision', async () => {
  const h = setup({ claim: pendingClaim() }), { f, state } = h; await state.loadClaim(f.claim.claimId);
  assert.equal(state.snapshot().claim.blockedReasons.includes('EVIDENCE_EXPIRED'), true); await state.withdraw();
  assert.equal(state.snapshot().claim.state, 'WITHDRAWN'); assert.equal(state.snapshot().claim.claimRevision, 2);
  state.beginReplacement(); assert.equal(state.snapshot().error, 'CLAIM_REPLACEMENT_UNAVAILABLE');
  f.claim = pendingClaim(); await state.loadClaim(f.claim.claimId); state.beginReplacement(); await state.selectFiles([claimOriginal()]);
  await state.reserve(f.config.proofKinds[0].code); await state.upload(); await state.submit();
  assert.equal(state.snapshot().receipt.action, 'replace_evidence'); assert.equal(state.snapshot().claim.claimRevision, 2); assert.equal(state.snapshot().claim.currentlyOwnedByYou, false);
  assert.equal(f.calls.find(c => c.action === 'replace_evidence').input.expectedClaimRevision, 1);
});

test('receipt success with unavailable fresh claim never retains old claim/title; conflicting replacement stays recoverable', async () => {
  const { f, state } = setup({ claim: { ...pendingClaim(), currentlyOwnedByYou: true } }); await state.loadClaim(f.claim.claimId);
  f.faults.set('read_claim', () => claimResponse({}, 503)); await state.withdraw();
  assert.equal(state.snapshot().receipt.state, 'WITHDRAWN'); assert.equal(state.snapshot().claim, null); assert.equal(state.snapshot().pendingRequestId, null);
});

test('recovered reservation requires exact current card and same original bytes; no lookup/policy inference from bundle', async () => {
  const first = setup(); await prepared(first); const requestId = first.state.snapshot().bundle.requestId; first.state.dispose();
  const { f } = first, client = createClaimSubmissionClient({ accountId: f.accountId, configuration: f.config, transport: f.transport });
  const state = createClaimSubmissionState({ client, accountId: f.accountId, now: f.now, uuid: f.uuid });
  await state.recover(requestId); assert.equal(state.snapshot().target, null); await state.upload(); assert.equal(f.calls.some(c => c.action === 'put'), false);
  await state.lookup(CLAIM_SUBMISSION_CARD.certificateNumber); await state.selectFiles([claimOriginal('changed.png', 2)]); assert.equal(state.snapshot().error, 'CLAIM_FILE_CHANGED');
  await state.selectFiles([claimOriginal()]); await state.upload(); assert.equal(state.snapshot().bundle.allRetained, true);
});

test('source change/expiry refuses before upload or claim mutation; all-retained is refreshed before submission', async () => {
  const h = setup(), { f, state } = h; await prepared(h); await state.upload();
  f.bundles.get(state.snapshot().bundle.bundleId).card.report.publicHash = 'e'.repeat(64); await state.submit();
  assert.equal(state.snapshot().error, 'CLAIM_SOURCE_CHANGED'); assert.equal(f.calls.some(c => c.action === 'submit_claim'), false);
  const h2 = setup(); await prepared(h2); h2.f.now = () => Date.parse('2031-01-01T00:00:00Z'); await h2.state.upload();
  assert.equal(h2.state.snapshot().error, 'CLAIM_BUNDLE_EXPIRED'); assert.equal(h2.f.calls.some(c => c.action === 'put'), false);
});

test('denied/foreign responses and explicit disposal clear private files, capabilities and requests; stale async cannot resurrect', async () => {
  for (const mode of [401, 403, 'foreign', 'dispose']) {
    const h = setup(), { f, state } = h; await prepared(h);
    let release; f.faults.set('read_bundle', ({ signal }) => { f.signal = signal; return new Promise(resolve => { release = resolve; }); });
    const pending = state.checkBundle(); await new Promise(resolve => setImmediate(resolve));
    if (mode === 'dispose') { state.dispose(); await pending; assert.equal(f.signal.aborted, true); release(claimResponse({})); }
    else if (mode === 'foreign') release(claimResponse({ accountId: CLAIM_SUBMISSION_OTHER_ACCOUNT })); else release(claimResponse({}, mode));
    await pending; assert.equal(state.snapshot().status, 'ENDED'); assert.equal(state.snapshot().bundle, null); assert.equal(state.snapshot().files.length, 0);
    assert.equal(state.snapshot().pendingRequestId, null); assert.equal(h.lost.length, mode === 'dispose' ? 0 : 1);
    const count = f.calls.length; await state.lookup(CLAIM_SUBMISSION_CARD.certificateNumber); assert.equal(f.calls.length, count);
  }
});

test('typed confirmed rollback permits fresh correction, but HTTP status and refusal after an uncertain attempt cannot erase uncertainty', async () => {
  const refusal = (f, input) => ({ schema: 'atlas-ownership-claim-refusal-v2', accountId: f.accountId, action: 'reserve_bundle', requestId: input.requestId, outcome: 'CONFIRMED_REFUSAL' });
  const h = setup(); h.f.faults.set('reserve_bundle', ({ input }) => refusal(h.f, input)); await prepared(h);
  assert.equal(h.state.snapshot().status, 'READY'); assert.equal(h.state.snapshot().pendingRequestId, null); assert.equal(h.state.snapshot().target, null);
  assert.equal(h.state.snapshot().error, 'CLAIM_CONFIRMED_REFUSAL');
  const uncertain = setup(); uncertain.f.faults.set('reserve_bundle', () => claimResponse({}, 409)); await prepared(uncertain);
  assert.equal(uncertain.state.snapshot().status, 'UNKNOWN'); const requestId = uncertain.state.snapshot().pendingRequestId;
  await uncertain.state.recover(); uncertain.f.faults.set('reserve_bundle', ({ input }) => refusal(uncertain.f, input)); await uncertain.state.retrySameRequest();
  assert.equal(uncertain.state.snapshot().status, 'UNKNOWN'); assert.equal(uncertain.state.snapshot().pendingRequestId, requestId);
});

test('every bundle refresh preserves exact immutable source/policy/deadline/file binding and cannot reverse retention', async () => {
  const mutations = [b => b.requestId = '00000000-0000-4000-8000-000000000999', b => b.policyRevision++, b => b.uploadPolicyRevision++,
    b => b.proofKind = 'OTHER', b => b.card.report.publicHash = 'e'.repeat(64), b => b.expiresAt = '2029-01-01T00:00:00Z',
    b => b.usableUntil = '2030-01-02T01:00:00Z', b => b.deleteAfter = '2030-01-04T00:00:00Z', b => b.files[0].objectId = '00000000-0000-4000-8000-000000000999',
    b => b.files[0].clientFileId = '00000000-0000-4000-8000-000000000999', b => b.files[0].sha256 = 'd'.repeat(64), b => b.files[0].byteCount++, b => b.files[0].declaredType = 'image/jpeg'];
  for (const mutation of mutations) {
    const h = setup(); await prepared(h); const before = h.state.snapshot().bundle;
    h.f.faults.set('read_bundle', async ({ next }) => { const response = await next(), value = await response.json(); mutation(value.bundle); return claimResponse(value); });
    await h.state.checkBundle(); assert.equal(h.state.snapshot().error, 'CLAIM_SOURCE_CHANGED'); assert.deepEqual(h.state.snapshot().bundle, before);
  }
  const h = setup(); await prepared(h); await h.state.upload();
  h.f.bundles.get(h.state.snapshot().bundle.bundleId).files[0].state = 'RESERVED'; await h.state.checkBundle();
  assert.equal(h.state.snapshot().error, 'CLAIM_SOURCE_CHANGED'); assert.equal(h.state.snapshot().bundle.allRetained, true);
});

test('unknown withdraw/replace recovery must match the exact next claim revision', async () => {
  for (const action of ['withdraw_claim', 'replace_evidence']) {
    const h = setup({ claim: pendingClaim() }), { f, state } = h; await state.loadClaim(f.claim.claimId);
    if (action === 'replace_evidence') { state.beginReplacement(); await state.selectFiles([claimOriginal()]); await state.reserve(f.config.proofKinds[0].code); await state.upload(); }
    f.faults.set(action, async ({ next }) => { await next(); throw Error('lost response'); });
    if (action === 'withdraw_claim') await state.withdraw(); else await state.submit();
    const requestId = state.snapshot().pendingRequestId; f.receipts.get(requestId).claimRevision++;
    await state.recover(); assert.equal(state.snapshot().status, 'UNKNOWN'); assert.equal(state.snapshot().error, 'CLAIM_RECOVERY_MISMATCH');
    assert.equal(state.snapshot().pendingRequestId, requestId); assert.equal(state.snapshot().receipt, null);
  }
});
