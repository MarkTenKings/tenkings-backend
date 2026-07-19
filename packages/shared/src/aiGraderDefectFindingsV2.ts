import { z } from "zod";
import {
  AI_GRADER_DEFECT_FINDING_MAX_COUNT,
  AI_GRADER_DEFECT_REVIEW_STATUSES,
  AI_GRADER_DEFECT_SEVERITY_BANDS,
  aiGraderPublishedDefectFindingV1Schema,
  isSafeAiGraderPublicAssetId,
  type AiGraderPublishedDefectFindingV1,
} from "./aiGraderDefectFindings";
import {
  MATHEMATICAL_FINDING_CATEGORIES_V1,
  MATHEMATICAL_FINDING_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  calculateApplicableSevereDefectCapV1,
  calculateFindingDeductionV1,
  mathematicalMeasurementV1Schema,
  mathematicalScoreV1Schema,
} from "./aiGraderMathematicalCalibrationV1";

export const AI_GRADER_DEFECT_FINDING_V2_VERSION = "ai-grader-defect-finding-v2" as const;

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "must be a safe stable identifier");
const isoTimestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const fractionSchema = z.number().finite().min(0).max(1);
const scoreWithTwoDecimalsSchema = z
  .number()
  .finite()
  .min(0)
  .max(9)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, {
    message: "must contain at most two decimal places",
  });

function isSafePublicText(value: string) {
  return (
    !/(?:https?|data|blob|file):/i.test(value) &&
    !/[a-z]:[\\/]/i.test(value) &&
    !/\\\\/.test(value) &&
    !/(?:authorization\s*:|bearer\s+|api[_ -]?key\s*[=:]|password\s*[=:]|token\s*[=:]|secret\s*[=:]|credential\s*[=:])/i.test(value) &&
    !/[<>]/.test(value)
  );
}

const safePublicTextSchema = z.string().trim().min(1).max(1000).refine(isSafePublicText, {
  message: "must be safe public text",
});

const assetIdSchema = z.string().min(1).max(256).refine(isSafeAiGraderPublicAssetId, {
  message: "must be a safe logical public asset ID",
});

const uniqueAssetIdsSchema = z
  .array(assetIdSchema)
  .max(64)
  .refine((values) => new Set(values.map((value) => value.toLowerCase())).size === values.length, {
    message: "asset IDs must be unique case-insensitively",
  });

const pointSchema = z.strictObject({ x: fractionSchema, y: fractionSchema });

function polygonArea(points: Array<{ x: number; y: number }>) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

const boxSchema = z
  .strictObject({
    kind: z.literal("box"),
    x: fractionSchema,
    y: fractionSchema,
    width: fractionSchema.positive(),
    height: fractionSchema.positive(),
  })
  .refine((shape) => shape.x + shape.width <= 1 + 1e-9 && shape.y + shape.height <= 1 + 1e-9, {
    message: "box must remain inside the normalized card",
  });

const polygonSchema = z
  .strictObject({
    kind: z.literal("polygon"),
    points: z.array(pointSchema).min(3).max(128),
  })
  .refine((shape) => polygonArea(shape.points) > 1e-8, {
    message: "polygon must have nonzero area inside the normalized card",
  });

const geometrySchema = z.strictObject({
  coordinateFrame: z.literal("normalized_card"),
  units: z.literal("fraction"),
  shape: z.union([boxSchema, polygonSchema]),
});

const detectorSchema = z.strictObject({
  id: identifierSchema,
  version: identifierSchema,
  captureProfileVersion: identifierSchema,
  algorithmVersion: identifierSchema,
});

