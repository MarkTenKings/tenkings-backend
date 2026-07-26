import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import {
  measureFixedRigDenseContourV1,
  traceFixedRigDenseContourV1,
} from "./fixedRigShapeAgnosticContourV1";

export const CARD_GEOMETRY_VERSION = "ten-kings-card-geometry-v1";
export const STANDARD_CARD_WIDTH_INCHES = 2.5;
export const STANDARD_CARD_HEIGHT_INCHES = 3.5;
export const NORMALIZED_CARD_WIDTH_PIXELS = 1200;
export const NORMALIZED_CARD_HEIGHT_PIXELS = 1680;
export const CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1 =
  "ten-kings-raw-to-normalized-card-transform-v1" as const;

export type CardGeometrySide = "front" | "back";
export type CardPlacementState = "not_detected" | "adjust_card" | "ready";
export type CardGeometryAdjustmentReason =
  | "not_detected"
  | "outside_frame"
  | "unsafe_scale"
  | "rotate_top_up"
  | "wrong_aspect"
  | "low_confidence";
export type CardGeometrySource = "detected" | "none";
export type CardGeometryCaptureMode = "automatic_detection" | "none";
export type AiGraderCardGeometryDetectionPolicy = "live_preview_fast" | "captured_evidence_full";

export interface CardGeometryDetectionAttemptObservation {
  detectionPolicy: AiGraderCardGeometryDetectionPolicy;
  method: "solid_plate_color_component_pca_v2";
  outcome: "candidate" | "no_candidate";
  /** Non-authoritative diagnostic duration, never persisted in geometry metadata. */
  elapsedMs: number;
}

export interface CardGeometryPoint {
  x: number;
  y: number;
}

export interface CardGeometryCorners {
  topLeft: CardGeometryPoint;
  topRight: CardGeometryPoint;
  bottomRight: CardGeometryPoint;
  bottomLeft: CardGeometryPoint;
}

export interface CardGeometryBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardGeometryObservedDenseContourV1 {
  schemaVersion: "ten-kings-card-geometry-observed-dense-contour-v1";
  coordinateFrame: "source_image_pixels";
  sourceAssetSha256: string;
  points: readonly CardGeometryPoint[];
  pointCount: number;
  contourSha256: string;
  strongSupportFraction: number;
  evidenceQuality: "strong" | "limited";
  measurementsPx: {
    width: number;
    height: number;
    perimeter: number;
    enclosedArea: number;
    angleDegrees: number;
    circularArcs: readonly {
      radiusPx: number;
      sweepDegrees: number;
      radialResidualPx: number;
      sampleCount: number;
    }[];
  };
  /**
   * Physical measurements are present only when the exact active rig
   * calibration has been bound to the source sensor coordinate frame.
   * They are private operator evidence; public reports must not expose U95.
   */
  measurementsMm?: {
    measurementAuthoritySha256: string;
    calibration: {
      profileId: string;
      calibrationVersion: string;
      calibrationArtifactSha256: string;
      bundleManifestSha256: string;
      sourceWidthPx: number;
      sourceHeightPx: number;
      effectiveMmPerPixelX: number;
      effectiveMmPerPixelY: number;
    };
    width: number;
    height: number;
    perimeter: number;
    enclosedArea: number;
    angleDegrees: number;
    circularArcs: readonly {
      radiusMm: number;
      sweepDegrees: number;
      radialResidualMm: number;
      sampleCount: number;
    }[];
    privateUncertaintyU95: {
      widthMm: number;
      heightMm: number;
      radiusMm: number;
      basis: "calibrated_scale_boundary_and_repeatability_rss";
    };
  };
}

export interface CardGeometrySensorPlaneCalibrationV1 {
  schemaVersion: "ten-kings-card-geometry-sensor-plane-calibration-v1";
  profileId: string;
  calibrationVersion: string;
  calibrationArtifactSha256: string;
  bundleManifestSha256: string;
  sourceWidthPx: number;
  sourceHeightPx: number;
  mmPerPixelX: number;
  mmPerPixelY: number;
  scaleRelativeU95: number;
  segmentationBoundaryU95Px: number;
  linearMeasurementU95Mm: number;
}

export interface CardGeometryNormalizedDenseContourV1 {
  schemaVersion: "ten-kings-normalized-dense-contour-v1";
  coordinateFrame: "normalized_card_portrait_pixels";
  sourceContourSha256: string;
  rawToNormalizedTransformSha256: string;
  points: readonly CardGeometryPoint[];
  pointCount: number;
  contourSha256: string;
}

export interface CardGeometryThresholds {
  maxCenterOffsetInches: number;
  /** Preferred placement guide. Rotation beyond this may still be normalization-safe. */
  maxSkewDegrees: number;
  /** Hard automatic-capture envelope for in-plane rotation correction. */
  maxNormalizationSkewDegrees: number;
  minReadyConfidence: number;
  minDetectionConfidence: number;
  expectedAspectRatio: number;
  maxRelativeAspectError: number;
  minCardCoverage: number;
  maxCardCoverage: number;
  minEdgeClearanceRatio: number;
  analysisMaxDimension: number;
}

export interface CardGeometryDetectionDiagnostics {
  method:
    | "adaptive_border_contrast_connected_component_pca_v1"
    | "solid_plate_color_component_pca_v2"
    | "opencv_find_chessboard_corners_sb_v1"
    ;
  backgroundLuma: number;
  backgroundColor?: { r: number; g: number; b: number };
  backgroundNoise?: number;
  contrastRange: number;
  foregroundThreshold: number;
  foregroundPixelFraction: number;
  morphologyRadius?: number;
  componentPixelFraction?: number;
  rectangularFill?: number;
  measuredAspectRatio?: number;
  expectedAspectRatio: number;
  relativeAspectError?: number;
  analysisWidth: number;
  analysisHeight: number;
}

export interface CardGeometryPlacementEvaluation {
  centerOffsetPixels?: {
    x: number;
    y: number;
    distance: number;
    maxAxis: number;
  };
  centerOffsetInches?: {
    x: number;
    y: number;
    distance: number;
    maxAxis: number;
  };
  estimatedPixelsPerInch?: number;
  maxCenterOffsetInches: number;
  maxSkewDegrees: number;
  maxNormalizationSkewDegrees: number;
  minReadyConfidence: number;
  withinCenterTolerance: boolean;
  withinSkewTolerance: boolean;
  withinNormalizationSkewTolerance: boolean;
  withinAspectTolerance: boolean;
  withinCoverageTolerance?: boolean;
  withinFrame: boolean;
  confidenceReady: boolean;
  cardCoverage?: number;
}

/**
 * Geometry metadata is deliberately path-free. Local artifact paths live only
 * on CardGeometryNormalizationResult and must not be copied to public output.
 */
export interface CardGeometryMetadata {
  version: typeof CARD_GEOMETRY_VERSION;
  /** Path-free audit evidence for the explicitly selected detector policy. */
  detectionPolicy: AiGraderCardGeometryDetectionPolicy;
  side: CardGeometrySide;
  placementState: CardPlacementState;
  adjustmentReason: CardGeometryAdjustmentReason | null;
  geometrySource: CardGeometrySource;
  captureMode: CardGeometryCaptureMode;
  /** Describes what the numeric confidence represents. */
  confidenceBasis: "automatic_detection" | "operator_confirmation" | "none";
  detectionUsed: boolean;
  manualOverrideUsed: boolean;
  corners: CardGeometryCorners | null;
  detectedCorners: CardGeometryCorners | null;
  /**
   * Dense observed material boundary. This is the visible edge authority for
   * preview; four-corner geometry remains only a placement/legacy transform.
   */
  observedDenseContour?: CardGeometryObservedDenseContourV1;
  boundingBox: CardGeometryBoundingBox | null;
  rotationDegrees: number | null;
  skewDegrees: number | null;
  confidence: number;
  sourceImageId?: string;
  sourceFrameId?: string;
  timestamp: string;
  image: {
    width: number;
    height: number;
    coordinateFrame: "source_image_pixels";
  };
  /**
   * Geometry can normalize portrait shape and in-plane rotation, but it cannot
   * infer printed top versus bottom. The fixed-rig operator owns that semantic
   * orientation before capture.
   */
  semanticOrientation: {
    canonicalOrientation: "portrait";
    basis: "operator_top_toward_preview_top";
    contentUprightVerified: false;
  };
  placement: CardGeometryPlacementEvaluation;
  detection: CardGeometryDetectionDiagnostics;
  warnings: string[];
}

export interface DetectCardGeometryInput {
  sourceImagePath: string;
  /** Required at every detector boundary; there is deliberately no default. */
  detectionPolicy: AiGraderCardGeometryDetectionPolicy;
  side: CardGeometrySide;
  sourceImageId?: string;
  sourceFrameId?: string;
  timestamp?: string;
  thresholds?: Partial<CardGeometryThresholds>;
  /**
   * Exact active calibration for the full Basler sensor plane. Preview frames
   * may be downsampled; buildGeometry scales this authority into the analyzed
   * source frame without changing the physical measurement.
   */
  sensorPlaneCalibration?: CardGeometrySensorPlaneCalibrationV1;
  /** Test/diagnostic observability only. Exceptions cannot alter detector results. */
  onDetectionAttempt?: (observation: CardGeometryDetectionAttemptObservation) => void;
}

export interface DetectCardGeometryBufferInput extends Omit<DetectCardGeometryInput, "sourceImagePath"> {
  imageBuffer: Buffer;
  fileName?: string;
}

export interface CardGeometryArtifactMetadata {
  fileName: string;
  sha256: string;
  byteSize: number;
  mimeType: "image/png" | "image/jpeg" | "image/tiff" | "image/webp" | "application/octet-stream";
  imageWidth: number;
  imageHeight: number;
}

export interface CardGeometryNormalizedArtifact extends CardGeometryArtifactMetadata {
  localOutputPath: string;
  /** PNG compression is lossless; geometric normalization may still resample pixels. */
  lossless: true;
  encodingLossless: true;
  geometricResamplingApplied: boolean;
  upscaled: boolean;
  sourceCropWidth: number;
  sourceCropHeight: number;
  scaleX: number;
  scaleY: number;
  coordinateFrame: "normalized_card_portrait_pixels";
  sourceSha256: string;
  deskewAppliedDegrees: number;
  rawToNormalizedTransform: CardGeometryRawToNormalizedTransformV1;
  normalizedDenseContour?: CardGeometryNormalizedDenseContourV1;
}

export interface CardGeometryRawToNormalizedTransformV1 {
  schemaVersion: typeof CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1;
  sourceSha256: string;
  sourceCoordinateFrame: "auto_oriented_raw_image_pixels";
  sourceWidthPx: number;
  sourceHeightPx: number;
  autoOrientApplied: true;
  deskewClockwiseDegrees: number;
  rotatedWidthPx: number;
  rotatedHeightPx: number;
  crop: { leftPx: number; topPx: number; widthPx: number; heightPx: number };
  outputCoordinateFrame: "normalized_card_portrait_pixels";
  outputWidthPx: number;
  outputHeightPx: number;
  outputPlacement?: {
    fit: "contain_preserve_physical_shape";
    leftPx: number;
    topPx: number;
    widthPx: number;
    heightPx: number;
  };
  /** Row-major affine 3x3 matrix mapping source boundary coordinates to normalized coordinates. */
  matrix: [number, number, number, number, number, number, 0, 0, 1];
  transformSha256: string;
}

type CardGeometryRawToNormalizedTransformPayloadV1 = Omit<
  CardGeometryRawToNormalizedTransformV1,
  'transformSha256'
>;

export interface CardGeometryNormalizationResult {
  geometry: CardGeometryMetadata;
  rawArtifact: CardGeometryArtifactMetadata;
  normalizedArtifact?: CardGeometryNormalizedArtifact;
  rawEvidencePreserved: boolean;
}

export interface DetectAndNormalizeCardImageInput extends DetectCardGeometryInput {
  normalizedOutputPath: string;
  pngCompressionLevel?: number;
}

export interface NormalizeCardImageWithGeometryInput {
  sourceImagePath: string;
  normalizedOutputPath: string;
  geometry: CardGeometryMetadata;
  pngCompressionLevel?: number;
}

interface PreparedImage {
  orientedWidth: number;
  orientedHeight: number;
  rawArtifact: CardGeometryArtifactMetadata;
  rawBytes: Buffer;
}

interface ComponentStats {
  label: number;
  count: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumYY: number;
  sumXY: number;
  sumDifference: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  touchesFrame: boolean;
}

interface DetectionCandidate {
  corners: CardGeometryCorners;
  boundingBox: CardGeometryBoundingBox;
  rotationDegrees: number;
  confidence: number;
  shortSidePixels: number;
  longSidePixels: number;
  cardCoverage: number;
  measuredAspectRatio: number;
  relativeAspectError: number;
  diagnostics: CardGeometryDetectionDiagnostics;
  observedDenseContour?: CardGeometryObservedDenseContourV1;
}

interface DetectionAttempt {
  candidate?: DetectionCandidate;
  diagnostics: CardGeometryDetectionDiagnostics;
  reason?: string;
}

