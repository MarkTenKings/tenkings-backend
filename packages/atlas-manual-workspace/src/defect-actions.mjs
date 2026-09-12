import { speedsterReviewPostSchema } from '@atlas/grading-core/review-action-contract';
import { parsePersistedSpeedsterReviewFindings } from '@atlas/grading-core/review-findings';
import { completeSpeedsterReview, remeasureSpeedsterReviewAction } from '@atlas/grading-core/review';
import { decodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { encodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { previewAtlasManualReport } from '@atlas/grading-core/manual-report';

/** In-memory exact evidence and pure actions. The authenticated host owns actor,
 * durable revisions, immutable artifact storage and verified CPU results. Never
 * put this full state in a compact database row: masks and trace wires belong in
 * a hash-verified artifact. No action approves a report or publishes learning. */
const SIDES = ['FRONT', 'BACK'];
const HASH = /^[a-f0-9]{64}$/;
const validatedStates = new WeakSet();
export class DefectActionError extends Error {
  constructor(code) { super(code); this.name = 'DefectActionError'; this.code = code; }
}
function requireThat(ok, code = 'ATLAS_DEFECT_INVALID') { if (!ok) throw new DefectActionError(code); }
function object(value, keys, optional = []) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype
    && keys.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => keys.includes(key) || optional.includes(key)));
}
function integer(value, minimum = 0) { requireThat(Number.isSafeInteger(value) && value >= minimum); }
function text(value) { requireThat(typeof value === 'string' && value.length > 0 && value.length <= 512
  && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value)); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  requireThat(value === null || ['string', 'boolean', 'number'].includes(typeof value));
  if (typeof value === 'number') requireThat(Number.isFinite(value));
  return JSON.stringify(value);
}
function equal(a, b) { return canonical(a) === canonical(b); }
function matches(a, b) { requireThat(equal(a, b), 'ATLAS_DEFECT_STALE'); }
function copy(value) {
  const cloned = JSON.parse(JSON.stringify(value));
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  return freeze(cloned);
}
function next(value) { integer(value); integer(value + 1, 1); return value + 1; }
function publish(value) {
  const result = copy(value);
  validatedStates.add(result.state ?? result);
  return result;
}
function frame(value) {
  object(value, ['imageVersion', 'originalSha256', 'preparationVersion', 'frameId', 'inspectionImageSha256', 'rectifiedImageSha256']);
  integer(value.imageVersion, 1); integer(value.preparationVersion, 1); text(value.frameId);
  for (const key of ['originalSha256', 'inspectionImageSha256', 'rectifiedImageSha256']) requireThat(HASH.test(value[key]));
  requireThat(value.inspectionImageSha256 !== value.rectifiedImageSha256);
}
function material(value) { requireThat(['SQUARE', 'ROUNDED_3_18_MM'].includes(value)); }
function findings(value, side) {
  const parsed = parsePersistedSpeedsterReviewFindings(value);
  requireThat(new Set(parsed.map(f => f.id)).size === parsed.length, 'ATLAS_DEFECT_ID_CONFLICT');
  for (const finding of parsed) {
    requireThat(finding.side === side && finding.sourceViewId.startsWith(`${side}:`), 'ATLAS_DEFECT_SIDE_MISMATCH');
    requireThat(['DETECTOR', 'MEMORY', 'SMART_MARK'].includes(finding.origin), 'ATLAS_DEFECT_PROVENANCE_INVALID');
    requireThat(finding.finalTrace || finding.detectorMask, 'ATLAS_DEFECT_EXACT_MASK_REQUIRED');
    if (finding.reviewResult === 'REMOVED') requireThat(finding.reviewResultBeforeRemoval,
      'ATLAS_DEFECT_REMOVAL_HISTORY_REQUIRED');
  }
  return parsed;
}
function baseFor(state, side) {
  requireThat(SIDES.includes(side));
  const slot = state.sides[side];
  return { schemaVersion: 1, cardId: state.cardId, profile: state.profile, side,
    frame: slot.frame, cornerShape: slot.cornerShape, findingRevision: slot.findingRevision,
    reviewRevision: slot.reviewRevision };
}
function parseAction(value, slot, side) {
  const wire = speedsterReviewPostSchema.parse({ action: value }).action;
  requireThat(wire.type !== 'INITIALIZE');
  const ids = wire.type === 'TRACE_SAVE' ? wire.findingId ? [wire.findingId] : []
    : wire.type === 'CHANGE_TYPE' ? [wire.defectId] : wire.defectIds;
  requireThat(new Set(ids).size === ids.length, 'ATLAS_DEFECT_ID_CONFLICT');
  const targets = ids.map(id => {
    const target = slot.findings.find(f => f.id === id);
    requireThat(target, 'ATLAS_DEFECT_NOT_FOUND'); return target;
  });
  for (const target of targets) {
    if (wire.type === 'UNDO') requireThat(target.reviewResult === 'REMOVED' && target.reviewResultBeforeRemoval,
      'ATLAS_DEFECT_NOT_REMOVED');
    else requireThat(target.reviewResult !== 'REMOVED', 'ATLAS_DEFECT_REMOVED');
  }
  if (wire.type === 'TRACE_SAVE') {
    requireThat(wire.side === side, 'ATLAS_DEFECT_SIDE_MISMATCH');
    if (wire.findingId === null) requireThat(!slot.findings.some(f => f.id === wire.trace.id), 'ATLAS_DEFECT_ID_CONFLICT');
    const source = wire.findingId === null ? wire.trace.sourceViewId : targets[0].sourceViewId;
    requireThat(source.startsWith(`${side}:`) && source === wire.trace.traceProvenance.sourceViewId,
      'ATLAS_DEFECT_PROVENANCE_INVALID');
    const rle = encodeSpeedsterTraceRleV1(decodeSpeedsterTraceBitmapWireV1(wire.trace.traceWire));
    const provenance = wire.trace.traceProvenance, crop = provenance.cropTransform.crop;
    requireThat(rle.sha256 === provenance.finalTraceSha256 && crop.x >= 0 && crop.y >= 0
      && crop.width > 0 && crop.height > 0 && crop.x + crop.width <= 1269 && crop.y + crop.height <= 1777,
    'ATLAS_DEFECT_PROVENANCE_INVALID');
  }
  return wire;
}
function cpuAction(wire) {
  if (wire.type !== 'TRACE_SAVE') return wire;
  const { traceWire, ...trace } = wire.trace;
  return { ...wire, trace: { ...trace, finalTrace: encodeSpeedsterTraceRleV1(decodeSpeedsterTraceBitmapWireV1(traceWire)) } };
}
function validate(state) {
  // Only this module's deeply frozen outputs are cached. Mutable/rehydrated
  // inputs are fully checked; repeated browser renders need not decode the
  // same 2.26-million-pixel pending bitmap merely to read its revision.
  if (validatedStates.has(state)) return state;
  object(state, ['schemaVersion', 'cardId', 'profile', 'draftRevision', 'sides', 'confirmation']);
  requireThat(state.schemaVersion === 1 && ['SPORTS', 'POKEMON'].includes(state.profile));
  text(state.cardId); integer(state.draftRevision, 1); object(state.sides, SIDES);
  const allIds = [];
  for (const side of SIDES) {
    const slot = state.sides[side];
    object(slot, ['frame', 'cornerShape', 'findingRevision', 'reviewRevision', 'findings', 'pending', 'inspection', 'humanEditedIds', 'source', 'measurement']);
    frame(slot.frame); material(slot.cornerShape); integer(slot.findingRevision, 1); integer(slot.reviewRevision);
    requireThat(slot.findingRevision <= state.draftRevision && slot.reviewRevision <= state.draftRevision);
    allIds.push(...findings(slot.findings, side).map(f => f.id));
    requireThat(Array.isArray(slot.humanEditedIds) && new Set(slot.humanEditedIds).size === slot.humanEditedIds.length);
    slot.humanEditedIds.forEach(text);
    object(slot.source, ['method'], ['version', 'id', 'map']);
    requireThat(['HUMAN', 'DETECTOR'].includes(slot.source.method));
    if (slot.source.method === 'DETECTOR') { text(slot.source.version); text(slot.source.id); }
    if (slot.measurement !== null) {
      object(slot.measurement, ['base', 'receipt']);
      const measured = slot.measurement.base, current = baseFor(state, side);
      requireThat(measured.findingRevision <= current.findingRevision && measured.reviewRevision <= current.reviewRevision);
      matches({ ...measured, findingRevision: current.findingRevision, reviewRevision: current.reviewRevision }, current);
    }
    if (slot.pending !== null) {
      object(slot.pending, ['actor', 'action'], ['previousCornerShape']); requireThat(['HUMAN', 'ENGINE'].includes(slot.pending.actor));
      if (slot.pending.action.type === 'REMEASURE') {
        object(slot.pending.action, ['type']); material(slot.pending.previousCornerShape);
        requireThat(slot.pending.actor === 'HUMAN' && slot.pending.previousCornerShape !== slot.cornerShape);
      }
      else parseAction(slot.pending.action, slot, side);
      requireThat(slot.inspection === null && slot.measurement === null);
    }
    if (slot.inspection !== null) {
      object(slot.inspection, ['inspected', 'imageSha256', 'findingRevision']);
      requireThat(slot.inspection.inspected === true && slot.inspection.imageSha256 === slot.frame.inspectionImageSha256
        && slot.inspection.findingRevision === slot.findingRevision, 'ATLAS_DEFECT_INSPECTION_STALE');
    }
  }
  requireThat(new Set(allIds).size === allIds.length, 'ATLAS_DEFECT_ID_CONFLICT');
  if (state.confirmation !== null) {
    object(state.confirmation, ['actor', 'base']); object(state.confirmation.base, SIDES);
    requireThat(state.confirmation.actor === 'HUMAN');
    for (const side of SIDES) {
      matches(state.confirmation.base[side], baseFor(state, side));
      requireThat(state.sides[side].inspection && !state.sides[side].pending, 'ATLAS_DEFECT_INSPECTION_REQUIRED');
      requireThat(state.sides[side].findings.every(f => f.reviewResult !== 'UNREVIEWED'));
    }
  }
  return state;
}
function changed(state, side, slot, invalidated = ['measurement', 'inspection', 'findingsConfirmation', 'report']) {
  const result = { ...state, draftRevision: next(state.draftRevision), sides: { ...state.sides, [side]: slot }, confirmation: null };
  return publish({ state: validate(result), invalidated: { sides: { FRONT: [], BACK: [], [side]: invalidated }, report: true } });
}
export function createDefectWorkspace(input) {
  object(input, ['cardId', 'profile', 'sides']); object(input.sides, SIDES);
  const state = { schemaVersion: 1, cardId: input.cardId, profile: input.profile, draftRevision: 1, sides: {}, confirmation: null };
  for (const side of SIDES) {
    object(input.sides[side], ['frame', 'cornerShape']);
    state.sides[side] = { ...input.sides[side], findingRevision: 1, reviewRevision: 0, findings: [], pending: null,
      inspection: null, humanEditedIds: [], source: { method: 'HUMAN' }, measurement: null };
  }
  return publish(validate(state));
}
export function parseDefectWorkspace(value) { return publish(validate(typeof value === 'string' ? JSON.parse(value) : value)); }
export function serializeDefectWorkspace(state) { validate(state); return JSON.stringify(state); }
export function defectBase(state, side) { validate(state); return copy(baseFor(state, side)); }
export function beginDefectEdit(state, request) {
  validate(state); object(request, ['side', 'base', 'actor', 'action']);
  requireThat(request.actor === 'HUMAN', 'ATLAS_DEFECT_HUMAN_REQUIRED');
  matches(request.base, baseFor(state, request.side));
  const slot = state.sides[request.side]; requireThat(slot.pending === null, 'ATLAS_DEFECT_MEASUREMENT_PENDING');
  const action = parseAction(request.action, slot, request.side);
  const ids = action.type === 'TRACE_SAVE' ? [action.findingId ?? action.trace.id]
    : action.type === 'CHANGE_TYPE' ? [action.defectId] : action.defectIds;
  requireThat(!ids.some(id => state.sides[request.side === 'FRONT' ? 'BACK' : 'FRONT'].findings.some(f => f.id === id)), 'ATLAS_DEFECT_ID_CONFLICT');
  return changed(state, request.side, { ...slot, findingRevision: next(slot.findingRevision),
    pending: { actor: 'HUMAN', action }, humanEditedIds: [...new Set([...slot.humanEditedIds, ...ids])], inspection: null, measurement: null });
}
/** Late map filtering never removes a human-edited DETECTOR-origin finding.
 * Only still-unreviewed, untouched proposals in the evaluated revision qualify.
 * Full affected-side measurement must finish before this candidate is adopted. */
