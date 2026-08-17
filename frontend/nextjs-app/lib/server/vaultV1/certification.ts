import {
  CERTIFICATION_AUTOMATED_TRANSACTIONS,
  CERTIFICATION_HUMAN_SESSIONS,
  CERTIFICATION_PURCHASE_CYCLES_PER_DOOR,
  CERTIFICATION_RESTOCK_CYCLES_PER_DOOR,
  VAULT_DOOR_MAP,
} from "@tenkings/vault-contracts";
import { z } from "zod";

export const VaultCertificationEvidenceManifestSchema = z.object({
  certificationId: z.string().uuid(),
  reason: z.string().min(8).max(1000),
  automatedTransactions: z.number().int().min(CERTIFICATION_AUTOMATED_TRANSACTIONS).max(10_000_000),
  observedSessions: z.number().int().min(CERTIFICATION_HUMAN_SESSIONS).max(10_000_000),
  hardwareIdentity: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.union([z.string().max(500), z.number().int(), z.boolean(), z.null()])).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 64),
  unresolvedDeviations: z.array(z.object({ code: z.string().min(1).max(120), summary: z.string().min(1).max(1000) }).strict()).max(1000),
  evidenceBindings: z.array(z.object({
    evidenceId: z.string().uuid(),
    artifactStorageKey: z.string().regex(/^vault-certification\/[A-Za-z0-9/_=+.-]{1,900}$/),
    cycleType: z.enum(["PURCHASE", "RESTOCK"]),
  }).strict()).min(1).max(5000).refine((bindings) => new Set(bindings.map((binding) => binding.evidenceId)).size === bindings.length && new Set(bindings.map((binding) => binding.artifactStorageKey)).size === bindings.length),
}).strict();

type CertificationEvidence = {
  evidenceId: string;
  doorId: string | null;
  evidenceClass: string | null;
  outcome: string;
  expectedDoorIds: unknown;
  observedDoorIds: unknown;
  artifactDigest: string | null;
  artifactStorageKey: string | null;
  metadata: unknown;
};

export type VaultCertificationApprovalInput = {
  status: string;
  sourceCommit: string;
  appBuild: string | null;
  localSchemaVersion: number | null;
  contractVersion: number;
  configVersion: { digest: string };
  nayaxAdapterVersion: string | null;
  nayaxSdkVersion: string | null;
  nayaxFlowConfig: unknown;
  controllerIdentity: unknown;
  hardwareIdentity: unknown;
  evidenceSummary: unknown;
  unresolvedDeviations: unknown;
  evidence: CertificationEvidence[];
};

