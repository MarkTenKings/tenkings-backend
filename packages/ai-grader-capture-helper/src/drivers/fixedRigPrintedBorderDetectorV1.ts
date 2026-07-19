import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  mathematicalEvidenceReferenceV1Schema,
} from "@tenkings/shared";
import {
  FIXED_RIG_CENTERING_V1_VERSION,
  buildFixedRigCenteringSideV1,
  fitFixedRigPrintedBorderLineV1,
  intersectFixedRigPrintedBorderLinesV1,
  type FixedRigCenteringEvidenceReferenceV1,
  type FixedRigCenteringProfileInputV1,
  type FixedRigCenteringSideInputV1,
  type FixedRigCenteringSideResultV1,
  type FixedRigPointV1,
  type FixedRigPrintedBorderSamplesV1,
  type FixedRigRobustLineFitV1,
} from "./fixedRigCenteringV1";
import type { FixedRigScalarPlaneV1 } from "./fixedRigPhotometricEvidenceV1";

export const FIXED_RIG_PRINTED_BORDER_SOURCE_DETECTOR_V1_VERSION =
  "fixed_rig_printed_border_source_detector_v1" as const;

const PRINTED_BORDER_POLICY =
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.printedBorder;
const SOURCE_POLICY = PRINTED_BORDER_POLICY.sourceDetector;

export type FixedRigPrintedBorderSideV1 = "left" | "right" | "top" | "bottom";

export interface FixedRigPrintedBorderDetectorThresholdsV1 {
  sourcePlane: typeof SOURCE_POLICY.sourcePlane;
  gradientPolarity: typeof SOURCE_POLICY.gradientPolarity;
  insetSearchMinimumFractionOfAxis: number;
  insetSearchMaximumFractionOfAxis: number;
  gradientThresholdPolicy: typeof SOURCE_POLICY.gradientThresholdPolicy;
  minimumNormalizedGradient: number;
  gradientMadMultiplier: number;
  minimumCrossSectionsPerAxis: number;
  minimumCrossSectionSupportFraction: number;
  crossSectionPeakAggregation: typeof SOURCE_POLICY.crossSectionPeakAggregation;
  minimumLineSamplesPerSide: number;
  minimumInlierFraction: number;
  maximumFitResidualPx: number;
  minimumBoundaryConfidence: number;
}

export interface FixedRigPrintedBorderCrossSectionEvidenceV1 {
  crossSectionIndex: number;
  crossSectionCoordinatePx: number;
  point: FixedRigPointV1;
  insetFromOuterCutPx: number;
  absoluteNormalizedGradient: number;
  adaptiveGradientThreshold: number;
}

export interface FixedRigPrintedBorderBoundaryEvidenceV1 {
  side: FixedRigPrintedBorderSideV1;
  fittedAxis: "x" | "y";
  attemptedCrossSectionCount: number;
  thresholdQualifiedCrossSectionCount: number;
  supportedCrossSectionCount: number;
  supportFraction: number;
  fittedModel: "robust_2d_line";
  medianCoordinatePx: number | null;
  medianInsetFromOuterCutPx: number | null;
  fitResidualPx: number | null;
  lineSlope: number | null;
  lineInterceptPx: number | null;
  lineEquation: { a: number; b: number; c: number } | null;
  positionU95Px: number | null;
  medianPeakGradient: number | null;
  medianAdaptiveThreshold: number | null;
  confidence: number;
  viableClusterCount: number;
  viableClusterCoordinatesPx: number[];
  accepted: boolean;
  samples: FixedRigPrintedBorderCrossSectionEvidenceV1[];
}

export type FixedRigPrintedBorderDetectorReasonCodeV1 =
  | "invalid_source_plane"
  | "missing_all_on_evidence"
  | "invalid_outer_cut_contour"
  | "insufficient_cross_sections"
  | "no_threshold_qualified_gradient"
  | "insufficient_cross_section_support"
  | "unstable_boundary_fit"
  | "ambiguous_multiple_supported_boundaries"
  | "invalid_detected_boundary";

export interface FixedRigPrintedBorderDetectorReasonV1 {
  code: FixedRigPrintedBorderDetectorReasonCodeV1;
  side?: FixedRigPrintedBorderSideV1;
  message: string;
}

export interface DetectFixedRigPrintedBorderSourceV1Input {
  side: "front" | "back";
  flatFieldNormalizedAllOnLuminance: FixedRigScalarPlaneV1;
  outerCutContour: FixedRigPointV1[];
  evidence: FixedRigCenteringEvidenceReferenceV1[];
}

interface FixedRigPrintedBorderDetectorBaseV1 {
  version: typeof FIXED_RIG_PRINTED_BORDER_SOURCE_DETECTOR_V1_VERSION;
  side: "front" | "back";
  coordinateFrame: "normalized_card_portrait_pixels";
  sourcePlane: typeof SOURCE_POLICY.sourcePlane;
  width: number;
  height: number;
  thresholdSetId: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID;
  thresholdSetHash: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH;
  thresholds: FixedRigPrintedBorderDetectorThresholdsV1;
  outerCutContour: FixedRigPointV1[];
  boundaryEvidence: Partial<Record<FixedRigPrintedBorderSideV1, FixedRigPrintedBorderBoundaryEvidenceV1>>;
  evidence: FixedRigCenteringEvidenceReferenceV1[];
  conditionDeduction: 0;
}

