import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStaffCompCurationController } from '../lib/staff-comp-curation-controller.mjs';
import { curationDecisionInput, parseCurationReceipt, parseCurationState } from '../lib/staff-comp-curation-client.mjs';
import { httpFixture, realSavedV2 } from './staff-comp-curation-fixture.mjs';
const selectionPolicy = { version: 'atlas-comp-evidence-selection-policy-v1', status: 'LOCAL_PROPOSAL',
  method: 'private-saved-sold-evidence-v1', recencyDays: null, rightsStatus: 'UNRESOLVED' };
async function fixture() {
  const f = await httpFixture({ selectionPolicy, designationReviewsEnabled: true }); realSavedV2(f);
  const row = f.preview.candidates[0], imageUrl = 'https://i.ebayimg.com/images/g/fixture/s-l1600.jpg';
  Object.assign(row.sale, { imageUrl, labelText: 'SYNTHETIC saved label\nPSA MINT 9' });
  Object.assign(row.slabReading, { imageUrl, sha256: '1'.repeat(64) }); f.savePreview();
  const expected = { cardId: f.cardId, approvalActionId: f.actionId, previewId: f.previewId, mode: f.staff.mode };
  const controller = createStaffCompCurationController({ staff: f.staff, cardId: f.cardId, input: f.readInput, request: f.request });
  await controller.load(); const state = controller.snapshot().state; assert(state);
  const candidate = state.preview.candidates.find(r => r.designationReview); assert(candidate);
  const input = { requestId: randomUUID(), outcome: 'SELECTED', selectedIds: [candidate.id], reviewedIds: [candidate.id],
    designationReviews: { version: 'atlas-comp-designation-reviews-v1', rows: [{ id: candidate.id, designation: 'STANDARD',
      photoSha256: candidate.designationReview.photoSha256, proofHash: candidate.designationReview.proofHash }] } };
  return { ...f, expected, controller, state, candidate, decision: input };
}
test('joined explicit designation selection retains exact receipt through lost response, reopen and same-request retry', async () => {
  const f = await fixture(), savedSource = JSON.stringify(f.preview), savedReport = JSON.stringify(f.packet);
  let lose = true; f.hooks.response = ({ method }) => { if (method === 'POST' && lose) { lose = false; throw Error('Synthetic lost response after commit'); } };
  await f.controller.decide(f.decision); assert.equal(f.controller.snapshot().phase, 'UNRESOLVED'); assert.equal(f.rows.length, 1);
  await f.controller.reconcile(); const receipt = f.controller.snapshot().receipt;
  assert.equal(f.controller.snapshot().phase, 'CONFIRMED'); assert.equal(receipt.guidance, null);
  assert.equal(receipt.selected[0].designationEvidence.actorId, f.staff.id);
  assert.equal(receipt.selected[0].designationEvidence.reviewedAt, receipt.asOf);
  assert.equal(receipt.selected[0].designation, 'STANDARD'); assert(!Object.hasOwn(receipt.selected[0], 'designationReview'));
  const exact = f.exchanges.find(r => r.method === 'POST').body;
  assert.deepEqual(await f.service.decide(f.staff, f.cardId, exact), receipt); assert.equal(f.rows.length, 1);
  const reopened = parseCurationState(await f.service.read(f.staff, f.cardId, f.readInput), f.expected);
  assert.deepEqual(reopened.selection, receipt); assert.equal(reopened.preview.candidates[0].designation, null);
  assert.equal(JSON.stringify(f.preview), savedSource); assert.equal(JSON.stringify(f.packet), savedReport); f.controller.dispose();
});
test('browser rejects forged proof, contradictory evidence, unselected reviews and special designation for PSA', async () => {
  const f = await fixture();
  for (const change of [{ proofHash: '9'.repeat(64) }, { photoSha256: '9'.repeat(64) }, { designation: 'BLACK_LABEL' }]) {
    const d = structuredClone(f.decision); Object.assign(d.designationReviews.rows[0], change);
    await assert.rejects(f.controller.decide(d), { code: 'COMP_SELECTION_INELIGIBLE' });
  }
  for (const mutate of [s => s.preview.candidates[0].reasonCodes.push('IDENTITY_NOT_CONFIRMED'),
    s => s.preview.candidates[0].designationReview.allowedDesignations.push('PERFECT'),
    s => s.preview.candidates[0].designationReview.labelText = 'Unsafe\tlabel']) {
    const state = structuredClone(f.state); mutate(state); assert.throws(() => parseCurationState(state, f.expected));
  }
  const input = { ...f.input(), ...f.decision }; input.designationReviews.rows[0].id = 'not-selected';
  assert.throws(() => curationDecisionInput(input)); assert.equal(f.rows.length, 0); f.controller.dispose();
});
test('human receipt provenance cannot be moved to another actor, source, time or pricing policy', async () => {
  const f = await fixture(); await f.controller.decide(f.decision); const receipt = f.controller.snapshot().receipt; assert(receipt);
  for (const change of [{ actorId: randomUUID() }, { previewHash: '8'.repeat(64) }, { reviewedAt: '2026-10-20T12:00:00.000Z' },
    { designation: 'PRISTINE' }, { authority: 'AUTOMATIC' }]) {
    const value = structuredClone(receipt); Object.assign(value.selected[0].designationEvidence, change);
    assert.throws(() => parseCurationReceipt(value, f.expected));
  }
  const priced = structuredClone(receipt); priced.policy = { version: 'atlas-comp-curation-policy-v1', status: 'LOCAL_PROPOSAL',
    method: 'selected-sold-price-arithmetic-mean-v1', recencyDays: 90, rightsStatus: 'UNRESOLVED' };
  assert.throws(() => parseCurationReceipt(priced, f.expected)); f.controller.dispose();
});
