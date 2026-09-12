import { canonical, digest, object, requireThat, ManualServiceError } from '@atlas/manual-service/contract';
import { createManualService } from '@atlas/manual-service';
import { applyGeometryEdit, confirmBothGeometry, geometryStatus, parseGeometryWorkspace, GeometryActionError } from '@atlas/manual-workspace/geometry-actions';
import { beginDefectEdit, applyDefectMeasurement, confirmDefectFindings, createDefectWorkspace, defectBase,
  markDefectSideInspected, parseDefectWorkspace, previewDefectReport, replaceDefectFrame, discardPendingDefectEdit, DefectActionError } from '@atlas/manual-workspace/defect-actions';
import { measureDefectWorkspaceEdit, MeasurementError } from '@atlas/measurement-runtime';
import { canonicalizeNewSpeedsterSessionIdentity, SpeedsterIdentityValidationError } from '@atlas/grading-core/identity';

const SIDES = ['FRONT', 'BACK'];
const equal = (a, b) => canonical(a) === canonical(b);
const sourceHash = value => digest(JSON.stringify(value));
export function frameFromGeometry(geometry, side) {
  const slot = geometry.sides[side];
  requireThat(slot.prepared, 409, 'MANUAL_GEOMETRY_REQUIRED');
  return { imageVersion: slot.image.version, originalSha256: slot.image.originalSha256,
    preparationVersion: slot.prepared.frame.version, frameId: slot.prepared.frame.id,
    inspectionImageSha256: slot.prepared.frame.inspection.sha256, rectifiedImageSha256: slot.prepared.frame.rectified.sha256 };
}

/** Server-only composition. Authentication/ACL and CAS belong to manual-service.
 * Full geometry, measured findings, edit bitmaps and reports live in verified
 * immutable artifacts. No photo, mask or model call occurs in a DB transaction.
 */
