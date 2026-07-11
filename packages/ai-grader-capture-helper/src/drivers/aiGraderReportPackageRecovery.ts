import crypto from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
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

const BASE_REPORT_PACKAGE_JSON_FILES = [
  "report-bundle.json",
  "asset-manifest.json",
  "checksums.json",
] as const;
const RELEASE_REPORT_PACKAGE_JSON_FILES = [
  "production-release.json",
  "label-data.json",
  "publication-manifest.json",
  "integration-contract.json",
] as const;
const RETIRED_ATOMIC_DERIVED_PACKAGE_CAPABILITY = "atomic-derived-package-v1";
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
  const capabilityList = Array.isArray(producer.capabilities) ? producer.capabilities : [];
  const capabilities = new Set(capabilityList);
  return !capabilities.has(RETIRED_ATOMIC_DERIVED_PACKAGE_CAPABILITY) &&
    capabilityList.length === AI_GRADER_REPORT_PRODUCER_CAPABILITIES.length &&
    capabilities.size === capabilityList.length &&
    AI_GRADER_REPORT_PRODUCER_CAPABILITIES.every((capability) => capabilities.has(capability));
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
  try {
    const parsed = JSON.parse(await readFile(path.join(reportDir, "analysis.json"), "utf-8"));
    if (!isRecord(parsed)) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    const candidateInventories: unknown[][] = [];
    const surfaceIntelligence = isRecord(parsed.surfaceIntelligence) ? parsed.surfaceIntelligence : undefined;
    const visionLab = isRecord(parsed.visionLab) ? parsed.visionLab : undefined;
    const visionSides = isRecord(visionLab?.sides) ? visionLab.sides : undefined;
    for (const side of ["front", "back"] as const) {
      const sideInventories: unknown[][] = [];
      for (const container of [surfaceIntelligence?.[side], visionSides?.[side]]) {
        if (!isRecord(container) || !Object.prototype.hasOwnProperty.call(container, "candidates")) continue;
        if (!Array.isArray(container.candidates)) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
        sideInventories.push(container.candidates);
      }
      if (!sideInventories.length) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      candidateInventories.push(...sideInventories);
    }
    const story = isRecord(parsed.provisionalGradeStory) ? parsed.provisionalGradeStory : undefined;
    const gradeImpactInventories: unknown[][] = [];
    for (const container of [story, visionLab]) {
      if (!isRecord(container) || !Object.prototype.hasOwnProperty.call(container, "gradeImpactCandidates")) continue;
      if (!Array.isArray(container.gradeImpactCandidates)) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      gradeImpactInventories.push(container.gradeImpactCandidates);
    }
    if (!gradeImpactInventories.length) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    const extraction = extractAiGraderDefectFindingsV1(parsed);
    return extraction.sourceCandidateCount > 0 ||
      candidateInventories.some((candidates) => candidates.length > 0) ||
      gradeImpactInventories.some((candidates) => candidates.length > 0);
  } catch {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

export async function aiGraderReportBundleNeedsRecovery(bundle: unknown, reportDir?: string, packageDir?: string) {
  if (aiGraderReportBundleHasCurrentProducer(bundle)) {
    if (!packageDir) return true;
    return !(await aiGraderReportPackageHasCompleteCurrentSidecars({ packageDir, bundle }));
  }
  if (isRecord(bundle) && isRecord(bundle.reportProducer)) return true;
  if (aiGraderReportBundleHasFindingCandidates(bundle)) return true;
  if (!reportDir) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  return aiGraderSourceReportHasFindingCandidates(reportDir);
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

function expectedChecksumsForBundle(bundle: AiGraderReportBundle) {
  return bundle.assets.filter((asset) => asset.sha256).map((asset) => ({
    id: asset.id,
    localPath: asset.localPath,
    sha256: asset.sha256,
    byteSize: asset.byteSize,
  }));
}

function assertBundleFindingContract(bundle: AiGraderReportBundle, requireValidExtraction: boolean) {
  if (!Array.isArray(bundle.assets) || !isRecord(bundle.visionLab)) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const findings = Array.isArray(bundle.visionLab.defectFindings) ? bundle.visionLab.defectFindings : [];
  const validation = isRecord(bundle.visionLab.findingValidation) ? bundle.visionLab.findingValidation : undefined;
  if (!validation || !new Set(["valid", "invalid"]).has(validation.status) ||
      !Array.isArray(validation.issues) ||
      !Number.isSafeInteger(validation.sourceCandidateCount) || validation.sourceCandidateCount < 0 ||
      !Number.isSafeInteger(validation.publishedFindingCount) || validation.publishedFindingCount < 0 ||
      validation.publishedFindingCount !== findings.length ||
      (requireValidExtraction && (
        validation.status !== "valid" ||
        validation.issues.length !== 0 ||
        validation.sourceCandidateCount !== validation.publishedFindingCount
      )) ||
      (!requireValidExtraction && validation.status === "valid" && (
        validation.issues.length !== 0 ||
        validation.sourceCandidateCount !== validation.publishedFindingCount
      )) ||
      (!requireValidExtraction && validation.status === "invalid" && validation.issues.length === 0)) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const assetIds = new Set<string>();
  for (const asset of bundle.assets) {
    if (!isRecord(asset) || typeof asset.id !== "string" || !asset.id || assetIds.has(asset.id)) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    if (asset.kind !== "folder") {
      const hasSha256 = Object.prototype.hasOwnProperty.call(asset, "sha256");
      const hasByteSize = Object.prototype.hasOwnProperty.call(asset, "byteSize");
      if ((hasSha256 || hasByteSize) && (
        !/^[a-f0-9]{64}$/.test(String(asset.sha256 ?? "")) ||
        !Number.isSafeInteger(asset.byteSize) ||
        Number(asset.byteSize) <= 0
      )) {
        throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      }
      if (!hasSha256 && !hasByteSize) {
        throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      }
    }
    assetIds.add(asset.id);
  }
  const findingIds = new Set<string>();
  for (const finding of findings) {
    const parsed = parseAiGraderDefectFindingV1(finding, { knownAssetIds: assetIds, requireTrueViewAsset: true });
    if (!parsed.success || findingIds.has(parsed.data.findingId)) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    findingIds.add(parsed.data.findingId);
    assertFindingEvidence(bundle, parsed.data);
  }
}

async function assertBaseDerivedPackage(input: {
  packageDir: string;
  canonicalDir: string;
  reportId: string;
  gradingSessionId?: string;
  reportDir?: string;
  expectedBundle?: AiGraderReportBundle;
  previousBundle?: AiGraderReportBundle;
  validatePackagedAssets?: boolean;
  requireValidFindingExtraction?: boolean;
}) {
  const [storedBundleValue, assetManifest, checksums] = await Promise.all(
    BASE_REPORT_PACKAGE_JSON_FILES.map((fileName) => readJson(path.join(input.packageDir, fileName))),
  );
  const storedBundle = storedBundleValue as AiGraderReportBundle;
  if (!aiGraderReportBundleHasCurrentProducer(storedBundle) ||
      storedBundle.reportId !== input.reportId ||
      (input.gradingSessionId && storedBundle.gradingSessionId !== input.gradingSessionId) ||
      (input.reportDir && (
        typeof storedBundle.localReportFolder !== "string" ||
        path.resolve(storedBundle.localReportFolder) !== path.resolve(input.reportDir)
      )) ||
      (input.expectedBundle && !sameJson(storedBundle, input.expectedBundle)) ||
      assetManifest.reportId !== storedBundle.reportId ||
      !sameJson(assetManifest.assets, storedBundle.assets) ||
      checksums.reportId !== storedBundle.reportId ||
      !sameJson(checksums.checksums, expectedChecksumsForBundle(storedBundle))) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  assertBundleFindingContract(storedBundle, input.requireValidFindingExtraction === true);
  if (input.validatePackagedAssets) {
    for (const asset of storedBundle.assets) {
      await assertPackagedAsset(asset, input.packageDir, input.canonicalDir);
    }
  }
  if (input.previousBundle) assertExistingAssetHashesPreserved(input.previousBundle, storedBundle);
  const serializedBase = BASE_REPORT_PACKAGE_JSON_FILES.map((fileName, index) =>
    JSON.stringify([fileName, [storedBundle, assetManifest, checksums][index]])
  ).join("\n");
  if ((path.resolve(input.packageDir) !== path.resolve(input.canonicalDir) &&
       serializedBase.includes(path.basename(input.packageDir))) ||
      serializedBase.includes("bodyBase64") ||
      serializedBase.includes("data:image")) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  return storedBundle;
}

async function assertReleaseDerivedPackage(input: {
  packageDir: string;
  bundle: AiGraderReportBundle;
  expectedRelease?: AiGraderProductionRelease;
  previousRelease?: AiGraderProductionRelease;
}) {
  const [storedRelease, labelData, publicationManifest, integrationContract] = await Promise.all(
    RELEASE_REPORT_PACKAGE_JSON_FILES.map((fileName) => readJson(path.join(input.packageDir, fileName))),
  );
  const release = storedRelease as AiGraderProductionRelease;
  assertProductionReleaseEvidence(release, input.bundle);
  if ((input.expectedRelease && !sameJson(release, input.expectedRelease)) ||
      (input.previousRelease && (
        !sameJson(release.operatorFinalization, input.previousRelease.operatorFinalization) ||
        !sameJson(release.gates, input.previousRelease.gates) ||
        !sameJson(release.finalGrade, input.previousRelease.finalGrade) ||
        !sameJson(release.label, input.previousRelease.label)
      )) ||
      !sameJson(labelData, release.label) || labelData.reportId !== input.bundle.reportId ||
      !sameJson(publicationManifest, release.publication) || publicationManifest.reportId !== input.bundle.reportId ||
      integrationContract.reportId !== input.bundle.reportId ||
      integrationContract.gradingSessionId !== input.bundle.gradingSessionId ||
      !sameJson(integrationContract.finalGrade, release.finalGrade) ||
      !sameJson(integrationContract.label, release.label)) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  return release;
}

function assertProductionReleaseEvidence(release: AiGraderProductionRelease, bundle: AiGraderReportBundle) {
  const finalGradeComputed = release?.finalGradeComputed === true;
  const expectedReportStatus = finalGradeComputed ? "final_ai_grader_report_v0" : "insufficient_evidence";
  const expectedFinalStatus = finalGradeComputed ? "final_grade_computed" : "insufficient_evidence";
  const expectedGradeStatus = finalGradeComputed ? "final_ai_grader_grade_v0" : "insufficient_evidence";
  const expectedLabelStatus = finalGradeComputed ? "label_data_ready" : "blocked_insufficient_evidence";
  const expectedPublicationStatus = finalGradeComputed ? "local_bundle_ready" : "blocked_insufficient_evidence";
  if (!isRecord(release) ||
      release.schemaVersion !== "ai-grader-production-release-v0.1" ||
      release.reportId !== bundle.reportId ||
      release.gradingSessionId !== bundle.gradingSessionId ||
      release.reportStatus !== expectedReportStatus ||
      release.finalStatus !== expectedFinalStatus ||
      typeof release.finalGradeComputed !== "boolean" ||
      release.certifiedClaim !== false ||
      release.certificateGenerated !== false ||
      release.labelDataGenerated !== finalGradeComputed ||
      release.qrPayloadGenerated !== finalGradeComputed ||
      !sameJson(release.visionLab, bundle.visionLab) ||
      !isRecord(release.operatorFinalization) ||
      typeof release.operatorFinalization.operatorId !== "string" ||
      !release.operatorFinalization.operatorId.trim() ||
      typeof release.operatorFinalization.finalizedAt !== "string" ||
      !release.operatorFinalization.finalizedAt.trim() ||
      typeof release.operatorFinalization.warningsAccepted !== "boolean" ||
      !Array.isArray(release.operatorFinalization.acceptedWarningGateIds) ||
      !Array.isArray(release.gates) ||
      release.gates.length === 0 ||
      release.gates.some((gate) =>
        !isRecord(gate) ||
        typeof gate.id !== "string" ||
        !gate.id.trim() ||
        !new Set(["pass", "accepted_warning", "fail"]).has(gate.status) ||
        typeof gate.reason !== "string" ||
        !Array.isArray(gate.evidenceRefs)
      ) ||
      !isRecord(release.finalGrade) ||
      release.finalGrade.status !== expectedGradeStatus ||
      release.finalGrade.finalGradeComputed !== finalGradeComputed ||
      (finalGradeComputed && (typeof release.finalGrade.overall !== "number" || !Number.isFinite(release.finalGrade.overall))) ||
      !isRecord(release.label) ||
      release.label.status !== expectedLabelStatus ||
      release.label.reportId !== bundle.reportId ||
      typeof release.label.certId !== "string" ||
      !release.label.certId.trim() ||
      typeof release.label.publicReportUrl !== "string" ||
      !release.label.publicReportUrl.trim() ||
      typeof release.label.qrPayloadUrl !== "string" ||
      !release.label.qrPayloadUrl.trim() ||
      !isRecord(release.publication) ||
      release.publication.status !== expectedPublicationStatus ||
      release.publication.reportId !== bundle.reportId ||
      release.publication.publicReportUrl !== release.label.publicReportUrl ||
      release.publication.qrPayloadUrl !== release.label.qrPayloadUrl) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const gateIds = release.gates.map((gate) => gate.id);
  const acceptedWarningGateIds = release.gates
    .filter((gate) => gate.status === "accepted_warning")
    .map((gate) => gate.id);
  const finalizedAcceptedGateIds = release.operatorFinalization.acceptedWarningGateIds;
  if (new Set(gateIds).size !== gateIds.length ||
      new Set(finalizedAcceptedGateIds).size !== finalizedAcceptedGateIds.length ||
      finalizedAcceptedGateIds.some((gateId) => typeof gateId !== "string") ||
      acceptedWarningGateIds.length !== finalizedAcceptedGateIds.length ||
      acceptedWarningGateIds.some((gateId) => !finalizedAcceptedGateIds.includes(gateId)) ||
      (finalGradeComputed && release.gates.some((gate) => gate.status === "fail"))) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

export async function readAiGraderReportPackageReleaseEvidence(input: {
  packageDir: string;
  bundle: AiGraderReportBundle;
}) {
  try {
    const packageDir = path.resolve(input.packageDir);
    const present = await Promise.all(
      RELEASE_REPORT_PACKAGE_JSON_FILES.map((fileName) => pathExists(path.join(packageDir, fileName))),
    );
    if (!present[0]) {
      if (present.some(Boolean)) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      return undefined;
    }
    const release = await readJson(path.join(packageDir, "production-release.json")) as AiGraderProductionRelease;
    assertProductionReleaseEvidence(release, input.bundle);
    if (present[1]) {
      const label = await readJson(path.join(packageDir, "label-data.json"));
      if (!sameJson(label, release.label) || label.reportId !== input.bundle.reportId) {
        throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      }
    }
    if (present[2]) {
      const publication = await readJson(path.join(packageDir, "publication-manifest.json"));
      if (!sameJson(publication, release.publication) || publication.reportId !== input.bundle.reportId) {
        throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      }
    }
    if (present[3]) {
      const integration = await readJson(path.join(packageDir, "integration-contract.json"));
      if (integration.reportId !== input.bundle.reportId ||
          integration.gradingSessionId !== input.bundle.gradingSessionId ||
          !sameJson(integration.finalGrade, release.finalGrade) ||
          !sameJson(integration.label, release.label)) {
        throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      }
    }
    return release;
  } catch {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

async function assertOptionalReleaseSidecars(packageDir: string, bundle: AiGraderReportBundle) {
  const present = await Promise.all(
    RELEASE_REPORT_PACKAGE_JSON_FILES.map((fileName) => pathExists(path.join(packageDir, fileName))),
  );
  if (present.every((value) => !value)) return;
  if (!present.every(Boolean)) throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  await assertReleaseDerivedPackage({ packageDir, bundle });
}

export async function aiGraderReportPackageHasCompleteCurrentSidecars(input: {
  packageDir: string;
  bundle: AiGraderReportBundle;
}) {
  try {
    const storedBundle = await assertBaseDerivedPackage({
      packageDir: path.resolve(input.packageDir),
      canonicalDir: path.resolve(input.packageDir),
      reportId: input.bundle.reportId,
      gradingSessionId: input.bundle.gradingSessionId,
      expectedBundle: input.bundle,
    });
    await assertOptionalReleaseSidecars(path.resolve(input.packageDir), storedBundle);
    return true;
  } catch {
    return false;
  }
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

async function assertRecoveredBasePackage(input: {
  stageDir: string;
  canonicalDir: string;
  reportId: string;
  gradingSessionId: string;
  previousBundle: AiGraderReportBundle;
  bundle: AiGraderReportBundle;
}) {
  const storedBundle = await assertBaseDerivedPackage({
    packageDir: input.stageDir,
    canonicalDir: input.canonicalDir,
    reportId: input.reportId,
    gradingSessionId: input.gradingSessionId,
    expectedBundle: input.bundle,
    previousBundle: input.previousBundle,
    validatePackagedAssets: true,
    requireValidFindingExtraction: true,
  });
  if (!sameJson(storedBundle, input.bundle)) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

async function assertRecoveredReleasePackage(input: {
  stageDir: string;
  bundle: AiGraderReportBundle;
  previousRelease: AiGraderProductionRelease;
  release: AiGraderProductionRelease;
}) {
  await assertReleaseDerivedPackage({
    packageDir: input.stageDir,
    bundle: input.bundle,
    expectedRelease: input.release,
    previousRelease: input.previousRelease,
  });
}

export interface RecoverAiGraderReportPackageInput {
  canonicalDir: string;
  reportDir: string;
  reportId: string;
  gradingSessionId: string;
  previousBundle: AiGraderReportBundle;
  previousRelease?: AiGraderProductionRelease;
  publicBasePath?: string;
  publicBaseUrl?: string;
  captureTiming?: JsonRecord;
  geometryCaptureDecisions?: JsonRecord;
}

export interface RecoverAiGraderReportPackageResult {
  bundle: AiGraderReportBundle;
  productionRelease?: AiGraderProductionRelease;
  outputDir: string;
  bundlePath: string;
  assetManifestPath: string;
  checksumsPath: string;
  productionReleasePath?: string;
  labelDataPath?: string;
  publicationManifestPath?: string;
  integrationContractPath?: string;
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return false;
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

async function assertReportBundleIdentity(
  packageDir: string,
  reportId: string,
  gradingSessionId?: string,
  reportDir?: string,
) {
  const bundle = await readJson(path.join(packageDir, "report-bundle.json"));
  if (bundle.reportId !== reportId ||
      bundle.schemaVersion !== AI_GRADER_REPORT_BUNDLE_VERSION ||
      (gradingSessionId && bundle.gradingSessionId !== gradingSessionId) ||
      (reportDir && (
        typeof bundle.localReportFolder !== "string" ||
        path.resolve(bundle.localReportFolder) !== path.resolve(reportDir)
      ))) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}

async function reportPackageTransactionEntries(canonicalDir: string, reportId: string) {
  const parentDir = path.dirname(canonicalDir);
  const stagePrefix = "." + reportId + ".staging-";
  const backupPrefix = "." + reportId + ".backup-";
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(parentDir, { withFileTypes: true });
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return { stages: [], backups: [] };
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const stages: Array<{ id: string; path: string }> = [];
  const backups: Array<{ id: string; path: string }> = [];
  for (const entry of entries) {
    const prefix = entry.name.startsWith(stagePrefix)
      ? stagePrefix
      : entry.name.startsWith(backupPrefix)
        ? backupPrefix
        : undefined;
    if (!prefix) continue;
    const id = entry.name.slice(prefix.length);
    if (!entry.isDirectory() || !/^[A-Za-z0-9-]+$/.test(id)) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    (prefix === stagePrefix ? stages : backups).push({ id, path: path.join(parentDir, entry.name) });
  }
  if (stages.length > 1 || backups.length > 1) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  return { stages, backups };
}

export async function reconcileAiGraderReportPackageTransaction(input: {
  canonicalDir: string;
  reportId: string;
  gradingSessionId?: string;
  reportDir?: string;
}) {
  try {
    assertSafeReportId(input.reportId);
    const canonicalDir = path.resolve(input.canonicalDir);
    if (path.basename(canonicalDir) !== input.reportId) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    const { stages, backups } = await reportPackageTransactionEntries(canonicalDir, input.reportId);
    const stage = stages[0];
    const backup = backups[0];
    const canonicalExists = await pathExists(canonicalDir);
    if ((stage || backup) && (!input.gradingSessionId || !input.reportDir)) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    if (stage && backup && stage.id !== backup.id) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    if (canonicalExists && stage && backup) {
      throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
    }
    if (!canonicalExists && backup) {
      await assertReportBundleIdentity(backup.path, input.reportId, input.gradingSessionId, input.reportDir);
      await rename(backup.path, canonicalDir);
      if (stage) await rm(stage.path, { recursive: true, force: true });
      return;
    }
    if (!canonicalExists && stage) {
      try {
        await assertBaseDerivedPackage({
          packageDir: stage.path,
          canonicalDir,
          reportId: input.reportId,
          gradingSessionId: input.gradingSessionId,
          reportDir: input.reportDir,
          validatePackagedAssets: true,
          requireValidFindingExtraction: true,
        });
      } catch {
        await rm(stage.path, { recursive: true, force: true });
        return;
      }
      await rename(stage.path, canonicalDir);
      return;
    }
    if (canonicalExists && backup) {
      let canonicalValid = false;
      try {
        const bundle = await assertBaseDerivedPackage({
          packageDir: canonicalDir,
          canonicalDir,
          reportId: input.reportId,
          gradingSessionId: input.gradingSessionId,
          reportDir: input.reportDir,
          validatePackagedAssets: true,
          requireValidFindingExtraction: true,
        });
        await assertOptionalReleaseSidecars(canonicalDir, bundle);
        canonicalValid = true;
      } catch {
        canonicalValid = false;
      }
      if (canonicalValid) {
        await rm(backup.path, { recursive: true, force: true });
        return;
      }
      await assertReportBundleIdentity(backup.path, input.reportId, input.gradingSessionId, input.reportDir);
      const rollbackStage = path.join(path.dirname(canonicalDir), "." + input.reportId + ".staging-" + backup.id);
      await rename(canonicalDir, rollbackStage);
      try {
        await rename(backup.path, canonicalDir);
      } catch {
        await rename(rollbackStage, canonicalDir).catch(() => undefined);
        throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
      }
      await rm(rollbackStage, { recursive: true, force: true });
      return;
    }
    if (canonicalExists && stage) {
      await rm(stage.path, { recursive: true, force: true });
    }
  } catch {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
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
      (input.previousRelease && (
        input.previousRelease.reportId !== input.reportId ||
        input.previousRelease.gradingSessionId !== input.gradingSessionId
      ))) {
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
  const parentDir = path.dirname(canonicalDir);
  await aiGraderSourceReportHasFindingCandidates(input.reportDir);
  await reconcileAiGraderReportPackageTransaction({
    canonicalDir,
    reportId: input.reportId,
    gradingSessionId: input.gradingSessionId,
    reportDir: input.reportDir,
  });
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
    await assertRecoveredBasePackage({
      stageDir,
      canonicalDir,
      reportId: input.reportId,
      gradingSessionId: input.gradingSessionId,
      previousBundle: input.previousBundle,
      bundle: bundleResult.bundle,
    });
    let releaseResult: AiGraderProductionReleaseWriteResult | undefined;
    if (input.previousRelease) {
      const priorFinalization = input.previousRelease.operatorFinalization;
      releaseResult = await writeAiGraderProductionRelease({
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
      await assertRecoveredReleasePackage({
        stageDir,
        bundle: bundleResult.bundle,
        previousRelease: input.previousRelease,
        release: releaseResult.productionRelease,
      });
    }
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
      productionRelease: releaseResult?.productionRelease,
      outputDir: canonicalDir,
      bundlePath: path.join(canonicalDir, "report-bundle.json"),
      assetManifestPath: path.join(canonicalDir, "asset-manifest.json"),
      checksumsPath: path.join(canonicalDir, "checksums.json"),
      ...(releaseResult ? {
        productionReleasePath: path.join(canonicalDir, "production-release.json"),
        labelDataPath: path.join(canonicalDir, "label-data.json"),
        publicationManifestPath: path.join(canonicalDir, "publication-manifest.json"),
        integrationContractPath: path.join(canonicalDir, "integration-contract.json"),
      } : {}),
    };
  } catch {
    if (canonicalMoved && !(await pathExists(canonicalDir)) && await pathExists(backupDir)) {
      await rename(backupDir, canonicalDir).catch(() => undefined);
    }
    await rm(stageDir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(AI_GRADER_REPORT_RECOVERY_GUIDANCE);
  }
}
