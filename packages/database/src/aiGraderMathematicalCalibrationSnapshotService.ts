import { createHash } from "node:crypto";
import {
  aiGraderOperatingContextV1Schema,
  canonicalAiGraderOperatingContextV1,
  canonicalAiGraderRuntimeContextV1,
  mathematicalCalibrationProfileV1Schema,
  type MathematicalCalibrationProfileV1,
} from "@tenkings/shared";

export const AI_GRADER_MATHEMATICAL_CALIBRATION_IMPORT_V1_SCHEMA_VERSION =
  "ai-grader-mathematical-calibration-snapshot-import-v1" as const;
export const AI_GRADER_PHYSICAL_CALIBRATION_ARTIFACT_V1_SCHEMA_VERSION =
  "ai-grader-physical-calibration-artifact-v1" as const;
export const AI_GRADER_PHYSICAL_CALIBRATION_ARTIFACT_HASH_POLICY =
  "sha256-canonical-json-with-artifactSha256-omitted" as const;

type TrustStatus = "DRAFT" | "TRUSTED" | "REVOKED";
type JsonRecord = Record<string, unknown>;
const COMPLETE_BUNDLE_SCHEMA_VERSION = "ten-kings-mathematical-calibration-bundle-v1" as const;

export type AiGraderMathematicalCalibrationBundleAuthorityMemberV1 = {
  role:
    | "calibration_profile"
    | "physical_calibration_artifact"
    | "calibration_acceptance"
    | "flat_field"
    | "illumination_pattern";
  channelIndex?: number;
  fileName: string;
  sha256: string;
};

export type AiGraderMathematicalCalibrationBundleAuthorityV1 = {
  schemaVersion: typeof COMPLETE_BUNDLE_SCHEMA_VERSION;
  bundleManifestSha256: string;
  sourceCaptureManifestSha256: string;
  memberLedgerSha256: string;
  members: AiGraderMathematicalCalibrationBundleAuthorityMemberV1[];
};

export type AiGraderLoadedMathematicalCalibrationBundleV1 = {
  profile: MathematicalCalibrationProfileV1;
  physicalArtifact: JsonRecord;
  authority: AiGraderMathematicalCalibrationBundleAuthorityV1;
  files: {
    profile: { path: string; sha256: string };
    physicalArtifact: { path: string; sha256: string };
    acceptance: { path: string; sha256: string };
    flatFields: Array<{ path: string; sha256: string }>;
    illuminationPattern: { path: string; sha256: string };
  };
};

export type AiGraderMathematicalCalibrationSnapshotRow = {
  id: string;
  rigId: string;
  calibrationType: string;
  componentSerials: unknown;
  artifactKeys: unknown;
  artifactChecksums: unknown;
  residuals: unknown;
  operatorId: string | null;
  mathematicalProfileId: string | null;
  mathematicalCalibrationVersion: string | null;
  mathematicalProfileFinalizedAt: Date | null;
  mathematicalArtifactId: string | null;
  mathematicalArtifactSha256: string | null;
  mathematicalThresholdSetId: string | null;
  mathematicalThresholdSetHash: string | null;
  mathematicalBundleSchemaVersion: string | null;
  mathematicalBundleManifestSha256: string | null;
  mathematicalSourceCaptureManifestSha256: string | null;
  mathematicalMemberLedgerSha256: string | null;
  mathematicalOperatingContextV1: unknown;
  mathematicalOperatingContextHash: string | null;
  mathematicalRuntimeContextHash: string | null;
  mathematicalRigCharacterizationSha256: string | null;
  trustStatus: TrustStatus;
  trustedAt: Date | null;
  trustedByOperatorId: string | null;
  revokedAt: Date | null;
  revokedByOperatorId: string | null;
  revocationReason: string | null;
  validityStartsAt: Date;
  validityEndsAt: Date | null;
  supersededById: string | null;
  supersededByOperatorId: string | null;
  supersessionReason: string | null;
  createdAt: Date;
  [key: string]: unknown;
};

type SnapshotDelegate = {
  create(args: { data: JsonRecord }): Promise<AiGraderMathematicalCalibrationSnapshotRow>;
  findFirst(args: { where: JsonRecord }): Promise<AiGraderMathematicalCalibrationSnapshotRow | null>;
  findMany(args: {
    where: JsonRecord;
    orderBy?: ReadonlyArray<Record<string, "asc" | "desc">>;
  }): Promise<AiGraderMathematicalCalibrationSnapshotRow[]>;
  updateMany(args: { where: JsonRecord; data: JsonRecord }): Promise<{ count: number }>;
};

type TransactionDb = { calibrationSnapshot: SnapshotDelegate };
export type AiGraderMathematicalCalibrationSnapshotDb = TransactionDb & {
  $transaction<T>(operation: (tx: TransactionDb) => Promise<T>): Promise<T>;
};

