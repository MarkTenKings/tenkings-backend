// Synthetic, memory-only transport. Never performs fetch, storage, auth or DB I/O.
// Lifecycle outputs use the actual server projection to catch client drift.
import { createHash } from 'node:crypto';
import { ownershipLifecycleInput, projectOwnershipLifecycle } from '../../../packages/atlas-connected-manual/src/card-ownership-proof-contract.mjs';
export const claimFixtureId = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const CLAIM_SUBMISSION_ACCOUNT = claimFixtureId(1), CLAIM_SUBMISSION_OTHER_ACCOUNT = claimFixtureId(2);
export const CLAIM_SUBMISSION_CARD = Object.freeze({ cardId: claimFixtureId(3), approvalActionId: claimFixtureId(4), approvalReportHash: 'a'.repeat(64),
  certificateNumber: 'ATLAS-123456ABCDEF', report: { publicToken: 'ar_' + 'x'.repeat(24), version: 2, publicHash: 'b'.repeat(64) } });
export const CLAIM_SUBMISSION_NOW = Date.parse('2026-10-21T12:00:00Z');
export const claimResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
export function createClaimSubmissionFixture({ accountId = CLAIM_SUBMISSION_ACCOUNT, claim = null } = {}) {
  let serial = 100, currentClaim = structuredClone(claim), card = structuredClone(CLAIM_SUBMISSION_CARD);
  const bundles = new Map(), receipts = new Map(), objects = new Map(), calls = [], faults = new Map();
  const uuid = () => claimFixtureId(serial++);
  const config = { schema: 'atlas-ownership-claim-ui-config-v2', accountId, enabled: true, canPrepareEvidence: true,
    proofKinds: [{ code: 'SYNTHETIC_ORIGINALS', label: 'Synthetic original photographs' }], formats: ['image/jpeg', 'image/png', 'image/heic'],
    limits: { maxObjects: 6, maxObjectBytes: 20971520, maxBundleBytes: 62914560 }, storageOrigin: 'https://proof.example.invalid', storagePathPrefix: '/test-bucket/',
    policyNotice: 'Synthetic test policy only. No operational proof policy or upload destination is enabled.' };
  const base = () => ({ actorId: accountId, observedAt: '2026-10-21T12:00:00.000Z' });
  const project = (action, input, data) => projectOwnershipLifecycle('CUSTOMER', action, { ...base(), ...data }, input);
  const findFile = input => { const bundle = bundles.get(input.bundleId); return { bundle, file: bundle?.files.find(file => file.objectId === input.objectId) }; };
  async function dispatch(action, input, signal, next) { calls.push({ action, input, signal }); return faults.has(action) ? faults.get(action)({ input, signal, next }) : next(); }
  const transport = {
    resolve(input, { signal }) { return dispatch('resolve', input, signal, () => claimResponse({ schema: 'atlas-ownership-claim-target-v1', accountId,
      observedAt: base().observedAt, card: structuredClone(card), canSubmit: !currentClaim, expectedOwnershipRevision: currentClaim ? null : 0 })); },
    lifecycle(action, raw, { signal }) { const input = ownershipLifecycleInput('CUSTOMER', action, raw); return dispatch(action, input, signal, () => {
      if (receipts.has(input.requestId)) return claimResponse(project(action, input, { receipt: receipts.get(input.requestId) }));
      if (action === 'reserve_bundle') {
        let bundle = [...bundles.values()].find(b => b.requestId === input.requestId);
        if (!bundle) { bundle = { bundleId: uuid(), requestId: input.requestId, card: structuredClone(input.expectedPublishedBinding), proofKind: input.proofKind,
          policyRevision: 1, uploadPolicyRevision: 1, expiresAt: '2030-01-01T00:00:00.000Z', usableUntil: '2030-01-02T00:00:00.000Z', deleteAfter: '2030-01-03T00:00:00.000Z', consumed: false,
          files: input.files.map(file => ({ objectId: uuid(), ...file, state: 'RESERVED' })) }; bundles.set(bundle.bundleId, bundle); }
        return claimResponse(project(action, input, { bundle }));
      }
      if (action === 'read_bundle') return bundles.has(input.bundleId) ? claimResponse(project(action, input, { bundle: bundles.get(input.bundleId) })) : claimResponse({}, 404);
      if (action === 'recover_request') { const bundle = [...bundles.values()].find(b => b.requestId === input.requestId); return bundle ? claimResponse(project(action, input, { bundle })) : claimResponse({}, 404); }
      if (action === 'read_claim') return currentClaim?.claimId === input.claimId ? claimResponse(project(action, input, { claim: currentClaim })) : claimResponse({}, 404);
      const bundle = bundles.get(input.bundleId);
      if (action === 'submit_claim') {
        if (currentClaim || !bundle || bundle.consumed || bundle.files.some(f => f.state !== 'RETAINED')) return claimResponse({}, 409);
        currentClaim = { claimId: uuid(), cardId: card.cardId, card: structuredClone(card), claimRevision: 1, state: 'PENDING', bundleId: bundle.bundleId, blockedReasons: [], currentlyOwnedByYou: false };
        bundle.consumed = true;
      } else {
        if (currentClaim?.claimId !== input.claimId || currentClaim.state !== 'PENDING' || currentClaim.claimRevision !== input.expectedClaimRevision) return claimResponse({}, 409);
        if (action === 'replace_evidence' && (!bundle || bundle.consumed || bundle.files.some(f => f.state !== 'RETAINED'))) return claimResponse({}, 409);
        currentClaim.claimRevision++; currentClaim.state = action === 'withdraw_claim' ? 'WITHDRAWN' : 'PENDING';
        if (bundle) { currentClaim.bundleId = bundle.bundleId; bundle.consumed = true; currentClaim.blockedReasons = []; }
      }
      const receipt = { receiptId: uuid(), requestId: input.requestId, action, claimId: currentClaim.claimId, claimRevision: currentClaim.claimRevision,
        state: currentClaim.state, ownershipEventId: action === 'submit_claim' ? currentClaim.claimId : null, bundleId: currentClaim.bundleId };
      receipts.set(input.requestId, receipt); return claimResponse(project(action, input, { receipt }));
    }); },
    sign(input, { signal }) { return dispatch('sign', input, signal, () => {
      const { bundle, file } = findFile(input); if (!file) return claimResponse({}, 404);
      const planHash = 'c'.repeat(64), headers = { 'content-type': 'application/octet-stream', 'if-none-match': '*',
        'x-amz-checksum-sha256': Buffer.from(file.sha256, 'hex').toString('base64'), 'x-amz-meta-atlas-kind': 'ownership-proof-v2', 'x-amz-meta-atlas-binding-sha256': planHash };
      const url = new URL(`${config.storageOrigin}${config.storagePathPrefix}atlas-ownership-proof/v2/${bundle.bundleId}/${file.objectId}`);
      url.searchParams.set('X-Amz-Expires', '300'); url.searchParams.set('X-Amz-SignedHeaders', [...Object.keys(headers), 'host', 'content-length'].sort().join(';'));
      return claimResponse({ schema: 'atlas-ownership-proof-put-v2', accountId, ...input, planHash, method: 'PUT', url: url.href, headers,
        byteCount: file.byteCount, sha256: file.sha256, expiresIn: 300 });
    }); },
    put(input) { return dispatch('put', input, input.signal, async () => {
      const objectId = new URL(input.url).pathname.split('/').at(-1); if (objects.has(objectId)) return new Response(null, { status: 412 });
      objects.set(objectId, { body: input.body, bytes: new Uint8Array(await input.body.arrayBuffer()) }); return new Response(null, { status: 200 });
    }); },
    complete(input, { signal }) { return dispatch('complete', input, signal, () => {
      const { file } = findFile(input), object = objects.get(input.objectId); if (!file || !object) return claimResponse({}, 404);
      if (object.bytes.byteLength !== file.byteCount || createHash('sha256').update(object.bytes).digest('hex') !== file.sha256) return claimResponse({}, 409);
      file.state = 'RETAINED'; return claimResponse({ schema: 'atlas-ownership-proof-retained-v2', accountId, ...input, state: 'RETAINED', byteCount: file.byteCount, sha256: file.sha256, declaredType: file.declaredType });
    }); },
  };
  return { accountId, config, transport, calls, faults, bundles, receipts, objects, uuid, now: () => CLAIM_SUBMISSION_NOW,
    get claim() { return currentClaim; }, set claim(value) { currentClaim = structuredClone(value); }, set card(value) { card = structuredClone(value); }, project };
}
export function claimOriginal(name = 'original.png', tail = 0) {
  // Actual original byte identity is tested; decoding belongs to server validator qualification.
  return new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, tail])], name, { type: 'image/png' });
}
export const pendingClaim = () => ({ claimId: claimFixtureId(50), cardId: CLAIM_SUBMISSION_CARD.cardId, card: structuredClone(CLAIM_SUBMISSION_CARD), claimRevision: 1,
  state: 'PENDING', bundleId: null, blockedReasons: ['EVIDENCE_EXPIRED', 'POLICY_UNAVAILABLE'], currentlyOwnedByYou: false });
