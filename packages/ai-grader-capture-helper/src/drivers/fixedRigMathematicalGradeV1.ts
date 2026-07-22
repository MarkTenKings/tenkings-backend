import {
  MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  aggregateCornerScoreV1,
  aggregateEdgeScoreV1,
  calculateApplicableSevereDefectCapV1,
  calculateFindingDeductionV1,
  calculateOverallGradeV1,
  formatMathematicalScoreV1,
  mathematicalDeductionLedgerV1Schema,
  mathematicalFindingV1Schema,
  roundMathematicalScoreV1,
  type OperationallyUsableMathematicalCalibrationProfileV1 as MathematicalCalibrationProfileV1,
  type MathematicalDeductionLedgerV1,
  type MathematicalFindingCategoryV1,
  type MathematicalGradingElementV1,
  type MathematicalMeasurementV1,
} from "@tenkings/shared";
import { validateMathematicalCalibrationForOperationalUseV1 } from "./productOwnerOperationalAcceptanceV1";
import type {
  FixedRigCenteringElementResultV1,
} from "./fixedRigCenteringV1";
import type {
  FixedRigConditionElementResultV1,
} from "./fixedRigCornerEdgeV1";
import type {
  FixedRigSurfaceFindingV1,
  FixedRigSurfaceV1Result,
} from "./fixedRigSurfaceV1";

export const FIXED_RIG_MATHEMATICAL_GRADE_V1_VERSION =
  "fixed_rig_mathematical_grade_composer_v1" as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SCORE_MINIMUM = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.minimum;
const SCORE_MAXIMUM = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.maximum;

type ComputedCentering = Extract<FixedRigCenteringElementResultV1, { status: "computed" }>;
type ComputedCondition = Extract<FixedRigConditionElementResultV1, { status: "computed" }>;

export interface FixedRigPhysicalDefectDeduplicationV1 {
  canonicalPhysicalDefectId: string;
  retainedFindingId: string;
  linkedFindingIds: string[];
  reason: string;
}

export interface BuildFixedRigMathematicalGradeV1Input {
  calibration: MathematicalCalibrationProfileV1;
  centering: FixedRigCenteringElementResultV1;
  corners: FixedRigConditionElementResultV1;
  edges: FixedRigConditionElementResultV1;
  surface: {
    front: FixedRigSurfaceV1Result;
    back: FixedRigSurfaceV1Result;
  };
  /**
   * Legacy assertion-only field. Mathematical Calibration V1 never uses a
   * caller-provided link or physical-defect ID as deduction authority.
   */
  physicalDefectDeduplication?: FixedRigPhysicalDefectDeduplicationV1[];
}

export interface FixedRigGradeIssueV1 {
  code:
    | "invalid_calibration"
    | "missing_element_evidence"
    | "recapture_required"
    | "approved_design_reference_required"
    | "calibration_identity_mismatch"
    | "threshold_contract_mismatch"
    | "invalid_finding"
    | "invalid_deduplication"
    | "formula_mismatch"
    | "invalid_deduction_ledger";
  element?: MathematicalGradingElementV1;
  message: string;
}

export interface FixedRigGradeLocationScoreV1 {
  side: "front" | "back";
  location: string;
  score: number;
  scoreText: string;
  penalty: number;
  findingIds: string[];
}

export interface FixedRigGradeElementScoreV1 {
  score: number;
  scoreText: string;
  startingScore: 10;
  frontScore: number;
  frontScoreText: string;
  backScore: number;
  backScoreText: string;
  aggregatePenalty: number;
  locationScores: FixedRigGradeLocationScoreV1[];
  findingIds: string[];
  formula: string;
  explanation: string;
}

export interface FixedRigComposedPhysicalFindingV1 {
  source: "corner_edge" | "surface";
  findingId: string;
  physicalDefectId: string;
  originalPhysicalDefectId: string;
  element: "corners" | "edges" | "surface";
  category: MathematicalFindingCategoryV1;
  side: "front" | "back";
  location: string;
  regionId: string;
  algorithmVersion: string;
  calibrationProfileId: string;
  calibrationVersion: string;
  measurements: MathematicalMeasurementV1[];
  deductionBasisMeasurementId: string;
  normalizedSeverity: number;
  deduction: number;
  severeDefectCap?: number;
  evidenceAssetIds: string[];
  explanation: string;
}

export interface FixedRigWhyNot10V1 {
  id: string;
  element: MathematicalGradingElementV1;
  findingIds: string[];
  evidenceAssetIds: string[];
  deduction: number;
  explanation: string;
}

export type FixedRigMathematicalGradeV1Result =
  | {
      version: typeof FIXED_RIG_MATHEMATICAL_GRADE_V1_VERSION;
      status: "final_mathematical_grade_v1";
      scoringContract: "mathematical_calibration_v1";
      v0FallbackUsed: false;
      thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
      thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
      calibration: {
        profileId: string;
        version: string;
        artifactSha256: string;
        status: "finalized";
        isCalibrated: true;
      };
      overall: number;
      overallText: string;
      labelGrade: number;
      labelGradeText: string;
      weightedGrade: number;
      weightedGradeText: string;
      weakestElement: MathematicalGradingElementV1;
      weakestScore: number;
      weakestScoreText: string;
      weakestElementCap: number;
      weakestElementCapText: string;
      applicableSevereDefectCap?: number;
      applicableSevereDefectCapText?: string;
      elements: Record<MathematicalGradingElementV1, FixedRigGradeElementScoreV1>;
      weightedFormula: string;
      formula: string;
      deductionLedger: MathematicalDeductionLedgerV1;
      findings: FixedRigComposedPhysicalFindingV1[];
      surfaceSourceEvidence: {
        front: FixedRigSurfaceV1Result["sourceEvidence"];
        back: FixedRigSurfaceV1Result["sourceEvidence"];
      };
      deduplication: FixedRigPhysicalDefectDeduplicationV1[];
      whyNot10: FixedRigWhyNot10V1[];
      whyNot10Summary: string;
      noDoubleDeduction: true;
    }
  | {
      version: typeof FIXED_RIG_MATHEMATICAL_GRADE_V1_VERSION;
      status: "insufficient_evidence";
      scoringContract: "mathematical_calibration_v1";
      v0FallbackUsed: false;
      thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
      thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
      overall: null;
      labelGrade: null;
      elements: {
        centering: null;
        corners: null;
        edges: null;
        surface: null;
      };
      issues: FixedRigGradeIssueV1[];
      requiresRecapture: boolean;
      requiresApprovedDesignReference: boolean;
      requiresCalibration: boolean;
      requiresImplementationCorrection: boolean;
      noConditionDeductionFromInvalidEvidence: true;
    };