export interface FixedRigPrintedBorderDetectorComputedV1
  extends FixedRigPrintedBorderDetectorBaseV1 {
  status: "computed";
  profileInput: Extract<FixedRigCenteringProfileInputV1, { profile: "printed_border_v1" }>;
  detectedPrintContour: FixedRigPointV1[];
  confidence: number;
  formula:
    "per-cross-section adaptive absolute-gradient threshold; inset-ordered candidate tracks; deterministic robust 2-D line fit; side-line intersections";
}

export interface FixedRigPrintedBorderDetectorInsufficientV1
  extends FixedRigPrintedBorderDetectorBaseV1 {
  status: "insufficient_evidence";
  profileInput: null;
  detectedPrintContour: [];
  confidence: number;
  reasons: FixedRigPrintedBorderDetectorReasonV1[];
  requiresRecaptureOrRegisteredDesignReference: true;
}

export type FixedRigPrintedBorderDetectorResultV1 =
  | FixedRigPrintedBorderDetectorComputedV1
  | FixedRigPrintedBorderDetectorInsufficientV1;

interface BoundsV1 {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface PeakCandidateV1 extends FixedRigPrintedBorderCrossSectionEvidenceV1 {
  coordinatePx: number;
}

interface CrossSectionScanV1 {
  index: number;
  coordinatePx: number;
  candidates: PeakCandidateV1[];
}

interface ClusterV1 {
  coordinatePx: number;
  residualPx: number;
  supportFraction: number;
  confidence: number;
  medianPeakGradient: number;
  medianAdaptiveThreshold: number;
  medianInsetFromOuterCutPx: number;
  samples: PeakCandidateV1[];
  lineFit: FixedRigRobustLineFitV1;
}

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function medianAbsoluteDeviation(values: readonly number[], center: number): number {
  return median(values.map((value) => Math.abs(value - center)));
}

function finitePoint(point: FixedRigPointV1): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function convexOuterEnvelope(
  points: readonly FixedRigPointV1[],
): FixedRigPointV1[] {
  const ordered = [...new Map(points.map((point) => [
    point.x + ":" + point.y,
    { x: point.x, y: point.y },
  ])).values()].sort((left, right) => left.x - right.x || left.y - right.y);
  if (ordered.length < 4) return [];
  const cross = (
    origin: FixedRigPointV1,
    first: FixedRigPointV1,
    second: FixedRigPointV1,
  ) => (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x);
  const half = (candidates: readonly FixedRigPointV1[]) => {
    const result: FixedRigPointV1[] = [];
    for (const point of candidates) {
      while (
        result.length >= 2 &&
        cross(result[result.length - 2]!, result[result.length - 1]!, point) <= 0
      ) result.pop();
      result.push(point);
    }
    result.pop();
    return result;
  };
  return [...half(ordered), ...half([...ordered].reverse())];
}

function thresholds(): FixedRigPrintedBorderDetectorThresholdsV1 {
  return {
    sourcePlane: SOURCE_POLICY.sourcePlane,
    gradientPolarity: SOURCE_POLICY.gradientPolarity,
    insetSearchMinimumFractionOfAxis: SOURCE_POLICY.insetSearchMinimumFractionOfAxis,
    insetSearchMaximumFractionOfAxis: SOURCE_POLICY.insetSearchMaximumFractionOfAxis,
    gradientThresholdPolicy: SOURCE_POLICY.gradientThresholdPolicy,
    minimumNormalizedGradient: SOURCE_POLICY.minimumNormalizedGradient,
    gradientMadMultiplier: SOURCE_POLICY.gradientMadMultiplier,
    minimumCrossSectionsPerAxis: SOURCE_POLICY.minimumCrossSectionsPerAxis,
    minimumCrossSectionSupportFraction: SOURCE_POLICY.minimumCrossSectionSupportFraction,
    crossSectionPeakAggregation: SOURCE_POLICY.crossSectionPeakAggregation,
    minimumLineSamplesPerSide: PRINTED_BORDER_POLICY.minimumLineSamplesPerSide,
    minimumInlierFraction: PRINTED_BORDER_POLICY.minimumInlierFraction,
    maximumFitResidualPx: PRINTED_BORDER_POLICY.maximumFitResidualPx,
    minimumBoundaryConfidence: PRINTED_BORDER_POLICY.minimumBoundaryConfidence,
  };
}

function normalizeOuterContour(
  contour: readonly FixedRigPointV1[],
  width: number,
  height: number,
): {
  contour: FixedRigPointV1[];
  scanContour: FixedRigPointV1[];
  bounds: BoundsV1;
} | null {
  const normalized = contour.map((point) => ({ x: point.x, y: point.y }));
  if (
    normalized.length > 1 &&
    normalized[0]!.x === normalized[normalized.length - 1]!.x &&
    normalized[0]!.y === normalized[normalized.length - 1]!.y
  ) normalized.pop();
  if (
    normalized.length < 4 ||
    normalized.some((point) =>
      !finitePoint(point) || point.x < 0 || point.x > width || point.y < 0 || point.y > height)
  ) return null;
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]!;
    const next = normalized[(index + 1) % normalized.length]!;
    if (current.x === next.x && current.y === next.y) return null;
  }
  let signedDoubleArea = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index]!;
    const next = normalized[(index + 1) % normalized.length]!;
    signedDoubleArea += current.x * next.y - next.x * current.y;
  }
  if (!Number.isFinite(signedDoubleArea) || signedDoubleArea === 0) return null;
  const scanContour = convexOuterEnvelope(normalized);
  if (scanContour.length < 4) return null;
  const bounds = {
    left: Math.min(...scanContour.map((point) => point.x)),
    right: Math.max(...scanContour.map((point) => point.x)),
    top: Math.min(...scanContour.map((point) => point.y)),
    bottom: Math.max(...scanContour.map((point) => point.y)),
  };
  if (!(bounds.right > bounds.left && bounds.bottom > bounds.top)) return null;
  return { contour: normalized, scanContour, bounds };
}

