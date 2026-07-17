import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";

export const CARD_GEOMETRY_VERSION = "ten-kings-card-geometry-v1";
export const STANDARD_CARD_WIDTH_INCHES = 2.5;
export const STANDARD_CARD_HEIGHT_INCHES = 3.5;
export const NORMALIZED_CARD_WIDTH_PIXELS = 1200;
export const NORMALIZED_CARD_HEIGHT_PIXELS = 1680;

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
  method: "solid_plate_color_component_pca_v2" | "perimeter_gradient_rectangle_v3";
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
    | "perimeter_gradient_rectangle_v3"
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
  /** Present only for the fail-closed perimeter-gradient fallback. */
  perimeterGradientStrength?: number;
  perimeterSideStrengths?: [number, number, number, number];
  /** Mean interior-versus-exterior transition per captured perimeter side. */
  perimeterSignedSideStrengths?: [number, number, number, number];
  /** Fraction of transition energy that agrees with each side's dominant polarity. */
  perimeterSidePolarityConsistency?: [number, number, number, number];
  /** Dominant captured interior/exterior polarity for each independently gated side. */
  perimeterSidePolarity?: [
    "lighter_inside" | "darker_inside",
    "lighter_inside" | "darker_inside",
    "lighter_inside" | "darker_inside",
    "lighter_inside" | "darker_inside",
  ];
  /** Candidates admitted only to local refinement; never accepted geometry. */
  perimeterProvisionalCandidateCount?: number;
  /** Path-free rejection evidence for a failed full-resolution perimeter search. */
  perimeterClosestRejectedCandidate?: {
    reasons: Array<
      "coverage" | "aspect" | "clearance" | "side_gradient" |
      "side_signed_gradient" | "side_polarity_coherence" | "total_gradient"
    >;
    measuredAspectRatio: number;
    cardCoverage: number;
    clearance: number;
    sideStrengths: [number, number, number, number];
    signedSideStrengths: [number, number, number, number];
    sidePolarityConsistency: [number, number, number, number];
    sidePolarity: [
      "lighter_inside" | "darker_inside",
      "lighter_inside" | "darker_inside",
      "lighter_inside" | "darker_inside",
      "lighter_inside" | "darker_inside",
    ];
  };
  perimeterCandidateCount?: number;
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
}

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
  return morphologyPass(morphologyPass(mask, width, height, radius, "dilate"), width, height, radius, "erode");
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

