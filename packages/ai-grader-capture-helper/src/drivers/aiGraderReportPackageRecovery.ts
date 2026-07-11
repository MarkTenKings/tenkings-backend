import crypto from "node:crypto";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { parseAiGraderDefectFindingV1, type AiGraderDefectFindingV1 } from "@tenkings/shared";
import sharp from "sharp";
import { createStableAiGraderDefectFindingId, extractAiGraderDefectFindingsV1 } from "./aiGraderDefectFindings";
import {
  AI_GRADER_REPORT_BUNDLE_VERSION,
  AI_GRADER_REPORT_PRODUCER_CAPABILITIES,
  AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
  writeAiGraderReportBundle,
  type AiGraderReportBundle,
  type AiGraderReportBundleAsset,
} from "./aiGraderReportBundle";
import {
  writeAiGraderProductionRelease,
  type AiGraderProductionRelease,
  type AiGraderProductionReleaseWriteResult,
} from "./aiGraderProductionRelease";

type JsonRecord = Record<string, any>;

export const AI_GRADER_REPORT_RECOVERY_GUIDANCE =
  "This report package is from an older AI Grader producer and could not be safely recovered. Update and restart the local helper, then re-export this existing report. No recapture is required.";

const REPORT_PACKAGE_JSON_FILES = [
  "report-bundle.json",
  "asset-manifest.json",
  "checksums.json",
  "production-release.json",
  "label-data.json",
  "publication-manifest.json",
  "integration-contract.json",
] as const;
const reportPackageOperations = new Map<string, Promise<unknown>>();

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafeReportId(reportId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(reportId)) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

