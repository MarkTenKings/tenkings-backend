import { z } from "zod";

export const AI_GRADER_OPERATING_CONTEXT_V1_SCHEMA_VERSION =
  "ten-kings-ai-grader-operating-context-v1" as const;
export const AI_GRADER_CALIBRATION_ACTIVATION_AUTHORITY_V1_SCHEMA_VERSION =
  "ten-kings-ai-grader-calibration-activation-authority-v1" as const;
export const AI_GRADER_CALIBRATION_WORKSTATION_RECEIPT_V1_SCHEMA_VERSION =
  "ten-kings-ai-grader-calibration-workstation-receipt-v1" as const;
export const AI_GRADER_CALIBRATION_PENDING_AUTHORITY_V1_SCHEMA_VERSION =
  "ten-kings-ai-grader-calibration-pending-authority-v1" as const;
export const AI_GRADER_CALIBRATION_LOCAL_POINTER_V1_SCHEMA_VERSION =
  "ten-kings-ai-grader-calibration-local-pointer-v1" as const;
export const AI_GRADER_CALIBRATION_ACTIVATION_API_V1 =
  "/api/admin/ai-grader/calibration-activations" as const;
export const AI_GRADER_CALIBRATION_START_AUTHORITY_API_V1 =
  "/api/ai-grader/calibration-activation/status" as const;
export const AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1 = {
  list: `${AI_GRADER_CALIBRATION_ACTIVATION_API_V1}/list`,
  status: `${AI_GRADER_CALIBRATION_ACTIVATION_API_V1}/status`,
  activate: `${AI_GRADER_CALIBRATION_ACTIVATION_API_V1}/activate`,
  reactivate: `${AI_GRADER_CALIBRATION_ACTIVATION_API_V1}/reactivate`,
  complete: `${AI_GRADER_CALIBRATION_ACTIVATION_API_V1}/complete`,
  fail: `${AI_GRADER_CALIBRATION_ACTIVATION_API_V1}/fail`,
  startAuthority: AI_GRADER_CALIBRATION_START_AUTHORITY_API_V1,
} as const;

const canonicalText = z.string().trim().min(1).max(256);
const longCanonicalText = z.string().trim().min(1).max(1024);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const positiveInteger = z.number().int().positive();
const nonnegativeFinite = z.number().finite().nonnegative();

export const aiGraderCalibrationBundleMemberIdentityV1Schema = z.object({
  role: z.enum([
    "calibration_profile",
    "physical_calibration_artifact",
    "calibration_acceptance",
    "flat_field",
    "illumination_pattern",
  ]),
  channelIndex: z.number().int().min(1).max(8).optional(),
  fileName: canonicalText,
  sha256,
}).strict();

const EXPECTED_BUNDLE_MEMBERS = [
  ["calibration_profile", undefined, "mathematical-calibration-profile-v1.json"],
  ["physical_calibration_artifact", undefined, "mathematical-calibration-artifact-v1.json"],
  ["calibration_acceptance", undefined, "mathematical-calibration-acceptance-v1.json"],
  ...Array.from({ length: 8 }, (_, index) => [
    "flat_field",
    index + 1,
    `flat-field-channel-${index + 1}-v1.json`,
  ]),
  ["illumination_pattern", undefined, "illumination-pattern-v1.json"],
] as const;