async function attemptSolidPlateDetection(prepared: PreparedImage, thresholds: CardGeometryThresholds): Promise<DetectionAttempt> {
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
  const borderSize = Math.max(2, Math.round(Math.min(analysisWidth, analysisHeight) * 0.025));
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
  const differenceHistogram = new Uint32Array(256);
  const borderDifferenceHistogram = new Uint32Array(256);
  const differences = new Uint8Array(pixelCount);
  let borderDifferenceCount = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * channels;
    const red = data[offset] ?? 0;
    const green = data[offset + Math.min(1, channels - 1)] ?? red;
    const blue = data[offset + Math.min(2, channels - 1)] ?? red;
    const difference = Math.round(
      Math.sqrt(
        (red - backgroundColor.r) ** 2 +
        (green - backgroundColor.g) ** 2 +
        (blue - backgroundColor.b) ** 2,
      ) / Math.sqrt(3),
    );
    differences[index] = difference;
    differenceHistogram[difference] = (differenceHistogram[difference] ?? 0) + 1;
    const x = index % analysisWidth;
    const y = Math.floor(index / analysisWidth);
    if (x < borderSize || x >= analysisWidth - borderSize || y < borderSize || y >= analysisHeight - borderSize) {
      borderDifferenceHistogram[difference] = (borderDifferenceHistogram[difference] ?? 0) + 1;
      borderDifferenceCount += 1;
    }
  }
  const contrastRange = histogramPercentile(differenceHistogram, pixelCount, 0.95);
  // A clipped/edge-adjacent card can occupy part of the border sample. The
  // 80th percentile remains representative of a solid plate until a large
  // fraction of the frame perimeter is obstructed, which must never be Ready.
  const backgroundNoise = histogramPercentile(borderDifferenceHistogram, borderDifferenceCount, 0.8);
  const foregroundThreshold = Math.round(clamp(Math.max(4, backgroundNoise * 2.5, contrastRange * 0.22), 4, 80));
  const morphologyRadius = Math.round(clamp(Math.round(Math.min(analysisWidth, analysisHeight) * 0.003), 1, 4));
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
  if (contrastRange < Math.max(4, backgroundNoise * 1.5)) {
    return { diagnostics: diagnosticsBase, reason: "Image contrast is too low to distinguish the card from the solid base plate." };
  }

  const initialMask = new Uint8Array(pixelCount);
  for (let index = 0; index < differences.length; index += 1) {
    if ((differences[index] ?? 0) < foregroundThreshold) continue;
    initialMask[index] = 1;
  }
  const mask = fillForegroundHoles(
    closeForegroundMask(initialMask, analysisWidth, analysisHeight, morphologyRadius),
    analysisWidth,
    analysisHeight,
  );
  let foregroundCount = 0;
  for (const value of mask) foregroundCount += value;
  diagnosticsBase.foregroundPixelFraction = round(foregroundCount / Math.max(1, pixelCount), 6);
  const { labels, components } = labelForegroundComponents(mask, differences, analysisWidth, analysisHeight);
  const minimumComponentPixels = Math.max(64, Math.round(pixelCount * thresholds.minCardCoverage * 0.2));
  const componentScore = (entry: ComponentStats) => {
    const meanX = entry.sumX / entry.count;
    const meanY = entry.sumY / entry.count;
    const covarianceXX = Math.max(0, entry.sumXX / entry.count - meanX * meanX);
    const covarianceYY = Math.max(0, entry.sumYY / entry.count - meanY * meanY);
    const covarianceXY = entry.sumXY / entry.count - meanX * meanY;
    const trace = covarianceXX + covarianceYY;
    const root = Math.sqrt(Math.max(0, (covarianceXX - covarianceYY) ** 2 + 4 * covarianceXY ** 2));
    const major = Math.max(0.000001, (trace + root) / 2);
    const minor = Math.max(0.000001, (trace - root) / 2);
    const estimatedAspect = Math.sqrt(major / minor);
    const relativeAspectError = Math.abs(estimatedAspect - thresholds.expectedAspectRatio) / thresholds.expectedAspectRatio;
    const aspectScore = clamp(1 - relativeAspectError / Math.max(0.01, thresholds.maxRelativeAspectError * 2), 0, 1);
    const componentCoverage = entry.count / Math.max(1, pixelCount);
    const coverageScore = componentCoverage < thresholds.minCardCoverage
      ? clamp(componentCoverage / thresholds.minCardCoverage, 0, 1)
      : componentCoverage > thresholds.maxCardCoverage
        ? clamp((1 - componentCoverage) / Math.max(0.01, 1 - thresholds.maxCardCoverage), 0, 1)
        : 1;
    const contrastScore = clamp((entry.sumDifference / entry.count) / Math.max(1, foregroundThreshold * 2), 0, 1);
    return 0.55 * aspectScore + 0.3 * coverageScore + 0.15 * contrastScore;
  };
  const component = components
    .filter((entry) => entry.count >= minimumComponentPixels)
    .sort((left, right) => componentScore(right) - componentScore(left) || right.count - left.count)[0];
  if (!component) return { diagnostics: diagnosticsBase, reason: "No sufficiently large connected card candidate was found." };

  const meanX = component.sumX / component.count;
  const meanY = component.sumY / component.count;
  const covarianceXX = component.sumXX / component.count - meanX * meanX;
  const covarianceYY = component.sumYY / component.count - meanY * meanY;
  const covarianceXY = component.sumXY / component.count - meanX * meanY;
  const principalAngle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
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
    return { diagnostics: diagnosticsBase, reason: "The detected component does not form a usable outer card rectangle." };
  }

  const analysisCorners: CardGeometryCorners = {
    topLeft: {
      x: meanX + shortAxis.x * minShort + longAxis.x * minLong,
      y: meanY + shortAxis.y * minShort + longAxis.y * minLong,
    },
    topRight: {
      x: meanX + shortAxis.x * maxShort + longAxis.x * minLong,
      y: meanY + shortAxis.y * maxShort + longAxis.y * minLong,
    },
    bottomRight: {
      x: meanX + shortAxis.x * maxShort + longAxis.x * maxLong,
      y: meanY + shortAxis.y * maxShort + longAxis.y * maxLong,
    },
    bottomLeft: {
      x: meanX + shortAxis.x * minShort + longAxis.x * maxLong,
      y: meanY + shortAxis.y * minShort + longAxis.y * maxLong,
    },
  };
  const scaleX = prepared.orientedWidth / analysisWidth;
  const scaleY = prepared.orientedHeight / analysisHeight;
  const corners: CardGeometryCorners = {
    topLeft: scalePoint(analysisCorners.topLeft, scaleX, scaleY),
    topRight: scalePoint(analysisCorners.topRight, scaleX, scaleY),
    bottomRight: scalePoint(analysisCorners.bottomRight, scaleX, scaleY),
    bottomLeft: scalePoint(analysisCorners.bottomLeft, scaleX, scaleY),
  };
  const measuredAspectRatio = longSide / shortSide;
  const relativeAspectError = Math.abs(measuredAspectRatio - thresholds.expectedAspectRatio) / thresholds.expectedAspectRatio;
  const projectedArea = shortSide * longSide;
  const componentFill = component.count / Math.max(1, projectedArea);
  const cardCoverage = projectedArea / Math.max(1, analysisWidth * analysisHeight);
  if (componentFill < 0.82) {
    return {
      diagnostics: {
        ...diagnosticsBase,
        componentPixelFraction: round(component.count / Math.max(1, pixelCount), 6),
        rectangularFill: round(componentFill, 5),
        measuredAspectRatio: round(measuredAspectRatio, 5),
        relativeAspectError: round(relativeAspectError, 5),
      },
      reason: "The solid-plate foreground candidate does not have enough rectangular edge support to be a card.",
    };
  }
  const meanDifference = component.sumDifference / component.count;
  const aspectScore = clamp(1 - relativeAspectError / Math.max(0.01, thresholds.maxRelativeAspectError * 1.5), 0, 1);
  const fillScore = clamp((componentFill - 0.25) / 0.65, 0, 1);
  const contrastScore = clamp((meanDifference - foregroundThreshold * 0.8) / Math.max(4, foregroundThreshold * 1.5), 0, 1);
  const coverageScore =
    cardCoverage < thresholds.minCardCoverage
      ? clamp(cardCoverage / thresholds.minCardCoverage, 0, 1)
      : cardCoverage > thresholds.maxCardCoverage
        ? clamp((1 - cardCoverage) / Math.max(0.01, 1 - thresholds.maxCardCoverage), 0, 1)
        : 1;
  const confidence = round(0.38 * aspectScore + 0.28 * fillScore + 0.19 * contrastScore + 0.15 * coverageScore, 4);
  const rotationDegrees = round(normalizeRotationDegrees((Math.atan2(shortAxis.y, shortAxis.x) * 180) / Math.PI), 3);
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
      corners,
      boundingBox: boundingBoxForCorners(corners),
      rotationDegrees,
      confidence,
      shortSidePixels: shortSide * scaleX,
      longSidePixels: longSide * scaleY,
      cardCoverage,
      measuredAspectRatio,
      relativeAspectError,
      diagnostics,
    },
  };
}