export function createManualWorkflow({ repository, artifacts, pythonExecutable, measurementLimits, prepare = null }) {
  const domain = work => async (...args) => {
    try { return await work(...args); }
    catch (error) {
      if (error instanceof DefectActionError || error instanceof GeometryActionError) {
        throw new ManualServiceError(/STALE|PENDING|REQUIRED|NOT_READY/.test(error.code) ? 409 : 400, error.code);
      }
      if (error instanceof MeasurementError) throw new ManualServiceError(422, error.code);
      if (error?.name === 'ZodError' || error instanceof SpeedsterIdentityValidationError) throw new ManualServiceError(400, 'MANUAL_REQUEST_INVALID');
      throw error;
    }
  };
  async function store(value, cardId, kind) {
    const hash = sourceHash(value);
    return { ref: await artifacts.write(value, { cardId, kind, sourceHash: hash }), sourceHash: hash };
  }
  async function read(cardId, kind, ref, hash) {
    const value = await artifacts.read(ref, { cardId, kind, sourceHash: hash });
    requireThat(sourceHash(value) === hash, 503, 'MANUAL_ARTIFACT_UNVERIFIED');
    return value;
  }
  async function hydrate(card) {
    const draft = card.draft;
    object(draft, ['version', 'geometry', 'defects', 'identity', 'identityRevision']);
    requireThat(draft.version === 'atlas-manual-workflow-v1', 503, 'MANUAL_DRAFT_INVALID');
    const [g, d] = await Promise.all([read(card.cardId, 'GEOMETRY', draft.geometry.ref, draft.geometry.sourceHash),
      read(card.cardId, 'DEFECTS', draft.defects.ref, draft.defects.sourceHash)]);
    const geometry = parseGeometryWorkspace(g), defects = parseDefectWorkspace(d);
    requireThat(geometry.cardId === card.cardId && defects.cardId === card.cardId && geometry.profile === defects.profile,
      503, 'MANUAL_DRAFT_INVALID');
    for (const side of SIDES) if (geometry.sides[side].prepared) {
      requireThat(equal(frameFromGeometry(geometry, side), defects.sides[side].frame)
        && geometry.sides[side].cornerShape === defects.sides[side].cornerShape, 503, 'MANUAL_FRAME_MISMATCH');
    }
    return { geometry, defects, identity: draft.identity };
  }
  async function provision(staff, { geometry: input, identity }) {
    const geometry = parseGeometryWorkspace(input), cardId = geometry.cardId;
    const defects = createDefectWorkspace({ cardId, profile: geometry.profile, sides: Object.fromEntries(SIDES.map(side => [side,
      { frame: frameFromGeometry(geometry, side), cornerShape: geometry.sides[side].cornerShape }])) });
    const draft = { version: 'atlas-manual-workflow-v1', geometry: await store(geometry, cardId, 'GEOMETRY'),
      defects: await store(defects, cardId, 'DEFECTS'), identity: canonicalizeNewSpeedsterSessionIdentity(geometry.profile, identity), identityRevision: 1 };
    return repository.provision(staff, { cardId, draft });
  }
  async function reduce({ card, action }) {
    let { geometry, defects } = await hydrate(card);
    let draft = card.draft;
    if (action.type === 'GEOMETRY_EDIT') {
      object(action, ['type', 'edit']);
      object(action.edit, ['side', 'kind', 'base', 'quad']);
      geometry = applyGeometryEdit(geometry, { ...action.edit, actor: 'HUMAN', proposal: null }).state;
      // Preparation is a separate durable action: a failed CPU pass retains the
      // saved physical outline and a reload still exposes Retry preparation.
    } else if (action.type === 'PREPARE_SIDE') {
      object(action, ['type', 'side']); requireThat(SIDES.includes(action.side) && typeof prepare === 'function', 503, 'MANUAL_PREPARATION_UNAVAILABLE');
      try { geometry = parseGeometryWorkspace(await prepare({ geometry, side: action.side })); }
      catch (error) {
        if (error?.name === 'PreparationError') throw new ManualServiceError(422, 'MANUAL_PREPARATION_FAILED');
        throw error;
      }
      defects = replaceDefectFrame(defects, { side: action.side, base: defectBase(defects, action.side),
        frame: frameFromGeometry(geometry, action.side), cornerShape: geometry.sides[action.side].cornerShape }).state;
    } else if (action.type === 'CONFIRM_GEOMETRY') {
      object(action, ['type', 'base', 'reviewed']);
      geometry = confirmBothGeometry(geometry, { base: action.base, reviewed: action.reviewed, actor: 'HUMAN' }).state;
    } else if (action.type === 'IDENTITY_EDIT') {
      object(action, ['type', 'identity']);
      draft = { ...draft, identity: canonicalizeNewSpeedsterSessionIdentity(geometry.profile, action.identity), identityRevision: draft.identityRevision + 1 };
    } else {
      requireThat(geometryStatus(geometry).confirmed, 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
      if (action.type === 'DEFECT_EDIT' || action.type === 'TRACE_SAVE') {
        let edit;
        if (action.type === 'TRACE_SAVE') {
          object(action, ['type', 'side', 'base', 'findingId', 'traceRef', 'traceSourceHash']);
          requireThat(action.traceSourceHash === digest(canonical(action.base)), 409, 'MANUAL_TRACE_STALE');
          const trace = await artifacts.read(action.traceRef, { cardId: card.cardId, kind: 'EDIT', sourceHash: action.traceSourceHash });
          edit = { type: 'TRACE_SAVE', side: action.side, findingId: action.findingId, trace };
        } else { object(action, ['type', 'side', 'base', 'edit']); edit = action.edit; }
        defects = beginDefectEdit(defects, { side: action.side, base: action.base, actor: 'HUMAN', action: edit }).state;
      } else if (action.type === 'MEASURE_SIDE') {
        object(action, ['type', 'side']);
        defects = applyDefectMeasurement(defects, await measureDefectWorkspaceEdit({ workspace: defects, side: action.side,
          pythonExecutable, limits: measurementLimits })).state;
      } else if (action.type === 'DISCARD_PENDING') {
        object(action, ['type', 'side', 'base']);
        defects = discardPendingDefectEdit(defects, { side: action.side, base: action.base, actor: 'HUMAN' }).state;
      } else if (action.type === 'INSPECT_SIDE') {
        object(action, ['type', 'side', 'base', 'inspected']);
        defects = markDefectSideInspected(defects, { side: action.side, base: action.base, inspected: action.inspected, actor: 'HUMAN' }).state;
      } else if (action.type === 'CONFIRM_FINDINGS') {
        object(action, ['type', 'base', 'reviewed']);
        defects = confirmDefectFindings(defects, { base: action.base, reviewed: action.reviewed, actor: 'HUMAN' }).state;
      } else requireThat(false, 400, 'MANUAL_ACTION_UNSUPPORTED');
    }
    return { ...draft, geometry: await store(geometry, card.cardId, 'GEOMETRY'), defects: await store(defects, card.cardId, 'DEFECTS') };
  }
  async function buildReport({ card }) {
    const { geometry, defects, identity } = await hydrate(card);
    requireThat(geometryStatus(geometry).confirmed, 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
    const full = previewDefectReport(defects, { identity, centeringQuads: Object.fromEntries(SIDES.map(side => [side, geometry.sides[side].printed.quad])),
      draftRevision: geometry.reportRevision + defects.draftRevision + card.draft.identityRevision });
    const report = await store(full, card.cardId, 'REPORT');
    return { version: 'atlas-manual-report-snapshot-v1', report, identity: full.identity, grade: full.grade,
      findingCounts: full.findingCounts, ruleVersion: full.ruleVersion };
  }
  const service = createManualService({ repository, reduce: domain(reduce), buildReport: domain(buildReport) });
  return Object.freeze({ service, hydrate, provision,
    stageTrace: domain(async (staff, cardId, request) => {
      object(request, ['side', 'base', 'findingId', 'trace']);
      const { card } = await service.authorizeEdit(staff, cardId), { geometry, defects } = await hydrate(card);
      requireThat(geometryStatus(geometry).confirmed, 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
      // Parse the exact unchanged wire before storing any user trace. Client
      // actor labels never enter the public envelope or the server authority.
      beginDefectEdit(defects, { side: request.side, base: request.base, actor: 'HUMAN',
        action: { type: 'TRACE_SAVE', side: request.side, findingId: request.findingId, trace: request.trace } });
      const traceSourceHash = digest(canonical(request.base));
      const traceRef = await artifacts.write(request.trace, { cardId, kind: 'EDIT', sourceHash: traceSourceHash });
      return { type: 'TRACE_SAVE', side: request.side, base: request.base, findingId: request.findingId, traceRef, traceSourceHash };
    }),
  });
}
