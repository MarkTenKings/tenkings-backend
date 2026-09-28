/** Experimental source-pixel geometry only. No production imports or effects.
 * Working PNGs are already oriented. Never apply sourceToFrame/EXIF again.
 * Physical quads use W/H extents; contours use canonical pixel centers W-1/H-1.
 */
const CARD_WIDTH = 1270, CARD_HEIGHT = 1778, MARGIN = 40;
const CANONICAL_CROPS = [[0, 0], [611, 0], [0, 865], [611, 865]]
  .map(([x, y]) => ({ x, y, width: 739, height: 993 }));

function requireThat(ok, code) {
  if (!ok) throw Object.assign(new Error(code), { code });
}
function dimensions(width, height) {
  requireThat(Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width >= 2 && height >= 2 && width <= 65535 && height <= 65535,
  'SOURCE_DIMENSIONS_INVALID');
}
function determinant(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}
function matrix(value) {
  requireThat(Array.isArray(value) && value.length === 9 && value.every(Number.isFinite), 'SOURCE_MATRIX_INVALID');
  const scale = Math.max(...value.map(Math.abs));
  requireThat(scale > 0, 'SOURCE_MATRIX_SINGULAR');
  const result = value.map(v => v / scale), det = determinant(result);
  requireThat(Number.isFinite(det) && det !== 0, 'SOURCE_MATRIX_SINGULAR');
  return result;
}
const denominator = (m, p) => m[6] * p.x + m[7] * p.y + m[8];
function project(m, p) {
  requireThat(p && Number.isFinite(p.x) && Number.isFinite(p.y), 'SOURCE_POINT_INVALID');
  const d = denominator(m, p);
  requireThat(Number.isFinite(d) && d !== 0, 'SOURCE_PROJECTION_INVALID');
  const result = { x: (m[0] * p.x + m[1] * p.y + m[2]) / d,
    y: (m[3] * p.x + m[4] * p.y + m[5]) / d };
  requireThat(Number.isFinite(result.x) && Number.isFinite(result.y), 'SOURCE_PROJECTION_INVALID');
  return result;
}
export function transformPoint(H, point) { return project(matrix(H), point); }
export function inverseMatrix(H) {
  const m = matrix(H), [a, b, c, d, e, f, g, h, i] = m, det = determinant(m);
  const inverse = [e*i-f*h, c*h-b*i, b*f-c*e, f*g-d*i, a*i-c*g, c*d-a*f,
    d*h-e*g, b*g-a*h, a*e-b*d].map(v => v / det);
  requireThat(inverse.every(Number.isFinite), 'SOURCE_MATRIX_INVALID');
  return inverse;
}
function safeProjection(H, points) {
  const m = matrix(H), ds = points.map(p => denominator(m, p));
  requireThat(ds.every(Number.isFinite) && (ds.every(v => v > 0) || ds.every(v => v < 0)),
    'SOURCE_PROJECTION_POLE');
  // A valid upright physical-card homography cannot reflect its source frame.
  requireThat(determinant(m) * Math.sign(ds[0]) > 0, 'SOURCE_PROJECTION_REFLECTED');
  return points.map(p => project(m, p));
}
const corners = ({ x, y, width, height }) => [{ x, y }, { x: x + width - 1, y },
  { x: x + width - 1, y: y + height - 1 }, { x, y: y + height - 1 }];
function rectangle(crop, width, height) {
  requireThat(crop && ['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(crop[k]))
    && crop.x >= 0 && crop.y >= 0 && crop.width >= 1 && crop.height >= 1
    && crop.x + crop.width <= width && crop.y + crop.height <= height, 'SOURCE_CROP_INVALID');
}

/** Integer extraction rectangles preserve native working-image samples.
 * Mapped rectangles enclose the original inspection crop's pixel-center extent.
 * Fail instead of silently truncating context outside the retained photograph.
 */
export function planSourceCrops({ width, height, sourceToRectified = null }) {
  dimensions(width, height);
  if (sourceToRectified === null) {
    const cropWidth = Math.min(width, Math.ceil(width * 0.55));
    const cropHeight = Math.min(height, Math.ceil(height * 0.55));
    return [[0, 0], [width - cropWidth, 0], [0, height - cropHeight], [width - cropWidth, height - cropHeight]]
      .map(([x, y]) => ({ x, y, width: cropWidth, height: cropHeight }));
  }
  const inverse = inverseMatrix(sourceToRectified);
  return CANONICAL_CROPS.map(canonicalCrop => {
    const points = safeProjection(inverse, corners(canonicalCrop)
      .map(p => ({ x: p.x - MARGIN, y: p.y - MARGIN })));
    const x = Math.floor(Math.min(...points.map(p => p.x)));
    const y = Math.floor(Math.min(...points.map(p => p.y)));
    const right = Math.ceil(Math.max(...points.map(p => p.x)));
    const bottom = Math.ceil(Math.max(...points.map(p => p.y)));
    const crop = { x, y, width: right - x + 1, height: bottom - y + 1 };
    rectangle(crop, width, height);
    return { ...crop, canonicalCrop: { ...canonicalCrop } };
  });
}

const orientation = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function touches(a, b, c, d) {
  const on = (a, b, p) => Math.abs(orientation(a, b, p)) < 1e-8
    && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
    && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
  return (orientation(a, b, c) * orientation(a, b, d) < 0
    && orientation(c, d, a) * orientation(c, d, b) < 0)
    || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
function polygon(points) {
  requireThat(Array.isArray(points) && points.length >= 3 && points.length <= 64, 'SOURCE_CONTOUR_INVALID');
  const seen = new Set(); let area = 0;
  for (const p of points) {
    requireThat(p && Object.keys(p).length === 2 && Number.isFinite(p.x) && Number.isFinite(p.y), 'SOURCE_CONTOUR_INVALID');
    const key = `${p.x}:${p.y}`;
    requireThat(!seen.has(key), 'SOURCE_CONTOUR_INVALID'); seen.add(key);
  }
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      requireThat(!touches(a, b, points[j], points[(j + 1) % points.length]), 'SOURCE_CONTOUR_INVALID');
    }
  }
  requireThat(Number.isFinite(area) && Math.abs(area) > 1e-8, 'SOURCE_CONTOUR_INVALID');
}