export type ImportAiGraderMathematicalCalibrationSnapshotV1Input = {
  rigId: string;
  bundleStorageKey: string;
  expectedBundleManifestSha256: string;
  componentSerials: Record<string, string>;
  operatingContextV1: unknown;
  importedByOperatorId: string;
  validityStartsAt?: string | Date;
};
export type TrustAiGraderMathematicalCalibrationSnapshotV1Input = {
  snapshotId: string;
  expectedArtifactSha256: string;
  expectedBundleManifestSha256: string;
  trustedByOperatorId: string;
};
export type RevokeAiGraderMathematicalCalibrationSnapshotV1Input = {
  snapshotId: string;
  expectedArtifactSha256: string;
  expectedBundleManifestSha256: string;
  revokedByOperatorId: string;
  reason: string;
};
export type SupersedeAiGraderMathematicalCalibrationSnapshotV1Input = {
  priorSnapshotId: string;
  expectedPriorArtifactSha256: string;
  expectedPriorBundleManifestSha256: string;
  replacementSnapshotId: string;
  expectedReplacementArtifactSha256: string;
  expectedReplacementBundleManifestSha256: string;
  supersededByOperatorId: string;
  reason: string;
};
export type AiGraderMathematicalCalibrationSnapshotServiceOptions = {
  now?: () => Date;
  readArtifactBytes?: (storageKey: string) => Promise<Uint8Array>;
  loadFinalizedBundle?: (input: {
    bundleStorageKey: string;
    bundleSha256: string;
    expectedRigId: string;
    readArtifactBytes(storageKey: string): Promise<Uint8Array>;
  }) => Promise<AiGraderLoadedMathematicalCalibrationBundleV1>;
  maximumArtifactBytes?: number;
};

export type AiGraderMathematicalCalibrationSnapshotServiceErrorCode =
  | "AI_GRADER_MATHEMATICAL_CALIBRATION_INVALID_INPUT"
  | "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_READ_UNAVAILABLE"
  | "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_READ_FAILED"
  | "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INVALID"
  | "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH"
  | "AI_GRADER_MATHEMATICAL_CALIBRATION_EXACT_SNAPSHOT_NOT_FOUND"
  | "AI_GRADER_MATHEMATICAL_CALIBRATION_STATE_CONFLICT";

export class AiGraderMathematicalCalibrationSnapshotServiceError extends Error {
  readonly code: AiGraderMathematicalCalibrationSnapshotServiceErrorCode;
  readonly field?: string;
  constructor(
    code: AiGraderMathematicalCalibrationSnapshotServiceErrorCode,
    message: string,
    field?: string,
  ) {
    super(message);
    this.name = "AiGraderMathematicalCalibrationSnapshotServiceError";
    this.code = code;
    this.field = field;
  }
}

type VerifiedArtifactSet = {
  profile: MathematicalCalibrationProfileV1;
  physicalArtifact: JsonRecord;
  authority: AiGraderMathematicalCalibrationBundleAuthorityV1;
  bundleStorageKey: string;
  memberStorageKeys: Array<AiGraderMathematicalCalibrationBundleAuthorityMemberV1 & {
    storageKey: string;
  }>;
};

function invalid(field: string, message: string): never {
  throw new AiGraderMathematicalCalibrationSnapshotServiceError(
    "AI_GRADER_MATHEMATICAL_CALIBRATION_INVALID_INPUT",
    field + ": " + message,
    field,
  );
}

function artifactFailure(
  code: Extract<AiGraderMathematicalCalibrationSnapshotServiceErrorCode,
    | "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_READ_UNAVAILABLE"
    | "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_READ_FAILED"
    | "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INVALID"
    | "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH">,
  message: string,
): never {
  throw new AiGraderMathematicalCalibrationSnapshotServiceError(code, message);
}

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(field, "must be a JSON object");
  }
  return value as JsonRecord;
}

function text(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
      value !== value.trim()) {
    return invalid(field, "must be a non-empty canonical string");
  }
  return value;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    return invalid(field, "must be an exact lowercase SHA-256");
  }
  return value;
}

function storageKey(value: unknown, field: string): string {
  const key = text(value, field, 1024);
  if (key.startsWith("/") || key.includes(String.fromCharCode(92)) ||
      key.includes("://") || key.includes("?") || key.includes("#") ||
      key.split("/").some((part) => part === "." || part === "..")) {
    return invalid(field, "must be a private relative object key");
  }
  return key;
}

function date(value: unknown, field: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime())
    : typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(parsed.getTime())) return invalid(field, "must be a valid timestamp");
  return parsed;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}

function parseJsonBytes(bytes: Uint8Array, label: string, maximumBytes: number): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 || bytes.byteLength > maximumBytes) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INVALID",
      label + " must contain bounded non-empty UTF-8 JSON bytes.",
    );
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INVALID",
      label + " is not valid UTF-8 JSON.",
    );
  }
}

