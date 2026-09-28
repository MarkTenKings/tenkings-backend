import test from 'node:test';
import assert from 'node:assert/strict';
import { transformPoint, inverseMatrix, planSourceCrops, mapSourceContour, assertSourceGeometryBinding } from './coordinates.mjs';

const H = [0.5399663718474783, 0.0015871140023217924, -172.0481336027613,
  0.007573007598903182, 0.5415903652031544, -180.4560615675219,
  3.31895134276456e-6, 6.053019594613993e-6, 1];
const width = 3024, height = 4032;
const close = (actual, expected, tolerance = 1e-9) => assert(Math.abs(actual - expected) <= tolerance,
  `${actual} differs from ${expected}`);
const crop = { x: 0, y: 0, width, height };
const triangle = [{ x: 500, y: 500 }, { x: 600, y: 500 }, { x: 600, y: 600 }];

test('perspective inverse round-trips pixel centers including all corners and interior; homogeneous scale does not matter', () => {
  for (const scale of [1, -1, 1e-20, 1e20]) {
    const scaled = H.map(v => v * scale), inverse = inverseMatrix(scaled);
    for (const x of [0, 317.25, 634.5, 951.75, 1269]) for (const y of [0, 444.25, 888.5, 1332.75, 1777]) {
      const source = transformPoint(inverse, { x, y }), result = transformPoint(scaled, source);
      close(result.x, x); close(result.y, y);
    }
  }
});

test('native crop rectangles enclose inverse-mapped context pixel centers without resampling', () => {
  const crops = planSourceCrops({ width, height, sourceToRectified: H });
  assert.equal(crops.length, 4);
  assert.deepEqual(crops.map(c => c.canonicalCrop), [[0, 0], [611, 0], [0, 865], [611, 865]]
    .map(([x, y]) => ({ x, y, width: 739, height: 993 })));
  for (const c of crops) {
    assert(['x', 'y', 'width', 'height'].every(k => Number.isInteger(c[k])));
    assert(c.x >= 0 && c.y >= 0 && c.x + c.width <= width && c.y + c.height <= height);
    const inverse = inverseMatrix(H), canonical = c.canonicalCrop;
    for (const x of [canonical.x, canonical.x + canonical.width - 1])
      for (const y of [canonical.y, canonical.y + canonical.height - 1]) {
        const p = transformPoint(inverse, { x: x - 40, y: y - 40 });
        assert(p.x >= c.x && p.x <= c.x + c.width - 1 && p.y >= c.y && p.y <= c.y + c.height - 1);
      }
  }
});

test('unmapped native quadrants overlap and cover the entire source; diagnostics do not acquire canonical coordinates', () => {
  const crops = planSourceCrops({ width, height });
  assert.deepEqual(crops.map(c => [c.x, c.y]), [[0, 0], [1360, 0], [0, 1814], [1360, 1814]]);
  assert(crops[0].width > crops[1].x && crops[0].height > crops[2].y);
  assert.equal(crops[3].x + crops[3].width, width);
  assert.equal(crops[3].y + crops[3].height, height);
  const points = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }];
  const result = mapSourceContour({ points, crop: crops[3], width, height });
  assert.equal(result.canonicalContour, null);
  assert.deepEqual(result.sourceContour, points.map(p => ({ x: p.x + crops[3].x, y: p.y + crops[3].y })));
});

test('crop translation precedes the perspective mapping and canonical pixel-center normalization', () => {
  const c = { x: 400, y: 450, width: 500, height: 500 };
  const points = triangle.map(p => ({ x: p.x - c.x, y: p.y - c.y }));
  const mapped = mapSourceContour({ points, crop: c, width, height, sourceToRectified: H });
  assert.deepEqual(mapped.sourceContour, triangle);
  for (let i = 0; i < triangle.length; i++) {
    const p = transformPoint(H, triangle[i]);
    close(mapped.canonicalContour[i].x, p.x / 1269);
    close(mapped.canonicalContour[i].y, p.y / 1777);
  }
  assert.deepEqual(mapped.canonicalContour, mapSourceContour({ points: triangle, crop, width, height, sourceToRectified: H }).canonicalContour);
});

test('strict card limits retain no clamped contour, even fractions of a pixel outside', () => {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const edge = [{ x: 1250, y: 1750 }, { x: 1269, y: 1750 }, { x: 1269, y: 1777 }];
  const valid = mapSourceContour({ points: edge, crop, width, height, sourceToRectified: identity });
  assert.deepEqual(valid.canonicalContour[2], { x: 1, y: 1 });
  for (const delta of [0.0001, 1, 3]) {
    const points = structuredClone(edge); points[2].y += delta;
    assert.throws(() => mapSourceContour({ points, crop, width, height, sourceToRectified: identity }),
      { code: 'SOURCE_CONTOUR_OUTSIDE_CARD' });
    assert.equal(points[2].y, 1777 + delta);
  }
});

