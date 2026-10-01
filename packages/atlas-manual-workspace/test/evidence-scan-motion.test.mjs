import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { evidenceShapes, adaptiveEvidenceScale, breathingEvidenceScale, createEvidenceMotion } from '../src/evidence-scan-motion.mjs';
import { createEdgeTour, sampleEdgeTour, edgeVisitedRects, edgeCamera, edgeCameraFrame, edgeContact, EDGE_STRIP } from '../src/evidence-edge-tour.mjs';
const fixture = JSON.parse(readFileSync(new URL('../../../docs/atlas/design/first-look/reports/approved.json', import.meta.url))).reports.find(report => report.key === 'maye');
const findings = fixture.packet.report.findings;
const before = JSON.stringify(fixture);

test('separated evidence preserves all seven saved silhouettes, holes, categories and immutable packet', () => {
  const shapes = evidenceShapes(findings);
  assert.equal(shapes.length, 7);
  const expected = [62, 98, 43, 110, 126, 4930, 566];
  for (const [i, shape] of shapes.entries()) {
    const cells = new Set();
    for (const match of shape.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+Z/g)) {
      const [, x, y, width] = match.map(Number);
      for (let offset = 0; offset < width; offset++) cells.add(`${x + offset}:${y}`);
    }
    assert.equal(cells.size, expected[i]);
    assert.equal(shape.finding, findings[i]);
  }
  assert.deepEqual(evidenceShapes([{ ...findings[0], reviewResult: 'REMOVED' }]), []);
  assert.deepEqual(evidenceShapes([{ ...findings[0], geometryExclusion: { reason: 'old frame' } }]), []);
  assert.equal(JSON.stringify(fixture), before);
});

test('small shapes reach 10x while the 201px trace has a visible bounded four-second breath', () => {
  const shapes = evidenceShapes(findings);
  assert.equal(adaptiveEvidenceScale(shapes[0].bounds), 10);
  const long = shapes[5].bounds;
  assert.ok(Math.abs(adaptiveEvidenceScale(long) - 1.326865671641791) < 1e-9);
  assert.equal(breathingEvidenceScale(long, 0), 1);
  assert.equal(breathingEvidenceScale(long, 4000), 1);
  assert.ok(Math.abs(breathingEvidenceScale(long, 2000) * 201 - .15 * 1778) < 1e-9);
  assert.ok(adaptiveEvidenceScale({ width: 1, height: 1 }) > 1, 'already-large traces retain gentle motion');
});

test('edge discovery uses only saved pixels intersecting the 2.5mm strip and travels the whole perimeter', () => {
  assert.equal(EDGE_STRIP.widthPx / EDGE_STRIP.pixelsPerMm, 2.5);
  const plan = createEdgeTour(findings);
  assert.deepEqual(plan.hits.map(hit => hit.finding.id).sort(), [findings[1].id, findings[4].id, findings[6].id].sort());
  assert.equal(edgeContact(findings[5]), null, 'near-corner long surface trace is outside the narrow edge strip');
  assert.equal(plan.segments.filter(segment => segment.kind === 'inspect').length, 3);
  for (const s of plan.segments.filter(segment => segment.kind === 'inspect')) assert.equal(s.end - s.start, 3.5);
  assert.deepEqual(edgeVisitedRects(0), []);
  assert.deepEqual(edgeVisitedRects(1), [
    { x: 40, y: 40, width: 1270, height: 50 }, { x: 1260, y: 40, width: 50, height: 1778 },
    { x: 40, y: 1768, width: 1270, height: 50 }, { x: 40, y: 40, width: 50, height: 1778 },
  ]);
  const early = sampleEdgeTour(plan, .23);
  sampleEdgeTour(plan, .75);
  assert.deepEqual(sampleEdgeTour(plan, .23), early, 'reverse scrubbing is pure and deterministic');
  assert.equal(sampleEdgeTour(plan, 1).route, 1);
  assert.equal(JSON.stringify(fixture), before);
});

test('portrait and desktop tour cameras never expose invented pixels outside the photograph', () => {
  const plan = createEdgeTour(findings);
  for (const [width, height] of [[320, 440], [390, 520], [630, 700]]) for (let i = 0; i <= 2000; i++) {
    const c = edgeCamera(sampleEdgeTour(plan, i / 2000), width, height);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.width <= 1350 + 1e-9 && c.y + c.height <= 1858 + 1e-9);
  }
});

test('timeline scrubbing pauses, resumes from that position, ends and cancels without stale frames', () => {
  const frames = new Map(); let id = 0;
  const controller = createEvidenceMotion({ request: fn => { frames.set(++id, fn); return id; }, cancel: key => frames.delete(key) });
  const tick = time => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)); };
  const observed = []; controller.subscribe(state => observed.push(state));
  controller.configure({ durationMs: 10000, linear: true }); controller.play(); tick(0); tick(2000);
  assert.equal(controller.snapshot().progress, .2);
  controller.set({ progress: .6 }); assert.equal(controller.snapshot().playing, false); assert.equal(frames.size, 0);
  controller.play(); tick(3000); tick(5000); assert.equal(controller.snapshot().progress, .8);
  tick(7000); assert.equal(controller.snapshot().progress, 1); assert.equal(controller.snapshot().playing, false);
  controller.configure({ reduced: true }); controller.play(0); assert.equal(controller.snapshot().progress, 0); assert.equal(frames.size, 0);
  controller.configure({ reduced: false }); controller.play(); controller.dispose(); assert.equal(frames.size, 0);
  assert.ok(observed.length > 5);
});

test('instrument projection matches SVG meet letterboxing for image-bound full-width damage', () => {
  const camera = edgeCamera({ x: 675, y: 929, size: 2500 }, 630, 700);
  const frame = edgeCameraFrame(camera, 630, 700);
  assert.equal(camera.width, 1350); assert.equal(camera.height, 1858);
  assert.equal(frame.scale, 700 / 1858);
  assert.ok(frame.offsetX > 0); assert.equal(frame.offsetY, 0);
  assert.equal(frame.offsetX + camera.width / 2 * frame.scale, 315);
  assert.equal(frame.offsetY + camera.height / 2 * frame.scale, 350);
});

