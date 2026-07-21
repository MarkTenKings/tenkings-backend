import crypto from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const FAST_CALIBRATION_FINALIZER_HANDOFF_SCHEMA_V1 =
  "ten-kings-mathematical-calibration-finalizer-handoff-v1" as const;
export const FAST_CALIBRATION_FINALIZER_HANDOFF_AUTHORITY_V1 =
  "trusted-local-mathematical-calibration-finalizer-v1" as const;
export const FAST_CALIBRATION_FINALIZER_HANDOFF_FILE_V1 =
  "mathematical-calibration-finalizer-handoff-v1.json" as const;
export const FAST_CALIBRATION_FINALIZER_BUNDLE_FILE_V1 =
  "mathematical-calibration-bundle-v1.json" as const;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;

export interface FastCalibrationFinalizerHandoffV1_2 {
  schemaVersion: typeof FAST_CALIBRATION_FINALIZER_HANDOFF_SCHEMA_V1;
  authority: typeof FAST_CALIBRATION_FINALIZER_HANDOFF_AUTHORITY_V1;
  rigId: string;
  profileId: string;
  calibrationVersion: string;
  finalizedAt: string;
  bundleFileName: typeof FAST_CALIBRATION_FINALIZER_BUNDLE_FILE_V1;
  bundleManifestSha256: string;
  sourceAnalysisSha256: string;
}

export interface FastCalibrationFinalizerStagingInputV1_2 {
  stagingRoot: string;
  bundleBytes: Buffer;
  bundleManifestSha256: string;
  members: ReadonlyArray<{ fileName: string; sha256: string; bytes: Buffer }>;
  rigId: string;
  profileId: string;
  calibrationVersion: string;
  finalizedAt: string;
  sourceAnalysisSha256: string;
}

export interface FastCalibrationFinalizerStagingReceiptV1_2 {
  bundleManifestSha256: string;
  handoffSha256: string;
  fileCount: 14;
}

