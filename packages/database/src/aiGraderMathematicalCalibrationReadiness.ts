import {
  AI_GRADER_REPORT_BUNDLE_V03_VERSION,
  aiGraderReportBundleV03Schema,
} from "@tenkings/shared";

type JsonRecord = Record<string, unknown>;

export type AiGraderMathematicalCalibrationSnapshotDelegate = {
  findMany(args: unknown): Promise<unknown[]>;
};

export type AiGraderMathematicalCalibrationReadinessDb = {
  calibrationSnapshot?: AiGraderMathematicalCalibrationSnapshotDelegate;
};

export type AiGraderMathematicalCalibrationIdentity = {
  rigId: string;
  profileId: string;
  calibrationVersion: string;
  profileFinalizedAt: Date;
  artifactId: string;
  artifactSha256: string;
  thresholdSetId: string;
  thresholdSetHash: string;
  bundleSchemaVersion: string;
  bundleManifestSha256: string;
  sourceCaptureManifestSha256: string;
  memberLedgerSha256: string;
  calibrationBundleAuthority: JsonRecord;
  captureContractVersion?: "1.2.0";
  runtimeContextSha256?: string;
  rigCharacterizationSha256?: string;
};

export type AiGraderMathematicalCalibrationReadinessCode =
  | "not_required"
  | "ready"
  | "invalid_report_bundle"
  | "schema_unavailable"
  | "trusted_snapshot_missing"
  | "trusted_snapshot_ambiguous"
  | "trusted_snapshot_integrity_mismatch";

export type AiGraderMathematicalCalibrationReadiness = {
  required: boolean;
  ready: boolean;
  code: AiGraderMathematicalCalibrationReadinessCode;
  message?: string;
  snapshotId?: string;
  identity?: AiGraderMathematicalCalibrationIdentity;
};

