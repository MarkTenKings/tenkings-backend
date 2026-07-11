import { buildSampleAiGraderProductionRelease, type AiGraderProductionRelease } from "./aiGraderProductionRelease";
import type { AiGraderDefectFindingV1, AiGraderPublishedDefectFindingV1 } from "@tenkings/shared";

export const AI_GRADER_WEB_REPORT_BUNDLE_V01_VERSION = "ai-grader-report-bundle-v0.1" as const;
export const AI_GRADER_WEB_REPORT_BUNDLE_V02_VERSION = "ai-grader-report-bundle-v0.2" as const;
export const AI_GRADER_WEB_REPORT_BUNDLE_VERSION = AI_GRADER_WEB_REPORT_BUNDLE_V01_VERSION;
export const AI_GRADER_EXPLICIT_SAMPLE_REPORT_IDS = ["sample-pr45", "sample-final-v0", "sample-defect-v1"] as const;

export function isExplicitAiGraderSampleReportId(reportId: string | string[] | undefined) {
  const normalized = Array.isArray(reportId) ? reportId[0] : reportId;
  return AI_GRADER_EXPLICIT_SAMPLE_REPORT_IDS.includes((normalized ?? "").trim() as (typeof AI_GRADER_EXPLICIT_SAMPLE_REPORT_IDS)[number]);
}

export type AiGraderReportElementKey = "centering" | "corners" | "edges" | "surface";

export type AiGraderReportProductionRelease = Partial<
  Omit<AiGraderProductionRelease, "finalGrade" | "label" | "publication">
> & {
  finalGrade: {
    status?: AiGraderProductionRelease["finalGrade"]["status"];
    overall?: number;
    confidence: {
      score: number;
      band: "low" | "medium" | "high";
      warnings?: string[];
    };
    gradeImpactReasons?: Array<{
      id: string;
      category: string;
      side: string;
      severity: string;
      confidence: string;
      explanation: string;
      evidenceRefs?: string[];
      findingIds?: string[];
    }>;
    whyNot10?: AiGraderProductionRelease["finalGrade"]["whyNot10"];
    elements?: AiGraderProductionRelease["finalGrade"]["elements"];
    finalGradeComputed?: boolean;
    certifiedClaim?: boolean;
  };
  label: {
    certId: string;
    labelGradeText: string;
    publicReportUrl: string;
    qrPayloadUrl: string;
    status?: AiGraderProductionRelease["label"]["status"];
  };
  publication: {
    publicReportUrl: string;
    qrPayloadUrl?: string;
    storageMode?: string;
    dbWritesPerformed?: boolean;
  };
};

export type AiGraderReportPublicAsset = {
  id: string;
  kind?: string;
  fileName?: string;
  contentType?: string;
  storageKey?: string;
  publicUrl?: string;
  localPath?: string;
  byteSize?: number;
  widthPx?: number;
  heightPx?: number;
  sha256?: string;
  checksumSha256?: string;
  side?: "front" | "back" | string;
  evidenceRole?:
    | "normalized_card"
    | "surface_heatmap"
    | "surface_vision"
    | "confidence_mask"
    | "measurement_overlay"
    | "directional_channel"
    | "roi_crop"
    | "other_evidence";
  bodyEncoding?: "base64" | string;
  bodyBase64?: string;
};

