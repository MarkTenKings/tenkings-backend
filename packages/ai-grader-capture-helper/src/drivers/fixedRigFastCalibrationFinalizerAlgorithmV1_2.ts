import crypto from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const FIXED_RIG_FAST_CALIBRATION_FINALIZER_ALGORITHM_V1_2 =
  "content-addressed-production-bundle-finalizer-v1.2" as const;
export const FIXED_RIG_FAST_CALIBRATION_FINALIZER_MANIFEST_SCHEMA_V1_2 =
  "ten-kings-fast-calibration-finalizer-algorithm-manifest-v1.2" as const;

export interface FastCalibrationFinalizerExecutableArtifactV1_2 {
  logicalPath: string;
  bytes: Uint8Array;
}

export interface FastCalibrationFinalizerAlgorithmManifestV1_2 {
  schemaVersion: typeof FIXED_RIG_FAST_CALIBRATION_FINALIZER_MANIFEST_SCHEMA_V1_2;
  algorithmVersion: typeof FIXED_RIG_FAST_CALIBRATION_FINALIZER_ALGORITHM_V1_2;
  executableArtifactCount: number;
  executableArtifactLedgerSha256: string;
  runtimeDependencyVersions: {
    node: string;
  };
  runtimeDependencySha256: string;
  manifestSha256: string;
}

const SAFE_LOGICAL_PATH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,511}$/;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function digest(value: Uint8Array | string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashCanonical(value: unknown): string {
  return digest(`${JSON.stringify(canonical(value))}\n`);
}

export function buildFastCalibrationFinalizerAlgorithmManifestV1_2(input: {
  executableArtifacts: readonly FastCalibrationFinalizerExecutableArtifactV1_2[];
  runtimeDependencyVersions?: { node: string };
}): FastCalibrationFinalizerAlgorithmManifestV1_2 {
  if (!Array.isArray(input.executableArtifacts) || input.executableArtifacts.length === 0) {
    throw new Error("Fast calibration finalizer identity requires shipped executable module bytes.");
  }
  const seen = new Set<string>();
  const ledger = input.executableArtifacts.map((artifact) => {
    if (!SAFE_LOGICAL_PATH.test(artifact.logicalPath) || path.isAbsolute(artifact.logicalPath) ||
        artifact.logicalPath.includes("..") || seen.has(artifact.logicalPath) || artifact.bytes.byteLength === 0) {
      throw new Error("Fast calibration finalizer executable artifacts require unique safe logical paths and nonempty bytes.");
    }
    seen.add(artifact.logicalPath);
    return {
      logicalPath: artifact.logicalPath.replace(/\\/g, "/"),
      byteSize: artifact.bytes.byteLength,
      sha256: digest(artifact.bytes),
    };
  }).sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
  const runtimeDependencyVersions = input.runtimeDependencyVersions ?? { node: process.version };
  if (!/^v\d+\.\d+\.\d+/.test(runtimeDependencyVersions.node)) {
    throw new Error("Fast calibration finalizer identity requires the exact Node runtime version.");
  }
  const withoutHash = {
    schemaVersion: FIXED_RIG_FAST_CALIBRATION_FINALIZER_MANIFEST_SCHEMA_V1_2,
    algorithmVersion: FIXED_RIG_FAST_CALIBRATION_FINALIZER_ALGORITHM_V1_2,
    executableArtifactCount: ledger.length,
    executableArtifactLedgerSha256: hashCanonical(ledger),
    runtimeDependencyVersions,
    runtimeDependencySha256: hashCanonical(runtimeDependencyVersions),
  };
  return { ...withoutHash, manifestSha256: hashCanonical(withoutHash) };
}

function collectJavascriptFiles(root: string, prefix: string): FastCalibrationFinalizerExecutableArtifactV1_2[] {
  const files: FastCalibrationFinalizerExecutableArtifactV1_2[] = [];
  const visit = (directory: string, relativeDirectory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const metadata = statSync(absolute);
      if (metadata.isDirectory()) {
        visit(absolute, relative);
      } else if (metadata.isFile() && name.endsWith(".js")) {
        files.push({ logicalPath: `${prefix}/${relative}`, bytes: readFileSync(absolute) });
      }
    }
  };
  visit(root, "");
  return files;
}

const captureHelperPackageRoot = path.resolve(__dirname, "../..");
const sharedEntryPoint = require.resolve("@tenkings/shared");
const sharedPackageRoot = path.resolve(path.dirname(sharedEntryPoint), "..");
const shippedExecutableArtifacts = [
  ...collectJavascriptFiles(__dirname, "capture-helper/dist/drivers"),
  ...collectJavascriptFiles(path.dirname(sharedEntryPoint), "shared/dist"),
  { logicalPath: "capture-helper/package.json", bytes: readFileSync(path.join(captureHelperPackageRoot, "package.json")) },
  { logicalPath: "shared/package.json", bytes: readFileSync(path.join(sharedPackageRoot, "package.json")) },
];

export const FIXED_RIG_FAST_CALIBRATION_FINALIZER_ALGORITHM_MANIFEST_V1_2 =
  buildFastCalibrationFinalizerAlgorithmManifestV1_2({ executableArtifacts: shippedExecutableArtifacts });

export const FIXED_RIG_FAST_CALIBRATION_FINALIZER_V1_2_SHA256 =
  FIXED_RIG_FAST_CALIBRATION_FINALIZER_ALGORITHM_MANIFEST_V1_2.manifestSha256;