export type ReadAiGraderMathematicalCalibrationReadinessInput = {
  tenantId: string;
  reportBundle: unknown;
  at?: string | Date;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function exactDate(value: unknown) {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? date : undefined;
}

function dateEquals(value: unknown, expected: Date) {
  return exactDate(value)?.getTime() === expected.getTime();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function sameCanonicalJson(left: unknown, right: unknown) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function identityFromBundle(reportBundle: unknown):
  | { success: true; identity: AiGraderMathematicalCalibrationIdentity }
  | { success: false; message: string } {
  const parsed = aiGraderReportBundleV03Schema.safeParse(reportBundle);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .slice(0, 8)
      .map((entry) => `${entry.path.join(".") || "bundle"}: ${entry.message}`)
      .join("; ");
    return {
      success: false,
      message: `Strict Mathematical V1 report bundle validation failed: ${summary}`,
    };
  }
  const profileFinalizedAt = exactDate(parsed.data.calibrationProfile.finalizedAt);
  if (!profileFinalizedAt) {
    return { success: false, message: "The Mathematical V1 calibration finalizedAt value is invalid." };
  }
  return {
    success: true,
    identity: {
      rigId: parsed.data.calibrationProfile.rigId,
      profileId: parsed.data.calibrationProfile.profileId,
      calibrationVersion: parsed.data.calibrationProfile.calibrationVersion,
      profileFinalizedAt,
      artifactId: parsed.data.calibrationProfile.artifactId,
      artifactSha256: parsed.data.calibrationProfile.artifactSha256,
      thresholdSetId: parsed.data.gradingStandard.thresholdSetId,
      thresholdSetHash: parsed.data.gradingStandard.thresholdSetHash,
      bundleSchemaVersion: parsed.data.calibrationBundleAuthority.schemaVersion,
      bundleManifestSha256: parsed.data.calibrationBundleAuthority.bundleManifestSha256,
      sourceCaptureManifestSha256:
        parsed.data.calibrationBundleAuthority.sourceCaptureManifestSha256,
      memberLedgerSha256: parsed.data.calibrationBundleAuthority.memberLedgerSha256,
      calibrationBundleAuthority:
        parsed.data.calibrationBundleAuthority as unknown as JsonRecord,
      ...(parsed.data.calibrationBundleAuthority.captureContractVersion ? {
        captureContractVersion: parsed.data.calibrationBundleAuthority.captureContractVersion,
        runtimeContextSha256:
          parsed.data.calibrationBundleAuthority.runtimeContextSha256,
        rigCharacterizationSha256:
          parsed.data.calibrationBundleAuthority.rigCharacterizationSha256,
      } : {}),
    },
  };
}

function rowMatches(
  row: unknown,
  tenantId: string,
  identity: AiGraderMathematicalCalibrationIdentity,
  at: Date,
) {
  if (!isRecord(row) || !isRecord(row.rig)) return false;
  const validityStartsAt = exactDate(row.validityStartsAt);
  const validityEndsAt = row.validityEndsAt === null ? null : exactDate(row.validityEndsAt);
  const trustedAt = exactDate(row.trustedAt);
  return (
    exactText(row.id).length > 0 &&
    exactText(row.rigId) === identity.rigId &&
    exactText(row.calibrationType) === "MATHEMATICAL_GRADING_V1" &&
    exactText(row.mathematicalProfileId) === identity.profileId &&
    exactText(row.mathematicalCalibrationVersion) === identity.calibrationVersion &&
    dateEquals(row.mathematicalProfileFinalizedAt, identity.profileFinalizedAt) &&
    exactText(row.mathematicalArtifactId) === identity.artifactId &&
    exactText(row.mathematicalArtifactSha256) === identity.artifactSha256 &&
    exactText(row.mathematicalThresholdSetId) === identity.thresholdSetId &&
    exactText(row.mathematicalThresholdSetHash) === identity.thresholdSetHash &&
    exactText(row.mathematicalBundleSchemaVersion) === identity.bundleSchemaVersion &&
    exactText(row.mathematicalBundleManifestSha256) === identity.bundleManifestSha256 &&
    exactText(row.mathematicalSourceCaptureManifestSha256) ===
      identity.sourceCaptureManifestSha256 &&
    exactText(row.mathematicalMemberLedgerSha256) === identity.memberLedgerSha256 &&
    isRecord(row.artifactChecksums) &&
    sameCanonicalJson(
      row.artifactChecksums.calibrationBundleAuthority,
      identity.calibrationBundleAuthority,
    ) &&
    exactText(row.trustStatus) === "TRUSTED" &&
    trustedAt !== undefined &&
    trustedAt.getTime() <= at.getTime() &&
    validityStartsAt !== undefined &&
    validityStartsAt.getTime() <= at.getTime() &&
    (validityEndsAt === null || (validityEndsAt !== undefined && validityEndsAt.getTime() > at.getTime())) &&
    row.supersededById === null &&
    exactText(row.rig.tenantId) === tenantId &&
    exactText(row.rig.status) === "ACTIVE"
  );
}

export async function readAiGraderMathematicalCalibrationReadiness(
  db: AiGraderMathematicalCalibrationReadinessDb,
  input: ReadAiGraderMathematicalCalibrationReadinessInput,
): Promise<AiGraderMathematicalCalibrationReadiness> {
  if (!isRecord(input.reportBundle) || input.reportBundle.schemaVersion !== AI_GRADER_REPORT_BUNDLE_V03_VERSION) {
    return { required: false, ready: true, code: "not_required" };
  }
  const tenantId = exactText(input.tenantId);
  const at = exactDate(input.at ?? new Date());
  const parsed = identityFromBundle(input.reportBundle);
  if (!tenantId || !at || !parsed.success) {
    return {
      required: true,
      ready: false,
      code: "invalid_report_bundle",
      message: !tenantId ? "A tenant identity is required for Mathematical V1 calibration readiness." : !at
        ? "The calibration readiness timestamp is invalid."
        : parsed.success ? "The Mathematical V1 calibration identity is invalid." : parsed.message,
    };
  }
  const identity = parsed.identity;
  if (typeof db.calibrationSnapshot?.findMany !== "function") {
    return {
      required: true,
      ready: false,
      code: "schema_unavailable",
      message: "The trusted Mathematical V1 CalibrationSnapshot query is unavailable.",
      identity,
    };
  }
  const rows = await db.calibrationSnapshot.findMany({
    where: {
      rigId: identity.rigId,
      calibrationType: "MATHEMATICAL_GRADING_V1",
      mathematicalProfileId: identity.profileId,
      mathematicalCalibrationVersion: identity.calibrationVersion,
      mathematicalProfileFinalizedAt: identity.profileFinalizedAt,
      mathematicalArtifactId: identity.artifactId,
      mathematicalArtifactSha256: identity.artifactSha256,
      mathematicalThresholdSetId: identity.thresholdSetId,
      mathematicalThresholdSetHash: identity.thresholdSetHash,
      mathematicalBundleSchemaVersion: identity.bundleSchemaVersion,
      mathematicalBundleManifestSha256: identity.bundleManifestSha256,
      mathematicalSourceCaptureManifestSha256: identity.sourceCaptureManifestSha256,
      mathematicalMemberLedgerSha256: identity.memberLedgerSha256,
      trustStatus: "TRUSTED",
      trustedAt: { lte: at },
      validityStartsAt: { lte: at },
      OR: [{ validityEndsAt: null }, { validityEndsAt: { gt: at } }],
      supersededById: null,
      rig: { is: { tenantId, status: "ACTIVE" } },
    },
    orderBy: [{ validityStartsAt: "desc" }, { createdAt: "desc" }],
    take: 2,
    select: {
      id: true,
      rigId: true,
      calibrationType: true,
      mathematicalProfileId: true,
      mathematicalCalibrationVersion: true,
      mathematicalProfileFinalizedAt: true,
      mathematicalArtifactId: true,
      mathematicalArtifactSha256: true,
      mathematicalThresholdSetId: true,
      mathematicalThresholdSetHash: true,
      mathematicalBundleSchemaVersion: true,
      mathematicalBundleManifestSha256: true,
      mathematicalSourceCaptureManifestSha256: true,
      mathematicalMemberLedgerSha256: true,
      artifactChecksums: true,
      trustStatus: true,
      trustedAt: true,
      validityStartsAt: true,
      validityEndsAt: true,
      supersededById: true,
      rig: { select: { tenantId: true, status: true } },
    },
  });
  if (rows.length === 0) {
    return {
      required: true,
      ready: false,
      code: "trusted_snapshot_missing",
      message: "No currently valid trusted Mathematical V1 CalibrationSnapshot exactly matches the report calibration identity and hashes.",
      identity,
    };
  }
  if (rows.length !== 1) {
    return {
      required: true,
      ready: false,
      code: "trusted_snapshot_ambiguous",
      message: "More than one currently valid trusted Mathematical V1 CalibrationSnapshot matched the report.",
      identity,
    };
  }
  if (!rowMatches(rows[0], tenantId, identity, at)) {
    return {
      required: true,
      ready: false,
      code: "trusted_snapshot_integrity_mismatch",
      message: "The trusted Mathematical V1 CalibrationSnapshot query returned contradictory identity, hash, trust, or validity evidence.",
      identity,
    };
  }
  return {
    required: true,
    ready: true,
    code: "ready",
    snapshotId: exactText((rows[0] as JsonRecord).id),
    identity,
  };
}