/**
 * The primary solid-plate segmentation deliberately rejects weak, fragmented
 * foreground masks so artwork cannot become a card boundary. Some legitimate
 * dark-on-dark full-resolution captures instead retain a coherent outer
 * perimeter while the interior has much stronger artwork contrast. This
 * fallback fits that captured perimeter only when every side of a standard
 * card rectangle has independently measured gradient support.
 *
 * It is intentionally a separate, stricter authority rather than a lower
 * solid-plate threshold: no browser rectangle, fixture rectangle, or preview
 * coordinates participate in this path.
 */
const PERIMETER_GRADIENT_ANALYSIS_MAX_DIMENSION = 512;
const PERIMETER_GRADIENT_MIN_SIDE_STRENGTH = 1.4;
const PERIMETER_GRADIENT_MIN_TOTAL_STRENGTH = 8.4;
const PERIMETER_GRADIENT_MIN_SIGNED_SIDE_STRENGTH = 1.2;
const PERIMETER_GRADIENT_MIN_POLARITY_CONSISTENCY = 0.8;
const PERIMETER_GRADIENT_ANGLE_DEGREES = [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30] as const;
const PERIMETER_GRADIENT_ASPECT_FACTORS = [0.86, 0.93, 1, 1.07, 1.14] as const;

interface PerimeterGradientScore {
  sideStrengths: [number, number, number, number];
  sideSignedStrengths: [number, number, number, number];
  sidePolarityConsistency: [number, number, number, number];
  sidePolarity: [
    "lighter_inside" | "darker_inside",
    "lighter_inside" | "darker_inside",
    "lighter_inside" | "darker_inside",
    "lighter_inside" | "darker_inside",
  ];
  totalStrength: number;
  clearance: number;
  corners: CardGeometryCorners;
  longAxis: CardGeometryPoint;
  shortAxis: CardGeometryPoint;
}

interface PerimeterGradientCandidate extends PerimeterGradientScore {
  centerX: number;
  centerY: number;
  longSide: number;
  shortSide: number;
  aspectRatio: number;
  coverage: number;
  angleDegrees: number;
}

function lumaForRgb(red: number, green: number, blue: number): number {
  return Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
}

interface PerimeterGradientLineScore {
  strength: number;
  signedStrength: number;
  polarityConsistency: number;
  polarity: "lighter_inside" | "darker_inside";
}

function perimeterGradientLineScore(input: {
  luma: Uint8Array;
  width: number;
  height: number;
  base: CardGeometryPoint;
  normal: CardGeometryPoint;
  span: CardGeometryPoint;
  sampleCount: number;
}): PerimeterGradientLineScore {
  const sample = (x: number, y: number) => {
    const boundedX = clamp(Math.round(x), 0, input.width - 1);
    const boundedY = clamp(Math.round(y), 0, input.height - 1);
    return input.luma[boundedY * input.width + boundedX] ?? 0;
  };
  const absoluteValues: number[] = [];
  let signedTotal = 0;
  let positiveEnergy = 0;
  let negativeEnergy = 0;
  // Two analysis pixels keeps the test localized to an observed edge while
  // remaining stable after the capped full-resolution analysis resize.
  const offset = 2;
  for (let index = 0; index < input.sampleCount; index += 1) {
    const position = (index + 0.5) / input.sampleCount - 0.5;
    const x = input.base.x + input.span.x * position;
    const y = input.base.y + input.span.y * position;
    const signedDifference =
      sample(x - input.normal.x * offset, y - input.normal.y * offset) -
      sample(x + input.normal.x * offset, y + input.normal.y * offset);
    absoluteValues.push(Math.abs(signedDifference));
    signedTotal += signedDifference;
    if (signedDifference >= 1) positiveEnergy += signedDifference;
    if (signedDifference <= -1) negativeEnergy += -signedDifference;
  }
  absoluteValues.sort((left, right) => left - right);
  // Edge glare can be localized, while an invisible boundary cannot be
  // rescued by a few bright pixels. Require support across the strongest 60%
  // of evenly-spaced samples from the full captured frame.
  const supported = absoluteValues.slice(Math.floor(absoluteValues.length * 0.4));
  const strength = supported.reduce((sum, value) => sum + value, 0) / Math.max(1, supported.length);
  const polarity = positiveEnergy >= negativeEnergy ? "lighter_inside" : "darker_inside";
  const observedEnergy = positiveEnergy + negativeEnergy;
  const agreeingEnergy = polarity === "lighter_inside" ? positiveEnergy : negativeEnergy;
  return {
    strength: round(strength, 4),
    signedStrength: round(signedTotal / Math.max(1, input.sampleCount), 4),
    polarityConsistency: round(agreeingEnergy / Math.max(1, observedEnergy), 4),
    polarity,
  };
}