function lineIntersections(
  contour: readonly FixedRigPointV1[],
  coordinate: number,
  orientation: "horizontal" | "vertical",
): number[] {
  const intersections: number[] = [];
  for (let index = 0; index < contour.length; index += 1) {
    const start = contour[index]!;
    const end = contour[(index + 1) % contour.length]!;
    const startCross = orientation === "horizontal" ? start.y : start.x;
    const endCross = orientation === "horizontal" ? end.y : end.x;
    const crosses = (startCross <= coordinate && endCross > coordinate) ||
      (endCross <= coordinate && startCross > coordinate);
    if (!crosses) continue;
    const ratio = (coordinate - startCross) / (endCross - startCross);
    const intersection = orientation === "horizontal"
      ? start.x + ratio * (end.x - start.x)
      : start.y + ratio * (end.y - start.y);
    if (Number.isFinite(intersection)) intersections.push(intersection);
  }
  return intersections.sort((left, right) => left - right);
}

function adaptivePeaks(input: {
  values: Array<{ coordinatePx: number; gradient: number }>;
  side: FixedRigPrintedBorderSideV1;
  crossSectionIndex: number;
  crossSectionCoordinatePx: number;
  outerStartPx: number;
  outerEndPx: number;
}): PeakCandidateV1[] {
  if (!input.values.length) return [];
  const gradients = input.values.map((entry) => entry.gradient);
  const gradientMedian = median(gradients);
  const gradientMad = medianAbsoluteDeviation(gradients, gradientMedian);
  const threshold = Math.max(
    SOURCE_POLICY.minimumNormalizedGradient,
    gradientMedian + SOURCE_POLICY.gradientMadMultiplier * gradientMad,
  );
  return input.values.flatMap((entry, index) => {
    const previous = input.values[index - 1]?.gradient ?? Number.NEGATIVE_INFINITY;
    const next = input.values[index + 1]?.gradient ?? Number.NEGATIVE_INFINITY;
    const localMaximum = entry.gradient >= previous && entry.gradient >= next &&
      (entry.gradient > previous || entry.gradient > next);
    if (!localMaximum || entry.gradient < threshold) return [];
    const verticalSide = input.side === "left" || input.side === "right";
    const point = verticalSide
      ? { x: entry.coordinatePx, y: input.crossSectionCoordinatePx }
      : { x: input.crossSectionCoordinatePx, y: entry.coordinatePx };
    const insetFromOuterCutPx = input.side === "left" || input.side === "top"
      ? entry.coordinatePx - input.outerStartPx
      : input.outerEndPx - entry.coordinatePx;
    return [{
      crossSectionIndex: input.crossSectionIndex,
      crossSectionCoordinatePx: round(input.crossSectionCoordinatePx),
      coordinatePx: entry.coordinatePx,
      point: { x: round(point.x), y: round(point.y) },
      insetFromOuterCutPx: round(insetFromOuterCutPx),
      absoluteNormalizedGradient: round(entry.gradient),
      adaptiveGradientThreshold: round(threshold),
    }];
  });
}

function horizontalGradientValues(
  plane: FixedRigScalarPlaneV1,
  row: number,
  minimumCoordinatePx: number,
  maximumCoordinatePx: number,
): Array<{ coordinatePx: number; gradient: number }> {
  const values: Array<{ coordinatePx: number; gradient: number }> = [];
  for (let column = 0; column < plane.width - 1; column += 1) {
    const coordinatePx = column + 0.5;
    if (coordinatePx < minimumCoordinatePx || coordinatePx > maximumCoordinatePx) continue;
    const left = Number(plane.data[row * plane.width + column]);
    const right = Number(plane.data[row * plane.width + column + 1]);
    values.push({ coordinatePx, gradient: Math.abs(right - left) });
  }
  return values;
}

