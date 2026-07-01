import crypto from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const AI_GRADER_REPORT_BUNDLE_VERSION = "ai-grader-report-bundle-v0.1";

type JsonRecord = Record<string, any>;

export interface AiGraderReportBundleAsset {
  id: string;
  kind: "report_html" | "manifest" | "analysis" | "image" | "data" | "folder" | "unknown";
  localPath: string;
  publicPathPlaceholder?: string;
  sha256?: string;
  byteSize?: number;
  required: boolean;
}

export interface AiGraderReportBundle {
  schemaVersion: typeof AI_GRADER_REPORT_BUNDLE_VERSION;
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
    const metadata = await fileMetadata(localPath);
    return {
      id: input.id,
      kind: input.kind,
      localPath,
      publicPathPlaceholder: `/ai-grader/reports/${input.reportId}/assets/${path.basename(localPath)}`,
      required: input.required,
      ...metadata,
    };
  } catch {
    return input.required
      ? {
          id: input.id,
          kind: input.kind,
          localPath,
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

function firstRecord(...values: unknown[]): JsonRecord | undefined {
  return values.find(isRecord) as JsonRecord | undefined;
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
  publicBasePath?: string;
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
  const assets = (
    await Promise.all([
      maybeAsset({ id: "report-html", kind: "report_html", localPath: reportHtmlPath, required: true, reportId }),
      maybeAsset({ id: "manifest", kind: "manifest", localPath: manifestPath, required: true, reportId }),
      maybeAsset({ id: "analysis", kind: "analysis", localPath: analysisPath, required: true, reportId }),
      maybeAsset({ id: "front-package", kind: "folder", localPath: frontPackageDir, required: false, reportId }),
      maybeAsset({ id: "back-package", kind: "folder", localPath: backPackageDir, required: false, reportId }),
    ])
  ).filter((asset): asset is AiGraderReportBundleAsset => Boolean(asset));

  return {
    schemaVersion: AI_GRADER_REPORT_BUNDLE_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    gradingSessionId: deriveSessionId(manifest, analysis, reportId),
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
    cardIdentity: {
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
          gradeStory: firstRecord(story.story),
          whyNot10: Array.isArray(story.whyNot10) ? story.whyNot10 : [],
          gradeImpactCandidates: candidates,
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
    assets,
    warnings,
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
  publicBasePath?: string;
}): Promise<AiGraderReportBundleWriteResult> {
  const outputDir = normalizeLocalPath(input.outputDir ?? input.reportDir);
  assertReportBundleOutputDirAllowed(outputDir);
  await mkdir(outputDir, { recursive: true });
  const bundle = await buildAiGraderReportBundle({ ...input, outputDir });
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
