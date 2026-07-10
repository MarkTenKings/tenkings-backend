import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const CARD_GEOMETRY_VERSION = "ten-kings-card-geometry-v1";
export const STANDARD_CARD_WIDTH_INCHES = 2.5;
export const STANDARD_CARD_HEIGHT_INCHES = 3.5;

export type CardGeometrySide = "front" | "back";
export type CardPlacementState = "not_detected" | "adjust_card" | "ready";
export type CardGeometrySource = "detected" | "manual_override" | "none";
export type CardGeometryCaptureMode = "automatic_detection" | "manual_capture" | "none";

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
  maxSkewDegrees: number;
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
  method: "adaptive_border_contrast_connected_component_pca_v1";
  backgroundLuma: number;
  contrastRange: number;
  foregroundThreshold: number;
  foregroundPixelFraction: number;
  componentPixelFraction?: number;
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
  minReadyConfidence: number;
  withinCenterTolerance: boolean;
  withinSkewTolerance: boolean;
  withinAspectTolerance: boolean;
  withinFrame: boolean;
  confidenceReady: boolean;
}

/**
 * Geometry metadata is deliberately path-free. Local artifact paths live only
 * on CardGeometryNormalizationResult and must not be copied to public output.
 */
export interface CardGeometryMetadata {
  version: typeof CARD_GEOMETRY_VERSION;
  side: CardGeometrySide;
  placementState: CardPlacementState;
  geometrySource: CardGeometrySource;
  captureMode: CardGeometryCaptureMode;
  /** Describes what the numeric confidence represents. */
  confidenceBasis: "automatic_detection" | "operator_confirmation" | "none";
  detectionUsed: boolean;
  /** Explicit operator-selected manual geometry; never an automatic fallback. */
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
  placement: CardGeometryPlacementEvaluation;
  detection: CardGeometryDetectionDiagnostics;
  warnings: string[];
}

export interface CardGeometryManualOverride {
  action: "manual_capture";
  confirmed: true;
  rect: CardGeometryBoundingBox;
}

