import { spawn } from "node:child_process";
import path from "node:path";
import {
  CARD_GEOMETRY_VERSION,
  type CardGeometryMetadata,
} from "./cardGeometry";

export interface MathematicalCalibrationPreviewPoint {
  x: number;
  y: number;
}

export interface MathematicalCalibrationPreviewCheckerboard {
  imageWidth: number;
  imageHeight: number;
  internalCorners: readonly MathematicalCalibrationPreviewPoint[];
  outerCorners: readonly [
    MathematicalCalibrationPreviewPoint,
    MathematicalCalibrationPreviewPoint,
    MathematicalCalibrationPreviewPoint,
    MathematicalCalibrationPreviewPoint,
  ];
  rotationDegrees: number;
}

const DETECTOR_SCRIPT = path.resolve(__dirname, "../../../../scripts/ai-grader/detect-mathematical-calibration-preview-checkerboard.py");

function finitePoint(value: unknown): value is MathematicalCalibrationPreviewPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" && Number.isFinite(point.x)
    && typeof point.y === "number" && Number.isFinite(point.y);
}

function parseResult(stdout: string): MathematicalCalibrationPreviewCheckerboard {
  const parsed = JSON.parse(stdout) as Partial<MathematicalCalibrationPreviewCheckerboard>;
  const imageWidth = parsed.imageWidth;
  const imageHeight = parsed.imageHeight;
  const internalCorners = parsed.internalCorners;
  const outerCorners = parsed.outerCorners;
  if (typeof imageWidth !== "number" || typeof imageHeight !== "number"
    || !Number.isInteger(imageWidth) || !Number.isInteger(imageHeight)
    || imageWidth <= 0 || imageHeight <= 0
    || !Array.isArray(internalCorners) || internalCorners.length !== 176
    || !Array.isArray(outerCorners) || outerCorners.length !== 4
    || !outerCorners.every(finitePoint)
    || !internalCorners.every(finitePoint)
    || typeof parsed.rotationDegrees !== "number" || !Number.isFinite(parsed.rotationDegrees)) {
    throw new Error("calibration preview checkerboard detector returned invalid geometry");
  }
  return {
    imageWidth,
    imageHeight,
    internalCorners,
    outerCorners: outerCorners as MathematicalCalibrationPreviewCheckerboard["outerCorners"],
    rotationDegrees: parsed.rotationDegrees,
  };
}

