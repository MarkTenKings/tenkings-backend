import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildAiGraderReportBundle,
  type AiGraderReportBundle,
} from "./aiGraderReportBundle";

export const AI_GRADER_PRODUCTION_RELEASE_VERSION = "ai-grader-production-release-v0.1";

type JsonRecord = Record<string, any>;

export type AiGraderProductionGateStatus = "pass" | "accepted_warning" | "fail";

export interface AiGraderProductionGate {
  id: string;
  label: string;
  status: AiGraderProductionGateStatus;
  reason: string;
  evidenceRefs: string[];
}

export interface AiGraderFinalElementScore {
  score: number;
  confidence: string;
  sourceStatus?: string;
  explanation: string;
}

export interface AiGraderFinalGrade {
  status: "final_ai_grader_grade_v0" | "insufficient_evidence";
  overall?: number;
  elements: Record<"centering" | "corners" | "edges" | "surface", AiGraderFinalElementScore | undefined>;
  confidence: {
    score: number;
    band: "low" | "medium" | "high";
    warnings: string[];
  };
  gradeImpactReasons: Array<{
    id: string;
    category: string;
    side: string;
    severity: string;
    confidence: string;
    explanation: string;
    evidenceRefs: string[];
  }>;
  whyNot10: Array<{
    id: string;
    title: string;
    explanation: string;
    evidenceRefs: string[];
  }>;
  finalGradeComputed: boolean;
  certifiedClaim: false;
}

export interface AiGraderLabelData {
  status: "label_data_ready" | "blocked_insufficient_evidence";
  labelVersion: "ten-kings-ai-grader-label-v0";
  reportId: string;
  certId: string;
  publicReportUrl: string;
  qrPayloadUrl: string;
  labelGradeText: string;
  elementScores: Record<string, number | undefined>;
  cardIdentity: AiGraderReportBundle["cardIdentity"];
  certificateStatus: "report_id_issued_not_certified" | "not_issued";
  certifiedClaim: false;
}

export interface AiGraderPublicationManifest {
  status: "local_bundle_ready" | "blocked_insufficient_evidence";
  reportId: string;
  publicReportUrl: string;
  qrPayloadUrl: string;
  storageMode: "local_artifact_only";
  dbWritesPerformed: false;
  migrationsRun: false;
  uploadPerformed: false;
  storageKeyPrefix: string;
  reportBundlePath?: string;
  productionReleasePath?: string;
  labelDataPath?: string;
  requiredFutureProductionSteps: string[];
}

export interface AiGraderProductionRelease {
  schemaVersion: typeof AI_GRADER_PRODUCTION_RELEASE_VERSION;
  generatedAt: string;
  gradingSessionId: string;
  reportId: string;
  reportStatus: "final_ai_grader_report_v0" | "insufficient_evidence";
  finalStatus: "final_grade_computed" | "insufficient_evidence";
  finalGradeComputed: boolean;
  certifiedClaim: false;
  certificateGenerated: false;
  labelDataGenerated: boolean;
  qrPayloadGenerated: boolean;
  gates: AiGraderProductionGate[];
  finalGrade: AiGraderFinalGrade;
  operatorFinalization: {
    operatorId: string;
    finalizedAt: string;
    warningsAccepted: boolean;
    overrideReason?: string;
    acceptedWarningGateIds: string[];
  };
  publication: AiGraderPublicationManifest;
  label: AiGraderLabelData;
  cardIdentity: AiGraderReportBundle["cardIdentity"];
  evidenceReferences: AiGraderReportBundle["evidenceReferences"];
  visionLab: AiGraderReportBundle["visionLab"];
  calibrationProfile?: JsonRecord;
  rulerCalibration?: JsonRecord;
  lightingProfile?: JsonRecord;
  slabbedPhotoContract: {
    status: "reserved_not_uploaded";
    frontPhotoRef?: string;
    backPhotoRef?: string;
    note: string;
  };
  ebayCompsContract: {
    status: "not_run";
    valuationStatus: "pending_card_identity_and_final_sale_context";
    compsRefs: string[];
    note: string;
  };
  cardInventoryLinkage: {
    status: "contract_ready_not_persisted";
    cardAssetId?: string;
    itemId?: string;
    note: string;
  };
  databaseIntegration: {
    existingModels: string[];
    migrationsAdded: true;
    migrationsRun: false;
    productionDbWritesPerformed: false;
    recommendedPersistPath: string[];
  };
  storageIntegration: {
    mode: "local_bundle_only";
    uploadPerformed: false;
    storageKeyPrefix: string;
    recommendedUploadPath: string;
  };
  warnings: string[];
  limitations: string[];
}

