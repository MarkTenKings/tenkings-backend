import { canonical, digest, object, requireThat, ManualServiceError } from '@atlas/manual-service/contract';
import { createManualService } from '@atlas/manual-service';
import { applyGeometryEdit, canDetectMissingPhysical, confirmBothGeometry, geometryStatus, parseGeometryWorkspace, updateGeometrySettings, GeometryActionError } from '@atlas/manual-workspace/geometry-actions';
import { beginDefectEdit, applyDefectMeasurement, confirmDefectFindings, createDefectWorkspace, defectBase,
  markDefectSideInspected, parseDefectWorkspace, previewDefectReport, replaceDefectFrame, discardPendingDefectEdit, DefectActionError } from '@atlas/manual-workspace/defect-actions';
import { measureDefectWorkspaceEdit, MeasurementError } from '@atlas/measurement-runtime';
import { canonicalizeNewSpeedsterSessionIdentity, SpeedsterIdentityValidationError } from '@atlas/grading-core/identity';

import { proposalEdit, checkProposalReview, invalidateDefectConfirmation } from './proposal-review.mjs';
import { collectivelyConfirmDefects, confirmationBudget } from './collective-confirmation.mjs';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import { beginFinalReview, finalReviewDecisions, finalReviewPreview } from './final-review.mjs';
import { beginReprojectDefectFrame } from '@atlas/manual-workspace/geometry-reprojection';