function componentSerials(value: unknown): JsonRecord {
  const serials = record(value, "componentSerials");
  const entries = Object.entries(serials);
  if (entries.length < 1) return invalid("componentSerials", "must identify at least one component");
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)).map(
    ([key, entry]) => [text(key, "componentSerials key", 128), text(entry, "componentSerials." + key, 256)],
  ));
}

function artifactKeysFromRow(row: AiGraderMathematicalCalibrationSnapshotRow) {
  const keys = record(row.artifactKeys, "artifactKeys");
  if (keys.schemaVersion !== AI_GRADER_MATHEMATICAL_CALIBRATION_IMPORT_V1_SCHEMA_VERSION) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
      "Stored calibration artifact-key schema is invalid.",
    );
  }
  if (!Array.isArray(keys.members) || keys.members.length !== 12) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
      "Stored calibration artifact-key ledger must contain exactly twelve members.",
    );
  }
  return {
    bundleStorageKey: storageKey(keys.bundleStorageKey, "artifactKeys.bundleStorageKey"),
    members: keys.members.map((value, index) => {
      const member = record(value, `artifactKeys.members[${index}]`);
      return {
        role: text(member.role, `artifactKeys.members[${index}].role`, 64),
        ...(member.channelIndex === undefined
          ? {}
          : { channelIndex: member.channelIndex }),
        fileName: text(member.fileName, `artifactKeys.members[${index}].fileName`, 128),
        sha256: sha256(member.sha256, `artifactKeys.members[${index}].sha256`),
        storageKey: storageKey(member.storageKey, `artifactKeys.members[${index}].storageKey`),
      };
    }),
  };
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function validateVerifiedBundle(
  loaded: AiGraderLoadedMathematicalCalibrationBundleV1,
  bundleStorageKey: string,
  expectedBundleManifestSha256: string,
  expectedRigId: string,
): VerifiedArtifactSet {
  if (!loaded || typeof loaded !== "object") {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INVALID",
      "Canonical calibration-bundle loader returned no verified bundle.",
    );
  }
  const parsedProfile = mathematicalCalibrationProfileV1Schema.safeParse(loaded.profile);
  if (!parsedProfile.success || !parsedProfile.data.isCalibrated || parsedProfile.data.status !== "finalized") {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INVALID",
      "Canonical calibration-bundle loader did not return a finalized Mathematical Calibration Profile V1.",
    );
  }
  const profile = parsedProfile.data;
  if (profile.rigId !== expectedRigId) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
      "Verified calibration bundle rigId does not match the requested fixed rig.",
    );
  }
  const authority = record(loaded.authority, "loadedBundle.authority") as
    AiGraderMathematicalCalibrationBundleAuthorityV1;
  if (
    authority.schemaVersion !== COMPLETE_BUNDLE_SCHEMA_VERSION ||
    sha256(authority.bundleManifestSha256, "authority.bundleManifestSha256") !==
      expectedBundleManifestSha256 ||
    !Array.isArray(authority.members) ||
    authority.members.length !== 12
  ) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
      "Canonical calibration-bundle authority does not match the exact protected manifest.",
    );
  }
  sha256(authority.sourceCaptureManifestSha256, "authority.sourceCaptureManifestSha256");
  const memberLedgerSha256 = sha256(authority.memberLedgerSha256, "authority.memberLedgerSha256");
  const expectedMembers: Array<{ role: string; channelIndex?: number; fileName: string }> = [
    { role: "calibration_profile", fileName: "mathematical-calibration-profile-v1.json" },
    { role: "physical_calibration_artifact", fileName: "mathematical-calibration-artifact-v1.json" },
    { role: "calibration_acceptance", fileName: "mathematical-calibration-acceptance-v1.json" },
    ...Array.from({ length: 8 }, (_, index) => ({
      role: "flat_field",
      channelIndex: index + 1,
      fileName: `flat-field-channel-${index + 1}-v1.json`,
    })),
    { role: "illumination_pattern", fileName: "illumination-pattern-v1.json" },
  ];
  const members = authority.members.map((value, index) => {
    const member = record(value, `authority.members[${index}]`);
    const expected = expectedMembers[index]!;
    const channelIndex = member.channelIndex;
    if (
      member.role !== expected.role ||
      member.fileName !== expected.fileName ||
      (expected.channelIndex === undefined ? channelIndex !== undefined : channelIndex !== expected.channelIndex)
    ) {
      return artifactFailure(
        "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
        `Calibration bundle member ${index + 1} does not match the exact V1 ledger order and role.`,
      );
    }
    return {
      role: expected.role as AiGraderMathematicalCalibrationBundleAuthorityMemberV1["role"],
      ...(expected.channelIndex === undefined ? {} : { channelIndex: expected.channelIndex }),
      fileName: expected.fileName,
      sha256: sha256(member.sha256, `authority.members[${index}].sha256`),
    };
  });
  if (hashCanonical(members) !== memberLedgerSha256) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
      "Calibration bundle member-ledger SHA-256 does not reproduce.",
    );
  }
  const directory = bundleStorageKey.split("/").slice(0, -1).join("/");
  const memberStorageKeys = members.map((member) => ({
    ...member,
    storageKey: directory ? `${directory}/${member.fileName}` : member.fileName,
  }));
  const loadedFiles = [
    loaded.files?.profile,
    loaded.files?.physicalArtifact,
    loaded.files?.acceptance,
    ...(loaded.files?.flatFields ?? []),
    loaded.files?.illuminationPattern,
  ];
  if (
    loadedFiles.length !== 12 ||
    loadedFiles.some((file, index) =>
      !file ||
      file.path !== memberStorageKeys[index]!.storageKey ||
      file.sha256 !== memberStorageKeys[index]!.sha256)
  ) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
      "Canonical bundle loader file ledger does not match exact storage keys and member hashes.",
    );
  }
  const physicalArtifact = record(loaded.physicalArtifact, "loadedBundle.physicalArtifact");
  const exactFields: Array<[unknown, unknown]> = [
    [physicalArtifact.rigId, profile.rigId],
    [physicalArtifact.profileId, profile.profileId],
    [physicalArtifact.calibrationVersion, profile.calibrationVersion],
    [physicalArtifact.finalizedAt, profile.finalizedAt],
    [physicalArtifact.artifactId, profile.artifactId],
    [physicalArtifact.artifactSha256, profile.artifactSha256],
    [physicalArtifact.thresholdSetId, profile.thresholdSetId],
    [physicalArtifact.thresholdSetHash, profile.thresholdSetHash],
  ];
  if (exactFields.some(([left, right]) => left !== right)) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
      "Verified bundle physical artifact does not match its finalized profile identity.",
    );
  }
  return {
    profile,
    physicalArtifact,
    authority: {
      schemaVersion: COMPLETE_BUNDLE_SCHEMA_VERSION,
      bundleManifestSha256: authority.bundleManifestSha256,
      sourceCaptureManifestSha256: authority.sourceCaptureManifestSha256,
      memberLedgerSha256,
      members,
    },
    bundleStorageKey,
    memberStorageKeys,
  };
}