export function beginDefectMapFilter(state, request) {
  validate(state); object(request, ['side', 'base', 'removedFindingIds', 'map']);
  matches(request.base, baseFor(state, request.side)); object(request.map, ['revisionId', 'sha256']);
  text(request.map.revisionId); requireThat(HASH.test(request.map.sha256));
  const slot = state.sides[request.side]; requireThat(!slot.pending, 'ATLAS_DEFECT_MEASUREMENT_PENDING');
  const action = parseAction({ type: 'REMOVE', defectIds: request.removedFindingIds }, slot, request.side);
  for (const id of action.defectIds) {
    const finding = slot.findings.find(f => f.id === id);
    requireThat(finding.reviewResult === 'UNREVIEWED' && finding.origin !== 'SMART_MARK'
      && !slot.humanEditedIds.includes(id) && !slot.inspection, 'ATLAS_DEFECT_HUMAN_FINDING_PROTECTED');
  }
  return changed(state, request.side, { ...slot, findingRevision: next(slot.findingRevision),
    pending: { actor: 'ENGINE', action }, source: { ...slot.source, map: request.map }, inspection: null, measurement: null });
}
/** Candidate remains separately visible on failure. Discard is itself a new
 * revision: an older pending response cannot regain authority after undo. */
export function discardPendingDefectEdit(state, request) {
  validate(state); object(request, ['side', 'base', 'actor']); requireThat(request.actor === 'HUMAN', 'ATLAS_DEFECT_HUMAN_REQUIRED');
  matches(request.base, baseFor(state, request.side)); const slot = state.sides[request.side];
  requireThat(slot.pending, 'ATLAS_DEFECT_NO_PENDING_EDIT');
  return changed(state, request.side, { ...slot, findingRevision: next(slot.findingRevision), pending: null,
    cornerShape: slot.pending.previousCornerShape ?? slot.cornerShape, measurement: null, inspection: null });
}
function checkedMeasurement(input, result) {
  requireThat(result && Array.isArray(result.defects) && !result.traceErrors?.length, 'ATLAS_DEFECT_MEASUREMENT_INVALID');
  const measured = findings(result.defects, input.side);
  requireThat(measured.every(f => f.reviewResult !== 'REMOVED'), 'ATLAS_DEFECT_MEASUREMENT_INVALID');
  const expected = new Map([...input.findings, ...input.marks].map(f => [f.id, f]));
  // Fully shadowed detector sources may disappear; every exact trace must be
  // reconciled by the checked CPU engine, even when its regions are empty.
  for (const prior of expected.values()) if (prior.finalTrace) requireThat(measured.some(f => f.id === prior.id), 'ATLAS_DEFECT_MEASUREMENT_MISSING');
  for (const finding of measured) {
    const prior = expected.get(finding.id);
    requireThat(prior && finding.defectType === prior.defectType && finding.sourceViewId === prior.sourceViewId,
      'ATLAS_DEFECT_MEASUREMENT_MISMATCH');
    if (prior.finalTrace) requireThat(finding.finalTrace?.sha256 === prior.finalTrace.sha256, 'ATLAS_DEFECT_MEASUREMENT_MISMATCH');
  }
  return { defects: measured };
}
/** measure receives exact captured frame/material/base plus the unchanged core
 * callback payload. A host must supply a trusted checked CPU adapter, never a
 * browser's asserted areas. This pure wrapper does not authenticate a callback. */
