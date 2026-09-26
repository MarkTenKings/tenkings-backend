import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { defectBase, parseDefectWorkspace, applyDefectMeasurement } from '@atlas/manual-workspace/defect-actions';
import { measureDefectWorkspaceEdit } from '@atlas/measurement-runtime';
import { calculateSpeedsterReview } from '@atlas/grading-core/review';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { SPEEDSTER_RULE_VERSION } from '@atlas/grading-core/contracts';
import { calculateAtlasFinalGrade, ATLAS_FINAL_GRADE_POLICY } from '@atlas/grading-core/manual-report';
import { measurableProposalEdit } from '../../atlas-manual-workflow/src/proposal-review.mjs';
import { gradingIdentity } from './details.mjs';
import { BATCH_RATE_LIMIT_RETRIES } from '@atlas/batch-grading';
import { machineGeometryReview } from './machine-geometry.mjs';

const SIDES = ['FRONT', 'BACK'];
const attention = code => ({ kind: 'ATTENTION', code });
const wait = () => ({ kind: 'WAIT', retryAfterMs: 3000 });

/** A separate, explicitly machine-only estimate. It never writes manual
 * findings, inspections, approvals or reviewed memory. The canonical CPU and
 * grading formulas measure proposed traces; only their authority differs. */
export async function buildMachineReport({ card, state, analysis, measure = measureDefectWorkspaceEdit,
  pythonExecutable, measurementLimits, signal }) {
  requireThat(analysis?.status === 'READY' && analysis.analysisId && Array.isArray(analysis.proposals)
    && analysis.proposals.length <= 32 && state.defects, 409, 'BATCH_ANALYSIS_NOT_READY');
  requireThat(SIDES.every(side => state.geometry.sides[side].physical && state.geometry.sides[side].prepared
    && !state.defects.sides[side].pending && !state.defects.sides[side].findings.length
    && !state.defects.sides[side].humanEditedIds.length && !state.defects.sides[side].inspection)
    && !state.defects.confirmation && !(state.assistance?.reviews.length), 409, 'BATCH_HUMAN_WORK_PRESENT');
  requireThat(new Set(analysis.proposals.map(proposal => proposal.id)).size === analysis.proposals.length
    && analysis.proposals.every(proposal => SIDES.includes(proposal.side) && proposal.reviewStatus === 'UNREVIEWED'), 409, 'BATCH_ANALYSIS_STALE');
  let measured = structuredClone(state.defects);
  const receipts = [], unmeasurableProposals = [];
  for (const proposal of analysis.proposals) {
    requireThat(!signal?.aborted, 409, 'BATCH_INTERRUPTED');
    const side = proposal.side, slot = measured.sides[side];
    requireThat(Array.isArray(proposal.canonicalContour) && proposal.canonicalContour.length >= 3
      && proposal.canonicalContour.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
        && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1), 409, 'BATCH_ANALYSIS_INVALID_CONTOUR');
    // A valid model contour can lie wholly outside a rounded physical corner,
    // or cover less than one canonical pixel. Keep that proposal for a human;
    // an empty clipped mask is neither a measurable finding nor a zero-area
    // measurement. Malformed contours and other measurement errors still fail.
    const trace = measurableProposalEdit(proposal, side, slot.cornerShape);
    if (!trace) {
      unmeasurableProposals.push({ ...structuredClone(proposal), reason: 'NO_IN_CARD_RASTER_PIXELS' });
      continue;
    }
    // ENGINE is an existing pending-work authority. No call to HUMAN-only
    // beginDefectEdit/confirmation and no humanEditedIds are manufactured.
    measured = parseDefectWorkspace({ ...measured, draftRevision: measured.draftRevision + 1, confirmation: null,
      sides: { ...measured.sides, [side]: { ...slot, findingRevision: slot.findingRevision + 1,
        source: { method: 'DETECTOR', version: 'astra-machine-proposal-v1', id: analysis.analysisId },
        inspection: null, measurement: null,
        pending: { actor: 'ENGINE', action: { type: 'TRACE_SAVE', side, findingId: null, trace } } } } });
    const result = await measure({ workspace: measured, side, pythonExecutable, limits: measurementLimits, signal });
    requireThat(result.receipt, 503, 'BATCH_MEASUREMENT_UNVERIFIED');
    measured = applyDefectMeasurement(measured, result).state;
    // The shared trace tool labels a newly drawn mark as a reviewed smart mark.
    // Here the contour came from Astra, so retain the exact measurement/trace
    // while restoring its truthful detector/unreviewed provenance immediately.
    measured = parseDefectWorkspace({ ...measured, sides: { ...measured.sides, [side]: {
      ...measured.sides[side], findings: measured.sides[side].findings.map(finding => ({ ...finding, origin: 'DETECTOR', reviewResult: 'UNREVIEWED' })),
    } } });
    receipts.push({ proposalId: proposal.id, side, receipt: result.receipt });
  }
  const findings = SIDES.flatMap(side => measured.sides[side].findings);
  const geometryReview = machineGeometryReview(state.geometry);
  const unresolvedGeometry = SIDES.flatMap(side => geometryReview.sides[side].unresolved.map(code => ({ side, code })));
  // Missing printed-frame evidence does not withhold genuine defect analysis.
  // Keep measured findings/receipts, but do not invent centering inputs or an
  // overall numeric grade. Final human geometry correction can complete it.
  const capture = unresolvedGeometry.length ? null : Object.fromEntries(SIDES.map(side => [side.toLowerCase(), {
    centeringBorders: measureSpeedsterCenteringBorders(state.geometry.sides[side].printed.quad),
  }]));
  const calculated = capture ? calculateSpeedsterReview(capture, findings) : { grade: null, defects: findings };
  const ambiguousSides = SIDES.filter(side => geometryReview.sides[side].ambiguous);
  return { version: 'atlas-machine-provisional-report-v1', authority: 'MACHINE_PROPOSAL', certification: null,
    cardId: card.cardId, sourceHash: card.draft.source.sourceHash, manualRevision: card.revision, manualContentHash: card.contentHash,
    analysisId: analysis.analysisId, analysisResultHash: digest(canonical(analysis.proposals)),
    identity: state.identity, cardProfile: state.geometry.profile, ruleVersion: SPEEDSTER_RULE_VERSION,
    grade: calculated.grade, proposedGrade: calculated.grade ? calculateAtlasFinalGrade(calculated.grade.overall.rawGrade) : null,
    calculationState: calculated.grade ? 'COMPLETE' : 'GEOMETRY_UNRESOLVED', unresolvedGeometry,
    finalGradePolicy: ATLAS_FINAL_GRADE_POLICY, findings: calculated.defects,
    geometryReview,
    analysisLimitations: [...(analysis.limitations ?? [])],
    limitations: [...(analysis.limitations ?? []), ...(unresolvedGeometry.length
      ? ['Printed-frame geometry is unresolved. Defects were analyzed and measured, but centering and the overall grade remain unavailable until final review supplies supported geometry.'] : []), ...(ambiguousSides.length
      ? [`Machine geometry has competing plausible outlines on ${ambiguousSides.join(' and ')}. Review the proposed edges and centering in final review; this grade remains tentative.`] : []), ...(unmeasurableProposals.length
      ? ['Some model proposals have no measurable pixels within the selected card outline. Review those proposals in the manual workspace before certification.'] : [])],
    unmeasurableProposals, measurementReceipts: receipts,
    geometry: Object.fromEntries(SIDES.map(side => [side, { frame: state.defects.sides[side].frame,
      centeringQuad: state.geometry.sides[side].printed?.quad ?? null }])),
  };
}