const storedReviewSchema = z
  .strictObject({
    status: z.enum(AI_GRADER_DEFECT_REVIEW_STATUSES),
    reviewedByUserId: identifierSchema.optional(),
    reviewedAt: isoTimestampSchema.optional(),
  })
  .superRefine((review, context) => {
    if (review.status === "unreviewed") {
      if (review.reviewedByUserId !== undefined || review.reviewedAt !== undefined) {
        context.addIssue({ code: "custom", message: "unreviewed findings must not carry review attribution" });
      }
      return;
    }
    if (!review.reviewedByUserId || !review.reviewedAt) {
      context.addIssue({ code: "custom", message: "reviewed findings require reviewer identity and timestamp" });
    }
  });

const publishedReviewSchema = z
  .strictObject({
    status: z.enum(AI_GRADER_DEFECT_REVIEW_STATUSES),
    reviewedAt: isoTimestampSchema.optional(),
  })
  .superRefine((review, context) => {
    if (review.status === "unreviewed" && review.reviewedAt !== undefined) {
      context.addIssue({ code: "custom", path: ["reviewedAt"], message: "must be absent while unreviewed" });
    }
    if (review.status !== "unreviewed" && !review.reviewedAt) {
      context.addIssue({ code: "custom", path: ["reviewedAt"], message: "is required for a reviewed finding" });
    }
  });

const evidenceSchema = z.strictObject({
  trueViewAssetId: assetIdSchema,
  overlayAssetId: assetIdSchema,
  segmentationMaskAssetId: assetIdSchema,
  confidenceMaskAssetId: assetIdSchema.optional(),
  illuminationMaskAssetId: assetIdSchema.optional(),
  heatmapAssetId: assetIdSchema.optional(),
  surfaceVisionAssetId: assetIdSchema.optional(),
  channelAssetIds: uniqueAssetIdsSchema,
  roiAssetIds: uniqueAssetIdsSchema.min(1),
  /**
   * Exact hash-bound sources that do not pretend to be a channel, mask, or
   * crop (for example an approved design artifact or calibrated detector
   * plane). Optional preserves readability of already-issued V2 findings.
   */
  additionalEvidenceAssetIds: uniqueAssetIdsSchema.optional(),
});

const findingFields = {
  schemaVersion: z.literal(AI_GRADER_DEFECT_FINDING_V2_VERSION),
  mathematicalSchemaVersion: z.literal(MATHEMATICAL_FINDING_V1_SCHEMA_VERSION),
  findingId: identifierSchema,
  physicalDefectId: identifierSchema,
  side: z.enum(["front", "back"]),
  category: z.enum(MATHEMATICAL_FINDING_CATEGORIES_V1),
  primaryElement: z.enum(["corners", "edges", "surface"]),
  location: identifierSchema,
  regionId: identifierSchema,
  detector: detectorSchema,
  thresholdSetId: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID),
  thresholdSetHash: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH),
  calibrationProfileId: identifierSchema,
  calibrationVersion: identifierSchema,
  severity: z.strictObject({
    normalized: fractionSchema,
    band: z.enum(AI_GRADER_DEFECT_SEVERITY_BANDS),
  }),
  confidence: fractionSchema,
  evidenceQuality: z.enum(["sufficient", "limited", "insufficient"]),
  geometry: geometrySchema,
  evidence: evidenceSchema,
  measurements: z.array(mathematicalMeasurementV1Schema).min(1).max(32),
  deductionBasisMeasurementId: identifierSchema,
  deduction: scoreWithTwoDecimalsSchema,
  severeDefectCap: mathematicalScoreV1Schema.optional(),
  secondaryEvidenceCategories: z.array(identifierSchema).max(32),
  explanation: safePublicTextSchema,
};

type FindingShape = {
  findingId: string;
  physicalDefectId: string;
  side: "front" | "back";
  category: (typeof MATHEMATICAL_FINDING_CATEGORIES_V1)[number];
  primaryElement: "corners" | "edges" | "surface";
  calibrationProfileId: string;
  calibrationVersion: string;
  detector: { algorithmVersion: string };
  severity: { normalized: number; band: "low" | "medium" | "high" };
  confidence: number;
  evidenceQuality: "sufficient" | "limited" | "insufficient";
  measurements: Array<z.infer<typeof mathematicalMeasurementV1Schema>>;
  deductionBasisMeasurementId: string;
  deduction: number;
  severeDefectCap?: number;
  evidence: z.infer<typeof evidenceSchema>;
};

