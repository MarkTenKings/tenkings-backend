// Explicit synthetic test data projected by the actual qualified server
// contract. Never imported by the application or an operational route.
import { projectOwnershipWorkflow } from '../../../packages/atlas-connected-manual/src/card-ownership-workflow-contract.mjs';
export const claimFixtureId = n => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
export const CLAIM_ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CLAIM_OTHER_ACCOUNT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export function claimFixtureRow(n, { decision = 'PENDING', availability = 'AVAILABLE', owned = false, cardMissing = false, evidenceMissing = false } = {}) {
  const card = cardMissing ? null : { cardId: claimFixtureId(n + 1000), approvalActionId: claimFixtureId(n + 2000), approvalReportHash: 'a'.repeat(64),
    certificateNumber: `ATLAS-${n.toString(16).padStart(12, '0').toUpperCase()}`, report: { publicToken: 'ar_' + 'A'.repeat(24), version: 2, publicHash: 'b'.repeat(64) } };
  const ready = card !== null && availability === 'AVAILABLE';
  return { claimId: claimFixtureId(n), cardId: claimFixtureId(n + 1000), requestId: claimFixtureId(n + 3000), submittedAt: '2026-10-21T10:00:00.000Z', card,
    decision: { state: decision, decidedAt: decision === 'PENDING' ? null : '2026-10-21T11:00:00.000Z' },
    evidence: { referenceId: evidenceMissing ? null : claimFixtureId(n + 4000), availability,
      usableUntil: evidenceMissing ? null : '2026-10-22T10:00:00.000Z', proofKind: evidenceMissing ? null : 'FIXTURE_CLAIM' },
    reviewStatus: decision !== 'PENDING' ? 'DECIDED' : ready ? 'PENDING' : 'BLOCKED', actions: { downloadEvidence: ready }, currentlyOwnedByYou: owned };
}
export function createOwnershipClaimsFixture({ accountId = CLAIM_ACCOUNT, count = 7, after = 0, next = false } = {}) {
  const variants = [{}, { decision: 'VERIFIED' }, { decision: 'VERIFIED', owned: true }, { decision: 'REJECTED' },
    { availability: 'EXPIRED' }, { availability: 'POLICY_CHANGED' }, { availability: 'POLICY_UNAVAILABLE' },
    { availability: 'UNAVAILABLE', cardMissing: true, evidenceMissing: true }];
  const claims = Array.from({ length: count }, (_, index) => claimFixtureRow(after + index + 1, variants[index % variants.length]));
  const raw = { actorId: accountId, observedAt: '2026-10-21T12:00:00.000Z', claims, nextClaimId: next ? claims.at(-1).claimId : null };
  const request = { afterClaimId: after ? claimFixtureId(after) : null, limit: Math.max(count, 1) };
  return { accountId, raw, request, page: projectOwnershipWorkflow('CUSTOMER', 'list_claims', raw, request) };
}