const DEFAULT_THRESHOLDS: CardGeometryThresholds = {
  maxCenterOffsetInches: 0.5,
  maxSkewDegrees: 10,
  maxNormalizationSkewDegrees: 35,
  minReadyConfidence: 0.72,
  minDetectionConfidence: 0.35,
  expectedAspectRatio: STANDARD_CARD_HEIGHT_INCHES / STANDARD_CARD_WIDTH_INCHES,
  maxRelativeAspectError: 0.18,
  // The configured Dell fixture keeps a standard card near one-half of the
  // fixed frame. This expected-scale envelope rejects inner artwork rectangles
  // and tiny cards
  // that would require grading-unsafe upscaling while still allowing the
  // requested close-enough translation and rotation.
  minCardCoverage: 0.3,
  maxCardCoverage: 0.85,
  minEdgeClearanceRatio: 0.01,
  analysisMaxDimension: 1024,
};

// Sub-pixel antialiasing can move a PCA edge estimate by a few tenths of a
// degree. Keep the operator boundary inclusive at the configured threshold.
const SKEW_ESTIMATION_EPSILON_DEGREES = 0.25;
const MAX_REPORTED_DETECTION_ATTEMPT_MS = 300_000;

function requireDetectionPolicy(value: unknown): AiGraderCardGeometryDetectionPolicy {
  if (value !== "live_preview_fast" && value !== "captured_evidence_full") {
    throw new Error("detectionPolicy must be live_preview_fast or captured_evidence_full.");
  }
  return value;
}

function reportDetectionAttempt(
  observer: DetectCardGeometryInput["onDetectionAttempt"],
  observation: Omit<CardGeometryDetectionAttemptObservation, "elapsedMs">,
  startedAt: number,
): void {
  if (!observer) return;
  const measured = performance.now() - startedAt;
  const elapsedMs = round(
    Number.isFinite(measured) ? clamp(measured, 0, MAX_REPORTED_DETECTION_ATTEMPT_MS) : 0,
    3,
  );
  try {
    observer(Object.freeze({ ...observation, elapsedMs }));
  } catch {
    // Observability is deliberately non-authoritative and cannot change a
    // detector result, capture decision, or evidence artifact.
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`);
  return value;
}

function normalizeThresholds(input?: Partial<CardGeometryThresholds>): CardGeometryThresholds {
  const merged = { ...DEFAULT_THRESHOLDS, ...input };
  finitePositive(merged.maxCenterOffsetInches, "maxCenterOffsetInches");
  finitePositive(merged.maxSkewDegrees, "maxSkewDegrees");
  finitePositive(merged.maxNormalizationSkewDegrees, "maxNormalizationSkewDegrees");
  finitePositive(merged.expectedAspectRatio, "expectedAspectRatio");
  finitePositive(merged.maxRelativeAspectError, "maxRelativeAspectError");
  finitePositive(merged.analysisMaxDimension, "analysisMaxDimension");
  for (const [name, value] of [
    ["minReadyConfidence", merged.minReadyConfidence],
    ["minDetectionConfidence", merged.minDetectionConfidence],
    ["minCardCoverage", merged.minCardCoverage],
    ["maxCardCoverage", merged.maxCardCoverage],
    ["minEdgeClearanceRatio", merged.minEdgeClearanceRatio],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1.`);
  }
  if (merged.minDetectionConfidence > merged.minReadyConfidence) {
    throw new Error("minDetectionConfidence cannot exceed minReadyConfidence.");
  }
  if (merged.maxNormalizationSkewDegrees < merged.maxSkewDegrees || merged.maxNormalizationSkewDegrees >= 90) {
    throw new Error("maxNormalizationSkewDegrees must be at least maxSkewDegrees and lower than 90 degrees.");
  }
  if (merged.minCardCoverage >= merged.maxCardCoverage) {
    throw new Error("minCardCoverage must be lower than maxCardCoverage.");
  }
  return merged;
}

function sanitizeSourceId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 128) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) return undefined;
  return normalized;
}

function normalizeTimestamp(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("timestamp must be a valid date/time value.");
  return parsed.toISOString();
}

function mimeTypeForFormat(format: string | undefined): CardGeometryArtifactMetadata["mimeType"] {
  if (format === "png") return "image/png";
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "tiff") return "image/tiff";
  if (format === "webp") return "image/webp";
  return "application/octet-stream";
}

async function prepareImageBytes(rawBytes: Buffer, fileName: string): Promise<PreparedImage> {
  const rawMetadata = await sharp(rawBytes).metadata();
  const orientedWidth = rawMetadata.autoOrient?.width ?? rawMetadata.width;
  const orientedHeight = rawMetadata.autoOrient?.height ?? rawMetadata.height;
  if (!orientedWidth || !orientedHeight) throw new Error("Card geometry source image dimensions are unavailable.");
  return {
    rawBytes,
    orientedWidth,
    orientedHeight,
    rawArtifact: {
      fileName,
      sha256: createHash("sha256").update(rawBytes).digest("hex"),
      byteSize: rawBytes.length,
      mimeType: mimeTypeForFormat(rawMetadata.format),
      imageWidth: rawMetadata.width ?? orientedWidth,
      imageHeight: rawMetadata.height ?? orientedHeight,
    },
  };
}

async function prepareImage(sourceImagePath: string): Promise<PreparedImage> {
  return prepareImageBytes(await readFile(sourceImagePath), path.basename(sourceImagePath));
}

function histogramPercentile(histogram: Uint32Array, total: number, percentile: number): number {
  const target = Math.max(1, Math.ceil(total * percentile));
  let seen = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index] ?? 0;
    if (seen >= target) return index;
  }
  return histogram.length - 1;
}

function medianFromHistogram(histogram: Uint32Array, total: number): number {
  return histogramPercentile(histogram, total, 0.5);
}

function squareNeighborhoodCounts(mask: Uint8Array, width: number, height: number): Int32Array {
  const stride = width + 1;
  const integral = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += mask[y * width + x] ?? 0;
      integral[(y + 1) * stride + x + 1] = (integral[y * stride + x + 1] ?? 0) + rowSum;
    }
  }
  return integral;
}

function morphologyPass(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  mode: "dilate" | "erode",
): Uint8Array {
  if (radius <= 0) return mask.slice();
  const integral = squareNeighborhoodCounts(mask, width, height);
  const stride = width + 1;
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const sum =
        (integral[(bottom + 1) * stride + right + 1] ?? 0) -
        (integral[top * stride + right + 1] ?? 0) -
        (integral[(bottom + 1) * stride + left] ?? 0) +
        (integral[top * stride + left] ?? 0);
      const area = (right - left + 1) * (bottom - top + 1);
      output[y * width + x] = mode === "dilate" ? (sum > 0 ? 1 : 0) : (sum === area ? 1 : 0);
    }
  }
  return output;
}

function closeForegroundMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return morphologyPass(
    morphologyPass(mask, width, height, radius, "dilate"),
    width,
    height,
    radius,
    "erode",
  );
}

function openForegroundMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return morphologyPass(
    morphologyPass(mask, width, height, radius, "erode"),
    width,
    height,
    radius,
    "dilate",
  );
}

/**
 * Add only observed boundary pixels immediately adjacent to the region
 * evidence. This can seal small weak gaps in an already-owned material region,
 * but a distant raw edge network can never create or nominate an object.
 */
function supportOwnedRegionBoundary(
  regionMask: Uint8Array,
  edgeStrength: Float32Array,
  edgeSupportThreshold: number,
  width: number,
  height: number,
): Uint8Array {
  const proximity = morphologyPass(regionMask, width, height, 3, "dilate");
  const supported = regionMask.slice();
  const minimumBarrierStrength = Math.max(2, edgeSupportThreshold * 0.5);
  for (let index = 0; index < regionMask.length; index += 1) {
    if (
      proximity[index] !== 0 &&
      (edgeStrength[index] ?? 0) >= minimumBarrierStrength
    ) {
      supported[index] = 1;
    }
  }
  return supported;
}

/** Fill only background regions enclosed by foreground. Border-connected plate pixels stay background. */
function fillForegroundHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const borderBackground = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  const enqueue = (index: number) => {
    if (index < 0 || index >= mask.length || mask[index] !== 0 || borderBackground[index] !== 0) return;
    borderBackground[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++] ?? 0;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  const output = mask.slice();
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === 0 && borderBackground[index] === 0) output[index] = 1;
  }
  return output;
}

type BackgroundSurfaceCoefficients = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

interface BackgroundSurfaceSample {
  terms: BackgroundSurfaceCoefficients;
  red: number;
  green: number;
  blue: number;
  exterior: boolean;
  baseWeight: number;
}

interface LocallyModeledRegionEvidence {
  differences: Uint8Array;
  backgroundNoise: number;
  contrastRange: number;
  foregroundThreshold: number;
  backgroundSurfaceMode: "constant" | "modeled";
}

interface RestrictedEdgeEvidence {
  strength: Float32Array;
  supportThreshold: number;
}

function backgroundSurfaceTerms(
  x: number,
  y: number,
  width: number,
  height: number,
): BackgroundSurfaceCoefficients {
  const normalizedX = width > 1 ? (2 * x) / (width - 1) - 1 : 0;
  const normalizedY = height > 1 ? (2 * y) / (height - 1) - 1 : 0;
  const normalizedRadius = Math.hypot(normalizedX, normalizedY);
  return [
    1,
    normalizedX,
    normalizedY,
    normalizedX * normalizedX,
    normalizedX * normalizedY,
    normalizedY * normalizedY,
    normalizedRadius,
    normalizedX * normalizedRadius,
    normalizedY * normalizedRadius,
    normalizedRadius * normalizedRadius * normalizedRadius,
    normalizedRadius * normalizedRadius * normalizedRadius * normalizedRadius,
  ];
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | undefined {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index] ?? 0]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivot]?.[column] ?? 0)) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot]?.[column] ?? 0) < 1e-9) return undefined;
    if (pivot !== column) {
      const next = augmented[column]!;
      augmented[column] = augmented[pivot]!;
      augmented[pivot] = next;
    }
    const pivotValue = augmented[column]?.[column] ?? 1;
    for (let index = column; index <= size; index += 1) {
      augmented[column]![index] = (augmented[column]?.[index] ?? 0) / pivotValue;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]?.[column] ?? 0;
      if (Math.abs(factor) < 1e-12) continue;
      for (let index = column; index <= size; index += 1) {
        augmented[row]![index] =
          (augmented[row]?.[index] ?? 0) - factor * (augmented[column]?.[index] ?? 0);
      }
    }
  }
  return augmented.map((row) => row[size] ?? 0);
}

function fitBackgroundSurfaceChannel(
  samples: readonly BackgroundSurfaceSample[],
  weights: readonly number[],
  channel: "red" | "green" | "blue",
): BackgroundSurfaceCoefficients | undefined {
  const size = 11;
  const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const vector = Array<number>(size).fill(0);
  samples.forEach((sample, sampleIndex) => {
    const weight = weights[sampleIndex] ?? 1;
    const value = sample[channel];
    for (let row = 0; row < size; row += 1) {
      const rowTerm = sample.terms[row] ?? 0;
      vector[row] = (vector[row] ?? 0) + weight * rowTerm * value;
      for (let column = 0; column < size; column += 1) {
        matrix[row]![column] =
          (matrix[row]?.[column] ?? 0) +
          weight * rowTerm * (sample.terms[column] ?? 0);
      }
    }
  });
  const solved = solveLinearSystem(matrix, vector);
  return solved?.length === size
    ? solved as unknown as BackgroundSurfaceCoefficients
    : undefined;
}

function evaluateBackgroundSurface(
  coefficients: BackgroundSurfaceCoefficients,
  terms: BackgroundSurfaceCoefficients,
): number {
  let value = 0;
  for (let index = 0; index < coefficients.length; index += 1) {
    value += (coefficients[index] ?? 0) * (terms[index] ?? 0);
  }
  return clamp(value, 0, 255);
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

function fitRobustBackgroundSurface(
  samples: readonly BackgroundSurfaceSample[],
): {
  red: BackgroundSurfaceCoefficients;
  green: BackgroundSurfaceCoefficients;
  blue: BackgroundSurfaceCoefficients;
} | undefined {
  if (samples.length < 64) return undefined;
  let weights = Array<number>(samples.length).fill(1);
  let red: BackgroundSurfaceCoefficients | undefined;
  let green: BackgroundSurfaceCoefficients | undefined;
  let blue: BackgroundSurfaceCoefficients | undefined;
  weights = samples.map((sample) => sample.baseWeight);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    red = fitBackgroundSurfaceChannel(samples, weights, "red");
    green = fitBackgroundSurfaceChannel(samples, weights, "green");
    blue = fitBackgroundSurfaceChannel(samples, weights, "blue");
    if (!red || !green || !blue) return undefined;
    const residuals = samples.map((sample) => {
      const redResidual =
        sample.red - evaluateBackgroundSurface(red!, sample.terms);
      const greenResidual =
        sample.green - evaluateBackgroundSurface(green!, sample.terms);
      const blueResidual =
        sample.blue - evaluateBackgroundSurface(blue!, sample.terms);
      return Math.hypot(redResidual, greenResidual, blueResidual) / Math.sqrt(3);
    });
    const exteriorResiduals = residuals.filter((_, index) => samples[index]?.exterior);
    const location = median(exteriorResiduals);
    const absoluteDeviations = exteriorResiduals.map((value) => Math.abs(value - location));
    const robustSigma = Math.max(0.25, median(absoluteDeviations) * 1.4826);
    const cutoff = Math.max(1, location + robustSigma * 3);
    weights = residuals.map((value, index) => {
      const baseWeight = samples[index]?.baseWeight ?? 1;
      return baseWeight * (value <= cutoff ? 1 : cutoff / Math.max(value, 1e-6));
    });
  }
  return red && green && blue ? { red, green, blue } : undefined;
}