export async function withAiGraderReportPackageOperation<T>(reportId: string, operation: () => Promise<T>): Promise<T> {
  assertSafeReportId(reportId);
  const previous = reportPackageOperations.get(reportId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  reportPackageOperations.set(reportId, current);
  try {
    return await current;
  } finally {
    if (reportPackageOperations.get(reportId) === current) reportPackageOperations.delete(reportId);
  }
}

export function aiGraderReportBundleHasCurrentProducer(bundle: unknown): bundle is AiGraderReportBundle {
  if (!isRecord(bundle) || bundle.schemaVersion !== AI_GRADER_REPORT_BUNDLE_VERSION) return false;
  const producer = isRecord(bundle.reportProducer) ? bundle.reportProducer : undefined;
  if (producer?.contractVersion !== AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION) return false;
  const capabilities = new Set(Array.isArray(producer.capabilities) ? producer.capabilities : []);
  return AI_GRADER_REPORT_PRODUCER_CAPABILITIES.every((capability) => capabilities.has(capability));
}

export function aiGraderReportBundleHasFindingCandidates(bundle: unknown) {
  if (!isRecord(bundle)) return false;
  const visionLab = isRecord(bundle.visionLab) ? bundle.visionLab : {};
  const provisionalGrade = isRecord(bundle.provisionalGrade) ? bundle.provisionalGrade : {};
  const validation = isRecord(visionLab.findingValidation) ? visionLab.findingValidation : undefined;
  return (Array.isArray(bundle.defectFindings) && bundle.defectFindings.length > 0) ||
    (Array.isArray(visionLab.defectFindings) && visionLab.defectFindings.length > 0) ||
    Object.prototype.hasOwnProperty.call(visionLab, "findingContractVersion") ||
    Number(visionLab.candidateCount ?? 0) > 0 ||
    Number(validation?.sourceCandidateCount ?? 0) > 0 ||
    Number(validation?.publishedFindingCount ?? 0) > 0 ||
    validation?.status === "invalid" ||
    (Array.isArray(provisionalGrade.gradeImpactCandidates) && provisionalGrade.gradeImpactCandidates.length > 0);
}

export async function aiGraderSourceReportHasFindingCandidates(reportDir: string) {
  const parsed = JSON.parse(await readFile(path.join(reportDir, "analysis.json"), "utf-8"));
  if (!isRecord(parsed)) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  const extraction = extractAiGraderDefectFindingsV1(parsed);
  const story = isRecord(parsed.provisionalGradeStory) ? parsed.provisionalGradeStory : undefined;
  const visionLab = isRecord(parsed.visionLab) ? parsed.visionLab : undefined;
  return extraction.sourceCandidateCount > 0 ||
    (Array.isArray(story?.gradeImpactCandidates) && story.gradeImpactCandidates.length > 0) ||
    (Array.isArray(visionLab?.gradeImpactCandidates) && visionLab.gradeImpactCandidates.length > 0);
}

export async function aiGraderReportBundleNeedsRecovery(bundle: unknown, reportDir?: string) {
  if (aiGraderReportBundleHasCurrentProducer(bundle)) return false;
  if (aiGraderReportBundleHasFindingCandidates(bundle)) return true;
  if (!reportDir) return false;
  try {
    return await aiGraderSourceReportHasFindingCandidates(reportDir);
  } catch {
    return false;
  }
}

function findingSemanticKey(finding: AiGraderDefectFindingV1) {
  const detector = {
    id: finding.detector.id,
    version: finding.detector.version,
  } as AiGraderDefectFindingV1["detector"];
  return createStableAiGraderDefectFindingId({
    side: finding.side,
    category: finding.category,
    detector,
    geometry: finding.geometry,
  });
}

function assertVerifiedExistingFindingId(finding: AiGraderDefectFindingV1) {
  const legacyId = findingSemanticKey(finding);
  const currentId = createStableAiGraderDefectFindingId({
    side: finding.side,
    category: finding.category,
    detector: finding.detector,
    geometry: finding.geometry,
  });
  if (finding.findingId !== legacyId && finding.findingId !== currentId) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

function preserveVerifiedFindingIds(previous: AiGraderReportBundle, rebuilt: AiGraderReportBundle) {
  const previousFindings = Array.isArray(previous.visionLab?.defectFindings)
    ? previous.visionLab.defectFindings
    : [];
  const rebuiltFindings = Array.isArray(rebuilt.visionLab?.defectFindings)
    ? rebuilt.visionLab.defectFindings
    : [];
  if (!previousFindings.length) {
    const previousCandidateCount = Number(previous.visionLab?.candidateCount ?? 0);
    if (previousCandidateCount > 0 && rebuilt.visionLab.findingValidation.sourceCandidateCount !== previousCandidateCount) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    return;
  }
  if (previousFindings.length !== rebuiltFindings.length) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const previousBySemanticKey = new Map<string, AiGraderDefectFindingV1>();
  for (const finding of previousFindings) {
    assertVerifiedExistingFindingId(finding);
    const key = findingSemanticKey(finding);
    if (previousBySemanticKey.has(key)) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    previousBySemanticKey.set(key, finding);
  }
  const rebuiltToPreviousId = new Map<string, string>();
  rebuilt.visionLab.defectFindings = rebuiltFindings.map((finding) => {
    const previousFinding = previousBySemanticKey.get(findingSemanticKey(finding));
    if (!previousFinding) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    rebuiltToPreviousId.set(finding.findingId, previousFinding.findingId);
    return { ...finding, findingId: previousFinding.findingId };
  });
  const gradeImpactCandidates = rebuilt.provisionalGrade?.gradeImpactCandidates;
  if (Array.isArray(gradeImpactCandidates)) {
    rebuilt.provisionalGrade!.gradeImpactCandidates = gradeImpactCandidates.map((candidate) => {
      if (!isRecord(candidate) || !Array.isArray(candidate.findingIds)) return candidate;
      return {
        ...candidate,
        findingIds: candidate.findingIds.map((findingId: unknown) =>
          typeof findingId === "string" ? rebuiltToPreviousId.get(findingId) ?? findingId : findingId
        ),
      };
    });
  }
}

function assertExistingAssetHashesPreserved(previous: AiGraderReportBundle, rebuilt: AiGraderReportBundle) {
  const rebuiltById = new Map(rebuilt.assets.map((asset) => [asset.id, asset]));
  for (const previousAsset of previous.assets ?? []) {
    if (!previousAsset.sha256) continue;
    const rebuiltAsset = rebuiltById.get(previousAsset.id);
    if (!rebuiltAsset || rebuiltAsset.sha256 !== previousAsset.sha256 || rebuiltAsset.byteSize !== previousAsset.byteSize) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
  }
}

function findingAssetReferences(finding: AiGraderDefectFindingV1) {
  return [
    [finding.evidence.trueViewAssetId, "normalized_card"],
    [finding.evidence.heatmapAssetId, "surface_heatmap"],
    [finding.evidence.surfaceVisionAssetId, "surface_vision"],
    [finding.evidence.maskAssetId, "confidence_mask"],
    [finding.evidence.overlayAssetId, "measurement_overlay"],
    ...finding.evidence.channelAssetIds.map((assetId) => [assetId, "directional_channel"]),
    ...finding.evidence.roiAssetIds.map((assetId) => [assetId, "roi_crop"]),
  ] as Array<[string | undefined, string]>;
}

async function readJson(filePath: string): Promise<JsonRecord> {
  const value = JSON.parse(await readFile(filePath, "utf-8"));
  if (!isRecord(value)) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  return value;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stagePathForPackagedAsset(asset: AiGraderReportBundleAsset, stageDir: string, canonicalDir: string) {
  const relative = path.relative(path.resolve(canonicalDir), path.resolve(asset.localPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  return path.join(stageDir, relative);
}

async function assertPackagedAsset(asset: AiGraderReportBundleAsset, stageDir: string, canonicalDir: string) {
  if (asset.kind === "folder") return;
  if (!/^[a-f0-9]{64}$/.test(asset.sha256 ?? "") || !Number.isSafeInteger(asset.byteSize) || Number(asset.byteSize) <= 0) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const packagedPath = stagePathForPackagedAsset(asset, stageDir, canonicalDir);
  const bytes = await readFile(packagedPath);
  const fileStats = await stat(packagedPath);
  if (fileStats.size !== asset.byteSize || crypto.createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  if (asset.kind !== "image") return;
  if (!new Set(["image/png", "image/jpeg", "image/webp", "image/tiff"]).has(asset.contentType ?? "") ||
      !Number.isSafeInteger(asset.widthPx) || Number(asset.widthPx) <= 0 ||
      !Number.isSafeInteger(asset.heightPx) || Number(asset.heightPx) <= 0) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const metadata = await sharp(bytes, { failOn: "error" }).metadata();
  if (metadata.width !== asset.widthPx || metadata.height !== asset.heightPx) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

function assertFindingEvidence(bundle: AiGraderReportBundle, finding: AiGraderDefectFindingV1) {
  const assets = new Map(bundle.assets.map((asset) => [asset.id, asset]));
  for (const [assetId, expectedRole] of findingAssetReferences(finding)) {
    if (!assetId) continue;
    const asset = assets.get(assetId);
    if (!asset || asset.kind !== "image" || asset.side !== finding.side || asset.evidenceRole !== expectedRole) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
  }
  const trueView = finding.evidence.trueViewAssetId ? assets.get(finding.evidence.trueViewAssetId) : undefined;
  if (!trueView || trueView.evidenceRole !== "normalized_card") {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

async function assertRecoveredPackage(input: {
  stageDir: string;
  canonicalDir: string;
  reportId: string;
  gradingSessionId: string;
  previousBundle: AiGraderReportBundle;
  previousRelease: AiGraderProductionRelease;
  bundle: AiGraderReportBundle;
  release: AiGraderProductionRelease;
}) {
  const { bundle, release } = input;
  if (!aiGraderReportBundleHasCurrentProducer(bundle) || bundle.reportId !== input.reportId ||
      bundle.gradingSessionId !== input.gradingSessionId || bundle.schemaVersion !== AI_GRADER_REPORT_BUNDLE_VERSION) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const findings = bundle.visionLab.defectFindings ?? [];
  const validation = bundle.visionLab.findingValidation;
  if (validation.status !== "valid" || validation.issues.length !== 0 ||
      validation.sourceCandidateCount !== validation.publishedFindingCount ||
      validation.publishedFindingCount !== findings.length) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const assetIds = new Set<string>();
  for (const asset of bundle.assets) {
    if (!asset.id || assetIds.has(asset.id)) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    assetIds.add(asset.id);
    await assertPackagedAsset(asset, input.stageDir, input.canonicalDir);
  }
  const findingIds = new Set<string>();
  for (const finding of findings) {
    if (!parseAiGraderDefectFindingV1(finding, { knownAssetIds: assetIds, requireTrueViewAsset: true }).success ||
        findingIds.has(finding.findingId)) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    findingIds.add(finding.findingId);
    assertFindingEvidence(bundle, finding);
  }
  assertExistingAssetHashesPreserved(input.previousBundle, bundle);
  const [storedBundle, assetManifest, checksums, storedRelease, labelData, publicationManifest, integrationContract] =
    await Promise.all(REPORT_PACKAGE_JSON_FILES.map((fileName) => readJson(path.join(input.stageDir, fileName))));
  if (!sameJson(storedBundle, bundle) || assetManifest.reportId !== input.reportId ||
      !sameJson(assetManifest.assets, bundle.assets)) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const expectedChecksums = bundle.assets.filter((asset) => asset.sha256).map((asset) => ({
    id: asset.id,
    localPath: asset.localPath,
    sha256: asset.sha256,
    byteSize: asset.byteSize,
  }));
  if (checksums.reportId !== input.reportId || !sameJson(checksums.checksums, expectedChecksums)) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  if (release.reportId !== input.reportId || release.gradingSessionId !== input.gradingSessionId ||
      !sameJson(storedRelease, release) || !sameJson(release.visionLab, bundle.visionLab) ||
      !sameJson(release.operatorFinalization, input.previousRelease.operatorFinalization) ||
      !sameJson(release.gates, input.previousRelease.gates) ||
      !sameJson(release.finalGrade, input.previousRelease.finalGrade) ||
      !sameJson(release.label, input.previousRelease.label)) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  for (const acceptedGateId of release.operatorFinalization.acceptedWarningGateIds) {
    if (!release.gates.some((gate) => gate.id === acceptedGateId && gate.status === "accepted_warning")) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
  }
  if (!sameJson(labelData, release.label) || labelData.reportId !== input.reportId ||
      !sameJson(publicationManifest, release.publication) || publicationManifest.reportId !== input.reportId ||
      integrationContract.reportId !== input.reportId || integrationContract.gradingSessionId !== input.gradingSessionId ||
      !sameJson(integrationContract.finalGrade, release.finalGrade) || !sameJson(integrationContract.label, release.label)) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const serializedPackage = REPORT_PACKAGE_JSON_FILES.map((fileName, index) =>
    JSON.stringify([fileName, [storedBundle, assetManifest, checksums, storedRelease, labelData, publicationManifest, integrationContract][index]])
  ).join("\n");
  if (serializedPackage.includes(path.basename(input.stageDir)) || serializedPackage.includes("bodyBase64") ||
      serializedPackage.includes("data:image")) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

export interface RecoverAiGraderReportPackageInput {
  canonicalDir: string;
  reportDir: string;
  reportId: string;
  gradingSessionId: string;
  previousBundle: AiGraderReportBundle;
  previousRelease: AiGraderProductionRelease;
  publicBasePath?: string;
  publicBaseUrl?: string;
  captureTiming?: JsonRecord;
  geometryCaptureDecisions?: JsonRecord;
}

export interface RecoverAiGraderReportPackageResult {
  bundle: AiGraderReportBundle;
  productionRelease: AiGraderProductionRelease;
  outputDir: string;
  bundlePath: string;
  assetManifestPath: string;
  checksumsPath: string;
  productionReleasePath: string;
  labelDataPath: string;
  publicationManifestPath: string;
  integrationContractPath: string;
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function recoverAiGraderReportPackage(
  input: RecoverAiGraderReportPackageInput,
): Promise<RecoverAiGraderReportPackageResult> {
  assertSafeReportId(input.reportId);
  const canonicalDir = path.resolve(input.canonicalDir);
  if (path.basename(canonicalDir) !== input.reportId ||
      input.previousBundle.reportId !== input.reportId ||
      input.previousBundle.gradingSessionId !== input.gradingSessionId ||
      input.previousRelease.reportId !== input.reportId ||
      input.previousRelease.gradingSessionId !== input.gradingSessionId) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const parentDir = path.dirname(canonicalDir);
  const operationId = crypto.randomUUID();
  const stageDir = path.join(parentDir, "." + input.reportId + ".staging-" + operationId);
  const backupDir = path.join(parentDir, "." + input.reportId + ".backup-" + operationId);
  let canonicalMoved = false;
  try {
    await mkdir(parentDir, { recursive: true });
    const bundleResult = await writeAiGraderReportBundle({
      reportDir: input.reportDir,
      outputDir: stageDir,
      artifactReferenceDir: canonicalDir,
      copyDerivedAssets: true,
      reportId: input.reportId,
      gradingSessionId: input.gradingSessionId,
      generatedAt: input.previousBundle.generatedAt,
      cardIdentity: input.previousBundle.cardIdentity,
      publicBasePath: input.publicBasePath,
      captureTiming: input.captureTiming ?? input.previousBundle.captureTiming,
      geometryCaptureDecisions: input.geometryCaptureDecisions ?? input.previousBundle.geometryCaptureDecisions,
      ocrPrefill: input.previousBundle.ocrPrefill,
      transformBundle: (bundle) => preserveVerifiedFindingIds(input.previousBundle, bundle),
    });
    const priorFinalization = input.previousRelease.operatorFinalization;
    const releaseResult: AiGraderProductionReleaseWriteResult = await writeAiGraderProductionRelease({
      reportBundlePath: bundleResult.bundlePath,
      reportBundleReferencePath: path.join(canonicalDir, "report-bundle.json"),
      artifactReferenceDir: canonicalDir,
      outputDir: stageDir,
      previousRelease: input.previousRelease,
      generatedAt: input.previousRelease.generatedAt,
      operatorId: priorFinalization.operatorId,
      warningsAccepted: priorFinalization.warningsAccepted,
      overrideReason: priorFinalization.overrideReason,
      publicBaseUrl: input.publicBaseUrl,
      publicBasePath: input.publicBasePath,
    });
    await assertRecoveredPackage({
      stageDir,
      canonicalDir,
      reportId: input.reportId,
      gradingSessionId: input.gradingSessionId,
      previousBundle: input.previousBundle,
      previousRelease: input.previousRelease,
      bundle: bundleResult.bundle,
      release: releaseResult.productionRelease,
    });
    if (await pathExists(canonicalDir)) {
      await rename(canonicalDir, backupDir);
      canonicalMoved = true;
    }
    try {
      await rename(stageDir, canonicalDir);
    } catch {
      if (canonicalMoved) {
        await rename(backupDir, canonicalDir);
        canonicalMoved = false;
      }
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    if (canonicalMoved) {
      await rm(backupDir, { recursive: true, force: true });
      canonicalMoved = false;
    }
    return {
      bundle: bundleResult.bundle,
      productionRelease: releaseResult.productionRelease,
      outputDir: canonicalDir,
      bundlePath: path.join(canonicalDir, "report-bundle.json"),
      assetManifestPath: path.join(canonicalDir, "asset-manifest.json"),
      checksumsPath: path.join(canonicalDir, "checksums.json"),
      productionReleasePath: path.join(canonicalDir, "production-release.json"),
      labelDataPath: path.join(canonicalDir, "label-data.json"),
      publicationManifestPath: path.join(canonicalDir, "publication-manifest.json"),
      integrationContractPath: path.join(canonicalDir, "integration-contract.json"),
    };
  } catch {
    if (canonicalMoved && !(await pathExists(canonicalDir)) && await pathExists(backupDir)) {
      await rename(backupDir, canonicalDir).catch(() => undefined);
    }
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}