function perimeterGradientCorners(input: {
  centerX: number;
  centerY: number;
  longSide: number;
  shortSide: number;
  angleDegrees: number;
  imageLandscape: boolean;
}): { corners: CardGeometryCorners; longAxis: CardGeometryPoint; shortAxis: CardGeometryPoint } {
  const baseAngleRadians = input.imageLandscape ? 0 : Math.PI / 2;
  const angleRadians = baseAngleRadians + (input.angleDegrees * Math.PI) / 180;
  let longAxis = { x: Math.cos(angleRadians), y: Math.sin(angleRadians) };
  // Keep the same deterministic axis branch as the PCA authority. This is
  // essential for Dell landscape normalization to preserve operator-top.
  if (longAxis.y < 0 || (Math.abs(longAxis.y) < 1e-8 && longAxis.x < 0)) {
    longAxis = { x: -longAxis.x, y: -longAxis.y };
  }
  const shortAxis = { x: longAxis.y, y: -longAxis.x };
  const shortHalf = input.shortSide / 2;
  const longHalf = input.longSide / 2;
  return {
    longAxis,
    shortAxis,
    corners: {
      topLeft: {
        x: input.centerX - shortAxis.x * shortHalf - longAxis.x * longHalf,
        y: input.centerY - shortAxis.y * shortHalf - longAxis.y * longHalf,
      },
      topRight: {
        x: input.centerX + shortAxis.x * shortHalf - longAxis.x * longHalf,
        y: input.centerY + shortAxis.y * shortHalf - longAxis.y * longHalf,
      },
      bottomRight: {
        x: input.centerX + shortAxis.x * shortHalf + longAxis.x * longHalf,
        y: input.centerY + shortAxis.y * shortHalf + longAxis.y * longHalf,
      },
      bottomLeft: {
        x: input.centerX - shortAxis.x * shortHalf + longAxis.x * longHalf,
        y: input.centerY - shortAxis.y * shortHalf + longAxis.y * longHalf,
      },
    },
  };
}

function scorePerimeterGradientCandidate(input: {
  luma: Uint8Array;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  longSide: number;
  shortSide: number;
  angleDegrees: number;
  imageLandscape: boolean;
}): PerimeterGradientScore {
  const { corners, longAxis, shortAxis } = perimeterGradientCorners(input);
  const sideScores = [
    perimeterGradientLineScore({
      luma: input.luma,
      width: input.width,
      height: input.height,
      base: {
        x: input.centerX + shortAxis.x * input.shortSide / 2,
        y: input.centerY + shortAxis.y * input.shortSide / 2,
      },
      normal: shortAxis,
      span: { x: longAxis.x * input.longSide, y: longAxis.y * input.longSide },
      sampleCount: 32,
    }),
    perimeterGradientLineScore({
      luma: input.luma,
      width: input.width,
      height: input.height,
      base: {
        x: input.centerX - shortAxis.x * input.shortSide / 2,
        y: input.centerY - shortAxis.y * input.shortSide / 2,
      },
      normal: { x: -shortAxis.x, y: -shortAxis.y },
      span: { x: longAxis.x * input.longSide, y: longAxis.y * input.longSide },
      sampleCount: 32,
    }),
    perimeterGradientLineScore({
      luma: input.luma,
      width: input.width,
      height: input.height,
      base: {
        x: input.centerX + longAxis.x * input.longSide / 2,
        y: input.centerY + longAxis.y * input.longSide / 2,
      },
      normal: longAxis,
      span: { x: shortAxis.x * input.shortSide, y: shortAxis.y * input.shortSide },
      sampleCount: 24,
    }),
    perimeterGradientLineScore({
      luma: input.luma,
      width: input.width,
      height: input.height,
      base: {
        x: input.centerX - longAxis.x * input.longSide / 2,
        y: input.centerY - longAxis.y * input.longSide / 2,
      },
      normal: { x: -longAxis.x, y: -longAxis.y },
      span: { x: shortAxis.x * input.shortSide, y: shortAxis.y * input.shortSide },
      sampleCount: 24,
    }),
  ] as const;
  const sideStrengths = sideScores.map((score) => score.strength) as [number, number, number, number];
  const sideSignedStrengths = sideScores.map((score) => score.signedStrength) as [number, number, number, number];
  const sidePolarityConsistency = sideScores.map((score) => score.polarityConsistency) as [number, number, number, number];
  const sidePolarity = sideScores.map((score) => score.polarity) as PerimeterGradientScore["sidePolarity"];
  const clearance = Math.min(
    ...[corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft].flatMap((point) => [
      point.x,
      point.y,
      input.width - point.x,
      input.height - point.y,
    ]),
  );
  return {
    sideStrengths,
    sideSignedStrengths,
    sidePolarityConsistency,
    sidePolarity,
    totalStrength: round(sideStrengths.reduce((sum, value) => sum + value, 0), 4),
    clearance: round(clearance, 4),
    corners,
    longAxis,
    shortAxis,
  };
}

type PerimeterGradientGateFailure =
  | "coverage"
  | "aspect"
  | "clearance"
  | "side_gradient"
  | "side_signed_gradient"
  | "side_polarity_coherence"
  | "total_gradient";