function outerContourCoverage(
  corners: MathematicalCalibrationPreviewCheckerboard["outerCorners"],
  imageWidth: number,
  imageHeight: number,
): number {
  const doubledArea = corners.reduce((total, point, index) => {
    const next = corners[(index + 1) % corners.length]!;
    return total + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(doubledArea) / 2 / (imageWidth * imageHeight);
}

/**
 * Convert the authoritative checkerboard result into the reusable geometry
 * contract consumed by the unchanged normalizer. This is intentionally a
 * capture-time conversion; preview geometry is never accepted as input.
 */
export function checkerboardGeometryMetadata(
  result: MathematicalCalibrationPreviewCheckerboard,
  source: { sourceImageId: string; sourceFrameId: string; timestamp: string },
): CardGeometryMetadata {
  const points = [...result.outerCorners];
  if (
    points.some((point) =>
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x <= 0 || point.x >= result.imageWidth ||
      point.y <= 0 || point.y >= result.imageHeight,
    )
  ) {
    throw new Error("Checkerboard capture geometry must be finite and fully inside the source frame.");
  }
  const coverage = outerContourCoverage(result.outerCorners, result.imageWidth, result.imageHeight);
  if (!Number.isFinite(coverage) || coverage <= 0 || coverage > 1) {
    throw new Error("Checkerboard capture geometry has invalid outer-contour coverage.");
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const expectedRotation = result.imageWidth > result.imageHeight ? 90 : 0;
  const placementSkew = expectedRotation === 90
    ? Math.abs(90 - Math.abs(result.rotationDegrees))
    : Math.abs(result.rotationDegrees);
  const relativeAspectError = Math.abs((longSide / Math.max(1, shortSide)) - (3.5 / 2.5)) / (3.5 / 2.5);
  const pixelsPerInch = (shortSide / 2.5 + longSide / 3.5) / 2;
  const edgeClearance = Math.min(result.imageWidth, result.imageHeight) * 0.01;
  const withinFrame = minX >= edgeClearance && minY >= edgeClearance
    && maxX <= result.imageWidth - edgeClearance && maxY <= result.imageHeight - edgeClearance;
  const corners = {
    topLeft: points[0]!,
    topRight: points[1]!,
    bottomRight: points[2]!,
    bottomLeft: points[3]!,
  };
  const placement = {
    centerOffsetPixels: {
      x: Number((centerX - result.imageWidth / 2).toFixed(3)),
      y: Number((centerY - result.imageHeight / 2).toFixed(3)),
      distance: Number((Math.hypot(centerX - result.imageWidth / 2, centerY - result.imageHeight / 2)).toFixed(3)),
      maxAxis: Number((Math.max(Math.abs(centerX - result.imageWidth / 2), Math.abs(centerY - result.imageHeight / 2))).toFixed(3)),
    },
    centerOffsetInches: {
      x: Number(((centerX - result.imageWidth / 2) / Math.max(1, pixelsPerInch)).toFixed(4)),
      y: Number(((centerY - result.imageHeight / 2) / Math.max(1, pixelsPerInch)).toFixed(4)),
      distance: Number((Math.hypot(centerX - result.imageWidth / 2, centerY - result.imageHeight / 2) / Math.max(1, pixelsPerInch)).toFixed(4)),
      maxAxis: Number((Math.max(Math.abs(centerX - result.imageWidth / 2), Math.abs(centerY - result.imageHeight / 2)) / Math.max(1, pixelsPerInch)).toFixed(4)),
    },
    estimatedPixelsPerInch: Number(pixelsPerInch.toFixed(4)),
    maxCenterOffsetInches: 0.5,
    maxSkewDegrees: 10,
    maxNormalizationSkewDegrees: 35,
    minReadyConfidence: 0.72,
    withinCenterTolerance: true,
    withinSkewTolerance: placementSkew <= 10.25,
    withinNormalizationSkewTolerance: placementSkew <= 35.25,
    withinAspectTolerance: relativeAspectError <= 0.18,
    withinCoverageTolerance: coverage >= 0.3 && coverage <= 0.85,
    withinFrame,
    confidenceReady: true,
    cardCoverage: Number(coverage.toFixed(6)),
  };
  if (!placement.withinSkewTolerance || !placement.withinNormalizationSkewTolerance
    || !placement.withinAspectTolerance || !placement.withinCoverageTolerance || !placement.withinFrame) {
    throw new Error("Checkerboard capture geometry does not satisfy the finite in-frame normalization envelope.");
  }
  return {
    version: CARD_GEOMETRY_VERSION,
    detectionPolicy: "captured_evidence_full",
    side: "front",
    placementState: "ready",
    adjustmentReason: null,
    geometrySource: "detected",
    captureMode: "automatic_detection",
    confidenceBasis: "automatic_detection",
    detectionUsed: true,
    manualOverrideUsed: false,
    corners,
    detectedCorners: corners,
    boundingBox: { x: minX, y: minY, width, height },
    rotationDegrees: result.rotationDegrees,
    skewDegrees: placementSkew,
    confidence: 1,
    sourceImageId: source.sourceImageId,
    sourceFrameId: source.sourceFrameId,
    timestamp: source.timestamp,
    image: { width: result.imageWidth, height: result.imageHeight, coordinateFrame: "source_image_pixels" },
    semanticOrientation: {
      canonicalOrientation: "portrait",
      basis: "operator_top_toward_preview_top",
      contentUprightVerified: false,
    },
    placement,
    detection: {
      method: "opencv_find_chessboard_corners_sb_v1",
      backgroundLuma: 128,
      contrastRange: 255,
      foregroundThreshold: 0,
      foregroundPixelFraction: 1,
      expectedAspectRatio: 3.5 / 2.5,
      relativeAspectError,
      analysisWidth: result.imageWidth,
      analysisHeight: result.imageHeight,
    },
    warnings: [],
  };
}

export function detectMathematicalCalibrationPreviewCheckerboard(
  imageBuffer: Buffer,
  options: { pythonExecutable?: string; timeoutMs?: number; scriptPath?: string } = {},
): Promise<MathematicalCalibrationPreviewCheckerboard> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.pythonExecutable ?? "python", [options.scriptPath ?? DETECTOR_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        reject(new Error("calibration preview checkerboard detection timed out"));
      }
    }, options.timeoutMs ?? 10000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else {
        try { resolve(parseResult(stdout)); }
        catch (parseError) { reject(parseError); }
      }
    };
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(code === 0 ? undefined : new Error(stderr.trim() || `checkerboard detector exited with code ${code ?? 1}`)));
    child.stdin.end(imageBuffer);
  });
}
