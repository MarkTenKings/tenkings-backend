import { canonical, digest, object, requireThat } from '@atlas/manual-service/contract';
import { batchActionId } from '@atlas/batch-grading';
import { geometryBase } from '@atlas/manual-workspace/geometry-actions';
import { defectBase } from '@atlas/manual-workspace/defect-actions';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import { ATLAS_RULE_VERSION } from '@atlas/grading-core/atlas-policy';

const SIDES = ['FRONT', 'BACK'];
const STEPS = ['GEOMETRY', 'INSPECT_FRONT', 'INSPECT_BACK', 'FINDINGS', 'APPROVAL'];
const actionId = (key, step) => batchActionId(key, `HUMAN_REVIEW_${step}`);
const same = (a, b) => canonical(a, { maxBytes: 4194304 }) === canonical(b, { maxBytes: 4194304 });
const findingEvidence = finding => {
  // Only these two authority fields change when a real reviewer accepts the
  // displayed machine trace. Every pixel, measurement and category must match.
  const { origin, reviewResult, ...evidence } = finding;
  return evidence;
};
function assertReportEvidenceUnchanged(machine, final) {
  // Confirmation visits proposal IDs in lexical order (…:10 before …:2).
  // Ordering is presentation; identity and every evidence field are authority.
  // Match each finding once without rewriting either immutable report.
  const originalFindings = new Map(machine.findings.map(finding => [finding.id, finding]));
  requireThat(final?.version === 'atlas-manual-draft-report-v2'
    && final.finalGrade === machine.proposedGrade
    && ['identity', 'cardProfile', 'ruleVersion', 'grade', 'finalGradePolicy'].every(key => same(machine[key], final[key]))
    && final.inspection?.method === 'HUMAN'
    && SIDES.every(side => final.inspection[side.toLowerCase()]?.inspected === true
      && final.inspection[side.toLowerCase()].imageSha256 === machine.geometry[side].frame.inspectionImageSha256)
    && final.findings.length === machine.findings.length
    && originalFindings.size === machine.findings.length
    && new Set(final.findings.map(finding => finding.id)).size === final.findings.length
    && final.findings.every(finding => ['SMART_MARKED', 'ACCEPTED'].includes(finding.reviewResult)
      && originalFindings.has(finding.id)
      && same(findingEvidence(finding), findingEvidence(originalFindings.get(finding.id)))), 409, 'BATCH_REVIEW_REPORT_CHANGED');
}
export function assertMachineReportUnchanged(machine, final) {
  requireThat(machine.ruleVersion === ATLAS_RULE_VERSION, 409, 'BATCH_REVIEW_REPORT_CHANGED');
  assertReportEvidenceUnchanged(machine, final);
}

/** This adapter is invoked only by the explicit authenticated review POST.
 * The worker never receives it. One real human decision is journaled first,
 * then the ordinary human commands commit with exact CAS and stable receipts.
 * Reopening and reads do not resume or manufacture any human command. */