function perimeterGradientGateFailures(input: {
  candidate: PerimeterGradientCandidate;
  thresholds: CardGeometryThresholds;
  imageWidth: number;
  imageHeight: number;
}): PerimeterGradientGateFailure[] {
  const relativeAspectError = Math.abs(input.candidate.aspectRatio - input.thresholds.expectedAspectRatio) / input.thresholds.expectedAspectRatio;
  const edgeClearance = Math.min(input.imageWidth, input.imageHeight) * input.thresholds.minEdgeClearanceRatio;
  const failures: PerimeterGradientGateFailure[] = [];
  if (input.candidate.coverage < input.thresholds.minCardCoverage || input.candidate.coverage > input.thresholds.maxCardCoverage) {
    failures.push("coverage");
  }
  if (relativeAspectError > input.thresholds.maxRelativeAspectError) failures.push("aspect");
  if (input.candidate.clearance < edgeClearance) failures.push("clearance");
  if (!input.candidate.sideStrengths.every((strength) => strength >= PERIMETER_GRADIENT_MIN_SIDE_STRENGTH)) {
    failures.push("side_gradient");
  }
  if (!input.candidate.sideSignedStrengths.every((strength) => Math.abs(strength) >= PERIMETER_GRADIENT_MIN_SIGNED_SIDE_STRENGTH)) {
    failures.push("side_signed_gradient");
  }
  if (!input.candidate.sidePolarityConsistency.every((consistency) => consistency >= PERIMETER_GRADIENT_MIN_POLARITY_CONSISTENCY)) {
    failures.push("side_polarity_coherence");
  }
  if (input.candidate.totalStrength < PERIMETER_GRADIENT_MIN_TOTAL_STRENGTH) failures.push("total_gradient");
  return failures;
}

function candidateWithinPerimeterGates(input: {
  candidate: PerimeterGradientCandidate;
  thresholds: CardGeometryThresholds;
  imageWidth: number;
  imageHeight: number;
}): boolean {
  return perimeterGradientGateFailures(input).length === 0;
}

function centerValues(length: number, step: number): number[] {
  const values = new Set<number>();
  const center = length / 2;
  for (let offset = -Math.ceil(length / step); offset <= Math.ceil(length / step); offset += 1) {
    const value = round(center + offset * step, 3);
    if (value > 0 && value < length) values.add(value);
  }
  return [...values].sort((left, right) => left - right);
}

