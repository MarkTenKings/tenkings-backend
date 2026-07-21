import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const driversPath = path.join(repoRoot, "packages/ai-grader-capture-helper/dist/drivers/cardGeometry.js");
const require = createRequire(import.meta.url);
const { detectAndNormalizeCardImage } = require(driversPath);

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`${name} is required.`);
  return process.argv[index + 1];
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const artifactPath = path.resolve(argument("--artifact"));
const artifactSha256 = argument("--artifact-sha256").toLowerCase();
const sourcePath = await realpath(path.resolve(argument("--source")));
const side = argument("--side");
if (side !== "front" && side !== "back") throw new Error("--side must be front or back.");
const outputDir = path.resolve(argument("--output-dir"));
const relativeToRepo = path.relative(repoRoot, outputDir);
if (relativeToRepo === "" || (!relativeToRepo.startsWith("..") && !path.isAbsolute(relativeToRepo))) {
  throw new Error("Shadow comparison output must remain outside the repository.");
}
await mkdir(outputDir, { recursive: true });
if ((await readdir(outputDir)).length > 0) throw new Error("Shadow comparison output directory must be empty.");

const artifactBytes = await readFile(artifactPath);
if (sha256(artifactBytes) !== artifactSha256) throw new Error("Provisional artifact SHA-256 mismatch.");
const artifact = JSON.parse(artifactBytes.toString("utf8"));
if (artifact.schemaVersion !== "ten-kings-provisional-mathematical-geometry-v1" || artifact.isCalibrated !== false) {
  throw new Error("Shadow comparison requires an explicitly non-certified provisional geometry artifact.");
}

const correctedPath = path.join(outputDir, `${side}-provisional-undistorted.png`);
const applyResult = spawnSync(
  "python",
  [
    path.join(scriptDir, "apply-provisional-mathematical-geometry-v1.py"),
    artifactPath,
    sourcePath,
    correctedPath,
    "--artifact-sha256",
    artifactSha256,
  ],
  { encoding: "utf8", windowsHide: true },
);
if (applyResult.status !== 0) throw new Error(applyResult.stderr.trim() || "Provisional undistortion failed.");
const derivative = JSON.parse(applyResult.stdout);

const timestamp = new Date().toISOString();
const current = await detectAndNormalizeCardImage({
  sourceImagePath: sourcePath,
  normalizedOutputPath: path.join(outputDir, `${side}-current-normalized.png`),
  detectionPolicy: "captured_evidence_full",
  side,
  sourceImageId: `shadow-${side}-current`,
  sourceFrameId: `shadow-${side}-current`,
  timestamp,
});
const provisional = await detectAndNormalizeCardImage({
  sourceImagePath: correctedPath,
  normalizedOutputPath: path.join(outputDir, `${side}-provisional-normalized.png`),
  detectionPolicy: "captured_evidence_full",
  side,
  sourceImageId: `shadow-${side}-provisional`,
  sourceFrameId: `shadow-${side}-provisional`,
  timestamp,
});
if (!current.rawEvidencePreserved || !provisional.rawEvidencePreserved || !current.normalizedArtifact || !provisional.normalizedArtifact) {
  throw new Error("Both shadow comparison paths must preserve their inputs and produce normalized artifacts.");
}

const report = {
  schemaVersion: "ten-kings-provisional-geometry-shadow-comparison-v1",
  generatedAt: timestamp,
  status: "diagnostic_only_not_production_authority",
  isCalibrated: false,
  side,
  source: { path: sourcePath, sha256: current.rawArtifact.sha256 },
  provisionalArtifact: { path: artifactPath, sha256: artifactSha256 },
  derivative,
  current: { geometry: current.geometry, normalizedArtifact: current.normalizedArtifact },
  provisional: { geometry: provisional.geometry, normalizedArtifact: provisional.normalizedArtifact },
};
const reportPath = path.join(outputDir, "provisional-geometry-shadow-comparison.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
const htmlPath = path.join(outputDir, "provisional-geometry-shadow-comparison.html");
await writeFile(
  htmlPath,
  `<!doctype html><html><head><meta charset="utf-8"><title>Provisional Geometry Shadow Comparison</title><style>body{font-family:Arial,sans-serif;margin:24px}.warning{padding:12px;border:2px solid #a33;background:#fff3f3}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}img{max-width:100%;border:1px solid #888}pre{white-space:pre-wrap}</style></head><body><h1>Provisional Geometry Shadow Comparison</h1><p class="warning">Diagnostic only. Not Production authority. isCalibrated=false.</p><div class="grid"><section><h2>Current normalization</h2><img src="${escapeHtml(path.basename(current.normalizedArtifact.localOutputPath))}"></section><section><h2>Provisional geometry normalization</h2><img src="${escapeHtml(path.basename(provisional.normalizedArtifact.localOutputPath))}"></section></div><h2>Evidence</h2><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></body></html>`,
  { flag: "wx" },
);
console.log(JSON.stringify({ reportPath, htmlPath, sourceSha256: report.source.sha256, artifactSha256 }, null, 2));
