import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const THRESHOLD_SET_ID = "ten-kings-mathematical-grading-v1.1.0";
const THRESHOLD_SET_HASH = "d6e3e6772436544d4a434fc0a6f1e93150fb17507020097c8e9ec10af66dc989";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function requireArg(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required.`);
  return path.resolve(value);
}

const analysisPath = requireArg("--analysis");
const outputPath = requireArg("--out");
const analysisBytes = fs.readFileSync(analysisPath);
const analysis = JSON.parse(analysisBytes.toString("utf8"));
if (analysis.schemaVersion !== "ten-kings-mathematical-calibration-analysis-v1.1" || analysis.contractVersion !== "1.1.0") {
  throw new Error("Only the Mathematical Calibration V1.1 analysis schema may be finalized.");
}
if (analysis.thresholdSetId !== THRESHOLD_SET_ID || analysis.thresholdSetHash !== THRESHOLD_SET_HASH) {
  throw new Error("V1.1 finalizer threshold identity/hash mismatch.");
}
if (analysis.validationOnly === true) {
  throw new Error("Validation-only replay evidence cannot finalize a calibration bundle.");
}
if (analysis.acceptance?.accepted !== true) {
  throw new Error(`Mathematical Calibration V1.1 acceptance is fail-closed: ${(analysis.acceptance?.reasons ?? ["unknown failure"]).join("; ")}`);
}
if (analysis.captureCounts?.totalImageCaptures !== 76) {
  throw new Error("Mathematical Calibration V1.1 requires exactly 76 image captures.");
}

const result = {
  schemaVersion: "ten-kings-mathematical-calibration-profile-v1.1",
  contractVersion: "1.1.0",
  thresholdSetId: THRESHOLD_SET_ID,
  thresholdSetHash: THRESHOLD_SET_HASH,
  algorithmVersion: analysis.algorithmVersion,
  isCalibrated: true,
  acceptance: analysis.acceptance,
  captureCounts: analysis.captureCounts,
  poseDiversity: analysis.poseDiversity,
  leaveOnePoseOut: analysis.leaveOnePoseOut,
  sourceAnalysis: {
    path: analysisPath,
    sha256: sha256(analysisBytes),
  },
};
const outputBytes = Buffer.from(`${JSON.stringify(canonical(result), null, 2)}\n`, "utf8");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, outputBytes, { flag: "wx" });
process.stdout.write(JSON.stringify({
  ok: true,
  output: outputPath,
  sha256: sha256(outputBytes),
  isCalibrated: true,
  thresholdSetId: THRESHOLD_SET_ID,
  thresholdSetHash: THRESHOLD_SET_HASH,
}, null, 2) + "\n");
