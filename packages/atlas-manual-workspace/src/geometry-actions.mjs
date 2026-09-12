import { sanitizeSpeedsterUnitQuad } from '@atlas/grading-core/geometry';
import {
  calculateCenteringBalance, calculateCenteringScore, combineFrontBackScore,
  measureSpeedsterCenteringBorders,
} from '@atlas/grading-core/scoring';

/** Existing preparation uses x*width/y*height, while the warp's destination
 * corners are pixel centers [0,width-1] × [0,height-1]. Do not substitute the
 * gradient-snap raster's width-minus-one convention here or apply EXIF twice.
 * Descriptors below describe already oriented, externally verified pixels.
 * This pure module verifies bindings/math; it does not verify or write bytes,
 * authenticate actors, persist history, or grant final report approval.
 */
export const GEOMETRY_CONVENTION = 'SPEEDSTER_NORMALIZED_IMAGE_EXTENT_V1';
const SIDES = ['FRONT', 'BACK'];
const KINDS = ['PHYSICAL', 'PRINTED', 'REVIEW', 'IMAGE', 'SETTINGS'];
const CARD = { width: 1270, height: 1778 };
const BOUNDS = { x: 40, y: 40, ...CARD };
const CORNERS = [{ x: 0, y: 0 }, { x: 1269, y: 0 }, { x: 1269, y: 1777 }, { x: 0, y: 1777 }];

