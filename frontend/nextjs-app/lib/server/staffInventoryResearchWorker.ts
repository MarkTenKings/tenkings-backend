import { randomUUID } from 'node:crypto';
import { prisma, claimStaffInventoryResearchV2, completeStaffInventoryResearchV2, failStaffInventoryResearchV2, readStaffInventoryResearchRecoveryAssessmentV2, type StaffInventoryResearchClaimV2 } from '@tenkings/database';
import { researchStaffInventoryCard, researchCatalogScopeResolver, StaffInventoryResearchError } from './staffInventoryResearch';
import { STAFF_INVENTORY_RESEARCH_LIMITS } from '../staffInventoryResearch';
import { loadStaffInventoryResearchReferences } from './staffInventoryResearchReferences';
import { archiveStaffInventoryResearchImage } from './staffInventoryResearchStorage';
import { createResearchCatalogAdapter } from './staffInventoryResearchCatalog';
import { inventoryRecoveryEnabled, inventoryRecoveryCatalogEnabled, prepareInventoryRecoveryAssessment, runStaffInventoryResearchRecovery } from './staffInventoryResearchRecoveryWorker';

export type StaffInventoryResearchWorkerDependencies = {
  claim: () => Promise<StaffInventoryResearchClaimV2 | null>;
  research: (input: StaffInventoryResearchClaimV2['input'], signal: AbortSignal, claim?: StaffInventoryResearchClaimV2) => ReturnType<typeof researchStaffInventoryCard>;
  complete: (claim: StaffInventoryResearchClaimV2, result: Awaited<ReturnType<typeof researchStaffInventoryCard>>) => Promise<boolean>;
  fail: (claim: StaffInventoryResearchClaimV2, error: StaffInventoryResearchError) => Promise<boolean>;
  recover?: (input: { remainingBudgetMs: number; signal: AbortSignal }) => Promise<unknown>;
  reconcileCatalog?: (input: { remainingBudgetMs: number; signal: AbortSignal }) => Promise<unknown>;
  now?: () => number;
};

const transactionOptions = { isolationLevel: 'ReadCommitted' as const, maxWait: 5000, timeout: 15000 };
export const staffInventoryResearchWorkerDependencies: StaffInventoryResearchWorkerDependencies = {
  claim: () => prisma.$transaction(tx => claimStaffInventoryResearchV2(tx, { leaseMs: 180000, maxConcurrent: 2, requireRecovery: inventoryRecoveryEnabled() }), transactionOptions),
  research: async (input, signal, claim) => {
    const recoveryAssessment = inventoryRecoveryEnabled() && claim
      ? await readStaffInventoryResearchRecoveryAssessmentV2(prisma, { jobId: claim.jobId, inputHash: claim.inputHash, attempt: claim.attempt }) : null;
    if (claim?.recoveryEvidenceHash && (!inventoryRecoveryEnabled() || !recoveryAssessment
        || recoveryAssessment.evidence_sha256 !== claim.recoveryEvidenceHash)) throw new StaffInventoryResearchError('unavailable');
    if (recoveryAssessment?.resolver_version === 'staff-inventory-recovery-identity-v1') {
      // Preserve v1's catalog-bound authority. V2 authorizes retrieval from
      // immutable saved/photo context; fresh engine checks qualify any value.
      // A catalog outage must not consume its retrieval attempt before search.
      const current = await prepareInventoryRecoveryAssessment(input, { previousAssessment: recoveryAssessment,
        allowRecognition: false, allowScopeResolution: false, legacyAuthority: true, attemptId: `inventory:${claim!.jobId}:${claim!.attempt}` }, signal);
      if (!current.ready_for_research || current.evidence_sha256 !== recoveryAssessment.evidence_sha256) throw new StaffInventoryResearchError('unavailable');
    }
    const common = { archiveCandidateImage: archiveStaffInventoryResearchImage, ...(recoveryAssessment ? { recoveryAssessment } : {}) };
    if (!inventoryRecoveryCatalogEnabled()) return researchStaffInventoryCard(input, { ...common, loadReferences: loadStaffInventoryResearchReferences }, signal);
    const catalog = createResearchCatalogAdapter({ targetOriginKeys: [`inventory-unit:${input.unit_id}`],
      ...(recoveryAssessment ? { previousScope: recoveryAssessment.catalog_context ?? undefined, allowScopeResolution: false } : {}),
      resolveScope: researchCatalogScopeResolver({ catalogScopeInvocation: { attemptId: claim ? `inventory:${claim.jobId}:${claim.attempt}` : `inventory:${randomUUID()}`, invocationId: `scope:${randomUUID()}` } }) });
    return researchStaffInventoryCard(input, { ...common, loadCatalog: catalog.load, isCatalogCurrent: catalog.current, loadReferenceImage: catalog.image }, signal);
  },
  complete: (claim, result) => prisma.$transaction(tx => completeStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, result }), transactionOptions),
  fail: (claim, error) => prisma.$transaction(tx => failStaffInventoryResearchV2(tx, {
    jobId: claim.jobId, leaseToken: claim.leaseToken, errorCode: error.code.toUpperCase(), errorMessage: error.message,
    retryable: ['provider_error', 'timeout', 'cancelled'].includes(error.code),
  }), transactionOptions),
  recover: async input => { if (inventoryRecoveryEnabled()) return runStaffInventoryResearchRecovery(input); },
  reconcileCatalog: async input => {
    if (process.env.SET_CATALOG_EVIDENCE_ENABLED !== 'true' || process.env.STAFF_INVENTORY_CATALOG_CONTRIBUTIONS_ENABLED !== 'true') return;
    const { reconcileStaffInventoryCatalogObservations } = await import('./staffInventoryCatalogObservations');
    return reconcileStaffInventoryCatalogObservations(input);
  },
};