interface CandidateFindingV1 {
  source: "corner_edge" | "surface";
  findingId: string;
  physicalDefectId: string;
  element: "corners" | "edges" | "surface";
  category: MathematicalFindingCategoryV1;
  side: "front" | "back";
  location: string;
  regionId: string;
  algorithmVersion: string;
  calibrationProfileId: string;
  calibrationVersion: string;
  measurements: MathematicalMeasurementV1[];
  deductionBasisMeasurementId: string;
  normalizedSeverity: number;
  deduction: number;
  severeDefectCap?: number;
  explanation: string;
  normalizedGeometry?: {
    coordinateFrame: "normalized_observation_roi" | "normalized_card_portrait_pixels";
    boundingBox: { x: number; y: number; width: number; height: number };
    centroid: { x: number; y: number };
  };
}

function round(value: number, decimals = 2): number {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function scoreText(score: number): string {
  return formatMathematicalScoreV1(score);
}

function insufficient(issues: FixedRigGradeIssueV1[]): FixedRigMathematicalGradeV1Result {
  const codes = new Set(issues.map((issue) => issue.code));
  return {
    version: FIXED_RIG_MATHEMATICAL_GRADE_V1_VERSION,
    status: "insufficient_evidence",
    scoringContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    overall: null,
    labelGrade: null,
    elements: { centering: null, corners: null, edges: null, surface: null },
    issues,
    requiresRecapture: codes.has("recapture_required"),
    requiresApprovedDesignReference: codes.has("approved_design_reference_required"),
    requiresCalibration: codes.has("invalid_calibration") || codes.has("calibration_identity_mismatch"),
    requiresImplementationCorrection: [
      "threshold_contract_mismatch",
      "invalid_finding",
      "invalid_deduplication",
      "formula_mismatch",
      "invalid_deduction_ledger",
    ].some((code) => codes.has(code as FixedRigGradeIssueV1["code"])),
    noConditionDeductionFromInvalidEvidence: true,
  };
}

function calibrationMatches(
  actual: { profileId: string; version: string; sha256: string },
  expected: MathematicalCalibrationProfileV1,
): boolean {
  return actual.profileId === expected.profileId &&
    actual.version === expected.calibrationVersion &&
    actual.sha256.toLowerCase() === expected.artifactSha256.toLowerCase();
}

function thresholdMatches(actual: { thresholdSetId: string; thresholdSetHash: string }): boolean {
  return actual.thresholdSetId === MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID &&
    actual.thresholdSetHash === MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
}

function uniqueCaseInsensitive(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function basisMeasurement(candidate: CandidateFindingV1): MathematicalMeasurementV1 | undefined {
  return candidate.measurements.find(
    (measurement) =>
      measurement.measurementId.toLowerCase() === candidate.deductionBasisMeasurementId.toLowerCase(),
  );
}

function collectAvailabilityIssues(
  input: BuildFixedRigMathematicalGradeV1Input,
): FixedRigGradeIssueV1[] {
  const issues: FixedRigGradeIssueV1[] = [];
  if (input.centering.status !== "computed") {
    const referenceRequired = [input.centering.front, input.centering.back].some(
      (side) =>
        side.status === "insufficient_evidence" &&
        side.profile === "registered_design_template_v1",
    );
    issues.push({
      code: referenceRequired
        ? "approved_design_reference_required"
        : "recapture_required",
      element: "centering",
      message: input.centering.reasons.join(" ") ||
        "Front and back physical-design centering evidence are mandatory.",
    });
  }
  for (const [element, result] of [
    ["corners", input.corners],
    ["edges", input.edges],
  ] as const) {
    if (result.status !== "computed") {
      issues.push({
        code: "recapture_required",
        element,
        message: result.reasons.join(" ") ||
          `All eight calibrated ${element} observations are mandatory.`,
      });
    }
  }
  for (const side of ["front", "back"] as const) {
    const result = input.surface[side];
    if (result.status !== "computed") {
      const limitations = result.evidenceQualityLimitations.map((entry) => entry.message);
      issues.push({
        code: limitations.length ? "recapture_required" : "missing_element_evidence",
        element: "surface",
        message: `${side} surface: ${limitations.join(" ") ||
          "calibrated surface evidence is mandatory."}`,
      });
    }
  }
  return issues;
}

function conditionCandidates(
  result: ComputedCondition,
  expectedElement: "corners" | "edges",
  calibration: MathematicalCalibrationProfileV1,
  issues: FixedRigGradeIssueV1[],
): CandidateFindingV1[] {
  if (result.element !== expectedElement || !thresholdMatches(result)) {
    issues.push({
      code: "threshold_contract_mismatch",
      element: expectedElement,
      message: `${expectedElement} does not identify the exact Mathematical Grading V1 threshold set.`,
    });
  }
  const expectedLocations = expectedElement === "corners"
    ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.locationsPerSide
    : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.locationsPerSide;
  const expectedKeys = new Set(
    (["front", "back"] as const).flatMap((side) =>
      expectedLocations.map((location) => `${side}:${location}`),
    ),
  );
  const actualKeys = result.observations.map(
    (observation) => `${observation.side}:${observation.location}`,
  );
  if (
    result.observations.length !== expectedKeys.size ||
    new Set(actualKeys).size !== actualKeys.length ||
    actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    issues.push({
      code: "missing_element_evidence",
      element: expectedElement,
      message: `${expectedElement} must contain exactly one calibrated observation for every front/back location.`,
    });
  }
  const candidates: CandidateFindingV1[] = [];
  for (const observation of result.observations) {
    const actualCalibration = {
      profileId: observation.calibrationProfileId,
      version: observation.calibrationVersion,
      sha256: observation.calibrationSha256,
    };
    if (!calibrationMatches(actualCalibration, calibration)) {
      issues.push({
        code: "calibration_identity_mismatch",
        element: expectedElement,
        message: `${observation.side} ${observation.location} ${expectedElement} evidence does not match the finalized calibration artifact.`,
      });
    }
    for (const wrapper of observation.findings) {
      const parsed = mathematicalFindingV1Schema.safeParse(wrapper.finding);
      const geometry = wrapper.normalizedGeometry;
      const geometryValues = geometry ? [
        geometry.boundingBox.x,
        geometry.boundingBox.y,
        geometry.boundingBox.width,
        geometry.boundingBox.height,
        geometry.centroid.x,
        geometry.centroid.y,
      ] : [Number.NaN];
      if (
        !parsed.success ||
        !geometry ||
        geometry.coordinateFrame !== "normalized_observation_roi" ||
        geometryValues.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
        geometry.boundingBox.width <= 0 ||
        geometry.boundingBox.height <= 0 ||
        geometry.boundingBox.x + geometry.boundingBox.width > 1.000001 ||
        geometry.boundingBox.y + geometry.boundingBox.height > 1.000001 ||
        wrapper.finding.primaryElement !== expectedElement ||
        wrapper.finding.side !== observation.side ||
        wrapper.finding.location !== observation.location ||
        wrapper.deduction !== wrapper.finding.deduction ||
        wrapper.measurements.length !== wrapper.finding.measurements.length ||
        wrapper.measurements !== wrapper.finding.measurements &&
          wrapper.measurements.some((measurement, index) =>
            measurement.measurementId !== wrapper.finding.measurements[index]?.measurementId)
      ) {
        issues.push({
          code: "invalid_finding",
          element: expectedElement,
          message: `Finding ${wrapper.finding.findingId} is not an exact, self-consistent Mathematical Grading V1 finding.`,
        });
        continue;
      }
      candidates.push({
        source: "corner_edge",
        findingId: wrapper.finding.findingId,
        physicalDefectId: wrapper.finding.physicalDefectId,
        element: expectedElement,
        category: wrapper.finding.category,
        side: wrapper.finding.side,
        location: wrapper.finding.location,
        regionId: wrapper.finding.regionId,
        algorithmVersion: wrapper.finding.algorithmVersion,
        calibrationProfileId: wrapper.finding.calibrationProfileId,
        calibrationVersion: wrapper.finding.calibrationVersion,
        measurements: wrapper.finding.measurements,
        deductionBasisMeasurementId: wrapper.finding.deductionBasisMeasurementId,
        normalizedSeverity: wrapper.finding.normalizedSeverity,
        deduction: wrapper.finding.deduction,
        ...(wrapper.finding.severeDefectCap === undefined
          ? {}
          : { severeDefectCap: wrapper.finding.severeDefectCap }),
        explanation: wrapper.finding.explanation,
        normalizedGeometry: {
          coordinateFrame: geometry.coordinateFrame,
          boundingBox: { ...geometry.boundingBox },
          centroid: { ...geometry.centroid },
        },
      });
    }
  }
  return candidates;
}

function validateSurfaceFinding(
  finding: FixedRigSurfaceFindingV1,
  result: FixedRigSurfaceV1Result,
  calibration: MathematicalCalibrationProfileV1,
  issues: FixedRigGradeIssueV1[],
): CandidateFindingV1 | undefined {
  const basis = finding.measurements.find(
    (measurement) =>
      measurement.measurementId.toLowerCase() === finding.deductionBasisMeasurementId.toLowerCase(),
  );
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[finding.category];
  if (!basis || policy.element !== "surface") {
    issues.push({
      code: "invalid_finding",
      element: "surface",
      message: `Surface finding ${finding.findingId} lacks its manifest-owned primary measurement.`,
    });
    return undefined;
  }
  const calculation = calculateFindingDeductionV1({
    category: finding.category,
    measuredMeasurement: basis.measuredMeasurement,
    u95: basis.u95,
  });
  const severeCap = calculateApplicableSevereDefectCapV1(finding.category, finding.measurements);
  const measurementMismatch = finding.measurements.some((measurement) =>
    measurement.calibrationProfileId !== calibration.profileId ||
    measurement.calibrationVersion !== calibration.calibrationVersion ||
    !thresholdMatches(measurement)
  );
  if (
    finding.side !== result.side ||
    finding.deduction !== calculation.deduction ||
    finding.deductionCalculation.normalizedSeverity !== calculation.normalizedSeverity ||
    finding.deductionCalculation.deduction !== calculation.deduction ||
    finding.severeDefectCap !== severeCap ||
    measurementMismatch
  ) {
    issues.push({
      code: measurementMismatch ? "calibration_identity_mismatch" : "invalid_finding",
      element: "surface",
      message: `Surface finding ${finding.findingId} does not reproduce its exact calibration, uncertainty, severity, and deduction contract.`,
    });
    return undefined;
  }
  return {
    source: "surface",
    findingId: finding.findingId,
    physicalDefectId: finding.physicalDefectId,
    element: "surface",
    category: finding.category,
    side: finding.side,
    location: finding.regionId,
    regionId: finding.regionId,
    algorithmVersion: basis.algorithmVersion,
    calibrationProfileId: basis.calibrationProfileId,
    calibrationVersion: basis.calibrationVersion,
    measurements: finding.measurements,
    deductionBasisMeasurementId: finding.deductionBasisMeasurementId,
    normalizedSeverity: calculation.normalizedSeverity,
    deduction: finding.deduction,
    ...(severeCap === undefined ? {} : { severeDefectCap: severeCap }),
    explanation: finding.explanation,
  };
}

function surfaceCandidates(
  results: readonly FixedRigSurfaceV1Result[],
  calibration: MathematicalCalibrationProfileV1,
  issues: FixedRigGradeIssueV1[],
): CandidateFindingV1[] {
  const candidates: CandidateFindingV1[] = [];
  const sides = results.map((result) => result.side);
  if (
    sides.length !== 2 ||
    new Set(sides).size !== 2 ||
    !sides.includes("front") ||
    !sides.includes("back")
  ) {
    issues.push({
      code: "missing_element_evidence",
      element: "surface",
      message: "Exactly one front and one back calibrated surface result are mandatory.",
    });
  }
  const crossSideAssetIds = results.flatMap((result) =>
    Array.isArray(result.sourceEvidence)
      ? result.sourceEvidence.map((entry) => entry.assetId.toLowerCase())
      : [],
  );
  if (new Set(crossSideAssetIds).size !== crossSideAssetIds.length) {
    issues.push({
      code: "recapture_required",
      element: "surface",
      message: "Front and back surface evidence must use distinct immutable source assets; a capture asset cannot stand in for both sides.",
    });
  }
  for (const result of results) {
    if (!thresholdMatches(result) ||
        result.formula !== MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surface.formula) {
      issues.push({
        code: "threshold_contract_mismatch",
        element: "surface",
        message: `${result.side} surface does not identify the exact Mathematical Grading V1 formula and threshold set.`,
      });
    }
    if (!calibrationMatches({
      profileId: result.calibrationProfileId,
      version: result.calibrationVersion,
      sha256: result.calibrationSha256,
    }, calibration)) {
      issues.push({
        code: "calibration_identity_mismatch",
        element: "surface",
        message: `${result.side} surface evidence does not match the finalized calibration artifact.`,
      });
    }
    const sourceEvidence = Array.isArray(result.sourceEvidence)
      ? result.sourceEvidence
      : [];
    const requiredChannels =
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount;
    const channelIndices = sourceEvidence.map((entry) => entry.channelIndex);
    const assetIds = sourceEvidence.map((entry) => entry.assetId.toLowerCase());
    if (
      sourceEvidence.length !== requiredChannels ||
      new Set(channelIndices).size !== requiredChannels ||
      new Set(assetIds).size !== requiredChannels ||
      channelIndices.some((channel) =>
        !Number.isInteger(channel) || channel < 1 || channel > requiredChannels
      ) ||
      sourceEvidence.some((entry) =>
        entry.side !== result.side ||
        entry.role !== "directional_channel" ||
        entry.regionId !== `${result.side}-full-surface` ||
        !entry.assetId.trim() ||
        !SHA256_PATTERN.test(entry.sha256)
      )
    ) {
      issues.push({
        code: "recapture_required",
        element: "surface",
        message: `${result.side} surface must bind exactly one immutable source asset for each of the ${requiredChannels} calibrated directional channels.`,
      });
    }
    for (const finding of result.findings) {
      const candidate = validateSurfaceFinding(finding, result, calibration, issues);
      if (candidate) candidates.push(candidate);
    }
    const expectedDeduction = round(result.findings.reduce((sum, finding) => sum + finding.deduction, 0));
    const expectedScore = roundMathematicalScoreV1(SCORE_MAXIMUM - expectedDeduction);
    if (
      result.totalDeduction !== expectedDeduction ||
      result.score !== expectedScore ||
      result.uniquePhysicalFindingCount !== result.findings.length ||
      !result.noDoubleDeduction
    ) {
      issues.push({
        code: "formula_mismatch",
        element: "surface",
        message: `${result.side} surface does not equal 10.00 minus its unique measurement-derived findings.`,
      });
    }
  }
  return candidates;
}

function validateCentering(
  centering: ComputedCentering,
  calibration: MathematicalCalibrationProfileV1,
  issues: FixedRigGradeIssueV1[],
): void {
  if (!thresholdMatches(centering) ||
      centering.formula !==
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula) {
    issues.push({
      code: "threshold_contract_mismatch",
      element: "centering",
      message: "Centering does not identify the exact Mathematical Grading V1 fusion and threshold set.",
    });
  }
  for (const side of [centering.front, centering.back]) {
    if (!thresholdMatches(side) ||
        side.formula !== "sideScore = min(horizontalAxisScore, verticalAxisScore)") {
      issues.push({
        code: "threshold_contract_mismatch",
        element: "centering",
        message: `${side.side} centering does not identify the exact side formula and threshold set.`,
      });
    }
    if (!calibrationMatches({
      profileId: side.calibrationProfileId,
      version: side.calibrationVersion,
      sha256: side.calibrationArtifactSha256,
    }, calibration)) {
      issues.push({
        code: "calibration_identity_mismatch",
        element: "centering",
        message: `${side.side} centering does not match the finalized calibration artifact.`,
      });
    }
    if (
      side.evidence.length === 0 ||
      side.measurementLines.length !== 4 ||
      side.outerCutContour.length < 4 ||
      side.printedDesignContour.length < 4
    ) {
      issues.push({
        code: "missing_element_evidence",
        element: "centering",
        message: `${side.side} centering lacks a cut contour, design contour, four measurement lines, or immutable source evidence.`,
      });
    }
  }
  const expectedScore = roundMathematicalScoreV1(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.worstWeight *
      Math.min(centering.front.score, centering.back.score) +
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.averageWeight *
      ((centering.front.score + centering.back.score) / 2),
  );
  if (
    centering.frontScore !== centering.front.score ||
    centering.backScore !== centering.back.score ||
    centering.score !== expectedScore ||
    centering.centeringDeduction !== round(SCORE_MAXIMUM - expectedScore)
  ) {
    issues.push({
      code: "formula_mismatch",
      element: "centering",
      message: "Centering does not reproduce the exact conservative worst-plus-average front/back fusion.",
    });
  }
}

function mirroredPhysicalLocationMatches(
  element: "corners" | "edges" | "surface",
  frontLocation: string,
  backLocation: string,
): boolean {
  if (element === "surface") return false;
  const mirror = element === "corners"
    ? {
        top_left: "top_right",
        top_right: "top_left",
        bottom_left: "bottom_right",
        bottom_right: "bottom_left",
      } as Record<string, string>
    : {
        top: "top",
        right: "left",
        bottom: "bottom",
        left: "right",
      } as Record<string, string>;
  return mirror[frontLocation] === backLocation;
}

function geometryInFrontPhysicalFrame(
  candidate: CandidateFindingV1,
): NonNullable<CandidateFindingV1["normalizedGeometry"]> | undefined {
  const geometry = candidate.normalizedGeometry;
  if (!geometry) return undefined;
  if (candidate.side === "front") return geometry;
  return {
    coordinateFrame: geometry.coordinateFrame,
    boundingBox: {
      x: round(1 - geometry.boundingBox.x - geometry.boundingBox.width, 6),
      y: geometry.boundingBox.y,
      width: geometry.boundingBox.width,
      height: geometry.boundingBox.height,
    },
    centroid: {
      x: round(1 - geometry.centroid.x, 6),
      y: geometry.centroid.y,
    },
  };
}

function normalizedBoxIou(
  left: NonNullable<CandidateFindingV1["normalizedGeometry"]>["boundingBox"],
  right: NonNullable<CandidateFindingV1["normalizedGeometry"]>["boundingBox"],
): number {
  const overlapWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const intersection = overlapWidth * overlapHeight;
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

interface DeterministicFindingMatchV1 {
  front: CandidateFindingV1;
  back: CandidateFindingV1;
  iou: number;
  centroidDistance: number;
  measurementDifference: number;
}

function findDeterministicPhysicalMatches(
  candidates: readonly CandidateFindingV1[],
): DeterministicFindingMatchV1[] {
  const front = candidates.filter((candidate) =>
    candidate.side === "front" && candidate.element !== "surface"
  );
  const back = candidates.filter((candidate) =>
    candidate.side === "back" && candidate.element !== "surface"
  );
  const matches = front.flatMap((frontCandidate) => back.flatMap((backCandidate) => {
    if (frontCandidate.element !== backCandidate.element ||
        frontCandidate.category !== backCandidate.category ||
        !mirroredPhysicalLocationMatches(
          frontCandidate.element,
          frontCandidate.location,
          backCandidate.location,
        )) return [];
    const frontGeometry = geometryInFrontPhysicalFrame(frontCandidate);
    const backGeometry = geometryInFrontPhysicalFrame(backCandidate);
    const frontMeasurement = basisMeasurement(frontCandidate);
    const backMeasurement = basisMeasurement(backCandidate);
    if (!frontGeometry || !backGeometry || !frontMeasurement || !backMeasurement ||
        frontGeometry.coordinateFrame !== backGeometry.coordinateFrame ||
        frontMeasurement.kind !== backMeasurement.kind ||
        frontMeasurement.unit !== backMeasurement.unit) return [];
    const policy = frontCandidate.element === "corners"
      ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.frontBackPhysicalMatch
      : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.frontBackPhysicalMatch;
    const iou = normalizedBoxIou(frontGeometry.boundingBox, backGeometry.boundingBox);
    const centroidDistance = Math.hypot(
      frontGeometry.centroid.x - backGeometry.centroid.x,
      frontGeometry.centroid.y - backGeometry.centroid.y,
    );
    if (iou < policy.minimumBoundingBoxIou &&
        centroidDistance > policy.maximumNormalizedCentroidDistance) return [];
    const measurementDifference = Math.abs(
      frontMeasurement.effectiveMeasurement - backMeasurement.effectiveMeasurement,
    );
    const allowedDifference = Math.max(
      Math.max(frontMeasurement.effectiveMeasurement, backMeasurement.effectiveMeasurement) *
        policy.maximumRelativeEffectiveMeasurementDifference,
      (frontMeasurement.u95 + backMeasurement.u95) * policy.u95IntervalMultiplier,
    );
    if (measurementDifference > allowedDifference) return [];
    return [{
      front: frontCandidate,
      back: backCandidate,
      iou,
      centroidDistance,
      measurementDifference,
    }];
  })).sort((left, right) =>
    right.iou - left.iou ||
    left.centroidDistance - right.centroidDistance ||
    left.measurementDifference - right.measurementDifference ||
    left.front.findingId.localeCompare(right.front.findingId) ||
    left.back.findingId.localeCompare(right.back.findingId)
  );
  const used = new Set<string>();
  return matches.filter((match) => {
    const frontKey = match.front.findingId.toLowerCase();
    const backKey = match.back.findingId.toLowerCase();
    if (used.has(frontKey) || used.has(backKey)) return false;
    used.add(frontKey);
    used.add(backKey);
    return true;
  });
}

function safePhysicalIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "finding";
}

function resolveDeduplication(
  candidates: CandidateFindingV1[],
  issues: FixedRigGradeIssueV1[],
): {
  retained: CandidateFindingV1[];
  canonicalByFindingId: Map<string, string>;
  links: FixedRigPhysicalDefectDeduplicationV1[];
} {
  const byFindingId = new Map<string, CandidateFindingV1>();
  for (const candidate of candidates) {
    const key = candidate.findingId.toLowerCase();
    if (byFindingId.has(key)) {
      issues.push({
        code: "invalid_deduplication",
        element: candidate.element,
        message: `Finding ID ${candidate.findingId} occurs more than once.`,
      });
    } else {
      byFindingId.set(key, candidate);
    }
  }
  const suppressed = new Set<string>();
  const canonicalByFindingId = new Map<string, string>();
  const links: FixedRigPhysicalDefectDeduplicationV1[] = [];
  for (const [matchIndex, match] of findDeterministicPhysicalMatches(candidates).entries()) {
    const members = [match.front, match.back];
    const retained = [...members].sort((left, right) =>
      right.deduction - left.deduction || left.findingId.localeCompare(right.findingId)
    )[0]!;
    const duplicate = members.find((member) => member !== retained)!;
    const canonicalPhysicalDefectId =
      `mathematical-${match.front.element}-front-back-${matchIndex + 1}`;
    for (const member of members) {
      canonicalByFindingId.set(member.findingId.toLowerCase(), canonicalPhysicalDefectId);
    }
    suppressed.add(duplicate.findingId.toLowerCase());
    links.push({
      canonicalPhysicalDefectId,
      retainedFindingId: retained.findingId,
      linkedFindingIds: members.map((member) => member.findingId),
      reason:
        `Deterministic calibrated front/back physical match: category ${retained.category}; ` +
        `normalized ROI box IoU ${round(match.iou, 6)}, centroid distance ${round(match.centroidDistance, 6)}, ` +
        `effective-measurement difference ${round(match.measurementDifference, 6)}.`,
    });
  }
  const retained = candidates.filter((candidate) => !suppressed.has(candidate.findingId.toLowerCase()));
  [...retained]
    .sort((left, right) => left.findingId.localeCompare(right.findingId))
    .forEach((candidate, index) => {
      const key = candidate.findingId.toLowerCase();
      if (canonicalByFindingId.has(key)) return;
      canonicalByFindingId.set(
        key,
        `mathematical-${candidate.element}-${candidate.side}-${safePhysicalIdPart(candidate.location)}-${index + 1}`,
      );
    });
  return { retained, canonicalByFindingId, links };
}

function sidePenaltyScore(
  penalties: readonly number[],
  policy: { worstWeight: number; averageWeight: number },
): number {
  const worst = Math.max(...penalties);
  const average = penalties.reduce((sum, penalty) => sum + penalty, 0) / penalties.length;
  return roundMathematicalScoreV1(
    SCORE_MAXIMUM - (policy.worstWeight * worst + policy.averageWeight * average),
  );
}

function conditionElementScore(
  element: "corners" | "edges",
  result: ComputedCondition,
  retained: readonly CandidateFindingV1[],
): FixedRigGradeElementScoreV1 {
  const policy = element === "corners"
    ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners
    : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges;
  const findingByLocation = new Map<string, CandidateFindingV1[]>();
  retained.filter((finding) => finding.element === element).forEach((finding) => {
    const key = `${finding.side}:${finding.location}`;
    findingByLocation.set(key, [...(findingByLocation.get(key) ?? []), finding]);
  });
  const orderedObservations = [...result.observations].sort((left, right) => {
    if (left.side !== right.side) return left.side === "front" ? -1 : 1;
    return policy.locationsPerSide.indexOf(left.location as never) -
      policy.locationsPerSide.indexOf(right.location as never);
  });
  const locationScores = orderedObservations.map((observation) => {
    const findings = findingByLocation.get(`${observation.side}:${observation.location}`) ?? [];
    const penalty = round(Math.min(
      SCORE_MAXIMUM - SCORE_MINIMUM,
      findings.reduce((sum, finding) => sum + finding.deduction, 0),
    ));
    const score = roundMathematicalScoreV1(SCORE_MAXIMUM - penalty);
    return {
      side: observation.side,
      location: observation.location,
      score,
      scoreText: scoreText(score),
      penalty,
      findingIds: findings.map((finding) => finding.findingId),
    };
  });
  const penalties = locationScores.map((location) => location.penalty);
  const aggregation = element === "corners"
    ? aggregateCornerScoreV1(penalties)
    : aggregateEdgeScoreV1(penalties);
  const frontPenalties = locationScores
    .filter((location) => location.side === "front")
    .map((location) => location.penalty);
  const backPenalties = locationScores
    .filter((location) => location.side === "back")
    .map((location) => location.penalty);
  const frontScore = sidePenaltyScore(frontPenalties, policy);
  const backScore = sidePenaltyScore(backPenalties, policy);
  const findingIds = locationScores.flatMap((location) => location.findingIds);
  return {
    score: aggregation.score,
    scoreText: scoreText(aggregation.score),
    startingScore: 10,
    frontScore,
    frontScoreText: scoreText(frontScore),
    backScore,
    backScoreText: scoreText(backScore),
    aggregatePenalty: round(aggregation.aggregatePenalty),
    locationScores,
    findingIds,
    formula: policy.formula,
    explanation:
      `${element} starts at 10.00; ${policy.worstWeight.toFixed(2)} of the worst independent location penalty plus ` +
      `${policy.averageWeight.toFixed(2)} of the eight-location average yields an exact ${aggregation.aggregatePenalty.toFixed(6)} penalty.`,
  };
}

function centeringElementScore(
  centering: ComputedCentering,
): FixedRigGradeElementScoreV1 {
  const evidenceIds = uniqueCaseInsensitive([
    ...centering.front.evidence.map((entry) => entry.assetId),
    ...centering.back.evidence.map((entry) => entry.assetId),
  ]);
  return {
    score: centering.score,
    scoreText: scoreText(centering.score),
    startingScore: 10,
    frontScore: centering.front.score,
    frontScoreText: scoreText(centering.front.score),
    backScore: centering.back.score,
    backScoreText: scoreText(centering.back.score),
    aggregatePenalty: centering.centeringDeduction,
    locationScores: [
      {
        side: "front",
        location: "printed_design",
        score: centering.front.score,
        scoreText: scoreText(centering.front.score),
        penalty: round(SCORE_MAXIMUM - centering.front.score),
        findingIds: [],
      },
      {
        side: "back",
        location: "printed_design",
        score: centering.back.score,
        scoreText: scoreText(centering.back.score),
        penalty: round(SCORE_MAXIMUM - centering.back.score),
        findingIds: [],
      },
    ],
    findingIds: [],
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula,
    explanation:
      `Front ${scoreText(centering.front.score)} and back ${scoreText(centering.back.score)} are fused by the manifest's conservative worst-plus-average policy; ` +
      `the exact centering deduction is ${centering.centeringDeduction.toFixed(2)}. Evidence: ${evidenceIds.join(", ")}.`,
  };
}

function surfaceElementScore(
  retained: readonly CandidateFindingV1[],
): FixedRigGradeElementScoreV1 {
  const findings = retained.filter((finding) => finding.element === "surface");
  const sideScore = (side: "front" | "back") => {
    const sideFindings = findings.filter((finding) => finding.side === side);
    const deduction = sideFindings.reduce((sum, finding) => sum + finding.deduction, 0);
    return {
      score: roundMathematicalScoreV1(SCORE_MAXIMUM - deduction),
      deduction: round(Math.min(SCORE_MAXIMUM - SCORE_MINIMUM, deduction)),
      findingIds: sideFindings.map((finding) => finding.findingId),
    };
  };
  const front = sideScore("front");
  const back = sideScore("back");
  const totalDeduction = findings.reduce((sum, finding) => sum + finding.deduction, 0);
  const aggregatePenalty = round(Math.min(SCORE_MAXIMUM - SCORE_MINIMUM, totalDeduction));
  const score = roundMathematicalScoreV1(SCORE_MAXIMUM - totalDeduction);
  return {
    score,
    scoreText: scoreText(score),
    startingScore: 10,
    frontScore: front.score,
    frontScoreText: scoreText(front.score),
    backScore: back.score,
    backScoreText: scoreText(back.score),
    aggregatePenalty,
    locationScores: [
      {
        side: "front",
        location: "full_surface",
        score: front.score,
        scoreText: scoreText(front.score),
        penalty: front.deduction,
        findingIds: front.findingIds,
      },
      {
        side: "back",
        location: "full_surface",
        score: back.score,
        scoreText: scoreText(back.score),
        penalty: back.deduction,
        findingIds: back.findingIds,
      },
    ],
    findingIds: findings.map((finding) => finding.findingId),
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surface.formula,
    explanation:
      `Surface starts at 10.00 and subtracts ${findings.length} unique measurement-derived physical finding(s), totaling ${aggregatePenalty.toFixed(2)}.`,
  };
}

function toComposedFinding(
  candidate: CandidateFindingV1,
  canonicalByFindingId: ReadonlyMap<string, string>,
): FixedRigComposedPhysicalFindingV1 {
  const basis = basisMeasurement(candidate);
  if (!basis) throw new Error(`Missing basis measurement for ${candidate.findingId}.`);
  return {
    source: candidate.source,
    findingId: candidate.findingId,
    physicalDefectId:
      canonicalByFindingId.get(candidate.findingId.toLowerCase()) ?? candidate.physicalDefectId,
    originalPhysicalDefectId: candidate.physicalDefectId,
    element: candidate.element,
    category: candidate.category,
    side: candidate.side,
    location: candidate.location,
    regionId: candidate.regionId,
    algorithmVersion: candidate.algorithmVersion,
    calibrationProfileId: candidate.calibrationProfileId,
    calibrationVersion: candidate.calibrationVersion,
    measurements: candidate.measurements,
    deductionBasisMeasurementId: candidate.deductionBasisMeasurementId,
    normalizedSeverity: candidate.normalizedSeverity,
    deduction: candidate.deduction,
    ...(candidate.severeDefectCap === undefined
      ? {}
      : { severeDefectCap: candidate.severeDefectCap }),
    evidenceAssetIds: uniqueCaseInsensitive(basis.evidence.map((entry) => entry.assetId)),
    explanation: candidate.explanation,
  };
}

function buildLedger(
  findings: readonly FixedRigComposedPhysicalFindingV1[],
): MathematicalDeductionLedgerV1 {
  return mathematicalDeductionLedgerV1Schema.parse({
    schemaVersion: MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    startingScores: {
      centering: 10,
      corners: 10,
      edges: 10,
      surface: 10,
    },
    entries: findings.map((finding) => {
      const basis = finding.measurements.find(
        (measurement) =>
          measurement.measurementId.toLowerCase() ===
            finding.deductionBasisMeasurementId.toLowerCase(),
      );
      if (!basis) throw new Error(`Missing basis measurement for ${finding.findingId}.`);
      const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[finding.category];
      const calculation = calculateFindingDeductionV1({
        category: finding.category,
        measuredMeasurement: basis.measuredMeasurement,
        u95: basis.u95,
      });
      return {
        findingId: finding.findingId,
        physicalDefectId: finding.physicalDefectId,
        element: finding.element,
        category: finding.category,
        measurementId: basis.measurementId,
        measuredMeasurement: basis.measuredMeasurement,
        unit: basis.unit,
        u95: basis.u95,
        grade10Tolerance: policy.grade10Tolerance,
        effectiveMeasurement: basis.effectiveMeasurement,
        referenceMeasurement: policy.referenceMeasurement,
        maximumDeduction: policy.maximumDeduction,
        curve: calculation.curve,
        formula: calculation.formula,
        normalizedSeverity: finding.normalizedSeverity,
        deduction: finding.deduction,
        evidenceAssetIds: finding.evidenceAssetIds,
        thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
        thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
        algorithmVersion: finding.algorithmVersion,
        calibrationProfileId: finding.calibrationProfileId,
        calibrationVersion: finding.calibrationVersion,
      };
    }),
  });
}

function centeringWhyNot10(
  centering: ComputedCentering,
): FixedRigWhyNot10V1 | undefined {
  if (centering.centeringDeduction <= 0) return undefined;
  const sides = [centering.front, centering.back];
  const worst = [...sides].sort((left, right) => left.score - right.score)[0]!;
  const axes = [
    { name: "horizontal", value: worst.horizontal },
    { name: "vertical", value: worst.vertical },
  ] as const;
  const worstAxis = [...axes].sort((left, right) => left.value.score - right.value.score)[0]!;
  return {
    id: "why-not-10-centering",
    element: "centering",
    findingIds: [],
    evidenceAssetIds: uniqueCaseInsensitive(
      sides.flatMap((side) => side.evidence.map((entry) => entry.assetId)),
    ),
    deduction: centering.centeringDeduction,
    explanation:
      `Centering deducted ${centering.centeringDeduction.toFixed(2)}. The limiting ${worst.side} ${worstAxis.name} axis measured margins ` +
      `${worstAxis.value.marginA} mm and ${worstAxis.value.marginB} mm, balance ${worstAxis.value.balanceRatio.toFixed(2)}%, ` +
      `with U95 ${worstAxis.value.differenceU95} mm and Grade-10 tolerance ${worst.grade10ToleranceMm} mm.`,
  };
}

function findingWhyNot10(
  finding: FixedRigComposedPhysicalFindingV1,
): FixedRigWhyNot10V1 | undefined {
  if (finding.deduction <= 0) return undefined;
  const basis = finding.measurements.find(
    (measurement) =>
      measurement.measurementId.toLowerCase() ===
        finding.deductionBasisMeasurementId.toLowerCase(),
  );
  if (!basis) return undefined;
  return {
    id: `why-not-10-${finding.findingId}`,
    element: finding.element,
    findingIds: [finding.findingId],
    evidenceAssetIds: finding.evidenceAssetIds,
    deduction: finding.deduction,
    explanation:
      `${finding.side} ${finding.location} ${finding.category} measured ${basis.measuredMeasurement} ${basis.unit}; ` +
      `U95 ${basis.u95}, Grade-10 tolerance ${basis.explicitGrade10Tolerance}, effective measurement ${basis.effectiveMeasurement}, ` +
      `normalized severity ${finding.normalizedSeverity}, exact deduction ${finding.deduction.toFixed(2)}.`,
  };
}

function validateConditionFormula(
  result: ComputedCondition,
  element: "corners" | "edges",
  issues: FixedRigGradeIssueV1[],
): void {
  const formula = element === "corners"
    ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.formula
    : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.formula;
  if (
    result.aggregation.formula !== formula ||
    result.score !== result.aggregation.score ||
    result.aggregatePenalty !== result.aggregation.aggregatePenalty ||
    result.locationSubscores.length !==
      (element === "corners"
        ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.requiredObservationCount
        : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.requiredObservationCount) ||
    !result.noDoubleDeduction
  ) {
    issues.push({
      code: "formula_mismatch",
      element,
      message: `${element} does not reproduce its manifest-owned worst-plus-average aggregation.`,
    });
  }
}

function validateCandidateCalibration(
  candidates: readonly CandidateFindingV1[],
  calibration: MathematicalCalibrationProfileV1,
  issues: FixedRigGradeIssueV1[],
): void {
  for (const candidate of candidates) {
    const basis = basisMeasurement(candidate);
    const calculation = basis
      ? calculateFindingDeductionV1({
          category: candidate.category,
          measuredMeasurement: basis.measuredMeasurement,
          u95: basis.u95,
        })
      : undefined;
    const measurementMismatch = candidate.measurements.some((measurement) =>
      measurement.calibrationProfileId !== calibration.profileId ||
      measurement.calibrationVersion !== calibration.calibrationVersion ||
      !thresholdMatches(measurement)
    );
    if (
      !basis ||
      candidate.calibrationProfileId !== calibration.profileId ||
      candidate.calibrationVersion !== calibration.calibrationVersion ||
      measurementMismatch
    ) {
      issues.push({
        code: "calibration_identity_mismatch",
        element: candidate.element,
        message: `Finding ${candidate.findingId} does not use the finalized calibration profile/version on every measurement.`,
      });
    } else if (
      candidate.normalizedSeverity !== calculation!.normalizedSeverity ||
      candidate.deduction !== calculation!.deduction ||
      candidate.severeDefectCap !==
        calculateApplicableSevereDefectCapV1(candidate.category, candidate.measurements)
    ) {
      issues.push({
        code: "invalid_finding",
        element: candidate.element,
        message: `Finding ${candidate.findingId} does not reproduce its manifest measurement deduction or severe cap.`,
      });
    }
  }
}

/**
 * Produces a calibrated V1 grade only when every physical element and every
 * calibration binding is exact. No partial score or historical fallback is
 * emitted when evidence is insufficient.
 */
export function buildFixedRigMathematicalGradeV1(
  input: BuildFixedRigMathematicalGradeV1Input,
): FixedRigMathematicalGradeV1Result {
  const calibrationValidation = validateMathematicalCalibrationForOperationalUseV1(input.calibration);
  if (!calibrationValidation.valid || !calibrationValidation.profile) {
    return insufficient([{
      code: "invalid_calibration",
      message:
        "A finalized Mathematical Calibration V1 profile satisfying every physical acceptance gate is mandatory. " +
        calibrationValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" "),
    }]);
  }
  const calibration = calibrationValidation.profile;
  const availabilityIssues = collectAvailabilityIssues(input);
  if (availabilityIssues.length) return insufficient(availabilityIssues);

  const centering = input.centering as ComputedCentering;
  const corners = input.corners as ComputedCondition;
  const edges = input.edges as ComputedCondition;
  const issues: FixedRigGradeIssueV1[] = [];
  if (centering.front.side !== "front" || centering.back.side !== "back") {
    issues.push({
      code: "missing_element_evidence",
      element: "centering",
      message: "Centering evidence must bind the front result to front and the back result to back.",
    });
  }
  if (input.surface.front.side !== "front" || input.surface.back.side !== "back") {
    issues.push({
      code: "recapture_required",
      element: "surface",
      message: "Surface evidence must bind the front result to front and the back result to back.",
    });
  }
  validateCentering(centering, calibration, issues);
  validateConditionFormula(corners, "corners", issues);
  validateConditionFormula(edges, "edges", issues);
  const candidates = [
    ...conditionCandidates(corners, "corners", calibration, issues),
    ...conditionCandidates(edges, "edges", calibration, issues),
    ...surfaceCandidates([input.surface.front, input.surface.back], calibration, issues),
  ];
  validateCandidateCalibration(candidates, calibration, issues);
  if (issues.length) return insufficient(issues);

  // Retained only as an inert compatibility assertion. A caller-supplied ID
  // or link can never suppress a Mathematical Calibration V1 deduction.
  void input.physicalDefectDeduplication;
  const deduplicated = resolveDeduplication(candidates, issues);
  if (issues.length) return insufficient(issues);

  const elements = {
    centering: centeringElementScore(centering),
    corners: conditionElementScore("corners", corners, deduplicated.retained),
    edges: conditionElementScore("edges", edges, deduplicated.retained),
    surface: surfaceElementScore(deduplicated.retained),
  };
  const findings = deduplicated.retained.map((candidate) =>
    toComposedFinding(candidate, deduplicated.canonicalByFindingId),
  );
  let deductionLedger: MathematicalDeductionLedgerV1;
  try {
    deductionLedger = buildLedger(findings);
  } catch (error) {
    return insufficient([{
      code: "invalid_deduction_ledger",
      message: `The retained finding ledger failed its exact no-double-deduction contract: ${error instanceof Error ? error.message : String(error)}`,
    }]);
  }
  const severeCaps = findings.flatMap((finding) =>
    finding.severeDefectCap === undefined ? [] : [finding.severeDefectCap],
  );
  const overall = calculateOverallGradeV1({
    centering: elements.centering.score,
    corners: elements.corners.score,
    edges: elements.edges.score,
    surface: elements.surface.score,
  }, severeCaps);
  const whyNot10 = [
    centeringWhyNot10(centering),
    ...findings.map(findingWhyNot10),
  ].filter((entry): entry is FixedRigWhyNot10V1 => entry !== undefined);
  const whyNot10Summary = whyNot10.length
    ? `The grade is below 10.00 because ${whyNot10.length} exact measured deduction explanation(s) are listed; the overall is the minimum of weighted grade ${scoreText(overall.weightedGrade)}, weakest-element cap ${scoreText(overall.weakestElementCap)}${overall.applicableSevereDefectCap === undefined
        ? ""
        : `, and severe-defect cap ${scoreText(overall.applicableSevereDefectCap)}`}.`
    : "No card-condition defect was measured beyond its certified U95/Grade-10 buffer; every required region retained sufficient calibrated evidence.";

  return {
    version: FIXED_RIG_MATHEMATICAL_GRADE_V1_VERSION,
    status: "final_mathematical_grade_v1",
    scoringContract: "mathematical_calibration_v1",
    v0FallbackUsed: false,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibration: {
      profileId: calibration.profileId,
      version: calibration.calibrationVersion,
      artifactSha256: calibration.artifactSha256,
      status: "finalized",
      isCalibrated: true,
    },
    overall: overall.overall,
    overallText: scoreText(overall.overall),
    labelGrade: overall.labelGrade,
    labelGradeText: overall.labelGrade.toFixed(1),
    weightedGrade: overall.weightedGrade,
    weightedGradeText: scoreText(overall.weightedGrade),
    weakestElement: overall.weakestElement,
    weakestScore: overall.weakestScore,
    weakestScoreText: scoreText(overall.weakestScore),
    weakestElementCap: overall.weakestElementCap,
    weakestElementCapText: scoreText(overall.weakestElementCap),
    ...(overall.applicableSevereDefectCap === undefined
      ? {}
      : {
          applicableSevereDefectCap: overall.applicableSevereDefectCap,
          applicableSevereDefectCapText: scoreText(overall.applicableSevereDefectCap),
        }),
    elements,
    weightedFormula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weightedFormula,
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.finalFormula,
    deductionLedger,
    findings,
    surfaceSourceEvidence: {
      front: input.surface.front.sourceEvidence.map((entry) => ({ ...entry })),
      back: input.surface.back.sourceEvidence.map((entry) => ({ ...entry })),
    },
    deduplication: deduplicated.links,
    whyNot10,
    whyNot10Summary,
    noDoubleDeduction: true,
  };
}
