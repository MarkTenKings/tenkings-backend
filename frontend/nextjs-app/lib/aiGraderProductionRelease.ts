import type { AiGraderReportBundle, AiGraderReportElementKey } from "./aiGraderReportBundle";

export const AI_GRADER_PRODUCTION_RELEASE_VERSION = "ai-grader-production-release-v0.1";

export type AiGraderProductionGateStatus = "pass" | "accepted_warning" | "fail";

export type AiGraderProductionGate = {
  id: string;
  label: string;
  status: AiGraderProductionGateStatus;
  reason: string;
  evidenceRefs: string[];
};

export type AiGraderFinalElementScore = {
  score: number;
  confidence: string;
  sourceStatus?: string;
  explanation: string;
};

export type AiGraderFinalGrade = {
  status: "final_ai_grader_grade_v0" | "insufficient_evidence";
  overall?: number;
  elements: Partial<Record<AiGraderReportElementKey, AiGraderFinalElementScore>>;
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
};

export type AiGraderLabelData = {
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
};

export type AiGraderProductionRelease = {
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
  publication: {
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
  };
  label: AiGraderLabelData;
  warnings: string[];
  limitations: string[];
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
  slabbedPhotoContract: { status: "reserved_not_uploaded"; note: string; frontPhotoRef?: string; backPhotoRef?: string };
  ebayCompsContract: { status: "not_run"; valuationStatus: "pending_card_identity_and_final_sale_context"; compsRefs: string[]; note: string };
  cardInventoryLinkage: { status: "contract_ready_not_persisted"; cardAssetId?: string; itemId?: string; note: string };
};

function certId(reportId: string) {
  let hash = 0;
  for (let index = 0; index < reportId.length; index += 1) {
    hash = (hash * 31 + reportId.charCodeAt(index)) >>> 0;
  }
  return `TK-AIG-${hash.toString(16).toUpperCase().padStart(8, "0").slice(0, 8)}`;
}

function clampGrade(value: unknown, fallback = 0) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Number(Math.max(1, Math.min(10, numeric)).toFixed(2));
}

function finalElement(bundle: AiGraderReportBundle, key: AiGraderReportElementKey): AiGraderFinalElementScore | undefined {
  const source = bundle.provisionalGrade?.elementScores?.[key];
  if (!source || typeof source.score !== "number") return undefined;
  return {
    score: clampGrade(source.score),
    confidence: source.confidence ?? bundle.provisionalGrade?.confidence?.band ?? "medium",
    sourceStatus: source.status,
    explanation: source.explanation ?? `${key} score was promoted from provisional diagnostics.`,
  };
}