export interface DetectCardGeometryInput {
  sourceImagePath: string;
  side: CardGeometrySide;
  sourceImageId?: string;
  sourceFrameId?: string;
  timestamp?: string;
  thresholds?: Partial<CardGeometryThresholds>;
  manualOverride?: CardGeometryManualOverride;
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
  lossless: true;
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

interface PreparedImage {
  orientedPng: Buffer;
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
  minReadyConfidence: 0.72,
  minDetectionConfidence: 0.35,
  expectedAspectRatio: STANDARD_CARD_HEIGHT_INCHES / STANDARD_CARD_WIDTH_INCHES,
  maxRelativeAspectError: 0.18,
  minCardCoverage: 0.08,
  maxCardCoverage: 0.9,
  minEdgeClearanceRatio: 0.01,
  analysisMaxDimension: 1024,
};

// Sub-pixel antialiasing can move a PCA edge estimate by a few tenths of a
// degree. Keep the operator boundary inclusive at the configured threshold.
const SKEW_ESTIMATION_EPSILON_DEGREES = 0.25;

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
  const oriented = await sharp(rawBytes).autoOrient().png().toBuffer({ resolveWithObject: true });
  return {
    rawBytes,
    orientedPng: oriented.data,
    orientedWidth: oriented.info.width,
    orientedHeight: oriented.info.height,
    rawArtifact: {
      fileName,
      sha256: createHash("sha256").update(rawBytes).digest("hex"),
      byteSize: rawBytes.length,
      mimeType: mimeTypeForFormat(rawMetadata.format),
      imageWidth: rawMetadata.width ?? oriented.info.width,
      imageHeight: rawMetadata.height ?? oriented.info.height,
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

async function attemptDetection(prepared: PreparedImage, thresholds: CardGeometryThresholds): Promise<DetectionAttempt> {
  const scale = Math.min(1, thresholds.analysisMaxDimension / Math.max(prepared.orientedWidth, prepared.orientedHeight));
  const analysisWidth = Math.max(32, Math.round(prepared.orientedWidth * scale));
  const analysisHeight = Math.max(32, Math.round(prepared.orientedHeight * scale));
  const { data } = await sharp(prepared.orientedPng)
    .resize(analysisWidth, analysisHeight, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const borderHistogram = new Uint32Array(256);
  const borderSize = Math.max(2, Math.round(Math.min(analysisWidth, analysisHeight) * 0.025));
  let borderCount = 0;
  for (let y = 0; y < analysisHeight; y += 1) {
    for (let x = 0; x < analysisWidth; x += 1) {
      if (x >= borderSize && x < analysisWidth - borderSize && y >= borderSize && y < analysisHeight - borderSize) continue;
      const value = data[y * analysisWidth + x] ?? 0;
      borderHistogram[value] = (borderHistogram[value] ?? 0) + 1;
      borderCount += 1;
    }
  }
  const backgroundLuma = medianFromHistogram(borderHistogram, borderCount);
  const differenceHistogram = new Uint32Array(256);
  const differences = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const difference = Math.abs((data[index] ?? 0) - backgroundLuma);
    differences[index] = difference;
    differenceHistogram[difference] = (differenceHistogram[difference] ?? 0) + 1;
  }
  const contrastRange = histogramPercentile(differenceHistogram, data.length, 0.95);
  const foregroundThreshold = Math.round(clamp(Math.max(12, contrastRange * 0.3), 12, 72));
  const diagnosticsBase: CardGeometryDetectionDiagnostics = {
    method: "adaptive_border_contrast_connected_component_pca_v1",
    backgroundLuma,
    contrastRange,
    foregroundThreshold,
    foregroundPixelFraction: 0,
    expectedAspectRatio: thresholds.expectedAspectRatio,
    analysisWidth,
    analysisHeight,
  };
  if (contrastRange < 18) return { diagnostics: diagnosticsBase, reason: "Image contrast is too low to distinguish the card from the background." };

  const mask = new Uint8Array(data.length);
  let foregroundCount = 0;
  for (let index = 0; index < differences.length; index += 1) {
    if ((differences[index] ?? 0) < foregroundThreshold) continue;
    mask[index] = 1;
    foregroundCount += 1;
  }
  diagnosticsBase.foregroundPixelFraction = round(foregroundCount / Math.max(1, data.length), 6);
  const { labels, components } = labelForegroundComponents(mask, differences, analysisWidth, analysisHeight);
  const minimumComponentPixels = Math.max(64, Math.round(data.length * thresholds.minCardCoverage * 0.2));
  const component = components
    .filter((entry) => entry.count >= minimumComponentPixels)
    .sort((left, right) => right.count - left.count)[0];
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
  const meanDifference = component.sumDifference / component.count;
  const aspectScore = clamp(1 - relativeAspectError / Math.max(0.01, thresholds.maxRelativeAspectError * 1.5), 0, 1);
  const fillScore = clamp((componentFill - 0.25) / 0.65, 0, 1);
  const contrastScore = clamp((meanDifference - foregroundThreshold) / Math.max(20, contrastRange - foregroundThreshold), 0, 1);
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
    componentPixelFraction: round(component.count / Math.max(1, data.length), 6),
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

function validateManualOverride(
  override: CardGeometryManualOverride,
  imageWidth: number,
  imageHeight: number,
): { corners: CardGeometryCorners; boundingBox: CardGeometryBoundingBox; shortSidePixels: number; longSidePixels: number } {
  if (override.action !== "manual_capture" || override.confirmed !== true) {
    throw new Error("manualOverride requires action=manual_capture and confirmed=true.");
  }
  const rect = override.rect;
  for (const [name, value] of Object.entries(rect)) {
    if (!Number.isFinite(value)) throw new Error(`manualOverride.rect.${name} must be finite.`);
  }
  if (rect.width <= 0 || rect.height <= 0) throw new Error("manualOverride.rect width and height must be positive.");
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > imageWidth || rect.y + rect.height > imageHeight) {
    throw new Error("manualOverride.rect must remain inside the source image.");
  }
  const corners: CardGeometryCorners = {
    topLeft: { x: rect.x, y: rect.y },
    topRight: { x: rect.x + rect.width, y: rect.y },
    bottomRight: { x: rect.x + rect.width, y: rect.y + rect.height },
    bottomLeft: { x: rect.x, y: rect.y + rect.height },
  };
  return {
    corners,
    boundingBox: { ...rect },
    shortSidePixels: Math.min(rect.width, rect.height),
    longSidePixels: Math.max(rect.width, rect.height),
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
    minReadyConfidence: input.thresholds.minReadyConfidence,
    withinCenterTolerance: Math.max(Math.abs(inchX), Math.abs(inchY)) <= input.thresholds.maxCenterOffsetInches,
    withinSkewTolerance:
      Math.abs(input.skewDegrees) <= input.thresholds.maxSkewDegrees + SKEW_ESTIMATION_EPSILON_DEGREES,
    withinAspectTolerance: input.relativeAspectError <= input.thresholds.maxRelativeAspectError,
    withinFrame,
    confidenceReady: input.confidence >= input.thresholds.minReadyConfidence,
  };
}

function emptyPlacement(thresholds: CardGeometryThresholds): CardGeometryPlacementEvaluation {
  return {
    maxCenterOffsetInches: thresholds.maxCenterOffsetInches,
    maxSkewDegrees: thresholds.maxSkewDegrees,
    minReadyConfidence: thresholds.minReadyConfidence,
    withinCenterTolerance: false,
    withinSkewTolerance: false,
    withinAspectTolerance: false,
    withinFrame: false,
    confidenceReady: false,
  };
}

function placementState(placement: CardGeometryPlacementEvaluation): CardPlacementState {
  return placement.withinCenterTolerance &&
    placement.withinSkewTolerance &&
    placement.withinAspectTolerance &&
    placement.withinFrame &&
    placement.confidenceReady
    ? "ready"
    : "adjust_card";
}

function placementWarnings(placement: CardGeometryPlacementEvaluation, source: CardGeometrySource): string[] {
  const warnings: string[] = [];
  if (source === "manual_override") {
    warnings.push("Automatic geometry was not used; an operator explicitly confirmed manual capture geometry.");
  }
  if (!placement.withinCenterTolerance) warnings.push("Card center is outside the configured close-enough placement tolerance.");
  if (!placement.withinSkewTolerance) warnings.push("Card rotation is outside the configured skew tolerance.");
  if (!placement.withinAspectTolerance) warnings.push("Detected card aspect ratio is outside tolerance.");
  if (!placement.withinFrame) warnings.push("Card is too close to an image edge for safe normalization.");
  if (!placement.confidenceReady) warnings.push("Card detection confidence is below the Ready threshold.");
  return warnings;
}

async function buildGeometry(input: DetectCardGeometryInput, prepared: PreparedImage): Promise<CardGeometryMetadata> {
  const thresholds = normalizeThresholds(input.thresholds);
  const timestamp = normalizeTimestamp(input.timestamp);
  const detection = await attemptDetection(prepared, thresholds);

  if (input.manualOverride) {
    const override = validateManualOverride(input.manualOverride, prepared.orientedWidth, prepared.orientedHeight);
    const measuredAspectRatio = override.longSidePixels / override.shortSidePixels;
    const relativeAspectError = Math.abs(measuredAspectRatio - thresholds.expectedAspectRatio) / thresholds.expectedAspectRatio;
    const rotationDegrees = override.boundingBox.width > override.boundingBox.height ? 90 : 0;
    const skewDegrees = placementSkewDegrees(rotationDegrees, prepared.orientedWidth, prepared.orientedHeight);
    const placement = placementEvaluation({
      ...override,
      skewDegrees,
      confidence: 0,
      relativeAspectError,
      imageWidth: prepared.orientedWidth,
      imageHeight: prepared.orientedHeight,
      thresholds,
    });
    let automaticCandidateWasOutsideThresholds = false;
    if (detection.candidate && detection.candidate.confidence >= thresholds.minDetectionConfidence) {
      const automaticPlacement = placementEvaluation({
        corners: detection.candidate.corners,
        boundingBox: detection.candidate.boundingBox,
        shortSidePixels: detection.candidate.shortSidePixels,
        longSidePixels: detection.candidate.longSidePixels,
        skewDegrees: placementSkewDegrees(
          detection.candidate.rotationDegrees,
          prepared.orientedWidth,
          prepared.orientedHeight,
        ),
        confidence: detection.candidate.confidence,
        relativeAspectError: detection.candidate.relativeAspectError,
        imageWidth: prepared.orientedWidth,
        imageHeight: prepared.orientedHeight,
        thresholds,
      });
      automaticCandidateWasOutsideThresholds = placementState(automaticPlacement) === "adjust_card";
    }
    return {
      version: CARD_GEOMETRY_VERSION,
      side: input.side,
      // Ready is reserved for confident automatic detection. A manual capture
      // may still normalize an operator-confirmed rectangle, but never claims
      // automatic placement readiness.
      placementState: automaticCandidateWasOutsideThresholds ? "adjust_card" : "not_detected",
      geometrySource: "manual_override",
      captureMode: "manual_capture",
      confidenceBasis: "operator_confirmation",
      detectionUsed: false,
      manualOverrideUsed: true,
      corners: override.corners,
      detectedCorners: null,
      boundingBox: override.boundingBox,
      rotationDegrees,
      skewDegrees: round(skewDegrees, 3),
      confidence: 0,
      ...(sanitizeSourceId(input.sourceImageId) ? { sourceImageId: sanitizeSourceId(input.sourceImageId) } : {}),
      ...(sanitizeSourceId(input.sourceFrameId) ? { sourceFrameId: sanitizeSourceId(input.sourceFrameId) } : {}),
      timestamp,
      image: { width: prepared.orientedWidth, height: prepared.orientedHeight, coordinateFrame: "source_image_pixels" },
      placement,
      detection: detection.diagnostics,
      warnings: placementWarnings(placement, "manual_override"),
    };
  }

  const candidate = detection.candidate;
  if (!candidate || candidate.confidence < thresholds.minDetectionConfidence) {
    return {
      version: CARD_GEOMETRY_VERSION,
      side: input.side,
      placementState: "not_detected",
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
    imageWidth: prepared.orientedWidth,
    imageHeight: prepared.orientedHeight,
    thresholds,
  });
  return {
    version: CARD_GEOMETRY_VERSION,
    side: input.side,
    placementState: placementState(placement),
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
    placement,
    detection: candidate.diagnostics,
    warnings: placementWarnings(placement, "detected"),
  };
}

export async function detectCardGeometry(input: DetectCardGeometryInput): Promise<CardGeometryMetadata> {
  const prepared = await prepareImage(input.sourceImagePath);
  return buildGeometry(input, prepared);
}

export async function detectCardGeometryFromBuffer(input: DetectCardGeometryBufferInput): Promise<CardGeometryMetadata> {
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

async function normalizePreparedImage(
  input: DetectAndNormalizeCardImageInput,
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
  const deskewDegrees = -geometry.rotationDegrees;
  const background = geometry.detection.backgroundLuma;
  const rotated = await sharp(prepared.orientedPng)
    .rotate(deskewDegrees, { background: { r: background, g: background, b: background, alpha: 1 } })
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
  const compressionLevel = Math.round(clamp(input.pngCompressionLevel ?? 9, 0, 9));
  await sharp(rotated.data)
    .extract({ left, top, width: right - left, height: bottom - top })
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
    imageWidth: outputMetadata.width ?? right - left,
    imageHeight: outputMetadata.height ?? bottom - top,
    lossless: true,
    coordinateFrame: "normalized_card_portrait_pixels",
    sourceSha256: prepared.rawArtifact.sha256,
    deskewAppliedDegrees: round(deskewDegrees, 3),
  };
}

export async function detectAndNormalizeCardImage(
  input: DetectAndNormalizeCardImageInput,
): Promise<CardGeometryNormalizationResult> {
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

export function defaultCardGeometryThresholds(): CardGeometryThresholds {
  return { ...DEFAULT_THRESHOLDS };
}