/** Await real durable work in a scheduled invocation. No phone, polling request,
 * or unawaited promise owns the job. Database leases cap all invocations. */
export async function runStaffInventoryResearchWorker(deps = staffInventoryResearchWorkerDependencies, parent?: AbortSignal) {
  const now = deps.now ?? Date.now, started = now(), controller = new AbortController();
  // A claim can spend 5s waiting and 15s in its transaction. Reserve the same
  // completion budget after the 150s engine so later jobs get a full attempt.
  const runBudgetMs = 240000, transactionBudgetMs = transactionOptions.maxWait + transactionOptions.timeout;
  const attemptBudgetMs = transactionBudgetMs * 2 + STAFF_INVENTORY_RESEARCH_LIMITS.overallTimeoutMs;
  const abort = () => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(abort, runBudgetMs);
  const counts = { claimed: 0, completed: 0, failed: 0, superseded: 0 };
  let recovery: unknown;
  try {
    while (!controller.signal.aborted && counts.claimed < 4 && now() - started < runBudgetMs - attemptBudgetMs) {
      const claim = await deps.claim();
      if (!claim) break;
      counts.claimed++;
      const attemptController = new AbortController();
      const abortAttempt = () => attemptController.abort();
      controller.signal.addEventListener('abort', abortAttempt, { once: true });
      if (controller.signal.aborted) abortAttempt();
      const claimedAt = now();
      const researchBudgetMs = Math.min(STAFF_INVENTORY_RESEARCH_LIMITS.overallTimeoutMs,
        Date.parse(claim.leaseExpiresAt) - claimedAt - transactionBudgetMs,
        runBudgetMs - (claimedAt - started) - transactionBudgetMs);
      let attemptTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (controller.signal.aborted) throw new StaffInventoryResearchError('cancelled');
        if (!Number.isFinite(researchBudgetMs) || researchBudgetMs <= 0) throw new StaffInventoryResearchError('timeout');
        attemptTimer = setTimeout(abortAttempt, researchBudgetMs);
        const result = await deps.research(claim.input, attemptController.signal, claim);
        if (attemptController.signal.aborted) throw new StaffInventoryResearchError(controller.signal.aborted ? 'cancelled' : 'timeout');
        clearTimeout(attemptTimer);
        if (await deps.complete(claim, result)) counts.completed++;
        else counts.superseded++;
      } catch (error) {
        const safe = controller.signal.aborted ? new StaffInventoryResearchError('cancelled')
          : attemptController.signal.aborted ? new StaffInventoryResearchError('timeout')
            : error instanceof StaffInventoryResearchError ? error : new StaffInventoryResearchError('provider_error');
        if (await deps.fail(claim, safe)) counts.failed++;
        else counts.superseded++;
      } finally {
        clearTimeout(attemptTimer);
        controller.signal.removeEventListener('abort', abortAttempt);
        attemptController.abort();
      }
    }
    // Ready paid work goes first: a stream of slow recovery checks must never
    // starve cards already authorized for research. The next cron sees new work.
    if (!controller.signal.aborted && deps.recover) {
      recovery = await deps.recover({ remainingBudgetMs: Math.max(0, runBudgetMs - (now() - started)), signal: controller.signal });
    }
    // Completed results are already durable. This optional, bounded scan has
    // its own cursor and must never retry paid research when contribution fails.
    if (!controller.signal.aborted && deps.reconcileCatalog) {
      try { await deps.reconcileCatalog({ remainingBudgetMs: Math.max(0, runBudgetMs - (now() - started)), signal: controller.signal }); }
      catch { console.warn('[inventory-research] Optional catalog contribution deferred.'); }
    }
    return recovery === undefined ? counts : { ...counts, recovery };
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); controller.abort(); }
}