export type VaultCertificationApprovalResult = {
  eligible: boolean;
  reasons: string[];
  counts: {
    automatedTransactions: number;
    observedSessions: number;
    purchaseDoorsComplete: number;
    restockDoorsComplete: number;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonemptyRecord(value: unknown): boolean {
  const parsed = record(value);
  return Boolean(parsed && Object.values(parsed).some((entry) => {
    if (typeof entry === "string") return entry.trim().length > 0;
    if (typeof entry === "number") return Number.isFinite(entry);
    if (typeof entry === "boolean") return true;
    if (Array.isArray(entry)) return entry.length > 0;
    return Boolean(record(entry) && Object.keys(record(entry)!).length > 0);
  }));
}

function noDeviations(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  const parsed = record(value);
  return Boolean(parsed && parsed.count === 0 && Array.isArray(parsed.items) && parsed.items.length === 0);
}

function exactDoorEvidence(evidence: CertificationEvidence): boolean {
  if (!evidence.doorId || !Array.isArray(evidence.expectedDoorIds) || !Array.isArray(evidence.observedDoorIds)) return false;
  const metadata = record(evidence.metadata);
  return evidence.expectedDoorIds.length === 1
    && evidence.expectedDoorIds[0] === evidence.doorId
    && evidence.observedDoorIds.length === 1
    && evidence.observedDoorIds[0] === evidence.doorId
    && metadata?.unexpectedDoor === false;
}

export function evaluateVaultCertificationApproval(input: VaultCertificationApprovalInput): VaultCertificationApprovalResult {
  const reasons: string[] = [];
  const summary = record(input.evidenceSummary);
  const automatedTransactions = typeof summary?.automatedTransactions === "number" && Number.isSafeInteger(summary.automatedTransactions) ? summary.automatedTransactions : 0;
  const observedSessions = typeof summary?.observedSessions === "number" && Number.isSafeInteger(summary.observedSessions) ? summary.observedSessions : 0;
  if (input.status !== "REVIEW_REQUIRED") reasons.push("STATUS_NOT_REVIEW_REQUIRED");
  if (input.evidence.some((evidence) => evidence.outcome === "FAIL")) reasons.push("FAIL_EVIDENCE_PRESENT");
  if (input.evidence.some((evidence) => evidence.outcome === "CRITICAL")) reasons.push("CRITICAL_EVIDENCE_PRESENT");
  if (automatedTransactions < CERTIFICATION_AUTOMATED_TRANSACTIONS) reasons.push("AUTOMATED_TRANSACTION_COUNT_INCOMPLETE");
  if (observedSessions < CERTIFICATION_HUMAN_SESSIONS) reasons.push("OBSERVED_SESSION_COUNT_INCOMPLETE");
  if (!input.appBuild?.trim() || !/^[a-f0-9]{7,64}$/.test(input.sourceCommit) || !Number.isSafeInteger(input.localSchemaVersion) || Number(input.localSchemaVersion) < 1 || input.contractVersion !== 1 || !/^[a-f0-9]{64}$/.test(input.configVersion.digest)) {
    reasons.push("SOURCE_BUILD_CONFIG_TUPLE_INCOMPLETE");
  }
  if (!input.nayaxAdapterVersion || !input.nayaxSdkVersion || !nonemptyRecord(input.nayaxFlowConfig) || !nonemptyRecord(input.controllerIdentity) || !nonemptyRecord(input.hardwareIdentity)) {
    reasons.push("ADAPTER_OR_HARDWARE_IDENTITY_INCOMPLETE");
  }
  if (!noDeviations(input.unresolvedDeviations)) reasons.push("UNRESOLVED_DEVIATIONS_PRESENT");
  if (!input.evidence.length || input.evidence.some((evidence) => !evidence.evidenceClass || !evidence.artifactStorageKey || !evidence.artifactDigest || !/^[a-f0-9]{64}$/.test(evidence.artifactDigest))) {
    reasons.push("ARTIFACT_EVIDENCE_INCOMPLETE");
  }

  const purchaseCounts = new Map<string, number>();
  const restockCounts = new Map<string, number>();
  for (const evidence of input.evidence) {
    if (evidence.outcome !== "PASS" || !evidence.doorId || !exactDoorEvidence(evidence)) continue;
    const doorId = evidence.doorId;
    const metadata = record(evidence.metadata);
    if (metadata?.cycleType === "PURCHASE") purchaseCounts.set(doorId, (purchaseCounts.get(doorId) ?? 0) + 1);
    if (metadata?.cycleType === "RESTOCK") restockCounts.set(doorId, (restockCounts.get(doorId) ?? 0) + 1);
  }
  const purchaseDoorsComplete = VAULT_DOOR_MAP.filter(({ doorId }) => (purchaseCounts.get(doorId) ?? 0) >= CERTIFICATION_PURCHASE_CYCLES_PER_DOOR).length;
  const restockDoorsComplete = VAULT_DOOR_MAP.filter(({ doorId }) => (restockCounts.get(doorId) ?? 0) >= CERTIFICATION_RESTOCK_CYCLES_PER_DOOR).length;
  if (purchaseDoorsComplete !== VAULT_DOOR_MAP.length) reasons.push("PURCHASE_CYCLES_INCOMPLETE");
  if (restockDoorsComplete !== VAULT_DOOR_MAP.length) reasons.push("RESTOCK_CYCLES_INCOMPLETE");

  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    counts: { automatedTransactions, observedSessions, purchaseDoorsComplete, restockDoorsComplete },
  };
}