function verticalGradientValues(
  plane: FixedRigScalarPlaneV1,
  column: number,
  minimumCoordinatePx: number,
  maximumCoordinatePx: number,
): Array<{ coordinatePx: number; gradient: number }> {
  const values: Array<{ coordinatePx: number; gradient: number }> = [];
  for (let row = 0; row < plane.height - 1; row += 1) {
    const coordinatePx = row + 0.5;
    if (coordinatePx < minimumCoordinatePx || coordinatePx > maximumCoordinatePx) continue;
    const top = Number(plane.data[row * plane.width + column]);
    const bottom = Number(plane.data[(row + 1) * plane.width + column]);
    values.push({ coordinatePx, gradient: Math.abs(bottom - top) });
  }
  return values;
}

function scanVerticalBoundaries(
  plane: FixedRigScalarPlaneV1,
  contour: readonly FixedRigPointV1[],
): { left: CrossSectionScanV1[]; right: CrossSectionScanV1[]; ambiguousOuter: boolean } {
  const left: CrossSectionScanV1[] = [];
  const right: CrossSectionScanV1[] = [];
  let ambiguousOuter = false;
  for (let row = 0; row < plane.height; row += 1) {
    const crossSectionCoordinatePx = row + 0.5;
    const intersections = lineIntersections(contour, crossSectionCoordinatePx, "horizontal");
    if (!intersections.length) continue;
    if (intersections.length !== 2) {
      ambiguousOuter = true;
      continue;
    }
    const outerLeft = intersections[0]!;
    const outerRight = intersections[1]!;
    const span = outerRight - outerLeft;
    if (!(span > 0)) continue;
    const minimumInset = span * SOURCE_POLICY.insetSearchMinimumFractionOfAxis;
    const maximumInset = span * SOURCE_POLICY.insetSearchMaximumFractionOfAxis;
    const leftValues = horizontalGradientValues(
      plane, row, outerLeft + minimumInset, outerLeft + maximumInset,
    );
    const rightValues = horizontalGradientValues(
      plane, row, outerRight - maximumInset, outerRight - minimumInset,
    );
    if (leftValues.length) {
      left.push({
        index: row,
        coordinatePx: crossSectionCoordinatePx,
        candidates: adaptivePeaks({
          values: leftValues,
          side: "left",
          crossSectionIndex: row,
          crossSectionCoordinatePx,
          outerStartPx: outerLeft,
          outerEndPx: outerRight,
        }),
      });
    }
    if (rightValues.length) {
      right.push({
        index: row,
        coordinatePx: crossSectionCoordinatePx,
        candidates: adaptivePeaks({
          values: rightValues,
          side: "right",
          crossSectionIndex: row,
          crossSectionCoordinatePx,
          outerStartPx: outerLeft,
          outerEndPx: outerRight,
        }),
      });
    }
  }
  return { left, right, ambiguousOuter };
}

function scanHorizontalBoundaries(
  plane: FixedRigScalarPlaneV1,
  contour: readonly FixedRigPointV1[],
): { top: CrossSectionScanV1[]; bottom: CrossSectionScanV1[]; ambiguousOuter: boolean } {
  const top: CrossSectionScanV1[] = [];
  const bottom: CrossSectionScanV1[] = [];
  let ambiguousOuter = false;
  for (let column = 0; column < plane.width; column += 1) {
    const crossSectionCoordinatePx = column + 0.5;
    const intersections = lineIntersections(contour, crossSectionCoordinatePx, "vertical");
    if (!intersections.length) continue;
    if (intersections.length !== 2) {
      ambiguousOuter = true;
      continue;
    }
    const outerTop = intersections[0]!;
    const outerBottom = intersections[1]!;
    const span = outerBottom - outerTop;
    if (!(span > 0)) continue;
    const minimumInset = span * SOURCE_POLICY.insetSearchMinimumFractionOfAxis;
    const maximumInset = span * SOURCE_POLICY.insetSearchMaximumFractionOfAxis;
    const topValues = verticalGradientValues(
      plane, column, outerTop + minimumInset, outerTop + maximumInset,
    );
    const bottomValues = verticalGradientValues(
      plane, column, outerBottom - maximumInset, outerBottom - minimumInset,
    );
    if (topValues.length) {
      top.push({
        index: column,
        coordinatePx: crossSectionCoordinatePx,
        candidates: adaptivePeaks({
          values: topValues,
          side: "top",
          crossSectionIndex: column,
          crossSectionCoordinatePx,
          outerStartPx: outerTop,
          outerEndPx: outerBottom,
        }),
      });
    }
    if (bottomValues.length) {
      bottom.push({
        index: column,
        coordinatePx: crossSectionCoordinatePx,
        candidates: adaptivePeaks({
          values: bottomValues,
          side: "bottom",
          crossSectionIndex: column,
          crossSectionCoordinatePx,
          outerStartPx: outerTop,
          outerEndPx: outerBottom,
        }),
      });
    }
  }
  return { top, bottom, ambiguousOuter };
}

