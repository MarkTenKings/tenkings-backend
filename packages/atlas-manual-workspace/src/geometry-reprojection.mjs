import { parseGeometryWorkspace, validatePreparedPhotoFrame } from './geometry-actions.mjs';
import { DefectActionError, parseDefectWorkspace } from './defect-actions.mjs';
import { decodeSpeedsterTraceRleV1, encodeSpeedsterTraceRleV1,
  SPEEDSTER_TRACE_WIDTH as WIDTH, SPEEDSTER_TRACE_HEIGHT as HEIGHT,
  SPEEDSTER_TRACE_PIXEL_COUNT as PIXELS } from '@atlas/grading-core/trace-codec';

const VERSION = 'atlas-geometry-reprojection-v1';
const SIDES = ['FRONT', 'BACK'];
const MAX_FINDINGS = 200;
const MAX_REPROJECTIONS = 64;
const EPSILON = 1e-7;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const equal = (a, b) => canonical(a) === canonical(b);
function requireThat(value, code) { if (!value) throw new DefectActionError(code); }
function reviewRequired(side, findingId, reason) {
  const error = new DefectActionError('ATLAS_DEFECT_GEOMETRY_REVIEW_REQUIRED');
  // Safe identities only. The retained prior draft owns all original pixels;
  // a rejected reprojection neither clips them nor substitutes old coordinates.
  error.details = Object.freeze({ side, findingIds: Object.freeze([findingId]), reason });
  throw error;
}
function inverse(m) {
  const [a,b,c,d,e,f,g,h,i] = m;
  const det = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  requireThat(Number.isFinite(det) && det !== 0, 'ATLAS_DEFECT_GEOMETRY_TRANSFORM_INVALID');
  const result = [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(n => n/det);
  requireThat(result.every(Number.isFinite), 'ATLAS_DEFECT_GEOMETRY_TRANSFORM_INVALID');
  return result;
}
function multiply(a, b) {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index/3), column = index%3;
    return a[row*3]*b[column] + a[row*3+1]*b[column+3] + a[row*3+2]*b[column+6];
  });
}
function point(m, x, y) {
  const denominator = m[6]*x + m[7]*y + m[8];
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  const result = { x: (m[0]*x + m[1]*y + m[2])/denominator, y: (m[3]*x + m[4]*y + m[5])/denominator };
  return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
}
function noHorizon(m, width, height) {
  const values = [[0,0], [width-1,0], [width-1,height-1], [0,height-1]].map(([x,y]) => m[6]*x+m[7]*y+m[8]);
  return values.every(n => Number.isFinite(n) && n > 0) || values.every(n => Number.isFinite(n) && n < 0);
}
function frame(slot) {
  return { imageVersion: slot.image.version, originalSha256: slot.image.originalSha256,
    preparationVersion: slot.prepared.frame.version, frameId: slot.prepared.frame.id,
    inspectionImageSha256: slot.prepared.frame.inspection.sha256, rectifiedImageSha256: slot.prepared.frame.rectified.sha256 };
}

/** Nearest-neighbor inverse sampling in the frozen canonical pixel grid. Source
 * and destination homographies already describe oriented working-image pixels;
 * there is no EXIF transform or normalized-coordinate scaling in this step.
 * Scan each source component too: a small isolated defect must not disappear
 * merely because no destination sample lands on it after downscaling. */
