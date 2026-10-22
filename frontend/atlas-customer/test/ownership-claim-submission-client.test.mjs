import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ownershipLifecycleInput } from '../../../packages/atlas-connected-manual/src/card-ownership-proof-contract.mjs';
import { CLAIM_FILE_LIMITS, claimLifecycleInput, createClaimSubmissionClient, parseClaimConfiguration, parseClaimLifecycle, parseClaimUpload, prepareClaimOriginals } from '../lib/ownership-claim-submission-client.mjs';
import { createClaimSubmissionFixture, CLAIM_SUBMISSION_CARD, CLAIM_SUBMISSION_OTHER_ACCOUNT, claimFixtureId, claimOriginal, claimResponse, pendingClaim } from './ownership-claim-submission-fixture.mjs';
const setup = () => { const f = createClaimSubmissionFixture(); return { f, client: createClaimSubmissionClient({ accountId: f.accountId, configuration: f.config, transport: f.transport }) }; };
const reserve = async (f, client) => { const originals = await prepareClaimOriginals([claimOriginal()], f.config); const input = { requestId: f.uuid(), certificateNumber: CLAIM_SUBMISSION_CARD.certificateNumber,
  expectedPublishedBinding: CLAIM_SUBMISSION_CARD, proofKind: 'SYNTHETIC_ORIGINALS', files: originals.map(({ clientFileId, sha256, byteCount, declaredType }) => ({ clientFileId, sha256, byteCount, declaredType })) };
  return { input, originals, bundle: (await client.call('reserve_bundle', input)).bundle }; };
const code = expected => error => error.code === expected;

test('explicit account-bound policy and complete transport required; no invented endpoint or permissive defaults', () => {
  const { f } = setup(); assert.deepEqual(parseClaimConfiguration(f.config, f.accountId), f.config);
  for (const changed of [{ ...f.config, enabled: false }, { ...f.config, limits: { ...CLAIM_FILE_LIMITS, maxObjectBytes: 20971521 } },
    { ...f.config, formats: ['application/pdf'] }, { ...f.config, storageOrigin: 'http://proof.example.invalid' }, { ...f.config, storagePathPrefix: '/../' }, { ...f.config, extra: true }]) {
    assert.throws(() => parseClaimConfiguration(changed, f.accountId));
  }
  assert.throws(() => parseClaimConfiguration({ ...f.config, accountId: CLAIM_SUBMISSION_OTHER_ACCOUNT }, f.accountId), code('CLAIM_ACCESS_ENDED'));
  assert.throws(() => createClaimSubmissionClient({ accountId: f.accountId, configuration: f.config, transport: {} }), code('CLAIM_TRANSPORT_UNAVAILABLE'));
  assert.equal(f.calls.length, 0);
});

test('browser action inputs agree with the actual closed customer contract and reject injected authority or reviewer actions', () => {
  const inputs = { reserve_bundle: { requestId: claimFixtureId(5), certificateNumber: CLAIM_SUBMISSION_CARD.certificateNumber, expectedPublishedBinding: CLAIM_SUBMISSION_CARD,
    proofKind: 'ORIGINAL', files: [{ clientFileId: claimFixtureId(6), sha256: 'a'.repeat(64), byteCount: 5, declaredType: 'image/heic' }] },
    read_bundle: { bundleId: claimFixtureId(7) }, read_claim: { claimId: claimFixtureId(8) }, submit_claim: { requestId: claimFixtureId(9), bundleId: claimFixtureId(7), expectedOwnershipRevision: 0 },
    withdraw_claim: { requestId: claimFixtureId(10), claimId: claimFixtureId(8), expectedClaimRevision: 1 },
    replace_evidence: { requestId: claimFixtureId(11), claimId: claimFixtureId(8), expectedClaimRevision: 1, bundleId: claimFixtureId(7) }, recover_request: { requestId: claimFixtureId(9) } };
  for (const [action, input] of Object.entries(inputs)) {
    assert.deepEqual(claimLifecycleInput(action, input), ownershipLifecycleInput('CUSTOMER', action, input));
    for (const key of ['accountId', 'ownerAccountId', 'key', 'url', 'observation', 'policyRevision']) assert.throws(() => claimLifecycleInput(action, { ...input, [key]: claimFixtureId(1) }));
  }
  assert.throws(() => claimLifecycleInput('review_claim', {}));
  assert.throws(() => claimLifecycleInput('reserve_bundle', { ...inputs.reserve_bundle, files: [...inputs.reserve_bundle.files, ...inputs.reserve_bundle.files] }));
  assert.throws(() => claimLifecycleInput('withdraw_claim', { ...inputs.withdraw_claim, expectedClaimRevision: 0 }));
});

