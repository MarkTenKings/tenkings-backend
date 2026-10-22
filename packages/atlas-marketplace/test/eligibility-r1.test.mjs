import test from 'node:test';
import assert from 'node:assert/strict';
import { createR1AuthorityCompatibilityAdapter, inspectR1AuthorityCompatibility } from '../src/authority-r1.mjs';
import { assertEligibility } from '../src/eligibility.mjs';

function packet() {
  const accountId = '11111111-1111-4111-8111-111111111111', cardId = '22222222-2222-4222-8222-222222222222', approvalActionId = '33333333-3333-4333-8333-333333333333';
  const report = { publicToken: `ar_${'a'.repeat(24)}`, version: 1, publicHash: 'b'.repeat(64) };
  const binding = { accountId, cardId, ownershipRevision: 1, approvalActionId, certificateNumber: 'ATLAS-AAAAAAAAAAAA', report };
  return { accountId, collectionCard: { schema: 'atlas-owner-collection-card-v1', cardId, ownership: { status: 'VERIFIED', ownerAccountId: accountId, revision: 1 }, custody: { status: 'RECORDED', currentPhysicalHolder: 'UNKNOWN' }, approvedCard: { approvalActionId, certificateNumber: binding.certificateNumber, report } }, display: { schema: 'atlas-collection-display-v1', binding, title: 'Explicit local structural fixture', finalGrade: 9, front: { status: 'AVAILABLE', provenance: 'APPROVED_GRADING_PHOTOGRAPH', sha256: 'c'.repeat(64), byteCount: 1000, width: 1350, height: 1858, contentType: 'image/webp', path: `/account/api/customer/collection/cards/${cardId}/display/front?ownershipRevision=1&approvalActionId=${approvalActionId}&version=1&publicHash=${report.publicHash}` } } };
}

test('R1 exact owner/display compatibility never supplies marketplace authority, even with an enable option', async () => {
  const input = packet(), adapter = createR1AuthorityCompatibilityAdapter({ enabled: true });
  const inspected = adapter.inspect(input);
  assert.equal(inspected.compatible, true); assert.equal(inspected.available, false);
  assert.ok(inspected.reasonCodes.includes('ATLAS_CUSTODY_EVIDENCE_REQUIRED'));
  assert.ok(inspected.reasonCodes.includes('APPROVED_BACK_AND_REPORT_BYTES_REQUIRED'));
  assert.equal(inspected.claimsEnabled, false); assert.equal(inspected.historyEnabled, false);
  assert.equal((await adapter.read(input)).available, false);
  assert.throws(() => assertEligibility(inspected, { cardId: input.collectionCard.cardId, sellerId: input.accountId, now: Date.now() }));
  input.display.binding.report.version = 2;
  assert.equal(inspectR1AuthorityCompatibility(input).compatible, false);
  const wrongOwner = packet(); wrongOwner.accountId = '44444444-4444-4444-8444-444444444444';
  assert.equal(inspectR1AuthorityCompatibility(wrongOwner).compatible, false);
});