export const aiGraderOperatingContextV1Schema = z.object({
  schemaVersion: z.literal(AI_GRADER_OPERATING_CONTEXT_V1_SCHEMA_VERSION),
  rig: z.object({
    tenantId: canonicalText,
    rigId: canonicalText,
    rigVersion: canonicalText,
    locationId: canonicalText,
    locationIdentity: canonicalText,
  }).strict(),
  camera: z.object({ serial: canonicalText, model: canonicalText }).strict(),
  optics: z.object({ lensIdentity: canonicalText, mountIdentity: canonicalText }).strict(),
  controller: z.object({
    controllerIdentity: canonicalText,
    channelWiringMapIdentity: canonicalText,
    channelMap: z.array(z.object({
      channelIndex: z.number().int().min(1).max(8),
      controllerOutput: canonicalText,
      lightingRole: canonicalText,
    }).strict()).length(8),
  }).strict(),
  lighting: z.object({
    configurationIdentity: canonicalText,
    selectedChannels: z.array(z.number().int().min(1).max(8)).length(8),
    dutyPercent: nonnegativeFinite.max(100),
  }).strict(),
  capture: z.object({
    exposureUs: positiveInteger,
    gain: nonnegativeFinite,
    pixelFormat: canonicalText,
    widthPx: positiveInteger,
    heightPx: positiveInteger,
  }).strict(),
  calibration: z.object({
    targetSha256: sha256,
    rigCharacterizationSha256: sha256,
    bundleSchemaVersion: z.literal("ten-kings-mathematical-calibration-bundle-v1"),
    bundleManifestSha256: sha256,
    sourceCaptureManifestSha256: sha256,
    memberLedgerSha256: sha256,
    members: z.array(aiGraderCalibrationBundleMemberIdentityV1Schema).length(12),
  }).strict(),
  software: z.object({
    captureProfileVersion: canonicalText,
    calibrationAlgorithmVersion: canonicalText,
    analysisAlgorithmVersion: canonicalText,
    thresholdSetId: canonicalText,
    thresholdSetHash: sha256,
    helperInstanceId: canonicalText,
    helperVersion: canonicalText,
  }).strict(),
}).strict().superRefine((value, context) => {
  if (JSON.stringify(value.lighting.selectedChannels) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8])) {
    context.addIssue({ code: "custom", path: ["lighting", "selectedChannels"], message: "must contain ordered channels 1 through 8" });
  }
  const channelIndexes = value.controller.channelMap.map((entry) => entry.channelIndex);
  if (JSON.stringify(channelIndexes) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8])) {
    context.addIssue({ code: "custom", path: ["controller", "channelMap"], message: "must contain ordered channels 1 through 8" });
  }
  value.calibration.members.forEach((member, index) => {
    const expected = EXPECTED_BUNDLE_MEMBERS[index]!;
    if (member.role !== expected[0] || member.channelIndex !== expected[1] || member.fileName !== expected[2]) {
      context.addIssue({ code: "custom", path: ["calibration", "members", index], message: "does not match the canonical ordered 12-member ledger" });
    }
  });
});

export type AiGraderOperatingContextV1 = z.infer<typeof aiGraderOperatingContextV1Schema>;

/** Deterministic canonical JSON for closed V1 schemas (non-JSON values are rejected by schema validation). */
export function canonicalAiGraderCalibrationJsonV1(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(Object.entries(entry as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]));
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}

export function canonicalAiGraderOperatingContextV1(value: unknown): string {
  return canonicalAiGraderCalibrationJsonV1(aiGraderOperatingContextV1Schema.parse(value));
}

export function canonicalAiGraderRuntimeContextV1(value: unknown): string {
  const context = aiGraderOperatingContextV1Schema.parse(value);
  const { calibration: _calibration, schemaVersion: _schemaVersion, ...runtimeContext } = context;
  return canonicalAiGraderCalibrationJsonV1({
    schemaVersion: "ten-kings-ai-grader-runtime-context-v1",
    ...runtimeContext,
  });
}

export const aiGraderCalibrationActivationAuthorityV1Schema = z.object({
  schemaVersion: z.literal(AI_GRADER_CALIBRATION_ACTIVATION_AUTHORITY_V1_SCHEMA_VERSION),
  activationId: canonicalText,
  activationHash: sha256,
  activationRevision: sha256,
  snapshotId: canonicalText,
  rigId: canonicalText,
  bundleManifestSha256: sha256,
  memberLedgerSha256: sha256,
  runtimeContextHash: sha256,
  rigCharacterizationSha256: sha256,
  operatingContextHash: sha256,
  workstationReceiptSha256: sha256,
  activatedAt: timestamp,
}).strict();

export type AiGraderCalibrationActivationAuthorityV1 = z.infer<typeof aiGraderCalibrationActivationAuthorityV1Schema>;

