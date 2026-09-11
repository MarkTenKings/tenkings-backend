import { prisma, claimStaffInventoryResearchV2, completeStaffInventoryResearchV2, failStaffInventoryResearchV2, type StaffInventoryResearchClaimV2 } from '@tenkings/database';
import { researchStaffInventoryCard, StaffInventoryResearchError } from './staffInventoryResearch';
import { loadStaffInventoryResearchReferences } from './staffInventoryResearchReferences';
import { archiveStaffInventoryResearchImage } from './staffInventoryResearchStorage';

export type StaffInventoryResearchWorkerDependencies = {
  claim: () => Promise<StaffInventoryResearchClaimV2 | null>;
  research: (input: StaffInventoryResearchClaimV2['input'], signal: AbortSignal) => ReturnType<typeof researchStaffInventoryCard>;
  complete: (claim: StaffInventoryResearchClaimV2, result: Awaited<ReturnType<typeof researchStaffInventoryCard>>) => Promise<boolean>;
  fail: (claim: StaffInventoryResearchClaimV2, error: StaffInventoryResearchError) => Promise<boolean>;
  now?: () => number;
};

const transactionOptions = { isolationLevel: 'ReadCommitted' as const, maxWait: 5000, timeout: 15000 };
export const staffInventoryResearchWorkerDependencies: StaffInventoryResearchWorkerDependencies = {
  claim: () => prisma.$transaction(tx => claimStaffInventoryResearchV2(tx, { leaseMs: 180000, maxConcurrent: 2 }), transactionOptions),
  research: (input, signal) => researchStaffInventoryCard(input, { loadReferences: loadStaffInventoryResearchReferences, archiveCandidateImage: archiveStaffInventoryResearchImage }, signal),
  complete: (claim, result) => prisma.$transaction(tx => completeStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, result }), transactionOptions),
  fail: (claim, error) => prisma.$transaction(tx => failStaffInventoryResearchV2(tx, {
    jobId: claim.jobId, leaseToken: claim.leaseToken, errorCode: error.code.toUpperCase(), errorMessage: error.message,
    retryable: ['provider_error', 'timeout', 'cancelled'].includes(error.code),
  }), transactionOptions),
};

/** Await real durable work in a scheduled invocation. No phone, polling request,
 * or unawaited promise owns the job. Database leases cap all invocations. */
export async function runStaffInventoryResearchWorker(deps = staffInventoryResearchWorkerDependencies, parent?: AbortSignal) {
  const now = deps.now ?? Date.now, started = now(), controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(abort, 240000);
  const counts = { claimed: 0, completed: 0, failed: 0, superseded: 0 };
  try {
    while (!controller.signal.aborted && counts.claimed < 4 && now() - started < 140000) {
      const claim = await deps.claim();
      if (!claim) break;
      counts.claimed++;
      try {
        const result = await deps.research(claim.input, controller.signal);
        if (await deps.complete(claim, result)) counts.completed++;
        else counts.superseded++;
      } catch (error) {
        const safe = error instanceof StaffInventoryResearchError ? error : new StaffInventoryResearchError('provider_error');
        if (await deps.fail(claim, safe)) counts.failed++;
        else counts.superseded++;
      }
    }
    return counts;
  } finally { clearTimeout(timer); parent?.removeEventListener('abort', abort); controller.abort(); }
}