function locallyModeledRegionEvidence(
  observationData: Buffer,
  backgroundSampleData: Buffer,
  channels: number,
  width: number,
  height: number,
  borderSize: number,
): LocallyModeledRegionEvidence | undefined {
  const pixelCount = width * height;
  const approximateBorderPixels =
    Math.max(1, 2 * borderSize * width + 2 * borderSize * Math.max(0, height - 2 * borderSize));
  const sampleStride = Math.max(1, Math.ceil(approximateBorderPixels / 24_000));
  const interiorStride = Math.max(2, Math.ceil(Math.sqrt(pixelCount / 18_000)));
  const samples: BackgroundSurfaceSample[] = [];
  let observedBorderPixel = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const exterior =
        x < borderSize || x >= width - borderSize ||
        y < borderSize || y >= height - borderSize;
      if (exterior) {
        if (observedBorderPixel++ % sampleStride !== 0) continue;
      } else if (x % interiorStride !== 0 || y % interiorStride !== 0) {
        continue;
      }
      const offset = (y * width + x) * channels;
      const red = backgroundSampleData[offset] ?? 0;
      const green =
        backgroundSampleData[offset + Math.min(1, channels - 1)] ?? red;
      const blue =
        backgroundSampleData[offset + Math.min(2, channels - 1)] ?? red;
      samples.push({
        terms: backgroundSurfaceTerms(x, y, width, height),
        red,
        green,
        blue,
        exterior,
        baseWeight: exterior ? 1 : 0.1,
      });
    }
  }
  const exteriorSamples = samples.filter((sample) => sample.exterior);
  const exteriorRed = exteriorSamples.map((sample) => sample.red);
  const exteriorGreen = exteriorSamples.map((sample) => sample.green);
  const exteriorBlue = exteriorSamples.map((sample) => sample.blue);
  const exteriorRange = Math.max(
    Math.max(...exteriorRed) - Math.min(...exteriorRed),
    Math.max(...exteriorGreen) - Math.min(...exteriorGreen),
    Math.max(...exteriorBlue) - Math.min(...exteriorBlue),
  );
  const constantCoefficients = (value: number): BackgroundSurfaceCoefficients =>
    [value, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const backgroundSurfaceMode = exteriorRange <= 1 ? "constant" : "modeled";
  const surface = backgroundSurfaceMode === "constant"
    ? {
        red: constantCoefficients(median(exteriorRed)),
        green: constantCoefficients(median(exteriorGreen)),
        blue: constantCoefficients(median(exteriorBlue)),
      }
    : fitRobustBackgroundSurface(samples);
  if (!surface) return undefined;
  // Region ownership is measured on a lightly smoothed image, while the
  // background surface is learned from untouched sensor pixels. Estimate the
  // small smoothing/color-pipeline offset from exterior background pixels so a
  // flat plate does not become foreground merely because smoothing shifted all
  // channels by a couple of code values.
  const exteriorObservationOffsets = {
    red: [] as number[],
    green: [] as number[],
    blue: [] as number[],
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        x >= borderSize &&
        x < width - borderSize &&
        y >= borderSize &&
        y < height - borderSize
      ) {
        continue;
      }
      const offset = (y * width + x) * channels;
      const red = observationData[offset] ?? 0;
      const green =
        observationData[offset + Math.min(1, channels - 1)] ?? red;
      const blue =
        observationData[offset + Math.min(2, channels - 1)] ?? red;
      const terms = backgroundSurfaceTerms(x, y, width, height);
      exteriorObservationOffsets.red.push(
        red - evaluateBackgroundSurface(surface.red, terms),
      );
      exteriorObservationOffsets.green.push(
        green - evaluateBackgroundSurface(surface.green, terms),
      );
      exteriorObservationOffsets.blue.push(
        blue - evaluateBackgroundSurface(surface.blue, terms),
      );
    }
  }
  const observationOffset = {
    red: median(exteriorObservationOffsets.red),
    green: median(exteriorObservationOffsets.green),
    blue: median(exteriorObservationOffsets.blue),
  };
  const differences = new Uint8Array(pixelCount);
  const differenceHistogram = new Uint32Array(256);
  const borderDifferenceHistogram = new Uint32Array(256);
  let borderDifferenceCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * channels;
      const red = observationData[offset] ?? 0;
      const green =
        observationData[offset + Math.min(1, channels - 1)] ?? red;
      const blue =
        observationData[offset + Math.min(2, channels - 1)] ?? red;
      const terms = backgroundSurfaceTerms(x, y, width, height);
      const difference = Math.round(clamp(
        Math.hypot(
          red -
            clamp(
              evaluateBackgroundSurface(surface.red, terms) +
                observationOffset.red,
              0,
              255,
            ),
          green -
            clamp(
              evaluateBackgroundSurface(surface.green, terms) +
                observationOffset.green,
              0,
              255,
            ),
          blue -
            clamp(
              evaluateBackgroundSurface(surface.blue, terms) +
                observationOffset.blue,
              0,
              255,
            ),
        ) / Math.sqrt(3),
        0,
        255,
      ));
      differences[index] = difference;
      differenceHistogram[difference] = (differenceHistogram[difference] ?? 0) + 1;
      if (x < borderSize || x >= width - borderSize || y < borderSize || y >= height - borderSize) {
        borderDifferenceHistogram[difference] =
          (borderDifferenceHistogram[difference] ?? 0) + 1;
        borderDifferenceCount += 1;
      }
    }
  }
  const backgroundLocation = histogramPercentile(
    borderDifferenceHistogram,
    Math.max(1, borderDifferenceCount),
    0.5,
  );
  const backgroundUpper = histogramPercentile(
    borderDifferenceHistogram,
    Math.max(1, borderDifferenceCount),
    0.8,
  );
  const robustBackgroundSpread = Math.max(0, backgroundUpper - backgroundLocation);
  const backgroundNoise = Math.round(backgroundLocation + robustBackgroundSpread);
  const contrastRange = histogramPercentile(
    differenceHistogram,
    Math.max(1, pixelCount),
    0.99,
  );
  const foregroundThreshold = Math.round(
    clamp(
      Math.max(2, backgroundLocation + Math.max(1, robustBackgroundSpread * 2.5)),
      2,
      64,
    ),
  );
  return {
    differences,
    backgroundNoise,
    contrastRange,
    foregroundThreshold,
    backgroundSurfaceMode,
  };
}

async function linearPixelEdgeEvidence(
  data: Buffer,
  channels: number,
  width: number,
  height: number,
  borderSize: number,
): Promise<RestrictedEdgeEvidence> {
  const pixelCount = width * height;
  const linearLuma = Buffer.allocUnsafe(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * channels;
    const red = data[offset] ?? 0;
    const green = data[offset + Math.min(1, channels - 1)] ?? red;
    const blue = data[offset + Math.min(2, channels - 1)] ?? red;
    linearLuma[index] = Math.round(clamp(
      0.2126 * red + 0.7152 * green + 0.0722 * blue,
      0,
      255,
    ));
  }
  const smoothed = await sharp(linearLuma, {
    raw: { width, height, channels: 1 },
  })
    .blur(0.8)
    .greyscale()
    .raw()
    .toBuffer();
  const strength = new Float32Array(pixelCount);
  const borderHistogram = new Uint32Array(256);
  let borderCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const topLeft = smoothed[index - width - 1] ?? 0;
      const top = smoothed[index - width] ?? 0;
      const topRight = smoothed[index - width + 1] ?? 0;
      const left = smoothed[index - 1] ?? 0;
      const right = smoothed[index + 1] ?? 0;
      const bottomLeft = smoothed[index + width - 1] ?? 0;
      const bottom = smoothed[index + width] ?? 0;
      const bottomRight = smoothed[index + width + 1] ?? 0;
      const gradientX = -topLeft + topRight - 2 * left + 2 * right - bottomLeft + bottomRight;
      const gradientY = -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      const value = Math.hypot(gradientX, gradientY);
      strength[index] = value;
      if (x < borderSize || x >= width - borderSize || y < borderSize || y >= height - borderSize) {
        const bucket = Math.round(clamp(value, 0, 255));
        borderHistogram[bucket] = (borderHistogram[bucket] ?? 0) + 1;
        borderCount += 1;
      }
    }
  }
  return {
    strength,
    supportThreshold: Math.max(
      12,
      histogramPercentile(borderHistogram, Math.max(1, borderCount), 0.8) * 2,
    ),
  };
}

function bilinearSample(
  field: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const clampedX = clamp(x, 0, width - 1);
  const clampedY = clamp(y, 0, height - 1);
  const left = Math.floor(clampedX);
  const top = Math.floor(clampedY);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const blendX = clampedX - left;
  const blendY = clampedY - top;
  const topValue =
    (field[top * width + left] ?? 0) * (1 - blendX) +
    (field[top * width + right] ?? 0) * blendX;
  const bottomValue =
    (field[bottom * width + left] ?? 0) * (1 - blendX) +
    (field[bottom * width + right] ?? 0) * blendX;
  return topValue * (1 - blendY) + bottomValue * blendY;
}

function refineContourWithRestrictedEdges(
  contour: readonly CardGeometryPoint[],
  edgeStrength: Float32Array,
  width: number,
  height: number,
  searchRadius: number,
): CardGeometryPoint[] {
  if (contour.length < 3 || searchRadius <= 0) return [...contour];
  return contour.map((point, index) => {
    const previous = contour[(index - 2 + contour.length) % contour.length]!;
    const next = contour[(index + 2) % contour.length]!;
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const tangentLength = Math.hypot(tangentX, tangentY);
    if (tangentLength < 1e-6) return { ...point };
    const normalX = -tangentY / tangentLength;
    const normalY = tangentX / tangentLength;
    let bestX = point.x;
    let bestY = point.y;
    let bestScore = bilinearSample(edgeStrength, width, height, point.x, point.y);
    for (let distance = -searchRadius; distance <= searchRadius + 1e-9; distance += 0.25) {
      const candidateX = point.x + normalX * distance;
      const candidateY = point.y + normalY * distance;
      if (candidateX < 1 || candidateX >= width - 1 || candidateY < 1 || candidateY >= height - 1) continue;
      const strength = bilinearSample(edgeStrength, width, height, candidateX, candidateY);
      const score = strength / (1 + Math.abs(distance) * 0.04);
      if (score <= bestScore) continue;
      bestScore = score;
      bestX = candidateX;
      bestY = candidateY;
    }
    return {
      x: round(bestX, 6),
      y: round(bestY, 6),
    };
  });
}

function contractContourToObservedBoundary(
  contour: readonly CardGeometryPoint[],
  edgeStrength: Float32Array,
  supportThreshold: number,
  width: number,
  height: number,
  searchRadius: number,
): CardGeometryPoint[] {
  if (contour.length < 3 || searchRadius <= 0) return [...contour];
  const center = contour.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  center.x /= contour.length;
  center.y /= contour.length;
  const contracted = contour.map((point) => {
    const deltaX = center.x - point.x;
    const deltaY = center.y - point.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length < 1e-6) return { ...point };
    const directionX = deltaX / length;
    const directionY = deltaY / length;
    let best = { ...point };
    let bestScore = bilinearSample(
      edgeStrength,
      width,
      height,
      point.x,
      point.y,
    );
    for (let distance = 0.5; distance <= searchRadius; distance += 0.5) {
      const x = point.x + directionX * distance;
      const y = point.y + directionY * distance;
      if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) break;
      const strength = bilinearSample(edgeStrength, width, height, x, y);
      const score = strength / (1 + distance * 0.005);
      if (strength >= supportThreshold && score > bestScore) {
        best = { x: round(x, 6), y: round(y, 6) };
        bestScore = score;
      }
    }
    return best;
  });
  return contracted;
}