export interface AiGraderProductionReleaseWriteResult {
  productionRelease: AiGraderProductionRelease;
  productionReleasePath: string;
  labelDataPath: string;
  publicationManifestPath: string;
  integrationContractPath: string;
  outputDir: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSubpath(childPath: string, parentPath: string) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertProductionOutputDirAllowed(outputDir: string, repoRoot = process.cwd()) {
  if (!outputDir) {
    throw new Error("AI Grader production release requires an explicit --output-dir outside the git repo.");
  }
  const resolvedOutputDir = path.resolve(outputDir);
  if (isSubpath(resolvedOutputDir, path.resolve(repoRoot))) {
    throw new Error("AI Grader production release output directory must be outside the git repo.");
  }
  return resolvedOutputDir;
}

function clampGrade(value: unknown, fallback = 0) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Number(Math.max(1, Math.min(10, numeric)).toFixed(2));
}

function confidenceBand(score: number): "low" | "medium" | "high" {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

function publicReportUrl(reportId: string, publicBaseUrl?: string) {
  const base = (publicBaseUrl ?? "https://collect.tenkings.co").replace(/\/$/, "");
  return `${base}/ai-grader/reports/${encodeURIComponent(reportId)}`;
}

function certId(reportId: string) {
  const hash = crypto.createHash("sha1").update(reportId).digest("hex").slice(0, 8).toUpperCase();
  return `TK-AIG-${hash}`;
}

function hasCalibration(bundle: AiGraderReportBundle) {
  const ruler = bundle.rulerCalibration;
  const calibration = bundle.calibrationProfile;
  return Boolean(
    isRecord(ruler) ||
      (isRecord(calibration) && (typeof calibration.mmPerPixelX === "number" || typeof calibration.pixelPerMmX === "number"))
  );
}

function hasEvidence(bundle: AiGraderReportBundle, side: "front" | "back") {
  const refs = side === "front" ? bundle.evidenceReferences.frontEvidenceRefs : bundle.evidenceReferences.backEvidenceRefs;
  const packageDir = side === "front" ? bundle.evidenceReferences.frontPackageDir : bundle.evidenceReferences.backPackageDir;
  return Boolean(packageDir || refs.length > 0);
}

function hasSurfaceIntelligence(bundle: AiGraderReportBundle) {
  return (
    bundle.visionLab.available &&
    (bundle.visionLab.heatmapRefs.length > 0 ||
      bundle.visionLab.surfaceVisionRefs.length > 0 ||
      bundle.visionLab.candidateCount > 0)
  );
}

function warningMentions(bundle: AiGraderReportBundle, pattern: RegExp) {
  const text = [...bundle.warnings, ...bundle.limitations, ...(bundle.provisionalGrade?.confidence?.warnings ?? [])].join(" ");
  return pattern.test(text);
}

function gate(
  id: string,
  label: string,
  passed: boolean,
  reason: string,
  evidenceRefs: string[],
  warningsAccepted: boolean,
  warningAllowed = true
): AiGraderProductionGate {
  if (passed) return { id, label, status: "pass", reason, evidenceRefs };
  if (warningsAccepted && warningAllowed) {
    return {
      id,
      label,
      status: "accepted_warning",
      reason: `${reason} Operator accepted this as a V0 production warning.`,
      evidenceRefs,
    };
  }
  return { id, label, status: "fail", reason, evidenceRefs };
}

function buildProductionGates(bundle: AiGraderReportBundle, warningsAccepted: boolean): AiGraderProductionGate[] {
  const clippingWarning = warningMentions(bundle, /clipping|saturat/i);
  const focusWarning = warningMentions(bundle, /focus|sharp|blur/i);
  return [
    gate("ruler_calibration", "Ruler calibration", hasCalibration(bundle), "Ruler/fixed fixture calibration metadata is required.", ["bundle.rulerCalibration"], warningsAccepted),
    gate("repeatability", "Repeatability", !warningMentions(bundle, /repeatability.*fail/i), "Repeatability must pass or be operator-accepted.", ["bundle.warnings"], warningsAccepted),
    gate("framing_overlay", "Framing and overlay", !warningMentions(bundle, /framing.*fail|overlay.*fail/i), "Framing/overlay gate must pass or be operator-accepted.", ["bundle.calibrationProfile", "bundle.warnings"], warningsAccepted),
    gate("front_evidence", "Front evidence", hasEvidence(bundle, "front"), "Front evidence package or references are required.", ["bundle.evidenceReferences.front"], warningsAccepted, false),
    gate("back_evidence", "Back evidence", hasEvidence(bundle, "back"), "Back evidence package or references are required.", ["bundle.evidenceReferences.back"], warningsAccepted, false),
    gate("surface_intelligence", "Surface intelligence", hasSurfaceIntelligence(bundle), "Surface Intelligence/Vision Lab artifacts are required.", ["bundle.visionLab"], warningsAccepted),
    gate("clipping", "Clipping control", !clippingWarning, "Clipping warnings reduce confidence and must be accepted.", ["bundle.warnings", "bundle.provisionalGrade.confidence"], warningsAccepted),
    gate("focus", "Focus/sharpness", !focusWarning, "Focus or sharpness warnings reduce confidence and must be accepted.", ["bundle.warnings", "bundle.provisionalGrade.confidence"], warningsAccepted),
  ];
}

function finalElement(bundle: AiGraderReportBundle, key: "centering" | "corners" | "edges" | "surface"): AiGraderFinalElementScore | undefined {
  const source = bundle.provisionalGrade?.elementScores?.[key];
  if (!source || typeof source.score !== "number") return undefined;
  return {
    score: clampGrade(source.score),
    confidence: source.confidence ?? bundle.provisionalGrade?.confidence?.band ?? "low",
    sourceStatus: source.status,
    explanation: source.explanation ?? `${key} score was promoted from the evidence-grounded provisional diagnostic result.`,
  };
}

function buildFinalGrade(bundle: AiGraderReportBundle, gates: AiGraderProductionGate[]): AiGraderFinalGrade {
  const failed = gates.filter((item) => item.status === "fail");
  const acceptedWarnings = gates.filter((item) => item.status === "accepted_warning");
  if (failed.length > 0 || typeof bundle.provisionalGrade?.overall !== "number") {
    return {
      status: "insufficient_evidence",
      elements: {
        centering: finalElement(bundle, "centering"),
        corners: finalElement(bundle, "corners"),
        edges: finalElement(bundle, "edges"),
        surface: finalElement(bundle, "surface"),
      },
      confidence: {
        score: 0,
        band: "low",
        warnings: failed.map((item) => `${item.label}: ${item.reason}`),
      },
      gradeImpactReasons: [],
      whyNot10: [],
      finalGradeComputed: false,
      certifiedClaim: false,
    };
  }

  const sourceConfidence = bundle.provisionalGrade.confidence?.score;
  const warningPenalty = acceptedWarnings.length * 0.08;
  const confidenceScore = Number(Math.max(0.1, Math.min(0.95, (typeof sourceConfidence === "number" ? sourceConfidence : 0.72) - warningPenalty)).toFixed(3));
  const candidateReasons = (bundle.provisionalGrade.gradeImpactCandidates ?? []).map((candidate) => ({
    id: candidate.id,
    category: candidate.category,
    side: candidate.side,
    severity: candidate.severity,
    confidence: candidate.confidence,
    explanation: candidate.explanation,
    evidenceRefs: candidate.evidenceRefs,
  }));
  const whyNot10 = (bundle.provisionalGrade.whyNot10 ?? []).map((reason, index) => ({
    id: String(reason.id ?? `why-not-10-${index + 1}`),
    title: String(reason.title ?? "Grade impact reason"),
    explanation: String(reason.explanation ?? "Evidence-linked grade impact reason."),
    evidenceRefs: Array.isArray(reason.evidenceRefs) ? reason.evidenceRefs.map(String) : [],
  }));
  return {
    status: "final_ai_grader_grade_v0",
    overall: clampGrade(bundle.provisionalGrade.overall),
    elements: {
      centering: finalElement(bundle, "centering"),
      corners: finalElement(bundle, "corners"),
      edges: finalElement(bundle, "edges"),
      surface: finalElement(bundle, "surface"),
    },
    confidence: {
      score: confidenceScore,
      band: confidenceBand(confidenceScore),
      warnings: [
        ...(bundle.provisionalGrade.confidence?.warnings ?? []),
        ...acceptedWarnings.map((item) => `${item.label} accepted as warning.`),
      ],
    },
    gradeImpactReasons: candidateReasons,
    whyNot10,
    finalGradeComputed: true,
    certifiedClaim: false,
  };
}

export function buildAiGraderProductionRelease(input: {
  bundle: AiGraderReportBundle;
  generatedAt?: string;
  operatorId?: string;
  warningsAccepted?: boolean;
  overrideReason?: string;
  publicBaseUrl?: string;
  reportBundlePath?: string;
}): AiGraderProductionRelease {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const warningsAccepted = input.warningsAccepted === true;
  const gates = buildProductionGates(input.bundle, warningsAccepted);
  const finalGrade = buildFinalGrade(input.bundle, gates);
  const reportUrl = publicReportUrl(input.bundle.reportId, input.publicBaseUrl);
  const nextCertId = certId(input.bundle.reportId);
  const storageKeyPrefix = `ai-grader/reports/${input.bundle.reportId}/`;
  const label: AiGraderLabelData = {
    status: finalGrade.finalGradeComputed ? "label_data_ready" : "blocked_insufficient_evidence",
    labelVersion: "ten-kings-ai-grader-label-v0",
    reportId: input.bundle.reportId,
    certId: nextCertId,
    publicReportUrl: reportUrl,
    qrPayloadUrl: reportUrl,
    labelGradeText: finalGrade.finalGradeComputed && typeof finalGrade.overall === "number" ? finalGrade.overall.toFixed(1) : "PENDING",
    elementScores: {
      centering: finalGrade.elements.centering?.score,
      corners: finalGrade.elements.corners?.score,
      edges: finalGrade.elements.edges?.score,
      surface: finalGrade.elements.surface?.score,
    },
    cardIdentity: input.bundle.cardIdentity,
    certificateStatus: finalGrade.finalGradeComputed ? "report_id_issued_not_certified" : "not_issued",
    certifiedClaim: false,
  };
  const publication: AiGraderPublicationManifest = {
    status: finalGrade.finalGradeComputed ? "local_bundle_ready" : "blocked_insufficient_evidence",
    reportId: input.bundle.reportId,
    publicReportUrl: reportUrl,
    qrPayloadUrl: reportUrl,
    storageMode: "local_artifact_only",
    dbWritesPerformed: false,
    migrationsRun: false,
    uploadPerformed: false,
    storageKeyPrefix,
    reportBundlePath: input.reportBundlePath,
    requiredFutureProductionSteps: [
      "Initialize production publish with small manifest JSON, then upload report-bundle.json, production-release.json, label-data.json, manifests, and referenced assets directly to storage using presigned URLs.",
      "Apply the reviewed AI Grader production-release migration through the approved runbook.",
      "Persist AiGraderSession, AiGraderReport, AiGraderEvidenceAsset, AiGraderGrade, AiGraderLabel, AiGraderPublication, and AiGraderValuation through the env-gated admin API.",
      "Bind slabbed front/back color photos after physical encapsulation.",
      "Run valuation/comps lookup only after card identity and final sale workflow are approved.",
    ],
  };

  return {
    schemaVersion: AI_GRADER_PRODUCTION_RELEASE_VERSION,
    generatedAt,
    gradingSessionId: input.bundle.gradingSessionId,
    reportId: input.bundle.reportId,
    reportStatus: finalGrade.finalGradeComputed ? "final_ai_grader_report_v0" : "insufficient_evidence",
    finalStatus: finalGrade.finalGradeComputed ? "final_grade_computed" : "insufficient_evidence",
    finalGradeComputed: finalGrade.finalGradeComputed,
    certifiedClaim: false,
    certificateGenerated: false,
    labelDataGenerated: label.status === "label_data_ready",
    qrPayloadGenerated: label.status === "label_data_ready",
    gates,
    finalGrade,
    operatorFinalization: {
      operatorId: input.operatorId ?? "local-operator",
      finalizedAt: generatedAt,
      warningsAccepted,
      ...(input.overrideReason ? { overrideReason: input.overrideReason } : {}),
      acceptedWarningGateIds: gates.filter((item) => item.status === "accepted_warning").map((item) => item.id),
    },
    publication,
    label,
    cardIdentity: input.bundle.cardIdentity,
    evidenceReferences: input.bundle.evidenceReferences,
    visionLab: input.bundle.visionLab,
    calibrationProfile: input.bundle.calibrationProfile,
    rulerCalibration: input.bundle.rulerCalibration,
    lightingProfile: input.bundle.lightingProfile,
    slabbedPhotoContract: {
      status: "reserved_not_uploaded",
      note: "Slabbed color photos are separate from Basler evidence and will attach after physical encapsulation.",
    },
    ebayCompsContract: {
      status: "not_run",
      valuationStatus: "pending_card_identity_and_final_sale_context",
      compsRefs: [],
      note: "No live SerpAPI/eBay lookup is run by Production Release V0.",
    },
    cardInventoryLinkage: {
      status: "contract_ready_not_persisted",
      cardAssetId: input.bundle.cardIdentity.cardAssetId,
      note: "Production Release V0 emits linkage fields but performs no DB write.",
    },
    databaseIntegration: {
      existingModels: ["AiGraderSession", "AiGraderReport", "AiGraderEvidenceAsset", "AiGraderGrade", "AiGraderLabel", "AiGraderPublication", "AiGraderValuation", "CardAsset", "Item", "PackLabel", "QrCode"],
      migrationsAdded: true,
      migrationsRun: false,
      productionDbWritesPerformed: false,
      recommendedPersistPath: [
        "Run reviewed migration only through the approved deploy/migration runbook.",
        "Enable AI_GRADER_PRODUCTION_PUBLISH_ENABLED=true only after migration and storage are ready.",
        "POST small manifest JSON to /api/admin/ai-grader/production/publish-init, upload artifacts directly to storage, then POST small upload manifest JSON to /api/admin/ai-grader/production/publish-finalize.",
      ],
    },
    storageIntegration: {
      mode: "local_bundle_only",
      uploadPerformed: false,
      storageKeyPrefix,
      recommendedUploadPath: "Reuse frontend/nextjs-app/lib/server/storage.ts presign helpers so image bytes never pass through Vercel request or response bodies.",
    },
    warnings: [
      ...input.bundle.warnings,
      ...finalGrade.confidence.warnings,
      "Production Release V0 computes a final AI-Grader grade, but certified grading claims remain disabled.",
    ],
    limitations: [
      "No production DB write was performed by Codex.",
      "No production storage upload was performed by Codex.",
      "No physical label printing is performed.",
      "QR payload URL is emitted as data only.",
      "Certificate/report ID is reserved data and is not a certified claim.",
    ],
  };
}

async function readBundleFromPath(bundlePath: string): Promise<AiGraderReportBundle> {
  const parsed = JSON.parse(await readFile(path.resolve(bundlePath), "utf-8"));
  if (!isRecord(parsed) || parsed.schemaVersion !== "ai-grader-report-bundle-v0.1") {
    throw new Error("AI Grader production release requires a valid report-bundle.json.");
  }
  return parsed as AiGraderReportBundle;
}

export async function writeAiGraderProductionRelease(input: {
  reportBundlePath?: string;
  reportDir?: string;
  outputDir: string;
  reportId?: string;
  generatedAt?: string;
  operatorId?: string;
  warningsAccepted?: boolean;
  overrideReason?: string;
  publicBaseUrl?: string;
  publicBasePath?: string;
}): Promise<AiGraderProductionReleaseWriteResult> {
  const outputDir = assertProductionOutputDirAllowed(input.outputDir);
  await mkdir(outputDir, { recursive: true });
  const bundle = input.reportBundlePath
    ? await readBundleFromPath(input.reportBundlePath)
    : await buildAiGraderReportBundle({
        reportDir: input.reportDir ?? "",
        outputDir,
        reportId: input.reportId,
        publicBasePath: input.publicBasePath,
      });
  const productionRelease = buildAiGraderProductionRelease({
    bundle,
    generatedAt: input.generatedAt,
    operatorId: input.operatorId,
    warningsAccepted: input.warningsAccepted,
    overrideReason: input.overrideReason,
    publicBaseUrl: input.publicBaseUrl,
    reportBundlePath: input.reportBundlePath,
  });
  const productionReleasePath = path.join(outputDir, "production-release.json");
  const labelDataPath = path.join(outputDir, "label-data.json");
  const publicationManifestPath = path.join(outputDir, "publication-manifest.json");
  const integrationContractPath = path.join(outputDir, "integration-contract.json");
  productionRelease.publication.productionReleasePath = productionReleasePath;
  productionRelease.publication.labelDataPath = labelDataPath;

  await writeFile(productionReleasePath, `${JSON.stringify(productionRelease, null, 2)}\n`, "utf-8");
  await writeFile(labelDataPath, `${JSON.stringify(productionRelease.label, null, 2)}\n`, "utf-8");
  await writeFile(publicationManifestPath, `${JSON.stringify(productionRelease.publication, null, 2)}\n`, "utf-8");
  await writeFile(
    integrationContractPath,
    `${JSON.stringify(
      {
        reportId: productionRelease.reportId,
        gradingSessionId: productionRelease.gradingSessionId,
        finalGrade: productionRelease.finalGrade,
        label: productionRelease.label,
        databaseIntegration: productionRelease.databaseIntegration,
        storageIntegration: productionRelease.storageIntegration,
        slabbedPhotoContract: productionRelease.slabbedPhotoContract,
        ebayCompsContract: productionRelease.ebayCompsContract,
        cardInventoryLinkage: productionRelease.cardInventoryLinkage,
      },
      null,
      2
    )}\n`,
    "utf-8"
  );
  return {
    productionRelease,
    productionReleasePath,
    labelDataPath,
    publicationManifestPath,
    integrationContractPath,
    outputDir,
  };
}