export async function runDefectMeasurement(state, side, measure) {
  const snapshot = parseDefectWorkspace(state), slot = snapshot.sides[side];
  requireThat(slot?.pending && typeof measure === 'function', 'ATLAS_DEFECT_NO_PENDING_EDIT');
  const base = defectBase(snapshot, side); let receipt = null;
  const callback = async input => {
      const result = await measure(copy({ ...input, base, frame: slot.frame, cornerShape: slot.cornerShape }));
      const checked = checkedMeasurement(input, result); receipt = result.receipt ?? null;
      return checked;
    };
  const measured = slot.pending.action.type === 'REMEASURE'
    ? [...slot.findings.filter(f => f.reviewResult === 'REMOVED'),
        ...(await callback({ side, findings: slot.findings.filter(f => f.reviewResult !== 'REMOVED'), marks: [] })).defects.map(measured => {
          const prior = slot.findings.find(f => f.id === measured.id);
          // Material changes keep source/review metadata; only actual region
          // measurements come from the CPU pass. No type or trace is edited.
          return measured.finalTrace
            ? { ...prior, measurementRegions: measured.measurementRegions }
            : { ...prior, zone: measured.zone, canonicalContour: measured.canonicalContour, measurement: measured.measurement };
        })]
    : await remeasureSpeedsterReviewAction({ defects: slot.findings, action: cpuAction(slot.pending.action), measure: callback });
  return copy({ side, base, findings: findings(measured, side), receipt });
}
export function applyDefectMeasurement(state, result) {
  validate(state); object(result, ['side', 'base', 'findings', 'receipt']);
  matches(result.base, baseFor(state, result.side)); const slot = state.sides[result.side];
  requireThat(slot.pending, 'ATLAS_DEFECT_NO_PENDING_EDIT');
  const measured = findings(result.findings, result.side);
  // Current action/source/CPU verification happens in runDefectMeasurement.
  // This adoption boundary independently fences revisions and other-side IDs.
  return changed(state, result.side, { ...slot, findings: measured, pending: null,
    measurement: { base: result.base, receipt: result.receipt } }, ['findingsConfirmation', 'report']);
}
/** Already measured, exact detector proposals only. Initialization is optional;
 * an empty human inspection needs no detector version or invented result. */
