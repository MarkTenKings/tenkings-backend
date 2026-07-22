import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  calculateCenteringAxisV1,
  calculateRegisteredDesignTemplateAxisV1,
  fuseCenteringFrontBackV1,
  fuseCenteringSideAxesV1,
  mathematicalCenteringRegistrationV1Schema,
  validateMathematicalDesignReferenceV1,
  type CenteringAxisCalculationV1,
  type OperationallyUsableMathematicalCalibrationProfileV1 as MathematicalCalibrationProfileV1,
  type MathematicalDesignReferenceV1,
  type MathematicalMeasurementUncertaintyComponentsV1,
  type MathematicalMeasurementV1,
  type RegisteredDesignTemplateAxisCalculationV1,
} from "@tenkings/shared";
import {
  verifyFixedRigDesignReferenceRegistrationBindingV1,
  type FixedRigDesignReferenceRegistrationBindingV1,
} from "./fixedRigDesignReferenceV1";
import { deriveFixedRigMeasurementUncertaintyV1 } from "./fixedRigMeasurementUncertaintyV1";
import { validateMathematicalCalibrationForOperationalUseV1 } from "./productOwnerOperationalAcceptanceV1";

export const FIXED_RIG_CENTERING_V1_VERSION = "fixed_rig_centering_v1" as const;

export interface FixedRigPointV1 {
  x: number;
  y: number;
}

export type FixedRigCenteringEvidenceReferenceV1 = MathematicalMeasurementV1["evidence"][number];
export type FixedRigCenteringRegistrationV1 = ReturnType<
  typeof mathematicalCenteringRegistrationV1Schema.parse
>;

export interface FixedRigPrintedBorderSamplesV1 {
  left: FixedRigPointV1[];
  right: FixedRigPointV1[];
  top: FixedRigPointV1[];
  bottom: FixedRigPointV1[];
}

export interface FixedRigExactCardIdentityV1 {
  tenantId: string;
  setId: string;
  programId: string;
  cardNumber: string;
  variantId: string | null;
  parallelId: string | null;
}

export type FixedRigCenteringProfileInputV1 =
  | {
      profile: "printed_border_v1";
      printBoundarySamples: FixedRigPrintedBorderSamplesV1;
    }
  | {
      profile: "registered_design_template_v1";
      exactIdentity: FixedRigExactCardIdentityV1;
      designReference: MathematicalDesignReferenceV1;
      registration: FixedRigCenteringRegistrationV1;
      registrationBinding: FixedRigDesignReferenceRegistrationBindingV1;
    };

export interface FixedRigCenteringSideInputV1 {
  side: "front" | "back";
  calibration: MathematicalCalibrationProfileV1;
  outerCutContour: FixedRigPointV1[];
  profileInput: FixedRigCenteringProfileInputV1;
  evidence: FixedRigCenteringEvidenceReferenceV1[];
}

type FixedRigResolvedCenteringSideInputV1 = FixedRigCenteringSideInputV1 & {
  marginDifferenceU95Mm: { horizontal: number; vertical: number };
  marginDifferenceUncertaintyComponentsU95: {
    horizontal: MathematicalMeasurementUncertaintyComponentsV1;
    vertical: MathematicalMeasurementUncertaintyComponentsV1;
  };
};

interface FixedRigBoundaryMarginsV1 {
  left: { px: number; mm: number };
  right: { px: number; mm: number };
  top: { px: number; mm: number };
  bottom: { px: number; mm: number };
}

export interface FixedRigRobustLineFitV1 {
  side: "left" | "right" | "top" | "bottom";
  axis: "x" | "y";
  independentAxis: "x" | "y";
  slope: number;
  interceptPx: number;
  lineEquation: { a: number; b: number; c: number };
  referenceCoordinatePx: number;
  coordinatePx: number;
  sampleCount: number;
  inlierCount: number;
  inlierFraction: number;
  residualPx: number;
  dependentResidualPx: number;
  positionU95Px: number;
  confidence: number;
}

