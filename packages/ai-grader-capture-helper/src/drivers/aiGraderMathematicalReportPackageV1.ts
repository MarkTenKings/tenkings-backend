import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AI_GRADER_REPORT_BUNDLE_V03_VERSION,
  aiGraderReportBundleV03Schema,
  type AiGraderReportBundleV03,
} from "@tenkings/shared";
import type {
  AiGraderMathematicalReportAssetPayloadV1,
  AiGraderMathematicalReportBundleV1Artifact,
} from "./aiGraderMathematicalReportBundleV1";

export const AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_V1_VERSION =
  "ai-grader-mathematical-report-envelope-v1" as const;
export const AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_V1_VERSION =
  "ai-grader-mathematical-report-package-v1" as const;
export const AI_GRADER_MATHEMATICAL_REPORT_CHECKSUMS_V1_VERSION =
  "ai-grader-mathematical-report-checksums-v1" as const;
export const AI_GRADER_MATHEMATICAL_PRODUCTION_RELEASE_V1_VERSION =
  "ai-grader-mathematical-production-release-v1" as const;

export const AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_DIR = "mathematical-v1" as const;
export const AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE = "report-bundle-v0.3.json" as const;
export const AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE = "report-envelope-v1.json" as const;
export const AI_GRADER_MATHEMATICAL_REPORT_ASSET_MANIFEST_FILE = "asset-manifest-v0.3.json" as const;
export const AI_GRADER_MATHEMATICAL_REPORT_CHECKSUMS_FILE = "checksums-v0.3.json" as const;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface AiGraderMathematicalReportEnvelopeV1 {
  schemaVersion: typeof AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_V1_VERSION;
  gradingSessionId: string;
  reportBundle: AiGraderReportBundleV03;
}

export interface AiGraderMathematicalAssetPayloadTransportV1 {
  id: string;
  contentType: string;
  sha256: string;
  byteSize: number;
  bodyBase64: string;
}

export interface AiGraderMathematicalReportPackageAssetV1 {
  id: string;
  relativePath: string;
  contentType: string;
  sha256: string;
  byteSize: number;
}

export interface AiGraderMathematicalReportPackageManifestV1 {
  schemaVersion: typeof AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_V1_VERSION;
  gradingSessionId: string;
  reportId: string;
  reportBundleSchemaVersion: typeof AI_GRADER_REPORT_BUNDLE_V03_VERSION;
  reportBundleFile: typeof AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE;
  reportEnvelopeFile: typeof AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE;
  assets: AiGraderMathematicalReportPackageAssetV1[];
}

export interface AiGraderMathematicalReportChecksumsV1 {
  schemaVersion: typeof AI_GRADER_MATHEMATICAL_REPORT_CHECKSUMS_V1_VERSION;
  gradingSessionId: string;
  reportId: string;
  files: Array<{ relativePath: string; sha256: string; byteSize: number }>;
}

export interface AiGraderMathematicalReportPackageV1 {
  outputDir: string;
  bundlePath: string;
  envelopePath: string;
  assetManifestPath: string;
  checksumsPath: string;
  envelope: AiGraderMathematicalReportEnvelopeV1;
  assetManifest: AiGraderMathematicalReportPackageManifestV1;
  checksums: AiGraderMathematicalReportChecksumsV1;
}