export class GeometryActionError extends Error {
  constructor(code) { super(code); this.name = 'GeometryActionError'; this.code = code; }
}
function requireThat(ok, code = 'ATLAS_GEOMETRY_INVALID') {
  if (!ok) throw new GeometryActionError(code);
}
function object(value, keys, optional = []) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype
    && keys.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => keys.includes(key) || optional.includes(key)));
}
function integer(value, minimum = 0) { requireThat(Number.isSafeInteger(value) && value >= minimum); }
function text(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 512
    && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value));
}
function sha(value) { requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  requireThat(value === null || ['string', 'boolean', 'number'].includes(typeof value));
  if (typeof value === 'number') requireThat(Number.isFinite(value));
  return JSON.stringify(value);
}
function equal(a, b) { return canonical(a) === canonical(b); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function copy(value) { return freeze(structuredClone(value)); }
function next(value) { integer(value); integer(value + 1, 1); return value + 1; }
function validQuad(value) {
  const quad = sanitizeSpeedsterUnitQuad(value);
  requireThat(quad && equal(quad, value), 'ATLAS_GEOMETRY_QUAD_INVALID');
  return quad;
}
function settings(value) {
  requireThat(['SQUARE', 'ROUNDED_3_18_MM'].includes(value.cornerShape));
  requireThat(['BLACK', 'WHITE', 'MAGENTA'].includes(value.matColor));
}
function image(value) {
  object(value, ['version', 'originalSha256', 'frameId', 'frameSha256', 'width', 'height', 'coordinateSpace']);
  integer(value.version, 1); sha(value.originalSha256); text(value.frameId); sha(value.frameSha256);
  integer(value.width, 2); integer(value.height, 2);
  requireThat(Number.isSafeInteger(value.width * value.height) && value.coordinateSpace === 'ORIENTED_DECODED');
}
function source(side) {
  return { image: side.image, physicalRevision: side.physicalRevision, physicalQuad: side.physical?.quad ?? null };
}
function baseFor(state, sideName, kind) {
  requireThat(SIDES.includes(sideName) && [...KINDS, 'PREPARATION'].includes(kind));
  const side = state.sides[sideName];
  const base = { schemaVersion: 1, convention: GEOMETRY_CONVENTION, cardId: state.cardId,
    profile: state.profile, side: sideName, kind, image: side.image };
  if (kind === 'IMAGE') return { ...base, imageRevision: side.imageRevision };
  if (kind === 'SETTINGS') return { ...base, settingsRevision: side.settingsRevision };
  if (kind === 'PREPARATION') return { ...base, ...source(side), preparationRevision: side.preparationRevision,
    printedRevision: side.printedRevision, reviewRevision: side.reviewRevision };
  const geometry = { ...base, physicalRevision: side.physicalRevision, physicalQuad: side.physical?.quad ?? null,
    settingsRevision: side.settingsRevision, reviewRevision: side.reviewRevision,
    cornerShape: side.cornerShape, matColor: side.matColor };
  if (kind === 'PHYSICAL') return { ...geometry,
    preparationRevision: side.preparationRevision, printedRevision: side.printedRevision };
  return { ...geometry, preparationRevision: side.preparationRevision, prepared: side.prepared,
    printedRevision: side.printedRevision, printedQuad: side.printed?.quad ?? null };
}
function matches(actual, expected) { requireThat(equal(actual, expected), 'ATLAS_GEOMETRY_STALE'); }
function provenance(actor, proposal) {
  requireThat(['HUMAN', 'ENGINE', 'ASTRA'].includes(actor));
  if (proposal === null) { requireThat(actor === 'HUMAN'); return; }
  object(proposal, ['id', 'ambiguous']); text(proposal.id);
  requireThat(typeof proposal.ambiguous === 'boolean');
}
function determinant(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}
function matrix(m) {
  requireThat(Array.isArray(m) && m.length === 9 && m.every(Number.isFinite), 'ATLAS_GEOMETRY_TRANSFORM_INVALID');
  const det = determinant(m);
  requireThat(Number.isFinite(det) && det !== 0, 'ATLAS_GEOMETRY_TRANSFORM_INVALID');
}
function transform(m, point) {
  object(point, ['x', 'y']); requireThat(Number.isFinite(point.x) && Number.isFinite(point.y));
  const [a, b, c, d, e, f, g, h, i] = m, denominator = g * point.x + h * point.y + i;
  const result = { x: (a * point.x + b * point.y + c) / denominator,
    y: (d * point.x + e * point.y + f) / denominator };
  requireThat(denominator !== 0 && Number.isFinite(result.x) && Number.isFinite(result.y), 'ATLAS_GEOMETRY_TRANSFORM_INVALID');
  return result;
}
function inverse(m) {
  const [a, b, c, d, e, f, g, h, i] = m, det = determinant(m);
  return [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d].map(n => n/det);
}
function preparedFrame(frame, side) {
  object(frame, ['id', 'version', 'rectified', 'inspection', 'sourceToRectified']);
  text(frame.id); integer(frame.version, 1);
  object(frame.rectified, ['sha256', 'width', 'height']); sha(frame.rectified.sha256);
  requireThat(frame.rectified.width === CARD.width && frame.rectified.height === CARD.height, 'ATLAS_GEOMETRY_PREPARED_FRAME_INVALID');
  object(frame.inspection, ['sha256', 'width', 'height', 'cardBounds']); sha(frame.inspection.sha256);
  requireThat(frame.inspection.width === 1350 && frame.inspection.height === 1858
    && equal(frame.inspection.cardBounds, BOUNDS), 'ATLAS_GEOMETRY_PREPARED_FRAME_INVALID');
  requireThat(side.image && side.physical, 'ATLAS_GEOMETRY_PHYSICAL_REQUIRED');
  requireThat(frame.rectified.sha256 !== frame.inspection.sha256, 'ATLAS_GEOMETRY_PREPARED_FRAME_MISMATCH');
  for (const raster of [frame.rectified, frame.inspection]) {
    requireThat(raster.sha256 !== side.image.frameSha256
      || (raster.width === side.image.width && raster.height === side.image.height), 'ATLAS_GEOMETRY_PREPARED_FRAME_MISMATCH');
  }
  matrix(frame.sourceToRectified);
  const denominators = [];
  side.physical.quad.forEach((point, index) => {
    const input = { x: point.x * side.image.width, y: point.y * side.image.height };
    const result = transform(frame.sourceToRectified, input);
    const [g, h, i] = frame.sourceToRectified.slice(6);
    denominators.push(g * input.x + h * input.y + i);
    // OpenCV receives float32 source points. This tolerance permits that
    // conversion; it is far below one pixel and rejects W-1 source scaling.
    requireThat(Math.abs(result.x - CORNERS[index].x) <= 0.002
      && Math.abs(result.y - CORNERS[index].y) <= 0.002, 'ATLAS_GEOMETRY_TRANSFORM_MISMATCH');
  });
  requireThat(denominators.every(n => n > 0) || denominators.every(n => n < 0), 'ATLAS_GEOMETRY_TRANSFORM_INVALID');
}
function centering(quad) {
  try {
    const borders = measureSpeedsterCenteringBorders(quad);
    return { borders, leftRightBalance: calculateCenteringBalance(borders.leftMm, borders.rightMm),
      topBottomBalance: calculateCenteringBalance(borders.topMm, borders.bottomMm), score: calculateCenteringScore(borders) };
  } catch { throw new GeometryActionError('ATLAS_GEOMETRY_CENTERING_UNMEASURABLE'); }
}
function validateState(state) {
  object(state, ['schemaVersion', 'convention', 'cardId', 'profile', 'reportRevision', 'sides']);
  requireThat(state.schemaVersion === 1 && state.convention === GEOMETRY_CONVENTION);
  text(state.cardId); requireThat(['SPORTS', 'POKEMON'].includes(state.profile)); integer(state.reportRevision, 1);
  object(state.sides, SIDES);
  for (const name of SIDES) {
    const side = state.sides[name];
    object(side, ['image', 'imageRevision', 'cornerShape', 'matColor', 'settingsRevision', 'physicalRevision',
      'preparationRevision', 'printedRevision', 'reviewRevision', 'physical', 'prepared', 'printed', 'confirmation']);
    settings(side); integer(side.imageRevision); integer(side.settingsRevision, 1);
    for (const key of ['physicalRevision', 'preparationRevision', 'printedRevision', 'reviewRevision']) {
      integer(side[key]); requireThat(side[key] < state.reportRevision);
    }
    requireThat(side.settingsRevision <= state.reportRevision);
    if (side.image !== null) { image(side.image); requireThat(side.image.version === side.imageRevision); }
    else requireThat(side.imageRevision === 0 && side.physical === null && side.prepared === null && side.printed === null);
    if (side.physical !== null) {
      object(side.physical, ['revision', 'quad', 'actor', 'proposal', 'sourceImage']); validQuad(side.physical.quad);
      provenance(side.physical.actor, side.physical.proposal);
      requireThat(side.image && side.physical.revision === side.physicalRevision && side.physicalRevision > 0);
      matches(side.physical.sourceImage, side.image);
    }
    if (side.prepared !== null) {
      object(side.prepared, ['source', 'frame']);
      matches(side.prepared.source, source(side)); preparedFrame(side.prepared.frame, side);
      requireThat(side.prepared.frame.version === side.preparationRevision);
    }
    if (side.printed !== null) {
      object(side.printed, ['revision', 'quad', 'actor', 'proposal', 'preparationVersion', 'frameId', 'frameSha256', 'centering']);
      validQuad(side.printed.quad); provenance(side.printed.actor, side.printed.proposal);
      requireThat(side.prepared && side.printedRevision > 0 && side.printed.revision === side.printedRevision
        && side.printed.preparationVersion === side.preparationRevision
        && side.printed.frameId === side.prepared.frame.id
        && side.printed.frameSha256 === side.prepared.frame.rectified.sha256, 'ATLAS_GEOMETRY_PREPARED_FRAME_MISMATCH');
      requireThat(equal(side.printed.centering, centering(side.printed.quad)), 'ATLAS_GEOMETRY_CENTERING_MISMATCH');
    }
    if (side.confirmation !== null) {
      object(side.confirmation, ['actor', 'reviewed', 'base']);
      requireThat(side.confirmation.actor === 'HUMAN' && side.confirmation.reviewed === true
        && side.reviewRevision > 0 && side.physical && side.prepared && side.printed, 'ATLAS_GEOMETRY_HUMAN_REVIEW_REQUIRED');
      matches(side.confirmation.base, baseFor(state, name, 'REVIEW'));
    }
  }
  return state;
}

export function createGeometryWorkspace(input) {
  object(input, ['cardId', 'profile', 'sides']);
  const { cardId, profile, sides } = input;
  object(sides, SIDES);
  const initial = { schemaVersion: 1, convention: GEOMETRY_CONVENTION, cardId, profile, reportRevision: 1, sides: {} };
  for (const name of SIDES) {
    const input = sides[name]; object(input, ['image', 'cornerShape', 'matColor']);
    initial.sides[name] = { ...input, imageRevision: input.image?.version ?? 0, settingsRevision: 1,
      physicalRevision: 0, preparationRevision: 0, printedRevision: 0, reviewRevision: 0,
      physical: null, prepared: null, printed: null, confirmation: null };
  }
  return copy(validateState(initial));
}

/** Bases are exact, JSON-serializable dependency fingerprints, not signatures.
 * Independent Back edits do not stale Front results. Advancing a revision even
 * after edit-and-undo prevents an old proposal from regaining write authority.
 */
export function geometryBase(state, side, kind) {
  validateState(state); requireThat(KINDS.includes(kind)); return copy(baseFor(state, side, kind));
}
export function preparationBase(state, side) {
  validateState(state); requireThat(SIDES.includes(side));
  requireThat(state.sides[side].physical, 'ATLAS_GEOMETRY_PHYSICAL_REQUIRED');
  return copy(baseFor(state, side, 'PREPARATION'));
}
function change(state, sideName, side, invalidated) {
  const result = { ...state, reportRevision: next(state.reportRevision), sides: { ...state.sides, [sideName]: side } };
  validateState(result);
  return copy({ state: result, invalidated: { sides: { FRONT: [], BACK: [], [sideName]: invalidated }, report: true } });
}

export function applyGeometryEdit(state, action) {
  validateState(state); object(action, ['side', 'kind', 'base', 'quad', 'actor'], ['proposal']);
  requireThat(['PHYSICAL', 'PRINTED'].includes(action.kind));
  matches(action.base, baseFor(state, action.side, action.kind));
  const side = state.sides[action.side], quad = validQuad(action.quad), proposal = action.proposal ?? null;
  provenance(action.actor, proposal); requireThat(side.image, 'ATLAS_GEOMETRY_IMAGE_REQUIRED');
  if (action.kind === 'PHYSICAL') {
    const physicalRevision = next(side.physicalRevision);
    return change(state, action.side, { ...side, physicalRevision,
      physical: { revision: physicalRevision, quad, actor: action.actor, proposal, sourceImage: side.image },
      prepared: null, printed: null, confirmation: null },
    ['preparation', 'printed', 'centering', 'mapRegistration', 'findings', 'measurement', 'inspection', 'geometryReview']);
  }
  requireThat(side.prepared, 'ATLAS_GEOMETRY_PREPARED_FRAME_REQUIRED');
  const printedRevision = next(side.printedRevision);
  return change(state, action.side, { ...side, printedRevision, confirmation: null,
    printed: { revision: printedRevision, quad, actor: action.actor, proposal,
      preparationVersion: side.preparationRevision, frameId: side.prepared.frame.id,
      frameSha256: side.prepared.frame.rectified.sha256, centering: centering(quad) } }, ['centering', 'geometryReview']);
}

/** Call after actual preparation/result-byte verification. A response from an
 * older physical edge or an already replaced preparation cannot be applied.
 * Printed proposals have their own narrow action after this frame is adopted.
 */
export function applyPreparedFrame(state, action) {
  validateState(state); object(action, ['side', 'base', 'frame']);
  matches(action.base, baseFor(state, action.side, 'PREPARATION'));
  const side = state.sides[action.side]; preparedFrame(action.frame, side);
  requireThat(action.frame.version === next(side.preparationRevision), 'ATLAS_GEOMETRY_PREPARATION_VERSION_INVALID');
  return change(state, action.side, { ...side, preparationRevision: action.frame.version,
    prepared: { source: source(side), frame: action.frame }, printed: null, confirmation: null },
  ['printed', 'centering', 'mapRegistration', 'findings', 'measurement', 'inspection', 'geometryReview']);
}

export function updateGeometrySettings(state, action) {
  validateState(state); object(action, ['side', 'base', 'cornerShape', 'matColor']); settings(action);
  matches(action.base, baseFor(state, action.side, 'SETTINGS'));
  const side = state.sides[action.side];
  const invalidated = ['geometryProposals', 'geometryReview'];
  if (side.cornerShape !== action.cornerShape) invalidated.push('material', 'mapRegistration', 'findings', 'measurement', 'inspection');
  return change(state, action.side, { ...side, settingsRevision: next(side.settingsRevision),
    cornerShape: action.cornerShape, matColor: action.matColor, confirmation: null }, invalidated);
}

/** The adapter retains original/history objects separately; this replaces only
 * the current side pointer. A replacement must be a new monotonically numbered
 * image version even when the selected bytes happen to be equal.
 */
export function replaceGeometryImage(state, action) {
  validateState(state); object(action, ['side', 'base', 'image']); image(action.image);
  matches(action.base, baseFor(state, action.side, 'IMAGE'));
  const side = state.sides[action.side];
  requireThat(action.image.version === next(side.imageRevision), 'ATLAS_GEOMETRY_IMAGE_VERSION_INVALID');
  return change(state, action.side, { ...side, image: action.image, imageRevision: action.image.version,
    physical: null, prepared: null, printed: null, confirmation: null },
  ['physical', 'preparation', 'printed', 'centering', 'mapRegistration', 'findings', 'measurement', 'inspection', 'geometryReview']);
}

export function geometryStatus(state) {
  validateState(state);
  const sides = Object.fromEntries(SIDES.map(name => {
    const side = state.sides[name];
    const ready = Boolean(side.physical && side.prepared && side.printed);
    return [name, { ready, confirmed: Boolean(side.confirmation),
      needsReview: !side.confirmation,
      ambiguous: Boolean(side.physical?.proposal?.ambiguous || side.printed?.proposal?.ambiguous),
      stage: !side.image ? 'IMAGE' : !side.physical ? 'PHYSICAL' : !side.prepared ? 'PREPARATION' : !side.printed ? 'PRINTED' : side.confirmation ? 'CONFIRMED' : 'REVIEW',
      centering: side.printed?.centering ?? null }];
  }));
  const ready = SIDES.every(name => sides[name].ready), confirmed = SIDES.every(name => sides[name].confirmed);
  return copy({ sides, canConfirmBoth: ready, confirmed,
    centeringScore: ready ? combineFrontBackScore(sides.FRONT.centering.score, sides.BACK.centering.score) : null,
    reportApproval: false });
}

/** All checks precede the single returned update. Layout approval is not this
 * card review. No automatic geometry confirmation policy has been approved.
 */
export function confirmBothGeometry(state, action) {
  validateState(state); object(action, ['base', 'actor', 'reviewed']); object(action.base, SIDES);
  requireThat(action.actor === 'HUMAN' && action.reviewed === true, 'ATLAS_GEOMETRY_HUMAN_REVIEW_REQUIRED');
  for (const name of SIDES) {
    matches(action.base[name], baseFor(state, name, 'REVIEW'));
    requireThat(state.sides[name].physical && state.sides[name].prepared && state.sides[name].printed, 'ATLAS_GEOMETRY_NOT_READY');
  }
  const result = { ...state, reportRevision: next(state.reportRevision), sides: { ...state.sides } };
  for (const name of SIDES) result.sides[name] = { ...state.sides[name], reviewRevision: next(state.sides[name].reviewRevision) };
  for (const name of SIDES) result.sides[name] = { ...result.sides[name],
    confirmation: { actor: 'HUMAN', reviewed: true, base: baseFor(result, name, 'REVIEW') } };
  return copy({ state: validateState(result), invalidated: { sides: { FRONT: [], BACK: [] }, report: true } });
}

function frameForProjection(state, name) {
  validateState(state); requireThat(SIDES.includes(name));
  const side = state.sides[name]; requireThat(side.prepared, 'ATLAS_GEOMETRY_PREPARED_FRAME_REQUIRED'); return side;
}
/** Both input and output points use GEOMETRY_CONVENTION; these never rotate or
 * mirror an already oriented image. Off-card points may project outside [0,1].
 */
export function originalPointToPrepared(state, name, point) {
  const side = frameForProjection(state, name);
  object(point, ['x', 'y']); requireThat(Number.isFinite(point.x) && Number.isFinite(point.y));
  const result = transform(side.prepared.frame.sourceToRectified, { x: point.x * side.image.width, y: point.y * side.image.height });
  return copy({ x: result.x / CARD.width, y: result.y / CARD.height });
}
export function preparedPointToOriginal(state, name, point) {
  const side = frameForProjection(state, name);
  object(point, ['x', 'y']); requireThat(Number.isFinite(point.x) && Number.isFinite(point.y));
  const result = transform(inverse(side.prepared.frame.sourceToRectified), { x: point.x * CARD.width, y: point.y * CARD.height });
  return copy({ x: result.x / side.image.width, y: result.y / side.image.height });
}
export function printedQuadOnOriginal(state, name) {
  const side = frameForProjection(state, name); requireThat(side.printed, 'ATLAS_GEOMETRY_PRINTED_REQUIRED');
  return copy(side.printed.quad.map(point => preparedPointToOriginal(state, name, point)));
}

export function parseGeometryWorkspace(value) {
  const state = typeof value === 'string' ? JSON.parse(value) : value;
  return copy(validateState(state));
}
export function serializeGeometryWorkspace(state) { validateState(state); return JSON.stringify(state); }
