import { digest, requireThat } from '@atlas/manual-service/contract';
import { batchActionId } from '@atlas/batch-grading';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import { ATLAS_RULE_VERSION } from '@atlas/grading-core/atlas-policy';

const SIDES = ['FRONT', 'BACK'];
const STEPS = ['GEOMETRY', 'INSPECT_FRONT', 'INSPECT_BACK', 'FINDINGS', 'APPROVAL'];
const actionId = (key, step) => batchActionId(key, `HUMAN_REVIEW_${step}`);
/** The batch surface reads immutable machine evidence and opens the current
 * manual workspace. It cannot issue human inspection or approval commands. */
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
    const current = card.revision === expected.revision && card.contentHash === expected.contentHash
      && card.draft.source.sourceHash === job.sourceHash;
    return { card, complete, result, current };
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
        requireThat(recovered.current && recovered.complete < STEPS.length && card.revision === recovered.card.revision
          && card.contentHash === recovered.card.contentHash, 409, 'BATCH_REVIEW_STALE');
        resumeBase = { revision: card.revision, contentHash: card.contentHash, completedSteps: recovered.complete };
      } else requireThat(!review && card.revision === report.manualRevision && card.contentHash === report.manualContentHash,
        409, 'BATCH_REVIEW_STALE');
      // These observations and measured findings are already bound by the
      // immutable report hash. Model availability/currentness is irrelevant
      // to opening human review. Older reports retain only their recorded
      // unmeasurable observations; do not reconstruct missing model metadata.
      const proposals = report.proposals ?? report.unmeasurableProposals ?? [];
      return { batchKey, reportHash, report, proposals, ...(resumeBase ? { resumeBase } : {}) };
    },
    async detail(staff, key) {
      const { job, report, review } = await load(staff, key);
      const latest = await service.read(staff, job.cardId);
      if (latest.draft.finalReview) {
        const state = await connected.workflow.hydrate(latest);
        requireThat(state.finalReview.batchKey === key && state.finalReview.reportHash === job.evidence.reportHash,
          409, 'BATCH_REVIEW_BINDING_CHANGED');
        const current = connected.workflow.currentPreview(latest, state);
        return { key, cardId: job.cardId, correctionAvailable: true, canCertify: false,
          ...current, images: await connected.imageDescriptors({ card: latest, state, staff }) };
      }
      const { card, complete, current } = await progress(staff, job, report);
      // A newer manual draft opens in the same workspace. Do not offer the old
      // report for adoption or overwrite current human findings with it.
      if (!current) return {key, cardId: job.cardId, state: 'CURRENT_MANUAL', correctionAvailable: true, canCertify: false};
      const state = await connected.workflow.hydrate(card);
      const images = await connected.imageDescriptors({ card, state, staff });
      // Pure explanation of the same deterministic numbers. This local
      // presentation input creates neither a human report nor an attestation.
      const geometryUnresolved = report.calculationState === 'GEOMETRY_UNRESOLVED' || !Number.isFinite(report.proposedGrade);
      const explanation = geometryUnresolved ? null : explainAtlasManualReport({ ...report, version: 'atlas-manual-draft-report-v2', finalGrade: report.proposedGrade });
      await repository.readReview(staff, key);
      const reviewRequiredReason = geometryUnresolved ? 'BATCH_FINAL_GEOMETRY_REQUIRED'
        : report.ruleVersion !== ATLAS_RULE_VERSION && complete < STEPS.length ? 'BATCH_SCORING_POLICY_UPDATED' : null;
      return { key, cardId: job.cardId, reportHash: job.evidence.reportHash, report, explanation, images,
        canCertify: false, reviewRequiredReason,
        resumeAvailable: Boolean(review), approved: complete === STEPS.length };
    },
  });
}
