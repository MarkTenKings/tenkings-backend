import crypto from "node:crypto";
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiGraderDefectFindingV1 } from "@tenkings/shared";
import sharp from "sharp";
import { extractAiGraderDefectFindingsV1, type AiGraderApprovedDefectEvidence } from "./aiGraderDefectFindings";
import type { AiGraderCaptureTimingProfile } from "./aiGraderCaptureTiming";

export const AI_GRADER_REPORT_BUNDLE_VERSION = "ai-grader-report-bundle-v0.1";
export const AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION = "ai-grader-report-producer-v0.2";
export const AI_GRADER_REPORT_PRODUCER_CAPABILITIES = [
  "finding-validation-v1",
  "capture-profile-provenance-v1",
  "raster-dimensions-v1",
  "atomic-derived-package-v1",
] as const;

const AI_GRADER_REPORT_CAPTURE_PROFILE_VERSIONS: Record<AiGraderCaptureTimingProfile, string> = {
  full_forensic: "ten-kings-fixed-rig-full-forensic-v1",
  production_fast: "ten-kings-fixed-rig-production-fast-v1",
};

type JsonRecord = Record<string, any>;

export type AiGraderReportBundleEvidenceRole =
  | "normalized_card"
  | "surface_heatmap"
  | "surface_vision"
  | "confidence_mask"
  | "measurement_overlay"
  | "directional_channel"
  | "roi_crop"
  | "other_evidence";

export interface AiGraderReportBundleAsset {
  id: string;
  kind: "report_html" | "manifest" | "analysis" | "image" | "data" | "folder" | "unknown";
  localPath: string;
  fileName?: string;
  contentType?: string;
  publicPathPlaceholder?: string;
  sha256?: string;
  byteSize?: number;
  bodyEncoding?: "base64";
  bodyBase64?: string;
  side?: "front" | "back";
  evidenceRole?: AiGraderReportBundleEvidenceRole;
  widthPx?: number;
  heightPx?: number;
  required: boolean;
}

export interface AiGraderReportBundle {
  schemaVersion: typeof AI_GRADER_REPORT_BUNDLE_VERSION;
  reportProducer: {
    contractVersion: typeof AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION;
    capabilities: Array<(typeof AI_GRADER_REPORT_PRODUCER_CAPABILITIES)[number]>;
  };
  generatedAt: string;
  gradingSessionId: string;
  reportId: string;
  reportStatus: "provisional_diagnostic_ready" | "insufficient_evidence" | "missing_report_data";
  provisionalStatus: "provisional_diagnostic";
  finalStatus: "not_computed";
  finalGradeComputed: false;
  certifiedClaim: false;
  labelGenerated: false;
  qrGenerated: false;
  certificateGenerated: false;
  localReportFolder: string;
  reportHtmlPath?: string;
  manifestPath?: string;
  analysisPath?: string;
  publicPathPlaceholders: {
    reportViewerRoute: string;
    reportUrlTemplate: string;
    assetBaseUrlTemplate: string;
    uploadStorageKeyPrefix?: string;
  };
  cardIdentity: {
    cardAssetId?: string;
    title?: string;
    sideCount: 2;
    futureSlabbedPhotoRefsReserved: true;
    futureEbayCompsRefsReserved: true;
  };
  provisionalGrade?: {
    status?: string;
    overall?: number;
    elementScores?: JsonRecord;
    confidence?: JsonRecord;
    gates?: JsonRecord;
    gradeStory?: JsonRecord;
    whyNot10?: JsonRecord[];
    gradeImpactCandidates?: JsonRecord[];
  };
  evidenceReferences: {
    frontPackageDir?: string;
    backPackageDir?: string;
    frontEvidenceRefs: string[];
    backEvidenceRefs: string[];
  };
  visionLab: {
    available: boolean;
    defectFindings?: AiGraderDefectFindingV1[];
    findingValidation: {
      status: "valid" | "invalid";
      sourceCandidateCount: number;
      publishedFindingCount: number;
      issues: Array<{ path: string; message: string }>;
    };
    trueViewRefs: string[];
    overlayRefs: string[];
    channelImageRefs: string[];
    heatmapRefs: string[];
    surfaceVisionRefs: string[];
    confidenceRefs: string[];
    candidateCount: number;
    missingDataWarnings: string[];
  };
  calibrationProfile?: JsonRecord;
  rulerCalibration?: JsonRecord;
  lightingProfile?: JsonRecord;
  geometry?: {
    front?: JsonRecord;
    back?: JsonRecord;
  };
  geometryCaptureDecisions?: {
    front?: JsonRecord;
    back?: JsonRecord;
  };
  captureTiming?: JsonRecord;
  ocrPrefill?: JsonRecord;
  assets: AiGraderReportBundleAsset[];
  warnings: string[];
  limitations: string[];
}