export function createBatchReview({ connected, repository, artifacts }) {
  const service = connected.workflow.service;
  async function load(staff, key) {
    const saved = await repository.readReview(staff, key), { job } = saved;
    requireThat(job.state === 'REVIEW' && job.evidence.authority === 'MACHINE_PROPOSAL', 409, 'BATCH_REVIEW_STALE');
    const report = await artifacts.read(job.evidence.reportRef, { cardId: job.cardId, kind: 'BATCH_REPORT', sourceHash: job.evidence.reportHash },
      { signal: AbortSignal.timeout(20000) });
    requireThat(digest(JSON.stringify(report)) === job.evidence.reportHash
      && report.version === 'atlas-machine-provisional-report-v1' && report.authority === 'MACHINE_PROPOSAL'
      && report.certification === null && report.cardId === job.cardId && report.sourceHash === job.sourceHash
      && report.manualRevision === job.evidence.manualRevision && report.manualContentHash === job.evidence.manualContentHash,
    409, 'BATCH_REVIEW_BINDING_CHANGED');
    if (saved.review) requireThat(saved.review.reviewed === true && saved.review.reportHash === job.evidence.reportHash
      && saved.review.manualRevision === report.manualRevision && saved.review.manualContentHash === report.manualContentHash
      && SIDES.every(side => saved.review.images?.[side] === report.geometry[side].frame.inspectionImageSha256),
    409, 'BATCH_REVIEW_BINDING_CHANGED');
    return { ...saved, report };
  }
  async function progress(staff, job, report) {
    let expected = { revision: report.manualRevision, contentHash: report.manualContentHash }, complete = 0, result;
    for (const step of STEPS) {
      const receipt = await service.status(staff, job.cardId, actionId(job.key, step));
      if (receipt.state !== 'COMMITTED') break;
      requireThat(receipt.result.card.revision === expected.revision + 1, 409, 'BATCH_REVIEW_STALE');
      result = receipt.result; expected = result.card; complete++;
    }
    const card = await service.read(staff, job.cardId);
    requireThat(card.revision === expected.revision && card.contentHash === expected.contentHash
      && card.draft.source.sourceHash === job.sourceHash, 409, 'BATCH_REVIEW_STALE');
    return { card, complete, result };
  }
  async function recoverApproval(staff, job, report, result) {
    const approvalActionId = actionId(job.key, 'APPROVAL');
    const approved = await service.readApproval(staff, job.cardId, approvalActionId);
    requireThat(approved?.sourceRevision === report.manualRevision + 4 && approved.report?.report,
      409, 'BATCH_REVIEW_BINDING_CHANGED');
    const final = await artifacts.read(approved.report.report.ref, { cardId: job.cardId, kind: 'REPORT',
      sourceHash: approved.report.report.sourceHash }, { signal: AbortSignal.timeout(20000) });
    requireThat(digest(JSON.stringify(final)) === approved.report.report.sourceHash, 409, 'BATCH_REVIEW_BINDING_CHANGED');
    // Recovery reads the exact committed award, including a historical policy.
    // It never creates a fresh approval or substitutes a newly calculated grade.
    assertReportEvidenceUnchanged(report, final);
    explainAtlasManualReport(final);
    let publication = result.publication;
    if (!publication || publication.state !== 'PUBLISHED') {
      try { publication = await connected.publication.publish(staff, job.cardId, approvalActionId); }
      catch { publication = { state: 'PENDING', actionId: approvalActionId, retryable: true }; }
    }
    return { cardId: job.cardId, actionId: approvalActionId, publication, receipt: result.receipt };
  }
  return Object.freeze({
    async resolveCorrections({ staff, card, batchKey, reportHash }) {
      const { job, report, review } = await load(staff, batchKey);
      requireThat(card.cardId === job.cardId && reportHash === job.evidence.reportHash, 409, 'BATCH_REVIEW_STALE');
      let resumeBase;
      if (review) {
        // A failed final approval may leave the ordinary inspection steps
        // committed under the current policy too. Their exact receipt chain
        // can enter corrections; policy age is not a recovery capability.
        const recovered = await progress(staff, job, report);
        requireThat(recovered.complete < STEPS.length && card.revision === recovered.card.revision
          && card.contentHash === recovered.card.contentHash, 409, 'BATCH_REVIEW_STALE');
        resumeBase = { revision: card.revision, contentHash: card.contentHash, completedSteps: recovered.complete };
      } else requireThat(!review && card.revision === report.manualRevision && card.contentHash === report.manualContentHash,
        409, 'BATCH_REVIEW_STALE');
      const { astra: analysis } = await connected.assistance.status(staff, job.cardId, job.analysisActionId);
      requireThat(analysis?.status === 'READY' && analysis.analysisId === report.analysisId
        && digest(canonical(analysis.proposals.map(proposal => ({ ...proposal, reviewStatus: 'UNREVIEWED' })))) === report.analysisResultHash,
      409, 'BATCH_REVIEW_ANALYSIS_CHANGED');
      return { batchKey, reportHash, report, proposals: analysis.proposals, ...(resumeBase ? { resumeBase } : {}) };
    },
    async detail(staff, key) {
      const { job, report, review, canCertify } = await load(staff, key);
      const latest = await service.read(staff, job.cardId);
      if (latest.draft.finalReview) {
        const state = await connected.workflow.hydrate(latest);
        requireThat(state.finalReview.batchKey === key && state.finalReview.reportHash === job.evidence.reportHash,
          409, 'BATCH_REVIEW_BINDING_CHANGED');
        const current = connected.workflow.currentPreview(latest, state);
        return { key, cardId: job.cardId, correctionAvailable: true, canCertify: false,
          ...current, images: await connected.imageDescriptors({ card: latest, state, staff }) };
      }
      const { card, complete } = await progress(staff, job, report), state = await connected.workflow.hydrate(card);
      const images = await connected.imageDescriptors({ card, state, staff });
      // Pure explanation of the same deterministic numbers. This local
      // presentation input creates neither a human report nor an attestation.
      const geometryUnresolved = report.calculationState === 'GEOMETRY_UNRESOLVED' || !Number.isFinite(report.proposedGrade);
      const explanation = geometryUnresolved ? null : explainAtlasManualReport({ ...report, version: 'atlas-manual-draft-report-v2', finalGrade: report.proposedGrade });
      await repository.readReview(staff, key);
      const reviewRequiredReason = geometryUnresolved ? 'BATCH_FINAL_GEOMETRY_REQUIRED'
        : report.unmeasurableProposals?.length ? 'BATCH_PROPOSAL_REVIEW_REQUIRED'
        : report.ruleVersion !== ATLAS_RULE_VERSION && complete < STEPS.length ? 'BATCH_SCORING_POLICY_UPDATED' : null;
      return { key, cardId: job.cardId, reportHash: job.evidence.reportHash, report, explanation, images,
        canCertify: canCertify && !reviewRequiredReason, reviewRequiredReason,
        resumeAvailable: Boolean(review), approved: complete === STEPS.length };
    },
    async approve(staff, key, input) {
      object(input, ['reportHash', 'reviewed', 'images']); object(input.images, SIDES);
      requireThat(input.reviewed === true, 400, 'BATCH_REVIEW_REQUIRED');
      const { job, report, canCertify, review } = await load(staff, key);
      requireThat(canCertify, 403, 'MANUAL_CERTIFICATION_REQUIRED');
      requireThat(report.calculationState !== 'GEOMETRY_UNRESOLVED' && Number.isFinite(report.proposedGrade), 409, 'BATCH_FINAL_GEOMETRY_REQUIRED');
      requireThat(!report.unmeasurableProposals?.length, 409, 'BATCH_PROPOSAL_REVIEW_REQUIRED');
      requireThat(input.reportHash === job.evidence.reportHash && SIDES.every(side =>
        input.images[side] === report.geometry[side].frame.inspectionImageSha256), 409, 'BATCH_REVIEW_BINDING_CHANGED');
      const recovered = await progress(staff, job, report);
      if (report.ruleVersion !== ATLAS_RULE_VERSION) {
        requireThat(review && recovered.complete === STEPS.length, 409, 'BATCH_SCORING_POLICY_UPDATED');
        return recoverApproval(staff, job, report, recovered.result);
      }
      const response = await connected.assistance.status(staff, job.cardId, job.analysisActionId), analysis = response.astra;
      requireThat(analysis?.status === 'READY' && analysis.analysisId === report.analysisId
        && digest(canonical(analysis.proposals.map(proposal => ({ ...proposal, reviewStatus: 'UNREVIEWED' })))) === report.analysisResultHash,
      409, 'BATCH_REVIEW_ANALYSIS_CHANGED');
      const command = { ...input, manualRevision: report.manualRevision, manualContentHash: report.manualContentHash,
        proposalReview: review?.proposalReview ?? analysis.proposalReview };
      requireThat(command.proposalReview?.analysisId === report.analysisId, 409, 'BATCH_REVIEW_ANALYSIS_CHANGED');
      await repository.beginReview(staff, key, command);
      let expected = { revision: report.manualRevision, contentHash: report.manualContentHash }, result;
      for (const [index, step] of STEPS.entries()) {
        const id = actionId(key, step), prior = await service.status(staff, job.cardId, id);
        if (prior.state === 'COMMITTED') {
          result = prior.result; expected = result.card;
          // A lost repository reply may precede the workflow's post-commit
          // reviewed-memory publication. Resume that exact real human action.
          if (step === 'FINDINGS') {
            try { await connected.assistance.publish(staff, job.cardId, id); } catch { /* Existing durable publication remains recoverable. */ }
          }
          continue;
        }
        const card = await service.read(staff, job.cardId);
        requireThat(card.revision === report.manualRevision + index && card.contentHash === expected.contentHash,
          409, 'BATCH_REVIEW_STALE');
        const state = await connected.workflow.hydrate(card); let action;
        if (step === 'GEOMETRY') action = { type: 'CONFIRM_GEOMETRY', reviewed: true,
          base: Object.fromEntries(SIDES.map(side => [side, geometryBase(state.geometry, side, 'REVIEW')])) };
        else if (step.startsWith('INSPECT_')) { const side = step.slice(8);
          action = { type: 'INSPECT_SIDE', side, base: defectBase(state.defects, side), inspected: true };
        } else if (step === 'FINDINGS') action = { type: 'CONFIRM_FINDINGS', reviewed: true,
          base: Object.fromEntries(SIDES.map(side => [side, defectBase(state.defects, side)])),
          ...(command.proposalReview.proposalIds.length ? { proposalReview: command.proposalReview } : {}) };
        else {
          const preview = await service.previewReport(staff, job.cardId);
          requireThat(preview.sourceRevision === card.revision && preview.sourceHash === card.contentHash, 409, 'BATCH_REVIEW_STALE');
          assertMachineReportUnchanged(report, preview.review.report);
          action = { type: 'APPROVE_REPORT', reportHash: preview.reportHash, reviewed: true };
        }
        result = await service.execute(staff, job.cardId, { actionId: id, expectedRevision: card.revision, action });
        requireThat(result.card.revision === card.revision + 1, 409, 'BATCH_REVIEW_STALE'); expected = result.card;
      }
      await progress(staff, job, report);
      // An idempotent recovery verifies the actual saved approval too; a
      // coincidentally occupied action id can never substitute another report.
      return recoverApproval(staff, job, report, result);
    },
  });
}