/** One finding at a time. The caller retains raw failures and withholds grades.
 * Without physical geometry, sourceContour is diagnostic only; never fabricate
 * a canonical contour, a measurement or a human geometry confirmation.
 */
export function mapSourceContour({ points, crop, width, height, sourceToRectified = null }) {
  dimensions(width, height); rectangle(crop, width, height); polygon(points);
  requireThat(points.every(p => p.x >= 0 && p.y >= 0 && p.x <= crop.width - 1 && p.y <= crop.height - 1),
    'SOURCE_CONTOUR_OUTSIDE_IMAGE');
  const sourceContour = points.map(p => ({ x: p.x + crop.x, y: p.y + crop.y }));
  requireThat(sourceContour.every(p => p.x >= 0 && p.y >= 0 && p.x <= width - 1 && p.y <= height - 1),
    'SOURCE_CONTOUR_OUTSIDE_SOURCE');
  if (sourceToRectified === null) return { sourceContour, canonicalContour: null };
  const canonicalContour = safeProjection(sourceToRectified, sourceContour)
    .map(p => ({ x: p.x / (CARD_WIDTH - 1), y: p.y / (CARD_HEIGHT - 1) }));
  requireThat(canonicalContour.every(p => p.x >= 0 && p.y >= 0 && p.x <= 1 && p.y <= 1),
    'SOURCE_CONTOUR_OUTSIDE_CARD');
  // A finite homography with no pole across this simple polygon preserves its
  // topology. Do not impose the source-pixel area tolerance on normalized units.
  return { sourceContour, canonicalContour };
}

/** Bind existing geometry to the exact separately hash-verified working PNG.
 * This verifies descriptors, not image bytes; the input harness owns SHA checks.
 */
export function assertSourceGeometryBinding({ geometrySide, workingFrame, originalSha256 }) {
  const image = geometrySide?.image, prepared = geometrySide?.prepared, physical = geometrySide?.physical;
  const raster = workingFrame?.raster;
  requireThat(image && raster && prepared?.frame && physical?.quad
    && image.coordinateSpace === 'ORIENTED_DECODED'
    && image.originalSha256 === originalSha256 && /^[a-f0-9]{64}$/.test(originalSha256)
    && image.frameId === workingFrame.id && image.frameSha256 === raster.content?.sha256
    && /^[a-f0-9]{64}$/.test(image.frameSha256)
    && image.width === raster.dimensions?.width && image.height === raster.dimensions?.height,
  'SOURCE_GEOMETRY_BINDING_MISMATCH');
  const sameImage = other => other && ['version', 'originalSha256', 'frameId', 'frameSha256', 'width', 'height', 'coordinateSpace']
    .every(k => other[k] === image[k]);
  requireThat(sameImage(physical.sourceImage) && sameImage(prepared.source?.image)
    && physical.revision === prepared.source?.physicalRevision
    && Array.isArray(physical.quad) && Array.isArray(prepared.source?.physicalQuad)
    && physical.quad.length === prepared.source.physicalQuad.length
    && physical.quad.every((p, i) => p?.x === prepared.source.physicalQuad[i]?.x
      && p?.y === prepared.source.physicalQuad[i]?.y), 'SOURCE_GEOMETRY_BINDING_MISMATCH');
  dimensions(image.width, image.height);
  requireThat(physical.quad.length === 4 && physical.quad.every(p => p && Number.isFinite(p.x)
    && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1), 'SOURCE_GEOMETRY_QUAD_INVALID');
  const mapped = safeProjection(prepared.frame.sourceToRectified,
    physical.quad.map(p => ({ x: p.x * image.width, y: p.y * image.height })));
  const expected = corners({ x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT });
  requireThat(mapped.every((p, i) => Math.abs(p.x - expected[i].x) <= 0.002
    && Math.abs(p.y - expected[i].y) <= 0.002), 'SOURCE_GEOMETRY_TRANSFORM_MISMATCH');
  return [...prepared.frame.sourceToRectified];
}