test('reject malformed, repeated, crossed, degenerate and local-outside polygons before mapping', () => {
  const bad = [[], triangle.slice(0, 2), [...triangle, triangle[0]],
    [{ x: 5, y: 5 }, { x: 50, y: 50 }, { x: 5, y: 50 }, { x: 50, y: 5 }],
    [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }],
    [{ x: NaN, y: 10 }, ...triangle.slice(1)], [{ x: 1, y: 1, extra: true }, ...triangle.slice(1)]];
  for (const points of bad) assert.throws(() => mapSourceContour({ points, crop, width, height }), { code: 'SOURCE_CONTOUR_INVALID' });
  for (const p of [{ x: -1, y: 10 }, { x: width, y: 10 }, { x: 10, y: height }])
    assert.throws(() => mapSourceContour({ points: [p, ...triangle.slice(1)], crop, width, height }),
      { code: 'SOURCE_CONTOUR_OUTSIDE_IMAGE' });
  assert.throws(() => mapSourceContour({ points: triangle, crop: { ...crop, x: 1 }, width, height }), { code: 'SOURCE_CROP_INVALID' });
});

test('singular, pole-crossing and reflected mapped frames fail closed', () => {
  assert.throws(() => inverseMatrix([1, 0, 0, 0, 0, 0, 0, 0, 1]), { code: 'SOURCE_MATRIX_SINGULAR' });
  assert.throws(() => transformPoint([1, 0, 0, 0, 1, 0, 1, 0, -500], { x: 500, y: 500 }),
    { code: 'SOURCE_PROJECTION_INVALID' });
  assert.throws(() => mapSourceContour({ points: triangle, crop, width, height,
    sourceToRectified: [1, 0, 0, 0, 1, 0, 1, 0, -550] }), { code: 'SOURCE_PROJECTION_POLE' });
  assert.throws(() => mapSourceContour({ points: triangle, crop, width, height,
    sourceToRectified: [-1, 0, 1269, 0, 1, 0, 0, 0, 1] }), { code: 'SOURCE_PROJECTION_REFLECTED' });
  assert.throws(() => planSourceCrops({ width, height, sourceToRectified: [1, 0, 0, 0, 1, 0, 0, 0, 1] }),
    { code: 'SOURCE_CROP_INVALID' });
});

function bindingFixture() {
  const originalSha256 = 'a'.repeat(64), frameSha256 = 'b'.repeat(64);
  const image = { version: 1, originalSha256, frameId: 'working-source', frameSha256, width, height, coordinateSpace: 'ORIENTED_DECODED' };
  const quad = [{ x: 0.10504669108718791, y: 0.08153639899359809 },
    { x: 0.8905805961164848, y: 0.0732983634585426 },
    { x: 0.9033072335379464, y: 0.9124229067847842 },
    { x: 0.10178297537344473, y: 0.9143200223408048 }];
  return { originalSha256,
    workingFrame: { id: image.frameId, raster: { content: { sha256: frameSha256 }, dimensions: { width, height } } },
    geometrySide: { image, physical: { revision: 1, quad, sourceImage: image },
      prepared: { source: { image, physicalRevision: 1, physicalQuad: quad }, frame: { sourceToRectified: H } } } };
}

test('saved physical quad uses source extent W/H; substituted sources and W-1 transforms are refused', () => {
  const fixture = bindingFixture();
  assert.deepEqual(assertSourceGeometryBinding(fixture), H);
  for (const change of [f => f.workingFrame.raster.content.sha256 = 'c'.repeat(64),
    f => f.workingFrame.id = 'another-source', f => f.workingFrame.raster.dimensions.width--,
    f => f.originalSha256 = 'c'.repeat(64), f => f.geometrySide.prepared.source.physicalRevision++]) {
    const changed = structuredClone(fixture); change(changed);
    assert.throws(() => assertSourceGeometryBinding(changed), { code: 'SOURCE_GEOMETRY_BINDING_MISMATCH' });
  }
  const changed = structuredClone(fixture);
  changed.geometrySide.physical.quad = changed.geometrySide.physical.quad.map(p => ({ x: p.x * (width - 1) / width, y: p.y * (height - 1) / height }));
  changed.geometrySide.prepared.source.physicalQuad = changed.geometrySide.physical.quad;
  assert.throws(() => assertSourceGeometryBinding(changed), { code: 'SOURCE_GEOMETRY_TRANSFORM_MISMATCH' });
});