export interface AiGraderMathematicalProductionReleaseV1 {
  schemaVersion: typeof AI_GRADER_MATHEMATICAL_PRODUCTION_RELEASE_V1_VERSION;
  generatedAt: string;
  gradingSessionId: string;
  reportId: string;
  reportStatus: "final_ai_grader_report_v1";
  finalStatus: "final_grade_computed";
  finalGradeComputed: true;
  certifiedClaim: false;
  certificateGenerated: false;
  labelDataGenerated: true;
  qrPayloadGenerated: true;
  gates: Array<{
    id: string;
    label: string;
    status: "pass";
    reason: string;
    evidenceRefs: string[];
  }>;
  finalGrade: AiGraderReportBundleV03["productionRelease"]["finalGrade"];
  operatorFinalization: {
    operatorId: string;
    finalizedAt: string;
    warningsAccepted: boolean;
    overrideReason?: string;
    acceptedWarningGateIds: string[];
  };
  publication: {
    status: "local_bundle_ready";
    reportId: string;
    publicReportUrl: string;
    qrPayloadUrl: string;
    storageMode: "local_artifact_only";
    dbWritesPerformed: false;
    migrationsRun: false;
    uploadPerformed: false;
    storageKeyPrefix: string;
    reportBundlePath: string;
    productionReleasePath?: string;
    labelDataPath?: string;
    requiredFutureProductionSteps: string[];
  };
  label: AiGraderReportBundleV03["productionRelease"]["label"] & {
    status: "label_data_ready";
    labelVersion: "ten-kings-ai-grader-label-v1";
    reportId: string;
    certificateStatus: "report_id_issued_not_certified";
    elementScores: Record<"centering" | "corners" | "edges" | "surface", number>;
    cardIdentity: AiGraderReportBundleV03["cardIdentity"];
    certifiedClaim: false;
  };
  cardIdentity: AiGraderReportBundleV03["cardIdentity"];
  calibrationProfile: AiGraderReportBundleV03["calibrationProfile"];
  evidenceReferences: {
    publicAssetIds: string[];
    findingIds: string[];
    deductionLedgerFindingIds: string[];
  };
  cardInventoryLinkage: {
    status: "contract_ready_not_persisted" | "needs_card_linkage";
    cardAssetId?: string;
    itemId?: string;
    note: string;
  };
  databaseIntegration: {
    migrationsRun: false;
    productionDbWritesPerformed: false;
  };
  storageIntegration: {
    mode: "local_bundle_only";
    uploadPerformed: false;
    storageKeyPrefix: string;
  };
  warnings: string[];
  limitations: string[];
}

export interface AiGraderMathematicalProductionReleaseWriteResultV1 {
  productionRelease: AiGraderMathematicalProductionReleaseV1;
  productionReleasePath: string;
  labelDataPath: string;
  publicationManifestPath: string;
  integrationContractPath: string;
  releaseChecksumsPath: string;
  outputDir: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertSafeIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (!SAFE_ID.test(normalized)) throw new Error(`${label} must be a safe non-empty identifier.`);
  return normalized;
}

function isSubpath(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertRelativePackagePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized || path.isAbsolute(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Mathematical report package contains an unsafe relative path.");
  }
  return normalized;
}

function safeAssetFileName(index: number, id: string, fileName: string | undefined): string {
  const candidate = (fileName ?? "evidence.bin").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160) || "evidence.bin";
  return `${String(index + 1).padStart(4, "0")}-${sha256(Buffer.from(id)).slice(0, 12)}-${candidate}`;
}