test('original bytes remain unchanged, SHA matches source, and unsupported/duplicate/oversized files refuse before reservation', async () => {
  const { f } = setup(), file = claimOriginal(), before = Buffer.from(await file.arrayBuffer());
  const result = await prepareClaimOriginals([file], f.config); assert.equal(result[0].file, file);
  assert.equal(result[0].sha256, createHash('sha256').update(before).digest('hex')); assert.deepEqual(Buffer.from(await file.arrayBuffer()), before);
  await assert.rejects(prepareClaimOriginals([file, file], f.config), code('CLAIM_DUPLICATE_FILE'));
  await assert.rejects(prepareClaimOriginals([new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' })], f.config), code('CLAIM_FILE_TYPE'));
  await assert.rejects(prepareClaimOriginals([new File([new Uint8Array(20971521)], 'large.png', { type: 'image/png' })], f.config), code('CLAIM_FILE_LIMIT'));
  await assert.rejects(prepareClaimOriginals(Array.from({ length: 7 }, (_, i) => claimOriginal(`photo${i}.png`, i)), f.config), code('CLAIM_FILE_LIMIT'));
  const c = new AbortController(); c.abort(); await assert.rejects(prepareClaimOriginals([file], f.config, { signal: c.signal }), code('CLAIM_CANCELLED'));
  assert.equal(f.calls.length, 0);
});

test('actual projected bundles, claim state and immutable lifecycle receipts pass; account/action/binding/revision drift refuses', async () => {
  const { f, client } = setup(), { input, originals, bundle } = await reserve(f, client);
  const projected = f.project('reserve_bundle', input, { bundle: f.bundles.get(bundle.bundleId) });
  assert.deepEqual(parseClaimLifecycle(projected, f.accountId, 'reserve_bundle', input), projected);
  for (const mutation of [v => { v.accountId = CLAIM_SUBMISSION_OTHER_ACCOUNT; }, v => { v.bundle.card.report.publicHash = 'f'.repeat(64); },
    v => { v.bundle.requestId = f.uuid(); }, v => { v.bundle.allRetained = true; }, v => { v.bundle.files[0].byteCount++; }, v => { v.bundle.privateKey = 'never expose'; }]) {
    const v = structuredClone(projected); mutation(v); assert.throws(() => parseClaimLifecycle(v, f.accountId, 'reserve_bundle', input));
  }
  await client.upload(bundle, bundle.files[0], originals[0]);
  const submit = { requestId: f.uuid(), bundleId: bundle.bundleId, expectedOwnershipRevision: 0 }, receipt = await client.call('submit_claim', submit);
  assert.equal(receipt.receipt.state, 'PENDING'); assert.equal(receipt.receipt.ownershipEventId, receipt.receipt.claimId);
  assert.equal((await client.call('read_claim', { claimId: receipt.receipt.claimId })).claim.currentlyOwnedByYou, false);
  f.claim = { ...f.claim, state: 'VERIFIED', claimRevision: 2, currentlyOwnedByYou: false };
  assert.deepEqual((await client.call('recover_request', { requestId: submit.requestId })).receipt, receipt.receipt);
  const malformed = structuredClone(receipt); malformed.receipt.claimRevision = 2; assert.throws(() => parseClaimLifecycle(malformed, f.accountId, 'submit_claim', submit));
  for (const action of ['submit_claim', 'replace_evidence']) {
    const missingBundle = structuredClone(receipt); missingBundle.receipt.action = action; missingBundle.receipt.bundleId = null;
    if (action === 'replace_evidence') { missingBundle.receipt.claimRevision = 2; missingBundle.receipt.ownershipEventId = null; }
    assert.throws(() => parseClaimLifecycle(missingBundle, f.accountId, 'recover_request', { requestId: submit.requestId }));
  }
  const saved = pendingClaim(); f.claim = saved;
  const withdraw = { requestId: f.uuid(), claimId: saved.claimId, expectedClaimRevision: 1 };
  const withdrawal = await client.call('withdraw_claim', withdraw); assert.equal(withdrawal.receipt.claimRevision, 2);
  assert.throws(() => parseClaimLifecycle(withdrawal, f.accountId, 'withdraw_claim', { ...withdraw, expectedClaimRevision: 2 }));
});

test('signed upload is fixed to the configured private origin/object and unchanged Blob; PUT alone is not retained success', async () => {
  const { f, client } = setup(), { originals, bundle } = await reserve(f, client), file = bundle.files[0];
  const signed = await (await f.transport.sign({ bundleId: bundle.bundleId, objectId: file.objectId }, {})).json();
  assert.equal(parseClaimUpload(signed, f.accountId, bundle, file, f.config).method, 'PUT');
  for (const mutation of [v => { v.accountId = CLAIM_SUBMISSION_OTHER_ACCOUNT; }, v => { v.url = v.url.replace('proof.example.invalid', 'foreign.example.invalid'); },
    v => { v.url = v.url.replace(file.objectId, f.uuid()); }, v => { v.headers['content-length'] = String(file.byteCount); }, v => { v.byteCount++; },
    v => { v.url = v.url.replace('300', '301'); }, v => { v.url += '&X-Amz-Expires=300'; }]) {
    const v = structuredClone(signed); mutation(v); assert.throws(() => parseClaimUpload(v, f.accountId, bundle, file, f.config));
  }
  f.faults.set('complete', () => claimResponse({}, 503)); await assert.rejects(client.upload(bundle, file, originals[0]));
  assert.equal(f.bundles.get(bundle.bundleId).files[0].state, 'RESERVED');
  const put = f.calls.find(call => call.action === 'put').input; assert.equal(put.body, originals[0].file); assert.equal(put.credentials, 'omit'); assert.equal(put.redirect, 'error');
  assert.equal(Object.hasOwn(put.headers, 'content-length'), false); assert.equal(put.headers['if-none-match'], '*');
  f.faults.delete('complete'); assert.equal((await client.retain(bundle, file)).state, 'RETAINED'); assert.equal(f.calls.filter(call => call.action === 'put').length, 1);
});

test('foreign identity from metadata/sign/retained replies ends access; storage signature refusal is not a session assertion', async () => {
  const { f, client } = setup(), { originals, bundle } = await reserve(f, client), file = bundle.files[0];
  for (const action of ['resolve', 'sign', 'complete']) {
    f.faults.set(action, async ({ next }) => { const response = await next(), value = await response.json(); value.accountId = CLAIM_SUBMISSION_OTHER_ACCOUNT; return claimResponse(value); });
    if (action === 'resolve') await assert.rejects(client.resolve(CLAIM_SUBMISSION_CARD.certificateNumber), code('CLAIM_ACCESS_ENDED'));
    else if (action === 'sign') await assert.rejects(client.upload(bundle, file, originals[0]), code('CLAIM_ACCESS_ENDED'));
    else { await f.transport.put({ url: `${f.config.storageOrigin}/${file.objectId}`, body: originals[0].file }); await assert.rejects(client.retain(bundle, file), code('CLAIM_ACCESS_ENDED')); }
    f.faults.delete(action);
  }
  f.faults.set('put', () => new Response(null, { status: 403 })); await assert.rejects(client.upload(bundle, file, originals[0]), error => error.code === 'CLAIM_UNAVAILABLE' && error.status === undefined);
});

test('private/no-store JSON, bounded UTF8 body and never-settling adapter/stream cancellation are enforced', async () => {
  const { f, client } = setup(), cert = CLAIM_SUBMISSION_CARD.certificateNumber;
  for (const response of [() => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    () => new Response('x'.repeat(262145), { headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } }),
    () => claimResponse({}, 401), () => claimResponse({}, 403)]) {
    f.faults.set('resolve', response); await assert.rejects(client.resolve(cert));
  }
  let cancelled = 0; f.faults.set('resolve', () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } }));
  const first = new AbortController(), read = client.resolve(cert, { signal: first.signal }); await new Promise(resolve => setImmediate(resolve)); first.abort();
  await assert.rejects(read, code('CLAIM_CANCELLED')); assert.equal(cancelled, 1);
  f.faults.set('resolve', () => new Promise(() => {})); const second = new AbortController(), pending = client.resolve(cert, { signal: second.signal });
  await new Promise(resolve => setImmediate(resolve)); second.abort(); await assert.rejects(pending, code('CLAIM_CANCELLED'));
});

test('bounded request timeout settles even when injected adapter never resolves', async t => {
  const { f, client } = setup(); f.faults.set('resolve', () => new Promise(() => {})); t.mock.timers.enable({ apis: ['setTimeout'] });
  const promise = client.resolve(CLAIM_SUBMISSION_CARD.certificateNumber), rejection = assert.rejects(promise, code('CLAIM_UNAVAILABLE'));
  await Promise.resolve(); t.mock.timers.tick(30000); await rejection;
});