async function attemptPerimeterGradientDetection(prepared: PreparedImage, thresholds: CardGeometryThresholds): Promise<DetectionAttempt> {
  const scale = Math.min(1, PERIMETER_GRADIENT_ANALYSIS_MAX_DIMENSION / Math.max(prepared.orientedWidth, prepared.orientedHeight));
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
  const luma = new Uint8Array(analysisWidth * analysisHeight);
  const borderHistogram = new Uint32Array(256);
  const differenceHistogram = new Uint32Array(256);
  const borderSize = Math.max(2, Math.round(Math.min(analysisWidth, analysisHeight) * 0.025));
  let borderCount = 0;
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * channels;
    const red = data[offset] ?? 0;
    const green = data[offset + Math.min(1, channels - 1)] ?? red;
    const blue = data[offset + Math.min(2, channels - 1)] ?? red;
    const value = lumaForRgb(red, green, blue);
    luma[index] = value;
    const x = index % analysisWidth;
    const y = Math.floor(index / analysisWidth);
    if (x < borderSize || x >= analysisWidth - borderSize || y < borderSize || y >= analysisHeight - borderSize) {
      borderHistogram[value] = (borderHistogram[value] ?? 0) + 1;
      borderCount += 1;
    }
  }
  const backgroundLuma = medianFromHistogram(borderHistogram, borderCount);
  for (const value of luma) {
    const difference = Math.abs(value - backgroundLuma);
    differenceHistogram[difference] = (differenceHistogram[difference] ?? 0) + 1;
  }
  const contrastRange = histogramPercentile(differenceHistogram, luma.length, 0.95);
  const diagnosticsBase: CardGeometryDetectionDiagnostics = {
    method: "perimeter_gradient_rectangle_v3",
    backgroundLuma,
    contrastRange,
    foregroundThreshold: PERIMETER_GRADIENT_MIN_SIDE_STRENGTH,
    foregroundPixelFraction: 0,
    expectedAspectRatio: thresholds.expectedAspectRatio,
    analysisWidth,
    analysisHeight,
  };
  if (contrastRange < 2) {
    return {
      diagnostics: diagnosticsBase,
      reason: "The captured full-resolution frame has no usable card-perimeter gradient.",
    };
  }

  const imageLandscape = analysisWidth >= analysisHeight;
  const area = analysisWidth * analysisHeight;
  const coarseSizeStep = Math.max(12, Math.round(Math.min(analysisWidth, analysisHeight) * 0.045));
  const coarseCenterStep = Math.max(18, Math.round(Math.min(analysisWidth, analysisHeight) * 0.055));
  const coarseCandidates: PerimeterGradientCandidate[] = [];
  const provisionalCoarseCandidates: PerimeterGradientCandidate[] = [];
  let closestRejectedCandidate: { candidate: PerimeterGradientCandidate; failures: PerimeterGradientGateFailure[] } | undefined;
  const recordCandidate = (candidate: PerimeterGradientCandidate) => {
    const failures = perimeterGradientGateFailures({
      candidate,
      thresholds,
      imageWidth: analysisWidth,
      imageHeight: analysisHeight,
    });
    if (!failures.length) {
      coarseCandidates.push(candidate);
      return;
    }
    // A coarse lattice can land a few analysis pixels away from a real weak
    // edge. It may seed local refinement only when every other captured-frame
    // gate already passes; the original signed threshold still governs the
    // final candidate and is never waived for normalization.
    if (failures.every((failure) => failure === "side_signed_gradient")) {
      provisionalCoarseCandidates.push(candidate);
    }
    const structuralFailures = new Set<PerimeterGradientGateFailure>(["coverage", "aspect", "clearance"]);
    const currentStructuralFailureCount = failures.filter((failure) => structuralFailures.has(failure)).length;
    const previousStructuralFailureCount = closestRejectedCandidate
      ? closestRejectedCandidate.failures.filter((failure) => structuralFailures.has(failure)).length
      : Number.POSITIVE_INFINITY;
    if (
      !closestRejectedCandidate ||
      currentStructuralFailureCount < previousStructuralFailureCount ||
      (currentStructuralFailureCount === previousStructuralFailureCount && failures.length < closestRejectedCandidate.failures.length) ||
      (currentStructuralFailureCount === previousStructuralFailureCount && failures.length === closestRejectedCandidate.failures.length && candidate.totalStrength > closestRejectedCandidate.candidate.totalStrength) ||
      (currentStructuralFailureCount === previousStructuralFailureCount && failures.length === closestRejectedCandidate.failures.length && candidate.totalStrength === closestRejectedCandidate.candidate.totalStrength && candidate.coverage > closestRejectedCandidate.candidate.coverage)
    ) {
      closestRejectedCandidate = { candidate, failures };
    }
  };
  const closestRejectionDiagnostics = () => {
    if (!closestRejectedCandidate) return undefined;
    const candidate = closestRejectedCandidate.candidate;
    return {
      reasons: closestRejectedCandidate.failures,
      measuredAspectRatio: round(candidate.aspectRatio, 5),
      cardCoverage: round(candidate.coverage, 5),
      clearance: round(candidate.clearance, 4),
      sideStrengths: candidate.sideStrengths,
      signedSideStrengths: candidate.sideSignedStrengths,
      sidePolarityConsistency: candidate.sidePolarityConsistency,
      sidePolarity: candidate.sidePolarity,
    };
  };
  for (const aspectFactor of PERIMETER_GRADIENT_ASPECT_FACTORS) {
    const aspectRatio = thresholds.expectedAspectRatio * aspectFactor;
    const minShort = Math.sqrt((thresholds.minCardCoverage * area) / aspectRatio);
    const maxShort = Math.sqrt((thresholds.maxCardCoverage * area) / aspectRatio);
    for (let shortSide = minShort; shortSide <= maxShort; shortSide += coarseSizeStep) {
      const longSide = shortSide * aspectRatio;
      const coverage = (longSide * shortSide) / area;
      for (const angleDegrees of PERIMETER_GRADIENT_ANGLE_DEGREES) {
        for (const centerX of centerValues(analysisWidth, coarseCenterStep)) {
          for (const centerY of centerValues(analysisHeight, coarseCenterStep)) {
            const score = scorePerimeterGradientCandidate({
              luma,
              width: analysisWidth,
              height: analysisHeight,
              centerX,
              centerY,
              longSide,
              shortSide,
              angleDegrees,
              imageLandscape,
            });
            const candidate: PerimeterGradientCandidate = {
              ...score,
              centerX,
              centerY,
              longSide,
              shortSide,
              aspectRatio,
              coverage,
              angleDegrees,
            };
            recordCandidate(candidate);
          }
        }
      }
    }
  }
  if (!coarseCandidates.length && !provisionalCoarseCandidates.length) {
    const closest = closestRejectionDiagnostics();
    return {
      diagnostics: {
        ...diagnosticsBase,
        perimeterCandidateCount: 0,
        perimeterProvisionalCandidateCount: 0,
        ...(closest ? { perimeterClosestRejectedCandidate: closest } : {}),
      },
      reason: closest
        ? `No complete four-edge card perimeter passed the captured-frame gates; the closest candidate failed: ${closest.reasons.join(", ")}.`
        : "No complete four-edge card perimeter had a usable captured-frame gradient.",
    };
  }
  // Physical-card candidates are ranked by safe captured-frame coverage first;
  // a smaller internal artwork rectangle may never replace a larger validated
  // perimeter. Gradient strength breaks only equal-scale ties.
  const refinementSeeds = coarseCandidates.length ? coarseCandidates : provisionalCoarseCandidates;
  refinementSeeds.sort((left, right) =>
    right.coverage - left.coverage || right.totalStrength - left.totalStrength || left.angleDegrees - right.angleDegrees,
  );
  const coarse = refinementSeeds[0]!;
  const refinedCandidates: PerimeterGradientCandidate[] = [];
  if (candidateWithinPerimeterGates({ candidate: coarse, thresholds, imageWidth: analysisWidth, imageHeight: analysisHeight })) {
    refinedCandidates.push(coarse);
  }
  const refineCoverageFloor = Math.max(thresholds.minCardCoverage, coarse.coverage - 0.035);
  for (const deltaAngle of [-3, 0, 3]) {
    for (const deltaAspect of [-0.04, 0, 0.04]) {
      const aspectRatio = coarse.aspectRatio + deltaAspect;
      if (aspectRatio <= 0) continue;
      for (const deltaShort of [-12, -6, 0, 6, 12]) {
        const shortSide = coarse.shortSide + deltaShort;
        if (shortSide <= 0) continue;
        const longSide = shortSide * aspectRatio;
        const coverage = (longSide * shortSide) / area;
        if (coverage < refineCoverageFloor || coverage > thresholds.maxCardCoverage) continue;
        for (const deltaX of [-12, -6, 0, 6, 12]) {
          for (const deltaY of [-12, -6, 0, 6, 12]) {
            const centerX = coarse.centerX + deltaX;
            const centerY = coarse.centerY + deltaY;
            const score = scorePerimeterGradientCandidate({
              luma,
              width: analysisWidth,
              height: analysisHeight,
              centerX,
              centerY,
              longSide,
              shortSide,
              angleDegrees: coarse.angleDegrees + deltaAngle,
              imageLandscape,
            });
            const candidate: PerimeterGradientCandidate = {
              ...score,
              centerX,
              centerY,
              longSide,
              shortSide,
              aspectRatio,
              coverage,
              angleDegrees: coarse.angleDegrees + deltaAngle,
            };
            if (candidateWithinPerimeterGates({ candidate, thresholds, imageWidth: analysisWidth, imageHeight: analysisHeight })) {
              refinedCandidates.push(candidate);
            }
          }
        }
      }
    }
  }
  refinedCandidates.sort((left, right) =>
    right.coverage - left.coverage || right.totalStrength - left.totalStrength || left.angleDegrees - right.angleDegrees,
  );
  if (!refinedCandidates.length) {
    const closest = closestRejectionDiagnostics();
    return {
      diagnostics: {
        ...diagnosticsBase,
        perimeterCandidateCount: coarseCandidates.length,
        perimeterProvisionalCandidateCount: provisionalCoarseCandidates.length,
        ...(closest ? { perimeterClosestRejectedCandidate: closest } : {}),
      },
      reason: closest
        ? `No complete four-edge card perimeter passed after local refinement; the closest candidate failed: ${closest.reasons.join(", ")}.`
        : "No complete four-edge card perimeter passed local refinement.",
    };
  }
  const selected = refinedCandidates[0]!;
  const scaleX = prepared.orientedWidth / analysisWidth;
  const scaleY = prepared.orientedHeight / analysisHeight;
  const corners: CardGeometryCorners = {
    topLeft: scalePoint(selected.corners.topLeft, scaleX, scaleY),
    topRight: scalePoint(selected.corners.topRight, scaleX, scaleY),
    bottomRight: scalePoint(selected.corners.bottomRight, scaleX, scaleY),
    bottomLeft: scalePoint(selected.corners.bottomLeft, scaleX, scaleY),
  };
  const relativeAspectError = Math.abs(selected.aspectRatio - thresholds.expectedAspectRatio) / thresholds.expectedAspectRatio;
  const meanSideStrength = selected.totalStrength / 4;
  const gradientStrengthScore = clamp(
    (meanSideStrength - PERIMETER_GRADIENT_MIN_SIDE_STRENGTH) / Math.max(0.1, 8 - PERIMETER_GRADIENT_MIN_SIDE_STRENGTH),
    0,
    1,
  );
  // This score is evaluated only after every absolute, signed, and per-side
  // polarity gate above has passed. Each side is independently checked because
  // directional illumination can reverse an otherwise valid local transition;
  // browser and preview geometry never participate in this decision.
  const polarityCoherenceScore = clamp(
    (Math.min(...selected.sidePolarityConsistency) - PERIMETER_GRADIENT_MIN_POLARITY_CONSISTENCY) /
      Math.max(0.01, 1 - PERIMETER_GRADIENT_MIN_POLARITY_CONSISTENCY),
    0,
    1,
  );
  const edgeScore = clamp(gradientStrengthScore * 0.4 + polarityCoherenceScore * 0.6, 0, 1);
  const aspectScore = clamp(1 - relativeAspectError / Math.max(0.01, thresholds.maxRelativeAspectError), 0, 1);
  const coverageScore =
    selected.coverage < thresholds.minCardCoverage
      ? 0
      : selected.coverage > thresholds.maxCardCoverage
        ? 0
        : 1;
  const confidence = round(0.32 * aspectScore + 0.22 * coverageScore + 0.31 * edgeScore + 0.15, 4);
  const rotationDegrees = round(normalizeRotationDegrees((Math.atan2(selected.shortAxis.y, selected.shortAxis.x) * 180) / Math.PI), 3);
  const diagnostics: CardGeometryDetectionDiagnostics = {
    ...diagnosticsBase,
    measuredAspectRatio: round(selected.aspectRatio, 5),
    relativeAspectError: round(relativeAspectError, 5),
    perimeterGradientStrength: round(selected.totalStrength, 4),
    perimeterSideStrengths: selected.sideStrengths,
    perimeterSignedSideStrengths: selected.sideSignedStrengths,
    perimeterSidePolarityConsistency: selected.sidePolarityConsistency,
    perimeterSidePolarity: selected.sidePolarity,
    perimeterCandidateCount: refinedCandidates.length,
    perimeterProvisionalCandidateCount: provisionalCoarseCandidates.length,
  };
  return {
    diagnostics,
    candidate: {
      corners,
      boundingBox: boundingBoxForCorners(corners),
      rotationDegrees,
      confidence,
      shortSidePixels: selected.shortSide * scaleX,
      longSidePixels: selected.longSide * scaleY,
      cardCoverage: selected.coverage,
      measuredAspectRatio: selected.aspectRatio,
      relativeAspectError,
      diagnostics,
    },
  };
}

