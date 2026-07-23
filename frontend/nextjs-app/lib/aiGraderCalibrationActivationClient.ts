import { z } from "zod";
import { buildAdminHeaders } from "./adminHeaders";
import { normalizeAiGraderStationBridgeUrl } from "./aiGraderStationBridgeClient";

/**
 * Exact browser transport projection of the registry contract frozen at
 * ac3fdcff71ad514b00af01fa0fea775ec9b5614e. The browser never signs,
 * manufactures, or interprets activation authority.
 */
export const AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1 = {
  resolveTrusted: "/api/admin/ai-grader/calibration-activations/resolve-trusted",
  list: "/api/admin/ai-grader/calibration-activations/list",
  status: "/api/admin/ai-grader/calibration-activations/status",
  observe: "/api/admin/ai-grader/calibration-activations/observe",
  activate: "/api/admin/ai-grader/calibration-activations/activate",
  reactivate: "/api/admin/ai-grader/calibration-activations/reactivate",
  complete: "/api/admin/ai-grader/calibration-activations/complete",
  fail: "/api/admin/ai-grader/calibration-activations/fail",
} as const;

const canonicalText = z.string().trim().min(1).max(256);
const longCanonicalText = z.string().trim().min(1).max(1024);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const positiveInteger = z.number().int().positive();
const nonnegativeFinite = z.number().finite().nonnegative();

const bundleMemberSchema = z.object({
  role: z.enum([
    "calibration_profile", "physical_calibration_artifact", "calibration_acceptance",
    "product_owner_operational_acceptance", "flat_field", "illumination_pattern",
  ]),
  channelIndex: z.number().int().min(1).max(8).optional(),
  fileName: canonicalText,
  sha256,
}).strict();

const expectedMembers = [
  ["calibration_profile", undefined, "mathematical-calibration-profile-v1.json"],
  ["physical_calibration_artifact", undefined, "mathematical-calibration-artifact-v1.json"],
  ["calibration_acceptance", undefined, "mathematical-calibration-acceptance-v1.json"],
  ...Array.from({ length: 8 }, (_, index) => ["flat_field", index + 1, `flat-field-channel-${index + 1}-v1.json`]),
  ["illumination_pattern", undefined, "illumination-pattern-v1.json"],
] as const;
const expectedOwnerAcceptedMembers = [
  ...expectedMembers.slice(0, 3),
  ["product_owner_operational_acceptance", undefined, "product-owner-operational-acceptance-v1.json"],
  ...expectedMembers.slice(3),
] as const;

const operatingContextSchema = z.object({
  schemaVersion: z.literal("ten-kings-ai-grader-operating-context-v1"),
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
    members: z.array(bundleMemberSchema).min(12).max(13),
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
  if (JSON.stringify(value.controller.channelMap.map((entry) => entry.channelIndex)) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8])) {
    context.addIssue({ code: "custom", path: ["controller", "channelMap"], message: "must contain ordered channels 1 through 8" });
  }
  const exactMembers = value.calibration.members.length === 13
    ? expectedOwnerAcceptedMembers
    : expectedMembers;
  value.calibration.members.forEach((member, index) => {
    const expected = exactMembers[index]!;
    if (member.role !== expected[0] || member.channelIndex !== expected[1] || member.fileName !== expected[2]) {
      context.addIssue({ code: "custom", path: ["calibration", "members", index], message: "does not match the canonical ordered member ledger" });
    }
  });
});

const hostedSignatureShape = {
  hostedAuthorityKeyId: sha256,
  hostedAuthoritySignatureAlgorithm: z.literal("ecdsa-p256-sha256-ieee-p1363"),
  hostedAuthorityIssuedAt: timestamp,
  hostedAuthorityExpiresAt: timestamp,
} as const;

const runtimeObservationSchema = z.object({
  schemaVersion: z.literal("ten-kings-mathematical-calibration-runtime-observation-v1"),
  source: z.literal("opened-basler-pylon-and-leimac-acknowledgement-v1"),
  camera: z.object({ serial: canonicalText, model: canonicalText }).strict(),
  capture: z.object({
    exposureUs: positiveInteger,
    gain: nonnegativeFinite,
    pixelFormat: canonicalText,
    widthPx: positiveInteger,
    heightPx: positiveInteger,
  }).strict(),
  controller: z.object({
    controllerTransportIdentity: canonicalText,
    selectedChannels: z.array(z.number().int().min(1).max(8)).length(8),
    dutyPercent: nonnegativeFinite.max(100),
    expectedWriteCount: positiveInteger,
    acknowledgedWriteCount: positiveInteger,
    allWritesAcknowledged: z.literal(true),
  }).strict(),
  software: z.object({ helperInstanceId: canonicalText, helperVersion: canonicalText }).strict(),
}).strict();

