import { z } from "zod";
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  mathematicalCalibrationProfileV1Schema,
  validateMathematicalCalibrationProfileV1,
  type MathematicalCalibrationValidationIssueV1,
} from "./aiGraderMathematicalCalibrationV1";

export const PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_SCHEMA_VERSION =
  "ten-kings-product-owner-operational-acceptance-v1" as const;
export const PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS =
  "OWNER_ACCEPTED_WITH_RECORDED_EXCEPTIONS" as const;
export const PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_HASH_POLICY =
  "sha256-canonical-json-with-authoritySha256-omitted" as const;
export const PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_AUTHORITY_ID =
  "ten-kings-owner-operational-acceptance-math-cal-v1-20260722-4cfa410c-01-v1" as const;
export const PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_CONTRACT_VERSION =
  "ten-kings-product-owner-operational-acceptance-contract-v1" as const;
export const PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_NAME = "Mark" as const;
export const PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_ORGANIZATION = "Ten Kings" as const;
export const PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_REASON =
  "Product owner directs operational use of the preserved calibration exactly as captured; all measurements, threshold exceptions, evidence hashes, and provenance must remain unchanged and visible." as const;

/**
 * This record is content-addressed product-owner decision metadata, not a
 * standalone authentication credential. Production operational use is
 * authenticated and authorized by the existing fresh-human-admin ECDSA-signed
 * ACTIVE calibration authority that binds the containing bundle and rig.
 */

export const PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT = Object.freeze({
  sessionId: "math-cal-v1-20260722-4cfa410c-01",
  sessionStateSha256: "d616ba39ca34b95382394a66bb7d7d1dbe5363d74479ecded0e0d76a9959e5ce",
  sourceCaptureManifestSha256: "a960f7e21c443ee9de9a3cebbd7644f7c9ddff978136e2d7b368cdd0bae6d286",
  sourceCapturePackageSha256: "3d8e5af902393b433aebffb3afccb85a918bc0c64a3b38e9abb6860f81fc3f98",
  analysisSha256: "f55d53c80f1e0cfd6a6bf43f39a9adbfbc20b5bae36969a1f5277ff2c6cae65a",
  analysisFileSha256: "6a55341f6b948c6537f7a816ed31eebc3d98e7b1b86a7cb5896404b492752a39",
  thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  physicalArtifactSha256: "ec0e3e8dc1f3dc9b067ecdb3edcad72daa73f67c20486548c5d892cbaf96d36b",
  mathematicalAcceptanceFileSha256: "44b11441d9c97840e134b01c5d2918db4624733923b4f23457c04cb9c817f016",
  exceptionCount: 36,
  rigId: "fixed-rig-dell-v1",
} as const);

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "must be an exact lowercase SHA-256");
const gitShaSchema = z.string().regex(/^[a-f0-9]{40}$/, "must be an exact lowercase Git SHA");
const exactUtcSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "must be exact millisecond UTC")
  .refine((value) => Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString() === value, {
    message: "must be a real canonical UTC timestamp",
  });
const issueSchema = z.strictObject({ path: z.string().min(1), message: z.string().min(1) });

export const productOwnerOperationalAcceptanceV1Schema = z.strictObject({
  schemaVersion: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_SCHEMA_VERSION),
  authorityId: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_AUTHORITY_ID),
  authorityStatus: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS),
  hashPolicy: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_HASH_POLICY),
  authoritySha256: sha256Schema,
  owner: z.strictObject({
    name: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_NAME),
    organization: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_ORGANIZATION),
    role: z.literal("product_owner"),
  }),
  decisionAt: exactUtcSchema,
  reason: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_REASON),
  subject: z.strictObject({
    sessionId: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.sessionId),
    sessionStateSha256: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.sessionStateSha256),
    sourceCaptureManifestSha256: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.sourceCaptureManifestSha256),
    sourceCapturePackageSha256: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.sourceCapturePackageSha256),
    analysisSha256: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.analysisSha256),
    analysisFileSha256: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.analysisFileSha256),
    thresholdSetHash: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.thresholdSetHash),
    physicalArtifactSha256: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.physicalArtifactSha256),
    mathematicalAcceptanceFileSha256: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.mathematicalAcceptanceFileSha256),
    mathematicalAcceptanceStatus: z.literal("rejected"),
    mathematicalIsCalibrated: z.literal(false),
    rigId: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.rigId),
    profileId: z.string().min(1),
    calibrationVersion: z.string().min(1),
    finalizedAt: exactUtcSchema,
    artifactId: z.string().min(1),
  }),
  exceptionLedger: z.array(issueSchema).length(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT.exceptionCount),
  exceptionLedgerSha256: sha256Schema,
  implementation: z.strictObject({
    contractVersion: z.literal(PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_CONTRACT_VERSION),
    implementationGitSha: gitShaSchema,
    finalizerSha256: sha256Schema,
    authorityProducerSha256: sha256Schema,
    nodeRuntimeVersion: z.string().regex(/^v\d+\.\d+\.\d+$/),
  }),
  lifecycle: z.strictObject({
    sequence: z.literal(1),
    priorAuthoritySha256: z.null(),
    revokedByAuthoritySha256: z.null(),
    supersededByAuthoritySha256: z.null(),
  }),
});