export interface FixedRigCenteringSideComputedV1 {
  version: typeof FIXED_RIG_CENTERING_V1_VERSION;
  status: "computed";
  side: "front" | "back";
  profile: "printed_border_v1" | "registered_design_template_v1";
  score: number;
  startingScore: 10;
  centeringDeduction: number;
  thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
  thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationArtifactSha256: string;
  outerCutContour: FixedRigPointV1[];
  printedDesignContour: FixedRigPointV1[];
  observedMargins: FixedRigBoundaryMarginsV1;
  expectedMargins?: FixedRigBoundaryMarginsV1;
  horizontal: CenteringAxisCalculationV1 | RegisteredDesignTemplateAxisCalculationV1;
  vertical: CenteringAxisCalculationV1 | RegisteredDesignTemplateAxisCalculationV1;
  u95Mm: { horizontal: number; vertical: number };
  u95ComponentsMm: {
    calibratedMarginDifference: { horizontal: number; vertical: number };
    calibratedMarginDifferenceComponents: {
      horizontal: MathematicalMeasurementUncertaintyComponentsV1;
      vertical: MathematicalMeasurementUncertaintyComponentsV1;
    };
    printedBoundaryFit?: { horizontal: number; vertical: number };
  };
  grade10ToleranceMm: number;
  registration: FixedRigCenteringRegistrationV1;
  registrationBinding?: FixedRigDesignReferenceRegistrationBindingV1;
  robustLineFits?: Record<"left" | "right" | "top" | "bottom", FixedRigRobustLineFitV1>;
  measurementLines: Array<{
    id: string;
    side: "left" | "right" | "top" | "bottom";
    start: FixedRigPointV1;
    end: FixedRigPointV1;
    pixels: number;
    millimeters: number;
  }>;
  evidence: FixedRigCenteringEvidenceReferenceV1[];
  formula: "sideScore = min(horizontalAxisScore, verticalAxisScore)";
}

export interface FixedRigCenteringSideInsufficientV1 {
  version: typeof FIXED_RIG_CENTERING_V1_VERSION;
  status: "insufficient_evidence";
  side: "front" | "back";
  profile: "printed_border_v1" | "registered_design_template_v1";
  score: null;
  requiresRecaptureOrApprovedReference: true;
  reasons: string[];
  cardDefectDeduction: 0;
}