function clusters(
  scans: readonly CrossSectionScanV1[],
  side: FixedRigPrintedBorderSideV1,
): ClusterV1[] {
  const maximumTrackCount = scans.reduce(
    (maximum, scan) => Math.max(maximum, scan.candidates.length),
    0,
  );
  const referenceCoordinatePx = median(scans.map((scan) => scan.coordinatePx));
  const bySignature = new Map<string, ClusterV1>();
  for (let trackIndex = 0; trackIndex < maximumTrackCount; trackIndex += 1) {
    const track = scans.flatMap((scan) => {
      const ordered = [...scan.candidates].sort((left, right) =>
        left.insetFromOuterCutPx - right.insetFromOuterCutPx ||
        right.absoluteNormalizedGradient - left.absoluteNormalizedGradient ||
        left.coordinatePx - right.coordinatePx,
      );
      return ordered[trackIndex] ? [ordered[trackIndex]!] : [];
    });
    const lineFit = fitFixedRigPrintedBorderLineV1(
      track.map((sample) => sample.point),
      side,
      referenceCoordinatePx,
    );
    if (!lineFit) continue;
    const samples = track.filter((sample) =>
      Math.abs(
        lineFit.lineEquation.a * sample.point.x +
        lineFit.lineEquation.b * sample.point.y +
        lineFit.lineEquation.c,
      ) <= PRINTED_BORDER_POLICY.maximumFitResidualPx);
    if (!samples.length) continue;
    const supportFraction = samples.length / scans.length;
    const cluster: ClusterV1 = {
      coordinatePx: lineFit.coordinatePx,
      residualPx: lineFit.residualPx,
      supportFraction: round(supportFraction),
      confidence: round(Math.min(supportFraction, lineFit.confidence)),
      medianPeakGradient: round(median(samples.map((sample) => sample.absoluteNormalizedGradient))),
      medianAdaptiveThreshold: round(median(samples.map((sample) => sample.adaptiveGradientThreshold))),
      medianInsetFromOuterCutPx: round(median(samples.map((sample) => sample.insetFromOuterCutPx))),
      samples: [...samples].sort((left, right) => left.crossSectionIndex - right.crossSectionIndex),
      lineFit,
    };
    const signature = samples
      .map((sample) => String(sample.crossSectionIndex) + ":" + String(sample.coordinatePx))
      .join("|");
    if (!bySignature.has(signature)) bySignature.set(signature, cluster);
  }
  const ranked = [...bySignature.values()].sort((left, right) =>
    right.samples.length - left.samples.length ||
    right.medianPeakGradient - left.medianPeakGradient ||
    left.residualPx - right.residualPx ||
    left.coordinatePx - right.coordinatePx,
  );
  const distinct: ClusterV1[] = [];
  ranked.forEach((candidate) => {
    if (distinct.some((entry) =>
      Math.abs(entry.coordinatePx - candidate.coordinatePx) <= PRINTED_BORDER_POLICY.maximumFitResidualPx &&
      Math.abs(entry.lineFit.slope - candidate.lineFit.slope) *
        Math.max(1, referenceCoordinatePx) <= PRINTED_BORDER_POLICY.maximumFitResidualPx)) return;
    distinct.push(candidate);
  });
  return distinct;
}

function boundaryAnalysis(
  side: FixedRigPrintedBorderSideV1,
  scans: readonly CrossSectionScanV1[],
): { evidence: FixedRigPrintedBorderBoundaryEvidenceV1; samples: FixedRigPointV1[] | null; reason?: FixedRigPrintedBorderDetectorReasonV1 } {
  const thresholdQualifiedCrossSectionCount = scans.filter((scan) => scan.candidates.length).length;
  if (scans.length < SOURCE_POLICY.minimumCrossSectionsPerAxis) {
    return {
      evidence: emptyBoundaryEvidence(side, scans.length, thresholdQualifiedCrossSectionCount),
      samples: null,
      reason: {
        code: "insufficient_cross_sections",
        side,
        message: "The outer cut contour supplied fewer than the manifest minimum cross-sections for this boundary.",
      },
    };
  }
  if (!thresholdQualifiedCrossSectionCount) {
    return {
      evidence: emptyBoundaryEvidence(side, scans.length, 0),
      samples: null,
      reason: {
        code: "no_threshold_qualified_gradient",
        side,
        message: "No absolute luminance-gradient peak exceeded the manifest adaptive threshold.",
      },
    };
  }
  const allClusters = clusters(scans, side);
  const viable = allClusters.filter((cluster) =>
    cluster.samples.length >= PRINTED_BORDER_POLICY.minimumLineSamplesPerSide &&
    cluster.supportFraction >= SOURCE_POLICY.minimumCrossSectionSupportFraction &&
    cluster.supportFraction >= PRINTED_BORDER_POLICY.minimumInlierFraction &&
    cluster.residualPx <= PRINTED_BORDER_POLICY.maximumFitResidualPx &&
    cluster.confidence >= PRINTED_BORDER_POLICY.minimumBoundaryConfidence,
  );
  const best = viable[0] ?? allClusters[0] ?? null;
  const evidence = boundaryEvidence(side, scans.length, thresholdQualifiedCrossSectionCount, best, viable);
  if (viable.length > 1) {
    return {
      evidence,
      samples: null,
      reason: {
        code: "ambiguous_multiple_supported_boundaries",
        side,
        message: "Multiple distinct printed-boundary peaks independently satisfied every manifest support and fit gate.",
      },
    };
  }
  if (!viable.length) {
    const supportPass = Boolean(best) &&
      best!.samples.length >= PRINTED_BORDER_POLICY.minimumLineSamplesPerSide &&
      best!.supportFraction >= SOURCE_POLICY.minimumCrossSectionSupportFraction &&
      best!.supportFraction >= PRINTED_BORDER_POLICY.minimumInlierFraction;
    return {
      evidence,
      samples: null,
      reason: supportPass
        ? {
            code: "unstable_boundary_fit",
            side,
            message: "The best supported peak failed the manifest residual or boundary-confidence gate.",
          }
        : {
            code: "insufficient_cross_section_support",
            side,
            message: "No peak reached the manifest minimum cross-section support and line-sample gates.",
          },
    };
  }
  return {
    evidence,
    samples: viable[0]!.samples.map((sample) => ({ ...sample.point })),
  };
}