function validateFindingV2(finding: FindingShape, context: z.RefinementCtx) {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[finding.category];
  if (finding.primaryElement !== policy.element) {
    context.addIssue({ code: "custom", path: ["primaryElement"], message: "must match the category primary element" });
  }
  const measurementIds = finding.measurements.map((measurement) => measurement.measurementId.toLowerCase());
  if (new Set(measurementIds).size !== measurementIds.length) {
    context.addIssue({ code: "custom", path: ["measurements"], message: "measurement IDs must be unique" });
  }
  const basis = finding.measurements.find(
    (measurement) => measurement.measurementId.toLowerCase() === finding.deductionBasisMeasurementId.toLowerCase(),
  );
  if (!basis) {
    context.addIssue({ code: "custom", path: ["deductionBasisMeasurementId"], message: "must reference a finding measurement" });
    return;
  }
  if (basis.kind !== policy.primaryMeasurementKind || basis.unit !== policy.unit) {
    context.addIssue({
      code: "custom",
      path: ["deductionBasisMeasurementId"],
      message: "must reference the manifest category primary measurement kind and unit",
    });
  }
  if (basis.explicitGrade10Tolerance !== policy.grade10Tolerance) {
    context.addIssue({
      code: "custom",
      path: ["measurements", finding.measurements.indexOf(basis), "explicitGrade10Tolerance"],
      message: "must match the manifest Grade-10 tolerance",
    });
  }
  if (basis.calibrationProfileId !== finding.calibrationProfileId || basis.calibrationVersion !== finding.calibrationVersion) {
    context.addIssue({ code: "custom", path: ["measurements"], message: "must use the finding calibration profile and version" });
  }
  if (basis.algorithmVersion !== finding.detector.algorithmVersion) {
    context.addIssue({ code: "custom", path: ["measurements"], message: "must use the finding algorithm version" });
  }
  if (basis.evidence.some((entry) => entry.side !== finding.side)) {
    context.addIssue({ code: "custom", path: ["measurements"], message: "measurement evidence must match the finding side" });
  }
  const minimumCoverage = policy.element === "corners"
    ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.minValidPixelCoverage
    : policy.element === "edges"
      ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.minValidPixelCoverage
      : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surfaceEvidence.minValidPixelCoverage;
  const minimumChannels = policy.element === "corners"
    ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.minUsableDirectionalChannels
    : policy.element === "edges"
      ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.minUsableDirectionalChannels
      : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surfaceEvidence.minValidDirectionalObservations;
  if (
    (basis.validEvidenceCoverage < minimumCoverage ||
      basis.usableDirectionalChannelCount < minimumChannels) &&
    finding.evidenceQuality !== "insufficient"
  ) {
    context.addIssue({ code: "custom", path: ["evidenceQuality"], message: "must be insufficient when manifest valid-pixel or usable-channel evidence gates fail" });
  }
  const calculation = calculateFindingDeductionV1({
    category: finding.category,
    measuredMeasurement: basis.measuredMeasurement,
    u95: basis.u95,
  });
  if (finding.severity.normalized !== calculation.normalizedSeverity) {
    context.addIssue({ code: "custom", path: ["severity", "normalized"], message: "must equal the manifest-derived severity" });
  }
  const expectedBand = calculation.normalizedSeverity >= policy.severityBreakpoints.high
    ? "high"
    : calculation.normalizedSeverity >= policy.severityBreakpoints.medium
      ? "medium"
      : "low";
  if (finding.severity.band !== expectedBand) {
    context.addIssue({ code: "custom", path: ["severity", "band"], message: "must match the manifest severity breakpoints" });
  }
  const expectedDeduction = finding.evidenceQuality === "insufficient" ? 0 : calculation.deduction;
  if (finding.deduction !== expectedDeduction) {
    context.addIssue({ code: "custom", path: ["deduction"], message: "must equal the exact manifest-derived deduction" });
  }
  const applicableSevereCap = finding.evidenceQuality === "insufficient"
    ? undefined
    : calculateApplicableSevereDefectCapV1(finding.category, finding.measurements);
  if (finding.severeDefectCap !== applicableSevereCap) {
    context.addIssue({ code: "custom", path: ["severeDefectCap"], message: "must equal the applicable manifest severe-defect cap" });
  }
  const evidenceAssetIds = new Set([
    finding.evidence.trueViewAssetId,
    finding.evidence.overlayAssetId,
    finding.evidence.segmentationMaskAssetId,
    finding.evidence.confidenceMaskAssetId,
    finding.evidence.illuminationMaskAssetId,
    finding.evidence.heatmapAssetId,
    finding.evidence.surfaceVisionAssetId,
    ...finding.evidence.channelAssetIds,
    ...finding.evidence.roiAssetIds,
    ...(finding.evidence.additionalEvidenceAssetIds ?? []),
  ].filter((entry): entry is string => Boolean(entry)).map((entry) => entry.toLowerCase()));
  for (const binding of basis.evidence) {
    if (!evidenceAssetIds.has(binding.assetId.toLowerCase())) {
      context.addIssue({ code: "custom", path: ["evidence"], message: "must expose every deduction-basis source asset" });
      break;
    }
  }
}