export type FixedRigCenteringSideResultV1 =
  | FixedRigCenteringSideComputedV1
  | FixedRigCenteringSideInsufficientV1;

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function median(values: readonly number[]): number {
  if (!values.length) throw new RangeError("Cannot calculate a median without samples.");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function finitePoint(point: FixedRigPointV1): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function leastSquaresLine(
  samples: readonly FixedRigPointV1[],
  dependentAxis: "x" | "y",
): { slope: number; intercept: number } | null {
  const independentAxis = dependentAxis === "x" ? "y" : "x";
  const independentMean = samples.reduce((sum, point) => sum + point[independentAxis], 0) / samples.length;
  const dependentMean = samples.reduce((sum, point) => sum + point[dependentAxis], 0) / samples.length;
  const sumSquares = samples.reduce(
    (sum, point) => sum + (point[independentAxis] - independentMean) ** 2,
    0,
  );
  if (!Number.isFinite(sumSquares) || sumSquares <= Number.EPSILON) return null;
  const covariance = samples.reduce(
    (sum, point) => sum +
      (point[independentAxis] - independentMean) * (point[dependentAxis] - dependentMean),
    0,
  );
  const slope = covariance / sumSquares;
  const intercept = dependentMean - slope * independentMean;
  return Number.isFinite(slope) && Number.isFinite(intercept) ? { slope, intercept } : null;
}

function lineResidualPx(
  point: FixedRigPointV1,
  dependentAxis: "x" | "y",
  slope: number,
  intercept: number,
): number {
  const independentAxis = dependentAxis === "x" ? "y" : "x";
  return Math.abs(point[dependentAxis] - (slope * point[independentAxis] + intercept)) /
    Math.hypot(1, slope);
}

export function fitFixedRigPrintedBorderLineV1(
  samples: readonly FixedRigPointV1[],
  side: "left" | "right" | "top" | "bottom",
  referenceCoordinatePx: number,
): FixedRigRobustLineFitV1 | null {
  const dependentAxis = side === "left" || side === "right" ? "x" : "y";
  const independentAxis = dependentAxis === "x" ? "y" : "x";
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.printedBorder;
  if (samples.length < policy.minimumLineSamplesPerSide || samples.some((point) => !finitePoint(point))) return null;
  const pairwiseSlopes: number[] = [];
  for (let first = 0; first < samples.length; first += 1) {
    for (let second = first + 1; second < samples.length; second += 1) {
      const independentDelta = samples[second]![independentAxis] - samples[first]![independentAxis];
      if (Math.abs(independentDelta) <= Number.EPSILON) continue;
      pairwiseSlopes.push(
        (samples[second]![dependentAxis] - samples[first]![dependentAxis]) / independentDelta,
      );
    }
  }
  if (!pairwiseSlopes.length) return null;
  let slope = median(pairwiseSlopes);
  let intercept = median(samples.map((point) => point[dependentAxis] - slope * point[independentAxis]));
  let inliers = samples.filter(
    (point) => lineResidualPx(point, dependentAxis, slope, intercept) <= policy.maximumFitResidualPx,
  );
  if (!inliers.length) return null;
  const seenInlierSets = new Set<string>();
  for (let iteration = 0; iteration < samples.length; iteration += 1) {
    const signature = inliers.map((point) => samples.indexOf(point)).join(",");
    if (seenInlierSets.has(signature)) break;
    seenInlierSets.add(signature);
    const refined = leastSquaresLine(inliers, dependentAxis);
    if (!refined) return null;
    slope = refined.slope;
    intercept = refined.intercept;
    const nextInliers = samples.filter(
      (point) => lineResidualPx(point, dependentAxis, slope, intercept) <= policy.maximumFitResidualPx,
    );
    if (nextInliers.length === inliers.length && nextInliers.every((point, index) => point === inliers[index])) {
      inliers = nextInliers;
      break;
    }
    inliers = nextInliers;
    if (!inliers.length) return null;
  }
  const finalFit = leastSquaresLine(inliers, dependentAxis);
  if (!finalFit) return null;
  slope = finalFit.slope;
  intercept = finalFit.intercept;
  const residualPx = Math.sqrt(inliers.reduce(
    (sum, point) => sum + lineResidualPx(point, dependentAxis, slope, intercept) ** 2,
    0,
  ) / inliers.length);
  const dependentResidualPx = Math.sqrt(inliers.reduce(
    (sum, point) => sum +
      (point[dependentAxis] - (slope * point[independentAxis] + intercept)) ** 2,
    0,
  ) / inliers.length);
  const inlierFraction = inliers.length / samples.length;
  // Residual has its own hard manifest gate. Confidence represents the
  // independently supported sample fraction so pixel-grid quantization on a
  // valid tilted line is not counted twice.
  const confidence = inlierFraction;
  const independentMean = inliers.reduce((sum, point) => sum + point[independentAxis], 0) / inliers.length;
  const independentSumSquares = inliers.reduce(
    (sum, point) => sum + (point[independentAxis] - independentMean) ** 2,
    0,
  );
  if (independentSumSquares <= Number.EPSILON) return null;
  const positionStandardErrorPx = dependentResidualPx * Math.sqrt(
    1 / inliers.length + (referenceCoordinatePx - independentMean) ** 2 / independentSumSquares,
  );
  const positionU95Px =
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.uncertainty.coverageFactor * positionStandardErrorPx;
  const normalizer = Math.hypot(1, slope);
  const lineEquation = dependentAxis === "x"
    ? { a: 1 / normalizer, b: -slope / normalizer, c: -intercept / normalizer }
    : { a: -slope / normalizer, b: 1 / normalizer, c: -intercept / normalizer };
  const result: FixedRigRobustLineFitV1 = {
    side,
    axis: dependentAxis,
    independentAxis,
    slope: round(slope, 12),
    interceptPx: round(intercept, 9),
    lineEquation: {
      a: round(lineEquation.a, 12),
      b: round(lineEquation.b, 12),
      c: round(lineEquation.c, 9),
    },
    referenceCoordinatePx: round(referenceCoordinatePx),
    coordinatePx: round(slope * referenceCoordinatePx + intercept),
    sampleCount: samples.length,
    inlierCount: inliers.length,
    inlierFraction: round(inlierFraction),
    residualPx: round(residualPx),
    dependentResidualPx: round(dependentResidualPx),
    positionU95Px: round(positionU95Px),
    confidence: round(confidence),
  };
  return result.inlierFraction >= policy.minimumInlierFraction &&
    result.residualPx <= policy.maximumFitResidualPx &&
    result.confidence >= policy.minimumBoundaryConfidence
    ? result
    : null;
}

export function intersectFixedRigPrintedBorderLinesV1(
  first: FixedRigRobustLineFitV1,
  second: FixedRigRobustLineFitV1,
): FixedRigPointV1 | null {
  const determinant = first.lineEquation.a * second.lineEquation.b -
    second.lineEquation.a * first.lineEquation.b;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON) return null;
  const x = (first.lineEquation.b * second.lineEquation.c -
    second.lineEquation.b * first.lineEquation.c) / determinant;
  const y = (first.lineEquation.c * second.lineEquation.a -
    second.lineEquation.c * first.lineEquation.a) / determinant;
  return Number.isFinite(x) && Number.isFinite(y) ? { x: round(x), y: round(y) } : null;
}