export function adoptDefectProposals(state, request) {
  validate(state); object(request, ['side', 'base', 'findings', 'source']);
  matches(request.base, baseFor(state, request.side)); object(request.source, ['method', 'version', 'id']);
  requireThat(request.source.method === 'DETECTOR'); text(request.source.version); text(request.source.id);
  const slot = state.sides[request.side];
  requireThat(!slot.pending && !slot.inspection && !slot.humanEditedIds.length && slot.findings.every(f => f.reviewResult === 'UNREVIEWED'),
    'ATLAS_DEFECT_HUMAN_FINDING_PROTECTED');
  const proposals = findings(request.findings, request.side);
  requireThat(proposals.every(f => f.reviewResult === 'UNREVIEWED' && f.origin !== 'SMART_MARK'), 'ATLAS_DEFECT_PROVENANCE_INVALID');
  return changed(state, request.side, { ...slot, findingRevision: next(slot.findingRevision), findings: proposals,
    source: request.source, inspection: null, measurement: null });
}
export function replaceDefectFrame(state, request) {
  validate(state); object(request, ['side', 'base', 'frame', 'cornerShape']); matches(request.base, baseFor(state, request.side));
  frame(request.frame); material(request.cornerShape); const slot = state.sides[request.side];
  if (equal(request.frame, slot.frame)) {
    requireThat(request.cornerShape !== slot.cornerShape, 'ATLAS_DEFECT_FRAME_UNCHANGED');
    requireThat(!slot.pending, 'ATLAS_DEFECT_MEASUREMENT_PENDING');
    return changed(state, request.side, { ...slot, cornerShape: request.cornerShape,
      findingRevision: next(slot.findingRevision), pending: { actor: 'HUMAN', action: { type: 'REMEASURE' }, previousCornerShape: slot.cornerShape },
      measurement: null, inspection: null });
  }
  requireThat(request.frame.imageVersion >= slot.frame.imageVersion && request.frame.preparationVersion >= slot.frame.preparationVersion,
    'ATLAS_DEFECT_STALE');
  requireThat(request.frame.imageVersion > slot.frame.imageVersion
    || (request.frame.originalSha256 === slot.frame.originalSha256 && request.frame.preparationVersion > slot.frame.preparationVersion),
  'ATLAS_DEFECT_STALE');
  return changed(state, request.side, { ...slot, frame: request.frame, cornerShape: request.cornerShape,
    findingRevision: next(slot.findingRevision), findings: [], pending: null, inspection: null,
    humanEditedIds: [], source: { method: 'HUMAN' }, measurement: null });
}
export function markDefectSideInspected(state, request) {
  validate(state); object(request, ['side', 'base', 'actor', 'inspected']);
  requireThat(request.actor === 'HUMAN' && request.inspected === true, 'ATLAS_DEFECT_HUMAN_REQUIRED');
  matches(request.base, baseFor(state, request.side)); const slot = state.sides[request.side];
  requireThat(!slot.pending, 'ATLAS_DEFECT_MEASUREMENT_PENDING');
  return changed(state, request.side, { ...slot, reviewRevision: next(slot.reviewRevision),
    inspection: { inspected: true, imageSha256: slot.frame.inspectionImageSha256, findingRevision: slot.findingRevision } }, ['findingsConfirmation', 'report']);
}
export function confirmDefectFindings(state, request) {
  validate(state); object(request, ['base', 'actor', 'reviewed']); object(request.base, SIDES);
  requireThat(request.actor === 'HUMAN' && request.reviewed === true, 'ATLAS_DEFECT_HUMAN_REQUIRED');
  for (const side of SIDES) {
    matches(request.base[side], baseFor(state, side));
    requireThat(state.sides[side].inspection && !state.sides[side].pending, 'ATLAS_DEFECT_INSPECTION_REQUIRED');
  }
  const result = { ...state, draftRevision: next(state.draftRevision), sides: {} };
  for (const side of SIDES) {
    const slot = state.sides[side], findingRevision = next(slot.findingRevision);
    result.sides[side] = { ...slot, findingRevision, findings: completeSpeedsterReview(slot.findings),
      inspection: { ...slot.inspection, findingRevision } };
  }
  result.confirmation = { actor: 'HUMAN', base: Object.fromEntries(SIDES.map(side => [side, baseFor(result, side)])) };
  return publish({ state: validate(result), invalidated: { sides: { FRONT: [], BACK: [] }, report: true } });
}
export function defectStatus(state) {
  validate(state);
  const sides = Object.fromEntries(SIDES.map(side => {
    const slot = state.sides[side];
    return [side, { settled: !slot.pending, canInspect: !slot.pending, inspected: Boolean(slot.inspection),
      findingRevision: slot.findingRevision, included: slot.findings.filter(f => f.reviewResult !== 'REMOVED').length,
      removed: slot.findings.filter(f => f.reviewResult === 'REMOVED').length }];
  }));
  return copy({ sides, settled: SIDES.every(side => sides[side].settled),
    canConfirm: SIDES.every(side => sides[side].settled && sides[side].inspected),
    confirmed: Boolean(state.confirmation), reportApproval: false, learningPublished: false });
}
/** Identity/border changes affect draft report content only; they do not erase
 * still-current per-side inspection. The caller supplies its report revision. */
export function previewDefectReport(state, { identity, centeringQuads, draftRevision = state.draftRevision }) {
  validate(state); requireThat(state.confirmation, 'ATLAS_DEFECT_CONFIRMATION_REQUIRED');
  return previewAtlasManualReport({ cardProfile: state.profile, identity, draftRevision,
    findingRevisions: { front: state.sides.FRONT.findingRevision, back: state.sides.BACK.findingRevision },
    capture: Object.fromEntries(SIDES.map(side => [side.toLowerCase(), { centeringQuad: centeringQuads[side],
      inspectionImageSha256: state.sides[side].frame.inspectionImageSha256 }])),
    reviewedDefects: SIDES.flatMap(side => state.sides[side].findings),
    manualInspection: { method: 'HUMAN', front: state.sides.FRONT.inspection, back: state.sides.BACK.inspection } });
}