export const aiGraderStoredDefectFindingV2Schema = z
  .strictObject({ ...findingFields, review: storedReviewSchema })
  .superRefine(validateFindingV2);

export const aiGraderPublishedDefectFindingV2Schema = z
  .strictObject({ ...findingFields, review: publishedReviewSchema })
  .superRefine(validateFindingV2);

export type AiGraderStoredDefectFindingV2 = z.infer<typeof aiGraderStoredDefectFindingV2Schema>;
export type AiGraderPublishedDefectFindingV2 = z.infer<typeof aiGraderPublishedDefectFindingV2Schema>;

export function parseAiGraderPublishedDefectFindingV2(value: unknown) {
  return aiGraderPublishedDefectFindingV2Schema.safeParse(value);
}

export function parseAiGraderPublishedDefectFindingsV2(value: unknown): {
  success: boolean;
  findings: AiGraderPublishedDefectFindingV2[];
  issues: Array<{ path: string; message: string }>;
} {
  const parsed = z.array(aiGraderPublishedDefectFindingV2Schema).max(AI_GRADER_DEFECT_FINDING_MAX_COUNT).safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      findings: [],
      issues: parsed.error.issues.map((entry) => ({ path: entry.path.join("."), message: entry.message })),
    };
  }
  const findings = parsed.data;
  const issues: Array<{ path: string; message: string }> = [];
  const findingIds = new Set<string>();
  const physicalDefectIds = new Set<string>();
  findings.forEach((finding, index) => {
    const findingId = finding.findingId.toLowerCase();
    const physicalDefectId = finding.physicalDefectId.toLowerCase();
    if (findingIds.has(findingId)) issues.push({ path: `${index}.findingId`, message: "a finding ID may occur only once" });
    if (physicalDefectIds.has(physicalDefectId)) {
      issues.push({ path: `${index}.physicalDefectId`, message: "a physical defect may deduct only once across categories" });
    }
    findingIds.add(findingId);
    physicalDefectIds.add(physicalDefectId);
  });
  return { success: issues.length === 0, findings: issues.length ? [] : findings, issues };
}

export type AiGraderDefectFindingV1OrV2 =
  | AiGraderPublishedDefectFindingV1
  | AiGraderPublishedDefectFindingV2;

export const aiGraderPublishedDefectFindingSchema = z.union([
  aiGraderPublishedDefectFindingV1Schema,
  aiGraderPublishedDefectFindingV2Schema,
]);