export const aiGraderCalibrationPendingAuthorityV1Schema = z.object({
  schemaVersion: z.literal(AI_GRADER_CALIBRATION_PENDING_AUTHORITY_V1_SCHEMA_VERSION),
  activationId: canonicalText,
  activationHash: sha256,
  activationRevision: sha256,
  snapshotId: canonicalText,
  rigId: canonicalText,
  bundleManifestSha256: sha256,
  memberLedgerSha256: sha256,
  runtimeContextHash: sha256,
  rigCharacterizationSha256: sha256,
  operatingContextHash: sha256,
  operatingContextV1: aiGraderOperatingContextV1Schema,
  requestedAt: timestamp,
  pendingExpiresAt: timestamp,
}).strict().superRefine((value, context) => {
  if (new Date(value.pendingExpiresAt).getTime() <= new Date(value.requestedAt).getTime()) {
    context.addIssue({ code: "custom", path: ["pendingExpiresAt"], message: "must follow requestedAt" });
  }
});

export type AiGraderCalibrationPendingAuthorityV1 = z.infer<typeof aiGraderCalibrationPendingAuthorityV1Schema>;

export const aiGraderCalibrationWorkstationReceiptV1Schema = z.object({
  schemaVersion: z.literal(AI_GRADER_CALIBRATION_WORKSTATION_RECEIPT_V1_SCHEMA_VERSION),
  activationId: canonicalText,
  activationHash: sha256,
  activationRevision: sha256,
  snapshotId: canonicalText,
  rigId: canonicalText,
  bundleManifestSha256: sha256,
  memberLedgerSha256: sha256,
  runtimeContextHash: sha256,
  rigCharacterizationSha256: sha256,
  expectedOperatingContextHash: sha256,
  observedOperatingContextHash: sha256,
  helperInstanceId: canonicalText,
  helperVersion: canonicalText,
  workstationKeyId: sha256,
  signatureAlgorithm: z.literal("ecdsa-p256-sha256-ieee-p1363"),
  verifiedAt: timestamp,
  expiresAt: timestamp,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();

export type AiGraderCalibrationWorkstationReceiptV1 = z.infer<typeof aiGraderCalibrationWorkstationReceiptV1Schema>;

export function aiGraderCalibrationWorkstationReceiptStatementV1(receipt: AiGraderCalibrationWorkstationReceiptV1): string {
  const { signature: _signature, ...statement } = receipt;
  return canonicalAiGraderCalibrationJsonV1(statement);
}

export const aiGraderCalibrationLocalPointerV1Schema = z.object({
  schemaVersion: z.literal(AI_GRADER_CALIBRATION_LOCAL_POINTER_V1_SCHEMA_VERSION),
  state: z.enum(["PENDING", "ACTIVE"]),
  activationId: canonicalText,
  activationHash: sha256,
  activationRevision: sha256,
  snapshotId: canonicalText,
  rigId: canonicalText,
  bundleManifestSha256: sha256,
  memberLedgerSha256: sha256,
  runtimeContextHash: sha256,
  rigCharacterizationSha256: sha256,
  operatingContextHash: sha256,
  workstationReceiptSha256: sha256.optional(),
  pendingExpiresAt: timestamp.optional(),
  activatedAt: timestamp.optional(),
  writtenAt: timestamp,
}).strict().superRefine((value, context) => {
  if (value.state === "PENDING" && (!value.pendingExpiresAt || value.activatedAt || value.workstationReceiptSha256)) {
    context.addIssue({ code: "custom", message: "pending pointer fields are contradictory" });
  }
  if (value.state === "ACTIVE" && (!value.activatedAt || !value.workstationReceiptSha256 || value.pendingExpiresAt)) {
    context.addIssue({ code: "custom", message: "active pointer fields are incomplete or contradictory" });
  }
});

export type AiGraderCalibrationLocalPointerV1 = z.infer<typeof aiGraderCalibrationLocalPointerV1Schema>;

export type AiGraderCalibrationActivationStateV1 =
  | "PENDING" | "LOCAL_VERIFIED" | "ACTIVE" | "FAILED" | "EXPIRED" | "SUPERSEDED" | "REVOKED";

export type AiGraderCalibrationSnapshotProjectionV1 = {
  snapshotId: string;
  rigId: string;
  trustStatus: "DRAFT" | "TRUSTED" | "REVOKED";
  activationEligible: boolean;
  activationIneligibilityCode: "SNAPSHOT_NOT_TRUSTED" | "SNAPSHOT_REVOKED" | "IDENTITY_INCOMPLETE" | "OPERATING_CONTEXT_INVALID" | "OPERATING_CONTEXT_HASH_MISMATCH" | null;
  profileId: string;
  calibrationVersion: string;
  artifactSha256: string | null;
  bundleManifestSha256: string | null;
  memberLedgerSha256: string | null;
  runtimeContextHash: string | null;
  rigCharacterizationSha256: string | null;
  operatingContextHash: string | null;
  importedAt: string;
  trustedAt: string | null;
  revokedAt: string | null;
};

export type AiGraderCalibrationActivationProjectionV1 = {
  activationId: string;
  activationHash: string;
  activationRevision: string;
  state: AiGraderCalibrationActivationStateV1;
  snapshotId: string;
  rigId: string;
  bundleManifestSha256: string;
  memberLedgerSha256: string;
  runtimeContextHash: string;
  rigCharacterizationSha256: string;
  operatingContextHash: string;
  workstationReceiptSha256: string | null;
  requestedAt: string;
  pendingExpiresAt: string;
  locallyVerifiedAt: string | null;
  activatedAt: string | null;
  terminatedAt: string | null;
  priorActivationId: string | null;
  supersededByActivationId: string | null;
};

export type AiGraderCalibrationActivationRegistryProjectionV1 = {
  schemaVersion: "ten-kings-ai-grader-calibration-activation-registry-projection-v1";
  rigId: string;
  registryRevision: string;
  activeActivationId: string | null;
  pendingActivationId: string | null;
  snapshots: AiGraderCalibrationSnapshotProjectionV1[];
  activations: AiGraderCalibrationActivationProjectionV1[];
  observedAt: string;
};

export type AiGraderCalibrationActivationListRequestV1 = { rigId: string; includeIncomplete?: boolean };
export type AiGraderCalibrationActivationListResponseV1 = { ok: true; registry: AiGraderCalibrationActivationRegistryProjectionV1 };
export type AiGraderCalibrationActivationStatusRequestV1 = { rigId: string };
export type AiGraderCalibrationActivationStatusResponseV1 = {
  ok: true;
  registryRevision: string;
  active: AiGraderCalibrationActivationProjectionV1 | null;
  pending: AiGraderCalibrationActivationProjectionV1 | null;
  authority: AiGraderCalibrationActivationAuthorityV1 | null;
  observedAt: string;
};

type ActivationWriteBaseV1 = {
  rigId: string;
  snapshotId: string;
  expectedRegistryRevision: string;
  idempotencyKey: string;
  reason: string;
};
export type AiGraderCalibrationActivateRequestV1 = ActivationWriteBaseV1;
export type AiGraderCalibrationReactivateRequestV1 = ActivationWriteBaseV1 & { priorActivationId: string };
export type AiGraderCalibrationActivationPendingResponseV1 = {
  ok: true;
  registryRevision: string;
  activation: AiGraderCalibrationActivationProjectionV1;
  pendingAuthority: AiGraderCalibrationPendingAuthorityV1 | null;
};
export type AiGraderCalibrationCompleteActivationRequestV1 = {
  activationId: string;
  expectedActivationRevision: string;
  idempotencyKey: string;
  workstationReceipt: AiGraderCalibrationWorkstationReceiptV1;
};
export type AiGraderCalibrationCompleteActivationResponseV1 = {
  ok: true;
  registryRevision: string;
  activation: AiGraderCalibrationActivationProjectionV1;
  authority: AiGraderCalibrationActivationAuthorityV1;
};
export type AiGraderCalibrationFailActivationRequestV1 = {
  activationId: string;
  expectedActivationRevision: string;
  idempotencyKey: string;
  failureCode: string;
};
export type AiGraderCalibrationFailActivationResponseV1 = {
  ok: true;
  registryRevision: string;
  activation: AiGraderCalibrationActivationProjectionV1;
};
export type AiGraderCalibrationStartAuthorityRequestV1 = { tenantId: string; rigId: string };
export type AiGraderCalibrationStartAuthorityResponseV1 = {
  ok: true;
  registryRevision: string;
  authority: AiGraderCalibrationActivationAuthorityV1;
  activation: AiGraderCalibrationActivationProjectionV1;
};


export function validateAiGraderCalibrationActivationWriteTextV1(value: unknown, label: string) {
  return longCanonicalText.parse(value, { error: () => `${label} is invalid.` });
}