function reprojectTrace(trace, forward, backward, side, findingId) {
  const pixels = decodeSpeedsterTraceRleV1(trace);
  for (let index = 0; index < PIXELS; index++) if (pixels[index]) {
    const projected = point(forward, index%WIDTH, Math.floor(index/WIDTH));
    if (!projected) reviewRequired(side, findingId, 'UNMAPPABLE_TRACE');
    if (projected.x < -EPSILON || projected.y < -EPSILON || projected.x > WIDTH-1+EPSILON || projected.y > HEIGHT-1+EPSILON)
      reviewRequired(side, findingId, 'TRACE_OUTSIDE_CORRECTED_CARD');
  }
  // The support of a nearest-neighbor source pixel extends half a pixel around
  // its center. Sampling the entire fixed destination grid handles perspective
  // and magnification correctly without estimating a cropped support boundary.
  const output = new Uint8Array(PIXELS), sampled = new Uint8Array(PIXELS);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const source = point(backward, x, y);
    if (!source) reviewRequired(side, findingId, 'UNMAPPABLE_TRACE');
    const sx = Math.round(source.x), sy = Math.round(source.y);
    if (sx >= 0 && sx < WIDTH && sy >= 0 && sy < HEIGHT && pixels[sy*WIDTH+sx]) {
      output[y*WIDTH+x] = 1; sampled[sy*WIDTH+sx] = 1;
    }
  }
  const queue = new Int32Array(PIXELS);
  for (let start = 0; start < PIXELS; start++) if (pixels[start] === 1) {
    let head = 0, tail = 1, survived = false;
    queue[0] = start; pixels[start] = 2;
    while (head < tail) {
      const index = queue[head++], x = index%WIDTH, y = Math.floor(index/WIDTH);
      survived ||= sampled[index] === 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x+dx, ny = y+dy;
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
        const neighbor = ny*WIDTH+nx;
        if (pixels[neighbor] === 1) { pixels[neighbor] = 2; queue[tail++] = neighbor; }
      }
    }
    if (!survived) reviewRequired(side, findingId, 'TRACE_COMPONENT_LOST');
  }
  return encodeSpeedsterTraceRleV1(output);
}

/** Server composition calls this with both hash-verified geometry artifacts
 * before invoking the existing checked CPU measurement adapter. No measurement
 * or inspection survives a changed frame. An unmappable included finding
 * rejects the whole candidate; a deliberately removed finding may retain its
 * exact old frame as an explicit exclusion. The host keeps prior artifacts.
 * This never calls a detector, changes a classification or grants approval. */