function emptyBoundaryEvidence(
  side: FixedRigPrintedBorderSideV1,
  attemptedCrossSectionCount: number,
  thresholdQualifiedCrossSectionCount: number,
): FixedRigPrintedBorderBoundaryEvidenceV1 {
  return {
    side,
    fittedAxis: side === "left" || side === "right" ? "x" : "y",
    attemptedCrossSectionCount,
    thresholdQualifiedCrossSectionCount,
    supportedCrossSectionCount: 0,
    supportFraction: 0,
    fittedModel: "robust_2d_line",
    medianCoordinatePx: null,
    medianInsetFromOuterCutPx: null,
    fitResidualPx: null,
    lineSlope: null,
    lineInterceptPx: null,
    lineEquation: null,
    positionU95Px: null,
    medianPeakGradient: null,
    medianAdaptiveThreshold: null,
    confidence: 0,
    viableClusterCount: 0,
    viableClusterCoordinatesPx: [],
    accepted: false,
    samples: [],
  };
}

function boundaryEvidence(
  side: FixedRigPrintedBorderSideV1,
  attemptedCrossSectionCount: number,
  thresholdQualifiedCrossSectionCount: number,
  best: ClusterV1 | null,
  viable: readonly ClusterV1[],
): FixedRigPrintedBorderBoundaryEvidenceV1 {
  if (!best) return emptyBoundaryEvidence(side, attemptedCrossSectionCount, thresholdQualifiedCrossSectionCount);
  return {
    side,
    fittedAxis: side === "left" || side === "right" ? "x" : "y",
    attemptedCrossSectionCount,
    thresholdQualifiedCrossSectionCount,
    supportedCrossSectionCount: best.samples.length,
    supportFraction: best.supportFraction,
    fittedModel: "robust_2d_line",
    medianCoordinatePx: best.coordinatePx,
    medianInsetFromOuterCutPx: best.medianInsetFromOuterCutPx,
    fitResidualPx: best.residualPx,
    lineSlope: best.lineFit.slope,
    lineInterceptPx: best.lineFit.interceptPx,
    lineEquation: { ...best.lineFit.lineEquation },
    positionU95Px: best.lineFit.positionU95Px,
    medianPeakGradient: best.medianPeakGradient,
    medianAdaptiveThreshold: best.medianAdaptiveThreshold,
    confidence: best.confidence,
    viableClusterCount: viable.length,
    viableClusterCoordinatesPx: viable.map((cluster) => cluster.coordinatePx),
    accepted: viable.length === 1,
    samples: best.samples.map((sample) => ({
      crossSectionIndex: sample.crossSectionIndex,
      crossSectionCoordinatePx: sample.crossSectionCoordinatePx,
      point: { ...sample.point },
      insetFromOuterCutPx: sample.insetFromOuterCutPx,
      absoluteNormalizedGradient: sample.absoluteNormalizedGradient,
      adaptiveGradientThreshold: sample.adaptiveGradientThreshold,
    })),
  };
}

function sourcePlaneIsValid(plane: FixedRigScalarPlaneV1): boolean {
  if (
    !Number.isInteger(plane.width) ||
    !Number.isInteger(plane.height) ||
    plane.width < 2 ||
    plane.height < 2 ||
    plane.data.length !== plane.width * plane.height
  ) return false;
  for (let index = 0; index < plane.data.length; index += 1) {
    const value = Number(plane.data[index]);
    if (!Number.isFinite(value) || value < 0 || value > 1) return false;
  }
  return true;
}

