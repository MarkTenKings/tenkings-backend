import {
  CERTIFICATION_AUTOMATED_TRANSACTIONS,
  CERTIFICATION_HUMAN_SESSIONS,
  CERTIFICATION_PURCHASE_CYCLES_PER_DOOR,
  CERTIFICATION_RESTOCK_CYCLES_PER_DOOR,
  configDoorIds,
  VaultConfigPayloadSchema,
} from "@tenkings/vault-contracts";
import { z } from "zod";
import { createHash } from "node:crypto";
import { readStorageBufferBounded, openStorageObjectRead, type StorageObjectRead } from "../storage";

export const vaultArtifactKey = z.string().regex(/^vault-certification\/[A-Za-z0-9/_=+.-]{1,900}$/).refine((value) => value.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "Artifact key must not contain traversal segments");
export const VaultVerifyArtifactsSchema = z.object({
  action: z.literal("verify-artifacts"), certificationId: z.string().uuid(), reason: z.string().min(8).max(500),
  bindings: z.array(z.object({ evidenceId: z.string().uuid(), artifactStorageKey: vaultArtifactKey }).strict()).max(25),
  automatedProof: z.object({ artifactStorageKey: vaultArtifactKey, digest: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
}).strict().refine((value) => value.bindings.length > 0 || value.automatedProof, "At least one artifact required");

async function readVaultArtifact(key: string, maximum: number): Promise<Buffer> {
  let stream: StorageObjectRead | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = readStorageBufferBounded(key, maximum, { openRead: async (storageKey) => {
    stream = await openStorageObjectRead(storageKey);
    if (expired) { stream.body.destroy?.(); throw new Error("Artifact read timed out"); }
    return stream;
  } });
  try {
    return await Promise.race([read, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; stream?.body.destroy?.(); reject(new Error("Artifact read timed out")); }, 10_000); })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function verifyVaultArtifact(key: string, expectedDigest: string, read: (key: string, maximum: number) => Promise<Buffer> = readVaultArtifact): Promise<Buffer> {
  vaultArtifactKey.parse(key);
  z.string().regex(/^[a-f0-9]{64}$/).parse(expectedDigest);
  const bytes = await read(key, 1024 * 1024);
  if (bytes.length > 1024 * 1024) throw new Error("Certification artifact exceeds byte limit");
  if (createHash("sha256").update(bytes).digest("hex") !== expectedDigest) throw new Error("Certification artifact digest does not match immutable evidence");
  return bytes;
}

/** A count supplied by an operator is not automated execution evidence. Count
 * distinct passing result records from the hash-verified, exact-build artifact. */
export function verifyVaultAutomatedProof(bytes: Buffer, identity: {
  sourceCommit: string; appBuild: string | null; localSchemaVersion: number | null;
  contractVersion: number; configVersion: { digest: string };
}): number {
  const proof = z.object({
    schemaVersion: z.literal(1), sourceCommit: z.literal(identity.sourceCommit),
    appBuild: z.literal(identity.appBuild), localSchemaVersion: z.literal(identity.localSchemaVersion),
    contractVersion: z.literal(identity.contractVersion), configDigest: z.literal(identity.configVersion.digest),
    transactions: z.array(z.object({ transactionId: z.string().uuid(), result: z.literal("PASS"), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(CERTIFICATION_AUTOMATED_TRANSACTIONS).max(5000),
  }).strict().parse(JSON.parse(bytes.toString("utf8")));
  if (new Set(proof.transactions.map((row) => row.transactionId)).size !== proof.transactions.length) throw new Error("Automated proof repeats a transaction");
  return proof.transactions.length;
}

export function vaultCertificateMatchesReportedBuild(certificate: {
  appBuild: string | null; sourceCommit: string; localSchemaVersion: number | null;
  contractVersion: number; configVersion: { version: number; digest: string };
}, report: { appVersion: string; sourceCommit?: string; localSchemaVersion: number; contractVersion: number; configVersion: number | null; configDigest: string | null }): boolean {
  return report.sourceCommit !== undefined && certificate.sourceCommit === report.sourceCommit
    && certificate.appBuild === report.appVersion && certificate.localSchemaVersion === report.localSchemaVersion
    && certificate.contractVersion === report.contractVersion && certificate.configVersion.version === report.configVersion
    && certificate.configVersion.digest === report.configDigest;
}

export const VaultCertificationEvidenceManifestSchema = z.object({
  certificationId: z.string().uuid(),
  reason: z.string().min(8).max(1000),
  automatedTransactions: z.number().int().min(CERTIFICATION_AUTOMATED_TRANSACTIONS).max(10_000_000),
  observedSessions: z.number().int().min(CERTIFICATION_HUMAN_SESSIONS).max(10_000_000),
  hardwareIdentity: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.union([z.string().max(500), z.number().int(), z.boolean(), z.null()])).refine((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 64),
  unresolvedDeviations: z.array(z.object({ code: z.string().min(1).max(120), summary: z.string().min(1).max(1000) }).strict()).max(1000),
  evidenceBindings: z.array(z.object({
    evidenceId: z.string().uuid(),
    artifactStorageKey: vaultArtifactKey,
    cycleType: z.enum(["DIAGNOSTIC", "PURCHASE", "RESTOCK"]),
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
  configVersion: { digest: string; canonicalPayload?: unknown };
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
  const config = VaultConfigPayloadSchema.safeParse(input.configVersion.canonicalPayload);
  const profileDoorIds = config.success ? configDoorIds(config.data) : [];
  if (!config.success) reasons.push("PROFILE_CONFIG_INVALID");
  if (config.success && config.data.schemaVersion === 2 && config.data.machineProfile.provenance !== "QUALIFIED") reasons.push("PHYSICAL_PROFILE_QUALIFICATION_REQUIRED");
  if (input.evidence.some((evidence) => evidence.doorId && !profileDoorIds.includes(evidence.doorId))) reasons.push("EVIDENCE_OUTSIDE_PROFILE");
  const automatedTransactions = typeof summary?.automatedTransactions === "number" && Number.isSafeInteger(summary.automatedTransactions) ? summary.automatedTransactions : 0;
  const observedSessions = typeof summary?.observedSessions === "number" && Number.isSafeInteger(summary.observedSessions) ? summary.observedSessions : 0;
  if (input.status !== "REVIEW_REQUIRED") reasons.push("STATUS_NOT_REVIEW_REQUIRED");
  if (input.evidence.some((evidence) => evidence.outcome === "FAIL")) reasons.push("FAIL_EVIDENCE_PRESENT");
  if (input.evidence.some((evidence) => evidence.outcome === "CRITICAL")) reasons.push("CRITICAL_EVIDENCE_PRESENT");
  if (automatedTransactions < CERTIFICATION_AUTOMATED_TRANSACTIONS) reasons.push("AUTOMATED_TRANSACTION_COUNT_INCOMPLETE");
  if (observedSessions < CERTIFICATION_HUMAN_SESSIONS) reasons.push("OBSERVED_SESSION_COUNT_INCOMPLETE");
  if (!input.appBuild?.trim() || !/^[a-f0-9]{40}$/.test(input.sourceCommit) || !Number.isSafeInteger(input.localSchemaVersion) || Number(input.localSchemaVersion) < 1 || input.contractVersion !== 1 || !/^[a-f0-9]{64}$/.test(input.configVersion.digest)) {
    reasons.push("SOURCE_BUILD_CONFIG_TUPLE_INCOMPLETE");
  }
  if (!input.nayaxAdapterVersion || !input.nayaxSdkVersion || !nonemptyRecord(input.nayaxFlowConfig) || !nonemptyRecord(input.controllerIdentity) || !nonemptyRecord(input.hardwareIdentity)) {
    reasons.push("ADAPTER_OR_HARDWARE_IDENTITY_INCOMPLETE");
  }
  if (record(input.nayaxFlowConfig)?.mode !== "OFFICIAL_TEST" || record(input.controllerIdentity)?.mode !== "OFFICIAL_TEST") reasons.push("PHYSICAL_ADAPTER_EVIDENCE_REQUIRED");
  if (summary?.automatedEvidenceVerified !== true) reasons.push("AUTOMATED_EVIDENCE_UNVERIFIED");
  if (!noDeviations(input.unresolvedDeviations)) reasons.push("UNRESOLVED_DEVIATIONS_PRESENT");
  if (!input.evidence.length || input.evidence.some((evidence) => !evidence.evidenceClass || !evidence.artifactStorageKey || !evidence.artifactDigest || !/^[a-f0-9]{64}$/.test(evidence.artifactDigest) || record(evidence.metadata)?.verifiedArtifactDigest !== evidence.artifactDigest || record(evidence.metadata)?.verifiedArtifactStorageKey !== evidence.artifactStorageKey)) {
    reasons.push("ARTIFACT_EVIDENCE_INCOMPLETE");
  }

  const purchaseCounts = new Map<string, number>();
  const restockCounts = new Map<string, number>();
  const purchaseSessions = new Set<string>();
  const commands = new Set<string>();
  for (const evidence of input.evidence) {
    if (evidence.outcome !== "PASS" || !evidence.doorId || !exactDoorEvidence(evidence) || !["FULL_MACHINE", "FIELD"].includes(evidence.evidenceClass ?? "")) continue;
    const doorId = evidence.doorId;
    const metadata = record(evidence.metadata);
    if (typeof metadata?.commandId !== "string" || commands.has(metadata.commandId)) continue;
    commands.add(metadata.commandId);
    if (metadata.cycleType === "PURCHASE" && typeof metadata.saleId === "string") { purchaseCounts.set(doorId, (purchaseCounts.get(doorId) ?? 0) + 1); purchaseSessions.add(metadata.saleId); }
    if (metadata.cycleType === "RESTOCK" && typeof metadata.restockSessionId === "string") restockCounts.set(doorId, (restockCounts.get(doorId) ?? 0) + 1);
  }
  const purchaseDoorsComplete = profileDoorIds.filter((doorId) => (purchaseCounts.get(doorId) ?? 0) >= CERTIFICATION_PURCHASE_CYCLES_PER_DOOR).length;
  const restockDoorsComplete = profileDoorIds.filter((doorId) => (restockCounts.get(doorId) ?? 0) >= CERTIFICATION_RESTOCK_CYCLES_PER_DOOR).length;
  if (purchaseDoorsComplete !== profileDoorIds.length) reasons.push("PURCHASE_CYCLES_INCOMPLETE");
  if (restockDoorsComplete !== profileDoorIds.length) reasons.push("RESTOCK_CYCLES_INCOMPLETE");
  if (purchaseSessions.size < CERTIFICATION_HUMAN_SESSIONS || observedSessions !== purchaseSessions.size) reasons.push("OBSERVED_SESSIONS_NOT_DERIVED_FROM_EVIDENCE");

  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    counts: { automatedTransactions, observedSessions, purchaseDoorsComplete, restockDoorsComplete },
  };
}
