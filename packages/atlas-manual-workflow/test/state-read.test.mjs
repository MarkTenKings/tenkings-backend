import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualWorkflow } from '../src/workflow.mjs';
import { digest, requireThat } from '@atlas/manual-service/contract';
import { createGeometryWorkspace, applyGeometryEdit, applyPreparedFrame, geometryBase, preparationBase } from '../../atlas-manual-workspace/src/geometry-actions.mjs';
import { workspace } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';

const sides = ['FRONT', 'BACK'], hash = value => value.repeat(64), clone = value => structuredClone(value);
const quad = [{ x: .125, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .125, y: .9 }];
function fixture() {
  const defects = workspace(), objects = new Map(), reads = [];
  const f = { loads: 0, sourceChecks: 0, source: hash('a'), denied: false, reads, objects };
  let geometry = createGeometryWorkspace({ cardId: defects.cardId, profile: defects.profile,
    sides: Object.fromEntries(sides.map((side, index) => [side, {
      image: { version: 1, originalSha256: hash(String(index + 1)), frameId: `working-${side}`, frameSha256: hash('a'), width: 1600, height: 2400, coordinateSpace: 'ORIENTED_DECODED' },
      cornerShape: 'SQUARE', matColor: 'BLACK',
    }])) });
  for (const side of sides) {
    geometry = applyGeometryEdit(geometry, { side, kind: 'PHYSICAL', base: geometryBase(geometry, side, 'PHYSICAL'), quad, actor: 'HUMAN', proposal: null }).state;
    const frame = defects.sides[side].frame, sx = 1269 / 1200, sy = 1777 / 1920;
    geometry = applyPreparedFrame(geometry, { side, base: preparationBase(geometry, side), frame: {
      id: frame.frameId, version: frame.preparationVersion, sourceToRectified: [sx, 0, -200 * sx, 0, sy, -240 * sy, 0, 0, 1],
      rectified: { sha256: frame.rectifiedImageSha256, width: 1270, height: 1778 },
      inspection: { sha256: frame.inspectionImageSha256, width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
    } }).state;
  }
  const store = (kind, value) => { objects.set(kind, clone(value)); return { ref: { id: kind }, sourceHash: digest(JSON.stringify(value)) }; };
  const report = { cardId: defects.cardId, sourceHash: f.source, findings: sides.flatMap(side => defects.sides[side].findings) };
  f.card = { cardId: defects.cardId, revision: 7, contentHash: hash('c'), draft: { version: 'atlas-manual-workflow-v2', source: { sourceHash: f.source },
    geometry: store('GEOMETRY', geometry), defects: store('DEFECTS', defects), identity: { cardName: 'Synthetic' }, identityRevision: 1,
    assistance: store('ASSISTANCE', { version: 'atlas-defect-assistance-v1', reviews: [] }),
    finalReview: store('FINAL_REVIEW', { version: 'atlas-final-review-v1', report, reportHash: digest(JSON.stringify(report)) }),
  } };
  const repository = { async load(staff, cardId) {
    assert.equal(staff, f.staff); assert.equal(cardId, f.card.cardId); f.loads++;
    requireThat(!f.denied, 403, 'MANUAL_ACCESS_DENIED');
    return { card: clone(f.card), principal: { id: 'reviewer' } };
  } };
  const artifacts = { async read(ref) { reads.push(ref.id); if (f.duringRead) f.duringRead(ref.id); return clone(objects.get(ref.id)); } };
  f.staff = {};
  f.workflow = createManualWorkflow({ repository, artifacts, assertCurrent: async ({ staff, card, principal }) => {
    assert.equal(staff, f.staff); assert.equal(principal.id, 'reviewer'); f.sourceChecks++;
    requireThat(card.draft.source.sourceHash === f.source, 409, 'MANUAL_PHOTOS_CHANGED');
  } });
  f.read = () => f.workflow.readState(f.staff, f.card.cardId);
  return f;
}

test('state read returns exact verified geometry and findings with two artifact reads and no duplicated report', async () => {
  const f = fixture(), result = await f.read();
  assert.deepEqual(result, { card: f.card, geometry: f.objects.get('GEOMETRY'), defects: f.objects.get('DEFECTS'), identity: f.card.draft.identity });
  assert.deepEqual(f.reads.sort(), ['DEFECTS', 'GEOMETRY']); assert.equal(f.loads, 2); assert.equal(f.sourceChecks, 2);
  const full = await f.workflow.hydrate(f.card);
  assert(full.assistance); assert(full.finalReview);
  assert.equal(f.reads.length, 6, 'ordinary hydration still reads and verifies all four artifacts');
  assert(Buffer.byteLength(JSON.stringify(result)) < Buffer.byteLength(JSON.stringify({ card: f.card, ...full })));
});

test('state read rejects a replaced source before reading any artifacts', async () => {
  const f = fixture(); f.source = hash('b');
  await assert.rejects(f.read(), { code: 'MANUAL_PHOTOS_CHANGED' }); assert.deepEqual(f.reads, []);
});

for (const change of ['source', 'access', 'revision', 'contentHash']) test(`state read rejects a concurrent ${change} change without returning mixed current bases`, async () => {
  const f = fixture();
  f.duringRead = () => {
    if (change === 'source') f.source = hash('b');
    if (change === 'access') f.denied = true;
    if (change === 'revision') f.card.revision++;
    if (change === 'contentHash') f.card.contentHash = hash('b');
  };
  await assert.rejects(f.read(), { code: change === 'source' ? 'MANUAL_PHOTOS_CHANGED' : change === 'access' ? 'MANUAL_ACCESS_DENIED' : 'MANUAL_DRAFT_STALE' });
});

test('state read still rejects corrupted artifact bytes and mismatched measured frames', async () => {
  const corrupt = fixture(); corrupt.objects.get('DEFECTS').draftRevision++;
  await assert.rejects(corrupt.read(), { code: 'MANUAL_ARTIFACT_UNVERIFIED' });
  const mismatch = fixture(), defects = mismatch.objects.get('DEFECTS'); defects.sides.FRONT.frame.frameId = 'different-frame';
  mismatch.card.draft.defects.sourceHash = digest(JSON.stringify(defects));
  await assert.rejects(mismatch.read(), { code: 'MANUAL_FRAME_MISMATCH' });
});
