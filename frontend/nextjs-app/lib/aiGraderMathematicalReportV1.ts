import {
  AI_GRADER_REPORT_BUNDLE_V03_VERSION,
  aiGraderReportBundleV03Schema,
  type AiGraderReportBundleV03,
} from "@tenkings/shared";

type JsonRecord = Record<string, unknown>;

export const AI_GRADER_MATHEMATICAL_PRODUCTION_RELEASE_V1_VERSION =
  "ai-grader-mathematical-production-release-v1" as const;
export const AI_GRADER_MATHEMATICAL_LABEL_V1_VERSION =
  "ten-kings-ai-grader-label-v1" as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type AiGraderMathematicalProductionReleaseEnvelope = {
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
    label?: string;
    status: "pass" | "accepted_warning";
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
    [key: string]: unknown;
  };
  label: AiGraderReportBundleV03["productionRelease"]["label"] & {
    status: "label_data_ready";
    labelVersion: typeof AI_GRADER_MATHEMATICAL_LABEL_V1_VERSION;
    reportId: string;
    certificateStatus: "report_id_issued_not_certified";
    elementScores: Record<"centering" | "corners" | "edges" | "surface", number>;
    cardIdentity: AiGraderReportBundleV03["cardIdentity"];
    certifiedClaim: false;
    [key: string]: unknown;
  };
  cardIdentity: AiGraderReportBundleV03["cardIdentity"];
  calibrationProfile: AiGraderReportBundleV03["calibrationProfile"];
  warnings?: string[];
  limitations?: string[];
  cardInventoryLinkage?: {
    status?: string;
    cardAssetId?: string;
    itemId?: string;
    note?: string;
  };
  [key: string]: unknown;
};