export const aiGraderCalibrationObservationAuthorityV1Schema = z.object({
  schemaVersion: z.literal("ten-kings-ai-grader-calibration-observation-authority-v1"),
  authorityPhase: z.literal("OBSERVATION"),
  observationId: canonicalText,
  registryRevision: sha256,
  snapshotId: canonicalText,
  rigId: canonicalText,
  bundleManifestSha256: sha256,
  memberLedgerSha256: sha256,
  runtimeContextHash: sha256,
  rigCharacterizationSha256: sha256,
  operatingContextHash: sha256,
  operatingContextV1: operatingContextSchema,
  ...hostedSignatureShape,
  hostedAuthoritySignature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();

export const aiGraderCalibrationWorkstationObservationV1Schema = z.object({
  schemaVersion: z.literal("ten-kings-ai-grader-calibration-workstation-observation-v1"),
  observationId: canonicalText,
  hostedObservationAuthoritySha256: sha256,
  registryRevision: sha256,
  snapshotId: canonicalText,
  rigId: canonicalText,
  bundleManifestSha256: sha256,
  memberLedgerSha256: sha256,
  runtimeContextHash: sha256,
  rigCharacterizationSha256: sha256,
  expectedOperatingContextHash: sha256,
  observedOperatingContextHash: sha256,
  runtimeObservation: runtimeObservationSchema,
  runtimeObservationSha256: sha256,
  evidenceImageFileName: z.literal("activation-runtime-evidence.png"),
  evidenceImageMediaType: z.literal("image/png"),
  evidenceImageSha256: sha256,
  evidenceImageByteSize: z.number().int().nonnegative(),
  helperInstanceId: canonicalText,
  helperVersion: canonicalText,
  workstationKeyId: sha256,
  signatureAlgorithm: z.literal("ecdsa-p256-sha256-ieee-p1363"),
  observedAt: timestamp,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();

export const aiGraderCalibrationPendingAuthorityV1Schema = z.object({
  schemaVersion: z.literal("ten-kings-ai-grader-calibration-pending-authority-v1"),
  authorityPhase: z.literal("PENDING"),
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
  observationId: canonicalText,
  workstationObservationSha256: sha256,
  operatingContextV1: operatingContextSchema,
  requestedAt: timestamp,
  pendingExpiresAt: timestamp,
  ...hostedSignatureShape,
  hostedAuthoritySignature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict().superRefine((value, context) => {
  if (new Date(value.pendingExpiresAt).getTime() <= new Date(value.requestedAt).getTime()) {
    context.addIssue({ code: "custom", path: ["pendingExpiresAt"], message: "must follow requestedAt" });
  }
  if (value.hostedAuthorityIssuedAt !== value.requestedAt) {
    context.addIssue({ code: "custom", path: ["hostedAuthorityIssuedAt"], message: "must equal requestedAt" });
  }
  if (value.hostedAuthorityExpiresAt !== value.pendingExpiresAt) {
    context.addIssue({ code: "custom", path: ["hostedAuthorityExpiresAt"], message: "must equal pendingExpiresAt" });
  }
});

export const aiGraderCalibrationActivationAuthorityV1Schema = z.object({
  schemaVersion: z.literal("ten-kings-ai-grader-calibration-activation-authority-v1"),
  authorityPhase: z.literal("ACTIVE"),
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
  observationId: canonicalText,
  workstationObservationSha256: sha256,
  workstationReceiptSha256: sha256,
  activatedAt: timestamp,
  ...hostedSignatureShape,
  hostedAuthoritySignature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict().superRefine((value, context) => {
  const activatedAt = new Date(value.activatedAt).getTime();
  const issuedAt = new Date(value.hostedAuthorityIssuedAt).getTime();
  const expiresAt = new Date(value.hostedAuthorityExpiresAt).getTime();
  if (issuedAt < activatedAt) context.addIssue({ code: "custom", path: ["hostedAuthorityIssuedAt"], message: "must not precede activatedAt" });
  if (expiresAt <= issuedAt) context.addIssue({ code: "custom", path: ["hostedAuthorityExpiresAt"], message: "must follow hostedAuthorityIssuedAt" });
});

export const aiGraderCalibrationWorkstationReceiptV1Schema = z.object({
  schemaVersion: z.literal("ten-kings-ai-grader-calibration-workstation-receipt-v1"),
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
  observationId: canonicalText,
  workstationObservationSha256: sha256,
  runtimeObservationSha256: sha256,
  evidenceImageSha256: sha256,
  helperInstanceId: canonicalText,
  helperVersion: canonicalText,
  workstationKeyId: sha256,
  signatureAlgorithm: z.literal("ecdsa-p256-sha256-ieee-p1363"),
  verifiedAt: timestamp,
  expiresAt: timestamp,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();

export const aiGraderCalibrationSnapshotProjectionV1Schema = z.object({
  snapshotId: canonicalText,
  rigId: canonicalText,
  trustStatus: z.enum(["DRAFT", "TRUSTED", "REVOKED"]),
  activationEligible: z.boolean(),
  activationIneligibilityCode: z.enum([
    "SNAPSHOT_NOT_TRUSTED", "SNAPSHOT_REVOKED", "IDENTITY_INCOMPLETE",
    "OPERATING_CONTEXT_INVALID", "OPERATING_CONTEXT_HASH_MISMATCH",
  ]).nullable(),
  profileId: canonicalText,
  calibrationVersion: canonicalText,
  artifactSha256: sha256.nullable(),
  bundleManifestSha256: sha256.nullable(),
  memberLedgerSha256: sha256.nullable(),
  runtimeContextHash: sha256.nullable(),
  rigCharacterizationSha256: sha256.nullable(),
  operatingContextHash: sha256.nullable(),
  importedAt: timestamp,
  trustedAt: timestamp.nullable(),
  revokedAt: timestamp.nullable(),
}).strict();

export const aiGraderCalibrationActivationProjectionV1Schema = z.object({
  activationId: canonicalText,
  activationHash: sha256,
  activationRevision: sha256,
  state: z.enum(["PENDING", "LOCAL_VERIFIED", "ACTIVE", "FAILED", "EXPIRED", "SUPERSEDED", "REVOKED"]),
  snapshotId: canonicalText,
  rigId: canonicalText,
  bundleManifestSha256: sha256,
  memberLedgerSha256: sha256,
  runtimeContextHash: sha256,
  rigCharacterizationSha256: sha256,
  operatingContextHash: sha256,
  observationId: canonicalText,
  workstationObservationSha256: sha256,
  workstationReceiptSha256: sha256.nullable(),
  requestedAt: timestamp,
  pendingExpiresAt: timestamp,
  locallyVerifiedAt: timestamp.nullable(),
  activatedAt: timestamp.nullable(),
  terminatedAt: timestamp.nullable(),
  priorActivationId: canonicalText.nullable(),
  supersededByActivationId: canonicalText.nullable(),
}).strict();

export const aiGraderCalibrationActivationRegistryProjectionV1Schema = z.object({
  schemaVersion: z.literal("ten-kings-ai-grader-calibration-activation-registry-projection-v1"),
  rigId: canonicalText,
  registryRevision: sha256,
  activeActivationId: canonicalText.nullable(),
  pendingActivationId: canonicalText.nullable(),
  snapshots: z.array(aiGraderCalibrationSnapshotProjectionV1Schema),
  activations: z.array(aiGraderCalibrationActivationProjectionV1Schema),
  observedAt: timestamp,
}).strict();

const listRequestSchema = z.object({ rigId: canonicalText, includeIncomplete: z.boolean().optional() }).strict();
const statusRequestSchema = z.object({ rigId: canonicalText }).strict();
const observationRequestSchema = z.object({
  rigId: canonicalText,
  snapshotId: canonicalText,
  expectedRegistryRevision: sha256,
}).strict();
const activateRequestSchema = z.object({
  rigId: canonicalText,
  snapshotId: canonicalText,
  expectedRegistryRevision: sha256,
  idempotencyKey: canonicalText,
  reason: longCanonicalText,
  observationAuthority: aiGraderCalibrationObservationAuthorityV1Schema,
  workstationObservation: aiGraderCalibrationWorkstationObservationV1Schema,
}).strict();
const reactivateRequestSchema = activateRequestSchema.extend({ priorActivationId: canonicalText }).strict();
const completeRequestSchema = z.object({
  activationId: canonicalText,
  expectedActivationRevision: sha256,
  idempotencyKey: canonicalText,
  workstationReceipt: aiGraderCalibrationWorkstationReceiptV1Schema,
}).strict();
const failRequestSchema = z.object({
  activationId: canonicalText,
  expectedActivationRevision: sha256,
  idempotencyKey: canonicalText,
  failureCode: z.string().trim().min(1).max(128),
}).strict();

const listResponseSchema = z.object({
  ok: z.literal(true),
  registry: aiGraderCalibrationActivationRegistryProjectionV1Schema,
}).strict();
const statusResponseSchema = z.object({
  ok: z.literal(true),
  registryRevision: sha256,
  active: aiGraderCalibrationActivationProjectionV1Schema.nullable(),
  pending: aiGraderCalibrationActivationProjectionV1Schema.nullable(),
  authority: aiGraderCalibrationActivationAuthorityV1Schema.nullable(),
  observedAt: timestamp,
}).strict();
const resolvedTrustedResponseSchema = z.object({
  ok: z.literal(true),
  registry: aiGraderCalibrationActivationRegistryProjectionV1Schema,
  status: statusResponseSchema,
}).strict();
const observationResponseSchema = z.object({
  ok: z.literal(true),
  observationAuthority: aiGraderCalibrationObservationAuthorityV1Schema,
}).strict();
const pendingResponseSchema = z.object({
  ok: z.literal(true),
  registryRevision: sha256,
  activation: aiGraderCalibrationActivationProjectionV1Schema,
  pendingAuthority: aiGraderCalibrationPendingAuthorityV1Schema.nullable(),
}).strict();
const completeResponseSchema = z.object({
  ok: z.literal(true),
  registryRevision: sha256,
  activation: aiGraderCalibrationActivationProjectionV1Schema,
  authority: aiGraderCalibrationActivationAuthorityV1Schema,
}).strict();
const failResponseSchema = z.object({
  ok: z.literal(true),
  registryRevision: sha256,
  activation: aiGraderCalibrationActivationProjectionV1Schema,
}).strict();

const localActivationStateSchema = z.object({
  configured: z.boolean(),
  state: z.enum(["UNAVAILABLE", "IDLE", "PENDING", "ACTIVE"]),
  observation: aiGraderCalibrationWorkstationObservationV1Schema.optional(),
  receipt: aiGraderCalibrationWorkstationReceiptV1Schema.optional(),
  authority: aiGraderCalibrationActivationAuthorityV1Schema.optional(),
}).strict();
const localActionResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({ calibrationActivation: localActivationStateSchema }).passthrough(),
}).passthrough();

export type AiGraderCalibrationPendingAuthorityV1 = z.infer<typeof aiGraderCalibrationPendingAuthorityV1Schema>;
export type AiGraderCalibrationActivationAuthorityV1 = z.infer<typeof aiGraderCalibrationActivationAuthorityV1Schema>;
export type AiGraderCalibrationObservationAuthorityV1 =
  z.infer<typeof aiGraderCalibrationObservationAuthorityV1Schema>;
export type AiGraderCalibrationWorkstationObservationV1 =
  z.infer<typeof aiGraderCalibrationWorkstationObservationV1Schema>;
export type AiGraderCalibrationWorkstationReceiptV1 = z.infer<typeof aiGraderCalibrationWorkstationReceiptV1Schema>;
export type AiGraderCalibrationSnapshotProjectionV1 = z.infer<typeof aiGraderCalibrationSnapshotProjectionV1Schema>;
export type AiGraderCalibrationActivationProjectionV1 = z.infer<typeof aiGraderCalibrationActivationProjectionV1Schema>;
export type AiGraderCalibrationActivationRegistryProjectionV1 = z.infer<typeof aiGraderCalibrationActivationRegistryProjectionV1Schema>;
export type AiGraderCalibrationActivationListResponseV1 = z.infer<typeof listResponseSchema>;
export type AiGraderCalibrationActivationStatusResponseV1 = z.infer<typeof statusResponseSchema>;
export type AiGraderCalibrationActivationResolvedTrustedResponseV1 = z.infer<typeof resolvedTrustedResponseSchema>;
export type AiGraderCalibrationActivationPendingResponseV1 = z.infer<typeof pendingResponseSchema>;
export type AiGraderCalibrationCompleteActivationResponseV1 = z.infer<typeof completeResponseSchema>;
export type AiGraderCalibrationFailActivationResponseV1 = z.infer<typeof failResponseSchema>;
export type AiGraderCalibrationLocalActivationStateV1 = z.infer<typeof localActivationStateSchema>;

export class AiGraderCalibrationActivationTransportError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 500, code = "AI_GRADER_CALIBRATION_ACTIVATION_REQUEST_FAILED") {
    super(message);
    this.name = "AiGraderCalibrationActivationTransportError";
    this.status = status;
    this.code = code;
  }
}

async function jsonPayload(response: Response) {
  return response.json().catch(() => ({})) as Promise<unknown>;
}

async function hostedPost<T extends z.ZodTypeAny>(
  route: string,
  body: unknown,
  token: string,
  schema: T,
  fetchImpl: typeof fetch,
): Promise<z.output<T>> {
  if (!token.trim()) throw new AiGraderCalibrationActivationTransportError("Admin session token is required.", 401);
  const response = await fetchImpl(route, {
    method: "POST",
    headers: buildAdminHeaders(token, { "content-type": "application/json" }),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await jsonPayload(response);
  if (!response.ok) {
    const failure = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    throw new AiGraderCalibrationActivationTransportError(
      typeof failure.message === "string" ? failure.message : "Calibration activation authority request failed.",
      response.status,
      typeof failure.code === "string" ? failure.code : undefined,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AiGraderCalibrationActivationTransportError(
      "Calibration activation authority returned an invalid exact response.",
      502,
      "AI_GRADER_CALIBRATION_ACTIVATION_RESPONSE_INVALID",
    );
  }
  return parsed.data;
}

export function listAiGraderCalibrationActivationsV1(
  input: { token: string; rigId: string; includeIncomplete?: boolean },
  fetchImpl: typeof fetch = fetch,
) {
  const body = listRequestSchema.parse({
    rigId: input.rigId,
    ...(input.includeIncomplete === undefined ? {} : { includeIncomplete: input.includeIncomplete }),
  });
  return hostedPost(AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.list, body, input.token, listResponseSchema, fetchImpl);
}

export function resolveTrustedAiGraderCalibrationRegistryV1(
  input: { token: string },
  fetchImpl: typeof fetch = fetch,
) {
  return hostedPost(
    AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.resolveTrusted,
    {},
    input.token,
    resolvedTrustedResponseSchema,
    fetchImpl,
  );
}

export function readAiGraderCalibrationActivationStatusV1(
  input: { token: string; rigId: string },
  fetchImpl: typeof fetch = fetch,
) {
  return hostedPost(
    AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.status,
    statusRequestSchema.parse({ rigId: input.rigId }),
    input.token,
    statusResponseSchema,
    fetchImpl,
  );
}

export function requestAiGraderCalibrationObservationAuthorityV1(
  input: {
    token: string;
    rigId: string;
    snapshotId: string;
    expectedRegistryRevision: string;
  },
  fetchImpl: typeof fetch = fetch,
) {
  const body = observationRequestSchema.parse({
    rigId: input.rigId,
    snapshotId: input.snapshotId,
    expectedRegistryRevision: input.expectedRegistryRevision,
  });
  return hostedPost(
    AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.observe,
    body,
    input.token,
    observationResponseSchema,
    fetchImpl,
  );
}

export function requestAiGraderCalibrationActivationV1(
  input: {
    token: string;
    action: "activate" | "reactivate";
    rigId: string;
    snapshotId: string;
    priorActivationId?: string;
    expectedRegistryRevision: string;
    idempotencyKey: string;
    reason: string;
    observationAuthority: AiGraderCalibrationObservationAuthorityV1;
    workstationObservation: AiGraderCalibrationWorkstationObservationV1;
  },
  fetchImpl: typeof fetch = fetch,
) {
  const base = {
    rigId: input.rigId,
    snapshotId: input.snapshotId,
    expectedRegistryRevision: input.expectedRegistryRevision,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    observationAuthority: input.observationAuthority,
    workstationObservation: input.workstationObservation,
  };
  const body = input.action === "reactivate"
    ? reactivateRequestSchema.parse({ ...base, priorActivationId: input.priorActivationId })
    : activateRequestSchema.parse(base);
  return hostedPost(
    AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1[input.action],
    body,
    input.token,
    pendingResponseSchema,
    fetchImpl,
  );
}

export function completeAiGraderCalibrationActivationV1(
  input: {
    token: string;
    activationId: string;
    expectedActivationRevision: string;
    idempotencyKey: string;
    workstationReceipt: AiGraderCalibrationWorkstationReceiptV1;
  },
  fetchImpl: typeof fetch = fetch,
) {
  const body = completeRequestSchema.parse({
    activationId: input.activationId,
    expectedActivationRevision: input.expectedActivationRevision,
    idempotencyKey: input.idempotencyKey,
    workstationReceipt: input.workstationReceipt,
  });
  return hostedPost(AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.complete, body, input.token, completeResponseSchema, fetchImpl);
}

export function failAiGraderCalibrationActivationV1(
  input: {
    token: string;
    activationId: string;
    expectedActivationRevision: string;
    idempotencyKey: string;
    failureCode: string;
  },
  fetchImpl: typeof fetch = fetch,
) {
  const body = failRequestSchema.parse({
    activationId: input.activationId,
    expectedActivationRevision: input.expectedActivationRevision,
    idempotencyKey: input.idempotencyKey,
    failureCode: input.failureCode,
  });
  return hostedPost(AI_GRADER_CALIBRATION_ACTIVATION_ROUTE_MAP_V1.fail, body, input.token, failResponseSchema, fetchImpl);
}

async function localActivationAction(
  input: {
    baseUrl: string;
    stationToken: string;
    action: "observe-calibration-activation" | "prepare-calibration-activation" |
      "confirm-calibration-activation" | "abort-calibration-activation";
    body: Record<string, unknown>;
  },
  fetchImpl: typeof fetch,
) {
  const baseUrl = normalizeAiGraderStationBridgeUrl(input.baseUrl);
  if (!input.stationToken.trim()) throw new AiGraderCalibrationActivationTransportError("Paired station token is required.", 401);
  const response = await fetchImpl(`${baseUrl}/actions/${input.action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-grader-station-token": input.stationToken,
    },
    body: JSON.stringify(input.body),
    cache: "no-store",
  });
  const payload = await jsonPayload(response);
  if (!response.ok) {
    const failure = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const nested = failure.error && typeof failure.error === "object" ? failure.error as Record<string, unknown> : {};
    throw new AiGraderCalibrationActivationTransportError(
      typeof failure.message === "string" ? failure.message
        : typeof nested.message === "string" ? nested.message
          : "Local calibration activation verification failed.",
      response.status,
      typeof failure.code === "string" ? failure.code : "AI_GRADER_LOCAL_CALIBRATION_ACTIVATION_FAILED",
    );
  }
  const parsed = localActionResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AiGraderCalibrationActivationTransportError(
      "Local helper returned an invalid calibration activation projection.",
      502,
      "AI_GRADER_LOCAL_CALIBRATION_ACTIVATION_RESPONSE_INVALID",
    );
  }
  return parsed.data.result.calibrationActivation;
}

export function prepareLocalAiGraderCalibrationActivationV1(
  input: { baseUrl: string; stationToken: string; pendingAuthority: AiGraderCalibrationPendingAuthorityV1 },
  fetchImpl: typeof fetch = fetch,
) {
  return localActivationAction({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    action: "prepare-calibration-activation",
    body: { calibrationPendingAuthority: aiGraderCalibrationPendingAuthorityV1Schema.parse(input.pendingAuthority) },
  }, fetchImpl);
}

export function observeLocalAiGraderCalibrationActivationV1(
  input: {
    baseUrl: string;
    stationToken: string;
    observationAuthority: AiGraderCalibrationObservationAuthorityV1;
  },
  fetchImpl: typeof fetch = fetch,
) {
  return localActivationAction({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    action: "observe-calibration-activation",
    body: {
      calibrationObservationAuthority:
        aiGraderCalibrationObservationAuthorityV1Schema.parse(input.observationAuthority),
    },
  }, fetchImpl);
}

export function confirmLocalAiGraderCalibrationActivationV1(
  input: { baseUrl: string; stationToken: string; authority: AiGraderCalibrationActivationAuthorityV1 },
  fetchImpl: typeof fetch = fetch,
) {
  return localActivationAction({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    action: "confirm-calibration-activation",
    body: { hostedCalibrationActivationAuthority: aiGraderCalibrationActivationAuthorityV1Schema.parse(input.authority) },
  }, fetchImpl);
}

/**
 * Hardware-free convergence after hosted ACTIVE exists. The caller must supply
 * the exact signed ACTIVE authority returned by the hosted registry; this path
 * performs only the idempotent local confirmation action.
 */
export function reconcileLocalAiGraderCalibrationActivationV1(
  input: { baseUrl: string; stationToken: string; authority: AiGraderCalibrationActivationAuthorityV1 },
  fetchImpl: typeof fetch = fetch,
) {
  return confirmLocalAiGraderCalibrationActivationV1(input, fetchImpl);
}

function isRecoverableLocalConfirmationInterruption(error: unknown) {
  return error instanceof Error &&
    (!(error instanceof AiGraderCalibrationActivationTransportError) || error.status >= 500);
}

export function abortLocalAiGraderCalibrationActivationV1(
  input: {
    baseUrl: string;
    stationToken: string;
    pendingAuthority: AiGraderCalibrationPendingAuthorityV1;
  },
  fetchImpl: typeof fetch = fetch,
) {
  return localActivationAction({
    baseUrl: input.baseUrl,
    stationToken: input.stationToken,
    action: "abort-calibration-activation",
    body: {
      calibrationPendingAuthority:
        aiGraderCalibrationPendingAuthorityV1Schema.parse(input.pendingAuthority),
    },
  }, fetchImpl);
}

export type AiGraderCalibrationActivationWorkflowSelectionV1 = {
  action: "activate" | "reactivate";
  snapshot: AiGraderCalibrationSnapshotProjectionV1;
  priorActivationId?: string;
  expectedRegistryRevision: string;
  reason: string;
};

export type AiGraderCalibrationActivationWorkflowResultV1 = {
  observationAuthority: AiGraderCalibrationObservationAuthorityV1;
  workstationObservation: AiGraderCalibrationWorkstationObservationV1;
  pending: AiGraderCalibrationActivationPendingResponseV1;
  localPending: AiGraderCalibrationLocalActivationStateV1;
  completed: AiGraderCalibrationCompleteActivationResponseV1;
  localActive: AiGraderCalibrationLocalActivationStateV1;
};

function exactMatch(left: unknown, right: unknown, label: string) {
  if (left !== right) {
    throw new AiGraderCalibrationActivationTransportError(
      `Calibration activation ${label} did not match the exact selected authority.`,
      409,
      "AI_GRADER_CALIBRATION_ACTIVATION_BINDING_MISMATCH",
    );
  }
}

function newIdempotencyKey(stage: string) {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid !== "function") {
    throw new AiGraderCalibrationActivationTransportError(
      "Secure browser idempotency generation is unavailable.",
      503,
      "AI_GRADER_CALIBRATION_IDEMPOTENCY_UNAVAILABLE",
    );
  }
  return `calibration-${stage}-${randomUuid.call(globalThis.crypto)}`;
}

export async function runAiGraderCalibrationActivationWorkflowV1(
  input: {
    freshAdminToken: string;
    baseUrl: string;
    stationToken: string;
    selection: AiGraderCalibrationActivationWorkflowSelectionV1;
    idempotencyKeyFactory?: (stage: "request" | "complete" | "fail") => string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<AiGraderCalibrationActivationWorkflowResultV1> {
  const snapshot = aiGraderCalibrationSnapshotProjectionV1Schema.parse(input.selection.snapshot);
  const expectedRegistryRevision = sha256.parse(input.selection.expectedRegistryRevision);
  const reason = longCanonicalText.parse(input.selection.reason);
  if (!snapshot.activationEligible || snapshot.trustStatus !== "TRUSTED") {
    throw new AiGraderCalibrationActivationTransportError(
      "Only an exact trusted activation-eligible calibration may be selected.",
      409,
      "AI_GRADER_CALIBRATION_ACTIVATION_SNAPSHOT_NOT_ELIGIBLE",
    );
  }
  if (input.selection.action === "reactivate" && !input.selection.priorActivationId) {
    throw new AiGraderCalibrationActivationTransportError(
      "Reactivate requires the exact prior hosted activation.",
      409,
      "AI_GRADER_CALIBRATION_EXPLICIT_REACTIVATION_REQUIRED",
    );
  }
  const idempotency = input.idempotencyKeyFactory ?? newIdempotencyKey;
  let pending: AiGraderCalibrationActivationPendingResponseV1 | undefined;
  let completed: AiGraderCalibrationCompleteActivationResponseV1 | undefined;
  let observationAuthority: AiGraderCalibrationObservationAuthorityV1 | undefined;
  let workstationObservation: AiGraderCalibrationWorkstationObservationV1 | undefined;
  let failureStage: "PENDING_AUTHORITY_UNAVAILABLE" | "LOCAL_PREPARATION_FAILED" | "HOSTED_COMPLETION_FAILED" =
    "PENDING_AUTHORITY_UNAVAILABLE";
  try {
    const observationResponse = await requestAiGraderCalibrationObservationAuthorityV1({
      token: input.freshAdminToken,
      rigId: snapshot.rigId,
      snapshotId: snapshot.snapshotId,
      expectedRegistryRevision,
    }, fetchImpl);
    observationAuthority = observationResponse.observationAuthority;
    exactMatch(observationAuthority.rigId, snapshot.rigId, "observation rig");
    exactMatch(observationAuthority.snapshotId, snapshot.snapshotId, "observation snapshot");
    exactMatch(observationAuthority.registryRevision, expectedRegistryRevision, "observation registry revision");
    const localObservation = await observeLocalAiGraderCalibrationActivationV1({
      baseUrl: input.baseUrl,
      stationToken: input.stationToken,
      observationAuthority,
    }, fetchImpl);
    if (!localObservation.observation || localObservation.state !== "IDLE") {
      throw new AiGraderCalibrationActivationTransportError(
        "Local helper did not return one immutable workstation runtime observation.",
        409,
        "AI_GRADER_CALIBRATION_OBSERVATION_UNAVAILABLE",
      );
    }
    workstationObservation = localObservation.observation;
    exactMatch(workstationObservation.observationId, observationAuthority.observationId, "workstation observation ID");
    exactMatch(workstationObservation.snapshotId, snapshot.snapshotId, "workstation observation snapshot");

    pending = await requestAiGraderCalibrationActivationV1({
      token: input.freshAdminToken,
      action: input.selection.action,
      rigId: snapshot.rigId,
      snapshotId: snapshot.snapshotId,
      priorActivationId: input.selection.priorActivationId,
      expectedRegistryRevision,
      idempotencyKey: idempotency("request"),
      reason,
      observationAuthority,
      workstationObservation,
    }, fetchImpl);
    exactMatch(pending.activation.rigId, snapshot.rigId, "rig");
    exactMatch(pending.activation.snapshotId, snapshot.snapshotId, "snapshot");
    exactMatch(pending.activation.state, "PENDING", "pending phase");
    if (!pending.pendingAuthority) {
      throw new AiGraderCalibrationActivationTransportError(
        "Hosted activation did not return exact signed PENDING authority.",
        409,
        "AI_GRADER_CALIBRATION_PENDING_AUTHORITY_UNAVAILABLE",
      );
    }
    exactMatch(pending.pendingAuthority.activationId, pending.activation.activationId, "pending activation ID");
    exactMatch(pending.pendingAuthority.activationHash, pending.activation.activationHash, "pending activation hash");
    exactMatch(pending.pendingAuthority.activationRevision, pending.activation.activationRevision, "pending revision");

    failureStage = "LOCAL_PREPARATION_FAILED";
    const localPending = await prepareLocalAiGraderCalibrationActivationV1({
      baseUrl: input.baseUrl,
      stationToken: input.stationToken,
      pendingAuthority: pending.pendingAuthority,
    }, fetchImpl);
    if (localPending.state !== "PENDING" || !localPending.receipt) {
      throw new AiGraderCalibrationActivationTransportError(
        "Local helper did not return the exact pending workstation receipt.",
        409,
        "AI_GRADER_CALIBRATION_LOCAL_RECEIPT_UNAVAILABLE",
      );
    }
    exactMatch(localPending.receipt.activationId, pending.activation.activationId, "receipt activation ID");
    exactMatch(localPending.receipt.activationRevision, pending.activation.activationRevision, "receipt revision");

    failureStage = "HOSTED_COMPLETION_FAILED";
    completed = await completeAiGraderCalibrationActivationV1({
      token: input.freshAdminToken,
      activationId: pending.activation.activationId,
      expectedActivationRevision: pending.activation.activationRevision,
      idempotencyKey: idempotency("complete"),
      workstationReceipt: localPending.receipt,
    }, fetchImpl);
    exactMatch(completed.activation.state, "ACTIVE", "hosted active phase");
    exactMatch(completed.activation.activationId, pending.activation.activationId, "completed activation ID");
    exactMatch(completed.authority.activationId, pending.activation.activationId, "ACTIVE authority ID");
    exactMatch(completed.authority.activationRevision, completed.activation.activationRevision, "ACTIVE authority revision");

    let localActive: AiGraderCalibrationLocalActivationStateV1;
    try {
      localActive = await confirmLocalAiGraderCalibrationActivationV1({
        baseUrl: input.baseUrl,
        stationToken: input.stationToken,
        authority: completed.authority,
      }, fetchImpl);
    } catch (error) {
      if (!isRecoverableLocalConfirmationInterruption(error)) throw error;
      localActive = await reconcileLocalAiGraderCalibrationActivationV1({
        baseUrl: input.baseUrl,
        stationToken: input.stationToken,
        authority: completed.authority,
      }, fetchImpl);
    }
    if (localActive.state !== "ACTIVE" || !localActive.authority) {
      throw new AiGraderCalibrationActivationTransportError(
        "Hosted activation completed, but local ACTIVE confirmation failed closed.",
        409,
        "AI_GRADER_CALIBRATION_LOCAL_CONFIRMATION_FAILED",
      );
    }
    exactMatch(localActive.authority.activationId, completed.activation.activationId, "local ACTIVE activation ID");
    exactMatch(localActive.authority.activationRevision, completed.activation.activationRevision, "local ACTIVE revision");
    return {
      observationAuthority,
      workstationObservation,
      pending,
      localPending,
      completed,
      localActive,
    };
  } catch (error) {
    if (pending && !completed) {
      try {
        await failAiGraderCalibrationActivationV1({
          token: input.freshAdminToken,
          activationId: pending.activation.activationId,
          expectedActivationRevision: pending.activation.activationRevision,
          idempotencyKey: idempotency("fail"),
          failureCode: failureStage,
        }, fetchImpl);
        if (pending.pendingAuthority) {
          await abortLocalAiGraderCalibrationActivationV1({
            baseUrl: input.baseUrl,
            stationToken: input.stationToken,
            pendingAuthority: pending.pendingAuthority,
          }, fetchImpl);
        }
      } catch (failError) {
        const originalMessage = error instanceof Error ? error.message : "Calibration activation failed.";
        const failMessage = failError instanceof Error ? failError.message : "Hosted failure recording failed.";
        throw new AiGraderCalibrationActivationTransportError(
          `${originalMessage} Failure recording also failed closed: ${failMessage}`,
          409,
          "AI_GRADER_CALIBRATION_ACTIVATION_FAILURE_RECORDING_FAILED",
        );
      }
    }
    throw error;
  }
}
