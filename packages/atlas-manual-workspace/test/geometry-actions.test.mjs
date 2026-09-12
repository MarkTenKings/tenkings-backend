import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  GEOMETRY_CONVENTION, applyGeometryEdit, applyPreparedFrame, confirmBothGeometry,
  createGeometryWorkspace, geometryBase, geometryStatus, originalPointToPrepared,
  parseGeometryWorkspace, preparationBase, preparedPointToOriginal, printedQuadOnOriginal,
  replaceGeometryImage, serializeGeometryWorkspace, updateGeometrySettings,
} from '../src/geometry-actions.mjs';
import { calculateCenteringScore, measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { orientationTransform, transformPoint } from '../../atlas-photo-core/src/index.mjs';

const hash = letter => letter.repeat(64);
const clone = value => structuredClone(value);
const sides = ['FRONT', 'BACK'];
const physical = [{ x: 0.125, y: 0.1 }, { x: 0.875, y: 0.1 }, { x: 0.875, y: 0.9 }, { x: 0.125, y: 0.9 }];
const printed = [{ x: 0.04, y: 0.06 }, { x: 0.94, y: 0.06 }, { x: 0.94, y: 0.96 }, { x: 0.04, y: 0.96 }];
const adjusted = [{ x: 0.03, y: 0.08 }, { x: 0.93, y: 0.08 }, { x: 0.93, y: 0.94 }, { x: 0.03, y: 0.94 }];
const whole = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
function image(side, version = 1) {
  return { version, originalSha256: hash(side === 'FRONT' ? 'a' : 'b'),
    frameId: `${side}-oriented-${version}`, frameSha256: hash(side === 'FRONT' ? 'c' : 'd'),
    width: 1600, height: 2400, coordinateSpace: 'ORIENTED_DECODED' };
}
function initial({ absent = false, profile = 'SPORTS' } = {}) {
  return createGeometryWorkspace({ cardId: 'fixture-card-1', profile,
    sides: Object.fromEntries(sides.map(side => [side, { image: absent ? null : image(side),
      cornerShape: 'ROUNDED_3_18_MM', matColor: 'BLACK' }])) });
}
function editAction(state, side, kind, quad, actor = 'HUMAN', proposal = null) {
  return { side, kind, quad, actor, proposal, base: geometryBase(state, side, kind) };
}
function edit(state, side, kind, quad = kind === 'PHYSICAL' ? physical : printed) {
  return applyGeometryEdit(state, editAction(state, side, kind, quad)).state;
}
function frame(state, side) {
  const current = state.sides[side], quad = current.physical.quad;
  const x = quad[0].x * current.image.width, y = quad[0].y * current.image.height;
  const sx = 1269 / ((quad[1].x - quad[0].x) * current.image.width);
  const sy = 1777 / ((quad[3].y - quad[0].y) * current.image.height);
  const version = current.preparationRevision + 1;
  return { id: `${side}-prepared-${version}`, version,
    rectified: { sha256: hash(side === 'FRONT' ? 'e' : 'f'), width: 1270, height: 1778 },
    inspection: { sha256: hash(side === 'FRONT' ? '1' : '2'), width: 1350, height: 1858,
      cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
    sourceToRectified: [sx, 0, -x * sx, 0, sy, -y * sy, 0, 0, 1] };
}
function prepareAction(state, side) { return { side, base: preparationBase(state, side), frame: frame(state, side) }; }
function ready() {
  let state = initial();
  for (const side of sides) {
    state = edit(state, side, 'PHYSICAL');
    state = applyPreparedFrame(state, prepareAction(state, side)).state;
    state = edit(state, side, 'PRINTED');
  }
  return state;
}
function confirmation(state, actor = 'HUMAN', reviewed = true) {
  return { actor, reviewed, base: Object.fromEntries(sides.map(side => [side, geometryBase(state, side, 'REVIEW')])) };
}
const code = expected => error => error?.code === expected;
function approximately(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('a new paired workspace contains no fabricated physical edge, prepared image, printed border or grade', () => {
  const state = initial(), status = geometryStatus(state);
  assert.equal(state.convention, GEOMETRY_CONVENTION);
  assert.equal(status.sides.FRONT.stage, 'PHYSICAL');
  assert.equal(status.canConfirmBoth, false);
  assert.equal(status.centeringScore, null);
  assert.equal(status.reportApproval, false);
  assert.equal(state.sides.FRONT.physical, null);
  assert.equal(state.sides.FRONT.prepared, null);
  assert.equal(state.sides.FRONT.printed, null);
  assert.throws(() => createGeometryWorkspace({ ...state, profile: 'OVERSIZED' }));
});

test('independent side intake begins with no photo, accepts version one, and leaves Back alone', () => {
  const before = initial({ absent: true }), back = clone(before.sides.BACK);
  assert.equal(geometryStatus(before).sides.FRONT.stage, 'IMAGE');
  assert.throws(() => edit(before, 'FRONT', 'PHYSICAL'), code('ATLAS_GEOMETRY_IMAGE_REQUIRED'));
  const result = replaceGeometryImage(before, { side: 'FRONT', base: geometryBase(before, 'FRONT', 'IMAGE'), image: image('FRONT') });
  assert.equal(geometryStatus(result.state).sides.FRONT.stage, 'PHYSICAL');
  assert.deepEqual(result.state.sides.BACK, back);
  assert.deepEqual(before.sides.FRONT.image, null);
});

test('printed editing and confirmation fail until a correctly bound actual prepared frame exists', () => {
  let state = initial();
  assert.throws(() => preparationBase(state, 'FRONT'), code('ATLAS_GEOMETRY_PHYSICAL_REQUIRED'));
  assert.throws(() => edit(state, 'FRONT', 'PRINTED'), code('ATLAS_GEOMETRY_PREPARED_FRAME_REQUIRED'));
  state = edit(state, 'FRONT', 'PHYSICAL');
  assert.equal(geometryStatus(state).sides.FRONT.stage, 'PREPARATION');
  assert.throws(() => edit(state, 'FRONT', 'PRINTED'), code('ATLAS_GEOMETRY_PREPARED_FRAME_REQUIRED'));
  assert.throws(() => confirmBothGeometry(state, confirmation(state)), code('ATLAS_GEOMETRY_NOT_READY'));
  state = applyPreparedFrame(state, prepareAction(state, 'FRONT')).state;
  assert.equal(geometryStatus(state).sides.FRONT.stage, 'PRINTED');
  assert.equal(state.sides.FRONT.printed, null);
});

test('Front printed correction uses existing raw centering/scoring and preserves prepared pixels, Back confirmation and inspection eligibility', () => {
  const state = ready(), confirmed = confirmBothGeometry(state, confirmation(state)).state;
  const old = clone(confirmed), result = applyGeometryEdit(confirmed, editAction(confirmed, 'FRONT', 'PRINTED', adjusted));
  assert.deepEqual(confirmed, old);
  assert.deepEqual(result.state.sides.BACK, old.sides.BACK);
  assert.deepEqual(result.state.sides.FRONT.prepared, old.sides.FRONT.prepared);
  assert.deepEqual(result.state.sides.FRONT.physical, old.sides.FRONT.physical);
  assert.equal(result.state.sides.FRONT.confirmation, null);
  assert.equal(result.state.reportRevision, old.reportRevision + 1);
  assert.deepEqual(result.invalidated, { sides: { FRONT: ['centering', 'geometryReview'], BACK: [] }, report: true });
  const expected = measureSpeedsterCenteringBorders(adjusted);
  assert.deepEqual(result.state.sides.FRONT.printed.centering.borders, expected);
  assert.equal(result.state.sides.FRONT.printed.centering.score, calculateCenteringScore(expected));
  approximately(geometryStatus(result.state).centeringScore,
    (result.state.sides.FRONT.printed.centering.score * 7 + old.sides.BACK.printed.centering.score * 3) / 10);
});

test('Front physical correction invalidates only dependent Front work and report; original and all Back work survive', () => {
  const state = ready(), before = clone(state);
  const changed = physical.map(p => ({ x: p.x + 0.01, y: p.y }));
  const result = applyGeometryEdit(state, editAction(state, 'FRONT', 'PHYSICAL', changed));
  assert.deepEqual(state, before);
  assert.deepEqual(result.state.sides.FRONT.image, before.sides.FRONT.image);
  assert.deepEqual(result.state.sides.BACK, before.sides.BACK);
  assert.equal(result.state.sides.FRONT.prepared, null);
  assert.equal(result.state.sides.FRONT.printed, null);
  assert.equal(result.state.sides.FRONT.confirmation, null);
  assert.equal(geometryStatus(result.state).sides.FRONT.stage, 'PREPARATION');
  assert.ok(result.invalidated.sides.FRONT.includes('inspection'));
  assert.ok(result.invalidated.sides.FRONT.includes('mapRegistration'));
  assert.deepEqual(result.invalidated.sides.BACK, []);
});

test('invalid, reversed, crossing, concave and nonfinite quads cannot change either side', () => {
  const state = ready(), snapshot = serializeGeometryWorkspace(state);
  for (const quad of [physical.slice(0, 3), [...physical].reverse(), [physical[0], physical[2], physical[1], physical[3]],
    physical.map((p, i) => i ? p : { x: NaN, y: p.y }),
    physical.map((p, i) => i ? p : { x: -0.01, y: p.y }),
    physical.map((p, i) => i ? p : { ...p, hidden: true })]) {
    assert.throws(() => edit(state, 'FRONT', 'PHYSICAL', quad), code('ATLAS_GEOMETRY_QUAD_INVALID'));
    assert.equal(serializeGeometryWorkspace(state), snapshot);
  }
  const concave = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.3, y: 0.3 }, { x: 0.1, y: 0.9 }];
  assert.throws(() => edit(state, 'FRONT', 'PHYSICAL', concave), code('ATLAS_GEOMETRY_QUAD_INVALID'));
});

test('borderless and a zero-width border axis remain unmeasurable, without an invented perfect grade', () => {
  const state = ready();
  const noHorizontal = [{ x: 0, y: 0.04 }, { x: 1, y: 0.04 }, { x: 1, y: 0.96 }, { x: 0, y: 0.96 }];
  for (const quad of [whole, noHorizontal]) {
    assert.throws(() => edit(state, 'FRONT', 'PRINTED', quad), code('ATLAS_GEOMETRY_CENTERING_UNMEASURABLE'));
  }
  assert.equal(geometryStatus(state).reportApproval, false);
});

test('stale proposals remain stale after reload and edit-and-undo to identical physical or printed coordinates', () => {
  for (const kind of ['PHYSICAL', 'PRINTED']) {
    let state = ready();
    const stale = editAction(state, 'FRONT', kind, kind === 'PHYSICAL' ? physical : printed, 'ASTRA', { id: 'old-proposal', ambiguous: false });
    state = edit(state, 'FRONT', kind, kind === 'PHYSICAL' ? physical.map(p => ({ x: p.x + 0.01, y: p.y })) : adjusted);
    state = edit(state, 'FRONT', kind, kind === 'PHYSICAL' ? physical : printed);
    state = parseGeometryWorkspace(serializeGeometryWorkspace(state));
    assert.throws(() => applyGeometryEdit(state, stale), code('ATLAS_GEOMETRY_STALE'));
  }
});

test('unrelated Back work permits a still-current Front result, but first accepted result fences competing Front results', () => {
  let state = ready();
  const first = editAction(state, 'FRONT', 'PRINTED', adjusted, 'ENGINE', { id: 'one', ambiguous: true });
  const later = editAction(state, 'FRONT', 'PRINTED', printed, 'ENGINE', { id: 'two', ambiguous: false });
  state = edit(state, 'BACK', 'PRINTED', adjusted);
  state = applyGeometryEdit(state, first).state;
  assert.equal(state.sides.FRONT.printed.proposal.id, 'one');
  assert.equal(geometryStatus(state).sides.FRONT.ambiguous, true);
  assert.throws(() => applyGeometryEdit(state, later), code('ATLAS_GEOMETRY_STALE'));
});

test('late preparation is rejected after physical changes, newer preparation, printed edits, or explicit human review', () => {
  const state = ready();
  const pending = prepareAction(state, 'FRONT');
  const physicalChanged = edit(state, 'FRONT', 'PHYSICAL', physical.map(p => ({ x: p.x + 0.01, y: p.y })));
  const newer = applyPreparedFrame(state, pending).state;
  const printedChanged = edit(state, 'FRONT', 'PRINTED', adjusted);
  const confirmed = confirmBothGeometry(state, confirmation(state)).state;
  for (const current of [physicalChanged, newer, printedChanged, confirmed]) {
    assert.throws(() => applyPreparedFrame(current, pending), code('ATLAS_GEOMETRY_STALE'));
  }
  const backChanged = edit(state, 'BACK', 'PRINTED', adjusted);
  assert.doesNotThrow(() => applyPreparedFrame(backChanged, pending));
});

test('late physical proposals cannot erase newer prepared or printed work on the same side', () => {
  const state = ready();
  const proposal = editAction(state, 'FRONT', 'PHYSICAL', physical, 'ENGINE', { id: 'physical-refresh', ambiguous: false });
  const printedChanged = edit(state, 'FRONT', 'PRINTED', adjusted);
  const preparedChanged = applyPreparedFrame(state, prepareAction(state, 'FRONT')).state;
  for (const current of [printedChanged, preparedChanged]) {
    assert.throws(() => applyGeometryEdit(current, proposal), code('ATLAS_GEOMETRY_STALE'));
  }
});

test('atomic confirm-both accepts reviewed ambiguous proposals, rejects every automatic confirmation and fences old machine edits', () => {
  let state = ready();
  state = applyGeometryEdit(state, editAction(state, 'FRONT', 'PRINTED', printed, 'ENGINE', { id: 'ambiguous-outline', ambiguous: true })).state;
  const old = clone(state), staleMachine = editAction(state, 'FRONT', 'PHYSICAL', physical, 'ASTRA', { id: 'in-flight', ambiguous: false });
  for (const actor of ['ASTRA', 'ENGINE']) assert.throws(() => confirmBothGeometry(state, confirmation(state, actor)), code('ATLAS_GEOMETRY_HUMAN_REVIEW_REQUIRED'));
  assert.throws(() => confirmBothGeometry(state, confirmation(state, 'HUMAN', false)), code('ATLAS_GEOMETRY_HUMAN_REVIEW_REQUIRED'));
  const confirmed = confirmBothGeometry(state, confirmation(state)).state;
  assert.deepEqual(state, old);
  assert.equal(geometryStatus(confirmed).confirmed, true);
  assert.equal(geometryStatus(confirmed).reportApproval, false);
  assert.equal(confirmed.sides.FRONT.printed.proposal.ambiguous, true);
  assert.throws(() => applyGeometryEdit(confirmed, staleMachine), code('ATLAS_GEOMETRY_STALE'));
  assert.deepEqual(parseGeometryWorkspace(serializeGeometryWorkspace(confirmed)), confirmed);
});

test('one stale side rejects confirm-both without partially confirming Front', () => {
  const state = ready(), action = confirmation(state);
  const changed = edit(state, 'BACK', 'PRINTED', adjusted), before = serializeGeometryWorkspace(changed);
  assert.throws(() => confirmBothGeometry(changed, action), code('ATLAS_GEOMETRY_STALE'));
  assert.equal(serializeGeometryWorkspace(changed), before);
  assert.equal(changed.sides.FRONT.confirmation, null);
  assert.equal(changed.sides.BACK.confirmation, null);
});

test('photo replacement and its original/frame hashes invalidate old geometry even if pixels or coordinates are equal', () => {
  const state = ready(), stale = editAction(state, 'FRONT', 'PRINTED', adjusted);
  const replacement = replaceGeometryImage(state, { side: 'FRONT', base: geometryBase(state, 'FRONT', 'IMAGE'), image: image('FRONT', 2) });
  assert.equal(replacement.state.sides.FRONT.physical, null);
  assert.equal(replacement.state.sides.FRONT.prepared, null);
  assert.equal(replacement.state.sides.FRONT.printed, null);
  assert.deepEqual(replacement.state.sides.BACK, state.sides.BACK);
  assert.throws(() => applyGeometryEdit(replacement.state, stale), code('ATLAS_GEOMETRY_STALE'));
  const forged = JSON.parse(serializeGeometryWorkspace(state)); forged.sides.FRONT.image.originalSha256 = hash('9');
  assert.throws(() => parseGeometryWorkspace(forged), code('ATLAS_GEOMETRY_STALE'));
  assert.throws(() => replaceGeometryImage(state, { side: 'FRONT', base: geometryBase(state, 'FRONT', 'IMAGE'), image: image('FRONT', 1) }), code('ATLAS_GEOMETRY_IMAGE_VERSION_INVALID'));
});

test('mat/shape changes stale proposal review but retain exact warp pixels; only shape invalidates material measurement', () => {
  let state = ready();
  const pending = prepareAction(state, 'FRONT'), oldProposal = editAction(state, 'FRONT', 'PHYSICAL', physical);
  const mat = updateGeometrySettings(state, { side: 'FRONT', base: geometryBase(state, 'FRONT', 'SETTINGS'), cornerShape: state.sides.FRONT.cornerShape, matColor: 'WHITE' });
  assert.deepEqual(mat.state.sides.FRONT.prepared, state.sides.FRONT.prepared);
  assert.deepEqual(mat.invalidated.sides.FRONT, ['geometryProposals', 'geometryReview']);
  assert.throws(() => applyGeometryEdit(mat.state, oldProposal), code('ATLAS_GEOMETRY_STALE'));
  assert.doesNotThrow(() => applyPreparedFrame(mat.state, pending));
  state = mat.state;
  const shape = updateGeometrySettings(state, { side: 'FRONT', base: geometryBase(state, 'FRONT', 'SETTINGS'), cornerShape: 'SQUARE', matColor: 'WHITE' });
  assert.deepEqual(shape.state.sides.FRONT.prepared, state.sides.FRONT.prepared);
  assert.deepEqual(shape.state.sides.BACK, state.sides.BACK);
  assert.ok(shape.invalidated.sides.FRONT.includes('material'));
  assert.ok(shape.invalidated.sides.FRONT.includes('measurement'));
});

test('preparation rejects wrong frame size, inspection crop, frame version, singular or unrelated transforms', () => {
  const state = edit(initial(), 'FRONT', 'PHYSICAL'), good = prepareAction(state, 'FRONT');
  const cases = [
    a => { a.frame.rectified.width = 1600; },
    a => { a.frame.inspection.cardBounds.x = 0; },
    a => { a.frame.inspection.height = 1778; },
    a => { a.frame.rectified.sha256 = a.frame.inspection.sha256; },
    a => { a.frame.rectified.sha256 = a.base.image.frameSha256; },
    a => { a.frame.version += 1; },
    a => { a.frame.sourceToRectified = [1, 0, 0, 0, 1, 0, 0, 0, 1]; },
    a => { a.frame.sourceToRectified = Array(9).fill(0); },
    a => { a.frame.sourceToRectified[0] = Infinity; },
    a => { a.base.image.frameId = 'different-orientation'; },
    a => { a.base.side = 'BACK'; },
    a => { a.base.image.originalSha256 = hash('0'); },
  ];
  for (const mutate of cases) { const action = clone(good); mutate(action); assert.throws(() => applyPreparedFrame(state, action)); }
  assert.equal(state.sides.FRONT.prepared, null);
});

test('pixel extent and width-minus-one conventions are distinct; crop/orientation occurs once before geometry', () => {
  let state = edit(initial(), 'FRONT', 'PHYSICAL');
  const action = prepareAction(state, 'FRONT'), wrong = clone(action);
  // This superficially similar matrix assumes normalized original quads use
  // W-1/H-1. Existing CPU preparation instead uses W/H.
  const w = 1599, h = 2399, sx = 1269 / (0.75 * w), sy = 1777 / (0.8 * h);
  wrong.frame.sourceToRectified = [sx, 0, -0.125 * w * sx, 0, sy, -0.1 * h * sy, 0, 0, 1];
  assert.throws(() => applyPreparedFrame(state, wrong), code('ATLAS_GEOMETRY_TRANSFORM_MISMATCH'));
  state = applyPreparedFrame(state, action).state;
  const corner = originalPointToPrepared(state, 'FRONT', physical[2]);
  approximately(corner.x, 1269 / 1270); approximately(corner.y, 1777 / 1778);
  const orientation = orientationTransform(2600, 1800, 6, { x: 100, y: 100, width: 2400, height: 1600 });
  assert.deepEqual([orientation.width, orientation.height], [1600, 2400]);
  // An encoded/cropped pixel rotates to decoded (200,240), the physical TL.
  const oriented = transformPoint(orientation.matrix, { x: 340, y: 1499 });
  assert.deepEqual(oriented, { x: 200, y: 240 });
  const point = originalPointToPrepared(state, 'FRONT', { x: oriented.x / 1600, y: oriented.y / 2400 });
  approximately(point.x, 0); approximately(point.y, 0);
  state = edit(state, 'FRONT', 'PRINTED');
  const projected = printedQuadOnOriginal(state, 'FRONT');
  projected.forEach((p, index) => {
    const restored = originalPointToPrepared(state, 'FRONT', p);
    approximately(restored.x, printed[index].x); approximately(restored.y, printed[index].y);
  });
  approximately(projected[0].x, (printed[0].x * 1270 / action.frame.sourceToRectified[0] + 200) / 1600);
});

test('projective transform preserves a skewed card instead of replacing it with a bounding rectangle', () => {
  // Known projective mapping from card-map pixels to oriented source pixels.
  const inverse = [0.9, 0.05, 150, 0.03, 1.1, 180, 0.00002, 0.00001, 1];
  const [a,b,c,d,e,f,g,h,i] = inverse, det = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  const forward = [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(n => n/det);
  const corners = [{ x: 0, y: 0 }, { x: 1269, y: 0 }, { x: 1269, y: 1777 }, { x: 0, y: 1777 }];
  const quad = corners.map(p => { const q = transformPoint(inverse, p); return { x: q.x / 1600, y: q.y / 2400 }; });
  let state = edit(initial(), 'FRONT', 'PHYSICAL', quad), action = prepareAction(state, 'FRONT');
  action.frame.sourceToRectified = forward;
  state = applyPreparedFrame(state, action).state;
  const expected = { x: 0.63, y: 0.41 }, original = preparedPointToOriginal(state, 'FRONT', expected);
  const actual = originalPointToPrepared(state, 'FRONT', original);
  approximately(actual.x, expected.x); approximately(actual.y, expected.y);
});

test('rehydration validates derived centering, revision, source, printed-frame and exact human confirmation bindings', () => {
  const state = ready(), confirmed = confirmBothGeometry(state, confirmation(state)).state;
  const tamper = [
    s => { s.sides.FRONT.printed.centering.score = 10; },
    s => { s.sides.FRONT.printed.preparationVersion += 1; },
    s => { s.sides.FRONT.printed.frameSha256 = hash('0'); },
    s => { s.sides.FRONT.physical.revision = 0; },
    s => { s.sides.FRONT.prepared.source.physicalQuad[0].x += 0.1; },
    s => { s.sides.FRONT.confirmation.base.printedRevision -= 1; },
    s => { s.sides.FRONT.confirmation.actor = 'ASTRA'; },
    s => { s.sides.FRONT.prepared.frame.sourceToRectified[2] += 5; },
    s => { s.reportRevision = 1; },
    s => { s.sides.FRONT.printed.quad = whole; },
    s => { s.sides.FRONT.printed = null; },
    s => { s.sides.FRONT.prepared = null; },
    s => { s.sides.FRONT.unrecognized = true; },
  ];
  for (const mutate of tamper) { const bad = clone(confirmed); mutate(bad); assert.throws(() => parseGeometryWorkspace(JSON.stringify(bad))); }
  assert.deepEqual(parseGeometryWorkspace(serializeGeometryWorkspace(confirmed)), confirmed);
});

test('new core has only pure grading-core imports and no service, database, old operator or provider dependency', () => {
  const source = readFileSync(new URL('../src/geometry-actions.mjs', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.deepEqual(imports.sort(), ['@atlas/grading-core/geometry', '@atlas/grading-core/scoring']);
  assert.doesNotMatch(source, /\b(?:fetch|WebSocket|localStorage|indexedDB|process\.env)\b/);
});