function evidenceIsValid(
  side: "front" | "back",
  evidence: readonly FixedRigCenteringEvidenceReferenceV1[],
): boolean {
  return evidence.length > 0 &&
    evidence.every((entry) => {
      const parsed = mathematicalEvidenceReferenceV1Schema.safeParse(entry);
      return parsed.success && parsed.data.side === side;
    }) &&
    evidence.some((entry) => entry.role === "all_on");
}

function baseResult(
  input: DetectFixedRigPrintedBorderSourceV1Input,
  width: number,
  height: number,
  outerCutContour: FixedRigPointV1[],
  boundaryEvidenceValue: Partial<Record<FixedRigPrintedBorderSideV1, FixedRigPrintedBorderBoundaryEvidenceV1>>,
): FixedRigPrintedBorderDetectorBaseV1 {
  return {
    version: FIXED_RIG_PRINTED_BORDER_SOURCE_DETECTOR_V1_VERSION,
    side: input.side,
    coordinateFrame: "normalized_card_portrait_pixels",
    sourcePlane: SOURCE_POLICY.sourcePlane,
    width,
    height,
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
    thresholds: thresholds(),
    outerCutContour: outerCutContour.map((point) => ({ ...point })),
    boundaryEvidence: boundaryEvidenceValue,
    evidence: input.evidence.map((entry) => ({ ...entry })),
    conditionDeduction: 0,
  };
}

function insufficient(
  input: DetectFixedRigPrintedBorderSourceV1Input,
  reasons: FixedRigPrintedBorderDetectorReasonV1[],
  outerCutContour: FixedRigPointV1[] = [],
  boundaryEvidenceValue: Partial<Record<FixedRigPrintedBorderSideV1, FixedRigPrintedBorderBoundaryEvidenceV1>> = {},
): FixedRigPrintedBorderDetectorInsufficientV1 {
  const plane = input.flatFieldNormalizedAllOnLuminance;
  const confidenceValues = Object.values(boundaryEvidenceValue).map((entry) => entry?.confidence ?? 0);
  return {
    ...baseResult(input, plane.width, plane.height, outerCutContour, boundaryEvidenceValue),
    status: "insufficient_evidence",
    profileInput: null,
    detectedPrintContour: [],
    confidence: confidenceValues.length ? round(Math.min(...confidenceValues)) : 0,
    reasons,
    requiresRecaptureOrRegisteredDesignReference: true,
  };
}

