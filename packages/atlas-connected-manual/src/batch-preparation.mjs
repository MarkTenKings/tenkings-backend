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
  requireThat(SIDES.every(side => state.geometry.sides[side].printed && state.geometry.sides[side].prepared
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
  const capture = Object.fromEntries(SIDES.map(side => [side.toLowerCase(), {
    centeringBorders: measureSpeedsterCenteringBorders(state.geometry.sides[side].printed.quad),
  }]));
  const calculated = calculateSpeedsterReview(capture, findings);
  return { version: 'atlas-machine-provisional-report-v1', authority: 'MACHINE_PROPOSAL', certification: null,
    cardId: card.cardId, sourceHash: card.draft.source.sourceHash, manualRevision: card.revision, manualContentHash: card.contentHash,
    analysisId: analysis.analysisId, analysisResultHash: digest(canonical(analysis.proposals)),
    identity: state.identity, cardProfile: state.geometry.profile, ruleVersion: SPEEDSTER_RULE_VERSION,
    grade: calculated.grade, proposedGrade: calculateAtlasFinalGrade(calculated.grade.overall.rawGrade),
    finalGradePolicy: ATLAS_FINAL_GRADE_POLICY, findings: calculated.defects,
    limitations: [...(analysis.limitations ?? []), ...(unmeasurableProposals.length
      ? ['Some model proposals have no measurable pixels within the selected card outline. Review those proposals in the manual workspace before certification.'] : [])],
    unmeasurableProposals, measurementReceipts: receipts,
    geometry: Object.fromEntries(SIDES.map(side => [side, { frame: state.defects.sides[side].frame,
      centeringQuad: state.geometry.sides[side].printed.quad }])),
  };
}

export function createBatchPreparation({ connected, artifacts, pythonExecutable, measurementLimits,
  measure = measureDefectWorkspaceEdit, reportBuilder = buildMachineReport }) {
  async function current(staff, job) {
    const value = await connected.open(staff, job.cardId, { includePreviews: false });
    requireThat(value.card.ready && value.card.sourceHash === job.sourceHash
      && SIDES.every(side => value.card.sides[side].upload.uploadId === job.uploads[side]), 409, 'BATCH_PHOTOS_CHANGED');
    return value;
  }
  return Object.freeze({
    async run(staff, job, { signal, dispatchSignal } = {}) {
      requireThat(!signal?.aborted, 409, 'BATCH_INTERRUPTED');
      dispatchSignal?.throwIfAborted();
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
          await connected.earlyGeometry.ensure(staff, job.cardId);
          const geometry = await connected.earlyGeometry.status(staff, job.cardId);
          if (SIDES.some(side => ['FAILED', 'NEEDS_REVIEW'].includes(geometry[side].state))) return attention('BATCH_GEOMETRY_NEEDS_REVIEW');
          if (!SIDES.every(side => geometry[side].state === 'READY')) return wait();
          dispatchSignal?.throwIfAborted();
          await connected.initialize(staff, job.cardId, { sourceHash: job.sourceHash, detailsRevision: opened.revision });
        }
        const card = await connected.workflow.service.read(staff, job.cardId), state = await connected.workflow.hydrate(card);
        if (!state.defects || SIDES.some(side => !state.geometry.sides[side].printed || !state.geometry.sides[side].prepared)) return attention('BATCH_GEOMETRY_NEEDS_REVIEW');
        if (SIDES.some(side => state.defects.sides[side].findings.length || state.defects.sides[side].inspection)
          || state.defects.confirmation || state.assistance?.reviews.length) return attention('BATCH_HUMAN_WORK_PRESENT');
        await current(staff, job);
        return { kind: 'CONTINUE', evidence: { manualRevision: card.revision, manualContentHash: card.contentHash } };
      }
      const card = await connected.workflow.service.read(staff, job.cardId), state = await connected.workflow.hydrate(card);
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
      await current(staff, job);
      const latest = await connected.workflow.service.read(staff, job.cardId);
      requireThat(latest.contentHash === card.contentHash && latest.revision === card.revision, 409, 'BATCH_MANUAL_DRAFT_CHANGED');
      const reportHash = digest(JSON.stringify(report));
      const reportRef = await artifacts.write(report, { cardId: job.cardId, kind: 'BATCH_REPORT', sourceHash: reportHash });
      return { kind: 'REVIEW', evidence: { authority: 'MACHINE_PROPOSAL', reportRef, reportHash,
        sourceHash: job.sourceHash, manualRevision: card.revision, manualContentHash: card.contentHash,
        proposedGrade: report.proposedGrade, findingCount: report.findings.length,
        name: report.identity.playerName ?? report.identity.cardName,
        limitations: report.limitations, analysisId: report.analysisId } };
    },
  });
}