function labelForegroundComponents(mask: Uint8Array, differences: Uint8Array, width: number, height: number): {
  labels: Int32Array;
  components: ComponentStats[];
} {
  const labels = new Int32Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components: ComponentStats[] = [];
  let nextLabel = 0;

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || labels[start] !== 0) continue;
    nextLabel += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = nextLabel;
    const stats: ComponentStats = {
      label: nextLabel,
      count: 0,
      sumX: 0,
      sumY: 0,
      sumXX: 0,
      sumYY: 0,
      sumXY: 0,
      sumDifference: 0,
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      touchesFrame: false,
    };

    while (head < tail) {
      const index = queue[head++] ?? 0;
      const x = index % width;
      const y = Math.floor(index / width);
      stats.count += 1;
      stats.sumX += x;
      stats.sumY += y;
      stats.sumXX += x * x;
      stats.sumYY += y * y;
      stats.sumXY += x * y;
      stats.sumDifference += differences[index] ?? 0;
      stats.minX = Math.min(stats.minX, x);
      stats.maxX = Math.max(stats.maxX, x);
      stats.minY = Math.min(stats.minY, y);
      stats.maxY = Math.max(stats.maxY, y);
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        stats.touchesFrame = true;
      }

      const top = Math.max(0, y - 1);
      const bottom = Math.min(height - 1, y + 1);
      const left = Math.max(0, x - 1);
      const right = Math.min(width - 1, x + 1);
      for (let neighborY = top; neighborY <= bottom; neighborY += 1) {
        for (let neighborX = left; neighborX <= right; neighborX += 1) {
          if (neighborX === x && neighborY === y) continue;
          const neighbor = neighborY * width + neighborX;
          if (mask[neighbor] === 0 || labels[neighbor] !== 0) continue;
          labels[neighbor] = nextLabel;
          queue[tail++] = neighbor;
        }
      }
    }
    components.push(stats);
  }
  return { labels, components };
}

function normalizeRotationDegrees(value: number): number {
  let normalized = value;
  while (normalized <= -90) normalized += 180;
  while (normalized > 90) normalized -= 180;
  return normalized;
}

function placementSkewDegrees(rotationDegrees: number, imageWidth: number, imageHeight: number): number {
  // The Basler raw frame is landscape and is rotated for the portrait operator
  // preview, so its correctly oriented card has a transform rotation near
  // +/-90 degrees. Portrait image inputs expect the short card axis near 0.
  // Keep the full rotation for deskewing, but gate placement on deviation from
  // the orientation expected by the source frame.
  const expectedRotationDegrees = imageWidth > imageHeight ? 90 : 0;
  return expectedRotationDegrees === 90
    ? Math.abs(90 - Math.abs(rotationDegrees))
    : Math.abs(rotationDegrees);
}

function scalePoint(point: CardGeometryPoint, scaleX: number, scaleY: number): CardGeometryPoint {
  return { x: round(point.x * scaleX, 3), y: round(point.y * scaleY, 3) };
}

function scaleDenseContourV1(
  contour: readonly CardGeometryPoint[],
  scaleX: number,
  scaleY: number,
): CardGeometryPoint[] | undefined {
  const scaled: CardGeometryPoint[] = [];
  for (const point of contour) {
    const next = {
      x: round(point.x * scaleX, 6),
      y: round(point.y * scaleY, 6),
    };
    const previous = scaled.at(-1);
    if (previous?.x === next.x && previous.y === next.y) continue;
    scaled.push(next);
  }
  if (
    scaled.length > 1 &&
    scaled[0]!.x === scaled.at(-1)!.x &&
    scaled[0]!.y === scaled.at(-1)!.y
  ) {
    scaled.pop();
  }
  return scaled.length >= 3 ? scaled : undefined;
}

function boundingBoxForCorners(corners: CardGeometryCorners): CardGeometryBoundingBox {
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: round(left, 3),
    y: round(top, 3),
    width: round(Math.max(...xs) - left, 3),
    height: round(Math.max(...ys) - top, 3),
  };
}

function boundingBoxForPoints(
  points: readonly CardGeometryPoint[],
): CardGeometryBoundingBox {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: round(left, 3),
    y: round(top, 3),
    width: round(Math.max(...xs) - left, 3),
    height: round(Math.max(...ys) - top, 3),
  };
}

