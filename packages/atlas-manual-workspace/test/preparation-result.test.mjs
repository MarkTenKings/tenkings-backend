import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createGeometryWorkspace, applyGeometryEdit, geometryBase, preparationBase, geometryStatus } from '../src/geometry-actions.mjs';
import { adoptGeometryPreparation, adoptPhysicalGeometryProposal } from '../src/preparation-result.mjs';
import { createManualWorkflow } from '../../atlas-manual-workflow/src/workflow.mjs';
import { createManualArtifactStore } from '../../atlas-manual-service/src/artifacts.mjs';
import { stateDocument } from '../../atlas-manual-service/src/contract.mjs';

const quad = [{ x: .125, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .125, y: .9 }];
// Exact rejected automatic Back proposal from the retained offline replay.
const outside = [{ x: .11692121798399265, y: .11382197576855856 }, { x: .8366842925863922, y: .0923840810382177 },
  { x: .8703024727957589, y: .8760482545882936 }, { x: .10768603773974868, y: 1.1143079485212053 }];
function initial() {
  return createGeometryWorkspace({ cardId: randomUUID(), profile: 'SPORTS', sides: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, {
    image: { version: 1, originalSha256: 'a'.repeat(64), frameId: side + '-decoded', frameSha256: 'b'.repeat(64),
      width: 1600, height: 2400, coordinateSpace: 'ORIENTED_DECODED' }, cornerShape: 'SQUARE', matColor: 'WHITE',
  }])) });
}
function proposal(state, side, points = quad) {
  return { id: `${side}-automatic`, side, base: geometryBase(state, side, 'PHYSICAL'),
    proposal: { outcome: 'ACCEPTED', proposal: points, ambiguity: { ambiguous: false } } };
}
function preparation(state, side, points = quad) {
  const sx = 1269 / 1200, sy = 1777 / 1920;
  return { id: `${side}-preparation`, side, base: preparationBase(state, side), settingsRevision: state.sides[side].settingsRevision,
    matColor: 'WHITE', cornerShape: 'SQUARE', proposal: { outcome: 'ACCEPTED', proposal: points },
    frame: { id: `${side}-prepared`, version: 1, rectified: { sha256: 'c'.repeat(64), width: 1270, height: 1778 },
      inspection: { sha256: 'd'.repeat(64), width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
      sourceToRectified: [sx, 0, -200 * sx, 0, sy, -240 * sy, 0, 0, 1] } };
}

test('out-of-bounds automatic Back outline preserves Front preparation and provisions a manual fallback without clamping', async () => {
  let state = initial(); state = adoptPhysicalGeometryProposal(state, proposal(state, 'FRONT')).state;
  state = adoptGeometryPreparation(state, preparation(state, 'FRONT')).state;
  const front = state.sides.FRONT, rejected = proposal(state, 'BACK', outside), original = structuredClone(rejected);
  const fallback = adoptPhysicalGeometryProposal(state, rejected);
  assert.equal(fallback.proposalApplied, false); assert.deepEqual(rejected, original);
  assert.equal(fallback.state, state); assert.deepEqual(fallback.state.sides.FRONT, front);
  assert.equal(fallback.state.sides.BACK.physical, null); assert.equal(fallback.state.sides.BACK.prepared, null);
  assert.equal(geometryStatus(fallback.state).canConfirmBoth, false);
  const objects = new Map(), artifacts = createManualArtifactStore({ transport: {
    async putIfAbsent(input) { if (objects.has(input.key)) throw Error('exists'); objects.set(input.key, { ...input, bytes: Buffer.from(input.bytes) }); },
    async read({ key }) { return objects.get(key); },
  } });
  const workflow = createManualWorkflow({ artifacts, repository: { async provision(_staff, { cardId, draft }) {
    const saved = stateDocument(draft); return { cardId, revision: 1, contentHash: saved.hash, draft: saved.draft };
  } } });
  const card = await workflow.provision({}, { geometry: fallback.state,
    identity: { playerName: 'Synthetic sports card', year: '2023-24', manufacturer: 'Fixture', productSet: 'Outline regression' } });
  const restored = await workflow.hydrate(card);
  assert.equal(card.revision, 1); assert.deepEqual(restored.geometry.sides.FRONT, front);
  assert.equal(restored.geometry.sides.BACK.physical, null); assert.equal(restored.defects, null);
});

test('invalid automatic printed outline keeps the valid prepared frame and requires manual printed review', () => {
  let state = initial(); state = adoptPhysicalGeometryProposal(state, proposal(state, 'FRONT')).state;
  const result = preparation(state, 'FRONT', outside), before = structuredClone(result);
  const adopted = adoptGeometryPreparation(state, result);
  assert.equal(adopted.proposalApplied, false); assert.deepEqual(adopted.state.sides.FRONT.prepared.frame, result.frame);
  assert.equal(adopted.state.sides.FRONT.printed, null); assert.equal(adopted.state.sides.FRONT.confirmation, null);
  assert.deepEqual(result, before); assert.deepEqual(adopted.state.sides.BACK, state.sides.BACK);
});

test('automatic fallback never weakens human validation, stale bases or invalid preparation bindings', () => {
  const state = initial(), candidate = proposal(state, 'BACK', outside);
  assert.throws(() => applyGeometryEdit(state, { side: 'BACK', kind: 'PHYSICAL', base: candidate.base,
    quad: outside, actor: 'HUMAN', proposal: null }), { code: 'ATLAS_GEOMETRY_QUAD_INVALID' });
  const changed = adoptPhysicalGeometryProposal(state, proposal(state, 'BACK')).state;
  assert.throws(() => adoptPhysicalGeometryProposal(changed, candidate), { code: 'ATLAS_GEOMETRY_STALE' });
  const prep = preparation(changed, 'BACK', outside); prep.frame.rectified.width = 1269;
  assert.throws(() => adoptGeometryPreparation(changed, prep));
  assert.equal(changed.sides.BACK.prepared, null);
});

test('valid automatic proposals remain exact and unconfirmed, and abstentions do not fabricate geometry', () => {
  const state = initial(), candidate = proposal(state, 'FRONT');
  const adopted = adoptPhysicalGeometryProposal(state, candidate);
  assert.equal(adopted.proposalApplied, true); assert.deepEqual(adopted.state.sides.FRONT.physical.quad, quad);
  assert.equal(adopted.state.sides.FRONT.physical.actor, 'ENGINE'); assert.equal(adopted.state.sides.FRONT.confirmation, null);
  assert.equal(adoptPhysicalGeometryProposal(state, { ...candidate, proposal: { outcome: 'ABSTAIN' } }).state, state);
});
