#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  buildMathematicalCalibrationAcceptanceV1,
  verifyMathematicalCalibrationAnalysisV1,
} from "./finalize-mathematical-calibration-v1.mjs";

const modulePath = fileURLToPath(import.meta.url);
const moduleDir = path.dirname(modulePath);
const repoRoot = path.resolve(moduleDir, "../..");
const require = createRequire(import.meta.url);
const shared = require(path.join(repoRoot, "packages/shared/dist/index.js"));
const { buildFixedRigPhysicalCalibrationV1 } = require(
  path.join(repoRoot, "packages/ai-grader-capture-helper/dist/drivers/fixedRigPhysicalCalibrationV1.js"),
);
const { verifyProductOwnerOperationalAcceptanceV1 } = require(
  path.join(repoRoot, "packages/ai-grader-capture-helper/dist/drivers/productOwnerOperationalAcceptanceV1.js"),
);

const INCIDENT = shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_INCIDENT;
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]))
    : value;

function argumentsV1(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--session-dir") result.sessionDir = argv[++index];
    else if (key === "--analysis") result.analysisPath = argv[++index];
    else if (key === "--output") result.outputPath = argv[++index];
    else if (key === "--help" || key === "-h") return { help: true };
    else throw new Error(`Unknown or incomplete option: ${key ?? "(missing)"}`);
  }
  if (!result.sessionDir || !result.analysisPath || !result.outputPath) {
    throw new Error("--session-dir, --analysis, and --output are required.");
  }
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, path.resolve(value)]));
}

