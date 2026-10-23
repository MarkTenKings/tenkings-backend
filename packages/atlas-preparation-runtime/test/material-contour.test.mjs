import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clipMaterialContourToCard } from '../src/material-contour.mjs';
import { validMaterialContour } from '../../atlas-manual-workspace/src/material-contour.mjs';

const points = values => values.map(([x, y]) => ({ x, y }));
const unit = points([[0, 0], [1, 0], [1, 1], [0, 1]]);
function contains(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

test('a contained silhouette keeps every original coordinate, including valid collinear samples', () => {
  const contour = points([[0, 0], [.4, 0], [1, 0], [1, 1], [0, 1]]);
  assert.equal(validMaterialContour(contour), true);
  assert.deepEqual(clipMaterialContourToCard(contour), contour);
});

test('inward corner correction intersects segments instead of collapsing three samples onto one corner', () => {
  const contour = points([[.01, .01], [.99, .01], [.99, .99], [.02, 1.01], [-.001, 1.005], [-.002, 1.004], [-.003, 1.003], [-.01, .98], [.01, .02]]);
  const before = structuredClone(contour);
  const clamped = contour.map(p => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }));
  assert.equal(validMaterialContour(clamped), false, 'regression: old vertex clamp duplicates the bottom-left corner');
  const clipped = clipMaterialContourToCard(contour);
  assert.equal(validMaterialContour(clipped), true);
  assert.equal(clipped.filter(p => p.x === 0 && p.y === 1).length, 1);
  assert(clipped.some(p => p.x === 0 && p.y < 1));
  assert(clipped.some(p => p.y === 1 && p.x > 0));
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const px = (x + .371) / 100, py = (y + .619) / 100;
    assert.equal(contains(clipped, px, py), contains(contour, px, py), 'intersection preserves the material inside the card');
  }
  assert.deepEqual(contour, before, 'the photographic source contour is immutable');
});

test('a silhouette surrounding all four boundaries yields the exact card rectangle', () => {
  const clipped = clipMaterialContourToCard(points([[-1, -1], [2, -1], [2, 2], [-1, 2]]));
  assert.equal(validMaterialContour(clipped), true);
  assert.deepEqual(new Set(clipped.map(p => `${p.x},${p.y}`)), new Set(unit.map(p => `${p.x},${p.y}`)));
});

test('edge intersections do not leave duplicate adjacent or closing vertices', () => {
  const clipped = clipMaterialContourToCard(points([[0, 0], [1.5, 0], [1, 1], [0, 1], [-.5, .5]]));
  assert.equal(validMaterialContour(clipped), true);
  assert.equal(new Set(clipped.map(p => `${p.x},${p.y}`)).size, clipped.length);
});

test('empty, degenerate, reversed and disconnected intersections remain invalid material', () => {
  const cases = [
    points([[2, 2], [3, 2], [3, 3], [2, 3]]),
    points([[-1, 0], [0, 0], [0, 1], [-1, 1]]),
    [...unit].reverse(),
    // Two legs enter the card, joined only above its top edge. A single simple
    // material polygon cannot represent this disconnected intersection.
    points([[.1, -.3], [.9, -.3], [.9, .8], [.7, .8], [.7, -.1], [.3, -.1], [.3, .8], [.1, .8]]),
  ];
  for (const contour of cases) assert.equal(validMaterialContour(clipMaterialContourToCard(contour)), false);
});