export interface AiGraderReportBundleWriteResult {
  bundle: AiGraderReportBundle;
  bundlePath: string;
  assetManifestPath: string;
  checksumsPath: string;
  outputDir: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonIfExists(filePath: string): Promise<JsonRecord | undefined> {
  try {
    const text = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function fileMetadata(filePath: string) {
  const bytes = await readFile(filePath);
  const stats = await stat(filePath);
  return {
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    byteSize: stats.size,
  };
}

function contentTypeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".tif" || extension === ".tiff") return "image/tiff";
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".json") return "application/json";
  return "application/octet-stream";
}

function normalizeLocalPath(filePath: string) {
  return path.resolve(filePath);
}

function isSubpath(childPath: string, parentPath: string) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertReportBundleOutputDirAllowed(outputDir: string, repoRoot = process.cwd()) {
  if (!outputDir) {
    throw new Error("AI Grader report bundle requires an explicit --output-dir outside the git repo.");
  }
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedRepoRoot = path.resolve(repoRoot);
  if (isSubpath(resolvedOutputDir, resolvedRepoRoot)) {
    throw new Error("AI Grader report bundle output directory must be outside the git repo.");
  }
  return resolvedOutputDir;
}

async function maybeAsset(input: {
  id: string;
  kind: AiGraderReportBundleAsset["kind"];
  localPath: string | undefined;
  required: boolean;
  reportId: string;
  includeBody?: boolean;
  side?: "front" | "back";
  evidenceRole?: AiGraderReportBundleEvidenceRole;
}): Promise<AiGraderReportBundleAsset | undefined> {
  if (!input.localPath) return undefined;
  const localPath = normalizeLocalPath(input.localPath);
  try {
    const stats = await stat(localPath);
    if (stats.isDirectory()) {
      return {
        id: input.id,
        kind: "folder",
        localPath,
        publicPathPlaceholder: `/ai-grader/reports/${input.reportId}/assets/${input.id}`,
        required: input.required,
      };
    }
    const contentType = contentTypeForPath(localPath);
    let imageDimensions: { widthPx: number; heightPx: number } | undefined;
    if (input.kind === "image") {
      const expectedFormat = contentType === "image/png"
        ? "png"
        : contentType === "image/jpeg"
          ? "jpeg"
          : contentType === "image/webp"
            ? "webp"
            : contentType === "image/tiff"
              ? "tiff"
              : undefined;
      if (!expectedFormat) throw new Error("Unsupported report image content type.");
      const imageMetadata = await sharp(localPath).metadata();
      if (imageMetadata.format !== expectedFormat || !imageMetadata.width || !imageMetadata.height) {
        throw new Error("Report image bytes do not match the raster file type.");
      }
      imageDimensions = { widthPx: imageMetadata.width, heightPx: imageMetadata.height };
      if (
        imageMetadata.exif ||
        imageMetadata.icc ||
        imageMetadata.iptc ||
        imageMetadata.xmp ||
        imageMetadata.tifftagPhotoshop ||
        imageMetadata.comments?.length
      ) {
        throw new Error("Report image contains private or unapproved embedded metadata.");
      }
    }
    const metadata = await fileMetadata(localPath);
    const body = input.includeBody ? await readFile(localPath) : undefined;
    return {
      id: input.id,
      kind: input.kind,
      localPath,
      fileName: path.basename(localPath),
      contentType,
      publicPathPlaceholder: `/ai-grader/reports/${input.reportId}/assets/${path.basename(localPath)}`,
      required: input.required,
      ...(body ? { bodyEncoding: "base64" as const, bodyBase64: body.toString("base64") } : {}),
      ...(input.side ? { side: input.side } : {}),
      ...(input.evidenceRole ? { evidenceRole: input.evidenceRole } : {}),
      ...imageDimensions,
      ...metadata,
    };
  } catch {
    return input.required
      ? {
          id: input.id,
          kind: input.kind,
          localPath,
          fileName: path.basename(localPath),
          contentType: contentTypeForPath(localPath),
          publicPathPlaceholder: `/ai-grader/reports/${input.reportId}/assets/${path.basename(localPath)}`,
          required: true,
        }
      : undefined;
  }
}

