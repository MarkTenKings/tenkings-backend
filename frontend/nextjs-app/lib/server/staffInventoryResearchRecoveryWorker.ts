import { randomUUID } from 'node:crypto';
import {
  prisma, claimStaffInventoryResearchRecoveryV2, completeStaffInventoryResearchRecoveryV2, failStaffInventoryResearchRecoveryV2,
  reserveStaffInventoryResearchRecoveryScopeV2, reserveStaffInventoryResearchRecoverySourcesV2, readStaffInventoryResearchRecoverySourcesV2, type StaffInventoryResearchRecoveryClaimV2,
} from '@tenkings/database';
import { StaffInventoryResearchRecoveryAssessmentSchema, STAFF_INVENTORY_RESEARCH_PHOTO_ENGINE_VERSION, STAFF_INVENTORY_RESEARCH_ENGINE_VERSION, STAFF_INVENTORY_RESEARCH_CATALOG_ENGINE_VERSION,
  type StaffInventoryResearchInput, type StaffInventoryResearchRecoveryAssessment } from '@tenkings/shared';
import { identifyStaffInventoryCard, readStaffInventoryPhoto } from './staffInventoryIdentification';
import { researchCatalogScopeResolver } from './staffInventoryResearch';
import { createResearchCatalogAdapter, type CatalogPhotos } from './staffInventoryResearchCatalog';
import { prepareStaffInventoryResearchRecoveryIdentity } from './staffInventoryResearchRecoveryIdentity';
import { loadStaffInventoryResearchReferences } from './staffInventoryResearchReferences';
import { prepareRecoverySources, inventoryRecoverySourceDemand } from './staffInventoryResearchRecoverySources';
import { STAFF_INVENTORY_RESEARCH_SALE_DETAILS_ENGINE_VERSION } from './staffInventoryResearchSaleDetails';

const transactionOptions = { isolationLevel: 'ReadCommitted' as const, maxWait: 5000, timeout: 15000 };
export const inventoryRecoveryEnabled = () => process.env.STAFF_INVENTORY_RESEARCH_RECOVERY_ENABLED === 'true';
export const inventoryRecoveryCatalogEnabled = () => process.env.SET_CATALOG_EVIDENCE_ENABLED === 'true' && process.env.STAFF_INVENTORY_RESEARCH_CATALOG_EVIDENCE === 'true';

/** One bounded background check. Every paid recognition/scope allowance belongs
 * to the durable lease; ordinary rechecks reuse receipts and read catalog only. */