function validateOperatingContext(
  value: unknown,
  verified: VerifiedArtifactSet,
) {
  const parsed = aiGraderOperatingContextV1Schema.safeParse(value);
  if (!parsed.success) {
    return invalid("operatingContextV1", "must satisfy the exact canonical operatingContextV1 contract");
  }
  const context = parsed.data;
  const target = record(verified.physicalArtifact.target, "physicalArtifact.target");
  if (
    context.rig.rigId !== verified.profile.rigId ||
    context.calibration.targetSha256 !== target.sha256 ||
    context.calibration.rigCharacterizationSha256 !== verified.profile.artifactSha256 ||
    context.calibration.bundleSchemaVersion !== verified.authority.schemaVersion ||
    context.calibration.bundleManifestSha256 !== verified.authority.bundleManifestSha256 ||
    context.calibration.sourceCaptureManifestSha256 !== verified.authority.sourceCaptureManifestSha256 ||
    context.calibration.memberLedgerSha256 !== verified.authority.memberLedgerSha256 ||
    !sameCanonicalJson(context.calibration.members, verified.authority.members) ||
    context.software.thresholdSetId !== verified.profile.thresholdSetId ||
    context.software.thresholdSetHash !== verified.profile.thresholdSetHash ||
    context.software.calibrationAlgorithmVersion !== verified.physicalArtifact.algorithmVersion
  ) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
      "operatingContextV1 does not exactly match the verified calibration bundle and physical artifact.",
    );
  }
  const operatingContextHash = hashBytes(Buffer.from(canonicalAiGraderOperatingContextV1(context), "utf8"));
  const runtimeContextHash = hashBytes(Buffer.from(canonicalAiGraderRuntimeContextV1(context), "utf8"));
  return { context, operatingContextHash, runtimeContextHash };
}