export function detectFixedRigPrintedBorderSourceV1(
  input: DetectFixedRigPrintedBorderSourceV1Input,
): FixedRigPrintedBorderDetectorResultV1 {
  const plane = input.flatFieldNormalizedAllOnLuminance;
  if (!sourcePlaneIsValid(plane)) {
    return insufficient(input, [{
      code: "invalid_source_plane",
      message: "The source must be one finite 0..1 flat-field-normalized all-on luminance sample per normalized-card pixel.",
    }]);
  }
  if (!evidenceIsValid(input.side, input.evidence)) {
    return insufficient(input, [{
      code: "missing_all_on_evidence",
      message: "The detector requires valid same-side immutable evidence including the all-on source artifact.",
    }]);
  }
  const outer = normalizeOuterContour(input.outerCutContour, plane.width, plane.height);
  if (!outer) {
    return insufficient(input, [{
      code: "invalid_outer_cut_contour",
      message: "The outer cut contour is missing, non-finite, degenerate, or outside the source plane.",
    }]);
  }
  const vertical = scanVerticalBoundaries(plane, outer.scanContour);
  const horizontal = scanHorizontalBoundaries(plane, outer.scanContour);
  if (vertical.ambiguousOuter || horizontal.ambiguousOuter) {
    return insufficient(input, [{
      code: "invalid_outer_cut_contour",
      message: "The outer cut contour produced more than two intersections on a detector cross-section.",
    }], outer.contour);
  }
  const scans: Record<FixedRigPrintedBorderSideV1, CrossSectionScanV1[]> = {
    left: vertical.left,
    right: vertical.right,
    top: horizontal.top,
    bottom: horizontal.bottom,
  };
  const analyses = {
    left: boundaryAnalysis("left", scans.left),
    right: boundaryAnalysis("right", scans.right),
    top: boundaryAnalysis("top", scans.top),
    bottom: boundaryAnalysis("bottom", scans.bottom),
  };
  const boundaryEvidenceValue = {
    left: analyses.left.evidence,
    right: analyses.right.evidence,
    top: analyses.top.evidence,
    bottom: analyses.bottom.evidence,
  };
  const reasons = Object.values(analyses).flatMap((analysis) => analysis.reason ? [analysis.reason] : []);
  if (reasons.length) return insufficient(input, reasons, outer.contour, boundaryEvidenceValue);

  const printBoundarySamples: FixedRigPrintedBorderSamplesV1 = {
    left: analyses.left.samples as FixedRigPointV1[],
    right: analyses.right.samples as FixedRigPointV1[],
    top: analyses.top.samples as FixedRigPointV1[],
    bottom: analyses.bottom.samples as FixedRigPointV1[],
  };
  const middleX = (outer.bounds.left + outer.bounds.right) / 2;
  const middleY = (outer.bounds.top + outer.bounds.bottom) / 2;
  const lineFits = {
    left: fitFixedRigPrintedBorderLineV1(printBoundarySamples.left, "left", middleY),
    right: fitFixedRigPrintedBorderLineV1(printBoundarySamples.right, "right", middleY),
    top: fitFixedRigPrintedBorderLineV1(printBoundarySamples.top, "top", middleX),
    bottom: fitFixedRigPrintedBorderLineV1(printBoundarySamples.bottom, "bottom", middleX),
  };
  if (Object.values(lineFits).some((fit) => fit === null)) {
    return insufficient(input, [{
      code: "unstable_boundary_fit",
      message: "The accepted candidate tracks did not reproduce four manifest-compliant robust 2-D lines.",
    }], outer.contour, boundaryEvidenceValue);
  }
  const acceptedLineFits = lineFits as Record<
    FixedRigPrintedBorderSideV1,
    FixedRigRobustLineFitV1
  >;
  const coordinates = {
    left: acceptedLineFits.left.coordinatePx,
    right: acceptedLineFits.right.coordinatePx,
    top: acceptedLineFits.top.coordinatePx,
    bottom: acceptedLineFits.bottom.coordinatePx,
  };
  const detectedPrintContour = [
    intersectFixedRigPrintedBorderLinesV1(acceptedLineFits.left, acceptedLineFits.top),
    intersectFixedRigPrintedBorderLinesV1(acceptedLineFits.right, acceptedLineFits.top),
    intersectFixedRigPrintedBorderLinesV1(acceptedLineFits.right, acceptedLineFits.bottom),
    intersectFixedRigPrintedBorderLinesV1(acceptedLineFits.left, acceptedLineFits.bottom),
  ];
  if (
    !(coordinates.right > coordinates.left && coordinates.bottom > coordinates.top) ||
    coordinates.left < outer.bounds.left || coordinates.right > outer.bounds.right ||
    coordinates.top < outer.bounds.top || coordinates.bottom > outer.bounds.bottom ||
    detectedPrintContour.some((point) => point === null) ||
    detectedPrintContour.some((point) => point !== null && (
      point.x < outer.bounds.left || point.x > outer.bounds.right ||
      point.y < outer.bounds.top || point.y > outer.bounds.bottom
    ))
  ) {
    return insufficient(input, [{
      code: "invalid_detected_boundary",
      message: "The supported peaks did not form one nondegenerate printed boundary inside the outer cut contour.",
    }], outer.contour, boundaryEvidenceValue);
  }
  return {
    ...baseResult(input, plane.width, plane.height, outer.contour, boundaryEvidenceValue),
    status: "computed",
    profileInput: { profile: "printed_border_v1", printBoundarySamples },
    detectedPrintContour: detectedPrintContour as FixedRigPointV1[],
    confidence: round(Math.min(...Object.values(boundaryEvidenceValue).map((entry) => entry.confidence))),
    formula:
      "per-cross-section adaptive absolute-gradient threshold; inset-ordered candidate tracks; deterministic robust 2-D line fit; side-line intersections",
  };
}

export interface BuildFixedRigPrintedBorderCenteringSideV1Input
  extends Omit<FixedRigCenteringSideInputV1, "profileInput"> {
  flatFieldNormalizedAllOnLuminance: FixedRigScalarPlaneV1;
}

export interface BuiltFixedRigPrintedBorderCenteringSideV1 {
  detector: FixedRigPrintedBorderDetectorResultV1;
  centering: FixedRigCenteringSideResultV1;
}

/** Detects the source boundary, then passes its exact sample contract to the existing centering scorer. */
export function buildFixedRigPrintedBorderCenteringSideV1(
  input: BuildFixedRigPrintedBorderCenteringSideV1Input,
): BuiltFixedRigPrintedBorderCenteringSideV1 {
  const detector = detectFixedRigPrintedBorderSourceV1({
    side: input.side,
    flatFieldNormalizedAllOnLuminance: input.flatFieldNormalizedAllOnLuminance,
    outerCutContour: input.outerCutContour,
    evidence: input.evidence,
  });
  if (detector.status === "insufficient_evidence") {
    return {
      detector,
      centering: {
        version: FIXED_RIG_CENTERING_V1_VERSION,
        status: "insufficient_evidence",
        side: input.side,
        profile: "printed_border_v1",
        score: null,
        requiresRecaptureOrApprovedReference: true,
        reasons: detector.reasons.map((reason) =>
          "Printed-border source detector" + (reason.side ? " " + reason.side : "") + ": " + reason.message),
        cardDefectDeduction: 0,
      },
    };
  }
  return {
    detector,
    centering: buildFixedRigCenteringSideV1({
      side: input.side,
      calibration: input.calibration,
      outerCutContour: input.outerCutContour,
      profileInput: detector.profileInput,
      evidence: input.evidence,
    }),
  };
}
