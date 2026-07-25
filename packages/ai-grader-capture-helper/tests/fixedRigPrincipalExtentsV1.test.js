const assert = require("node:assert/strict");
const test = require("node:test");

const {
  measureFixedRigPrincipalExtentsV1,
} = require("../dist/drivers/fixedRigPrincipalExtentsV1");

function referenceExtents(pixels, imageWidth, unitX, unitY, chunkSize) {
  if (!pixels.length) return { length: 0, width: 0 };
  const points = pixels.map((pixel) => ({
    x: (pixel % imageWidth) * unitX,
    y: Math.floor(pixel / imageWidth) * unitY,
  }));
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const perpendicular = { x: -axis.y, y: axis.x };
  const along = points.map((point) => point.x * axis.x + point.y * axis.y);
  const across = points.map((point) => point.x * perpendicular.x + point.y * perpendicular.y);
  const extrema = (values) => {
    if (!chunkSize) {
      return { minimum: Math.min(...values), maximum: Math.max(...values) };
    }
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < values.length; index += chunkSize) {
      const chunk = values.slice(index, index + chunkSize);
      minimum = Math.min(minimum, Math.min(...chunk));
      maximum = Math.max(maximum, Math.max(...chunk));
    }
    return { minimum, maximum };
  };
  const alongExtrema = extrema(along);
  const acrossExtrema = extrema(across);
  const alongExtent = alongExtrema.maximum - alongExtrema.minimum +
    Math.hypot(unitX * axis.x, unitY * axis.y);
  const acrossExtent = acrossExtrema.maximum - acrossExtrema.minimum +
    Math.hypot(unitX * perpendicular.x, unitY * perpendicular.y);
  return {
    length: Math.max(alongExtent, acrossExtent),
    width: Math.min(alongExtent, acrossExtent),
  };
}

function seededPixels(count, imageWidth, imageHeight) {
  let state = 0x6d2b79f5;
  const pixels = new Set();
  while (pixels.size < count) {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) +
      Math.imul(state ^ (state >>> 7), 61 | state)) ^ state;
    pixels.add((state >>> 0) % (imageWidth * imageHeight));
  }
  return [...pixels].sort((left, right) => left - right);
}

test("iterative principal extents are bit-for-bit equivalent for bounded legacy fixtures", () => {
  const width = 97;
  const fixtures = {
    singleton: [12 * width + 7],
    horizontal: Array.from({ length: 25 }, (_, index) => 31 * width + 20 + index),
    vertical: Array.from({ length: 31 }, (_, index) => (15 + index) * width + 44),
    diagonal: Array.from({ length: 29 }, (_, index) => (9 + index) * width + 11 + index),
    seeded: seededPixels(2_000, width, 131),
  };
  for (const [name, pixels] of Object.entries(fixtures)) {
    const legacy = referenceExtents(pixels, width, 0.25, 0.4);
    const iterative = measureFixedRigPrincipalExtentsV1(
      pixels,
      width,
      0.25,
      0.4,
    );
    assert.equal(iterative.length, legacy.length, `${name} length`);
    assert.equal(iterative.width, legacy.width, `${name} width`);
  }
});

test("405721-pixel full mask avoids the legacy V8 argument limit and matches chunked legacy math", () => {
  const width = 433;
  const height = 937;
  const pixels = Array.from({ length: width * height }, (_, index) => index);
  assert.equal(pixels.length, 405_721);
  assert.throws(
    () => referenceExtents(pixels, width, 1, 1),
    (error) => error instanceof RangeError &&
      /call stack|arguments|too many/i.test(error.message),
  );
  const chunked = referenceExtents(pixels, width, 1, 1, 16_384);
  const iterative = measureFixedRigPrincipalExtentsV1(pixels, width, 1, 1);
  assert.equal(iterative.length, chunked.length);
  assert.equal(iterative.width, chunked.width);
});

test("2010591-pixel observed-scale component completes twice under the normal Node heap", () => {
  const pixels = Array.from({ length: 2_010_591 }, (_, index) => index);
  const first = measureFixedRigPrincipalExtentsV1(pixels, 1_200, 1, 1);
  const second = measureFixedRigPrincipalExtentsV1(pixels, 1_200, 1, 1);
  assert.deepEqual(second, first);
  assert.equal(Number.isFinite(first.length), true);
  assert.equal(Number.isFinite(first.width), true);
  assert.ok(first.length >= first.width);
  assert.ok(first.width > 0);
});
