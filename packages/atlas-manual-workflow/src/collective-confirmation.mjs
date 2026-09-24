import { canonical, requireThat, ManualServiceError } from '@atlas/manual-service/contract';
import { beginDefectEdit, applyDefectMeasurement, defectBase, confirmDefectFindings,
  markDefectSideInspected } from '@atlas/manual-workspace/defect-actions';
import { checkProposalReview, proposalEdit } from './proposal-review.mjs';

const SIDES = ['FRONT', 'BACK'];
export function confirmationBudget(startedAt, timeoutMs) {
  const deadlineAt = startedAt + timeoutMs;
  const check = () => requireThat(Date.now() < deadlineAt, 422, 'MANUAL_CONFIRM_DEADLINE');
  return { deadlineAt, check, remaining: () => { check(); return Math.max(1, deadlineAt - Date.now()); },
    async run(work) {
      check(); let timer;
      try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ManualServiceError(422, 'MANUAL_CONFIRM_DEADLINE')), Math.max(1, deadlineAt - Date.now()));
      })]); } finally { clearTimeout(timer); }
    } };
}

/** One explicit human command builds one candidate. No intermediate card commit
 * or automatic decision occurs here. Failure leaves the original draft intact. */
export async function collectivelyConfirmDefects({ defects, assistance, request, entries, principal,
  measure, pythonExecutable, measurementLimits, budget }) {
  // The user's two inspection attestations must bind the exact original bases.
  // Calling this validator first never publishes the resulting candidate.
  confirmDefectFindings(defects, { base: request.base, reviewed: request.reviewed, actor: 'HUMAN' });
  requireThat(Array.isArray(entries) && entries.length > 0 && entries.length <= 32
    && new Set(entries.map(entry => entry.proposal.id)).size === entries.length, 400, 'MANUAL_PROPOSAL_ACTION_INVALID');
  for (const side of SIDES) requireThat(defects.sides[side].findings.length
    + entries.filter(entry => entry.proposal.side === side).length <= (measurementLimits?.maxFindings ?? 200),
  413, 'MANUAL_PROPOSAL_REVIEW_LIMIT');
  const original = defects, affected = new Set();
  let reviewed = assistance ?? { version: 'atlas-defect-assistance-v1', reviews: [] };
  requireThat(reviewed.reviews.length + entries.length <= 200, 413, 'MANUAL_PROPOSAL_REVIEW_LIMIT');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), budget.remaining());
  try {
    for (const resolved of entries) {
      budget.check();
      const side = resolved.proposal.side, base = defectBase(defects, side);
      const action = { side, base, analysisId: request.proposalReview.analysisId,
        proposalId: resolved.proposal.id, action: 'ACCEPT' };
      checkProposalReview(defects, action, resolved, reviewed);
      const trace = proposalEdit(resolved.proposal, side, base.cornerShape);
      defects = beginDefectEdit(defects, { side, base, actor: 'HUMAN',
        action: { type: 'TRACE_SAVE', side, findingId: null, trace } }).state;
      const result = await budget.run(() => measure({ workspace: defects, side, pythonExecutable, signal: controller.signal,
        limits: { ...measurementLimits, timeoutMs: Math.min(measurementLimits?.timeoutMs ?? 90000, budget.remaining()) } }));
      budget.check();
      defects = applyDefectMeasurement(defects, result).state;
      reviewed = { ...reviewed, reviews: [...reviewed.reviews, { ...action, findingId: trace.id,
        proposal: resolved.proposal, reviewerId: principal.id, reviewedAt: new Date().toISOString() }] };
      affected.add(side);
    }
    // This explicit collective confirmation approves exactly the displayed
    // traces selected above. It cannot reuse an inspection for a changed photo,
    // card outline, material, other concurrent edit, or later analysis.
    for (const side of SIDES) {
      requireThat(canonical(original.sides[side].frame) === canonical(defects.sides[side].frame)
        && original.sides[side].cornerShape === defects.sides[side].cornerShape, 409, 'MANUAL_ASTRA_REVIEW_STALE');
      if (affected.has(side)) defects = markDefectSideInspected(defects, { side, base: defectBase(defects, side),
        actor: 'HUMAN', inspected: true }).state;
    }
    budget.check();
    defects = confirmDefectFindings(defects, { base: Object.fromEntries(SIDES.map(side => [side, defectBase(defects, side)])),
      actor: 'HUMAN', reviewed: true }).state;
    return { defects, assistance: reviewed };
  } finally { clearTimeout(timer); controller.abort(); }
}