async function attemptSolidPlateDetection(
  prepared: PreparedImage,
  thresholds: CardGeometryThresholds,
  sensorPlaneCalibration?: CardGeometrySensorPlaneCalibrationV1,
): Promise<DetectionAttempt> {
  const scale = Math.min(1, thresholds.analysisMaxDimension / Math.max(prepared.orientedWidth, prepared.orientedHeight));
  const analysisWidth = Math.max(32, Math.round(prepared.orientedWidth * scale));
  const analysisHeight = Math.max(32, Math.round(prepared.orientedHeight * scale));
  const { data, info } = await sharp(prepared.rawBytes)
    .autoOrient()
    .resize(analysisWidth, analysisHeight, { fit: "fill" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const pixelCount = analysisWidth * analysisHeight;
  const borderRedHistogram = new Uint32Array(256);
  const borderGreenHistogram = new Uint32Array(256);
  const borderBlueHistogram = new Uint32Array(256);
  const borderSize = Math.max(
    2,
    Math.round(Math.min(analysisWidth, analysisHeight) * 0.006),
  );
  let borderCount = 0;
  for (let y = 0; y < analysisHeight; y += 1) {
    for (let x = 0; x < analysisWidth; x += 1) {
      if (x >= borderSize && x < analysisWidth - borderSize && y >= borderSize && y < analysisHeight - borderSize) continue;
      const offset = (y * analysisWidth + x) * channels;
      const red = data[offset] ?? 0;
      const green = data[offset + Math.min(1, channels - 1)] ?? red;
      const blue = data[offset + Math.min(2, channels - 1)] ?? red;
      borderRedHistogram[red] = (borderRedHistogram[red] ?? 0) + 1;
      borderGreenHistogram[green] = (borderGreenHistogram[green] ?? 0) + 1;
      borderBlueHistogram[blue] = (borderBlueHistogram[blue] ?? 0) + 1;
      borderCount += 1;
    }
  }
  const backgroundColor = {
    r: medianFromHistogram(borderRedHistogram, borderCount),
    g: medianFromHistogram(borderGreenHistogram, borderCount),
    b: medianFromHistogram(borderBlueHistogram, borderCount),
  };
  const backgroundLuma = Math.round(0.2126 * backgroundColor.r + 0.7152 * backgroundColor.g + 0.0722 * backgroundColor.b);
  const regionObservationData = await sharp(data, {
    raw: { width: analysisWidth, height: analysisHeight, channels },
  })
    .blur(Math.max(2, Math.min(8, Math.min(analysisWidth, analysisHeight) * 0.006)))
    .raw()
    .toBuffer();
  const regionEvidence = locallyModeledRegionEvidence(
    regionObservationData,
    data,
    channels,
    analysisWidth,
    analysisHeight,
    borderSize,
  );
  const diagnosticsWithoutRegion: CardGeometryDetectionDiagnostics = {
    method: "solid_plate_color_component_pca_v2",
    backgroundLuma,
    backgroundColor,
    backgroundNoise: 0,
    contrastRange: 0,
    foregroundThreshold: 0,
    foregroundPixelFraction: 0,
    expectedAspectRatio: thresholds.expectedAspectRatio,
    analysisWidth,
    analysisHeight,
  };
  if (!regionEvidence) {
    return {
      diagnostics: diagnosticsWithoutRegion,
      reason: "The visible exterior background could not support a local illumination model.",
    };
  }
  const edgeEvidence = await linearPixelEdgeEvidence(
    data,
    channels,
    analysisWidth,
    analysisHeight,
    borderSize,
  );
  const differences = regionEvidence.differences;
  const backgroundNoise = regionEvidence.backgroundNoise;
  const contrastRange = regionEvidence.contrastRange;
  const foregroundThreshold = regionEvidence.foregroundThreshold;
  const morphologyRadius = Math.round(
    clamp(Math.round(Math.min(analysisWidth, analysisHeight) * 0.0025), 1, 4),
  );
  const diagnosticsBase: CardGeometryDetectionDiagnostics = {
    method: "solid_plate_color_component_pca_v2",
    backgroundLuma,
    backgroundColor,
    backgroundNoise,
    contrastRange,
    foregroundThreshold,
    foregroundPixelFraction: 0,
    morphologyRadius,
    expectedAspectRatio: thresholds.expectedAspectRatio,
    analysisWidth,
    analysisHeight,
  };
  if (contrastRange < foregroundThreshold) {
    return { diagnostics: diagnosticsBase, reason: "Image contrast is too low to distinguish the card from the solid base plate." };
  }

  // Region ownership begins with high-confidence material pixels. The lower
  // foreground threshold remains useful for diagnostics, but it can include
  // weak illumination/glare paths that join a real object to the camera frame.
  // A stronger, image-derived threshold prevents those weak paths from
  // nominating an object while preserving dark-card evidence.
  const strongForegroundThreshold = Math.round(clamp(
    Math.max(
      foregroundThreshold + 1,
      foregroundThreshold +
        Math.max(1, (contrastRange - foregroundThreshold) * 0.3),
    ),
    foregroundThreshold + 1,
    255,
  ));
  const strongRegionMask = new Uint8Array(pixelCount);
  for (let index = 0; index < differences.length; index += 1) {
    if ((differences[index] ?? 0) >= strongForegroundThreshold) {
      strongRegionMask[index] = 1;
    }
  }
  // The source frame is never altered. Label the naturally observed pixels
  // first, then make every component connected to the camera frame background.
  // This is intentionally different from erasing the outer row, which can turn
  // a frame-connected environmental network into a false enclosed object.
  const strongRegion = labelForegroundComponents(
    strongRegionMask,
    differences,
    analysisWidth,
    analysisHeight,
  );
  const frameSeparatedStrongRegionMask = new Uint8Array(pixelCount);
  const frameConnectedStrongLabels = new Set(
    strongRegion.components
      .filter((entry) => entry.touchesFrame)
      .map((entry) => entry.label),
  );
  for (let index = 0; index < pixelCount; index += 1) {
    const label = strongRegion.labels[index] ?? 0;
    if (label !== 0 && !frameConnectedStrongLabels.has(label)) {
      frameSeparatedStrongRegionMask[index] = 1;
    }
  }
  const strongCoreMask = openForegroundMask(
    frameSeparatedStrongRegionMask,
    analysisWidth,
    analysisHeight,
    morphologyRadius,
  );
  const weakRegionMask = new Uint8Array(pixelCount);
  for (let index = 0; index < differences.length; index += 1) {
    if ((differences[index] ?? 0) >= foregroundThreshold) {
      weakRegionMask[index] = 1;
    }
  }
  // Region evidence alone decides ownership. Local edges are deliberately not
  // admitted until after one naturally enclosed, strong-core-bearing region
  // has been selected; therefore an environmental edge network cannot turn
  // itself into foreground or join an owned core to the frame.
  const regionOwnershipMask = closeForegroundMask(
    openForegroundMask(
      weakRegionMask,
      analysisWidth,
      analysisHeight,
      morphologyRadius,
    ),
    analysisWidth,
    analysisHeight,
    morphologyRadius,
  );
  let foregroundCount = 0;
  for (const value of regionOwnershipMask) foregroundCount += value;
  diagnosticsBase.foregroundPixelFraction = round(foregroundCount / Math.max(1, pixelCount), 6);
  const labeledRegion = labelForegroundComponents(
    regionOwnershipMask,
    differences,
    analysisWidth,
    analysisHeight,
  );
  // Absolute speck rejection only. Candidate admission must not assume the
  // expected product coverage, aspect ratio, rectangular fill, or corner type.
  // A material region must be enclosed by observable exterior background;
  // frame-connected candidates can never authorize capture.
  const minimumComponentPixels = 64;
  const coreEvidenceByLabel = new Float64Array(labeledRegion.components.length + 1);
  const corePixelsByLabel = new Uint32Array(labeledRegion.components.length + 1);
  for (let index = 0; index < pixelCount; index += 1) {
    if (strongCoreMask[index] === 0) continue;
    const label = labeledRegion.labels[index] ?? 0;
    if (label === 0) continue;
    coreEvidenceByLabel[label] =
      (coreEvidenceByLabel[label] ?? 0) +
      Math.max(1, (differences[index] ?? 0) - strongForegroundThreshold + 1);
    corePixelsByLabel[label] = (corePixelsByLabel[label] ?? 0) + 1;
  }
  const componentScore = (entry: ComponentStats) =>
    coreEvidenceByLabel[entry.label] ?? 0;
  const seedComponent = labeledRegion.components
    .filter((entry) =>
      entry.count >= minimumComponentPixels &&
      (corePixelsByLabel[entry.label] ?? 0) >= minimumComponentPixels &&
      !entry.touchesFrame &&
      entry.minX >= 1 &&
      entry.minY >= 1 &&
      entry.maxX <= analysisWidth - 2 &&
      entry.maxY <= analysisHeight - 2
    )
    .sort((left, right) =>
      componentScore(right) - componentScore(left) ||
      (corePixelsByLabel[right.label] ?? 0) -
        (corePixelsByLabel[left.label] ?? 0)
    )[0];
  if (!seedComponent) {
    return {
      diagnostics: diagnosticsBase,
      reason: "No enclosed material region separated from the camera frame was found.",
    };
  }
  const selectedSeedMask = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    if (labeledRegion.labels[index] === seedComponent.label) selectedSeedMask[index] = 1;
  }
  const edgeRefinedSeedMask = supportOwnedRegionBoundary(
    selectedSeedMask,
    edgeEvidence.strength,
    edgeEvidence.supportThreshold,
    analysisWidth,
    analysisHeight,
  );
  const filledComponentMask = fillForegroundHoles(
    closeForegroundMask(
      edgeRefinedSeedMask,
      analysisWidth,
      analysisHeight,
      morphologyRadius,
    ),
    analysisWidth,
    analysisHeight,
  );
  const selectedComponentMask = openForegroundMask(
    filledComponentMask,
    analysisWidth,
    analysisHeight,
    Math.max(
      morphologyRadius,
      Math.round(Math.min(analysisWidth, analysisHeight) * 0.006),
    ),
  );
  const selectedRegion = labelForegroundComponents(
    selectedComponentMask,
    differences,
    analysisWidth,
    analysisHeight,
  );
  const selectedCoreEvidenceByLabel = new Float64Array(
    selectedRegion.components.length + 1,
  );
  for (let index = 0; index < pixelCount; index += 1) {
    if (strongCoreMask[index] === 0) continue;
    const label = selectedRegion.labels[index] ?? 0;
    if (label === 0) continue;
    selectedCoreEvidenceByLabel[label] =
      (selectedCoreEvidenceByLabel[label] ?? 0) +
      Math.max(1, (differences[index] ?? 0) - strongForegroundThreshold + 1);
  }
  const component = selectedRegion.components
    .filter((entry) => !entry.touchesFrame)
    .sort((left, right) =>
      (selectedCoreEvidenceByLabel[right.label] ?? 0) -
      (selectedCoreEvidenceByLabel[left.label] ?? 0)
    )[0];
  const labels = selectedRegion.labels;
  if (!component || component.touchesFrame) {
    return {
      diagnostics: diagnosticsBase,
      reason: "The observed material region is not fully separated from the camera frame.",
    };
  }

  const meanX = component.sumX / component.count;
  const meanY = component.sumY / component.count;
  const covarianceXX = component.sumXX / component.count - meanX * meanX;
  const covarianceYY = component.sumYY / component.count - meanY * meanY;
  const covarianceXY = component.sumXY / component.count - meanX * meanY;
  const covarianceTrace = covarianceXX + covarianceYY;
  const covarianceDiscriminant = Math.hypot(
    covarianceXX - covarianceYY,
    2 * covarianceXY,
  );
  const isotropicObservedRegion =
    covarianceTrace > 0 &&
    covarianceDiscriminant / covarianceTrace < 0.05;
  const principalAngle =
    isotropicObservedRegion
      ? Math.PI / 2
      : 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
  let longAxis = { x: Math.cos(principalAngle), y: Math.sin(principalAngle) };
  if (longAxis.y < 0 || (Math.abs(longAxis.y) < 1e-8 && longAxis.x < 0)) {
    longAxis = { x: -longAxis.x, y: -longAxis.y };
  }
  const shortAxis = { x: longAxis.y, y: -longAxis.x };
  let minShort = Number.POSITIVE_INFINITY;
  let maxShort = Number.NEGATIVE_INFINITY;
  let minLong = Number.POSITIVE_INFINITY;
  let maxLong = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] !== component.label) continue;
    const x = index % analysisWidth;
    const y = Math.floor(index / analysisWidth);
    const dx = x - meanX;
    const dy = y - meanY;
    const projectedShort = dx * shortAxis.x + dy * shortAxis.y;
    const projectedLong = dx * longAxis.x + dy * longAxis.y;
    minShort = Math.min(minShort, projectedShort);
    maxShort = Math.max(maxShort, projectedShort);
    minLong = Math.min(minLong, projectedLong);
    maxLong = Math.max(maxLong, projectedLong);
  }
  const shortSide = maxShort - minShort + 1;
  const longSide = maxLong - minLong + 1;
  if (!Number.isFinite(shortSide) || !Number.isFinite(longSide) || shortSide < 8 || longSide < 8) {
    return { diagnostics: diagnosticsBase, reason: "The detected component does not form a usable physical material extent." };
  }

  const scaleX = prepared.orientedWidth / analysisWidth;
  const scaleY = prepared.orientedHeight / analysisHeight;
  const measuredAspectRatio = longSide / shortSide;
  const relativeAspectError = Math.abs(measuredAspectRatio - thresholds.expectedAspectRatio) / thresholds.expectedAspectRatio;
  const projectedArea = shortSide * longSide;
  const componentFill = component.count / Math.max(1, projectedArea);
  const cardCoverage = projectedArea / Math.max(1, analysisWidth * analysisHeight);
  const scalarField = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    scalarField[index] = selectedComponentMask[index] ?? 0;
  }
  const traced = traceFixedRigDenseContourV1({
    width: analysisWidth,
    height: analysisHeight,
    field: scalarField,
    mask: selectedComponentMask,
    threshold: 0.5,
  });
  const contractedAnalysisContour = traced &&
    regionEvidence.backgroundSurfaceMode === "modeled"
      ? contractContourToObservedBoundary(
          traced.contour,
          edgeEvidence.strength,
          edgeEvidence.supportThreshold,
          analysisWidth,
          analysisHeight,
          Math.round(Math.min(analysisWidth, analysisHeight) * 0.12),
        )
      : traced?.contour;
  const refinedAnalysisContour = contractedAnalysisContour
    ? refineContourWithRestrictedEdges(
        contractedAnalysisContour,
        edgeEvidence.strength,
        analysisWidth,
        analysisHeight,
        Math.min(
          16,
          Math.max(
            morphologyRadius + 1,
            Math.round(Math.min(analysisWidth, analysisHeight) * 0.012),
          ),
        ),
      )
    : undefined;
  const frameContourPointCount = refinedAnalysisContour?.reduce(
    (count, point) =>
      count + (
        point.x <= 1 ||
        point.x >= analysisWidth - 2 ||
        point.y <= 1 ||
        point.y >= analysisHeight - 2
          ? 1
          : 0
      ),
    0,
  ) ?? 0;
  if (
    !refinedAnalysisContour ||
    frameContourPointCount > 0
  ) {
    return {
      diagnostics: diagnosticsBase,
      reason: refinedAnalysisContour
        ? "The observed material contour reaches the camera frame and is not fully visible."
        : "The observed pixels did not form a genuinely closed material boundary.",
    };
  }
  const scaledContour = refinedAnalysisContour
    ? scaleDenseContourV1(refinedAnalysisContour, scaleX, scaleY)
    : undefined;
  const measuredContour = scaledContour
    ? measureFixedRigDenseContourV1({
        contour: scaledContour,
        pixelsPerMmX: 1,
        pixelsPerMmY: 1,
      })
    : undefined;
  const effectiveMmPerPixelX = sensorPlaneCalibration
    ? sensorPlaneCalibration.mmPerPixelX *
      (sensorPlaneCalibration.sourceWidthPx / prepared.orientedWidth)
    : undefined;
  const effectiveMmPerPixelY = sensorPlaneCalibration
    ? sensorPlaneCalibration.mmPerPixelY *
      (sensorPlaneCalibration.sourceHeightPx / prepared.orientedHeight)
    : undefined;
  const measuredPhysicalContour =
    scaledContour &&
    effectiveMmPerPixelX &&
    effectiveMmPerPixelY
      ? measureFixedRigDenseContourV1({
          contour: scaledContour,
          pixelsPerMmX: 1 / effectiveMmPerPixelX,
          pixelsPerMmY: 1 / effectiveMmPerPixelY,
        })
      : undefined;
  const strongSupportCount = refinedAnalysisContour?.reduce((count, point) =>
    count +
    (bilinearSample(
      edgeEvidence.strength,
      analysisWidth,
      analysisHeight,
      point.x,
      point.y,
    ) >= edgeEvidence.supportThreshold ? 1 : 0), 0) ?? 0;
  const strongSupportFraction = refinedAnalysisContour?.length
    ? strongSupportCount / refinedAnalysisContour.length
    : 0;
  const observedDenseContour: CardGeometryObservedDenseContourV1 | undefined =
    scaledContour && measuredContour && strongSupportCount > 0
      ? (() => {
          const contourSha256 = createHash("sha256")
            .update(JSON.stringify({
              sourceAssetSha256: prepared.rawArtifact.sha256,
              coordinateFrame: "source_image_pixels",
              points: scaledContour,
            }), "utf8")
            .digest("hex");
          const physicalMeasurementPayload =
            sensorPlaneCalibration &&
            measuredPhysicalContour &&
            effectiveMmPerPixelX &&
            effectiveMmPerPixelY
              ? {
                  calibration: {
                    profileId: sensorPlaneCalibration.profileId,
                    calibrationVersion: sensorPlaneCalibration.calibrationVersion,
                    calibrationArtifactSha256:
                      sensorPlaneCalibration.calibrationArtifactSha256,
                    bundleManifestSha256:
                      sensorPlaneCalibration.bundleManifestSha256,
                    sourceWidthPx: sensorPlaneCalibration.sourceWidthPx,
                    sourceHeightPx: sensorPlaneCalibration.sourceHeightPx,
                    effectiveMmPerPixelX: round(effectiveMmPerPixelX, 9),
                    effectiveMmPerPixelY: round(effectiveMmPerPixelY, 9),
                  },
                  width: round(measuredPhysicalContour.orientedBounds.widthMm, 4),
                  height: round(measuredPhysicalContour.orientedBounds.heightMm, 4),
                  perimeter: round(measuredPhysicalContour.contourPerimeterMm, 4),
                  enclosedArea: round(measuredPhysicalContour.enclosedAreaMm2, 4),
                  angleDegrees:
                    measuredPhysicalContour.orientedBounds.angleDegrees,
                  circularArcs: measuredPhysicalContour.circularArcs.map((arc) => ({
                    radiusMm: round(arc.radiusMm, 4),
                    sweepDegrees: arc.sweepDegrees,
                    radialResidualMm: round(arc.radialResidualMm, 4),
                    sampleCount: arc.sampleCount,
                  })),
                  privateUncertaintyU95: {
                    widthMm: round(Math.hypot(
                      measuredPhysicalContour.orientedBounds.widthMm *
                        sensorPlaneCalibration.scaleRelativeU95,
                      sensorPlaneCalibration.segmentationBoundaryU95Px *
                        effectiveMmPerPixelX,
                      sensorPlaneCalibration.linearMeasurementU95Mm,
                    ), 4),
                    heightMm: round(Math.hypot(
                      measuredPhysicalContour.orientedBounds.heightMm *
                        sensorPlaneCalibration.scaleRelativeU95,
                      sensorPlaneCalibration.segmentationBoundaryU95Px *
                        effectiveMmPerPixelY,
                      sensorPlaneCalibration.linearMeasurementU95Mm,
                    ), 4),
                    radiusMm: round(Math.hypot(
                      (measuredPhysicalContour.circularArcs[0]?.radiusMm ?? 0) *
                        sensorPlaneCalibration.scaleRelativeU95,
                      sensorPlaneCalibration.segmentationBoundaryU95Px *
                        Math.max(effectiveMmPerPixelX, effectiveMmPerPixelY),
                      sensorPlaneCalibration.linearMeasurementU95Mm,
                    ), 4),
                    basis:
                      "calibrated_scale_boundary_and_repeatability_rss" as const,
                  },
                }
              : undefined;
          return {
          schemaVersion: "ten-kings-card-geometry-observed-dense-contour-v1",
          coordinateFrame: "source_image_pixels",
          sourceAssetSha256: prepared.rawArtifact.sha256,
          points: scaledContour,
          pointCount: scaledContour.length,
          contourSha256,
          strongSupportFraction: round(strongSupportFraction, 5),
          evidenceQuality: strongSupportFraction >= 0.65 ? "strong" : "limited",
          measurementsPx: {
            width: round(measuredContour.orientedBounds.widthMm, 3),
            height: round(measuredContour.orientedBounds.heightMm, 3),
            perimeter: round(measuredContour.contourPerimeterMm, 3),
            enclosedArea: round(measuredContour.enclosedAreaMm2, 3),
            angleDegrees: measuredContour.orientedBounds.angleDegrees,
            circularArcs: measuredContour.circularArcs.map((arc) => ({
              radiusPx: round(arc.radiusMm, 3),
              sweepDegrees: arc.sweepDegrees,
              radialResidualPx: round(arc.radialResidualMm, 3),
              sampleCount: arc.sampleCount,
            })),
          },
          ...(physicalMeasurementPayload
            ? {
                measurementsMm: {
                  ...physicalMeasurementPayload,
                  measurementAuthoritySha256: createHash("sha256")
                    .update(JSON.stringify({
                      contourSha256,
                      ...physicalMeasurementPayload,
                    }), "utf8")
                    .digest("hex"),
                },
              }
            : {}),
        };
        })()
      : undefined;
  const observedMaterialFill = observedDenseContour
    ? observedDenseContour.measurementsPx.enclosedArea /
      Math.max(
        1,
        observedDenseContour.measurementsPx.width *
          observedDenseContour.measurementsPx.height,
      )
    : 0;
  if (
    (observedDenseContour && observedMaterialFill < 0.05) ||
    !observedDenseContour
  ) {
    return {
      diagnostics: {
        ...diagnosticsBase,
        componentPixelFraction: round(component.count / Math.max(1, pixelCount), 6),
        rectangularFill: round(componentFill, 5),
        measuredAspectRatio: round(measuredAspectRatio, 5),
        relativeAspectError: round(relativeAspectError, 5),
      },
      reason: "No locally supported material boundary was observed against the base plate.",
    };
  }
  const meanDifference = seedComponent.sumDifference / seedComponent.count;
  const contrastScore = clamp((meanDifference - foregroundThreshold * 0.8) / Math.max(4, foregroundThreshold * 1.5), 0, 1);
  const contourBounds = measuredContour!.orientedBounds;
  const contourCorners: CardGeometryCorners = isotropicObservedRegion
    ? {
        topLeft: {
          x: contourBounds.center.x - contourBounds.widthMm / 2,
          y: contourBounds.center.y - contourBounds.heightMm / 2,
        },
        topRight: {
          x: contourBounds.center.x + contourBounds.widthMm / 2,
          y: contourBounds.center.y - contourBounds.heightMm / 2,
        },
        bottomRight: {
          x: contourBounds.center.x + contourBounds.widthMm / 2,
          y: contourBounds.center.y + contourBounds.heightMm / 2,
        },
        bottomLeft: {
          x: contourBounds.center.x - contourBounds.widthMm / 2,
          y: contourBounds.center.y + contourBounds.heightMm / 2,
        },
      }
    : {
        topLeft: contourBounds.cornersMm[0],
        topRight: contourBounds.cornersMm[1],
        bottomRight: contourBounds.cornersMm[2],
        bottomLeft: contourBounds.cornersMm[3],
      };
  const contourShortSide = contourBounds.widthMm;
  const contourLongSide = contourBounds.heightMm;
  const contourCoverage =
    contourShortSide * contourLongSide /
    Math.max(1, prepared.orientedWidth * prepared.orientedHeight);
  const contourAspectRatio =
    contourLongSide / Math.max(1e-6, contourShortSide);
  const contourRelativeAspectError =
    Math.abs(contourAspectRatio - thresholds.expectedAspectRatio) /
    thresholds.expectedAspectRatio;
  const coverageScore =
    contourCoverage < thresholds.minCardCoverage
      ? clamp(contourCoverage / thresholds.minCardCoverage, 0, 1)
      : contourCoverage > thresholds.maxCardCoverage
        ? clamp((1 - contourCoverage) / Math.max(0.01, 1 - thresholds.maxCardCoverage), 0, 1)
        : 1;
  const contourScore = observedDenseContour
    ? clamp(0.45 + observedDenseContour.strongSupportFraction * 0.55, 0, 1)
    : 0;
  const confidence = round(0.55 * contourScore + 0.3 * contrastScore + 0.15 * coverageScore, 4);
  const rotationDegrees = round(normalizeRotationDegrees(
    isotropicObservedRegion ? 0 : contourBounds.angleDegrees,
  ), 3);
  const diagnostics: CardGeometryDetectionDiagnostics = {
    ...diagnosticsBase,
    componentPixelFraction: round(component.count / Math.max(1, pixelCount), 6),
    rectangularFill: round(componentFill, 5),
    measuredAspectRatio: round(measuredAspectRatio, 5),
    relativeAspectError: round(relativeAspectError, 5),
  };
  return {
    diagnostics,
    candidate: {
      corners: contourCorners,
      boundingBox: boundingBoxForCorners(contourCorners),
      rotationDegrees,
      confidence,
      shortSidePixels: contourShortSide,
      longSidePixels: contourLongSide,
      cardCoverage: contourCoverage,
      measuredAspectRatio: contourAspectRatio,
      relativeAspectError: contourRelativeAspectError,
      diagnostics,
      ...(observedDenseContour ? { observedDenseContour } : {}),
    },
  };
}