export type AiGraderReportBundle = {
  schemaVersion: typeof AI_GRADER_WEB_REPORT_BUNDLE_V01_VERSION;
  reportProducer?: {
    contractVersion: string;
    capabilities: string[];
  };
  generatedAt: string;
  gradingSessionId: string;
  reportId: string;
  reportStatus: "provisional_diagnostic_ready" | "insufficient_evidence" | "missing_report_data" | "final_ai_grader_report_v0";
  provisionalStatus: "provisional_diagnostic";
  finalStatus: "not_computed" | "final_grade_computed" | "insufficient_evidence";
  finalGradeComputed: boolean;
  certifiedClaim: false;
  labelGenerated: boolean;
  qrGenerated: boolean;
  certificateGenerated: false;
  productionRelease?: AiGraderProductionRelease;
  localReportFolder?: string;
  reportHtmlPath?: string;
  publicPathPlaceholders: {
    reportViewerRoute: string;
    reportUrlTemplate: string;
    assetBaseUrlTemplate: string;
  };
  cardIdentity: {
    cardAssetId?: string;
    itemId?: string;
    title?: string;
    set?: string;
    cardNumber?: string;
    source?: "card_asset" | "item" | "manual_draft" | string;
    sideCount: 2;
    futureSlabbedPhotoRefsReserved: true;
    futureEbayCompsRefsReserved: true;
  };
  provisionalGrade?: {
    status?: string;
    overall?: number;
    elementScores?: Partial<Record<AiGraderReportElementKey, { score?: number; confidence?: string; status?: string; explanation?: string }>>;
    confidence?: { band?: string; score?: number; warnings?: string[] };
    gates?: {
      requiredGatesPassed?: boolean;
      results?: Array<{ gate?: string; status?: string; summary?: string; evidenceRefs?: string[] }>;
      blockers?: string[];
      acceptedWarnings?: string[];
    };
    gradeStory?: { summary?: string; strongestPositiveFinding?: string; strongestWarning?: string; claims?: Array<{ claim: string; evidenceRefs: string[] }> };
    whyNot10?: Array<{ id: string; title: string; explanation: string; evidenceRefs: string[] }>;
    gradeImpactCandidates?: AiGraderGradeImpactCandidate[];
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
    findingValidation?: {
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
  calibrationProfile?: Record<string, unknown>;
  rulerCalibration?: Record<string, unknown>;
  lightingProfile?: Record<string, unknown>;
  geometry?: {
    front?: Record<string, unknown>;
    back?: Record<string, unknown>;
  };
  geometryCaptureDecisions?: {
    front?: Record<string, unknown>;
    back?: Record<string, unknown>;
  };
  captureTiming?: Record<string, unknown>;
  ocrPrefill?: Record<string, unknown>;
  assets?: AiGraderReportPublicAsset[];
  publicAssets?: AiGraderReportPublicAsset[];
  warnings: string[];
  limitations: string[];
};

export type AiGraderReportBundleV01 = AiGraderReportBundle;

export type AiGraderReportBundleV02 = Partial<
  Omit<AiGraderReportBundle, "schemaVersion" | "generatedAt" | "reportId" | "certifiedClaim" | "certificateGenerated" | "cardIdentity" | "productionRelease" | "visionLab">
> & {
  schemaVersion: typeof AI_GRADER_WEB_REPORT_BUNDLE_V02_VERSION;
  generatedAt: string;
  reportId: string;
  certifiedClaim: false;
  certificateGenerated: false;
  cardIdentity: AiGraderReportBundle["cardIdentity"];
  defectFindings: AiGraderPublishedDefectFindingV1[];
  productionRelease: AiGraderReportProductionRelease;
  visionLab?: AiGraderReportBundle["visionLab"];
};

export type AiGraderCompatibleReportBundle = AiGraderReportBundleV01 | AiGraderReportBundleV02;

function publishedFindingForOverlay(
  finding: AiGraderPublishedDefectFindingV1,
): AiGraderDefectFindingV1 | undefined {
  const shape = finding.geometry.shape;
  const overlayShape = shape.kind === "box"
    ? {
        type: "box" as const,
        x: shape.x,
        y: shape.y,
        width: shape.width,
        height: shape.height,
      }
    : shape.kind === "polygon"
      ? { type: "polygon" as const, points: shape.points }
      : undefined;
  if (!overlayShape) return undefined;
  return {
    schemaVersion: finding.schemaVersion,
    findingId: finding.findingId,
    side: finding.side,
    category: finding.category,
    detector: finding.detector,
    severity: finding.severity,
    confidence: finding.confidence,
    review: finding.review,
    geometry: {
      coordinateFrame: finding.geometry.coordinateFrame,
      units: finding.geometry.units,
      shape: overlayShape,
    },
    evidence: finding.evidence,
    explanation: finding.explanation,
  };
}

/** Returns the schema-appropriate finding source in the PR #82 overlay shape. */
export function aiGraderReportDefectFindings(bundle: AiGraderCompatibleReportBundle): AiGraderDefectFindingV1[] {
  if (bundle.schemaVersion === AI_GRADER_WEB_REPORT_BUNDLE_V01_VERSION) {
    return bundle.visionLab.defectFindings ?? [];
  }
  return bundle.defectFindings
    .map(publishedFindingForOverlay)
    .filter((finding): finding is AiGraderDefectFindingV1 => Boolean(finding));
}

export type AiGraderGradeImpactCandidate = {
  id: string;
  category: AiGraderReportElementKey | "confidence";
  side: "front" | "back" | "both";
  severity: "low" | "medium" | "high";
  confidence: string;
  provisionalGradeImpact: string | number;
  evidenceRefs: string[];
  sourceChannels?: number[];
  explanation: string;
  findingIds?: string[];
};

export const SAMPLE_AI_GRADER_REPORT_BUNDLE: AiGraderReportBundle = {
  schemaVersion: AI_GRADER_WEB_REPORT_BUNDLE_VERSION,
  generatedAt: "2026-07-01T17:37:33.758Z",
  gradingSessionId: "ai-grader-station-sample-pr45",
  reportId: "sample-pr45",
  reportStatus: "provisional_diagnostic_ready",
  provisionalStatus: "provisional_diagnostic",
  finalStatus: "not_computed",
  finalGradeComputed: false,
  certifiedClaim: false,
  labelGenerated: false,
  qrGenerated: false,
  certificateGenerated: false,
  publicPathPlaceholders: {
    reportViewerRoute: "/ai-grader/reports/[reportId]",
    reportUrlTemplate: "/ai-grader/reports/{reportId}",
    assetBaseUrlTemplate: "/ai-grader/reports/{reportId}/assets",
  },
  cardIdentity: {
    title: "Fixed-Rig Diagnostic Card Report",
    sideCount: 2,
    futureSlabbedPhotoRefsReserved: true,
    futureEbayCompsRefsReserved: true,
  },
  provisionalGrade: {
    status: "provisional_diagnostic_grade",
    overall: 8.5,
    elementScores: {
      centering: { score: 10, confidence: "high", status: "provisional_diagnostic", explanation: "Front/back border balance measured near 50/50 in the fixed-ruler geometry." },
      corners: { score: 8.97, confidence: "low", status: "provisional_diagnostic", explanation: "Corner ROI proxy metrics remain diagnostic and clipping reduces confidence." },
      edges: { score: 8.97, confidence: "low", status: "provisional_diagnostic", explanation: "Edge ROI proxy metrics remain diagnostic and require additional tuning." },
      surface: { score: 5.5, confidence: "high", status: "provisional_diagnostic", explanation: "Surface Intelligence V0 found high-severity back-side surface candidates." },
    },
    confidence: {
      band: "low",
      score: 0.361,
      warnings: ["Repeatability and clipping were accepted diagnostic warnings in the source run.", "This is not certified and not a final grade."],
    },
    gradeStory: {
      summary: "Centering is the strongest element; surface evidence is the strongest provisional limiter.",
      strongestPositiveFinding: "Centering measured close to balanced on both sides.",
      strongestWarning: "Back-side surface candidates and clipping warnings reduce confidence.",
      claims: [
        { claim: "Centering is strongest because fixed-ruler border balance was near 50/50.", evidenceRefs: ["analysis.provisionalGradeStory.elementScores.centering"] },
        { claim: "Surface confidence is limited by high-severity back candidates.", evidenceRefs: ["analysis.visionLab.gradeImpactCandidates"] },
      ],
    },
    whyNot10: [
      {
        id: "surface-candidate-back",
        title: "Back-side surface candidate",
        explanation: "The strongest provisional limiter is a back-side surface response visible in multi-light evidence.",
        evidenceRefs: ["analysis.visionLab.surfaceCandidates.back"],
      },
      {
        id: "confidence-clipping",
        title: "Clipping accepted as warning",
        explanation: "Clipping exceeded the soft target and lowers report confidence.",
        evidenceRefs: ["analysis.provisionalGradeStory.gates.clipping"],
      },
    ],
    gradeImpactCandidates: [
      {
        id: "back-surface-intelligence-v0-001",
        category: "surface",
        side: "back",
        severity: "high",
        confidence: "medium",
        provisionalGradeImpact: "caps provisional overall grade",
        sourceChannels: [3, 1, 6],
        evidenceRefs: ["visionLab.heatmap.back", "visionLab.lightSweep.channel3"],
        explanation: "A high-response back-side region was strongest in numbered light channels 3, 1, and 6. Physical direction mapping remains pending.",
      },
    ],
  },
  evidenceReferences: {
    frontEvidenceRefs: ["front true view", "front overlay", "front channels 1-8", "front ROI crops"],
    backEvidenceRefs: ["back true view", "back overlay", "back channels 1-8", "back ROI crops"],
  },
  visionLab: {
    available: true,
    trueViewRefs: ["front true view", "back true view"],
    overlayRefs: ["front overlay", "back overlay"],
    channelImageRefs: ["front channels 1-8", "back channels 1-8"],
    heatmapRefs: ["front heatmap", "back heatmap"],
    surfaceVisionRefs: ["front Surface Vision V0", "back Surface Vision V0"],
    confidenceRefs: ["front confidence map", "back confidence map"],
    candidateCount: 1,
    missingDataWarnings: [],
  },
  calibrationProfile: {
    referenceType: "fixed_metric_rulers",
    isCalibrated: false,
    mmPerPixelX: 0.047037,
    mmPerPixelY: 0.047344,
  },
  rulerCalibration: {
    horizontalSpanMm: 50.8,
    verticalSpanMm: 50.8,
    scaleConsistency: "pass",
  },
  lightingProfile: {
    dutyPercent: 1.3,
    pwmStep: 13,
    channels: [1, 2, 3, 4, 5, 6, 7, 8],
    profileSource: "operator_preview",
  },
  warnings: ["Provisional diagnostic only.", "Not certified.", "No final grade.", "No QR certificate yet."],
  limitations: [
    "No public storage upload in this PR.",
    "No DB write or migration.",
    "No Label.",
    "No Certificate.",
    "No QR Certificate Yet.",
    "Fixture/ruler profile remains local and non-certified.",
  ],
};

function buildMissingAiGraderReportBundle(reportId: string): AiGraderReportBundle {
  const safeReportId = reportId.trim() || "missing-report-data";
  return {
    schemaVersion: AI_GRADER_WEB_REPORT_BUNDLE_VERSION,
    generatedAt: "2026-07-03T00:00:00.000Z",
    gradingSessionId: `${safeReportId}-unresolved`,
    reportId: safeReportId,
    reportStatus: "missing_report_data",
    provisionalStatus: "provisional_diagnostic",
    finalStatus: "insufficient_evidence",
    finalGradeComputed: false,
    certifiedClaim: false,
    labelGenerated: false,
    qrGenerated: false,
    certificateGenerated: false,
    publicPathPlaceholders: {
      reportViewerRoute: "/ai-grader/reports/[reportId]",
      reportUrlTemplate: "/ai-grader/reports/{reportId}",
      assetBaseUrlTemplate: "/ai-grader/reports/{reportId}/assets",
    },
    cardIdentity: {
      title: "AI Grader report not resolved",
      sideCount: 2,
      futureSlabbedPhotoRefsReserved: true,
      futureEbayCompsRefsReserved: true,
    },
    evidenceReferences: {
      frontEvidenceRefs: [],
      backEvidenceRefs: [],
    },
    visionLab: {
      available: false,
      trueViewRefs: [],
      overlayRefs: [],
      channelImageRefs: [],
      heatmapRefs: [],
      surfaceVisionRefs: [],
      confidenceRefs: [],
      candidateCount: 0,
      missingDataWarnings: ["Persisted storage or local bridge data was not resolved for this report ID."],
    },
    warnings: ["Report data was not resolved from persisted storage or the local station bridge."],
    limitations: ["No fixture/sample data is substituted for generated report IDs."],
  };
}

export function getAiGraderReportBundle(reportId: string | string[] | undefined): AiGraderReportBundle {
  const normalized = Array.isArray(reportId) ? reportId[0] : reportId;
  const trimmed = normalized?.trim() ?? "";
  if (trimmed === "sample-pr45") {
    return SAMPLE_AI_GRADER_REPORT_BUNDLE;
  }
  if (trimmed === "sample-defect-v1") {
    const findingId = "dfv1_1234567890abcdef12345678";
    return {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      reportId: "sample-defect-v1",
      provisionalGrade: {
        ...SAMPLE_AI_GRADER_REPORT_BUNDLE.provisionalGrade,
        gradeImpactCandidates: (SAMPLE_AI_GRADER_REPORT_BUNDLE.provisionalGrade?.gradeImpactCandidates ?? []).map((candidate, index) =>
          index === 0 ? { ...candidate, findingIds: [findingId] } : candidate
        ),
      },
      visionLab: {
        ...SAMPLE_AI_GRADER_REPORT_BUNDLE.visionLab,
        defectFindings: [
          {
            schemaVersion: "ai-grader-defect-finding-v1",
            findingId,
            side: "back",
            category: "surface_anomaly",
            detector: {
              id: "preliminary_surface_intelligence_v0",
              version: "preliminary_surface_intelligence_v0",
            },
            severity: { score: 74.25, band: "high" },
            confidence: 0.78,
            review: { status: "unreviewed" },
            geometry: {
              coordinateFrame: "normalized_card",
              units: "fraction",
              shape: { type: "box", x: 0.56, y: 0.27, width: 0.19, height: 0.14 },
            },
            evidence: {
              trueViewAssetId: "sample/back-normalized-card.png",
              channelAssetIds: [],
              roiAssetIds: [],
            },
            explanation: "AI-detected provisional surface finding. Review the linked evidence before relying on this finding.",
          },
        ],
      },
      publicAssets: [
        {
          id: "sample/back-normalized-card.png",
          kind: "image",
          fileName: "back-normalized-card.png",
          contentType: "image/png",
          publicUrl: "/images/card-pull-1.png",
          side: "back",
          evidenceRole: "normalized_card",
        },
      ],
    };
  }
  if (trimmed === "sample-final-v0") {
    const productionRelease = buildSampleAiGraderProductionRelease({
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      reportId: "sample-final-v0",
    });
    return {
      ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
      reportId: "sample-final-v0",
      reportStatus: "final_ai_grader_report_v0",
      finalStatus: "final_grade_computed",
      finalGradeComputed: true,
      labelGenerated: true,
      qrGenerated: true,
      productionRelease,
      warnings: ["Final AI-Grader Report V0 fixture.", "Not certified."],
      limitations: ["No physical label printed in fixture.", "No production DB write in fixture."],
    };
  }
  return buildMissingAiGraderReportBundle(trimmed || "missing-report-data");
}

export function hasNoFinalCertifiedClaims(bundle: AiGraderCompatibleReportBundle) {
  return (
    bundle.finalGradeComputed === false &&
    bundle.certifiedClaim === false &&
    bundle.labelGenerated === false &&
    bundle.qrGenerated === false &&
    bundle.certificateGenerated === false &&
    bundle.finalStatus === "not_computed"
  );
}

export function hasNoCertifiedClaim(bundle: AiGraderCompatibleReportBundle) {
  return bundle.certifiedClaim === false && bundle.certificateGenerated === false && (bundle.productionRelease?.certifiedClaim ?? false) === false;
}