interface BoundsV1 {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function bounds(points: readonly FixedRigPointV1[]): BoundsV1 | null {
  if (points.length < 4 || points.some((point) => !finitePoint(point))) return null;
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  if (!(right > left && bottom > top)) return null;
  return { left: round(left), right: round(right), top: round(top), bottom: round(bottom) };
}

function calculateMargins(
  outer: BoundsV1,
  printed: BoundsV1,
  calibration: MathematicalCalibrationProfileV1,
): FixedRigBoundaryMarginsV1 | null {
  const px = {
    left: printed.left - outer.left,
    right: outer.right - printed.right,
    top: printed.top - outer.top,
    bottom: outer.bottom - printed.bottom,
  };
  if (Object.values(px).some((value) => !Number.isFinite(value) || value < 0)) return null;
  return {
    left: { px: round(px.left), mm: round(px.left * calibration.mmPerPixelX) },
    right: { px: round(px.right), mm: round(px.right * calibration.mmPerPixelX) },
    top: { px: round(px.top), mm: round(px.top * calibration.mmPerPixelY) },
    bottom: { px: round(px.bottom), mm: round(px.bottom * calibration.mmPerPixelY) },
  };
}

function measurementLines(
  outer: BoundsV1,
  printed: BoundsV1,
  margins: FixedRigBoundaryMarginsV1,
): FixedRigCenteringSideComputedV1["measurementLines"] {
  const middleX = (outer.left + outer.right) / 2;
  const middleY = (outer.top + outer.bottom) / 2;
  return [
    {
      id: "centering-margin-left",
      side: "left",
      start: { x: outer.left, y: middleY },
      end: { x: printed.left, y: middleY },
      pixels: margins.left.px,
      millimeters: margins.left.mm,
    },
    {
      id: "centering-margin-right",
      side: "right",
      start: { x: printed.right, y: middleY },
      end: { x: outer.right, y: middleY },
      pixels: margins.right.px,
      millimeters: margins.right.mm,
    },
    {
      id: "centering-margin-top",
      side: "top",
      start: { x: middleX, y: outer.top },
      end: { x: middleX, y: printed.top },
      pixels: margins.top.px,
      millimeters: margins.top.mm,
    },
    {
      id: "centering-margin-bottom",
      side: "bottom",
      start: { x: middleX, y: printed.bottom },
      end: { x: middleX, y: outer.bottom },
      pixels: margins.bottom.px,
      millimeters: margins.bottom.mm,
    },
  ];
}

function insufficient(
  input: FixedRigCenteringSideInputV1,
  reasons: string[],
): FixedRigCenteringSideInsufficientV1 {
  return {
    version: FIXED_RIG_CENTERING_V1_VERSION,
    status: "insufficient_evidence",
    side: input.side,
    profile: input.profileInput.profile,
    score: null,
    requiresRecaptureOrApprovedReference: true,
    reasons,
    cardDefectDeduction: 0,
  };
}

function applyTransform(
  point: FixedRigPointV1,
  transformType: "affine" | "homography",
  matrix: readonly number[],
): FixedRigPointV1 | null {
  if (transformType === "affine") {
    if (matrix.length !== 6) return null;
    return {
      x: matrix[0]! * point.x + matrix[1]! * point.y + matrix[2]!,
      y: matrix[3]! * point.x + matrix[4]! * point.y + matrix[5]!,
    };
  }
  if (matrix.length !== 9) return null;
  const denominator = matrix[6]! * point.x + matrix[7]! * point.y + matrix[8]!;
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  return {
    x: (matrix[0]! * point.x + matrix[1]! * point.y + matrix[2]!) / denominator,
    y: (matrix[3]! * point.x + matrix[4]! * point.y + matrix[5]!) / denominator,
  };
}

function computedResult(input: {
  source: FixedRigResolvedCenteringSideInputV1;
  outer: BoundsV1;
  printed: BoundsV1;
  printedContour: FixedRigPointV1[];
  observedMargins: FixedRigBoundaryMarginsV1;
  expectedMargins?: FixedRigBoundaryMarginsV1;
  horizontal: CenteringAxisCalculationV1 | RegisteredDesignTemplateAxisCalculationV1;
  vertical: CenteringAxisCalculationV1 | RegisteredDesignTemplateAxisCalculationV1;
  registration: FixedRigCenteringRegistrationV1;
  registrationBinding?: FixedRigDesignReferenceRegistrationBindingV1;
  effectiveU95Mm?: { horizontal: number; vertical: number };
  printedBoundaryFitU95Mm?: { horizontal: number; vertical: number };
  robustLineFits?: Record<"left" | "right" | "top" | "bottom", FixedRigRobustLineFitV1>;
}): FixedRigCenteringSideComputedV1 {
  const score = fuseCenteringSideAxesV1(input.horizontal.score, input.vertical.score);
  const effectiveU95Mm = input.effectiveU95Mm ?? input.source.marginDifferenceU95Mm;
  return {
    version: FIXED_RIG_CENTERING_V1_VERSION,
    status: "computed",
    side: input.source.side,
    profile: input.source.profileInput.profile,
    score,
    startingScore: 10,
    centeringDeduction: round(10 - score, 2),
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    calibrationProfileId: input.source.calibration.profileId,
    calibrationVersion: input.source.calibration.calibrationVersion,
    calibrationArtifactSha256: input.source.calibration.artifactSha256,
    outerCutContour: input.source.outerCutContour.map((point) => ({ ...point })),
    printedDesignContour: input.printedContour,
    observedMargins: input.observedMargins,
    ...(input.expectedMargins ? { expectedMargins: input.expectedMargins } : {}),
    horizontal: input.horizontal,
    vertical: input.vertical,
    u95Mm: { ...effectiveU95Mm },
    u95ComponentsMm: {
      calibratedMarginDifference: { ...input.source.marginDifferenceU95Mm },
      calibratedMarginDifferenceComponents: {
        horizontal: { ...input.source.marginDifferenceUncertaintyComponentsU95.horizontal },
        vertical: { ...input.source.marginDifferenceUncertaintyComponentsU95.vertical },
      },
      ...(input.printedBoundaryFitU95Mm
        ? { printedBoundaryFit: { ...input.printedBoundaryFitU95Mm } }
        : {}),
    },
    grade10ToleranceMm:
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.grade10Tolerance.marginDifferenceMm,
    registration: input.registration,
    ...(input.registrationBinding
      ? { registrationBinding: input.registrationBinding }
      : {}),
    ...(input.robustLineFits ? { robustLineFits: input.robustLineFits } : {}),
    measurementLines: measurementLines(input.outer, input.printed, input.observedMargins),
    evidence: input.source.evidence.map((entry) => ({ ...entry })),
    formula: "sideScore = min(horizontalAxisScore, verticalAxisScore)",
  };
}

function buildPrintedBorderResult(
  input: FixedRigCenteringSideInputV1 & {
    profileInput: Extract<FixedRigCenteringProfileInputV1, { profile: "printed_border_v1" }>;
  },
  outer: BoundsV1,
): FixedRigCenteringSideResultV1 {
  const samples = input.profileInput.printBoundarySamples;
  const middleX = (outer.left + outer.right) / 2;
  const middleY = (outer.top + outer.bottom) / 2;
  const fits = {
    left: fitFixedRigPrintedBorderLineV1(samples.left, "left", middleY),
    right: fitFixedRigPrintedBorderLineV1(samples.right, "right", middleY),
    top: fitFixedRigPrintedBorderLineV1(samples.top, "top", middleX),
    bottom: fitFixedRigPrintedBorderLineV1(samples.bottom, "bottom", middleX),
  };
  if (Object.values(fits).some((fit) => fit === null)) {
    return insufficient(input, [
      "The actual printed border could not satisfy the manifest-owned sample, inlier, residual, and confidence gates on all four sides.",
    ]);
  }
  const acceptedFits = fits as Record<"left" | "right" | "top" | "bottom", FixedRigRobustLineFitV1>;
  const printedContour = [
    intersectFixedRigPrintedBorderLinesV1(acceptedFits.left, acceptedFits.top),
    intersectFixedRigPrintedBorderLinesV1(acceptedFits.right, acceptedFits.top),
    intersectFixedRigPrintedBorderLinesV1(acceptedFits.right, acceptedFits.bottom),
    intersectFixedRigPrintedBorderLinesV1(acceptedFits.left, acceptedFits.bottom),
  ];
  if (printedContour.some((point) => point === null)) {
    return insufficient(input, [
      "The four robust printed-border lines do not form finite side-line intersections.",
    ]);
  }
  const acceptedPrintedContour = printedContour as FixedRigPointV1[];
  const printed = {
    left: acceptedFits.left.coordinatePx,
    right: acceptedFits.right.coordinatePx,
    top: acceptedFits.top.coordinatePx,
    bottom: acceptedFits.bottom.coordinatePx,
  };
  const margins = calculateMargins(outer, printed, input.calibration);
  if (!margins) {
    return insufficient(input, ["The fitted printed border lies outside the measured outer cut boundary."]);
  }
  if (acceptedPrintedContour.some((point) =>
    point.x < outer.left || point.x > outer.right || point.y < outer.top || point.y > outer.bottom)) {
    return insufficient(input, [
      "A robust printed-border side-line intersection lies outside the measured outer cut boundary.",
    ]);
  }
  const printedBoundaryFitU95Mm = {
    horizontal: round(Math.hypot(
      acceptedFits.left.positionU95Px * input.calibration.mmPerPixelX,
      acceptedFits.right.positionU95Px * input.calibration.mmPerPixelX,
    )),
    vertical: round(Math.hypot(
      acceptedFits.top.positionU95Px * input.calibration.mmPerPixelY,
      acceptedFits.bottom.positionU95Px * input.calibration.mmPerPixelY,
    )),
  };
  const horizontalCalibrationUncertainty = deriveFixedRigMeasurementUncertaintyV1({
    calibration: input.calibration,
    kind: "margin_difference_mm",
    measuredMeasurement: Math.abs(margins.left.mm - margins.right.mm),
    axis: "x",
  });
  const verticalCalibrationUncertainty = deriveFixedRigMeasurementUncertaintyV1({
    calibration: input.calibration,
    kind: "margin_difference_mm",
    measuredMeasurement: Math.abs(margins.top.mm - margins.bottom.mm),
    axis: "y",
  });
  const marginDifferenceU95Mm = {
    horizontal: horizontalCalibrationUncertainty.u95,
    vertical: verticalCalibrationUncertainty.u95,
  };
  const effectiveU95Mm = {
    horizontal: round(Math.hypot(
      marginDifferenceU95Mm.horizontal,
      printedBoundaryFitU95Mm.horizontal,
    )),
    vertical: round(Math.hypot(
      marginDifferenceU95Mm.vertical,
      printedBoundaryFitU95Mm.vertical,
    )),
  };
  const horizontal = calculateCenteringAxisV1(
    margins.left.mm,
    margins.right.mm,
    effectiveU95Mm.horizontal,
  );
  const vertical = calculateCenteringAxisV1(
    margins.top.mm,
    margins.bottom.mm,
    effectiveU95Mm.vertical,
  );
  const registration = mathematicalCenteringRegistrationV1Schema.parse({
    profile: "printed_border_v1",
    transformType: "robust_line_fit",
    transformMatrix: [
      acceptedFits.left.slope,
      acceptedFits.left.interceptPx,
      acceptedFits.right.slope,
      acceptedFits.right.interceptPx,
      acceptedFits.top.slope,
      acceptedFits.top.interceptPx,
      acceptedFits.bottom.slope,
      acceptedFits.bottom.interceptPx,
    ],
    registrationResidualPx: Math.max(...Object.values(acceptedFits).map((fit) => fit.residualPx)),
    inlierCount: Math.min(...Object.values(acceptedFits).map((fit) => fit.inlierCount)),
    inlierFraction: Math.min(...Object.values(acceptedFits).map((fit) => fit.inlierFraction)),
    confidence: Math.min(...Object.values(acceptedFits).map((fit) => fit.confidence)),
  });
  const resolvedInput: FixedRigResolvedCenteringSideInputV1 = {
    ...input,
    marginDifferenceU95Mm,
    marginDifferenceUncertaintyComponentsU95: {
      horizontal: horizontalCalibrationUncertainty.componentsU95,
      vertical: verticalCalibrationUncertainty.componentsU95,
    },
  };
  return computedResult({
    source: resolvedInput,
    outer,
    printed,
    printedContour: acceptedPrintedContour,
    observedMargins: margins,
    horizontal,
    vertical,
    registration,
    effectiveU95Mm,
    printedBoundaryFitU95Mm,
    robustLineFits: acceptedFits,
  });
}

function exactIdentityMatches(
  identity: FixedRigExactCardIdentityV1,
  reference: MathematicalDesignReferenceV1,
  side: "front" | "back",
): boolean {
  return identity.tenantId === reference.tenantId &&
    identity.setId === reference.setId &&
    identity.programId === reference.programId &&
    identity.cardNumber === reference.cardNumber &&
    identity.variantId === reference.variantId &&
    identity.parallelId === reference.parallelId &&
    side === reference.side;
}

function buildRegisteredTemplateResult(
  input: FixedRigCenteringSideInputV1 & {
    profileInput: Extract<FixedRigCenteringProfileInputV1, { profile: "registered_design_template_v1" }>;
  },
  outer: BoundsV1,
): FixedRigCenteringSideResultV1 {
  const referenceValidation = validateMathematicalDesignReferenceV1(input.profileInput.designReference);
  if (!referenceValidation.success) {
    return insufficient(input, ["The exact design-reference artifact failed the Mathematical Grading V1 schema."]);
  }
  const reference = referenceValidation.data;
  if (!exactIdentityMatches(input.profileInput.exactIdentity, reference, input.side)) {
    return insufficient(input, ["No approved design reference matches the exact tenant/set/program/card/variant/parallel identity and side."]);
  }
  const parsedRegistration = mathematicalCenteringRegistrationV1Schema.safeParse(input.profileInput.registration);
  if (!parsedRegistration.success) {
    return insufficient(input, ["The registered-design transform is malformed or incomplete."]);
  }
  const registration = parsedRegistration.data;
  const verifiedBinding = verifyFixedRigDesignReferenceRegistrationBindingV1({
    designReference: reference,
    registration,
    binding: input.profileInput.registrationBinding,
  });
  if (!verifiedBinding.valid) {
    return insufficient(input, [
      `The registered-design transform is not reproducible from its immutable correspondence ledger: ${verifiedBinding.reason}`,
    ]);
  }
  if (!input.evidence.some((entry) =>
    entry.side === input.side &&
    entry.assetId === input.profileInput.registrationBinding.normalizedSourceEvidenceId &&
    entry.sha256 === input.profileInput.registrationBinding.normalizedSourceEvidenceSha256)) {
    return insufficient(input, [
      "The registered-design correspondence ledger is not linked to the exact normalized source evidence used by this centering result.",
    ]);
  }
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate;
  if (registration.profile !== "registered_design_template_v1" ||
      registration.transformType === "robust_line_fit" ||
      registration.designReferenceId !== reference.designReferenceId ||
      registration.designReferenceSha256 !== reference.artifactSha256 ||
      registration.inlierCount < policy.minimumInlierCount ||
      registration.inlierFraction < policy.minimumInlierFraction ||
      registration.registrationResidualPx > policy.maximumRegistrationResidualPx ||
      registration.confidence < policy.minimumRegistrationConfidence) {
    return insufficient(input, [
      "The exact registered-design transform failed its reference hash, inlier, residual, or confidence gate.",
    ]);
  }
  const expectedContour = reference.intendedPrintBoundary.map((point) => ({
    x: point.x * input.calibration.normalizedWidthPx,
    y: point.y * input.calibration.normalizedHeightPx,
  }));
  const observedContour: FixedRigPointV1[] = [];
  for (const point of reference.intendedPrintBoundary) {
    const transformed = applyTransform(
      { x: point.x * reference.widthPx, y: point.y * reference.heightPx },
      registration.transformType,
      registration.transformMatrix,
    );
    if (!transformed || !finitePoint(transformed)) {
      return insufficient(input, ["The approved design contour could not be transformed into normalized card coordinates."]);
    }
    observedContour.push({ x: round(transformed.x), y: round(transformed.y) });
  }
  const expected = bounds(expectedContour);
  const observed = bounds(observedContour);
  if (!expected || !observed) {
    return insufficient(input, ["The intended or registered printed-design contour has no measurable physical extent."]);
  }
  const expectedMargins = calculateMargins(outer, expected, input.calibration);
  const observedMargins = calculateMargins(outer, observed, input.calibration);
  if (!expectedMargins || !observedMargins) {
    return insufficient(input, ["The approved or observed printed-design contour lies outside the outer cut boundary."]);
  }
  const horizontalCalibrationUncertainty = deriveFixedRigMeasurementUncertaintyV1({
    calibration: input.calibration,
    kind: "margin_difference_mm",
    measuredMeasurement: Math.abs(
      (observedMargins.left.mm - expectedMargins.left.mm) -
      (observedMargins.right.mm - expectedMargins.right.mm),
    ),
    axis: "x",
  });
  const verticalCalibrationUncertainty = deriveFixedRigMeasurementUncertaintyV1({
    calibration: input.calibration,
    kind: "margin_difference_mm",
    measuredMeasurement: Math.abs(
      (observedMargins.top.mm - expectedMargins.top.mm) -
      (observedMargins.bottom.mm - expectedMargins.bottom.mm),
    ),
    axis: "y",
  });
  const marginDifferenceU95Mm = {
    horizontal: horizontalCalibrationUncertainty.u95,
    vertical: verticalCalibrationUncertainty.u95,
  };
  const horizontal = calculateRegisteredDesignTemplateAxisV1({
    observedMarginA: observedMargins.left.mm,
    observedMarginB: observedMargins.right.mm,
    expectedMarginA: expectedMargins.left.mm,
    expectedMarginB: expectedMargins.right.mm,
    physicalAxisSpan: (outer.right - outer.left) * input.calibration.mmPerPixelX,
    differenceU95: marginDifferenceU95Mm.horizontal,
  });
  const vertical = calculateRegisteredDesignTemplateAxisV1({
    observedMarginA: observedMargins.top.mm,
    observedMarginB: observedMargins.bottom.mm,
    expectedMarginA: expectedMargins.top.mm,
    expectedMarginB: expectedMargins.bottom.mm,
    physicalAxisSpan: (outer.bottom - outer.top) * input.calibration.mmPerPixelY,
    differenceU95: marginDifferenceU95Mm.vertical,
  });
  const resolvedInput: FixedRigResolvedCenteringSideInputV1 = {
    ...input,
    marginDifferenceU95Mm,
    marginDifferenceUncertaintyComponentsU95: {
      horizontal: horizontalCalibrationUncertainty.componentsU95,
      vertical: verticalCalibrationUncertainty.componentsU95,
    },
  };
  return computedResult({
    source: resolvedInput,
    outer,
    printed: observed,
    printedContour: observedContour,
    observedMargins,
    expectedMargins,
    horizontal,
    vertical,
    registration,
    registrationBinding: input.profileInput.registrationBinding,
  });
}

export function buildFixedRigCenteringSideV1(
  input: FixedRigCenteringSideInputV1,
): FixedRigCenteringSideResultV1 {
  const calibration = validateMathematicalCalibrationForOperationalUseV1(input.calibration);
  if (!calibration.valid || (!calibration.isCalibrated && !calibration.isOperationallyAccepted)) {
    return insufficient(input, [
      ...calibration.issues.map((issue) => `Calibration ${issue.path}: ${issue.message}`),
      "A finalized calibration profile satisfying every manifest acceptance gate is mandatory.",
    ]);
  }
  if (!input.evidence.length) {
    return insufficient(input, ["Centering measurements have no immutable source-evidence binding."]);
  }
  const outer = bounds(input.outerCutContour);
  if (!outer || outer.left < 0 || outer.top < 0 ||
      outer.right > input.calibration.normalizedWidthPx ||
      outer.bottom > input.calibration.normalizedHeightPx) {
    return insufficient(input, ["The normalized outer physical cut contour is missing, invalid, or outside the calibrated coordinate frame."]);
  }
  if (input.profileInput.profile === "printed_border_v1") {
    return buildPrintedBorderResult(
      input as FixedRigCenteringSideInputV1 & {
        profileInput: Extract<FixedRigCenteringProfileInputV1, { profile: "printed_border_v1" }>;
      },
      outer,
    );
  }
  return buildRegisteredTemplateResult(
    input as FixedRigCenteringSideInputV1 & {
      profileInput: Extract<FixedRigCenteringProfileInputV1, { profile: "registered_design_template_v1" }>;
    },
    outer,
  );
}

export type FixedRigCenteringElementResultV1 =
  | {
      version: typeof FIXED_RIG_CENTERING_V1_VERSION;
      status: "computed";
      score: number;
      startingScore: 10;
      centeringDeduction: number;
      frontScore: number;
      backScore: number;
      front: FixedRigCenteringSideComputedV1;
      back: FixedRigCenteringSideComputedV1;
      thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
      thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
      formula: string;
    }
  | {
      version: typeof FIXED_RIG_CENTERING_V1_VERSION;
      status: "insufficient_evidence";
      score: null;
      front: FixedRigCenteringSideResultV1;
      back: FixedRigCenteringSideResultV1;
      reasons: string[];
      cardDefectDeduction: 0;
    };

export function fuseFixedRigCenteringFrontBackV1(
  front: FixedRigCenteringSideResultV1,
  back: FixedRigCenteringSideResultV1,
): FixedRigCenteringElementResultV1 {
  if (front.status !== "computed" || back.status !== "computed") {
    return {
      version: FIXED_RIG_CENTERING_V1_VERSION,
      status: "insufficient_evidence",
      score: null,
      front,
      back,
      reasons: [
        ...(front.status === "insufficient_evidence" ? front.reasons.map((reason) => `Front: ${reason}`) : []),
        ...(back.status === "insufficient_evidence" ? back.reasons.map((reason) => `Back: ${reason}`) : []),
      ],
      cardDefectDeduction: 0,
    };
  }
  const score = fuseCenteringFrontBackV1(front.score, back.score);
  return {
    version: FIXED_RIG_CENTERING_V1_VERSION,
    status: "computed",
    score,
    startingScore: 10,
    centeringDeduction: round(10 - score, 2),
    frontScore: front.score,
    backScore: back.score,
    front,
    back,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula,
  };
}
