import test from 'node:test';
import assert from 'node:assert/strict';
import { defectAnalysisBinding, machineDefectAnalysisBinding } from '../src/defect-assistance.mjs';
import { createDefectWorkspace } from '../../atlas-manual-workspace/src/defect-actions.mjs';
import { frameFromGeometry } from '../../atlas-manual-workflow/src/workflow.mjs';
import { publicationFixture } from './publication-fixture.mjs';

async function fixture() {
  const f = await publicationFixture(), geometry = structuredClone(f.geometry);
  for (const side of ['FRONT', 'BACK']) geometry.sides[side].confirmation = null;
  const defects = createDefectWorkspace({ cardId: f.cardId, profile: geometry.profile,
    sides: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { frame: frameFromGeometry(geometry, side), cornerShape: geometry.sides[side].cornerShape }])) });
  const card = { cardId: f.cardId, revision: 3, contentHash: 'a'.repeat(64), draft: { identityRevision: 2, source: { sourceHash: 'b'.repeat(64) } } };
  return { card, state: { geometry, defects } };
}
test('machine analysis binds complete proposed geometry without asserting human confirmation', async () => {
  const f = await fixture(), before = structuredClone(f.state);
  assert.throws(() => defectAnalysisBinding(f.card, f.state), error => error.code === 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
  const machine = machineDefectAnalysisBinding(f.card, f.state);
  assert.equal(machine.manualRevision, 3); assert.equal(machine.manualContentHash, f.card.contentHash);
  assert.equal(machine.sourceHash, f.card.draft.source.sourceHash); assert.equal(machine.identityRevision, 2);
  assert.deepEqual(machine.sides.FRONT.frame, f.state.defects.sides.FRONT.frame); assert.deepEqual(f.state, before);
});
test('untrusted authority text cannot enter the private machine path', async () => {
  const f = await fixture();
  for (const authority of ['MACHINE_PREPARATION', { actor: 'ASTRA' }, Symbol('atlas-machine-preparation')]) {
    assert.throws(() => defectAnalysisBinding(f.card, f.state, authority), error => error.code === 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
  }
});
test('ambiguous geometry and pending edits refuse even machine analysis', async () => {
  const ambiguous = await fixture(); ambiguous.state.geometry.sides.FRONT.printed.actor = 'ENGINE';
  ambiguous.state.geometry.sides.FRONT.printed.proposal = { id: 'ambiguous-machine-border', ambiguous: true };
  assert.throws(() => machineDefectAnalysisBinding(ambiguous.card, ambiguous.state), error => error.code === 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
  const pending = await fixture(); pending.state.defects = structuredClone(pending.state.defects); pending.state.defects.sides.BACK.pending = { synthetic: true };
  assert.throws(() => machineDefectAnalysisBinding(pending.card, pending.state), error => error.code === 'MANUAL_DEFECT_PENDING');
});