export function createBatchPreparation({ connected, artifacts, pythonExecutable, measurementLimits,
  measure = measureDefectWorkspaceEdit, reportBuilder = buildMachineReport }) {
  async function current(staff, job, options) {
    const value = staff?.actorKind === 'MACHINE' && connected.machineBatchSnapshot
      ? await connected.machineBatchSnapshot(staff, job, options)
      : await connected.open(staff, job.cardId, { includePreviews: false });
    requireThat(value.card.ready && value.card.sourceHash === job.sourceHash
      && SIDES.every(side => value.card.sides[side].upload.uploadId === job.uploads[side]), 409, 'BATCH_PHOTOS_CHANGED');
    return value;
  }
  return Object.freeze({
    async run(staff, job, { signal, dispatchSignal } = {}) {
      requireThat(!signal?.aborted, 409, 'BATCH_INTERRUPTED');
      dispatchSignal?.throwIfAborted();
      // Only an opaque machine handle can use the receipt-only wait path. The
      // boundary reauthenticates it and checks the exact current pair/draft;
      // terminal or unaccepted actions still use the complete existing path.
      if (job.stage === 'ANALYZE' && staff?.actorKind === 'MACHINE'
        && await connected.assistance?.pendingMachineAnalysis?.(staff, job)) {
        requireThat(!signal?.aborted, 409, 'BATCH_INTERRUPTED');
        dispatchSignal?.throwIfAborted();
        return wait();
      }
      let opened = await current(staff, job);
      if (job.stage === 'PREPARE') {
        if (!opened.manual) {
          if (opened.identification.state !== 'COMPLETE') {
            dispatchSignal?.throwIfAborted();
            const identify = connected.identification.runMachine ?? connected.identification.run;
            const identification = await identify(staff, job.cardId, { dispatchSignal });
            if (identification.state === 'RETRY_WAIT') return {kind:'WAIT',retryAfterMs:identification.retryAfterMs};
            if (identification.state === 'RUNNING') return wait();
            if (identification.state !== 'COMPLETE') return attention('BATCH_IDENTITY_NEEDS_REVIEW');
            opened = await current(staff, job);
          }
          try { gradingIdentity(opened.details); } catch { return attention('BATCH_IDENTITY_NEEDS_REVIEW'); }
          dispatchSignal?.throwIfAborted();
          const { earlyGeometry: geometry } = await connected.earlyGeometry.ensure(staff, job.cardId);
          if (SIDES.some(side => geometry[side].state === 'FAILED'
            || geometry[side].state === 'NEEDS_REVIEW' && geometry[side].machineUsable !== true)) return attention('BATCH_GEOMETRY_NEEDS_REVIEW');
          if (!SIDES.every(side => geometry[side].state === 'READY' || geometry[side].machineUsable === true)) return wait();
          dispatchSignal?.throwIfAborted();
          await connected.initialize(staff, job.cardId, { sourceHash: job.sourceHash, detailsRevision: opened.revision });
        }
        const card = opened.manualCard ?? await connected.workflow.service.read(staff, job.cardId), state = await connected.workflow.hydrate(card);
        if (!state.defects || SIDES.some(side => !state.geometry.sides[side].physical || !state.geometry.sides[side].prepared)) return attention('BATCH_GEOMETRY_NEEDS_REVIEW');
        if (SIDES.some(side => state.defects.sides[side].findings.length || state.defects.sides[side].inspection)
          || state.defects.confirmation || state.assistance?.reviews.length) return attention('BATCH_HUMAN_WORK_PRESENT');
        await current(staff, job, { pairOnly: true });
        return { kind: 'CONTINUE', evidence: { manualRevision: card.revision, manualContentHash: card.contentHash } };
      }
      const card = opened.manualCard ?? await connected.workflow.service.read(staff, job.cardId), state = await connected.workflow.hydrate(card);
      requireThat(card.revision === job.evidence.manualRevision && card.contentHash === job.evidence.manualContentHash, 409, 'BATCH_MANUAL_DRAFT_CHANGED');
      if (job.stage === 'ANALYZE') {
        dispatchSignal?.throwIfAborted();
        // Reconcile the saved action before constructing image/request buffers.
        // A READY receipt after a lost socket reply advances this exact job;
        // accepted/unknown work never becomes permission for another dispatch.
        let response = await connected.assistance.status(staff, job.cardId, job.analysisActionId);
        if (response.state === 'NOT_FOUND' || response.state === 'PREPARED') {
          dispatchSignal?.throwIfAborted();
          response = await connected.assistance.analyzeMachine(staff, job.cardId, { actionId: job.analysisActionId,
            base: Object.fromEntries(SIDES.map(side => [side, defectBase(state.defects, side)])) }, { dispatchSignal });
        }
        const astra = response.astra;
        if (astra?.status === 'READY') return { kind: 'CONTINUE', evidence: { analysisId: astra.analysisId } };
        if (['RUNNING', 'PREPARED', 'DISPATCHED'].includes(response.state) || astra?.status === 'RUNNING') return wait();
        if (astra?.rateLimited === true) return (job.analysisAttempt ?? 0) < BATCH_RATE_LIMIT_RETRIES
          ? { kind: 'RETRY_ANALYSIS', code: 'BATCH_PROVIDER_RATE_LIMITED' } : attention('BATCH_PROVIDER_RATE_LIMITED');
        return attention(astra?.status === 'UNKNOWN' ? 'BATCH_ANALYSIS_UNCERTAIN' : 'BATCH_ANALYSIS_NEEDS_REVIEW');
      }
      requireThat(job.stage === 'REPORT', 400, 'BATCH_STAGE_INVALID');
      const response = await connected.assistance.status(staff, job.cardId, job.analysisActionId);
      const report = await reportBuilder({ card, state, analysis: response.astra, measure, pythonExecutable, measurementLimits, signal });
      await current(staff, job, { pairOnly: true });
      const latest = await connected.workflow.service.read(staff, job.cardId);
      requireThat(latest.contentHash === card.contentHash && latest.revision === card.revision, 409, 'BATCH_MANUAL_DRAFT_CHANGED');
      const reportHash = digest(JSON.stringify(report));
      const reportRef = await artifacts.write(report, { cardId: job.cardId, kind: 'BATCH_REPORT', sourceHash: reportHash });
      return { kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL', reportRef, reportHash,
        sourceHash: job.sourceHash, manualRevision: card.revision, manualContentHash: card.contentHash,
        proposedGrade: report.proposedGrade, findingCount: report.findings.length,
        name: report.identity.playerName ?? report.identity.cardName,
        limitations: report.limitations, calculationState: report.calculationState,
        unresolvedGeometry: report.unresolvedGeometry, analysisId: report.analysisId } };
    },
  });
}