async function attemptDetection(
  prepared: PreparedImage,
  thresholds: CardGeometryThresholds,
  detectionPolicy: AiGraderCardGeometryDetectionPolicy,
  observer: DetectCardGeometryInput["onDetectionAttempt"],
  sensorPlaneCalibration?: CardGeometrySensorPlaneCalibrationV1,
): Promise<DetectionAttempt> {
  const solidPlateStartedAt = performance.now();
  const solidPlate = await attemptSolidPlateDetection(
    prepared,
    thresholds,
    sensorPlaneCalibration,
  );
  reportDetectionAttempt(observer, {
    detectionPolicy,
    method: "solid_plate_color_component_pca_v2",
    outcome: solidPlate.candidate ? "candidate" : "no_candidate",
  }, solidPlateStartedAt);
  // A dense pixel-derived material boundary is the geometry authority. Product
  // aspect, rectangular coverage, and the legacy four-side fit are comparison
  // diagnostics only and may never replace an observed arbitrary shape.
  if (solidPlate.candidate?.observedDenseContour) {
    return solidPlate;
  }
  return {
    diagnostics: solidPlate.diagnostics,
    reason:
      solidPlate.reason ??
      "No dense pixel-derived physical boundary was observed in the captured frame.",
  };
}

function placementEvaluation(input: {
  corners: CardGeometryCorners;
  boundingBox: CardGeometryBoundingBox;
  shortSidePixels: number;
  longSidePixels: number;
  skewDegrees: number;
  confidence: number;
  relativeAspectError: number;
  cardCoverage: number;
  imageWidth: number;
  imageHeight: number;
  thresholds: CardGeometryThresholds;
  observedDenseContour?: CardGeometryObservedDenseContourV1;
}): CardGeometryPlacementEvaluation {
  const points = [input.corners.topLeft, input.corners.topRight, input.corners.bottomRight, input.corners.bottomLeft];
  const cardCenterX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cardCenterY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const offsetX = cardCenterX - input.imageWidth / 2;
  const offsetY = cardCenterY - input.imageHeight / 2;
  const pixelsPerInch =
    (input.shortSidePixels / STANDARD_CARD_WIDTH_INCHES + input.longSidePixels / STANDARD_CARD_HEIGHT_INCHES) / 2;
  const inchX = offsetX / Math.max(1, pixelsPerInch);
  const inchY = offsetY / Math.max(1, pixelsPerInch);
  const edgeClearance = input.observedDenseContour
    ? 1
    : Math.min(input.imageWidth, input.imageHeight) *
      input.thresholds.minEdgeClearanceRatio;
  const observedBounds = input.observedDenseContour
    ? boundingBoxForPoints(input.observedDenseContour.points)
    : input.boundingBox;
  const withinFrame =
    observedBounds.x >= edgeClearance &&
    observedBounds.y >= edgeClearance &&
    observedBounds.x + observedBounds.width <=
      input.imageWidth - edgeClearance &&
    observedBounds.y + observedBounds.height <=
      input.imageHeight - edgeClearance;
  return {
    centerOffsetPixels: {
      x: round(offsetX, 3),
      y: round(offsetY, 3),
      distance: round(Math.hypot(offsetX, offsetY), 3),
      maxAxis: round(Math.max(Math.abs(offsetX), Math.abs(offsetY)), 3),
    },
    centerOffsetInches: {
      x: round(inchX, 4),
      y: round(inchY, 4),
      distance: round(Math.hypot(inchX, inchY), 4),
      maxAxis: round(Math.max(Math.abs(inchX), Math.abs(inchY)), 4),
    },
    estimatedPixelsPerInch: round(pixelsPerInch, 4),
    maxCenterOffsetInches: input.thresholds.maxCenterOffsetInches,
    maxSkewDegrees: input.thresholds.maxSkewDegrees,
    maxNormalizationSkewDegrees: input.thresholds.maxNormalizationSkewDegrees,
    minReadyConfidence: input.thresholds.minReadyConfidence,
    withinCenterTolerance: Math.max(Math.abs(inchX), Math.abs(inchY)) <= input.thresholds.maxCenterOffsetInches,
    withinSkewTolerance:
      Math.abs(input.skewDegrees) <= input.thresholds.maxSkewDegrees + SKEW_ESTIMATION_EPSILON_DEGREES,
    withinNormalizationSkewTolerance:
      Math.abs(input.skewDegrees) <= input.thresholds.maxNormalizationSkewDegrees + SKEW_ESTIMATION_EPSILON_DEGREES,
    withinAspectTolerance: input.relativeAspectError <= input.thresholds.maxRelativeAspectError,
    withinCoverageTolerance:
      input.cardCoverage >= input.thresholds.minCardCoverage && input.cardCoverage <= input.thresholds.maxCardCoverage,
    withinFrame,
    confidenceReady: input.confidence >= input.thresholds.minReadyConfidence,
    cardCoverage: round(input.cardCoverage, 6),
  };
}

function emptyPlacement(thresholds: CardGeometryThresholds): CardGeometryPlacementEvaluation {
  return {
    maxCenterOffsetInches: thresholds.maxCenterOffsetInches,
    maxSkewDegrees: thresholds.maxSkewDegrees,
    maxNormalizationSkewDegrees: thresholds.maxNormalizationSkewDegrees,
    minReadyConfidence: thresholds.minReadyConfidence,
    withinCenterTolerance: false,
    withinSkewTolerance: false,
    withinNormalizationSkewTolerance: false,
    withinAspectTolerance: false,
    withinCoverageTolerance: false,
    withinFrame: false,
    confidenceReady: false,
  };
}

function placementState(
  placement: CardGeometryPlacementEvaluation,
  hasObservedDenseContour: boolean,
): CardPlacementState {
  return placement.withinFrame &&
    placement.withinNormalizationSkewTolerance &&
    hasObservedDenseContour
    ? "ready"
    : "adjust_card";
}

function placementAdjustmentReason(
  placement: CardGeometryPlacementEvaluation,
  hasObservedDenseContour: boolean,
): CardGeometryAdjustmentReason | null {
  if (!placement.withinFrame) return "outside_frame";
  if (!placement.withinNormalizationSkewTolerance) return "rotate_top_up";
  if (!hasObservedDenseContour && !placement.withinCoverageTolerance) return "unsafe_scale";
  if (!hasObservedDenseContour && !placement.confidenceReady) return "low_confidence";
  return null;
}

function placementWarnings(placement: CardGeometryPlacementEvaluation, _source: CardGeometrySource): string[] {
  const warnings: string[] = [];
  if (!placement.withinCenterTolerance) {
    warnings.push("Card is off center, but center offset is diagnostic only when detected geometry can be normalized safely.");
  }
  if (!placement.withinSkewTolerance) {
    warnings.push("Card rotation exceeds the preferred placement guide; automatic normalization remains allowed only inside the hard rotation envelope.");
  }
  if (!placement.withinNormalizationSkewTolerance) {
    warnings.push("Card rotation is outside the safe automatic-normalization envelope; rotate the printed top toward the top of the preview.");
  }
  if (!placement.withinAspectTolerance) {
    warnings.push("Observed material shape differs from the comparison profile; the observed contour remains authoritative.");
  }
  if (!placement.withinCoverageTolerance) warnings.push("Detected card coverage is outside the safe normalization range.");
  if (!placement.withinFrame) warnings.push("Card is too close to an image edge for safe normalization.");
  if (!placement.confidenceReady) warnings.push("Card detection confidence is below the Ready threshold.");
  return warnings;
}

async function buildGeometry(input: DetectCardGeometryInput, prepared: PreparedImage): Promise<CardGeometryMetadata> {
  const detectionPolicy = requireDetectionPolicy(input.detectionPolicy);
  if (
    input.sensorPlaneCalibration &&
    !verifyCardGeometrySensorPlaneCalibrationV1(
      input.sensorPlaneCalibration,
    )
  ) {
    throw new Error(
      "sensorPlaneCalibration must be one exact calibrated Basler sensor-plane binding.",
    );
  }
  const thresholds = normalizeThresholds(input.thresholds);
  const timestamp = normalizeTimestamp(input.timestamp);

  const detection = await attemptDetection(
    prepared,
    thresholds,
    detectionPolicy,
    input.onDetectionAttempt,
    input.sensorPlaneCalibration,
  );

  const candidate = detection.candidate;
  if (
    !candidate ||
    !candidate.observedDenseContour
  ) {
    return {
      version: CARD_GEOMETRY_VERSION,
      detectionPolicy,
      side: input.side,
      placementState: "not_detected",
      adjustmentReason: "not_detected",
      geometrySource: "none",
      captureMode: "none",
      confidenceBasis: "none",
      detectionUsed: false,
      manualOverrideUsed: false,
      corners: null,
      detectedCorners: null,
      boundingBox: null,
      rotationDegrees: null,
      skewDegrees: null,
      confidence: candidate?.confidence ?? 0,
      ...(sanitizeSourceId(input.sourceImageId) ? { sourceImageId: sanitizeSourceId(input.sourceImageId) } : {}),
      ...(sanitizeSourceId(input.sourceFrameId) ? { sourceFrameId: sanitizeSourceId(input.sourceFrameId) } : {}),
      timestamp,
      image: { width: prepared.orientedWidth, height: prepared.orientedHeight, coordinateFrame: "source_image_pixels" },
      semanticOrientation: {
        canonicalOrientation: "portrait",
        basis: "operator_top_toward_preview_top",
        contentUprightVerified: false,
      },
      placement: emptyPlacement(thresholds),
      detection: detection.diagnostics,
      warnings: [
        detection.reason ??
          "No dense pixel-derived physical card boundary was detected.",
      ],
    };
  }

  const placement = placementEvaluation({
    corners: candidate.corners,
    boundingBox: candidate.boundingBox,
    shortSidePixels: candidate.shortSidePixels,
    longSidePixels: candidate.longSidePixels,
    skewDegrees: placementSkewDegrees(candidate.rotationDegrees, prepared.orientedWidth, prepared.orientedHeight),
    confidence: candidate.confidence,
    relativeAspectError: candidate.relativeAspectError,
    cardCoverage: candidate.cardCoverage,
    imageWidth: prepared.orientedWidth,
    imageHeight: prepared.orientedHeight,
    thresholds,
    observedDenseContour: candidate.observedDenseContour,
  });
  const hasObservedDenseContour = Boolean(candidate.observedDenseContour);
  return {
    version: CARD_GEOMETRY_VERSION,
    detectionPolicy,
    side: input.side,
    placementState: placementState(placement, hasObservedDenseContour),
    adjustmentReason: placementAdjustmentReason(
      placement,
      hasObservedDenseContour,
    ),
    geometrySource: "detected",
    captureMode: "automatic_detection",
    confidenceBasis: "automatic_detection",
    detectionUsed: true,
    manualOverrideUsed: false,
    corners: candidate.corners,
    detectedCorners: candidate.corners,
    ...(candidate.observedDenseContour
      ? { observedDenseContour: candidate.observedDenseContour }
      : {}),
    boundingBox: candidate.boundingBox,
    rotationDegrees: candidate.rotationDegrees,
    skewDegrees: round(
      placementSkewDegrees(candidate.rotationDegrees, prepared.orientedWidth, prepared.orientedHeight),
      3,
    ),
    confidence: candidate.confidence,
    ...(sanitizeSourceId(input.sourceImageId) ? { sourceImageId: sanitizeSourceId(input.sourceImageId) } : {}),
    ...(sanitizeSourceId(input.sourceFrameId) ? { sourceFrameId: sanitizeSourceId(input.sourceFrameId) } : {}),
    timestamp,
    image: { width: prepared.orientedWidth, height: prepared.orientedHeight, coordinateFrame: "source_image_pixels" },
    semanticOrientation: {
      canonicalOrientation: "portrait",
      basis: "operator_top_toward_preview_top",
      contentUprightVerified: false,
    },
    placement,
    detection: candidate.diagnostics,
    warnings: placementWarnings(placement, "detected"),
  };
}

