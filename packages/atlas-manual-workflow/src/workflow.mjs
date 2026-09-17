import { canonical, digest, object, requireThat, ManualServiceError } from '@atlas/manual-service/contract';
import { createManualService } from '@atlas/manual-service';
import { applyGeometryEdit, confirmBothGeometry, geometryStatus, parseGeometryWorkspace, GeometryActionError } from '@atlas/manual-workspace/geometry-actions';
import { beginDefectEdit, applyDefectMeasurement, confirmDefectFindings, createDefectWorkspace, defectBase,
  markDefectSideInspected, parseDefectWorkspace, previewDefectReport, replaceDefectFrame, discardPendingDefectEdit, DefectActionError } from '@atlas/manual-workspace/defect-actions';
import { measureDefectWorkspaceEdit, MeasurementError } from '@atlas/measurement-runtime';
import { canonicalizeNewSpeedsterSessionIdentity, SpeedsterIdentityValidationError } from '@atlas/grading-core/identity';

import { proposalEdit, checkProposalReview, invalidateDefectConfirmation } from './proposal-review.mjs';

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
export function createManualWorkflow({ repository, artifacts, pythonExecutable, measurementLimits, prepare = null, replaceSources = null, assertCurrent = null, measure = measureDefectWorkspaceEdit, resolveProposal = null, afterConfirm = null }) {
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
    object(draft, ['version', 'geometry', 'defects', 'identity', 'identityRevision', ...(draft.version === 'atlas-manual-workflow-v2' ? ['source'] : []), ...(Object.hasOwn(draft, 'assistance') ? ['assistance'] : [])]);
    requireThat(['atlas-manual-workflow-v1', 'atlas-manual-workflow-v2'].includes(draft.version), 503, 'MANUAL_DRAFT_INVALID');
    const [g, d] = await Promise.all([read(card.cardId, 'GEOMETRY', draft.geometry.ref, draft.geometry.sourceHash),
      draft.defects ? read(card.cardId, 'DEFECTS', draft.defects.ref, draft.defects.sourceHash) : null]);
    const geometry = parseGeometryWorkspace(g), defects = d ? parseDefectWorkspace(d) : null;
    requireThat(geometry.cardId === card.cardId && (!defects || defects.cardId === card.cardId && geometry.profile === defects.profile),
      503, 'MANUAL_DRAFT_INVALID');
    for (const side of SIDES) if (defects && geometry.sides[side].prepared) {
      requireThat(equal(frameFromGeometry(geometry, side), defects.sides[side].frame)
        && geometry.sides[side].cornerShape === defects.sides[side].cornerShape, 503, 'MANUAL_FRAME_MISMATCH');
    }
    const assistance = draft.assistance ? await read(card.cardId, 'ASSISTANCE', draft.assistance.ref, draft.assistance.sourceHash) : null;
    requireThat(!assistance || assistance.version === 'atlas-defect-assistance-v1' && Array.isArray(assistance.reviews) && assistance.reviews.length <= 200, 503, 'MANUAL_ASSISTANCE_INVALID');
    return { geometry, defects, identity: draft.identity, ...(assistance ? { assistance } : {}) };
  }
  function initialDefects(geometry) {
    return SIDES.every(side => geometry.sides[side].prepared) ? createDefectWorkspace({cardId:geometry.cardId,profile:geometry.profile,
      sides:Object.fromEntries(SIDES.map(side=>[side,{frame:frameFromGeometry(geometry,side),cornerShape:geometry.sides[side].cornerShape}]))}) : null;
  }
  async function provision(staff, { geometry: input, identity, source = null }) {
    const geometry = parseGeometryWorkspace(input), cardId = geometry.cardId;
    const defects = initialDefects(geometry);
    const draft = { version: source ? 'atlas-manual-workflow-v2' : 'atlas-manual-workflow-v1', ...(source ? { source } : {}), geometry: await store(geometry, cardId, 'GEOMETRY'),
      defects: defects ? await store(defects, cardId, 'DEFECTS') : null, identity: canonicalizeNewSpeedsterSessionIdentity(geometry.profile, identity), identityRevision: 1 };
    return repository.provision(staff, { cardId, draft });
  }
  async function reduce({ card, action, principal }, staff) {
    let { geometry, defects, assistance } = await hydrate(card);
    let draft = card.draft;
    if (action.type === 'REPLACE_SOURCES') {
      object(action, ['type', 'sourceHash']);
      requireThat(typeof replaceSources === 'function', 503, 'MANUAL_PREPARATION_UNAVAILABLE');
      const profile = geometry.profile;
      const replaced = await replaceSources({ card, geometry, principal, sourceHash: action.sourceHash, staff });
      geometry = parseGeometryWorkspace(replaced.geometry);
      requireThat(geometry.cardId === card.cardId && geometry.profile === profile, 409, 'MANUAL_SOURCE_PROFILE_MISMATCH');
      if(defects){for(const side of replaced.changedSides){if(geometry.sides[side].prepared)defects=replaceDefectFrame(defects,{side,base:defectBase(defects,side),
        frame:frameFromGeometry(geometry,side),cornerShape:geometry.sides[side].cornerShape}).state;}}
      else defects = initialDefects(geometry);
      draft = { ...draft, version: 'atlas-manual-workflow-v2', source: replaced.source };
    } else if (action.type === 'GEOMETRY_EDIT') {
      object(action, ['type', 'edit']);
      object(action.edit, ['side', 'kind', 'base', 'quad']);
      geometry = applyGeometryEdit(geometry, { ...action.edit, actor: 'HUMAN', proposal: null }).state;
      // Preparation is a separate durable action: a failed CPU pass retains the
      // saved physical outline and a reload still exposes Retry preparation.
    } else if (action.type === 'PREPARE_SIDE') {
      object(action, ['type', 'side']); requireThat(SIDES.includes(action.side) && typeof prepare === 'function', 503, 'MANUAL_PREPARATION_UNAVAILABLE');
      try {
        const prepared = await prepare({ geometry, side: action.side, source: draft.source, staff });
        geometry = parseGeometryWorkspace(prepared.geometry ?? prepared);
        if (prepared.source) draft = { ...draft, source: prepared.source };
      }
      catch (error) {
        if (error?.name === 'PreparationError') throw new ManualServiceError(422, 'MANUAL_PREPARATION_FAILED');
        throw error;
      }
      defects = defects ? replaceDefectFrame(defects, { side: action.side, base: defectBase(defects, action.side),
        frame: frameFromGeometry(geometry, action.side), cornerShape: geometry.sides[action.side].cornerShape }).state : initialDefects(geometry);
    } else if (action.type === 'CONFIRM_GEOMETRY') {
      object(action, ['type', 'base', 'reviewed']);
      geometry = confirmBothGeometry(geometry, { base: action.base, reviewed: action.reviewed, actor: 'HUMAN' }).state;
    } else if (action.type === 'IDENTITY_EDIT') {
      object(action, ['type', 'identity']);
      draft = { ...draft, identity: canonicalizeNewSpeedsterSessionIdentity(geometry.profile, action.identity), identityRevision: draft.identityRevision + 1 };
    } else {
      requireThat(defects && geometryStatus(geometry).confirmed, 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
      if (action.type === 'ASTRA_PROPOSAL_REVIEW') {
        object(action, ['type', 'side', 'base', 'analysisId', 'proposalId', 'action', ...(action.action === 'TRACE_SAVE' ? ['traceRef', 'traceSourceHash'] : [])]);
        const allowed = await repository.authorizeEdit(staff, card.cardId);
        requireThat(allowed.card.contentHash === card.contentHash, 409, 'MANUAL_DRAFT_STALE');
        requireThat(typeof resolveProposal === 'function', 503, 'MANUAL_PROPOSAL_UNAVAILABLE');
        const resolved = await resolveProposal({ staff, card, analysisId: action.analysisId, proposalId: action.proposalId });
        checkProposalReview(defects, action, resolved, assistance);
        let trace = null;
        if (action.action === 'TRACE_SAVE') {
          requireThat(action.traceSourceHash === digest(canonical(action.base)), 409, 'MANUAL_TRACE_STALE');
          trace = await artifacts.read(action.traceRef, { cardId: card.cardId, kind: 'EDIT', sourceHash: action.traceSourceHash });
        } else if (action.action === 'ACCEPT') trace = proposalEdit(resolved.proposal, action.side, action.base.cornerShape);
        if (trace) defects = beginDefectEdit(defects, { side: action.side, base: action.base, actor: 'HUMAN',
          action: { type: 'TRACE_SAVE', side: action.side, findingId: null, trace } }).state;
        else defects = invalidateDefectConfirmation(defects);
        assistance = { version: 'atlas-defect-assistance-v1', reviews: [...(assistance?.reviews ?? []), {
          analysisId: action.analysisId, proposalId: action.proposalId, side: action.side, action: action.action,
          findingId: trace?.id ?? null, base: action.base, proposal: resolved.proposal, reviewerId: principal.id, reviewedAt: new Date().toISOString(),
        }] };
        draft = { ...draft, assistance: await store(assistance, card.cardId, 'ASSISTANCE') };
      } else if (action.type === 'DEFECT_EDIT' || action.type === 'TRACE_SAVE') {
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
        defects = applyDefectMeasurement(defects, await measure({ workspace: defects, side: action.side,
          pythonExecutable, limits: measurementLimits })).state;
      } else if (action.type === 'DISCARD_PENDING') {
        object(action, ['type', 'side', 'base']);
        const pendingAction = defects.sides[action.side].pending?.action;
        const pendingId = pendingAction?.type === 'TRACE_SAVE' && pendingAction.findingId === null
          ? pendingAction.trace.id : null;
        if (assistance && pendingId) {
          assistance = { ...assistance, reviews: assistance.reviews.filter(r => r.side !== action.side || r.findingId !== pendingId) };
          draft = { ...draft, assistance: await store(assistance, card.cardId, 'ASSISTANCE') };
        }
        defects = discardPendingDefectEdit(defects, { side: action.side, base: action.base, actor: 'HUMAN' }).state;
      } else if (action.type === 'INSPECT_SIDE') {
        object(action, ['type', 'side', 'base', 'inspected']);
        defects = markDefectSideInspected(defects, { side: action.side, base: action.base, inspected: action.inspected, actor: 'HUMAN' }).state;
      } else if (action.type === 'CONFIRM_FINDINGS') {
        object(action, ['type', 'base', 'reviewed']);
        defects = confirmDefectFindings(defects, { base: action.base, reviewed: action.reviewed, actor: 'HUMAN' }).state;
      } else requireThat(false, 400, 'MANUAL_ACTION_UNSUPPORTED');
    }
    return { ...draft, geometry: await store(geometry, card.cardId, 'GEOMETRY'), defects: defects ? await store(defects, card.cardId, 'DEFECTS') : null };
  }
  async function buildReport({ card, principal }, staff) {
    if (assertCurrent) await assertCurrent({ card, principal, staff });
    const { geometry, defects, identity } = await hydrate(card);
    requireThat(defects && geometryStatus(geometry).confirmed, 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
    const full = previewDefectReport(defects, { identity, centeringQuads: Object.fromEntries(SIDES.map(side => [side, geometry.sides[side].printed.quad])),
      draftRevision: geometry.reportRevision + defects.draftRevision + card.draft.identityRevision });
    const report = await store(full, card.cardId, 'REPORT');
    return { version: 'atlas-manual-report-snapshot-v1', report, identity: full.identity, grade: full.grade,
      findingCounts: full.findingCounts, ruleVersion: full.ruleVersion };
  }
  const ordinaryService = createManualService({ repository, reduce: domain(reduce), buildReport: domain(buildReport) });
  const service = Object.freeze({ ...ordinaryService, async execute(staff, cardId, input) {
    const result = await ordinaryService.execute(staff, cardId, input);
    // Confirmation is already durable. Publication failure must not turn a
    // committed review into an uncertain or lost manual save.
    if (input.action.type === 'CONFIRM_FINDINGS' && afterConfirm) {
      await afterConfirm(staff, cardId, input.actionId).catch(() => {});
    }
    return result;
  } });
  return Object.freeze({ service, hydrate, provision,
    stageProposalTrace: domain(async (staff, cardId, request) => {
      object(request, ['side', 'base', 'analysisId', 'proposalId', 'trace']);
      requireThat(typeof resolveProposal === 'function', 503, 'MANUAL_PROPOSAL_UNAVAILABLE');
      const { card } = await service.authorizeEdit(staff, cardId), state = await hydrate(card);
      requireThat(state.defects && geometryStatus(state.geometry).confirmed, 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
      const action = { type: 'ASTRA_PROPOSAL_REVIEW', side: request.side, base: request.base,
        analysisId: request.analysisId, proposalId: request.proposalId, action: 'TRACE_SAVE' };
      const resolved = await resolveProposal({ staff, card, analysisId: request.analysisId, proposalId: request.proposalId });
      checkProposalReview(state.defects, action, resolved, state.assistance);
      beginDefectEdit(state.defects, { side: request.side, base: request.base, actor: 'HUMAN',
        action: { type: 'TRACE_SAVE', side: request.side, findingId: null, trace: request.trace } });
      const traceSourceHash = digest(canonical(request.base));
      const traceRef = await artifacts.write(request.trace, { cardId, kind: 'EDIT', sourceHash: traceSourceHash });
      return { ...action, traceRef, traceSourceHash };
    }),
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