export function buildSampleAiGraderProductionRelease(bundle: AiGraderReportBundle): AiGraderProductionRelease {
  const reportId = bundle.reportId === "sample-pr45" ? "sample-final-v0" : bundle.reportId;
  const publicReportUrl = `https://collect.tenkings.co/ai-grader/reports/${reportId}`;
  const finalGrade: AiGraderFinalGrade = {
    status: "final_ai_grader_grade_v0",
    overall: clampGrade(bundle.provisionalGrade?.overall, 8.5),
    elements: {
      centering: finalElement(bundle, "centering"),
      corners: finalElement(bundle, "corners"),
      edges: finalElement(bundle, "edges"),
      surface: finalElement(bundle, "surface"),
    },
    confidence: {
      score: 0.58,
      band: "medium",
      warnings: ["V0 final grade uses accepted warning gates and remains non-certified."],
    },
    gradeImpactReasons: (bundle.provisionalGrade?.gradeImpactCandidates ?? []).map((candidate) => ({
      id: candidate.id,
      category: candidate.category,
      side: candidate.side,
      severity: candidate.severity,
      confidence: candidate.confidence,
      explanation: candidate.explanation,
      evidenceRefs: candidate.evidenceRefs,
    })),
    whyNot10: bundle.provisionalGrade?.whyNot10 ?? [],
    finalGradeComputed: true,
    certifiedClaim: false,
  };
  const label: AiGraderLabelData = {
    status: "label_data_ready",
    labelVersion: "ten-kings-ai-grader-label-v0",
    reportId,
    certId: certId(reportId),
    publicReportUrl,
    qrPayloadUrl: publicReportUrl,
    labelGradeText: finalGrade.overall?.toFixed(1) ?? "PENDING",
    elementScores: {
      centering: finalGrade.elements.centering?.score,
      corners: finalGrade.elements.corners?.score,
      edges: finalGrade.elements.edges?.score,
      surface: finalGrade.elements.surface?.score,
    },
    cardIdentity: bundle.cardIdentity,
    certificateStatus: "report_id_issued_not_certified",
    certifiedClaim: false,
  };
  return {
    schemaVersion: AI_GRADER_PRODUCTION_RELEASE_VERSION,
    generatedAt: "2026-07-02T06:45:00.000Z",
    gradingSessionId: bundle.gradingSessionId,
    reportId,
    reportStatus: "final_ai_grader_report_v0",
    finalStatus: "final_grade_computed",
    finalGradeComputed: true,
    certifiedClaim: false,
    certificateGenerated: false,
    labelDataGenerated: true,
    qrPayloadGenerated: true,
    gates: [
      { id: "ruler_calibration", label: "Ruler calibration", status: "pass", reason: "Fixed-ruler metadata is present.", evidenceRefs: ["rulerCalibration"] },
      { id: "front_back_evidence", label: "Front/back evidence", status: "pass", reason: "Both sides are represented in the report bundle.", evidenceRefs: ["evidenceReferences"] },
      { id: "surface_intelligence", label: "Surface intelligence", status: "accepted_warning", reason: "Surface Intelligence V0 exists but still needs tuning.", evidenceRefs: ["visionLab"] },
    ],
    finalGrade,
    operatorFinalization: {
      operatorId: "local-operator",
      finalizedAt: "2026-07-02T06:45:00.000Z",
      warningsAccepted: true,
      overrideReason: "Sample final report fixture for Production Release V0.",
      acceptedWarningGateIds: ["surface_intelligence"],
    },
    publication: {
      status: "local_bundle_ready",
      reportId,
      publicReportUrl,
      qrPayloadUrl: publicReportUrl,
      storageMode: "local_artifact_only",
      dbWritesPerformed: false,
      migrationsRun: false,
      uploadPerformed: false,
      storageKeyPrefix: `ai-grader/reports/${reportId}/`,
      requiredFutureProductionSteps: ["Upload bundle/assets through storage helpers.", "Persist GradeRun/GradeCertificate through database service."],
    },
    label,
    warnings: ["Final AI-Grader Report V0 is not a certified claim."],
    limitations: ["No production DB write in this fixture.", "No physical label was printed."],
    databaseIntegration: {
      existingModels: ["AiGraderSession", "AiGraderReport", "AiGraderEvidenceAsset", "AiGraderGrade", "AiGraderLabel", "AiGraderPublication", "AiGraderValuation", "CardAsset", "Item", "PackLabel", "QrCode"],
      migrationsAdded: true,
      migrationsRun: false,
      productionDbWritesPerformed: false,
      recommendedPersistPath: [
        "Apply reviewed AiGrader production-release migration through approved runbook.",
        "Enable env-gated production publish API after DB/storage readiness.",
        "Persist AiGraderSession/AiGraderReport/AiGraderEvidenceAsset/AiGraderGrade/AiGraderLabel/AiGraderPublication/AiGraderValuation.",
      ],
    },
    storageIntegration: {
      mode: "local_bundle_only",
      uploadPerformed: false,
      storageKeyPrefix: `ai-grader/reports/${reportId}/`,
      recommendedUploadPath: "Reuse existing storage uploadBuffer/presign helpers.",
    },
    slabbedPhotoContract: {
      status: "reserved_not_uploaded",
      note: "Slabbed color photos attach after encapsulation and remain separate from Basler evidence.",
    },
    ebayCompsContract: {
      status: "not_run",
      valuationStatus: "pending_card_identity_and_final_sale_context",
      compsRefs: [],
      note: "No live comps lookup is run by this fixture.",
    },
    cardInventoryLinkage: {
      status: "contract_ready_not_persisted",
      cardAssetId: bundle.cardIdentity.cardAssetId,
      note: "Linkage contract is ready; no DB write is performed.",
    },
  };
}