function parseEnvelope(value: unknown): AiGraderMathematicalReportEnvelopeV1 {
  if (!isRecord(value) || value.schemaVersion !== AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_V1_VERSION) {
    throw new Error("Mathematical Grading V1 requires an explicit V0.3 report envelope.");
  }
  const gradingSessionId = assertSafeIdentity(String(value.gradingSessionId ?? ""), "gradingSessionId");
  const parsed = aiGraderReportBundleV03Schema.safeParse(value.reportBundle);
  if (!parsed.success) {
    throw new Error(`Mathematical Grading V1 report is not ready: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return {
    schemaVersion: AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_V1_VERSION,
    gradingSessionId,
    reportBundle: parsed.data,
  };
}

export function buildAiGraderMathematicalReportEnvelopeV1(input: {
  gradingSessionId: string;
  reportBundle: unknown;
}): AiGraderMathematicalReportEnvelopeV1 {
  return parseEnvelope({
    schemaVersion: AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_V1_VERSION,
    gradingSessionId: input.gradingSessionId,
    reportBundle: input.reportBundle,
  });
}

export function decodeAiGraderMathematicalAssetPayloadsV1(
  payloads: readonly AiGraderMathematicalAssetPayloadTransportV1[],
): AiGraderMathematicalReportAssetPayloadV1[] {
  if (!Array.isArray(payloads)) throw new Error("Mathematical Grading V1 asset payloads must be an array.");
  const seen = new Set<string>();
  return payloads.map((payload) => {
    if (!isRecord(payload)) throw new Error("Mathematical Grading V1 asset payload is malformed.");
    const id = String(payload.id ?? "").trim();
    const key = id.toLowerCase();
    if (!id || seen.has(key)) throw new Error(`Mathematical Grading V1 asset payload ID ${id || "(missing)"} is invalid or duplicated.`);
    seen.add(key);
    const expectedHash = String(payload.sha256 ?? "").toLowerCase();
    const expectedSize = Number(payload.byteSize);
    const contentType = String(payload.contentType ?? "");
    const bodyBase64 = String(payload.bodyBase64 ?? "").replace(/\s/g, "");
    const bytes = Buffer.from(bodyBase64, "base64");
    if (!SHA256.test(expectedHash) || !Number.isSafeInteger(expectedSize) || expectedSize < 0 || !contentType ||
      bytes.toString("base64") !== bodyBase64 || bytes.byteLength !== expectedSize || sha256(bytes) !== expectedHash) {
      throw new Error(`Mathematical Grading V1 asset payload ${id} failed immutable hash/size validation.`);
    }
    return { id, contentType, sha256: expectedHash, byteSize: expectedSize, bytes };
  });
}

function validateArtifact(input: {
  gradingSessionId: string;
  artifact: AiGraderMathematicalReportBundleV1Artifact;
}): { envelope: AiGraderMathematicalReportEnvelopeV1; payloads: AiGraderMathematicalReportAssetPayloadV1[] } {
  const envelope = buildAiGraderMathematicalReportEnvelopeV1({
    gradingSessionId: input.gradingSessionId,
    reportBundle: input.artifact.bundle,
  });
  const publicAssets = new Map(envelope.reportBundle.publicAssets.map((asset) => [asset.id.toLowerCase(), asset]));
  const payloads = new Map<string, AiGraderMathematicalReportAssetPayloadV1>();
  for (const payload of input.artifact.assetPayloads) {
    const key = payload.id.toLowerCase();
    if (payloads.has(key)) throw new Error(`Duplicate Mathematical Grading V1 asset payload ${payload.id}.`);
    const asset = publicAssets.get(key);
    const bytes = Buffer.from(payload.bytes);
    if (!asset || !asset.sha256 || asset.sha256.toLowerCase() !== payload.sha256.toLowerCase() ||
      asset.byteSize !== payload.byteSize || asset.contentType !== payload.contentType ||
      bytes.byteLength !== payload.byteSize || sha256(bytes) !== payload.sha256.toLowerCase()) {
      throw new Error(`Mathematical Grading V1 asset payload ${payload.id} does not match its strict public asset.`);
    }
    payloads.set(key, { ...payload, sha256: payload.sha256.toLowerCase(), bytes });
  }
  for (const asset of envelope.reportBundle.publicAssets) {
    if (!payloads.has(asset.id.toLowerCase())) {
      throw new Error(`Mathematical Grading V1 report is not ready: immutable bytes are missing for public asset ${asset.id}.`);
    }
  }
  if (payloads.size !== publicAssets.size) {
    throw new Error("Mathematical Grading V1 report contains an asset payload not declared by the strict V0.3 body.");
  }
  return { envelope, payloads: [...payloads.values()] };
}

async function writeExclusive(filePath: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes, { flag: "wx" });
}

function sameStrictBundle(left: AiGraderReportBundleV03, right: AiGraderReportBundleV03): boolean {
  return sha256(jsonBytes(left)) === sha256(jsonBytes(right));
}

export async function writeAiGraderMathematicalReportPackageV1(input: {
  gradingSessionId: string;
  artifact: AiGraderMathematicalReportBundleV1Artifact;
  outputDir: string;
}): Promise<AiGraderMathematicalReportPackageV1> {
  const outputDir = path.resolve(input.outputDir);
  const validated = validateArtifact(input);
  if (await pathExists(outputDir)) {
    const existing = await readAiGraderMathematicalReportPackageV1(outputDir);
    if (existing.envelope.gradingSessionId !== validated.envelope.gradingSessionId ||
      !sameStrictBundle(existing.envelope.reportBundle, validated.envelope.reportBundle)) {
      throw new Error("Refusing to overwrite an existing Mathematical Grading V1 report package with different immutable evidence.");
    }
    return existing;
  }

  const parentDir = path.dirname(outputDir);
  await mkdir(parentDir, { recursive: true });
  const stagingDir = path.join(parentDir, `.${path.basename(outputDir)}.staging-${randomUUID()}`);
  if (!isSubpath(stagingDir, parentDir)) throw new Error("Mathematical report staging path escaped its package root.");
  await mkdir(stagingDir, { recursive: false });

  const sortedAssets = [...validated.envelope.reportBundle.publicAssets].sort((a, b) => a.id.localeCompare(b.id));
  const payloadById = new Map(validated.payloads.map((payload) => [payload.id.toLowerCase(), payload]));
  const packageAssets: AiGraderMathematicalReportPackageAssetV1[] = [];
  const checkedFiles: Array<{ relativePath: string; sha256: string; byteSize: number }> = [];
  for (const [index, asset] of sortedAssets.entries()) {
    const payload = payloadById.get(asset.id.toLowerCase())!;
    const relativePath = `assets/${safeAssetFileName(index, asset.id, asset.fileName)}`;
    const bytes = Buffer.from(payload.bytes);
    await writeExclusive(path.join(stagingDir, ...relativePath.split("/")), bytes);
    packageAssets.push({
      id: asset.id,
      relativePath,
      contentType: payload.contentType,
      sha256: payload.sha256,
      byteSize: payload.byteSize,
    });
    checkedFiles.push({ relativePath, sha256: payload.sha256, byteSize: payload.byteSize });
  }

  const bundleBytes = jsonBytes(validated.envelope.reportBundle);
  const envelopeBytes = jsonBytes(validated.envelope);
  const assetManifest: AiGraderMathematicalReportPackageManifestV1 = {
    schemaVersion: AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_V1_VERSION,
    gradingSessionId: validated.envelope.gradingSessionId,
    reportId: validated.envelope.reportBundle.reportId,
    reportBundleSchemaVersion: AI_GRADER_REPORT_BUNDLE_V03_VERSION,
    reportBundleFile: AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE,
    reportEnvelopeFile: AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE,
    assets: packageAssets,
  };
  const assetManifestBytes = jsonBytes(assetManifest);
  await writeExclusive(path.join(stagingDir, AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE), bundleBytes);
  await writeExclusive(path.join(stagingDir, AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE), envelopeBytes);
  await writeExclusive(path.join(stagingDir, AI_GRADER_MATHEMATICAL_REPORT_ASSET_MANIFEST_FILE), assetManifestBytes);
  checkedFiles.push(
    { relativePath: AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE, sha256: sha256(bundleBytes), byteSize: bundleBytes.byteLength },
    { relativePath: AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE, sha256: sha256(envelopeBytes), byteSize: envelopeBytes.byteLength },
    { relativePath: AI_GRADER_MATHEMATICAL_REPORT_ASSET_MANIFEST_FILE, sha256: sha256(assetManifestBytes), byteSize: assetManifestBytes.byteLength },
  );
  const checksums: AiGraderMathematicalReportChecksumsV1 = {
    schemaVersion: AI_GRADER_MATHEMATICAL_REPORT_CHECKSUMS_V1_VERSION,
    gradingSessionId: validated.envelope.gradingSessionId,
    reportId: validated.envelope.reportBundle.reportId,
    files: checkedFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  };
  await writeExclusive(path.join(stagingDir, AI_GRADER_MATHEMATICAL_REPORT_CHECKSUMS_FILE), jsonBytes(checksums));
  await rename(stagingDir, outputDir);
  return readAiGraderMathematicalReportPackageV1(outputDir);
}

function parseAssetManifest(value: unknown): AiGraderMathematicalReportPackageManifestV1 {
  if (!isRecord(value) || value.schemaVersion !== AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_V1_VERSION ||
    value.reportBundleSchemaVersion !== AI_GRADER_REPORT_BUNDLE_V03_VERSION ||
    value.reportBundleFile !== AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE ||
    value.reportEnvelopeFile !== AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE || !Array.isArray(value.assets)) {
    throw new Error("Mathematical Grading V1 asset manifest is malformed.");
  }
  const gradingSessionId = assertSafeIdentity(String(value.gradingSessionId ?? ""), "asset manifest gradingSessionId");
  const reportId = assertSafeIdentity(String(value.reportId ?? ""), "asset manifest reportId");
  const seen = new Set<string>();
  const assets = value.assets.map((raw) => {
    if (!isRecord(raw)) throw new Error("Mathematical Grading V1 asset manifest entry is malformed.");
    const id = String(raw.id ?? "");
    const key = id.toLowerCase();
    const relativePath = assertRelativePackagePath(String(raw.relativePath ?? ""));
    const contentType = String(raw.contentType ?? "");
    const hash = String(raw.sha256 ?? "").toLowerCase();
    const byteSize = Number(raw.byteSize);
    if (!id || seen.has(key) || !relativePath.startsWith("assets/") || !contentType || !SHA256.test(hash) ||
      !Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new Error(`Mathematical Grading V1 asset manifest entry ${id || "(missing)"} is invalid.`);
    }
    seen.add(key);
    return { id, relativePath, contentType, sha256: hash, byteSize };
  });
  return {
    schemaVersion: AI_GRADER_MATHEMATICAL_REPORT_PACKAGE_V1_VERSION,
    gradingSessionId,
    reportId,
    reportBundleSchemaVersion: AI_GRADER_REPORT_BUNDLE_V03_VERSION,
    reportBundleFile: AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE,
    reportEnvelopeFile: AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE,
    assets,
  };
}

function parseChecksums(value: unknown): AiGraderMathematicalReportChecksumsV1 {
  if (!isRecord(value) || value.schemaVersion !== AI_GRADER_MATHEMATICAL_REPORT_CHECKSUMS_V1_VERSION || !Array.isArray(value.files)) {
    throw new Error("Mathematical Grading V1 checksum manifest is malformed.");
  }
  const gradingSessionId = assertSafeIdentity(String(value.gradingSessionId ?? ""), "checksum gradingSessionId");
  const reportId = assertSafeIdentity(String(value.reportId ?? ""), "checksum reportId");
  const seen = new Set<string>();
  const files = value.files.map((raw) => {
    if (!isRecord(raw)) throw new Error("Mathematical Grading V1 checksum entry is malformed.");
    const relativePath = assertRelativePackagePath(String(raw.relativePath ?? ""));
    const hash = String(raw.sha256 ?? "").toLowerCase();
    const byteSize = Number(raw.byteSize);
    if (seen.has(relativePath.toLowerCase()) || !SHA256.test(hash) || !Number.isSafeInteger(byteSize) || byteSize < 0) {
      throw new Error(`Mathematical Grading V1 checksum entry ${relativePath} is invalid.`);
    }
    seen.add(relativePath.toLowerCase());
    return { relativePath, sha256: hash, byteSize };
  });
  return { schemaVersion: AI_GRADER_MATHEMATICAL_REPORT_CHECKSUMS_V1_VERSION, gradingSessionId, reportId, files };
}

export async function readAiGraderMathematicalReportPackageV1(
  packagePath: string,
): Promise<AiGraderMathematicalReportPackageV1> {
  const resolvedInput = path.resolve(packagePath);
  const inputStat = await stat(resolvedInput);
  const outputDir = inputStat.isDirectory() ? resolvedInput : path.dirname(resolvedInput);
  const bundlePath = path.join(outputDir, AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE);
  const envelopePath = path.join(outputDir, AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE);
  const assetManifestPath = path.join(outputDir, AI_GRADER_MATHEMATICAL_REPORT_ASSET_MANIFEST_FILE);
  const checksumsPath = path.join(outputDir, AI_GRADER_MATHEMATICAL_REPORT_CHECKSUMS_FILE);
  if (!inputStat.isDirectory() && resolvedInput !== envelopePath && resolvedInput !== bundlePath) {
    throw new Error("Mathematical Grading V1 package path must reference its directory, V0.3 body, or external session envelope.");
  }
  const envelope = parseEnvelope(JSON.parse(await readFile(envelopePath, "utf8")));
  const strictBody = aiGraderReportBundleV03Schema.parse(JSON.parse(await readFile(bundlePath, "utf8")));
  if (!sameStrictBundle(envelope.reportBundle, strictBody)) {
    throw new Error("Mathematical Grading V1 external envelope does not contain the exact immutable V0.3 body.");
  }
  const assetManifest = parseAssetManifest(JSON.parse(await readFile(assetManifestPath, "utf8")));
  const checksums = parseChecksums(JSON.parse(await readFile(checksumsPath, "utf8")));
  if (assetManifest.gradingSessionId !== envelope.gradingSessionId || checksums.gradingSessionId !== envelope.gradingSessionId ||
    assetManifest.reportId !== strictBody.reportId || checksums.reportId !== strictBody.reportId) {
    throw new Error("Mathematical Grading V1 package identity is inconsistent.");
  }
  const publicAssets = new Map(strictBody.publicAssets.map((asset) => [asset.id.toLowerCase(), asset]));
  if (assetManifest.assets.length !== publicAssets.size) throw new Error("Mathematical Grading V1 package is missing immutable public assets.");
  for (const packaged of assetManifest.assets) {
    const asset = publicAssets.get(packaged.id.toLowerCase());
    if (!asset || asset.sha256?.toLowerCase() !== packaged.sha256 || asset.byteSize !== packaged.byteSize || asset.contentType !== packaged.contentType) {
      throw new Error(`Mathematical Grading V1 packaged asset ${packaged.id} does not match the strict public body.`);
    }
  }
  const checksumPaths = new Set(checksums.files.map((entry) => entry.relativePath.toLowerCase()));
  const requiredPaths = [
    AI_GRADER_MATHEMATICAL_REPORT_BUNDLE_FILE,
    AI_GRADER_MATHEMATICAL_REPORT_ENVELOPE_FILE,
    AI_GRADER_MATHEMATICAL_REPORT_ASSET_MANIFEST_FILE,
    ...assetManifest.assets.map((asset) => asset.relativePath),
  ];
  if (checksumPaths.size !== requiredPaths.length || requiredPaths.some((entry) => !checksumPaths.has(entry.toLowerCase()))) {
    throw new Error("Mathematical Grading V1 checksum manifest does not cover the exact immutable package files.");
  }
  for (const checksum of checksums.files) {
    const filePath = path.resolve(outputDir, ...checksum.relativePath.split("/"));
    if (!isSubpath(filePath, outputDir)) throw new Error("Mathematical Grading V1 checksum path escaped the package root.");
    const bytes = await readFile(filePath);
    if (bytes.byteLength !== checksum.byteSize || sha256(bytes) !== checksum.sha256) {
      throw new Error(`Mathematical Grading V1 package integrity failed for ${checksum.relativePath}.`);
    }
  }
  return { outputDir, bundlePath, envelopePath, assetManifestPath, checksumsPath, envelope, assetManifest, checksums };
}

export async function readAiGraderMathematicalReportEnvelopeV1(
  envelopePath: string,
): Promise<AiGraderMathematicalReportEnvelopeV1> {
  return (await readAiGraderMathematicalReportPackageV1(envelopePath)).envelope;
}

export async function readAiGraderMathematicalReportAssetV1(input: {
  packagePath: string;
  assetId: string;
}): Promise<{ asset: AiGraderReportBundleV03["publicAssets"][number]; bytes: Buffer }> {
  const reportPackage = await readAiGraderMathematicalReportPackageV1(input.packagePath);
  const packaged = reportPackage.assetManifest.assets.find((asset) => asset.id === input.assetId);
  const asset = reportPackage.envelope.reportBundle.publicAssets.find((candidate) => candidate.id === input.assetId);
  if (!packaged || !asset) throw new Error(`Mathematical Grading V1 asset ${input.assetId} is not in the immutable package.`);
  return {
    asset,
    bytes: await readFile(path.join(reportPackage.outputDir, ...packaged.relativePath.split("/"))),
  };
}

export function buildAiGraderMathematicalProductionReleaseV1(input: {
  envelope: AiGraderMathematicalReportEnvelopeV1;
  operatorId?: string;
  finalizedAt?: string;
  warningsAccepted?: boolean;
  overrideReason?: string;
  reportBundlePath: string;
}): AiGraderMathematicalProductionReleaseV1 {
  const envelope = parseEnvelope(input.envelope);
  const bundle = envelope.reportBundle;
  const storageKeyPrefix = `ai-grader/reports/${bundle.reportId}/`;
  const finalGrade = structuredClone(bundle.productionRelease.finalGrade);
  const reportLabel = bundle.productionRelease.label;
  const release: AiGraderMathematicalProductionReleaseV1 = {
    schemaVersion: AI_GRADER_MATHEMATICAL_PRODUCTION_RELEASE_V1_VERSION,
    generatedAt: bundle.generatedAt,
    gradingSessionId: envelope.gradingSessionId,
    reportId: bundle.reportId,
    reportStatus: "final_ai_grader_report_v1",
    finalStatus: "final_grade_computed",
    finalGradeComputed: true,
    certifiedClaim: false,
    certificateGenerated: false,
    labelDataGenerated: true,
    qrPayloadGenerated: true,
    gates: [
      {
        id: "strict_mathematical_v1_contract",
        label: "Strict Mathematical Grading V1 contract",
        status: "pass",
        reason: "All four calibrated elements, finalized physical calibration, immutable evidence, exact deductions, and the V0.3 formula contract validated without fallback.",
        evidenceRefs: bundle.publicAssets.map((asset) => asset.id),
      },
    ],
    finalGrade,
    operatorFinalization: {
      operatorId: input.operatorId?.trim() || "local-operator",
      finalizedAt: input.finalizedAt ?? new Date().toISOString(),
      warningsAccepted: input.warningsAccepted === true,
      ...(input.overrideReason?.trim() ? { overrideReason: input.overrideReason.trim() } : {}),
      acceptedWarningGateIds: [],
    },
    publication: {
      status: "local_bundle_ready",
      reportId: bundle.reportId,
      publicReportUrl: reportLabel.publicReportUrl,
      qrPayloadUrl: reportLabel.qrPayloadUrl,
      storageMode: "local_artifact_only",
      dbWritesPerformed: false,
      migrationsRun: false,
      uploadPerformed: false,
      storageKeyPrefix,
      reportBundlePath: input.reportBundlePath,
      requiredFutureProductionSteps: [
        "Use the existing human Approve & Publish authority before any publication mutation.",
        "Persist only through the reviewed Mathematical Grading V1 production boundary after independent Mac review.",
      ],
    },
    label: {
      ...structuredClone(reportLabel),
      status: "label_data_ready",
      labelVersion: "ten-kings-ai-grader-label-v1",
      reportId: bundle.reportId,
      certificateStatus: "report_id_issued_not_certified",
      elementScores: {
        centering: finalGrade.elements.centering.score,
        corners: finalGrade.elements.corners.score,
        edges: finalGrade.elements.edges.score,
        surface: finalGrade.elements.surface.score,
      },
      cardIdentity: structuredClone(bundle.cardIdentity),
      certifiedClaim: false,
    },
    cardIdentity: structuredClone(bundle.cardIdentity),
    calibrationProfile: structuredClone(bundle.calibrationProfile),
    evidenceReferences: {
      publicAssetIds: bundle.publicAssets.map((asset) => asset.id),
      findingIds: bundle.defectFindings.map((finding) => finding.findingId),
      deductionLedgerFindingIds: bundle.deductionLedger.entries.map((entry) => entry.findingId),
    },
    cardInventoryLinkage: {
      status: bundle.cardIdentity.cardAssetId || bundle.cardIdentity.itemId
        ? "contract_ready_not_persisted"
        : "needs_card_linkage",
      ...(bundle.cardIdentity.cardAssetId ? { cardAssetId: bundle.cardIdentity.cardAssetId } : {}),
      ...(bundle.cardIdentity.itemId ? { itemId: bundle.cardIdentity.itemId } : {}),
      note: "Mathematical Grading V1 exposes linkage data but performs no inventory mutation.",
    },
    databaseIntegration: { migrationsRun: false, productionDbWritesPerformed: false },
    storageIntegration: { mode: "local_bundle_only", uploadPerformed: false, storageKeyPrefix },
    warnings: [...(bundle.warnings ?? []), ...finalGrade.confidence.warnings],
    limitations: [
      ...(bundle.limitations ?? []),
      "No production database write or storage upload was performed.",
      "No physical label was printed and no NFC or inventory workflow was accessed.",
    ],
  };
  if (release.finalGrade.status !== "final_mathematical_grade_v1" ||
    release.finalGrade.overall < 1 || release.finalGrade.overall > 10 ||
    release.label.labelGradeText !== release.finalGrade.labelGrade.toFixed(1)) {
    throw new Error("Mathematical Grading V1 release is not ready: exact grade/label validation failed.");
  }
  return release;
}

async function writeAtomic(filePath: string, value: unknown): Promise<Buffer> {
  const bytes = jsonBytes(value);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, bytes, { flag: "wx" });
  await rename(temporaryPath, filePath);
  return bytes;
}

export async function writeAiGraderMathematicalProductionReleaseV1(input: {
  packagePath: string;
  operatorId?: string;
  finalizedAt?: string;
  warningsAccepted?: boolean;
  overrideReason?: string;
}): Promise<AiGraderMathematicalProductionReleaseWriteResultV1> {
  const reportPackage = await readAiGraderMathematicalReportPackageV1(input.packagePath);
  const release = buildAiGraderMathematicalProductionReleaseV1({
    envelope: reportPackage.envelope,
    operatorId: input.operatorId,
    finalizedAt: input.finalizedAt,
    warningsAccepted: input.warningsAccepted,
    overrideReason: input.overrideReason,
    reportBundlePath: reportPackage.bundlePath,
  });
  const productionReleasePath = path.join(reportPackage.outputDir, "production-release.json");
  const labelDataPath = path.join(reportPackage.outputDir, "label-data.json");
  const publicationManifestPath = path.join(reportPackage.outputDir, "publication-manifest.json");
  const integrationContractPath = path.join(reportPackage.outputDir, "integration-contract.json");
  const releaseChecksumsPath = path.join(reportPackage.outputDir, "release-checksums.json");
  release.publication.productionReleasePath = productionReleasePath;
  release.publication.labelDataPath = labelDataPath;
  const written = [
    ["production-release.json", await writeAtomic(productionReleasePath, release)],
    ["label-data.json", await writeAtomic(labelDataPath, release.label)],
    ["publication-manifest.json", await writeAtomic(publicationManifestPath, release.publication)],
    ["integration-contract.json", await writeAtomic(integrationContractPath, {
      reportId: release.reportId,
      gradingSessionId: release.gradingSessionId,
      gradingStandard: reportPackage.envelope.reportBundle.gradingStandard,
      finalGrade: release.finalGrade,
      label: release.label,
      calibrationProfile: release.calibrationProfile,
      evidenceReferences: release.evidenceReferences,
      databaseIntegration: release.databaseIntegration,
      storageIntegration: release.storageIntegration,
      cardInventoryLinkage: release.cardInventoryLinkage,
    })],
  ] as const;
  await writeAtomic(releaseChecksumsPath, {
    schemaVersion: "ai-grader-mathematical-release-checksums-v1",
    gradingSessionId: release.gradingSessionId,
    reportId: release.reportId,
    files: written.map(([relativePath, bytes]) => ({ relativePath, sha256: sha256(bytes), byteSize: bytes.byteLength })),
  });
  return {
    productionRelease: release,
    productionReleasePath,
    labelDataPath,
    publicationManifestPath,
    integrationContractPath,
    releaseChecksumsPath,
    outputDir: reportPackage.outputDir,
  };
}
