import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { reportFindingBounds, reportFindingEntries } from '../src/report-review-ui.mjs';
import { reportSpatialNavigation, reportCameraItinerary } from '../src/report-spatial-navigation.mjs';

function finding(id, side, x, y, extra = {}) {
  const canonicalContour = x === null ? [] : [{ x, y }, { x: x + .01, y },
    { x: x + .01, y: y + .01 }, { x, y: y + .01 }];
  return { id, side, defectType: 'WHITENING', reviewResult: 'ACCEPTED',
    measurementRegions: [{ zone: 'EDGES', canonicalContour, measurement: { areaMm2: .15 } }], ...extra };
}
function trace(pixels) {
  const bitmap = new Uint8Array(1270 * 1778);
  for (const [x, y] of pixels) bitmap[y * 1270 + x] = 1;
  return encodeSpeedsterTraceRleV1(bitmap);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const ids = entries => entries.map(entry => entry.id);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≈ ${b}`);

test('complete-report identity and per-side numbering survive grouping, filtering and removed/excluded findings', () => {
  const findings = freeze([
    finding('front-top', 'FRONT', .4, .001), finding('back-one', 'BACK', .5, .5),
    finding('removed', 'FRONT', .7, .7, { reviewResult: 'REMOVED' }),
    finding('front-left', 'FRONT', .001, .5),
    finding('excluded', 'FRONT', .8, .8, { geometryExclusion: { reason: 'outside card' } }),
  ]);
  const before = JSON.stringify(findings), result = reportSpatialNavigation(findings);
  assert.deepEqual(result.entries.map(({ finding, number, label, categories }) => ({ finding, number, label, categories })), reportFindingEntries(findings));
  assert.deepEqual(result.entries.map(entry => [entry.id, entry.number, entry.globalNumber]),
    [['front-top', 1, 1], ['back-one', 1, 2], ['front-left', 2, 3], ['excluded', 3, 4]]);
  assert.deepEqual(ids(result.neighborhoods.flatMap(group => group.entries)).sort(), ids(result.entries).sort());
  const excluded = result.neighborhoods.find(group => group.kind === 'unlocated');
  assert.deepEqual(ids(excluded.entries), ['excluded']); assert.equal(excluded.bounds, null);
  assert.equal(excluded.entries[0].finding, findings[4]);
  assert.deepEqual(result.entries.filter(entry => entry.finding.side === 'FRONT').map(entry => entry.globalNumber), [1, 3, 4]);
  assert.equal(JSON.stringify(findings), before);
  assert.deepEqual(reportSpatialNavigation(findings), result);
});

test('each side with at most two findings has individual stable targets; an empty side has none', () => {
  assert.deepEqual(reportSpatialNavigation([]), { entries: [], neighborhoods: [] });
  const findings = [finding('a/b', 'FRONT', .4, .01), finding('a:b', 'FRONT', .8, .01), finding('c', 'BACK', null, null)];
  const result = reportSpatialNavigation(findings);
  assert.deepEqual(result.neighborhoods.map(group => [group.id, group.kind, group.label, ids(group.entries)]), [
    ['FRONT:finding:a%2Fb', 'finding', 'Front 1', ['a/b']],
    ['FRONT:finding:a%3Ab', 'finding', 'Front 2', ['a:b']],
    ['BACK:finding:c', 'finding', 'Back 1', ['c']],
  ]);
  assert.equal(result.neighborhoods[2].bounds, null);
  assert.ok(reportSpatialNavigation(findings.slice(0, 2)).neighborhoods.every(group => group.side === 'FRONT'));
});

test('nonempty neighborhoods use saved trace geometry, never detector proposals or category labels', () => {
  const finalTrace = trace([[600, 0], [601, 0], [620, 8]]), detectorMask = trace([[1269, 900]]);
  const findings = freeze([
    finding('top-trace', 'BACK', .5, .5, { finalTrace, detectorMask }),
    finding('left', 'BACK', .001, .5), finding('right', 'BACK', .989, .5),
    finding('bottom', 'BACK', .5, .989), finding('middle', 'BACK', .5, .5),
  ]);
  const before = JSON.stringify(findings), result = reportSpatialNavigation(findings);
  assert.deepEqual(result.neighborhoods.map(group => [group.kind, ids(group.entries)]), [
    ['top', ['top-trace']], ['left', ['left']], ['right', ['right']], ['bottom', ['bottom']], ['interior', ['middle']],
  ]);
  const entry = result.entries[0];
  assert.deepEqual(entry.bounds, reportFindingBounds(findings[0]));
  assert.deepEqual(entry.bounds, { x: 600 / 1270, y: 0, width: 621 / 1270 - 600 / 1270, height: 9 / 1778 });
  assert.equal(entry.finding.finalTrace, finalTrace); assert.equal(entry.finding.detectorMask, detectorMask);
  assert.equal(entry.finding.measurementRegions, findings[0].measurementRegions);
  assert.equal(JSON.stringify(findings), before);
});

test('edge proximity uses equal canonical pixel distances and corner ties are deterministic', () => {
  // Outside the top cap: compare distances in canonical pixels.
  const result = reportSpatialNavigation([
    finding('left-nearer', 'FRONT', .06, .075), finding('corner-tie', 'FRONT', 0, 0),
    finding('inner', 'FRONT', .11, .11),
  ]);
  assert.deepEqual(result.neighborhoods.map(group => [group.kind, ids(group.entries)]), [
    ['top', ['corner-tie']], ['left', ['left-nearer']], ['interior', ['inner']],
  ]);
});

test('corner traces wholly inside end caps stay with top or bottom; a spanning trace uses nearest edge', () => {
  const result = reportSpatialNavigation([
    finding('lower-right', 'BACK', .98, .96), finding('upper-left', 'BACK', .001, .04),
    finding('long-right', 'BACK', .98, .7, { finalTrace: trace([[1268, 1200], [1268, 1730]]) }),
  ]);
  assert.deepEqual(result.neighborhoods.map(group => [group.kind, ids(group.entries)]), [
    ['top', ['upper-left']], ['right', ['long-right']], ['bottom', ['lower-right']],
  ]);
});

test('group camera envelopes include disconnected traces while original measurements remain distinct', () => {
  const first = finding('left-a', 'BACK', .5, .5, { finalTrace: trace([[0, 400], [10, 800]]) });
  const second = finding('left-b', 'BACK', .02, .65);
  const result = reportSpatialNavigation([first, second, finding('right', 'BACK', .98, .5)]);
  const left = result.neighborhoods.find(group => group.kind === 'left');
  assert.deepEqual(ids(left.entries), ['left-a', 'left-b']);
  near(left.bounds.x, 0); near(left.bounds.y, 400 / 1778);
  near(left.bounds.width, .03); near(left.bounds.height, .66 - 400 / 1778);
  assert.equal(left.entries[0].finding, first); assert.equal(left.entries[1].finding, second);
  assert.equal('measurement' in left, false); assert.equal('grade' in left, false);
  assert.notEqual(left.entries[0].finding.measurementRegions, left.entries[1].finding.measurementRegions);
});

test('missing, invalid and excluded display geometry stays reachable without invented locations', () => {
  const findings = [finding('missing', 'FRONT', null, null),
    finding('invalid', 'FRONT', NaN, .5), finding('outside', 'FRONT', 2, .5),
    finding('excluded', 'FRONT', .5, .5, { geometryExclusion: true, finalTrace: trace([[100, 100]]) })];
  const result = reportSpatialNavigation(findings);
  assert.equal(result.neighborhoods.length, 1);
  assert.equal(result.neighborhoods[0].label, 'Location unavailable');
  assert.equal(result.neighborhoods[0].bounds, null);
  assert.deepEqual(ids(result.neighborhoods[0].entries), findings.map(f => f.id));
  assert.ok(result.entries.every(entry => entry.bounds === null));
});

test('camera returns whole-card retreat, location pause and exact target without sharing mutable views', () => {
  const from = freeze({ zoom: 8, pan: { x: 150, y: -300 } }), to = freeze({ zoom: 12, pan: { x: -220, y: 950 } });
  const steps = reportCameraItinerary(from, to), whole = { zoom: 1, pan: { x: 0, y: 0 } };
  assert.deepEqual(steps.map(step => step.phase), ['retreat', 'locate', 'approach']);
  assert.deepEqual(steps.map(step => step.view), [whole, whole, to]);
  assert.ok(steps.every(step => step.duration > 0));
  assert.ok(steps[1].duration < steps[0].duration && steps[1].duration < steps[2].duration);
  assert.notEqual(steps[0].view, steps[1].view); assert.notEqual(steps[0].view.pan, steps[1].view.pan);
  assert.notEqual(steps[2].view, to); assert.notEqual(steps[2].view.pan, to.pan);
  steps[0].view.pan.x = 999; steps[2].view.pan.y = 999;
  assert.deepEqual(steps[1].view, whole); assert.equal(to.pan.y, 950); assert.equal(from.pan.x, 150);
});

test('whole-card/new-side starts avoid retreat; reduced motion goes directly to the copied target', () => {
  const to = { zoom: 10, pan: { x: -200, y: 400 } };
  for (const [from, options] of [[{ zoom: 1, pan: { x: 0, y: 0 } }, {}],
    [{ zoom: 1.05, pan: { x: 5, y: 5 } }, {}], [{ zoom: 16, pan: { x: 800, y: -900 } }, { sideChanged: true }]]) {
    const steps = reportCameraItinerary(from, to, options);
    assert.deepEqual(steps.map(step => step.phase), ['locate', 'approach']);
    assert.deepEqual(steps[0].view, { zoom: 1, pan: { x: 0, y: 0 } }); assert.equal(steps[0].duration, 0);
    assert.deepEqual(steps[1].view, to); assert.ok(steps[1].duration > 0);
  }
  const direct = reportCameraItinerary({ zoom: 12, pan: { x: 5, y: 9 } }, to, { reducedMotion: true, sideChanged: true });
  assert.equal(direct.length, 1); assert.equal(direct[0].phase, 'approach'); assert.equal(direct[0].duration, 0);
  assert.deepEqual(direct[0].view, to); assert.notEqual(direct[0].view.pan, to.pan);
});