const SIDES = ['FRONT', 'BACK'];
const preparedForReview = geometry => SIDES.every(side => geometry.sides[side].prepared);
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
export function createManualWorkflow({ repository, artifacts, pythonExecutable, measurementLimits, prepare = null, replaceSources = null, assertCurrent = null, measure = measureDefectWorkspaceEdit, resolveProposal = null, afterConfirm = null,
  resolveConfirmation = null, assertReviewComplete = null, confirmationTimeoutMs = 180000, afterApprove = null, resolveFinalReview = null }) {
  requireThat(Number.isSafeInteger(confirmationTimeoutMs) && confirmationTimeoutMs > 0 && confirmationTimeoutMs <= 180000);
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
  async function storeCurrent(value, cardId, kind, verifiedPrevious) {
    // Only called after hydrate verified this draft's exact immutable bytes.
    // Reuse the reference when the unchanged serialization has the same hash;
    // changed content still takes the full immutable write/readback path.
    return verifiedPrevious && sourceHash(value) === verifiedPrevious.sourceHash
      ? verifiedPrevious : store(value, cardId, kind);
  }
  async function read(cardId, kind, ref, hash) {
    const value = await artifacts.read(ref, { cardId, kind, sourceHash: hash });
    requireThat(sourceHash(value) === hash, 503, 'MANUAL_ARTIFACT_UNVERIFIED');
    return value;
  }
  async function hydrate(card) {
    const draft = card.draft;
    object(draft, ['version', 'geometry', 'defects', 'identity', 'identityRevision', ...(draft.version === 'atlas-manual-workflow-v2' ? ['source'] : []), ...(Object.hasOwn(draft, 'assistance') ? ['assistance'] : []),
      ...(Object.hasOwn(draft, 'finalReview') ? ['finalReview'] : []), ...(Object.hasOwn(draft, 'geometryBeforeEdit') ? ['geometryBeforeEdit'] : [])]);
    requireThat(['atlas-manual-workflow-v1', 'atlas-manual-workflow-v2'].includes(draft.version), 503, 'MANUAL_DRAFT_INVALID');
    const [g, d, assistance, finalReview] = await Promise.all([read(card.cardId, 'GEOMETRY', draft.geometry.ref, draft.geometry.sourceHash),
      draft.defects ? read(card.cardId, 'DEFECTS', draft.defects.ref, draft.defects.sourceHash) : null,
      draft.assistance ? read(card.cardId, 'ASSISTANCE', draft.assistance.ref, draft.assistance.sourceHash) : null,
      draft.finalReview ? read(card.cardId, 'FINAL_REVIEW', draft.finalReview.ref, draft.finalReview.sourceHash) : null]);
    const geometry = parseGeometryWorkspace(g), defects = d ? parseDefectWorkspace(d) : null;
    requireThat(geometry.cardId === card.cardId && (!defects || defects.cardId === card.cardId && geometry.profile === defects.profile),
      503, 'MANUAL_DRAFT_INVALID');
    for (const side of SIDES) if (defects && geometry.sides[side].prepared) {
      requireThat(equal(frameFromGeometry(geometry, side), defects.sides[side].frame)
        && geometry.sides[side].cornerShape === defects.sides[side].cornerShape, 503, 'MANUAL_FRAME_MISMATCH');
    }
    requireThat(!assistance || assistance.version === 'atlas-defect-assistance-v1' && Array.isArray(assistance.reviews) && assistance.reviews.length <= 200, 503, 'MANUAL_ASSISTANCE_INVALID');
    requireThat(!finalReview || finalReview.version === 'atlas-final-review-v1'
      && finalReview.report.cardId === card.cardId && finalReview.report.sourceHash === draft.source?.sourceHash
      && finalReview.reportHash === sourceHash(finalReview.report), 503, 'MANUAL_FINAL_REVIEW_INVALID');
    return { geometry, defects, identity: draft.identity, ...(assistance ? { assistance } : {}), ...(finalReview ? { finalReview } : {}) };
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
  async function reduce({ card, action, principal, startedAt }, staff) {
    let { geometry, defects, assistance, finalReview } = await hydrate(card);
    let draft = card.draft;
    if (action.type === 'BEGIN_FINAL_REVIEW') {
      object(action, ['type', 'batchKey', 'reportHash']);
      requireThat(typeof resolveFinalReview === 'function' && principal.actorKind !== 'MACHINE', 403, 'MANUAL_HUMAN_REQUIRED');
      const packet = await resolveFinalReview({ staff, card, batchKey: action.batchKey, reportHash: action.reportHash });
      ({ defects, finalReview } = beginFinalReview({ card, geometry, defects, packet }));
      draft = { ...draft, finalReview: await store(finalReview, card.cardId, 'FINAL_REVIEW') };
    } else if (action.type === 'REJECT_FINAL_OBSERVATION') {
      object(action, ['type', 'reportHash', 'proposalId', 'reviewed']);
      requireThat(finalReview && action.reviewed === true && action.reportHash === finalReview.reportHash
        && principal.actorKind !== 'MACHINE', 409, 'MANUAL_FINAL_REVIEW_REQUIRED');
      const proposal = finalReview.report.unmeasurableProposals?.find(value => value.id === action.proposalId);
      requireThat(proposal && proposal.reason === 'NO_IN_CARD_RASTER_PIXELS', 409, 'MANUAL_PROPOSAL_STALE');
      requireThat(!(assistance?.reviews ?? []).some(review => review.analysisId === finalReview.report.analysisId
        && review.proposalId === proposal.id), 409, 'MANUAL_PROPOSAL_ALREADY_REVIEWED');
      // The human rejects an explicitly retained original observation. This
      // never reuses its old polygon as pixels on a changed inspection frame.
      assistance = { version: 'atlas-defect-assistance-v1', reviews: [...(assistance?.reviews ?? []), {
        analysisId: finalReview.report.analysisId, proposalId: proposal.id, side: proposal.side, action: 'REJECT', findingId: null,
        base: finalReview.originalBases[proposal.side], proposal: finalReview.proposals.find(value => value.id === proposal.id),
        reviewerId: principal.id, reviewedAt: new Date().toISOString(), noMeasurablePixels: true,
      }] };
      defects = invalidateDefectConfirmation(defects);
      draft = { ...draft, assistance: await store(assistance, card.cardId, 'ASSISTANCE') };
    } else if (action.type === 'REPLACE_SOURCES') {
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
      delete draft.finalReview; delete draft.geometryBeforeEdit;
    } else if (action.type === 'SET_PHOTO_BACKGROUND') {
      object(action, ['type', 'side', 'base', 'matColor']);
      requireThat(principal.actorKind !== 'MACHINE', 403, 'MANUAL_HUMAN_REQUIRED');
      requireThat(SIDES.includes(action.side) && canDetectMissingPhysical(geometry, action.side)
        && !defects && !finalReview && !draft.geometryBeforeEdit?.[action.side],
      409, 'MANUAL_GEOMETRY_RECOVERY_UNAVAILABLE');
      // This recovery changes only the surface surrounding a never-adopted
      // outline. Existing physical, prepared, measured and review work cannot
      // enter this path; preparation remains a separate durable action.
      geometry = updateGeometrySettings(geometry, { side: action.side, base: action.base,
        matColor: action.matColor, cornerShape: geometry.sides[action.side].cornerShape }).state;
    } else if (action.type === 'GEOMETRY_EDIT') {
      object(action, ['type', 'edit']);
      object(action.edit, ['side', 'kind', 'base', 'quad']);
      if (action.edit.kind === 'PHYSICAL') requireThat(!defects?.sides[action.edit.side]?.pending, 409, 'MANUAL_DEFECT_PENDING');
      if (action.edit.kind === 'PHYSICAL' && defects && geometry.sides[action.edit.side].prepared) {
        // Keep the exact old transform until the new geometry and all affected
        // traces have been prepared and measured together successfully.
        draft = { ...draft, geometryBeforeEdit: { ...draft.geometryBeforeEdit, [action.edit.side]: draft.geometryBeforeEdit?.[action.edit.side] ?? draft.geometry } };
      }
      geometry = applyGeometryEdit(geometry, { ...action.edit, actor: 'HUMAN', proposal: null }).state;
      // Preparation is a separate durable action: a failed CPU pass retains the
      // saved physical outline and a reload still exposes Retry preparation.
    } else if (action.type === 'RESTORE_GEOMETRY') {
      object(action, ['type', 'side']);
      const previous = draft.geometryBeforeEdit?.[action.side];
      requireThat(SIDES.includes(action.side) && previous && !geometry.sides[action.side].prepared,
        409, 'MANUAL_GEOMETRY_RECOVERY_UNAVAILABLE');
      const saved = parseGeometryWorkspace(await read(card.cardId, 'GEOMETRY', previous.ref, previous.sourceHash));
      requireThat(equal(saved.sides[action.side].image, geometry.sides[action.side].image)
        && equal(frameFromGeometry(saved, action.side), defects.sides[action.side].frame), 409, 'MANUAL_GEOMETRY_REFERENCE_REQUIRED');
      geometry = parseGeometryWorkspace({ ...geometry, reportRevision: geometry.reportRevision + 1,
        sides: { ...geometry.sides, [action.side]: { ...saved.sides[action.side], confirmation: null } } });
      const remaining = { ...draft.geometryBeforeEdit }; delete remaining[action.side];
      draft = { ...draft }; if (Object.keys(remaining).length) draft.geometryBeforeEdit = remaining; else delete draft.geometryBeforeEdit;
    } else if (action.type === 'PREPARE_SIDE') {
      object(action, ['type', 'side']); requireThat(SIDES.includes(action.side) && typeof prepare === 'function', 503, 'MANUAL_PREPARATION_UNAVAILABLE');
      if (!geometry.sides[action.side].physical) requireThat(canDetectMissingPhysical(geometry, action.side) && !defects,
        409, 'MANUAL_GEOMETRY_RECOVERY_UNAVAILABLE');
      try {
        const prepared = await prepare({ geometry, side: action.side, source: draft.source, staff });
        geometry = parseGeometryWorkspace(prepared.geometry ?? prepared);
        if (prepared.source) draft = { ...draft, source: prepared.source };
      }
      catch (error) {
        if (error?.name === 'PreparationError') throw new ManualServiceError(422, 'MANUAL_PREPARATION_FAILED');
        throw error;
      }
      const previous = draft.geometryBeforeEdit?.[action.side];
      if (defects && previous) {
        const previousGeometry = await read(card.cardId, 'GEOMETRY', previous.ref, previous.sourceHash);
        defects = beginReprojectDefectFrame({ workspace: defects, side: action.side, previousGeometry, geometry });
        defects = applyDefectMeasurement(defects, await measure({ workspace: defects, side: action.side, pythonExecutable, limits: measurementLimits })).state;
        const remaining = { ...draft.geometryBeforeEdit }; delete remaining[action.side];
        draft = { ...draft }; if (Object.keys(remaining).length) draft.geometryBeforeEdit = remaining; else delete draft.geometryBeforeEdit;
      } else {
        requireThat(!defects?.sides[action.side].findings.length, 409, 'MANUAL_GEOMETRY_REFERENCE_REQUIRED');
        defects = defects ? replaceDefectFrame(defects, { side: action.side, base: defectBase(defects, action.side),
          frame: frameFromGeometry(geometry, action.side), cornerShape: geometry.sides[action.side].cornerShape }).state : initialDefects(geometry);
      }
    } else if (action.type === 'CONFIRM_GEOMETRY') {
      object(action, ['type', 'base', 'reviewed']);
      geometry = confirmBothGeometry(geometry, { base: action.base, reviewed: action.reviewed, actor: 'HUMAN' }).state;
    } else if (action.type === 'IDENTITY_EDIT') {
      object(action, ['type', 'identity']);
      draft = { ...draft, identity: canonicalizeNewSpeedsterSessionIdentity(geometry.profile, action.identity), identityRevision: draft.identityRevision + 1 };
    } else {
      const editingFinal = finalReview && preparedForReview(geometry)
        && ['DEFECT_EDIT', 'TRACE_SAVE', 'MEASURE_SIDE', 'DISCARD_PENDING', 'ASTRA_PROPOSAL_REVIEW', 'INSPECT_SIDE'].includes(action.type);
      requireThat(defects && (geometryStatus(geometry).confirmed || editingFinal), 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
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
        object(action, ['type', 'base', 'reviewed', ...(Object.hasOwn(action, 'proposalReview') ? ['proposalReview'] : [])]);
        const budget = confirmationBudget(startedAt, confirmationTimeoutMs);
        budget.check();
        requireThat(!action.proposalReview || typeof resolveConfirmation === 'function', 503, 'MANUAL_PROPOSAL_UNAVAILABLE');
        const resolved = resolveConfirmation ? await resolveConfirmation({ staff, card, selection: action.proposalReview ?? null }) : null;
        budget.check();
        if (action.proposalReview) {
          ({ defects, assistance } = await collectivelyConfirmDefects({ defects, assistance, request: action,
            entries: resolved.entries, principal, measure, pythonExecutable, measurementLimits, budget }));
          draft = { ...draft, assistance: await store(assistance, card.cardId, 'ASSISTANCE') };
        } else defects = confirmDefectFindings(defects, { base: action.base, reviewed: action.reviewed, actor: 'HUMAN' }).state;
        if (finalReview) {
          assistance = finalReviewDecisions({ finalReview, defects, assistance, principal });
          draft = { ...draft, assistance: await store(assistance, card.cardId, 'ASSISTANCE') };
        }
        budget.check();
      } else requireThat(false, 400, 'MANUAL_ACTION_UNSUPPORTED');
    }
    const [savedGeometry, savedDefects] = await Promise.all([
      storeCurrent(geometry, card.cardId, 'GEOMETRY', card.draft.geometry),
      defects ? storeCurrent(defects, card.cardId, 'DEFECTS', card.draft.defects) : null,
    ]);
    return { ...draft, geometry: savedGeometry, defects: savedDefects };
  }
  async function buildReport({ card, principal }, staff) {
    if (assertCurrent) await assertCurrent({ card, principal, staff });
    if (assertReviewComplete) await assertReviewComplete({ staff, card });
    const { geometry, defects, identity } = await hydrate(card);
    requireThat(defects && geometryStatus(geometry).confirmed, 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
    const full = previewDefectReport(defects, { identity, centeringQuads: Object.fromEntries(SIDES.map(side => [side, geometry.sides[side].printed.quad])),
      draftRevision: geometry.reportRevision + defects.draftRevision + card.draft.identityRevision });
    const report = await store(full, card.cardId, 'REPORT');
    return { version: 'atlas-manual-report-snapshot-v2', report, identity: full.identity, grade: full.grade,
      finalGrade: full.finalGrade, finalGradePolicy: full.finalGradePolicy,
      findingCounts: full.findingCounts, ruleVersion: full.ruleVersion };
  }
  const ordinaryService = createManualService({ repository, reduce: domain((context, staff) => context.action.type === 'CONFIRM_FINDINGS'
    ? confirmationBudget(context.startedAt, confirmationTimeoutMs).run(() => reduce(context, staff)) : reduce(context, staff)), buildReport: domain(buildReport),
    beforeCommit: async ({ card, draft, action, startedAt }, staff) => {
      if (!assertReviewComplete || !['CONFIRM_FINDINGS', 'APPROVE_REPORT'].includes(action.type)) return null;
      const budget = confirmationBudget(startedAt, confirmationTimeoutMs); budget.check();
      const analysis = await budget.run(() => assertReviewComplete({ staff, card: { ...card, draft }, selection: action.proposalReview ?? null }));
      budget.check();
      return { version: 'atlas-manual-confirmation-fence-v1', analysis, deadlineAt: budget.deadlineAt };
    } });
  const service = Object.freeze({ ...ordinaryService,
    async previewReport(staff, cardId) {
      const preview = await ordinaryService.previewReport(staff, cardId);
      const full = await read(cardId, 'REPORT', preview.report.report.ref, preview.report.report.sourceHash);
      return { ...preview, review: { report: full, explanation: explainAtlasManualReport(full) } };
    }, async execute(staff, cardId, input) {
    const startedAt = Date.now();
    const result = await ordinaryService.execute(staff, cardId, input);
    // Approval is already durable, including its pending publication intent.
    // Replays resume that same approval; a failed projection never reapproves.
    if (input.action.type === 'APPROVE_REPORT' && afterApprove) {
      try { return { ...result, publication: await afterApprove(staff, cardId, input.actionId) }; }
      catch { return { ...result, publication: { state: 'PENDING', actionId: input.actionId, retryable: true } }; }
    }
    // Confirmation is already durable. Publication failure must not turn a
    // committed review into an uncertain or lost manual save.
    if (input.action.type === 'CONFIRM_FINDINGS' && afterConfirm) {
      // Publication remains a recoverable post-commit operation. Bound response
      // waiting below the existing transport deadline; a delayed publication
      // never turns the already saved human review into a failed save.
      const remaining = Math.max(0, 195000 - (Date.now() - startedAt));
      if (remaining > 0) {
        let timer;
        await Promise.race([afterConfirm(staff, cardId, input.actionId).catch(() => {}),
          new Promise(resolve => { timer = setTimeout(resolve, remaining); })]).finally(() => clearTimeout(timer));
      }
    }
    return result;
  } });
  return Object.freeze({ service, hydrate, provision, currentPreview: finalReviewPreview,
    stageProposalTrace: domain(async (staff, cardId, request) => {
      object(request, ['side', 'base', 'analysisId', 'proposalId', 'trace']);
      requireThat(typeof resolveProposal === 'function', 503, 'MANUAL_PROPOSAL_UNAVAILABLE');
      const { card } = await service.authorizeEdit(staff, cardId), state = await hydrate(card);
      requireThat(state.defects && (geometryStatus(state.geometry).confirmed || state.finalReview && preparedForReview(state.geometry)), 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
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
      const { card } = await service.authorizeEdit(staff, cardId), { geometry, defects, finalReview } = await hydrate(card);
      requireThat(geometryStatus(geometry).confirmed || finalReview && preparedForReview(geometry), 409, 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
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