async function attemptDetection(
  prepared: PreparedImage,
  thresholds: CardGeometryThresholds,
  detectionPolicy: AiGraderCardGeometryDetectionPolicy,
  observer: DetectCardGeometryInput["onDetectionAttempt"],
): Promise<DetectionAttempt> {
  const solidPlateStartedAt = performance.now();
  const solidPlate = await attemptSolidPlateDetection(prepared, thresholds);
  reportDetectionAttempt(observer, {
    detectionPolicy,
    method: "solid_plate_color_component_pca_v2",
    outcome: solidPlate.candidate ? "candidate" : "no_candidate",
  }, solidPlateStartedAt);
  if (solidPlate.candidate) return solidPlate;

  // The live preview policy is deliberately bounded to the fast solid-plate
  // detector. Full-resolution perimeter v3 is captured-evidence-only work.
  if (detectionPolicy === "live_preview_fast") return solidPlate;

  const perimeterStartedAt = performance.now();
  const perimeter = await attemptPerimeterGradientDetection(prepared, thresholds);
  reportDetectionAttempt(observer, {
    detectionPolicy,
    method: "perimeter_gradient_rectangle_v3",
    outcome: perimeter.candidate ? "candidate" : "no_candidate",
  }, perimeterStartedAt);
  if (perimeter.candidate) return perimeter;
  return {
    diagnostics: perimeter.diagnostics,
    reason: perimeter.reason ?? solidPlate.reason ?? "No reliable captured-frame card geometry was detected.",
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
  const edgeClearance = Math.min(input.imageWidth, input.imageHeight) * input.thresholds.minEdgeClearanceRatio;
  const withinFrame =
    input.boundingBox.x >= edgeClearance &&
    input.boundingBox.y >= edgeClearance &&
    input.boundingBox.x + input.boundingBox.width <= input.imageWidth - edgeClearance &&
    input.boundingBox.y + input.boundingBox.height <= input.imageHeight - edgeClearance;
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

function placementState(placement: CardGeometryPlacementEvaluation): CardPlacementState {
  return placement.withinAspectTolerance &&
    placement.withinCoverageTolerance &&
    placement.withinFrame &&
    placement.withinNormalizationSkewTolerance &&
    placement.confidenceReady
    ? "ready"
    : "adjust_card";
}

function placementAdjustmentReason(
  placement: CardGeometryPlacementEvaluation,
): CardGeometryAdjustmentReason | null {
  if (!placement.withinFrame) return "outside_frame";
  if (!placement.withinCoverageTolerance) return "unsafe_scale";
  if (!placement.withinNormalizationSkewTolerance) return "rotate_top_up";
  if (!placement.withinAspectTolerance) return "wrong_aspect";
  if (!placement.confidenceReady) return "low_confidence";
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
  if (!placement.withinAspectTolerance) warnings.push("Detected card aspect ratio is outside tolerance.");
  if (!placement.withinCoverageTolerance) warnings.push("Detected card coverage is outside the safe normalization range.");
  if (!placement.withinFrame) warnings.push("Card is too close to an image edge for safe normalization.");
  if (!placement.confidenceReady) warnings.push("Card detection confidence is below the Ready threshold.");
  return warnings;
}

async function buildGeometry(input: DetectCardGeometryInput, prepared: PreparedImage): Promise<CardGeometryMetadata> {
  const detectionPolicy = requireDetectionPolicy(input.detectionPolicy);
  const thresholds = normalizeThresholds(input.thresholds);
  const timestamp = normalizeTimestamp(input.timestamp);

  const detection = await attemptDetection(prepared, thresholds, detectionPolicy, input.onDetectionAttempt);

  const candidate = detection.candidate;
  if (!candidate || candidate.confidence < thresholds.minDetectionConfidence) {
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
      warnings: [detection.reason ?? "No reliable four-corner card geometry was detected."],
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
  });
  return {
    version: CARD_GEOMETRY_VERSION,
    detectionPolicy,
    side: input.side,
    placementState: placementState(placement),
    adjustmentReason: placementAdjustmentReason(placement),
    geometrySource: "detected",
    captureMode: "automatic_detection",
    confidenceBasis: "automatic_detection",
    detectionUsed: true,
    manualOverrideUsed: false,
    corners: candidate.corners,
    detectedCorners: candidate.corners,
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
  const transformed = [
    geometry.corners.topLeft,
    geometry.corners.topRight,
    geometry.corners.bottomRight,
    geometry.corners.bottomLeft,
  ].map((point) =>
    transformPointForRotation(
      point,
      prepared.orientedWidth,
      prepared.orientedHeight,
      rotated.info.width,
      rotated.info.height,
      deskewDegrees,
    ),
  );
  const left = clamp(Math.floor(Math.min(...transformed.map((point) => point.x))), 0, rotated.info.width - 1);
  const top = clamp(Math.floor(Math.min(...transformed.map((point) => point.y))), 0, rotated.info.height - 1);
  const right = clamp(Math.ceil(Math.max(...transformed.map((point) => point.x))), left + 1, rotated.info.width);
  const bottom = clamp(Math.ceil(Math.max(...transformed.map((point) => point.y))), top + 1, rotated.info.height);
  const cropWidth = right - left;
  const cropHeight = bottom - top;
  if (cropWidth < 5 || cropHeight < 7) throw new Error("Detected card geometry is too small to create a 5:7 normalized artifact.");
  const targetWidth = NORMALIZED_CARD_WIDTH_PIXELS;
  const targetHeight = NORMALIZED_CARD_HEIGHT_PIXELS;
  const geometricResamplingApplied = cropWidth !== targetWidth || cropHeight !== targetHeight;
  const upscaled = targetWidth > cropWidth || targetHeight > cropHeight;
  const compressionLevel = Math.round(clamp(input.pngCompressionLevel ?? 6, 0, 9));
  await sharp(rotated.data)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .resize(targetWidth, targetHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel, adaptiveFiltering: true })
    .toFile(outputResolved);
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
    scaleX: round(targetWidth / cropWidth, 6),
    scaleY: round(targetHeight / cropHeight, 6),
    coordinateFrame: "normalized_card_portrait_pixels",
    sourceSha256: prepared.rawArtifact.sha256,
    deskewAppliedDegrees: round(deskewDegrees, 3),
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