function manifestReferences(value, output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => manifestReferences(entry, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (typeof value.path === "string" && typeof value.sha256 === "string") {
    output.push({ path: value.path, sha256: value.sha256 });
  }
  Object.values(value).forEach((entry) => manifestReferences(entry, output));
  return output;
}

function safeMember(root, relative, label) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a relative session path.`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relative.split("/"));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`${label} escaped the session.`);
  return resolved;
}

export function assertOperationalAcceptanceAnalysisSourceAuthorityV1(analysis) {
  if (
    analysis.analysisSha256 !== INCIDENT.analysisSha256 ||
    analysis.sourceManifestSha256 !== INCIDENT.sourceCaptureManifestSha256 ||
    analysis.sourceCapturePackage?.manifestSha256 !== INCIDENT.sourceCapturePackageSha256 ||
    analysis.sourceCapturePackage?.stationAuthority?.sessionId !== INCIDENT.sessionId ||
    analysis.sourceCapturePackage?.thresholdSetHash !== INCIDENT.thresholdSetHash
  ) throw new Error("Operational acceptance analysis does not reproduce the exact source authority.");
}

async function main() {
  const parsed = argumentsV1(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(
      "Usage: node scripts/ai-grader/create-product-owner-operational-acceptance-v1.mjs " +
      "--session-dir <exact-session> --analysis <exact-analysis.json> --output <new-authority.json>\n",
    );
    return;
  }
  if (path.basename(parsed.sessionDir) !== INCIDENT.sessionId) {
    throw new Error("Operational acceptance is product-bound to the exact preserved session.");
  }
  const stateBytes = await readFile(path.join(parsed.sessionDir, "capture-session.json"));
  const manifestBytes = await readFile(path.join(parsed.sessionDir, "capture-manifest.json"));
  const packageBytes = await readFile(path.join(parsed.sessionDir, "source-capture-package.json"));
  if (
    sha256(stateBytes) !== INCIDENT.sessionStateSha256 ||
    sha256(manifestBytes) !== INCIDENT.sourceCaptureManifestSha256 ||
    sha256(packageBytes) !== INCIDENT.sourceCapturePackageSha256
  ) throw new Error("Operational acceptance session state, manifest, or package identity does not match.");
  const state = JSON.parse(stateBytes.toString("utf8"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    state.sessionId !== INCIDENT.sessionId || !state.sealedAt || state.hardStop !== undefined ||
    state.captures?.length !== 102 || state.artifacts?.length !== 283 ||
    state.measurements?.length !== 78 || state.failedOperations?.length !== 2
  ) throw new Error("Operational acceptance requires the exact healthy resealed capture ledger.");
  for (const artifact of state.artifacts) {
    const bytes = await readFile(safeMember(parsed.sessionDir, artifact.path, "artifact path"));
    if (bytes.length !== artifact.byteSize || sha256(bytes) !== artifact.sha256) {
      throw new Error(`Operational acceptance artifact ${artifact.path} failed exact verification.`);
    }
  }
  const references = manifestReferences(manifest);
  if (references.length !== 183) throw new Error("Operational acceptance manifest must contain exactly 183 references.");
  for (const reference of references) {
    const bytes = await readFile(safeMember(parsed.sessionDir, reference.path, "manifest reference path"));
    if (sha256(bytes) !== reference.sha256) {
      throw new Error(`Operational acceptance manifest reference ${reference.path} failed verification.`);
    }
  }
  const analysisBytes = await readFile(parsed.analysisPath);
  if (sha256(analysisBytes) !== INCIDENT.analysisFileSha256) {
    throw new Error("Operational acceptance requires the exact certified analysis file.");
  }
  const analysis = verifyMathematicalCalibrationAnalysisV1(JSON.parse(analysisBytes.toString("utf8")));
  assertOperationalAcceptanceAnalysisSourceAuthorityV1(analysis);
  const result = buildFixedRigPhysicalCalibrationV1(analysis.builderInput);
  if (result.status !== "rejected" || result.isCalibrated || !result.operationalProfileCandidate ||
      result.artifact.artifactSha256 !== INCIDENT.physicalArtifactSha256 ||
      result.issues.length !== INCIDENT.exceptionCount) {
    throw new Error("Operational acceptance requires the exact unchanged mathematical rejection.");
  }
  const mathematicalAcceptance = buildMathematicalCalibrationAcceptanceV1(analysis, result);
  const mathematicalAcceptanceBytes = Buffer.from(`${JSON.stringify(mathematicalAcceptance, null, 2)}\n`, "utf8");
  if (sha256(mathematicalAcceptanceBytes) !== INCIDENT.mathematicalAcceptanceFileSha256) {
    throw new Error("Operational acceptance mathematical rejection bytes do not reproduce.");
  }
  const finalizerPath = path.join(moduleDir, "finalize-mathematical-calibration-v1.mjs");
  const implementation = {
    contractVersion: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_CONTRACT_VERSION,
    implementationGitSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    finalizerSha256: sha256(await readFile(finalizerPath)),
    authorityProducerSha256: sha256(await readFile(modulePath)),
    nodeRuntimeVersion: process.version,
  };
  const withoutHash = {
    schemaVersion: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_SCHEMA_VERSION,
    authorityId: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_AUTHORITY_ID,
    authorityStatus: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_STATUS,
    hashPolicy: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_HASH_POLICY,
    owner: {
      name: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_NAME,
      organization: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_OWNER_ORGANIZATION,
      role: "product_owner",
    },
    decisionAt: new Date().toISOString(),
    reason: shared.PRODUCT_OWNER_OPERATIONAL_ACCEPTANCE_V1_REASON,
    subject: {
      sessionId: INCIDENT.sessionId,
      sessionStateSha256: INCIDENT.sessionStateSha256,
      sourceCaptureManifestSha256: INCIDENT.sourceCaptureManifestSha256,
      sourceCapturePackageSha256: INCIDENT.sourceCapturePackageSha256,
      analysisSha256: INCIDENT.analysisSha256,
      analysisFileSha256: INCIDENT.analysisFileSha256,
      thresholdSetHash: INCIDENT.thresholdSetHash,
      physicalArtifactSha256: INCIDENT.physicalArtifactSha256,
      mathematicalAcceptanceFileSha256: INCIDENT.mathematicalAcceptanceFileSha256,
      mathematicalAcceptanceStatus: "rejected",
      mathematicalIsCalibrated: false,
      rigId: INCIDENT.rigId,
      profileId: result.operationalProfileCandidate.profileId,
      calibrationVersion: result.operationalProfileCandidate.calibrationVersion,
      finalizedAt: result.operationalProfileCandidate.finalizedAt,
      artifactId: result.operationalProfileCandidate.artifactId,
    },
    exceptionLedger: result.issues,
    exceptionLedgerSha256: sha256(Buffer.from(
      shared.canonicalProductOwnerOperationalAcceptanceIssueLedgerV1(result.issues),
      "utf8",
    )),
    implementation,
    lifecycle: {
      sequence: 1,
      priorAuthoritySha256: null,
      revokedByAuthoritySha256: null,
      supersededByAuthoritySha256: null,
    },
  };
  const authority = verifyProductOwnerOperationalAcceptanceV1({
    ...withoutHash,
    authoritySha256: sha256(Buffer.from(JSON.stringify(canonical(withoutHash)), "utf8")),
  }, implementation);
  await writeFile(parsed.outputPath, `${JSON.stringify(authority, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: authority.schemaVersion,
    authorityStatus: authority.authorityStatus,
    authoritySha256: authority.authoritySha256,
    exceptionLedgerSha256: authority.exceptionLedgerSha256,
    exceptionCount: authority.exceptionLedger.length,
    decisionAt: authority.decisionAt,
    output: parsed.outputPath,
  })}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === modulePath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