export function beginReprojectDefectFrame({ workspace, side, previousGeometry, geometry }) {
  requireThat(SIDES.includes(side), 'ATLAS_DEFECT_SIDE_MISMATCH');
  requireThat(Array.isArray(workspace?.sides?.[side]?.findings) && workspace.sides[side].findings.length <= MAX_FINDINGS,
    'ATLAS_DEFECT_GEOMETRY_LIMIT');
  const state = parseDefectWorkspace(workspace), previous = parseGeometryWorkspace(previousGeometry), current = parseGeometryWorkspace(geometry);
  requireThat([previous, current].every(g => g.cardId === state.cardId && g.profile === state.profile), 'ATLAS_DEFECT_STALE');
  const oldSlot = previous.sides[side], newSlot = current.sides[side], slot = state.sides[side];
  requireThat(oldSlot.prepared && newSlot.prepared, 'ATLAS_DEFECT_GEOMETRY_REQUIRED');
  requireThat(equal(oldSlot.image, newSlot.image) && equal(slot.frame, frame(oldSlot))
    && slot.cornerShape === oldSlot.cornerShape, 'ATLAS_DEFECT_STALE');
  requireThat(newSlot.prepared.frame.version > oldSlot.prepared.frame.version, 'ATLAS_DEFECT_STALE');
  requireThat(!slot.pending, 'ATLAS_DEFECT_MEASUREMENT_PENDING');
  const newTransform = newSlot.prepared.frame.sourceToRectified;
  const findings = slot.findings.map(finding => {
    const sourceTrace = finding.finalTrace ?? finding.detectorMask;
    requireThat(sourceTrace, 'ATLAS_DEFECT_EXACT_MASK_REQUIRED');
    const history = finding.geometryReprojections ?? [];
    requireThat(Array.isArray(history) && history.length < MAX_REPROJECTIONS, 'ATLAS_DEFECT_GEOMETRY_LIMIT');
    const exclusion = finding.geometryExclusion;
    const sourceImage = exclusion?.sourceImage ?? oldSlot.image;
    const sourceFrame = exclusion?.sourceFrame ?? oldSlot.prepared.frame;
    const sourceQuad = exclusion?.sourceQuad ?? oldSlot.physical.quad;
    requireThat(equal(sourceImage, oldSlot.image), 'ATLAS_DEFECT_STALE');
    validatePreparedPhotoFrame(sourceFrame, sourceImage, sourceQuad);
    const oldTransform = sourceFrame.sourceToRectified;
    const forward = multiply(newTransform, inverse(oldTransform)), backward = multiply(oldTransform, inverse(newTransform));
    requireThat(noHorizon(forward, WIDTH, HEIGHT) && noHorizon(backward, WIDTH, HEIGHT), 'ATLAS_DEFECT_GEOMETRY_TRANSFORM_INVALID');
    const { zone: _zone, canonicalContour: _contour, measurement: _measurement, detectorMask: _mask,
      measurementRegions: _regions, featureFingerprint: _fingerprint, featureFingerprintTraceSha256: _fingerprintTrace,
      geometryExclusion: _exclusion,
      ...retained } = finding;
    let finalTrace;
    try { finalTrace = reprojectTrace(sourceTrace, forward, backward, side, finding.id); }
    catch (error) {
      // Only a deliberate human rejection can leave the active raster. Keep
      // its exact old trace and frame visibly excluded; never clip it or label
      // its old pixels as the current frame. A later wider outline may make
      // exact reprojection possible again; otherwise restoration needs a new
      // trace. All included findings retain the fail-closed review hold.
      if (finding.reviewResult !== 'REMOVED' || !slot.humanEditedIds.includes(finding.id)
        || error?.code !== 'ATLAS_DEFECT_GEOMETRY_REVIEW_REQUIRED'
        || !['TRACE_OUTSIDE_CORRECTED_CARD', 'TRACE_COMPONENT_LOST'].includes(error.details?.reason)) throw error;
      return { ...retained, finalTrace: sourceTrace, measurementRegions: [],
        traceProvenance: finding.traceProvenance ?? { version: 'speedster-trace-provenance-v1', sourceViewId: finding.sourceViewId,
          cropTransform: { version: 'speedster-canonical-crop-affine-v1', crop: { x: 0, y: 0, width: WIDTH-1, height: HEIGHT-1 } },
          highlighterStrokes: [], finalTraceSha256: sourceTrace.sha256 },
        geometryExclusion: { version: 'atlas-geometry-exclusion-v1', reason: error.details.reason,
          sourceImage, sourceQuad, sourceFrame, sourceTraceSha256: sourceTrace.sha256 } };
    }
    return { ...retained, finalTrace, measurementRegions: [],
      traceProvenance: { version: 'speedster-trace-provenance-v1', sourceViewId: finding.sourceViewId,
        cropTransform: { version: 'speedster-canonical-crop-affine-v1', crop: { x: 0, y: 0, width: WIDTH-1, height: HEIGHT-1 } },
        highlighterStrokes: [], finalTraceSha256: finalTrace.sha256 },
      geometryReprojections: [...history, { version: VERSION, algorithm: 'CANONICAL_PIXEL_NEAREST_NEIGHBOR_V1',
        sourceImage, sourceFrame, targetFrame: newSlot.prepared.frame,
        sourceTraceSha256: sourceTrace.sha256, targetTraceSha256: finalTrace.sha256,
        sourceTraceProvenance: finding.traceProvenance ?? null,
        sourceFeatureFingerprint: finding.featureFingerprint ?? null,
        sourceFeatureFingerprintTraceSha256: finding.featureFingerprintTraceSha256 ?? null }] };
  });
  return parseDefectWorkspace({ ...state, draftRevision: state.draftRevision+1, confirmation: null,
    sides: { ...state.sides, [side]: { ...slot, frame: frame(newSlot), cornerShape: newSlot.cornerShape,
      findingRevision: slot.findingRevision+1, findings, inspection: null, measurement: null,
      pending: { actor: 'HUMAN', action: { type: 'REMEASURE' }, geometryReprojection: { version: VERSION, previousFrame: slot.frame } } } } });
}