function assertRowMatches(
  row: AiGraderMathematicalCalibrationSnapshotRow,
  verified: VerifiedArtifactSet,
  status: TrustStatus,
): AiGraderMathematicalCalibrationSnapshotRow {
  const profile = verified.profile;
  const operating = validateOperatingContext(row.mathematicalOperatingContextV1, verified);
  const expected: JsonRecord = {
    rigId: profile.rigId,
    calibrationType: "MATHEMATICAL_GRADING_V1",
    mathematicalProfileId: profile.profileId,
    mathematicalCalibrationVersion: profile.calibrationVersion,
    mathematicalArtifactId: profile.artifactId,
    mathematicalArtifactSha256: profile.artifactSha256,
    mathematicalThresholdSetId: profile.thresholdSetId,
    mathematicalThresholdSetHash: profile.thresholdSetHash,
    mathematicalBundleSchemaVersion: verified.authority.schemaVersion,
    mathematicalBundleManifestSha256: verified.authority.bundleManifestSha256,
    mathematicalSourceCaptureManifestSha256: verified.authority.sourceCaptureManifestSha256,
    mathematicalMemberLedgerSha256: verified.authority.memberLedgerSha256,
    mathematicalOperatingContextHash: operating.operatingContextHash,
    mathematicalRuntimeContextHash: operating.runtimeContextHash,
    mathematicalRigCharacterizationSha256: profile.artifactSha256,
    trustStatus: status,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (row[field] !== expectedValue) {
      return artifactFailure(
        "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
        "CalibrationSnapshot does not match verified artifact field " + field + ".",
      );
    }
  }
  if (!(row.mathematicalProfileFinalizedAt instanceof Date) ||
      row.mathematicalProfileFinalizedAt.getTime() !== new Date(profile.finalizedAt).getTime()) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
      "CalibrationSnapshot finalized timestamp does not match verified artifact bytes.",
    );
  }
  const checksums = record(row.artifactChecksums, "artifactChecksums");
  const keys = artifactKeysFromRow(row);
  if (
    checksums.schemaVersion !== AI_GRADER_MATHEMATICAL_CALIBRATION_IMPORT_V1_SCHEMA_VERSION ||
    checksums.physicalArtifactCanonicalSha256 !== profile.artifactSha256 ||
    !sameCanonicalJson(checksums.calibrationBundleAuthority, verified.authority) ||
    keys.bundleStorageKey !== verified.bundleStorageKey ||
    checksums.operatingContextHash !== operating.operatingContextHash ||
    checksums.runtimeContextHash !== operating.runtimeContextHash ||
    checksums.rigCharacterizationSha256 !== profile.artifactSha256 ||
    !sameCanonicalJson(keys.members, verified.memberStorageKeys)
  ) {
    return artifactFailure(
      "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
      "CalibrationSnapshot complete bundle authority or storage ledger does not match current storage bytes.",
    );
  }
  return row;
}