function collectStringRefs(value: unknown, predicate: (key: string, text: string) => boolean, key = ""): string[] {
  if (typeof value === "string") return predicate(key, value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => collectStringRefs(item, predicate, `${key}[${index}]`));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([childKey, childValue]) => collectStringRefs(childValue, predicate, childKey));
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function isImagePath(value: string) {
  return /\.(png|jpe?g|webp|tiff?)$/i.test(value);
}

function normalizeReferencedPath(value: string, baseDir: string) {
  const decoded = value.replace(/&amp;/g, "&").replace(/&#92;/g, "\\");
  if (/^https?:\/\//i.test(decoded) || decoded.startsWith("data:")) return "";
  if (/^[a-z]:\\/i.test(decoded) || path.isAbsolute(decoded)) return path.resolve(decoded);
  return path.resolve(baseDir, decoded);
}

async function imageRefsFromHtml(reportHtmlPath: string, baseDir: string) {
  try {
    const html = await readFile(reportHtmlPath, "utf-8");
    const refs: string[] = [];
    for (const match of html.matchAll(/<img\b[^>]*\bsrc=(["'])(.*?)\1/gi)) {
      const ref = normalizeReferencedPath(match[2] ?? "", baseDir);
      if (ref && isImagePath(ref)) refs.push(ref);
    }
    return refs;
  } catch {
    return [];
  }
}

function evidenceImageAssetId(filePath: string, roots: Array<{ label: string; root: string }>) {
  const resolved = path.resolve(filePath);
  const root = roots.find((candidate) => isSubpath(resolved, candidate.root));
  const relative = root ? path.relative(path.resolve(root.root), resolved) : path.basename(resolved);
  const prefix = root?.label ?? "report";
  return `${prefix}/${relative.replace(/\\/g, "/")}`;
}

function firstRecord(...values: unknown[]): JsonRecord | undefined {
  return values.find(isRecord) as JsonRecord | undefined;
}

function nonemptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function captureProfileVersionForSide(input: {
  side: "front" | "back";
  packageManifest?: JsonRecord;
  analysis?: JsonRecord;
  inputCaptureTiming?: JsonRecord;
}) {
  const packageTiming = firstRecord(input.packageManifest?.captureTiming);
  const analysisTiming = firstRecord(input.analysis?.captureTiming);
  const analysisSideTiming = firstRecord(analysisTiming?.[input.side]);
  const inputSideTiming = firstRecord(input.inputCaptureTiming?.[input.side]);
  const explicitVersion = [
    input.packageManifest?.captureProfileVersion,
    packageTiming?.captureProfileVersion,
    analysisSideTiming?.captureProfileVersion,
    inputSideTiming?.captureProfileVersion,
    input.inputCaptureTiming?.captureProfileVersion,
  ].map(nonemptyString).find(Boolean);
  if (explicitVersion) return explicitVersion;

  const captureProfile = [
    input.packageManifest?.captureProfile,
    packageTiming?.captureProfile,
    analysisSideTiming?.captureProfile,
    inputSideTiming?.captureProfile,
    input.inputCaptureTiming?.captureProfile,
  ].map(nonemptyString).find((value): value is AiGraderCaptureTimingProfile => value === "full_forensic" || value === "production_fast");
  return captureProfile ? AI_GRADER_REPORT_CAPTURE_PROFILE_VERSIONS[captureProfile] : undefined;
}

function artifactOutputPath(value: unknown) {
  return isRecord(value) && typeof value.outputFilePath === "string" ? value.outputFilePath : undefined;
}

function deriveReportId(input: { reportDir: string; reportId?: string; manifest?: JsonRecord; analysis?: JsonRecord }) {
  if (input.reportId) return input.reportId;
  const candidates = [
    input.manifest?.reportId,
    input.manifest?.packageId,
    input.manifest?.session?.reportId,
    input.analysis?.reportId,
    input.analysis?.session?.reportId,
    path.basename(path.resolve(input.reportDir)),
  ];
  const candidate = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return String(candidate ?? `ai-grader-report-${Date.now()}`);
}

function deriveSessionId(manifest?: JsonRecord, analysis?: JsonRecord, reportId?: string) {
  const candidates = [
    manifest?.gradingSessionId,
    manifest?.session?.gradingSessionId,
    manifest?.sessionId,
    analysis?.gradingSessionId,
    analysis?.session?.gradingSessionId,
    reportId,
  ];
  return String(candidates.find((value) => typeof value === "string" && value.trim().length > 0) ?? "local-ai-grader-session");
}

function deriveReportStatus(story?: JsonRecord): AiGraderReportBundle["reportStatus"] {
  if (!story) return "missing_report_data";
  if (story.status === "insufficient_evidence") return "insufficient_evidence";
  return "provisional_diagnostic_ready";
}

function refsForSide(analysis: JsonRecord | undefined, side: "front" | "back") {
  if (!analysis) return [];
  return unique(
    collectStringRefs(analysis, (key, text) => {
      const lowerKey = key.toLowerCase();
      const lowerText = text.toLowerCase();
      return (
        lowerText.includes(side) &&
        (lowerKey.includes("path") || lowerKey.includes("ref") || lowerKey.includes("image")) &&
        /\.(png|jpg|jpeg|html|json)$/i.test(text)
      );
    })
  ).slice(0, 80);
}

function visionRefs(analysis: JsonRecord | undefined, keywords: string[]) {
  if (!analysis) return [];
  return unique(
    collectStringRefs(analysis.visionLab ?? analysis, (key, text) => {
      const haystack = `${key} ${text}`.toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword)) && /\.(png|jpg|jpeg)$/i.test(text);
    })
  ).slice(0, 80);
}

export async function buildAiGraderReportBundle(input: {
  reportDir: string;
  outputDir?: string;
  reportId?: string;
  generatedAt?: string;
  gradingSessionId?: string;
  cardIdentity?: AiGraderReportBundle["cardIdentity"];
  publicBasePath?: string;
  includeAssetBodies?: boolean;
  captureTiming?: JsonRecord;
  geometryCaptureDecisions?: JsonRecord;
  ocrPrefill?: JsonRecord;
}): Promise<AiGraderReportBundle> {
  const reportDir = normalizeLocalPath(input.reportDir);
  const outputDir = normalizeLocalPath(input.outputDir ?? reportDir);
  assertReportBundleOutputDirAllowed(outputDir);

  const manifestPath = path.join(reportDir, "manifest.json");
  const analysisPath = path.join(reportDir, "analysis.json");
  const reportHtmlPath = path.join(reportDir, "provisional-diagnostic-report.html");
  const manifest = await readJsonIfExists(manifestPath);
  const analysis = await readJsonIfExists(analysisPath);
  const reportId = deriveReportId({ reportDir, reportId: input.reportId, manifest, analysis });
  const story = firstRecord(analysis?.provisionalGradeStory, analysis?.visionLab?.provisionalGradeStory, manifest?.provisionalGradeStory);
  const candidates = Array.isArray(story?.gradeImpactCandidates)
    ? story?.gradeImpactCandidates
    : Array.isArray(analysis?.visionLab?.gradeImpactCandidates)
      ? analysis?.visionLab?.gradeImpactCandidates
      : [];
  const warnings = unique([
    ...(Array.isArray(story?.confidence?.warnings) ? story.confidence.warnings.map(String) : []),
    ...(Array.isArray(analysis?.warnings) ? analysis.warnings.map(String) : []),
    ...(Array.isArray(manifest?.warnings) ? manifest.warnings.map(String) : []),
  ]);
  const frontPackageDir = String(manifest?.frontPackageDir ?? manifest?.front?.packageDir ?? analysis?.frontPackageDir ?? "");
  const backPackageDir = String(manifest?.backPackageDir ?? manifest?.back?.packageDir ?? analysis?.backPackageDir ?? "");
  const [frontPackageManifest, backPackageManifest] = await Promise.all([
    frontPackageDir ? readJsonIfExists(path.join(frontPackageDir, "manifest.json")) : undefined,
    backPackageDir ? readJsonIfExists(path.join(backPackageDir, "manifest.json")) : undefined,
  ]);
  const frontNormalized = firstRecord(frontPackageManifest?.front?.normalizedCard, frontPackageManifest?.normalizedCard);
  const backNormalized = firstRecord(backPackageManifest?.back?.normalizedCard, backPackageManifest?.normalizedCard);
  const frontGeometry = firstRecord(frontNormalized?.geometry, frontPackageManifest?.front?.geometry, frontPackageManifest?.geometry);
  const backGeometry = firstRecord(backNormalized?.geometry, backPackageManifest?.back?.geometry, backPackageManifest?.geometry);
  const frontNormalizedImageRef =
    typeof frontNormalized?.normalizedArtifact?.localOutputPath === "string" ? frontNormalized.normalizedArtifact.localOutputPath : "";
  const backNormalizedImageRef =
    typeof backNormalized?.normalizedArtifact?.localOutputPath === "string" ? backNormalized.normalizedArtifact.localOutputPath : "";
  const normalizedImageRefs = [frontNormalizedImageRef, backNormalizedImageRef].filter(Boolean);
  const imageRefs = unique([
    ...(await imageRefsFromHtml(reportHtmlPath, reportDir)),
    ...visionRefs(analysis, ["true", "portrait", "overlay", "channel", "heatmap", "surface vision", "surface-vision", "confidence"]),
    ...normalizedImageRefs,
  ])
    .map((ref) => normalizeReferencedPath(ref, reportDir))
    .filter((ref) => ref && isImagePath(ref));
  const roots = [
    { label: "report", root: reportDir },
    ...(frontPackageDir ? [{ label: "front", root: frontPackageDir }] : []),
    ...(backPackageDir ? [{ label: "back", root: backPackageDir }] : []),
  ];
  const imageEvidenceMetadata = new Map<string, { side: "front" | "back"; evidenceRole: AiGraderReportBundleEvidenceRole }>();
  const registerImageEvidence = (
    localPath: string | undefined,
    side: "front" | "back",
    evidenceRole: AiGraderReportBundleEvidenceRole,
  ) => {
    if (!localPath) return;
    const resolved = normalizeReferencedPath(localPath, reportDir);
    if (resolved) imageEvidenceMetadata.set(path.resolve(resolved), { side, evidenceRole });
  };
  const surfaceRootForAssets = firstRecord(analysis?.surfaceIntelligence);
  const visionSidesForAssets = firstRecord(analysis?.visionLab?.sides);
  for (const side of ["front", "back"] as const) {
    const surfaceSide = firstRecord(surfaceRootForAssets?.[side]) ?? firstRecord(visionSidesForAssets?.[side]);
    registerImageEvidence(side === "front" ? frontNormalizedImageRef : backNormalizedImageRef, side, "normalized_card");
    registerImageEvidence(artifactOutputPath(surfaceSide?.heatmap), side, "surface_heatmap");
    registerImageEvidence(artifactOutputPath(surfaceSide?.surfaceVision), side, "surface_vision");
    registerImageEvidence(artifactOutputPath(surfaceSide?.glareMask), side, "confidence_mask");
    registerImageEvidence(artifactOutputPath(surfaceSide?.underexposureMask), side, "confidence_mask");
  }
  const imageAssets = (
    await Promise.all(
      unique(imageRefs).map((localPath) => {
        const evidenceMetadata = imageEvidenceMetadata.get(path.resolve(localPath));
        return maybeAsset({
          id: evidenceImageAssetId(localPath, roots),
          kind: "image",
          localPath,
          required: false,
          reportId,
          includeBody: input.includeAssetBodies,
          ...evidenceMetadata,
        })
      })
    )
  ).filter((asset): asset is AiGraderReportBundleAsset => Boolean(asset));
  const assets = (
    await Promise.all([
      maybeAsset({ id: "report-html", kind: "report_html", localPath: reportHtmlPath, required: true, reportId }),
      maybeAsset({ id: "manifest", kind: "manifest", localPath: manifestPath, required: true, reportId }),
      maybeAsset({ id: "analysis", kind: "analysis", localPath: analysisPath, required: true, reportId }),
      maybeAsset({ id: "front-package", kind: "folder", localPath: frontPackageDir, required: false, reportId }),
      maybeAsset({ id: "back-package", kind: "folder", localPath: backPackageDir, required: false, reportId }),
    ])
  ).filter((asset): asset is AiGraderReportBundleAsset => Boolean(asset)).concat(imageAssets);
  const imageAssetIds = new Set(imageAssets.map((asset) => asset.id));
  const assetIdForPath = (localPath: string | undefined) => {
    if (!localPath) return undefined;
    const resolved = path.resolve(localPath);
    return imageAssets.find((asset) => path.resolve(asset.localPath) === resolved)?.id;
  };
  const assetSha256ForPath = (localPath: string | undefined) => {
    if (!localPath) return undefined;
    const resolved = path.resolve(localPath);
    return imageAssets.find((asset) => path.resolve(asset.localPath) === resolved)?.sha256;
  };
  const evidenceForSide = (side: "front" | "back", normalizedPath: string | undefined): AiGraderApprovedDefectEvidence => {
    const surfaceRoot = firstRecord(analysis?.surfaceIntelligence);
    const surfaceSide = firstRecord(surfaceRoot?.[side]);
    const visionSides = firstRecord(analysis?.visionLab?.sides);
    const visionSide = firstRecord(visionSides?.[side]);
    const source = surfaceSide ?? visionSide;
    const trueViewAssetId = assetIdForPath(normalizedPath);
    const heatmapAssetId = assetIdForPath(artifactOutputPath(source?.heatmap));
    const surfaceVisionAssetId = assetIdForPath(artifactOutputPath(source?.surfaceVision));
    const maskAssetId = assetIdForPath(artifactOutputPath(source?.glareMask));
    return {
      ...(trueViewAssetId ? { trueViewAssetId } : {}),
      ...(heatmapAssetId ? { heatmapAssetId } : {}),
      ...(surfaceVisionAssetId ? { surfaceVisionAssetId } : {}),
      ...(maskAssetId ? { maskAssetId } : {}),
      channelAssetIds: [],
      roiAssetIds: [],
    };
  };
  const defectExtraction = extractAiGraderDefectFindingsV1(analysis, {
    approvedEvidenceBySide: {
      front: evidenceForSide("front", frontNormalizedImageRef),
      back: evidenceForSide("back", backNormalizedImageRef),
    },
    normalizedSourceSha256BySide: {
      front: typeof frontNormalized?.normalizedArtifact?.sourceSha256 === "string"
        ? frontNormalized.normalizedArtifact.sourceSha256
        : undefined,
      back: typeof backNormalized?.normalizedArtifact?.sourceSha256 === "string"
        ? backNormalized.normalizedArtifact.sourceSha256
        : undefined,
    },
    normalizedArtifactSha256BySide: {
      front: assetSha256ForPath(frontNormalizedImageRef),
      back: assetSha256ForPath(backNormalizedImageRef),
    },
    captureProfileVersionBySide: {
      front: captureProfileVersionForSide({
        side: "front",
        packageManifest: frontPackageManifest,
        analysis,
        inputCaptureTiming: input.captureTiming,
      }),
      back: captureProfileVersionForSide({
        side: "back",
        packageManifest: backPackageManifest,
        analysis,
        inputCaptureTiming: input.captureTiming,
      }),
    },
    requireNormalizedSourceMatch: true,
    knownAssetIds: imageAssetIds,
    requireTrueViewAsset: true,
  });
  const linkedCandidates = candidates.map((candidate: unknown) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string") return candidate;
    const findingId = candidate.side === "front" || candidate.side === "back"
      ? defectExtraction.sourceCandidateFindingIds[`${candidate.side}:${candidate.id}`]
      : undefined;
    return findingId ? { ...candidate, findingIds: [findingId] } : candidate;
  });

  return {
    schemaVersion: AI_GRADER_REPORT_BUNDLE_VERSION,
    reportProducer: {
      contractVersion: AI_GRADER_REPORT_PRODUCER_CONTRACT_VERSION,
      capabilities: [...AI_GRADER_REPORT_PRODUCER_CAPABILITIES],
    },
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    gradingSessionId: input.gradingSessionId ?? deriveSessionId(manifest, analysis, reportId),
    reportId,
    reportStatus: deriveReportStatus(story),
    provisionalStatus: "provisional_diagnostic",
    finalStatus: "not_computed",
    finalGradeComputed: false,
    certifiedClaim: false,
    labelGenerated: false,
    qrGenerated: false,
    certificateGenerated: false,
    localReportFolder: reportDir,
    reportHtmlPath,
    manifestPath,
    analysisPath,
    publicPathPlaceholders: {
      reportViewerRoute: "/ai-grader/reports/[reportId]",
      reportUrlTemplate: `${input.publicBasePath ?? "/ai-grader/reports"}/{reportId}`,
      assetBaseUrlTemplate: `${input.publicBasePath ?? "/ai-grader/reports"}/{reportId}/assets`,
      uploadStorageKeyPrefix: `ai-grader/reports/${reportId}/`,
    },
    cardIdentity: input.cardIdentity ?? {
      cardAssetId: typeof manifest?.cardAssetId === "string" ? manifest.cardAssetId : undefined,
      title: typeof manifest?.cardTitle === "string" ? manifest.cardTitle : "Ten Kings AI Grader report",
      sideCount: 2,
      futureSlabbedPhotoRefsReserved: true,
      futureEbayCompsRefsReserved: true,
    },
    provisionalGrade: story
      ? {
          status: story.status,
          overall: typeof story.provisionalOverallGrade === "number" ? story.provisionalOverallGrade : undefined,
          elementScores: firstRecord(story.elementScores),
          confidence: firstRecord(story.confidence),
          gates: firstRecord(story.gates),
          gradeStory: firstRecord(story.story),
          whyNot10: Array.isArray(story.whyNot10) ? story.whyNot10 : [],
          gradeImpactCandidates: linkedCandidates,
        }
      : undefined,
    evidenceReferences: {
      frontPackageDir: frontPackageDir || undefined,
      backPackageDir: backPackageDir || undefined,
      frontEvidenceRefs: refsForSide(analysis, "front"),
      backEvidenceRefs: refsForSide(analysis, "back"),
    },
    visionLab: {
      available: isRecord(analysis?.visionLab),
      ...(defectExtraction.findings.length ? { defectFindings: defectExtraction.findings } : {}),
      findingValidation: {
        status:
          defectExtraction.issues.length === 0 &&
          defectExtraction.sourceCandidateCount === defectExtraction.findings.length
            ? "valid"
            : "invalid",
        sourceCandidateCount: defectExtraction.sourceCandidateCount,
        publishedFindingCount: defectExtraction.findings.length,
        issues: defectExtraction.issues,
      },
      trueViewRefs: visionRefs(analysis, ["true", "portrait"]),
      overlayRefs: visionRefs(analysis, ["overlay"]),
      channelImageRefs: visionRefs(analysis, ["channel"]),
      heatmapRefs: visionRefs(analysis, ["heatmap"]),
      surfaceVisionRefs: visionRefs(analysis, ["surface vision", "surface-vision"]),
      confidenceRefs: visionRefs(analysis, ["confidence"]),
      candidateCount: candidates.length,
      missingDataWarnings: isRecord(analysis?.visionLab)
        ? []
        : ["Vision Lab data was not found in analysis.json; public viewer must show a missing-data state."],
    },
    calibrationProfile: firstRecord(analysis?.calibrationProfile, manifest?.calibrationProfile),
    rulerCalibration: firstRecord(analysis?.rulerCalibration, manifest?.rulerCalibration, manifest?.fixedRigCalibrationProfile),
    lightingProfile: firstRecord(analysis?.acceptedLightingProfile, manifest?.acceptedLightingProfile),
    geometry: {
      ...(frontGeometry ? { front: frontGeometry } : {}),
      ...(backGeometry ? { back: backGeometry } : {}),
    },
    ...(input.geometryCaptureDecisions ? { geometryCaptureDecisions: input.geometryCaptureDecisions } : {}),
    captureTiming:
      input.captureTiming ??
      ({
        front: firstRecord(frontPackageManifest?.captureTiming),
        back: firstRecord(backPackageManifest?.captureTiming),
        frontProcessing: firstRecord(frontPackageManifest?.processingTiming),
        backProcessing: firstRecord(backPackageManifest?.processingTiming),
      } as JsonRecord),
    ...(input.ocrPrefill ? { ocrPrefill: input.ocrPrefill } : {}),
    assets,
    warnings: [
      ...warnings,
      ...(defectExtraction.issues.length
        ? [`${defectExtraction.issues.length} defect-finding extraction validation issue(s) require publication to fail closed.`]
        : []),
    ],
    limitations: [
      "Provisional Diagnostic Grade only.",
      "Not Certified.",
      "No Final Grade.",
      "No Label.",
      "No Certificate.",
      "No QR Certificate Yet.",
      "No database write or public storage upload is performed by this bundle export.",
    ],
  };
}

export async function writeAiGraderReportBundle(input: {
  reportDir: string;
  outputDir?: string;
  reportId?: string;
  generatedAt?: string;
  gradingSessionId?: string;
  cardIdentity?: AiGraderReportBundle["cardIdentity"];
  publicBasePath?: string;
  captureTiming?: JsonRecord;
  geometryCaptureDecisions?: JsonRecord;
  ocrPrefill?: JsonRecord;
  copyDerivedAssets?: boolean;
  artifactReferenceDir?: string;
  transformBundle?: (bundle: AiGraderReportBundle) => void;
}): Promise<AiGraderReportBundleWriteResult> {
  const outputDir = normalizeLocalPath(input.outputDir ?? input.reportDir);
  assertReportBundleOutputDirAllowed(outputDir);
  await mkdir(outputDir, { recursive: true });
  const bundle = await buildAiGraderReportBundle({ ...input, outputDir });
  if (input.copyDerivedAssets) {
    const stagedAssetsDir = path.join(outputDir, "assets");
    const referencedAssetsDir = path.join(path.resolve(input.artifactReferenceDir ?? outputDir), "assets");
    const sourceRoots = await Promise.all([
      bundle.localReportFolder,
      bundle.evidenceReferences.frontPackageDir,
      bundle.evidenceReferences.backPackageDir,
    ].filter((value): value is string => Boolean(value)).map((value) => realpath(value)));
    await mkdir(stagedAssetsDir, { recursive: true });
    for (const asset of bundle.assets) {
      if (asset.kind === "folder" || !asset.sha256 || typeof asset.byteSize !== "number") continue;
      const sourcePath = await realpath(asset.localPath);
      if (!sourceRoots.some((root) => isSubpath(sourcePath, root))) {
        throw new Error("AI Grader report asset is outside the immutable report evidence roots.");
      }
      const safeBaseName = path.basename(asset.localPath).replace(/[^A-Za-z0-9._-]/g, "_") || "artifact.bin";
      const stablePrefix = crypto.createHash("sha256").update(asset.id).digest("hex").slice(0, 12);
      const packagedFileName = stablePrefix + "-" + safeBaseName;
      await copyFile(sourcePath, path.join(stagedAssetsDir, packagedFileName));
      asset.localPath = path.join(referencedAssetsDir, packagedFileName);
    }
  }
  input.transformBundle?.(bundle);
  const bundlePath = path.join(outputDir, "report-bundle.json");
  const assetManifestPath = path.join(outputDir, "asset-manifest.json");
  const checksumsPath = path.join(outputDir, "checksums.json");
  const checksums = bundle.assets
    .filter((asset) => asset.sha256)
    .map((asset) => ({
      id: asset.id,
      localPath: asset.localPath,
      sha256: asset.sha256,
      byteSize: asset.byteSize,
    }));
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf-8");
  await writeFile(assetManifestPath, `${JSON.stringify({ reportId: bundle.reportId, assets: bundle.assets }, null, 2)}\n`, "utf-8");
  await writeFile(checksumsPath, `${JSON.stringify({ reportId: bundle.reportId, checksums }, null, 2)}\n`, "utf-8");
  return {
    bundle,
    bundlePath,
    assetManifestPath,
    checksumsPath,
    outputDir,
  };
}
