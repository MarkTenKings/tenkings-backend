import {
  MATHEMATICAL_GRADING_ELEMENTS_V1,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  calculateOverallGradeV1,
  mathematicalScoreV1Schema,
} from "@tenkings/shared";

export const AI_GRADER_REPORT_EDITORIAL_REVISION_V1 =
  "ten-kings-ai-grader-operator-review-v1" as const;

export const AI_GRADER_REPORT_EDITABLE_ELEMENTS = [
  "centering",
  "corners",
  "edges",
  "surface",
] as const;

export type AiGraderReportEditableElement =
  (typeof AI_GRADER_REPORT_EDITABLE_ELEMENTS)[number];

export type AiGraderReportEditorialContent = {
  cardTitle?: string;
  reportSummary?: string;
  centeringExplanation?: string;
  cornersExplanation?: string;
  edgesExplanation?: string;
  surfaceExplanation?: string;
  strongestPositive?: string;
  strongestWarning?: string;
  whyNot10?: string;
};

export type AiGraderReportEditorialRevisionV1 = {
  schemaVersion: typeof AI_GRADER_REPORT_EDITORIAL_REVISION_V1;
  revisionKind: "operator_adjudication_v1";
  completionAuthority: "authenticated_admin_adjudication";
  effectiveReportStatus: "completed_human_reviewed";
  machineGradePreserved: true;
  reportId: string;
  sourceReportSchemaVersion: string;
  sourceBundleSha256: string;
  revision: number;
  editedAt: string;
  humanReviewed: true;
  adjudicatedMachineFailures: string[];
  scores: Record<AiGraderReportEditableElement, number>;
  calculation: {
    overall: number;
    labelGrade: number;
    weightedGrade: number;
    weakestElement: AiGraderReportEditableElement;
    weakestScore: number;
    weakestElementCap: number;
    applicableSevereDefectCap?: number;
    severeDefectCapProvenance:
      | "immutable_mathematical_v1_finding_ledger"
      | "none_source_report_has_no_v1_cap";
    weights: Record<AiGraderReportEditableElement, number>;
    weightedFormula: string;
    finalFormula: string;
  };
  content: AiGraderReportEditorialContent;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeId(value: unknown, maximum = 255): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

const CONTENT_LIMITS: Record<keyof AiGraderReportEditorialContent, number> = {
  cardTitle: 240,
  reportSummary: 2_000,
  centeringExplanation: 1_000,
  cornersExplanation: 1_000,
  edgesExplanation: 1_000,
  surfaceExplanation: 1_000,
  strongestPositive: 1_000,
  strongestWarning: 1_000,
  whyNot10: 2_000,
};

function normalizeText(value: unknown, field: keyof AiGraderReportEditorialContent) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be plain text.`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return undefined;
  if (normalized.length > CONTENT_LIMITS[field]) {
    throw new Error(`${field} exceeds its ${CONTENT_LIMITS[field]} character limit.`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    throw new Error(`${field} contains unsupported control characters.`);
  }
  return normalized;
}

export function normalizeAiGraderReportEditorialContent(
  value: unknown,
): AiGraderReportEditorialContent {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error("content must be an object.");
  const unknownKeys = Object.keys(value).filter(
    (key) => !(key in CONTENT_LIMITS),
  );
  if (unknownKeys.length) {
    throw new Error(`content contains unsupported fields: ${unknownKeys.join(", ")}.`);
  }
  return Object.fromEntries(
    (Object.keys(CONTENT_LIMITS) as Array<keyof AiGraderReportEditorialContent>)
      .map((field) => [field, normalizeText(value[field], field)] as const)
      .filter((entry): entry is readonly [keyof AiGraderReportEditorialContent, string] =>
        typeof entry[1] === "string"),
  );
}

export function normalizeAiGraderReportEditorialScores(
  value: unknown,
): Record<AiGraderReportEditableElement, number> {
  if (!isRecord(value)) throw new Error("All four sub-grades are required.");
  const unknownKeys = Object.keys(value).filter(
    (key) => !AI_GRADER_REPORT_EDITABLE_ELEMENTS.includes(key as AiGraderReportEditableElement),
  );
  if (unknownKeys.length) {
    throw new Error(`scores contains unsupported fields: ${unknownKeys.join(", ")}.`);
  }
  return Object.fromEntries(
    AI_GRADER_REPORT_EDITABLE_ELEMENTS.map((element) => [
      element,
      mathematicalScoreV1Schema.parse(value[element]),
    ]),
  ) as Record<AiGraderReportEditableElement, number>;
}

export function buildAiGraderReportEditorialRevisionV1(input: {
  reportId: string;
  sourceReportSchemaVersion: string;
  sourceBundleSha256: string;
  revision: number;
  editedAt: string;
  scores: unknown;
  content?: unknown;
  applicableSevereDefectCap?: number;
  adjudicatedMachineFailures?: unknown;
}): AiGraderReportEditorialRevisionV1 {
  if (!safeId(input.reportId)) throw new Error("reportId is invalid.");
  if (!safeId(input.sourceReportSchemaVersion, 128)) {
    throw new Error("sourceReportSchemaVersion is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.sourceBundleSha256)) {
    throw new Error("sourceBundleSha256 must be a lowercase SHA-256 digest.");
  }
  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new Error("revision must be a positive integer.");
  }
  if (!Number.isFinite(Date.parse(input.editedAt))) {
    throw new Error("editedAt must be an ISO timestamp.");
  }
  const scores = normalizeAiGraderReportEditorialScores(input.scores);
  const severeCaps = input.applicableSevereDefectCap === undefined
    ? []
    : [mathematicalScoreV1Schema.parse(input.applicableSevereDefectCap)];
  const calculation = calculateOverallGradeV1(scores, severeCaps);
  const adjudicatedMachineFailures = input.adjudicatedMachineFailures === undefined
    ? []
    : Array.isArray(input.adjudicatedMachineFailures) &&
        input.adjudicatedMachineFailures.length <= 100 &&
        input.adjudicatedMachineFailures.every((code) => safeId(code, 128))
      ? [...new Set(input.adjudicatedMachineFailures as string[])].sort()
      : (() => { throw new Error("adjudicatedMachineFailures is invalid."); })();
  return {
    schemaVersion: AI_GRADER_REPORT_EDITORIAL_REVISION_V1,
    revisionKind: "operator_adjudication_v1",
    completionAuthority: "authenticated_admin_adjudication",
    effectiveReportStatus: "completed_human_reviewed",
    machineGradePreserved: true,
    reportId: input.reportId,
    sourceReportSchemaVersion: input.sourceReportSchemaVersion,
    sourceBundleSha256: input.sourceBundleSha256,
    revision: input.revision,
    editedAt: new Date(input.editedAt).toISOString(),
    humanReviewed: true,
    adjudicatedMachineFailures,
    scores,
    calculation: {
      overall: calculation.overall,
      labelGrade: calculation.labelGrade,
      weightedGrade: calculation.weightedGrade,
      weakestElement: calculation.weakestElement,
      weakestScore: calculation.weakestScore,
      weakestElementCap: calculation.weakestElementCap,
      ...(calculation.applicableSevereDefectCap === undefined
        ? {}
        : { applicableSevereDefectCap: calculation.applicableSevereDefectCap }),
      severeDefectCapProvenance:
        calculation.applicableSevereDefectCap === undefined
          ? "none_source_report_has_no_v1_cap"
          : "immutable_mathematical_v1_finding_ledger",
      weights: { ...calculation.weights },
      weightedFormula:
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weightedFormula,
      finalFormula: calculation.formula,
    },
    content: normalizeAiGraderReportEditorialContent(input.content),
  };
}

export function parseAiGraderReportEditorialRevisionV1(
  value: unknown,
  expectedReportId?: string,
): AiGraderReportEditorialRevisionV1 | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== AI_GRADER_REPORT_EDITORIAL_REVISION_V1 ||
    value.revisionKind !== "operator_adjudication_v1" ||
    value.completionAuthority !== "authenticated_admin_adjudication" ||
    value.effectiveReportStatus !== "completed_human_reviewed" ||
    value.machineGradePreserved !== true ||
    value.humanReviewed !== true ||
    !safeId(value.reportId) ||
    (expectedReportId !== undefined && value.reportId !== expectedReportId) ||
    !safeId(value.sourceReportSchemaVersion, 128) ||
    typeof value.sourceBundleSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sourceBundleSha256) ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 1 ||
    typeof value.editedAt !== "string"
  ) return null;
  try {
    const parsed = buildAiGraderReportEditorialRevisionV1({
      reportId: value.reportId,
      sourceReportSchemaVersion: value.sourceReportSchemaVersion,
      sourceBundleSha256: value.sourceBundleSha256,
      revision: Number(value.revision),
      editedAt: value.editedAt,
      scores: value.scores,
      content: value.content,
      adjudicatedMachineFailures: value.adjudicatedMachineFailures,
      applicableSevereDefectCap: isRecord(value.calculation) &&
        typeof value.calculation.applicableSevereDefectCap === "number"
        ? value.calculation.applicableSevereDefectCap
        : undefined,
    });
    return JSON.stringify(parsed.calculation) === JSON.stringify(value.calculation)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function aiGraderReportEditorialRevisionFromGradeStory(
  gradeStory: unknown,
  expectedReportId?: string,
) {
  return isRecord(gradeStory)
    ? parseAiGraderReportEditorialRevisionV1(
        gradeStory.manualReportRevision,
        expectedReportId,
      )
    : null;
}

export function aiGraderReportEditorialGradeStory(
  existingGradeStory: unknown,
  revision: AiGraderReportEditorialRevisionV1,
) {
  return {
    ...(isRecord(existingGradeStory) ? existingGradeStory : {}),
    manualReportRevision: revision,
  };
}

export function aiGraderReportBaseScoresFromBundle(
  bundle: unknown,
): Partial<Record<AiGraderReportEditableElement, number>> {
  if (!isRecord(bundle)) return {};
  const productionRelease = isRecord(bundle.productionRelease)
    ? bundle.productionRelease
    : {};
  const finalGrade = isRecord(productionRelease.finalGrade)
    ? productionRelease.finalGrade
    : {};
  const finalElements = isRecord(finalGrade.elements) ? finalGrade.elements : {};
  const provisionalGrade = isRecord(bundle.provisionalGrade)
    ? bundle.provisionalGrade
    : {};
  const provisionalElements = isRecord(provisionalGrade.elementScores)
    ? provisionalGrade.elementScores
    : {};
  return Object.fromEntries(
    MATHEMATICAL_GRADING_ELEMENTS_V1.flatMap((element) => {
      const finalElement = isRecord(finalElements[element]) ? finalElements[element] : {};
      const provisionalElement = isRecord(provisionalElements[element])
        ? provisionalElements[element]
        : {};
      const candidate = typeof finalElement.score === "number"
        ? finalElement.score
        : provisionalElement.score;
      const parsed = mathematicalScoreV1Schema.safeParse(candidate);
      return parsed.success ? [[element, parsed.data] as const] : [];
    }),
  );
}

export function aiGraderReportSevereDefectCapFromBundle(bundle: unknown) {
  if (!isRecord(bundle) || !isRecord(bundle.productionRelease)) return undefined;
  const finalGrade = isRecord(bundle.productionRelease.finalGrade)
    ? bundle.productionRelease.finalGrade
    : {};
  const parsed = mathematicalScoreV1Schema.safeParse(
    finalGrade.applicableSevereDefectCap,
  );
  return parsed.success ? parsed.data : undefined;
}