/** Strictly accepts a complete calibrated V1 public bundle. No V0 fallback is permitted. */
export function parseAiGraderMathematicalReportV1(value: unknown): AiGraderReportBundleV03 | null {
  if (!value || typeof value !== "object" || (value as { schemaVersion?: unknown }).schemaVersion !== AI_GRADER_REPORT_BUNDLE_V03_VERSION) {
    return null;
  }
  const parsed = aiGraderReportBundleV03Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isAiGraderMathematicalReportV1(value: unknown): value is AiGraderReportBundleV03 {
  return parseAiGraderMathematicalReportV1(value) !== null;
}

/** The mutable workflow envelope stays external and may never replace or alter the strict V1 body. */
export function aiGraderMathematicalReleaseEnvelopeIssue(
  bundle: AiGraderReportBundleV03,
  release: unknown,
): string | undefined {
  if (!isRecord(release)) return "The Mathematical Grading V1 publication envelope is required.";
  if (release.schemaVersion !== AI_GRADER_MATHEMATICAL_PRODUCTION_RELEASE_V1_VERSION) {
    return "The publication envelope must use the Mathematical Grading V1 release schema; legacy release metadata cannot be mixed with V1.";
  }
  if (release.reportId !== bundle.reportId) return "The publication envelope reportId does not match the strict V1 report.";
  if (release.generatedAt !== bundle.generatedAt) return "The publication envelope generatedAt does not match the strict V1 report.";
  if (typeof release.gradingSessionId !== "string" || !release.gradingSessionId.trim()) {
    return "The publication envelope must bind one grading session without mutating the strict V1 report body.";
  }
  if (release.reportStatus !== "final_ai_grader_report_v1" || release.finalStatus !== "final_grade_computed") {
    return "The publication envelope must carry the final Mathematical Grading V1 report and grade statuses.";
  }
  if (release.finalGradeComputed !== true) return "The publication envelope must mark the strict V1 final grade computed.";
  if (
    release.certifiedClaim !== false ||
    release.certificateGenerated !== false ||
    release.labelDataGenerated !== true ||
    release.qrPayloadGenerated !== true
  ) {
    return "The publication envelope must retain the exact non-certified Mathematical V1 release flags and completed Label V1/QR data.";
  }
  if (!isRecord(release.finalGrade) || stable(release.finalGrade) !== stable(bundle.productionRelease.finalGrade)) {
    return "The publication envelope final grade must exactly equal the strict Mathematical Grading V1 final grade.";
  }
  if (
    !isRecord(release.cardIdentity) ||
    stable(release.cardIdentity) !== stable(bundle.cardIdentity) ||
    !isRecord(release.calibrationProfile) ||
    stable(release.calibrationProfile) !== stable(bundle.calibrationProfile)
  ) {
    return "The publication envelope must preserve the exact Mathematical V1 card identity and finalized calibration profile.";
  }
  const releaseLabel = isRecord(release.label) ? release.label : {};
  const reportLabel = bundle.productionRelease.label;
  const expectedElementScores = Object.fromEntries(
    Object.entries(bundle.productionRelease.finalGrade.elements).map(([element, result]) => [
      element,
      result.score,
    ]),
  );
  if (
    releaseLabel.labelVersion !== AI_GRADER_MATHEMATICAL_LABEL_V1_VERSION ||
    releaseLabel.status !== "label_data_ready" ||
    releaseLabel.reportId !== bundle.reportId ||
    releaseLabel.certificateStatus !== "report_id_issued_not_certified" ||
    releaseLabel.certifiedClaim !== false ||
    releaseLabel.certId !== reportLabel.certId ||
    releaseLabel.labelGradeText !== reportLabel.labelGradeText ||
    releaseLabel.publicReportUrl !== reportLabel.publicReportUrl ||
    releaseLabel.qrPayloadUrl !== reportLabel.qrPayloadUrl ||
    stable(releaseLabel.elementScores) !== stable(expectedElementScores) ||
    stable(releaseLabel.cardIdentity) !== stable(bundle.cardIdentity)
  ) {
    return "The publication envelope must preserve the exact Label V1 version, identity, element scores, one-decimal grade, and report/QR links from the strict V1 report.";
  }
  const publication = isRecord(release.publication) ? release.publication : {};
  if (
    publication.status !== "local_bundle_ready" ||
    publication.reportId !== bundle.reportId ||
    publication.publicReportUrl !== reportLabel.publicReportUrl ||
    publication.qrPayloadUrl !== reportLabel.qrPayloadUrl ||
    publication.storageMode !== "local_artifact_only" ||
    publication.dbWritesPerformed !== false ||
    publication.migrationsRun !== false ||
    publication.uploadPerformed !== false
  ) {
    return "The publication envelope must preserve the strict V1 local-artifact status, report identity, public report/QR links, and no-mutation flags.";
  }
  if (
    !Array.isArray(release.gates) ||
    release.gates.length === 0 ||
    release.gates.some((gate) =>
      !isRecord(gate) ||
      (gate.status !== "pass" && gate.status !== "accepted_warning") ||
      !Array.isArray(gate.evidenceRefs) ||
      gate.evidenceRefs.length === 0)
  ) {
    return "The publication envelope must retain explicit passing or accepted-warning V1 release gates and evidence references.";
  }
  const operatorFinalization = isRecord(release.operatorFinalization)
    ? release.operatorFinalization
    : {};
  if (
    typeof operatorFinalization.operatorId !== "string" ||
    !operatorFinalization.operatorId.trim() ||
    typeof operatorFinalization.finalizedAt !== "string" ||
    !Number.isFinite(Date.parse(operatorFinalization.finalizedAt)) ||
    typeof operatorFinalization.warningsAccepted !== "boolean" ||
    !Array.isArray(operatorFinalization.acceptedWarningGateIds)
  ) {
    return "The publication envelope requires explicit operator finalization metadata.";
  }
  return undefined;
}

export function assertAiGraderMathematicalReleaseEnvelope(
  bundle: AiGraderReportBundleV03,
  release: unknown,
): asserts release is AiGraderMathematicalProductionReleaseEnvelope {
  const issue = aiGraderMathematicalReleaseEnvelopeIssue(bundle, release);
  if (issue) throw new Error(issue);
}
