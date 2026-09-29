import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FINGERPRINT_VERSION, FINGERPRINT_GOLD, fingerprintSource, fingerprintUnionSpans,
  fingerprintFieldSteps, fingerprintSampleSteps, scheduleFingerprint, paintFingerprintPixels, animateFingerprint } from '../src/report-fingerprint.mjs';
import { workspace } from './defect-fixtures.mjs';

const finish = iterator => { let step; do { step = iterator.next(); } while (!step.done); return step.value; };
const field = spans => finish(fingerprintFieldSteps(fingerprintUnionSpans(spans, 8, 9), 8, 9));
const digest = array => createHash('sha256').update(new Uint8Array(array.buffer)).digest('hex');

test('native pixel-center field agrees with independent brute-force distances, including holes and ties', () => {
  const spans = [{ x: 1, y: 2, width: 2 }, { x: 5, y: 6, width: 2 }, { x: 1, y: 4, width: 2 }];
  const actual = field(spans), points = spans.flatMap(span => Array.from({ length: span.width }, (_, i) => [span.x + i, span.y]));
  for (let y = 0; y < 9; y++) for (let x = 0; x < 8; x++) assert.equal(actual.dist[y * 8 + x], Math.fround(Math.min(...points.map(([px, py]) => Math.hypot(px - x, py - y)))));
  assert.equal(actual.dist[3 * 8 + 1], 1, 'unmarked hole remains unmarked');
});

test('ordering, duplicate and split traces produce the same artwork; size and location matter', () => {
  const base = [{ x: 1, y: 2, width: 4 }, { x: 4, y: 5, width: 2 }];
  const split = [base[1], { x: 3, y: 2, width: 2 }, { x: 1, y: 2, width: 2 }, base[1]];
  assert.deepEqual(fingerprintUnionSpans(base), fingerprintUnionSpans(split));
  assert.equal(digest(field(base).dist), digest(field(split).dist));
  assert.notEqual(digest(field(base).dist), digest(field([{ x: 1, y: 2, width: 3 }, base[1]]).dist));
  assert.notEqual(digest(field(base).dist), digest(field([{ x: 2, y: 2, width: 4 }, base[1]]).dist));
  assert.equal(FINGERPRINT_VERSION, 'atlas-mask-tide-pixel-centers-v1');
});

test('report source preserves immutable evidence and isolates side without identity/grade decoration', () => {
  const state = workspace(), findings = Object.entries(state.sides).flatMap(([side, slot]) => slot.findings.map(f => ({ ...f, side })));
  const before = structuredClone(findings), original = fingerprintSource(findings, 'FRONT');
  assert.ok(original.spans.length);
  const renamed = fingerprintSource(findings.map(f => ({ ...f, id: `other-${f.id}`, grade: 1, cardName: 'unrelated' })).reverse(), 'FRONT');
  assert.equal(original.key, renamed.key);
  const mirroredDomain = fingerprintSource(findings.filter(f => f.side === 'FRONT').map(f => ({ ...f, side: 'BACK' })), 'BACK');
  assert.deepEqual(original.spans, mirroredDomain.spans); assert.notEqual(original.key, mirroredDomain.key);
  assert.deepEqual(findings, before);
});

test('zero findings, removed traces and unavailable masks never manufacture a fingerprint', () => {
  assert.equal(finish(fingerprintFieldSteps([])), null);
  assert.deepEqual(fingerprintSource([], 'FRONT').spans, []);
  assert.equal(fingerprintSource([{ side: 'FRONT', reviewResult: 'REMOVED' }], 'FRONT').count, 0);
  const missing = fingerprintSource([{ side: 'FRONT', geometryExclusion: true }], 'FRONT');
  assert.equal(missing.unavailable, 1); assert.deepEqual(missing.spans, []);
  assert.throws(() => fingerprintUnionSpans([{ x: 1269, y: 1, width: 2 }]), /Invalid/);
});

test('bilinear samples and gold pixels freeze the approved study formula without per-frame allocation', () => {
  const measured = field([{ x: 0, y: 0, width: 1 }]);
  const sampled = finish(fingerprintSampleSteps(measured, 16, 18));
  assert.equal(sampled.samples[0], 0);
  const pixels = new Uint8ClampedArray(sampled.samples.length * 4);
  paintFingerprintPixels(pixels, sampled, 1); assert.deepEqual([...pixels.slice(4, 7)], FINGERPRINT_GOLD);
  const expected = digest(pixels); paintFingerprintPixels(pixels, sampled, 1); assert.equal(digest(pixels), expected);
  paintFingerprintPixels(pixels, sampled, 0); assert.ok(pixels.every((v, index) => index % 4 !== 3 || v === 0));
});

test('field calculation yields bounded work and cancellation prevents stale completion', async () => {
  const queue = new Map(); let id = 0, steps = 0, finalized = false;
  const iterator = (function* () { try { while (steps < 100) { steps++; yield; } return 'done'; } finally { finalized = true; } })();
  const controller = new AbortController();
  const promise = scheduleFingerprint(iterator, { signal: controller.signal, now: () => 0,
    schedule: fn => { queue.set(++id, fn); return id; }, unschedule: key => queue.delete(key) });
  const first = queue.get(1); queue.delete(1); first(); assert.equal(steps, 16);
  controller.abort(); await assert.rejects(promise, { name: 'AbortError' }); assert.equal(queue.size, 0); assert.equal(finalized, true);
});

test('scheduled field equals direct field and an already cancelled request does no work', async () => {
  const spans = [{ x: 3, y: 4, width: 2 }];
  assert.deepEqual(await scheduleFingerprint(fingerprintFieldSteps(spans, 8, 9)), field(spans));
  const controller = new AbortController(); controller.abort(); let ran = false;
  await assert.rejects(scheduleFingerprint((function* () { ran = true; yield; })(), { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(ran, false);
});

test('tide finishes once, interrupted frames cannot paint, and reduced motion is a direct state', () => {
  let id = 0, complete = 0; const frames = new Map(), values = [];
  const options = { paint: v => values.push(v), complete: () => complete++, request: fn => { frames.set(++id, fn); return id; }, cancel: key => frames.delete(key) };
  const runFrame = time => { const saved = [...frames]; frames.clear(); saved.forEach(([, fn]) => fn(time)); };
  animateFingerprint(options); runFrame(0); runFrame(850); runFrame(1700);
  assert.deepEqual(values, [0, .5, 1]); assert.equal(complete, 1); assert.equal(frames.size, 0);
  const cancel = animateFingerprint({ ...options, target: 0, from: 1 }); const stale = [...frames.values()][0]; cancel(); stale(9000);
  assert.equal(frames.size, 0); assert.equal(values.at(-1), 1); assert.equal(complete, 1);
  animateFingerprint({ ...options, reducedMotion: true, target: 0 }); assert.equal(values.at(-1), 0); assert.equal(complete, 2); assert.equal(frames.size, 0);
});