export async function detectCardGeometry(input: DetectCardGeometryInput): Promise<CardGeometryMetadata> {
  requireDetectionPolicy(input.detectionPolicy);
  const prepared = await prepareImage(input.sourceImagePath);
  return buildGeometry(input, prepared);
}

export async function detectCardGeometryFromBuffer(input: DetectCardGeometryBufferInput): Promise<CardGeometryMetadata> {
  requireDetectionPolicy(input.detectionPolicy);
  if (!Buffer.isBuffer(input.imageBuffer) || input.imageBuffer.length < 1) {
    throw new Error("imageBuffer must contain an encoded image.");
  }
  const prepared = await prepareImageBytes(input.imageBuffer, path.basename(input.fileName ?? "preview-frame.jpg"));
  return buildGeometry({ ...input, sourceImagePath: input.fileName ?? "preview-frame.jpg" }, prepared);
}

function transformPointForRotation(
  point: CardGeometryPoint,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  clockwiseDegrees: number,
): CardGeometryPoint {
  const radians = (clockwiseDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.x - sourceWidth / 2;
  const dy = point.y - sourceHeight / 2;
  return {
    x: outputWidth / 2 + cosine * dx - sine * dy,
    y: outputHeight / 2 + sine * dx + cosine * dy,
  };
}

function rawToNormalizedTransformSha256(
  payload: CardGeometryRawToNormalizedTransformPayloadV1,
): string {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

function buildRawToNormalizedTransformV1(input: {
  sourceSha256: string;
  sourceWidthPx: number;
  sourceHeightPx: number;
  deskewClockwiseDegrees: number;
  rotatedWidthPx: number;
  rotatedHeightPx: number;
  cropLeftPx: number;
  cropTopPx: number;
  cropWidthPx: number;
  cropHeightPx: number;
  outputWidthPx: number;
  outputHeightPx: number;
  outputContentLeftPx?: number;
  outputContentTopPx?: number;
  outputContentWidthPx?: number;
  outputContentHeightPx?: number;
}): CardGeometryRawToNormalizedTransformV1 {
  const radians = (input.deskewClockwiseDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const outputContentLeftPx = input.outputContentLeftPx ?? 0;
  const outputContentTopPx = input.outputContentTopPx ?? 0;
  const outputContentWidthPx = input.outputContentWidthPx ?? input.outputWidthPx;
  const outputContentHeightPx = input.outputContentHeightPx ?? input.outputHeightPx;
  const scaleX = outputContentWidthPx / input.cropWidthPx;
  const scaleY = outputContentHeightPx / input.cropHeightPx;
  const rotatedOffsetX = input.rotatedWidthPx / 2 -
    cosine * input.sourceWidthPx / 2 + sine * input.sourceHeightPx / 2;
  const rotatedOffsetY = input.rotatedHeightPx / 2 -
    sine * input.sourceWidthPx / 2 - cosine * input.sourceHeightPx / 2;
  const payload: CardGeometryRawToNormalizedTransformPayloadV1 = {
    schemaVersion: CARD_GEOMETRY_RAW_TO_NORMALIZED_TRANSFORM_V1,
    sourceSha256: input.sourceSha256,
    sourceCoordinateFrame: 'auto_oriented_raw_image_pixels',
    sourceWidthPx: input.sourceWidthPx,
    sourceHeightPx: input.sourceHeightPx,
    autoOrientApplied: true,
    deskewClockwiseDegrees: round(input.deskewClockwiseDegrees, 9),
    rotatedWidthPx: input.rotatedWidthPx,
    rotatedHeightPx: input.rotatedHeightPx,
    crop: {
      leftPx: input.cropLeftPx,
      topPx: input.cropTopPx,
      widthPx: input.cropWidthPx,
      heightPx: input.cropHeightPx,
    },
    outputCoordinateFrame: 'normalized_card_portrait_pixels',
    outputWidthPx: input.outputWidthPx,
    outputHeightPx: input.outputHeightPx,
    outputPlacement: {
      fit: "contain_preserve_physical_shape",
      leftPx: outputContentLeftPx,
      topPx: outputContentTopPx,
      widthPx: outputContentWidthPx,
      heightPx: outputContentHeightPx,
    },
    matrix: [
      round(scaleX * cosine, 12),
      round(-scaleX * sine, 12),
      round(outputContentLeftPx + scaleX * (rotatedOffsetX - input.cropLeftPx), 12),
      round(scaleY * sine, 12),
      round(scaleY * cosine, 12),
      round(outputContentTopPx + scaleY * (rotatedOffsetY - input.cropTopPx), 12),
      0,
      0,
      1,
    ],
  };
  return { ...payload, transformSha256: rawToNormalizedTransformSha256(payload) };
}

export function verifyCardGeometryRawToNormalizedTransformV1(
  transform: CardGeometryRawToNormalizedTransformV1,
): boolean {
  const { transformSha256, ...payload } = transform;
  return /^[a-f0-9]{64}$/.test(transformSha256) &&
    rawToNormalizedTransformSha256(payload) === transformSha256;
}

function isExactSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isFiniteContourPoint(point: CardGeometryPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function verifyCardGeometrySensorPlaneCalibrationV1(
  calibration: CardGeometrySensorPlaneCalibrationV1,
): boolean {
  return calibration.schemaVersion ===
      "ten-kings-card-geometry-sensor-plane-calibration-v1" &&
    calibration.profileId.trim().length > 0 &&
    calibration.calibrationVersion.trim().length > 0 &&
    isExactSha256(calibration.calibrationArtifactSha256) &&
    isExactSha256(calibration.bundleManifestSha256) &&
    Number.isSafeInteger(calibration.sourceWidthPx) &&
    calibration.sourceWidthPx > 0 &&
    Number.isSafeInteger(calibration.sourceHeightPx) &&
    calibration.sourceHeightPx > 0 &&
    Number.isFinite(calibration.mmPerPixelX) &&
    calibration.mmPerPixelX > 0 &&
    Number.isFinite(calibration.mmPerPixelY) &&
    calibration.mmPerPixelY > 0 &&
    Number.isFinite(calibration.scaleRelativeU95) &&
    calibration.scaleRelativeU95 >= 0 &&
    Number.isFinite(calibration.segmentationBoundaryU95Px) &&
    calibration.segmentationBoundaryU95Px >= 0 &&
    Number.isFinite(calibration.linearMeasurementU95Mm) &&
    calibration.linearMeasurementU95Mm >= 0;
}

export function verifyCardGeometryObservedDenseContourV1(
  contour: CardGeometryObservedDenseContourV1,
  sourceWidthPx?: number,
  sourceHeightPx?: number,
): boolean {
  if (
    contour.schemaVersion !== "ten-kings-card-geometry-observed-dense-contour-v1" ||
    contour.coordinateFrame !== "source_image_pixels" ||
    !isExactSha256(contour.sourceAssetSha256) ||
    !isExactSha256(contour.contourSha256) ||
    !Number.isSafeInteger(contour.pointCount) ||
    contour.pointCount < 3 ||
    contour.pointCount > 32768 ||
    contour.points.length !== contour.pointCount ||
    contour.points.some((point) =>
      !isFiniteContourPoint(point) ||
      (sourceWidthPx !== undefined && (point.x < 0 || point.x > sourceWidthPx)) ||
      (sourceHeightPx !== undefined && (point.y < 0 || point.y > sourceHeightPx))
    ) ||
    !Number.isFinite(contour.strongSupportFraction) ||
    contour.strongSupportFraction < 0 ||
    contour.strongSupportFraction > 1 ||
    !["strong", "limited"].includes(contour.evidenceQuality)
  ) {
    return false;
  }
  const expectedSha256 = createHash("sha256")
    .update(JSON.stringify({
      sourceAssetSha256: contour.sourceAssetSha256,
      coordinateFrame: contour.coordinateFrame,
      points: contour.points,
    }), "utf8")
    .digest("hex");
  if (expectedSha256 !== contour.contourSha256) return false;
  if (!contour.measurementsMm) return true;
  const measurement = contour.measurementsMm;
  if (
    !isExactSha256(measurement.measurementAuthoritySha256) ||
    !isExactSha256(measurement.calibration.calibrationArtifactSha256) ||
    !isExactSha256(measurement.calibration.bundleManifestSha256) ||
    !Number.isSafeInteger(measurement.calibration.sourceWidthPx) ||
    measurement.calibration.sourceWidthPx <= 0 ||
    !Number.isSafeInteger(measurement.calibration.sourceHeightPx) ||
    measurement.calibration.sourceHeightPx <= 0 ||
    [
      measurement.calibration.effectiveMmPerPixelX,
      measurement.calibration.effectiveMmPerPixelY,
      measurement.width,
      measurement.height,
      measurement.perimeter,
      measurement.enclosedArea,
      measurement.angleDegrees,
      measurement.privateUncertaintyU95.widthMm,
      measurement.privateUncertaintyU95.heightMm,
      measurement.privateUncertaintyU95.radiusMm,
    ].some((value) => !Number.isFinite(value)) ||
    measurement.width <= 0 ||
    measurement.height <= 0 ||
    measurement.perimeter <= 0 ||
    measurement.enclosedArea <= 0 ||
    measurement.privateUncertaintyU95.basis !==
      "calibrated_scale_boundary_and_repeatability_rss" ||
    measurement.circularArcs.some((arc) =>
      !Number.isFinite(arc.radiusMm) ||
      arc.radiusMm <= 0 ||
      !Number.isFinite(arc.sweepDegrees) ||
      !Number.isFinite(arc.radialResidualMm) ||
      arc.radialResidualMm < 0 ||
      !Number.isSafeInteger(arc.sampleCount) ||
      arc.sampleCount < 3
    )
  ) {
    return false;
  }
  const { measurementAuthoritySha256, ...measurementPayload } = measurement;
  return createHash("sha256")
    .update(JSON.stringify({
      contourSha256: contour.contourSha256,
      ...measurementPayload,
    }), "utf8")
    .digest("hex") === measurementAuthoritySha256;
}

export function verifyCardGeometryNormalizedDenseContourV1(input: {
  contour: CardGeometryNormalizedDenseContourV1;
  observed: CardGeometryObservedDenseContourV1;
  transform: CardGeometryRawToNormalizedTransformV1;
}): boolean {
  const { contour, observed, transform } = input;
  if (
    !verifyCardGeometryRawToNormalizedTransformV1(transform) ||
    !verifyCardGeometryObservedDenseContourV1(
      observed,
      transform.sourceWidthPx,
      transform.sourceHeightPx,
    ) ||
    contour.schemaVersion !== "ten-kings-normalized-dense-contour-v1" ||
    contour.coordinateFrame !== "normalized_card_portrait_pixels" ||
    contour.sourceContourSha256 !== observed.contourSha256 ||
    contour.rawToNormalizedTransformSha256 !== transform.transformSha256 ||
    !isExactSha256(contour.contourSha256) ||
    !Number.isSafeInteger(contour.pointCount) ||
    contour.pointCount !== observed.pointCount ||
    contour.points.length !== contour.pointCount ||
    contour.points.some((point) =>
      !isFiniteContourPoint(point) ||
      point.x < 0 ||
      point.x > transform.outputWidthPx ||
      point.y < 0 ||
      point.y > transform.outputHeightPx
    )
  ) {
    return false;
  }
  const expectedSha256 = createHash("sha256")
    .update(JSON.stringify({
      sourceContourSha256: contour.sourceContourSha256,
      rawToNormalizedTransformSha256: contour.rawToNormalizedTransformSha256,
      coordinateFrame: contour.coordinateFrame,
      points: contour.points,
    }), "utf8")
    .digest("hex");
  if (expectedSha256 !== contour.contourSha256) return false;
  return contour.points.every((point, index) => {
    const expected = transformRawPointToNormalizedV1(transform, observed.points[index]!);
    return Math.abs(point.x - expected.x) <= 1e-5 &&
      Math.abs(point.y - expected.y) <= 1e-5;
  });
}

export function transformRawPointToNormalizedV1(
  transform: CardGeometryRawToNormalizedTransformV1,
  point: CardGeometryPoint,
): CardGeometryPoint {
  if (!verifyCardGeometryRawToNormalizedTransformV1(transform)) {
    throw new Error('Raw-to-normalized transform SHA-256 does not reproduce.');
  }
  const [a, b, c, d, e, f] = transform.matrix;
  return { x: a * point.x + b * point.y + c, y: d * point.x + e * point.y + f };
}

export function transformNormalizedPointToRawV1(
  transform: CardGeometryRawToNormalizedTransformV1,
  point: CardGeometryPoint,
): CardGeometryPoint {
  if (!verifyCardGeometryRawToNormalizedTransformV1(transform)) {
    throw new Error('Raw-to-normalized transform SHA-256 does not reproduce.');
  }
  const [a, b, c, d, e, f] = transform.matrix;
  const determinant = a * e - b * d;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    throw new Error('Raw-to-normalized transform matrix is singular.');
  }
  const normalizedX = point.x - c;
  const normalizedY = point.y - f;
  return {
    x: (e * normalizedX - b * normalizedY) / determinant,
    y: (-d * normalizedX + a * normalizedY) / determinant,
  };
}

function normalizationDeskewDegrees(
  rotationDegrees: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  if (sourceWidth <= sourceHeight) return -rotationDegrees;
  // Dell raw Basler evidence is landscape while the operator preview is the
  // same frame rotated 90 degrees clockwise. PCA axis direction is modulo 180,
  // so choose the equivalent deskew branch around +90 degrees; choosing -90
  // for an aligned raw frame would make an operator-top card upside down.
  return rotationDegrees >= 0 ? 180 - rotationDegrees : -rotationDegrees;
}

async function normalizePreparedImage(
  input: Pick<DetectAndNormalizeCardImageInput, "sourceImagePath" | "normalizedOutputPath" | "pngCompressionLevel">,
  prepared: PreparedImage,
  geometry: CardGeometryMetadata,
): Promise<CardGeometryNormalizedArtifact | undefined> {
  if (!geometry.corners || geometry.rotationDegrees == null) return undefined;
  const sourceResolved = path.resolve(input.sourceImagePath);
  const outputResolved = path.resolve(input.normalizedOutputPath);
  if (sourceResolved.toLowerCase() === outputResolved.toLowerCase()) {
    throw new Error("normalizedOutputPath must not overwrite the raw source image.");
  }
  await mkdir(path.dirname(outputResolved), { recursive: true });
  const deskewDegrees = normalizationDeskewDegrees(
    geometry.rotationDegrees,
    prepared.orientedWidth,
    prepared.orientedHeight,
  );
  const background = geometry.detection.backgroundColor ?? {
    r: geometry.detection.backgroundLuma,
    g: geometry.detection.backgroundLuma,
    b: geometry.detection.backgroundLuma,
  };
  const rotated = await sharp(prepared.rawBytes)
    .autoOrient()
    .rotate(deskewDegrees, { background: { ...background, alpha: 1 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  const rawBoundaryPoints = geometry.observedDenseContour?.points.length
    ? geometry.observedDenseContour.points
    : [
        geometry.corners.topLeft,
        geometry.corners.topRight,
        geometry.corners.bottomRight,
        geometry.corners.bottomLeft,
      ];
  const transformed = rawBoundaryPoints.map((point) =>
    transformPointForRotation(
      point,
      prepared.orientedWidth,
      prepared.orientedHeight,
      rotated.info.width,
      rotated.info.height,
      deskewDegrees,
    ),
  );
  const contourPaddingPx = geometry.observedDenseContour ? 2 : 0;
  const left = clamp(
    Math.floor(Math.min(...transformed.map((point) => point.x)) - contourPaddingPx),
    0,
    rotated.info.width - 1,
  );
  const top = clamp(
    Math.floor(Math.min(...transformed.map((point) => point.y)) - contourPaddingPx),
    0,
    rotated.info.height - 1,
  );
  const right = clamp(
    Math.ceil(Math.max(...transformed.map((point) => point.x)) + contourPaddingPx),
    left + 1,
    rotated.info.width,
  );
  const bottom = clamp(
    Math.ceil(Math.max(...transformed.map((point) => point.y)) + contourPaddingPx),
    top + 1,
    rotated.info.height,
  );
  const cropWidth = right - left;
  const cropHeight = bottom - top;
  if (cropWidth < 5 || cropHeight < 7) throw new Error("Detected card geometry is too small to create a 5:7 normalized artifact.");
  const targetWidth = NORMALIZED_CARD_WIDTH_PIXELS;
  const targetHeight = NORMALIZED_CARD_HEIGHT_PIXELS;
  const resizedContent = await sharp(rotated.data)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize({
      width: targetWidth,
      height: targetHeight,
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const contentWidth = resizedContent.info.width;
  const contentHeight = resizedContent.info.height;
  const contentLeft = Math.floor((targetWidth - contentWidth) / 2);
  const contentTop = Math.floor((targetHeight - contentHeight) / 2);
  const geometricResamplingApplied = cropWidth !== contentWidth || cropHeight !== contentHeight;
  const upscaled = contentWidth > cropWidth || contentHeight > cropHeight;
  const compressionLevel = Math.round(clamp(input.pngCompressionLevel ?? 6, 0, 9));
  const rawToNormalizedTransform = buildRawToNormalizedTransformV1({
    sourceSha256: prepared.rawArtifact.sha256,
    sourceWidthPx: prepared.orientedWidth,
    sourceHeightPx: prepared.orientedHeight,
    deskewClockwiseDegrees: deskewDegrees,
    rotatedWidthPx: rotated.info.width,
    rotatedHeightPx: rotated.info.height,
    cropLeftPx: left,
    cropTopPx: top,
    cropWidthPx: cropWidth,
    cropHeightPx: cropHeight,
    outputWidthPx: targetWidth,
    outputHeightPx: targetHeight,
    outputContentLeftPx: contentLeft,
    outputContentTopPx: contentTop,
    outputContentWidthPx: contentWidth,
    outputContentHeightPx: contentHeight,
  });
  await sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 3,
      background,
    },
  })
    .composite([{ input: resizedContent.data, left: contentLeft, top: contentTop }])
    .png({ compressionLevel, adaptiveFiltering: true })
    .toFile(outputResolved);
  const normalizedDenseContour = geometry.observedDenseContour
    ? (() => {
        const points = geometry.observedDenseContour.points.map((point) => {
          const normalized = transformRawPointToNormalizedV1(rawToNormalizedTransform, point);
          return { x: round(normalized.x, 6), y: round(normalized.y, 6) };
        });
        const contourSha256 = createHash("sha256")
          .update(JSON.stringify({
            sourceContourSha256: geometry.observedDenseContour.contourSha256,
            rawToNormalizedTransformSha256: rawToNormalizedTransform.transformSha256,
            coordinateFrame: "normalized_card_portrait_pixels",
            points,
          }), "utf8")
          .digest("hex");
        return {
          schemaVersion: "ten-kings-normalized-dense-contour-v1" as const,
          coordinateFrame: "normalized_card_portrait_pixels" as const,
          sourceContourSha256: geometry.observedDenseContour.contourSha256,
          rawToNormalizedTransformSha256: rawToNormalizedTransform.transformSha256,
          points,
          pointCount: points.length,
          contourSha256,
        };
      })()
    : undefined;
  const [bytes, outputStats, outputMetadata] = await Promise.all([
    readFile(outputResolved),
    stat(outputResolved),
    sharp(outputResolved).metadata(),
  ]);
  return {
    localOutputPath: outputResolved,
    fileName: path.basename(outputResolved),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: outputStats.size,
    mimeType: "image/png",
    imageWidth: outputMetadata.width ?? targetWidth,
    imageHeight: outputMetadata.height ?? targetHeight,
    lossless: true,
    encodingLossless: true,
    geometricResamplingApplied,
    upscaled,
    sourceCropWidth: cropWidth,
    sourceCropHeight: cropHeight,
    scaleX: round(contentWidth / cropWidth, 6),
    scaleY: round(contentHeight / cropHeight, 6),
    coordinateFrame: "normalized_card_portrait_pixels",
    sourceSha256: prepared.rawArtifact.sha256,
    deskewAppliedDegrees: round(deskewDegrees, 3),
    rawToNormalizedTransform,
    ...(normalizedDenseContour ? { normalizedDenseContour } : {}),
  };
}

export async function detectAndNormalizeCardImage(
  input: DetectAndNormalizeCardImageInput,
): Promise<CardGeometryNormalizationResult> {
  requireDetectionPolicy(input.detectionPolicy);
  const prepared = await prepareImage(input.sourceImagePath);
  const geometry = await buildGeometry(input, prepared);
  const normalizedArtifact = await normalizePreparedImage(input, prepared, geometry);
  const rawBytesAfter = await readFile(input.sourceImagePath);
  const rawShaAfter = createHash("sha256").update(rawBytesAfter).digest("hex");
  return {
    geometry,
    rawArtifact: prepared.rawArtifact,
    ...(normalizedArtifact ? { normalizedArtifact } : {}),
    rawEvidencePreserved: rawShaAfter === prepared.rawArtifact.sha256 && Buffer.compare(prepared.rawBytes, rawBytesAfter) === 0,
  };
}

function assertReusableGeometry(geometry: CardGeometryMetadata, prepared: PreparedImage): void {
  const coherentDetectedGeometry =
    geometry.placementState === "ready" &&
    geometry.geometrySource === "detected" &&
    geometry.captureMode === "automatic_detection" &&
    geometry.confidenceBasis === "automatic_detection" &&
    geometry.detectionUsed === true &&
    geometry.manualOverrideUsed === false;
  if (
    !coherentDetectedGeometry ||
    !geometry.observedDenseContour ||
    !verifyCardGeometryObservedDenseContourV1(
      geometry.observedDenseContour,
      prepared.orientedWidth,
      prepared.orientedHeight,
    ) ||
    !geometry.corners ||
    geometry.rotationDegrees == null ||
    !Number.isFinite(geometry.rotationDegrees)
  ) {
    throw new Error("Reusable card geometry must be coherent Ready automatic detection.");
  }
  if (geometry.image.width !== prepared.orientedWidth || geometry.image.height !== prepared.orientedHeight) {
    throw new Error("Reusable card geometry dimensions must exactly match the oriented forensic frame dimensions.");
  }
  const points = [geometry.corners.topLeft, geometry.corners.topRight, geometry.corners.bottomRight, geometry.corners.bottomLeft];
  if (
    points.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.y < 0 ||
        point.x > prepared.orientedWidth ||
        point.y > prepared.orientedHeight,
    )
  ) {
    throw new Error("Reusable card geometry corners must be finite and remain inside the forensic frame.");
  }
}

/**
 * Apply one side's coherent Ready detection or explicit operator-confirmed
 * manual transform to another same-dimension forensic frame. The source bytes
 * are re-hashed so callers can prove raw evidence was not replaced or modified.
 */
export async function normalizeCardImageWithGeometry(
  input: NormalizeCardImageWithGeometryInput,
): Promise<CardGeometryNormalizationResult> {
  const prepared = await prepareImage(input.sourceImagePath);
  assertReusableGeometry(input.geometry, prepared);
  const normalizedArtifact = await normalizePreparedImage(
    {
      sourceImagePath: input.sourceImagePath,
      normalizedOutputPath: input.normalizedOutputPath,
      pngCompressionLevel: input.pngCompressionLevel,
    },
    prepared,
    input.geometry,
  );
  if (!normalizedArtifact) throw new Error("Reusable card geometry did not produce a normalized artifact.");
  const rawBytesAfter = await readFile(input.sourceImagePath);
  const rawShaAfter = createHash("sha256").update(rawBytesAfter).digest("hex");
  return {
    geometry: input.geometry,
    rawArtifact: prepared.rawArtifact,
    normalizedArtifact,
    rawEvidencePreserved: rawShaAfter === prepared.rawArtifact.sha256 && Buffer.compare(prepared.rawBytes, rawBytesAfter) === 0,
  };
}

export function defaultCardGeometryThresholds(): CardGeometryThresholds {
  return { ...DEFAULT_THRESHOLDS };
}