function digest(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonical(value), null, 2)}\n`, "utf8");
}

function exactText(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || value.length > 256) {
    throw new Error(`${label} must be exact non-empty text.`);
  }
  return value;
}

function exactSha(value: string, label: string): string {
  if (!SHA256.test(value)) throw new Error(`${label} must be an exact lowercase SHA-256.`);
  return value;
}

async function exists(pathName: string): Promise<boolean> {
  try {
    await stat(pathName);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function validated(input: FastCalibrationFinalizerStagingInputV1_2) {
  if (!path.isAbsolute(input.stagingRoot)) {
    throw new Error("Fast calibration finalizer staging root must be one protected absolute path.");
  }
  const stagingRoot = path.resolve(input.stagingRoot);
  const bundleManifestSha256 = exactSha(input.bundleManifestSha256, "bundleManifestSha256");
  if (!Buffer.isBuffer(input.bundleBytes) || digest(input.bundleBytes) !== bundleManifestSha256) {
    throw new Error("Fast calibration finalizer bundle bytes do not match bundleManifestSha256.");
  }
  if (input.members.length !== 12 || new Set(input.members.map((member) => member.fileName)).size !== 12) {
    throw new Error("Fast calibration finalizer staging requires exactly twelve unique members.");
  }
  const members = input.members.map((member) => {
    if (!SAFE_FILE.test(member.fileName) || member.fileName === FAST_CALIBRATION_FINALIZER_BUNDLE_FILE_V1 ||
        member.fileName === FAST_CALIBRATION_FINALIZER_HANDOFF_FILE_V1) {
      throw new Error("Fast calibration finalizer member file name is unsafe or reserved.");
    }
    exactSha(member.sha256, `member ${member.fileName} SHA-256`);
    if (!Buffer.isBuffer(member.bytes) || digest(member.bytes) !== member.sha256) {
      throw new Error(`Fast calibration finalizer member ${member.fileName} bytes do not match its ledger hash.`);
    }
    return { ...member };
  }).sort((left, right) => left.fileName.localeCompare(right.fileName));
  const finalizedAt = exactText(input.finalizedAt, "finalizedAt");
  if (!Number.isFinite(new Date(finalizedAt).getTime())) throw new Error("Fast calibration finalizedAt is invalid.");
  const handoff: FastCalibrationFinalizerHandoffV1_2 = {
    schemaVersion: FAST_CALIBRATION_FINALIZER_HANDOFF_SCHEMA_V1,
    authority: FAST_CALIBRATION_FINALIZER_HANDOFF_AUTHORITY_V1,
    rigId: exactText(input.rigId, "rigId"),
    profileId: exactText(input.profileId, "profileId"),
    calibrationVersion: exactText(input.calibrationVersion, "calibrationVersion"),
    finalizedAt,
    bundleFileName: FAST_CALIBRATION_FINALIZER_BUNDLE_FILE_V1,
    bundleManifestSha256,
    sourceAnalysisSha256: exactSha(input.sourceAnalysisSha256, "sourceAnalysisSha256"),
  };
  return { stagingRoot, bundleManifestSha256, bundleBytes: input.bundleBytes, members, handoff, handoffBytes: jsonBytes(handoff) };
}

async function verifyDirectory(
  directory: string,
  expected: ReturnType<typeof validated>,
): Promise<FastCalibrationFinalizerStagingReceiptV1_2> {
  const handoffBytes = await readFile(path.join(directory, FAST_CALIBRATION_FINALIZER_HANDOFF_FILE_V1));
  if (!handoffBytes.equals(expected.handoffBytes)) {
    throw new Error("Existing fast calibration finalizer handoff bytes conflict with the exact bundle.");
  }
  const bundleBytes = await readFile(path.join(directory, FAST_CALIBRATION_FINALIZER_BUNDLE_FILE_V1));
  if (!bundleBytes.equals(expected.bundleBytes)) {
    throw new Error("Existing fast calibration staged bundle bytes conflict with the exact bundle hash.");
  }
  for (const member of expected.members) {
    const bytes = await readFile(path.join(directory, member.fileName));
    if (!bytes.equals(member.bytes) || digest(bytes) !== member.sha256) {
      throw new Error(`Existing fast calibration staged member ${member.fileName} conflicts with its exact ledger bytes.`);
    }
  }
  const entries = await readdir(directory);
  const expectedNames = new Set([
    FAST_CALIBRATION_FINALIZER_BUNDLE_FILE_V1,
    FAST_CALIBRATION_FINALIZER_HANDOFF_FILE_V1,
    ...expected.members.map((member) => member.fileName),
  ]);
  if (entries.length !== 14 || entries.some((entry) => !expectedNames.has(entry))) {
    throw new Error("Existing fast calibration finalizer staging directory has unexpected or missing files.");
  }
  return {
    bundleManifestSha256: expected.bundleManifestSha256,
    handoffSha256: digest(handoffBytes),
    fileCount: 14,
  };
}

export async function stageFastCalibrationFinalizerHandoffV1_2(
  input: FastCalibrationFinalizerStagingInputV1_2,
): Promise<FastCalibrationFinalizerStagingReceiptV1_2> {
  const expected = validated(input);
  const finalDirectory = path.join(expected.stagingRoot, expected.bundleManifestSha256);
  if (path.dirname(finalDirectory) !== expected.stagingRoot) {
    throw new Error("Fast calibration finalizer directory escaped its protected staging root.");
  }
  if (await exists(finalDirectory)) return verifyDirectory(finalDirectory, expected);

  await mkdir(expected.stagingRoot, { recursive: true });
  const temporaryDirectory = path.join(
    expected.stagingRoot,
    `.finalizer-handoff-${expected.bundleManifestSha256}-${crypto.randomUUID()}`,
  );
  const relativeTemporary = path.relative(expected.stagingRoot, temporaryDirectory);
  if (!relativeTemporary || relativeTemporary.startsWith("..") || path.isAbsolute(relativeTemporary)) {
    throw new Error("Fast calibration finalizer temporary directory escaped its protected staging root.");
  }
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    await writeFile(path.join(temporaryDirectory, FAST_CALIBRATION_FINALIZER_BUNDLE_FILE_V1), input.bundleBytes, { flag: "wx" });
    for (const member of expected.members) {
      await writeFile(path.join(temporaryDirectory, member.fileName), member.bytes, { flag: "wx" });
    }
    await writeFile(path.join(temporaryDirectory, FAST_CALIBRATION_FINALIZER_HANDOFF_FILE_V1), expected.handoffBytes, { flag: "wx" });
    await verifyDirectory(temporaryDirectory, expected);
    try {
      await rename(temporaryDirectory, finalDirectory);
    } catch (error) {
      if (!await exists(finalDirectory)) throw error;
      await verifyDirectory(finalDirectory, expected);
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    return verifyDirectory(finalDirectory, expected);
  } catch (error) {
    if (await exists(temporaryDirectory)) await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyFastCalibrationFinalizerHandoffV1_2(
  input: FastCalibrationFinalizerStagingInputV1_2,
): Promise<FastCalibrationFinalizerStagingReceiptV1_2> {
  const expected = validated(input);
  return verifyDirectory(path.join(expected.stagingRoot, expected.bundleManifestSha256), expected);
}
