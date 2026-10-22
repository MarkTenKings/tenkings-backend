// Synthetic lifecycle data passed through the actual qualified v2 read projector.
// No application imports, persistence, credentials, proof storage or authority.
import { projectOwnershipLifecycleRead } from '../../../packages/atlas-connected-manual/src/card-ownership-lifecycle-read-contract.mjs';
export const claimFixtureId = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
export const CLAIM_ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CLAIM_OTHER_ACCOUNT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const CLAIM_CHECKED = '2026-10-21T12:00:00.000Z';
export function claimFixtureRow(n, { state = 'PENDING', blocked = [], owned = false, cardMissing = false, bundleMissing = false, revision = 1 } = {}) {
  const cardId = claimFixtureId(n + 1000), card = cardMissing ? null : { cardId, approvalActionId: claimFixtureId(n + 2000), approvalReportHash: 'a'.repeat(64),
    certificateNumber: `ATLAS-${n.toString(16).padStart(12, '0').toUpperCase()}`, report: { publicToken: 'ar_' + 'A'.repeat(24), version: 2, publicHash: 'b'.repeat(64) } };
  return { claimId: claimFixtureId(n), cardId, card, claimRevision: revision, state, bundleId: bundleMissing ? null : claimFixtureId(n + 4000),
    blockedReasons: [...blocked], currentlyOwnedByYou: owned };
}
export function createOwnershipClaimsFixture({ accountId = CLAIM_ACCOUNT, count = 8, after = 0, next = false } = {}) {
  const variants = [{}, { state: 'VERIFIED' }, { state: 'VERIFIED', owned: true }, { state: 'REJECTED' },
    { blocked: ['EVIDENCE_EXPIRED'] }, { blocked: ['POLICY_CHANGED'] }, { blocked: ['POLICY_UNAVAILABLE'] },
    { state: 'WITHDRAWN', revision: 3, blocked: ['EVIDENCE_UNAVAILABLE', 'CARD_UNAVAILABLE'], cardMissing: true, bundleMissing: true }];
  const claims = Array.from({ length: count }, (_, index) => claimFixtureRow(after + index + 1, variants[index % variants.length]));
  const raw = { actorId: accountId, observedAt: CLAIM_CHECKED, claims, nextClaimId: next ? claims.at(-1).claimId : null };
  const request = { afterClaimId: after ? claimFixtureId(after) : null, limit: Math.max(count, 1) };
  return { accountId, raw, request, page: projectOwnershipLifecycleRead('list_claims', raw, request) };
}
export function createOwnershipClaimHistoryFixture({ accountId = CLAIM_ACCOUNT, n = 1, legacy = false, afterRevision = 0, limit = 25,
  state = 'WITHDRAWN', revision = 3, owned = false, cardMissing = false } = {}) {
  const claim = claimFixtureRow(n, { state, revision, owned, cardMissing, bundleMissing: legacy && revision === 1 });
  const originalBundleId = claimFixtureId(n + 4000), replacementBundleId = claimFixtureId(n + 5000);
  if (revision > 1) claim.bundleId = replacementBundleId;
  const transitions = [];
  for (let r = legacy ? 2 : 1; r <= revision; r++) transitions.push({ claimRevision: r,
    action: r === 1 ? 'submit_claim' : r === revision && state !== 'PENDING' ? state === 'WITHDRAWN' ? 'withdraw_claim' : 'review_claim' : 'replace_evidence',
    state: r === revision ? state : 'PENDING', bundleId: r === 1 ? originalBundleId : replacementBundleId,
    occurredAt: `2026-10-21T10:${String(r).padStart(2, '0')}:00.000Z` });
  const page = transitions.filter(t => t.claimRevision > afterRevision).slice(0, limit);
  const raw = { actorId: accountId, observedAt: CLAIM_CHECKED, claim, submittedAt: '2026-10-21T10:00:00.000Z',
    origin: legacy ? 'LEGACY_V1' : 'PROOF_V2', transitions: page, nextRevision: page.length && page.at(-1).claimRevision < revision ? page.at(-1).claimRevision : null };
  const request = { claimId: claim.claimId, afterRevision, limit };
  return { raw, request, history: projectOwnershipLifecycleRead('list_history', raw, request) };
}