export async function prepareInventoryRecoveryAssessment(input: StaffInventoryResearchInput, options: {
  previousAssessment: StaffInventoryResearchRecoveryAssessment | null;
  allowRecognition: boolean;
  allowScopeResolution: boolean;
  reserveScope?: () => Promise<boolean>;
  reserveSources?: (demandHash: string) => Promise<boolean>;
  readSources?: (demandHash: string) => ReturnType<typeof readStaffInventoryResearchRecoverySourcesV2>;
  attemptId: string;
  legacyAuthority?: boolean;
}, signal: AbortSignal) {
  const env = process.env;
  const catalogEnabled = inventoryRecoveryCatalogEnabled();
  const scope = researchCatalogScopeResolver({ catalogScopeInvocation: { attemptId: options.attemptId, invocationId: `scope:${randomUUID()}` } });
  const catalog = createResearchCatalogAdapter({ targetOriginKeys: [`inventory-unit:${input.unit_id}`],
    previousScope: options.previousAssessment?.catalog_context ?? undefined, allowScopeResolution: options.allowScopeResolution,
    resolveScope: async (request, scopeSignal) => {
      if (scopeSignal.aborted || !options.reserveScope || !await options.reserveScope() || scopeSignal.aborted) throw new Error('Scope recovery allowance unavailable.');
      return scope(request, scopeSignal);
    },
  });
  const assessment = await prepareStaffInventoryResearchRecoveryIdentity(input, {
    allowRecognition: options.allowRecognition,
    previousRecognition: options.previousAssessment?.recognition.evidence ?? null,
    previousCatalogContext: options.previousAssessment?.catalog_context ?? null,
    recognize: (request, recognitionSignal) => identifyStaffInventoryCard(request, { env }, recognitionSignal),
    legacyAuthority: options.legacyAuthority,
    researchEngineVersion: [...(options.legacyAuthority ? [catalogEnabled ? STAFF_INVENTORY_RESEARCH_CATALOG_ENGINE_VERSION : STAFF_INVENTORY_RESEARCH_ENGINE_VERSION]
      : [STAFF_INVENTORY_RESEARCH_PHOTO_ENGINE_VERSION, catalogEnabled ? 'catalog-enabled' : 'catalog-disabled']),
      env.STAFF_INVENTORY_RESEARCH_SALE_DETAILS === 'true' ? STAFF_INVENTORY_RESEARCH_SALE_DETAILS_ENGINE_VERSION : 'search-prices',
      env.STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES === 'true' ? 'full-res-images' : 'standard-images'].join(':'),
    ...(catalogEnabled ? { loadCatalog: async (description: StaffInventoryResearchInput['description'], catalogSignal: AbortSignal) => {
      const photos: CatalogPhotos = {};
      await Promise.all((['front', 'back'] as const).map(async side => {
        const key = input[`${side}_photo_key`];
        if (key) photos[side] = await readStaffInventoryPhoto(key, { env }, catalogSignal);
      }));
      return catalog.load(description, photos, catalogSignal);
    } } : { loadReferences: loadStaffInventoryResearchReferences }),
  }, signal);
  // Source links are a review packet only, never part of reference authority or
  // the refresh digest. Reuse one public set demand across different cards.
  const previousSources = options.previousAssessment?.source_discovery;
  if (previousSources) assessment.source_discovery = previousSources;
  else if (options.readSources && options.reserveSources && !assessment.missing_fields.length && !assessment.conflicts.length
      && assessment.need_codes.some(code => code === 'MISSING_CATALOG_REFERENCE' || code === 'MISSING_DIAGNOSTIC_EVIDENCE')) {
    const demand = inventoryRecoverySourceDemand(assessment.proposed_description);
    if (demand && !signal.aborted) {
      const retained = await options.readSources(demand.demand_sha256);
      if (retained) assessment.source_discovery = retained;
      else if (!signal.aborted && await options.reserveSources(demand.demand_sha256) && !signal.aborted) {
        assessment.source_discovery = await prepareRecoverySources(assessment.proposed_description, signal);
      }
    }
  }
  return StaffInventoryResearchRecoveryAssessmentSchema.parse(assessment);
}
export type InventoryResearchRecoveryWorkerDependencies = {
  claim: () => Promise<StaffInventoryResearchRecoveryClaimV2 | null>;
  prepare: (claim: StaffInventoryResearchRecoveryClaimV2, signal: AbortSignal) => Promise<StaffInventoryResearchRecoveryAssessment>;
  complete: (claim: StaffInventoryResearchRecoveryClaimV2, assessment: StaffInventoryResearchRecoveryAssessment) => Promise<'queued' | 'waiting' | 'stale'>;
  fail: (claim: StaffInventoryResearchRecoveryClaimV2) => Promise<boolean>;
  now?: () => number;
};
export const inventoryResearchRecoveryWorkerDependencies: InventoryResearchRecoveryWorkerDependencies = {
  claim: () => prisma.$transaction(tx => claimStaffInventoryResearchRecoveryV2(tx, { leaseMs: 120000, maxConcurrent: 2 }), transactionOptions),
  prepare: (claim, signal) => prepareInventoryRecoveryAssessment(claim.input, {
    previousAssessment: claim.previousAssessment, allowRecognition: claim.allowRecognition, allowScopeResolution: claim.allowScopeResolution,
    reserveScope: () => prisma.$transaction(tx => reserveStaffInventoryResearchRecoveryScopeV2(tx, { claim }), transactionOptions),
    readSources: demandHash => readStaffInventoryResearchRecoverySourcesV2(prisma, { demandHash }),
    reserveSources: demandHash => prisma.$transaction(tx => reserveStaffInventoryResearchRecoverySourcesV2(tx, { claim, demandHash }), transactionOptions),
    attemptId: `inventory-recovery:${claim.jobId}:${claim.leaseToken}`,
  }, signal),
  complete: (claim, assessment) => prisma.$transaction(tx => completeStaffInventoryResearchRecoveryV2(tx, { claim, assessment }), transactionOptions),
  fail: claim => prisma.$transaction(tx => failStaffInventoryResearchRecoveryV2(tx, { claim }), transactionOptions),
};

/** Called and awaited by the sole research cron, never by inventory reads/save. */
export async function runStaffInventoryResearchRecovery(input: { remainingBudgetMs: number; signal: AbortSignal }, deps = inventoryResearchRecoveryWorkerDependencies) {
  const now = deps.now ?? Date.now, started = now(), counts = { checked: 0, queued: 0, waiting: 0, failed: 0, stale: 0 };
  const reserveMs = 20000, checkMs = 90000;
  while (!input.signal.aborted && counts.checked < 4 && input.remainingBudgetMs - (now() - started) >= checkMs + reserveMs * 2) {
    const claim = await deps.claim();
    if (!claim) break;
    counts.checked++;
    const controller = new AbortController(), abort = () => controller.abort();
    input.signal.addEventListener('abort', abort, { once: true });
    if (input.signal.aborted) abort();
    const budget = Math.min(checkMs, Date.parse(claim.leaseExpiresAt) - now() - reserveMs, input.remainingBudgetMs - (now() - started) - reserveMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      if (controller.signal.aborted || !Number.isFinite(budget) || budget <= 0) throw new Error('Recovery deadline expired.');
      timer = setTimeout(abort, budget);
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('Recovery check cancelled.'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const assessment = await Promise.race([deps.prepare(claim, controller.signal), cancelled]);
      if (controller.signal.aborted) throw new Error('Recovery check cancelled.');
      clearTimeout(timer);
      const status = await deps.complete(claim, assessment);
      counts[status]++;
    } catch {
      if (await deps.fail(claim)) counts.failed++; else counts.stale++;
    } finally {
      clearTimeout(timer); if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      input.signal.removeEventListener('abort', abort); controller.abort();
    }
  }
  return counts;
}