export function createAiGraderMathematicalCalibrationSnapshotService(
  db: AiGraderMathematicalCalibrationSnapshotDb,
  options: AiGraderMathematicalCalibrationSnapshotServiceOptions = {},
) {
  if (!db?.calibrationSnapshot || typeof db.$transaction !== "function") {
    invalid("db", "must provide CalibrationSnapshot and transaction delegates");
  }
  const now = options.now ?? (() => new Date());
  const maximumArtifactBytes = options.maximumArtifactBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maximumArtifactBytes) || maximumArtifactBytes < 2 ||
      maximumArtifactBytes > 256 * 1024 * 1024) {
    invalid("maximumArtifactBytes", "must be an integer from 2 bytes through 256 MiB");
  }

  const read = async (key: string): Promise<Uint8Array> => {
    if (typeof options.readArtifactBytes !== "function") {
      return artifactFailure(
        "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_READ_UNAVAILABLE",
        "Private calibration artifact storage-byte verification is not configured.",
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = await options.readArtifactBytes(key);
    } catch {
      return artifactFailure(
        "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_READ_FAILED",
        "Private calibration artifact storage bytes could not be read.",
      );
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 || bytes.byteLength > maximumArtifactBytes) {
      return artifactFailure(
        "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INVALID",
        "Private calibration bundle members must be bounded non-empty byte objects.",
      );
    }
    return bytes;
  };

  const verifyArtifactSet = async (
    bundleStorageKey: string,
    bundleManifestSha256: string,
    expectedRigId: string,
  ): Promise<VerifiedArtifactSet> => {
    if (typeof options.loadFinalizedBundle !== "function") {
      return artifactFailure(
        "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_READ_UNAVAILABLE",
        "Canonical complete calibration-bundle verification is not configured.",
      );
    }
    let loaded: AiGraderLoadedMathematicalCalibrationBundleV1;
    try {
      loaded = await options.loadFinalizedBundle({
        bundleStorageKey,
        bundleSha256: bundleManifestSha256,
        expectedRigId,
        readArtifactBytes: read,
      });
    } catch {
      return artifactFailure(
        "AI_GRADER_MATHEMATICAL_CALIBRATION_ARTIFACT_INTEGRITY_MISMATCH",
        "Canonical complete calibration-bundle verification failed.",
      );
    }
    return validateVerifiedBundle(loaded, bundleStorageKey, bundleManifestSha256, expectedRigId);
  };

  const verifyRowStorage = async (row: AiGraderMathematicalCalibrationSnapshotRow) => {
    const keys = artifactKeysFromRow(row);
    const verified = await verifyArtifactSet(
      keys.bundleStorageKey,
      sha256(row.mathematicalBundleManifestSha256, "mathematicalBundleManifestSha256"),
      row.rigId,
    );
    return { verified, row: assertRowMatches(row, verified, row.trustStatus) };
  };
  const exactNow = () => date(now(), "now");

  return {
    async verifyExact(
      snapshotIdValue: string,
      expectedStatus?: TrustStatus,
    ): Promise<AiGraderMathematicalCalibrationSnapshotRow> {
      const snapshotId = text(snapshotIdValue, "snapshotId");
      const where: JsonRecord = { id: snapshotId, calibrationType: "MATHEMATICAL_GRADING_V1" };
      if (expectedStatus) where.trustStatus = expectedStatus;
      const row = await db.calibrationSnapshot.findFirst({ where });
      if (!row) {
        throw new AiGraderMathematicalCalibrationSnapshotServiceError(
          "AI_GRADER_MATHEMATICAL_CALIBRATION_EXACT_SNAPSHOT_NOT_FOUND",
          "No exact Mathematical CalibrationSnapshot matched the requested identity and trust state.",
        );
      }
      return (await verifyRowStorage(row)).row;
    },

    async importDraft(
      input: ImportAiGraderMathematicalCalibrationSnapshotV1Input,
    ): Promise<AiGraderMathematicalCalibrationSnapshotRow> {
      const rigId = text(input.rigId, "rigId");
      const bundleStorageKey = storageKey(input.bundleStorageKey, "bundleStorageKey");
      const bundleManifestSha256 = sha256(
        input.expectedBundleManifestSha256,
        "expectedBundleManifestSha256",
      );
      const verified = await verifyArtifactSet(bundleStorageKey, bundleManifestSha256, rigId);
      const operating = validateOperatingContext(input.operatingContextV1, verified);
      const finalizedAt = date(verified.profile.finalizedAt, "profile.finalizedAt");
      const validityStartsAt = input.validityStartsAt === undefined
        ? exactNow() : date(input.validityStartsAt, "validityStartsAt");
      if (validityStartsAt.getTime() < finalizedAt.getTime()) {
        invalid("validityStartsAt", "must not precede physical calibration finalization");
      }
      const importedByOperatorId = text(input.importedByOperatorId, "importedByOperatorId");
      const profile = verified.profile;
      const data: JsonRecord = {
        rigId,
        calibrationType: "MATHEMATICAL_GRADING_V1",
        componentSerials: componentSerials(input.componentSerials),
        artifactKeys: {
          schemaVersion: AI_GRADER_MATHEMATICAL_CALIBRATION_IMPORT_V1_SCHEMA_VERSION,
          bundleStorageKey,
          members: verified.memberStorageKeys,
        },
        artifactChecksums: {
          schemaVersion: AI_GRADER_MATHEMATICAL_CALIBRATION_IMPORT_V1_SCHEMA_VERSION,
          calibrationBundleAuthority: verified.authority,
          physicalArtifactCanonicalSha256: profile.artifactSha256,
          operatingContextHash: operating.operatingContextHash,
          runtimeContextHash: operating.runtimeContextHash,
          rigCharacterizationSha256: profile.artifactSha256,
        },
        residuals: {
          schemaVersion: AI_GRADER_MATHEMATICAL_CALIBRATION_IMPORT_V1_SCHEMA_VERSION,
          scaleRelativeU95: profile.scaleRelativeU95,
          lensResidualPx: profile.lensResidualPx,
          normalizationRegistrationResidualPx: profile.normalizationRegistrationResidualPx,
          repeatedPlacementU95Mm: profile.repeatedPlacementU95Mm,
          segmentationBoundaryU95Px: profile.segmentationBoundaryU95Px,
          measurementRepeatability: profile.measurementRepeatability,
        },
        operatorId: importedByOperatorId,
        mathematicalProfileId: profile.profileId,
        mathematicalCalibrationVersion: profile.calibrationVersion,
        mathematicalProfileFinalizedAt: finalizedAt,
        mathematicalArtifactId: profile.artifactId,
        mathematicalArtifactSha256: profile.artifactSha256,
        mathematicalThresholdSetId: profile.thresholdSetId,
        mathematicalThresholdSetHash: profile.thresholdSetHash,
        mathematicalBundleSchemaVersion: verified.authority.schemaVersion,
        mathematicalBundleManifestSha256: verified.authority.bundleManifestSha256,
        mathematicalSourceCaptureManifestSha256: verified.authority.sourceCaptureManifestSha256,
        mathematicalMemberLedgerSha256: verified.authority.memberLedgerSha256,
        mathematicalOperatingContextV1: operating.context,
        mathematicalOperatingContextHash: operating.operatingContextHash,
        mathematicalRuntimeContextHash: operating.runtimeContextHash,
        mathematicalRigCharacterizationSha256: profile.artifactSha256,
        trustStatus: "DRAFT",
        validityStartsAt,
      };
      const created = await db.calibrationSnapshot.create({ data });
      return assertRowMatches(created, verified, "DRAFT");
    },

    async listForRig(rigIdValue: string): Promise<AiGraderMathematicalCalibrationSnapshotRow[]> {
      const rigId = text(rigIdValue, "rigId");
      return db.calibrationSnapshot.findMany({
        where: { rigId, calibrationType: "MATHEMATICAL_GRADING_V1" },
        orderBy: [{ createdAt: "desc" }],
      });
    },

    async trust(
      input: TrustAiGraderMathematicalCalibrationSnapshotV1Input,
    ): Promise<AiGraderMathematicalCalibrationSnapshotRow> {
      const snapshotId = text(input.snapshotId, "snapshotId");
      const expectedHash = sha256(input.expectedArtifactSha256, "expectedArtifactSha256");
      const expectedBundleHash = sha256(
        input.expectedBundleManifestSha256,
        "expectedBundleManifestSha256",
      );
      const trustedByOperatorId = text(input.trustedByOperatorId, "trustedByOperatorId");
      const trustedAt = exactNow();
      return db.$transaction(async (tx) => {
        const draft = await tx.calibrationSnapshot.findFirst({
          where: {
            id: snapshotId,
            calibrationType: "MATHEMATICAL_GRADING_V1",
            mathematicalArtifactSha256: expectedHash,
            mathematicalBundleManifestSha256: expectedBundleHash,
            trustStatus: "DRAFT",
          },
        });
        if (!draft) {
          throw new AiGraderMathematicalCalibrationSnapshotServiceError(
            "AI_GRADER_MATHEMATICAL_CALIBRATION_EXACT_SNAPSHOT_NOT_FOUND",
            "No exact draft calibration snapshot matched id, artifact SHA-256, and complete bundle manifest SHA-256.",
          );
        }
        await verifyRowStorage(draft);
        if (trustedAt.getTime() < date(draft.validityStartsAt, "validityStartsAt").getTime()) {
          invalid("trustedAt", "must not precede validityStartsAt");
        }
        const updated = await tx.calibrationSnapshot.updateMany({
          where: {
            id: snapshotId,
            mathematicalArtifactSha256: expectedHash,
            mathematicalBundleManifestSha256: expectedBundleHash,
            trustStatus: "DRAFT",
          },
          data: { trustStatus: "TRUSTED", trustedAt, trustedByOperatorId },
        });
        if (updated.count !== 1) {
          throw new AiGraderMathematicalCalibrationSnapshotServiceError(
            "AI_GRADER_MATHEMATICAL_CALIBRATION_STATE_CONFLICT",
            "Exact draft calibration snapshot changed before trust completed.",
          );
        }
        const row = await tx.calibrationSnapshot.findFirst({
          where: {
            id: snapshotId,
            mathematicalArtifactSha256: expectedHash,
            mathematicalBundleManifestSha256: expectedBundleHash,
            trustStatus: "TRUSTED",
          },
        });
        if (!row) {
          throw new AiGraderMathematicalCalibrationSnapshotServiceError(
            "AI_GRADER_MATHEMATICAL_CALIBRATION_STATE_CONFLICT",
            "Trusted calibration snapshot could not be reread.",
          );
        }
        return assertRowMatches(row, (await verifyRowStorage(row)).verified, "TRUSTED");
      });
    },

    async revoke(
      input: RevokeAiGraderMathematicalCalibrationSnapshotV1Input,
    ): Promise<AiGraderMathematicalCalibrationSnapshotRow> {
      const snapshotId = text(input.snapshotId, "snapshotId");
      const expectedHash = sha256(input.expectedArtifactSha256, "expectedArtifactSha256");
      const expectedBundleHash = sha256(
        input.expectedBundleManifestSha256,
        "expectedBundleManifestSha256",
      );
      const revokedByOperatorId = text(input.revokedByOperatorId, "revokedByOperatorId");
      const reason = text(input.reason, "reason", 1024);
      const revokedAt = exactNow();
      return db.$transaction(async (tx) => {
        const updated = await tx.calibrationSnapshot.updateMany({
          where: {
            id: snapshotId,
            calibrationType: "MATHEMATICAL_GRADING_V1",
            mathematicalArtifactSha256: expectedHash,
            mathematicalBundleManifestSha256: expectedBundleHash,
            trustStatus: "TRUSTED",
          },
          data: { trustStatus: "REVOKED", revokedAt, revokedByOperatorId, revocationReason: reason },
        });
        if (updated.count !== 1) {
          throw new AiGraderMathematicalCalibrationSnapshotServiceError(
            "AI_GRADER_MATHEMATICAL_CALIBRATION_EXACT_SNAPSHOT_NOT_FOUND",
            "No exact trusted calibration snapshot matched id, artifact SHA-256, and complete bundle manifest SHA-256.",
          );
        }
        const row = await tx.calibrationSnapshot.findFirst({
          where: {
            id: snapshotId,
            mathematicalArtifactSha256: expectedHash,
            mathematicalBundleManifestSha256: expectedBundleHash,
            trustStatus: "REVOKED",
          },
        });
        if (!row) {
          throw new AiGraderMathematicalCalibrationSnapshotServiceError(
            "AI_GRADER_MATHEMATICAL_CALIBRATION_STATE_CONFLICT",
            "Revoked calibration snapshot could not be reread.",
          );
        }
        return row;
      });
    },

    async supersede(
      input: SupersedeAiGraderMathematicalCalibrationSnapshotV1Input,
    ): Promise<AiGraderMathematicalCalibrationSnapshotRow> {
      const priorSnapshotId = text(input.priorSnapshotId, "priorSnapshotId");
      const replacementSnapshotId = text(input.replacementSnapshotId, "replacementSnapshotId");
      if (priorSnapshotId === replacementSnapshotId) {
        invalid("replacementSnapshotId", "must differ from priorSnapshotId");
      }
      const priorHash = sha256(input.expectedPriorArtifactSha256, "expectedPriorArtifactSha256");
      const priorBundleHash = sha256(
        input.expectedPriorBundleManifestSha256,
        "expectedPriorBundleManifestSha256",
      );
      const replacementHash = sha256(
        input.expectedReplacementArtifactSha256,
        "expectedReplacementArtifactSha256",
      );
      const replacementBundleHash = sha256(
        input.expectedReplacementBundleManifestSha256,
        "expectedReplacementBundleManifestSha256",
      );
      const actor = text(input.supersededByOperatorId, "supersededByOperatorId");
      const reason = text(input.reason, "reason", 1024);
      const transitionAt = exactNow();
      return db.$transaction(async (tx) => {
        const prior = await tx.calibrationSnapshot.findFirst({
          where: {
            id: priorSnapshotId,
            calibrationType: "MATHEMATICAL_GRADING_V1",
            mathematicalArtifactSha256: priorHash,
            mathematicalBundleManifestSha256: priorBundleHash,
            trustStatus: "TRUSTED",
            supersededById: null,
          },
        });
        const replacement = await tx.calibrationSnapshot.findFirst({
          where: {
            id: replacementSnapshotId,
            calibrationType: "MATHEMATICAL_GRADING_V1",
            mathematicalArtifactSha256: replacementHash,
            mathematicalBundleManifestSha256: replacementBundleHash,
            trustStatus: "DRAFT",
          },
        });
        if (!prior || !replacement || prior.rigId !== replacement.rigId) {
          throw new AiGraderMathematicalCalibrationSnapshotServiceError(
            "AI_GRADER_MATHEMATICAL_CALIBRATION_EXACT_SNAPSHOT_NOT_FOUND",
            "Exact same-rig trusted prior and draft replacement calibration snapshots are required.",
          );
        }
        await verifyRowStorage(replacement);
        if (transitionAt.getTime() <= date(prior.trustedAt, "prior.trustedAt").getTime() ||
            transitionAt.getTime() < date(replacement.validityStartsAt, "replacement.validityStartsAt").getTime()) {
          invalid("transitionAt", "must follow prior trust and replacement validity start");
        }
        const promoted = await tx.calibrationSnapshot.updateMany({
          where: {
            id: replacementSnapshotId,
            mathematicalArtifactSha256: replacementHash,
            mathematicalBundleManifestSha256: replacementBundleHash,
            trustStatus: "DRAFT",
          },
          data: { trustStatus: "TRUSTED", trustedAt: transitionAt, trustedByOperatorId: actor },
        });
        if (promoted.count !== 1) {
          throw new AiGraderMathematicalCalibrationSnapshotServiceError(
            "AI_GRADER_MATHEMATICAL_CALIBRATION_STATE_CONFLICT",
            "Replacement calibration changed before trust completed.",
          );
        }
        const closed = await tx.calibrationSnapshot.updateMany({
          where: {
            id: priorSnapshotId,
            mathematicalArtifactSha256: priorHash,
            mathematicalBundleManifestSha256: priorBundleHash,
            trustStatus: "TRUSTED",
            supersededById: null,
          },
          data: {
            validityEndsAt: transitionAt,
            supersededById: replacementSnapshotId,
            supersededByOperatorId: actor,
            supersessionReason: reason,
          },
        });
        if (closed.count !== 1) {
          throw new AiGraderMathematicalCalibrationSnapshotServiceError(
            "AI_GRADER_MATHEMATICAL_CALIBRATION_STATE_CONFLICT",
            "Prior calibration changed before supersession completed.",
          );
        }
        const row = await tx.calibrationSnapshot.findFirst({
          where: {
            id: replacementSnapshotId,
            mathematicalArtifactSha256: replacementHash,
            mathematicalBundleManifestSha256: replacementBundleHash,
            trustStatus: "TRUSTED",
          },
        });
        if (!row) {
          throw new AiGraderMathematicalCalibrationSnapshotServiceError(
            "AI_GRADER_MATHEMATICAL_CALIBRATION_STATE_CONFLICT",
            "Trusted replacement calibration could not be reread.",
          );
        }
        return row;
      });
    },
  };
}
