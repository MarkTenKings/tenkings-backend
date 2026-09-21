import test from 'node:test';
import assert from 'node:assert/strict';
import { fitInspectionScale, clampInspectionPan, zoomInspectionAt, focusInspectionBounds,
  canonicalInspectionPoint } from '../src/inspection-viewport.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
const viewport = { width: 707, height: 961 }; // 1350×1858 at half size, with 16px on every side.

test('Fit retains the entire padded inspection image and an additional viewport gutter', () => {
  assert.equal(fitInspectionScale({ width: 1382, height: 1890 }), 1);
  assert.equal(fitInspectionScale(viewport), .5);
  assert.equal(fitInspectionScale({ width: 707, height: 2000 }), .5, 'narrower dimension controls fit');
  assert.equal(fitInspectionScale({ width: 2000, height: 961 }), .5, 'shorter dimension controls fit');
  const fitPan = clampInspectionPan({ x: 100, y: -100 }, 1, viewport);
  near(fitPan.x, 0); near(fitPan.y, 0);
});

test('full inspection bounds map the padded card to canonical pixel endpoints', () => {
  const image = { left: 100, top: 200, width: 675, height: 929 };
  assert.deepEqual(canonicalInspectionPoint({ x: 120, y: 220 }, image), { x: 0, y: 0 });
  assert.deepEqual(canonicalInspectionPoint({ x: 755, y: 1109 }, image), { x: 1269, y: 1777 });
  assert.deepEqual(canonicalInspectionPoint({ x: 437.5, y: 664.5 }, image), { x: 635, y: 889 });
  // Quarter-card positions: 40px padding + 317.5/444.5px, rendered at half size.
  assert.deepEqual(canonicalInspectionPoint({ x: 278.75, y: 442.25 }, image), { x: 317, y: 444 });
});

test('context margin and missing image rectangles cannot create false edge trace points', () => {
  const image = { left: 100, top: 200, width: 675, height: 929 };
  for (const point of [{ x: 119.9, y: 664.5 }, { x: 755.1, y: 664.5 },
    { x: 437.5, y: 219.9 }, { x: 437.5, y: 1109.1 }, { x: 101, y: 201 }]) {
    assert.equal(canonicalInspectionPoint(point, image), null);
  }
  assert.equal(canonicalInspectionPoint({ x: 10, y: 10 }, null), null);
  assert.equal(canonicalInspectionPoint({ x: 10, y: 10 }, { width: 0, height: 0 }), null);
});

test('pointer coordinates remain canonical after an independently positioned fourfold image', () => {
  // Full image doubled from native pixels and translated: canonical25% becomes
  // (40+317.5, 40+444.5) in the inspection, then ×2 plus(-930,-1700).
  const image = { left: -930, top: -1700, width: 2700, height: 3716 };
  assert.deepEqual(canonicalInspectionPoint({ x: -215, y: -731 }, image), { x: 317, y: 444 });
  assert.deepEqual(canonicalInspectionPoint({ x: 420, y: 158 }, image), { x: 635, y: 889 });
  assert.equal(canonicalInspectionPoint({ x: -852, y: 158 }, image), null);
});

test('cursor-centered zoom preserves the point under the cursor and clamps zoom limits', () => {
  const original = { zoom: 2, pan: { x: 20, y: -30 } }, anchor = { x: 200, y: 300 };
  const changed = zoomInspectionAt(original, 4, anchor, viewport);
  assert.equal(changed.zoom, 4); near(changed.pan.x, 193.5); near(changed.pan.y, 120.5);
  // These coordinates are derived from the rendered image centers, independently
  // of the helper: initial scale1, final scale2, centers(373.5,450.5)/(547,601).
  near((200 - 373.5) / 1, (200 - 547) / 2);
  near((300 - 450.5) / 1, (300 - 601) / 2);
  assert.equal(zoomInspectionAt(original, 100, anchor, viewport).zoom, 16);
  const fitted = zoomInspectionAt(original, .1, anchor, viewport);
  assert.equal(fitted.zoom, 1); near(fitted.pan.x, 0); near(fitted.pan.y, 0);
});

test('pan cannot move all image content out of view, including at maximum zoom', () => {
  assert.deepEqual(clampInspectionPan({ x: 1e6, y: -1e6 }, 2, viewport), { x: 337.5, y: -464.5 });
  assert.deepEqual(clampInspectionPan({ x: 1e6, y: -1e6 }, 16, viewport), { x: 5062.5, y: -6967.5 });
  assert.deepEqual(clampInspectionPan({ x: -15, y: 30 }, 2, viewport), { x: -15, y: 30 });
});

test('finding focus centers a small interior region and retains complete edge/full-card regions', () => {
  const interior = focusInspectionBounds({ x: .2, y: .2, width: .02, height: .02 }, viewport);
  const scale = interior.zoom * .5;
  near(353.5 + interior.pan.x + (306.7 - 675) * scale, 353.5);
  near(480.5 + interior.pan.y + (413.38 - 929) * scale, 480.5);
  assert.ok(interior.zoom > 4 && interior.zoom <= 16);
  for (const bounds of [{ x: 0, y: 0, width: .02, height: .02 },
    { x: .98, y: .98, width: .02, height: .02 }, { x: 0, y: 0, width: 1, height: 1 }]) {
    const focused = focusInspectionBounds(bounds, viewport), s = .5 * focused.zoom;
    const left = 353.5 + focused.pan.x - 675 * s, top = 480.5 + focused.pan.y - 929 * s;
    const xs = [bounds.x, bounds.x + bounds.width].map(x => left + (40 + x * 1270) * s);
    const ys = [bounds.y, bounds.y + bounds.height].map(y => top + (40 + y * 1778) * s);
    assert.ok(xs.every(x => x >= 0 && x <= 707), `horizontal region retained: ${xs}`);
    assert.ok(ys.every(y => y >= 0 && y <= 961), `vertical region retained: ${ys}`);
  }
});