export type ProductOwnerOperationalAcceptanceV1 = z.infer<
  typeof productOwnerOperationalAcceptanceV1Schema
>;

export const operationallyAcceptedMathematicalCalibrationProfileV1Schema =
  mathematicalCalibrationProfileV1Schema.extend({
    isCalibrated: z.literal(false),
    status: z.literal("rejected"),
    operationalAcceptance: productOwnerOperationalAcceptanceV1Schema,
  });
export const rejectedMathematicalCalibrationProfileCandidateV1Schema =
  operationallyAcceptedMathematicalCalibrationProfileV1Schema.omit({
    operationalAcceptance: true,
  });

export type OperationallyAcceptedMathematicalCalibrationProfileV1 = z.infer<
  typeof operationallyAcceptedMathematicalCalibrationProfileV1Schema
>;
export type RejectedMathematicalCalibrationProfileCandidateV1 = z.infer<
  typeof rejectedMathematicalCalibrationProfileCandidateV1Schema
>;
export type OperationallyUsableMathematicalCalibrationProfileV1 =
  | z.infer<typeof mathematicalCalibrationProfileV1Schema>
  | OperationallyAcceptedMathematicalCalibrationProfileV1;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function canonicalProductOwnerOperationalAcceptancePayloadV1(
  authority: ProductOwnerOperationalAcceptanceV1,
): string {
  const { authoritySha256: _omitted, ...payload } = authority;
  return JSON.stringify(canonical(payload));
}

export function canonicalProductOwnerOperationalAcceptanceIssueLedgerV1(
  issues: readonly MathematicalCalibrationValidationIssueV1[],
): string {
  return JSON.stringify(canonical(issues));
}

export type OperationalCalibrationValidationResultV1 = Readonly<{
  valid: boolean;
  isCalibrated: boolean;
  isOperationallyAccepted: boolean;
  operationalStatus?: typeof PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS;
  issues: readonly MathematicalCalibrationValidationIssueV1[];
  profile?: OperationallyUsableMathematicalCalibrationProfileV1;
}>;

export function validateMathematicalCalibrationForOperationalUseV1(
  value: unknown,
): OperationalCalibrationValidationResultV1 {
  const mathematical = validateMathematicalCalibrationProfileV1(value);
  if (mathematical.valid && mathematical.isCalibrated && mathematical.profile) {
    return { ...mathematical, isOperationallyAccepted: false };
  }
  const parsed = operationallyAcceptedMathematicalCalibrationProfileV1Schema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      isCalibrated: false,
      isOperationallyAccepted: false,
      issues: parsed.error.issues.map((entry) => ({ path: entry.path.join("."), message: entry.message })),
    };
  }
  const { operationalAcceptance, ...rejectedProfile } = parsed.data;
  if (
    operationalAcceptance.subject.profileId !== rejectedProfile.profileId ||
    operationalAcceptance.subject.calibrationVersion !== rejectedProfile.calibrationVersion ||
    operationalAcceptance.subject.finalizedAt !== rejectedProfile.finalizedAt ||
    operationalAcceptance.subject.artifactId !== rejectedProfile.artifactId ||
    operationalAcceptance.subject.physicalArtifactSha256 !== rejectedProfile.artifactSha256 ||
    operationalAcceptance.subject.rigId !== rejectedProfile.rigId ||
    operationalAcceptance.subject.thresholdSetHash !== rejectedProfile.thresholdSetHash
  ) {
    return {
      valid: false,
      isCalibrated: false,
      isOperationallyAccepted: false,
      issues: [{
        path: "operationalAcceptance.subject",
        message: "must exactly bind this rejected profile, physical artifact, rig, and threshold authority",
      }],
    };
  }
  const rederived = validateMathematicalCalibrationProfileV1({
    ...rejectedProfile,
    isCalibrated: true,
    status: "finalized",
  });
  if (
    rederived.valid || rederived.isCalibrated || rederived.profile ||
    rederived.issues.length === 0 ||
    JSON.stringify(canonical(rederived.issues)) !==
      JSON.stringify(canonical(
        operationalAcceptance.exceptionLedger.slice(-rederived.issues.length),
      ))
  ) {
    return {
      valid: false,
      isCalibrated: false,
      isOperationallyAccepted: false,
      issues: [{
        path: "operationalAcceptance.exceptionLedger",
        message: "must exactly reproduce the unchanged mathematical rejection for this profile",
      }],
    };
  }
  return {
    valid: true,
    isCalibrated: false,
    isOperationallyAccepted: true,
    operationalStatus: PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS,
    issues: rederived.issues,
    profile: parsed.data,
  };
}
