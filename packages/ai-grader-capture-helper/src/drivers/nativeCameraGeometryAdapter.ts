import {
  CARD_GEOMETRY_VERSION,
  type CardGeometryBoundingBox,
  type CardGeometryMetadata,
} from "./cardGeometry";
import type { NativeCameraGeometryResult } from "./nativeCameraProtocol";

export interface NativeCameraAdaptedGeometry {
  /** Existing path-free capture-helper geometry contract. */
  geometry: CardGeometryMetadata;
  /** Additive native evidence retained without changing grading algorithms. */
  nativeDetector: {
    version: "native_four_edge_v2";
    reasonCodes: string[];
    fittedLines: NativeCameraGeometryResult["fittedLines"];
    normalizedCorners: NativeCameraGeometryResult["normalizedCorners"];
    metrics: NativeCameraGeometryResult["metrics"];
    processingMs: number;
    frameAgeMs: number;
    droppedFrames: number;
    frozen: boolean;
    stale: boolean;
    motionDelta: number | null;
    hysteresis: NativeCameraGeometryResult["hysteresis"];
    currentFrameAuthority: NativeCameraGeometryResult["currentFrameAuthority"];
    calibration: NativeCameraGeometryResult["calibration"];
    sensorOrientation: NativeCameraGeometryResult["sensorOrientation"];
  };
}

function boundingBox(geometry: NativeCameraGeometryResult): CardGeometryBoundingBox | null {
  if (!geometry.sourceCorners) return null;
  const points = Object.values(geometry.sourceCorners);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

/**
 * Adapts native geometry to the existing path-free metadata shape. The legacy
 * diagnostics method field is a compatibility slot only; the additive
 * nativeDetector block is the authoritative detector provenance and metrics.
 */
export function adaptNativeCameraGeometry(
  native: NativeCameraGeometryResult,
  receivedAtUnixMs = Date.now(),
): NativeCameraAdaptedGeometry {
  if (native.frame.side === "none") throw new Error("Native geometry requires a front or back side epoch.");
  const detected = native.sourceCorners !== null;
  const ready =
    native.status === "ready" &&
    !native.frozen &&
    !native.stale &&
    native.hysteresis.currentEvidenceReady &&
    native.currentFrameAuthority.captureReady;
  const box = boundingBox(native);
  const estimatedPixelsPerInch = box ? Math.min(box.width / 2.5, box.height / 3.5) : undefined;
  const centerX = native.center?.x;
  const centerY = native.center?.y;
  const offsetX = centerX === undefined ? undefined : centerX - native.sourceWidth / 2;
  const offsetY = centerY === undefined ? undefined : centerY - native.sourceHeight / 2;
  const adjustmentReason: CardGeometryMetadata["adjustmentReason"] = ready
    ? null
    : !detected
      ? "not_detected"
      : !native.metrics.fullVisibility
        ? "outside_frame"
        : native.metrics.aspectScore < 0.5
          ? "wrong_aspect"
          : native.confidence < 0.72
            ? "low_confidence"
            : "unsafe_scale";
  const placementState: CardGeometryMetadata["placementState"] = ready
    ? "ready"
    : detected
      ? "adjust_card"
      : "not_detected";

  const geometry: CardGeometryMetadata = {
    version: CARD_GEOMETRY_VERSION,
    side: native.frame.side === "back" ? "back" : "front",
    placementState,
    adjustmentReason,
    geometrySource: detected ? "detected" : "none",
    captureMode: detected ? "automatic_detection" : "none",
    confidenceBasis: detected ? "automatic_detection" : "none",
    detectionUsed: detected,
    manualOverrideUsed: false,
    corners: native.sourceCorners,
    detectedCorners: native.sourceCorners,
    boundingBox: box,
    rotationDegrees: native.rotationDegrees,
    skewDegrees: native.rotationDegrees === null ? null : Math.abs(native.rotationDegrees),
    confidence: native.confidence,
    sourceImageId: native.frame.blockId ?? undefined,
    sourceFrameId: native.frame.frameId,
    // Hardware timestamps are device ticks, not wall clock. Preserve them in
    // nativeDetector/frame identity and use the client receive wall clock here.
    timestamp: new Date(receivedAtUnixMs).toISOString(),
    image: {
      width: native.sourceWidth,
      height: native.sourceHeight,
      coordinateFrame: "source_image_pixels",
    },
    semanticOrientation: {
      canonicalOrientation: "portrait",
      basis: "operator_top_toward_preview_top",
      contentUprightVerified: false,
    },
    placement: {
      centerOffsetPixels:
        offsetX === undefined || offsetY === undefined
          ? undefined
          : {
              x: offsetX,
              y: offsetY,
              distance: Math.hypot(offsetX, offsetY),
              maxAxis: Math.max(Math.abs(offsetX), Math.abs(offsetY)),
            },
      centerOffsetInches:
        offsetX === undefined || offsetY === undefined || !estimatedPixelsPerInch
          ? undefined
          : {
              x: offsetX / estimatedPixelsPerInch,
              y: offsetY / estimatedPixelsPerInch,
              distance: Math.hypot(offsetX, offsetY) / estimatedPixelsPerInch,
              maxAxis: Math.max(Math.abs(offsetX), Math.abs(offsetY)) / estimatedPixelsPerInch,
            },
      estimatedPixelsPerInch,
      maxCenterOffsetInches: 0.5,
      maxSkewDegrees: 10,
      maxNormalizationSkewDegrees: 35,
      minReadyConfidence: 0.72,
      withinCenterTolerance: ready,
      withinSkewTolerance: native.rotationDegrees !== null && Math.abs(native.rotationDegrees) <= 10,
      withinNormalizationSkewTolerance: native.rotationDegrees !== null && Math.abs(native.rotationDegrees) <= 35,
      withinAspectTolerance: native.metrics.aspectScore >= 0.5,
      withinCoverageTolerance: native.metrics.coverage >= 0.3 && native.metrics.coverage <= 0.85,
      withinFrame: native.metrics.fullVisibility,
      confidenceReady: native.confidence >= 0.72,
      cardCoverage: native.metrics.coverage,
    },
    detection: {
      // Existing consumers currently permit only the two TypeScript detector
      // values. The warning and authoritative nativeDetector block prevent
      // this compatibility slot from being interpreted as detector provenance.
      method: "adaptive_border_contrast_connected_component_pca_v1",
      backgroundLuma: 0,
      contrastRange: 0,
      foregroundThreshold: 0,
      foregroundPixelFraction: native.metrics.coverage,
      rectangularFill: native.metrics.convexity,
      measuredAspectRatio: native.metrics.aspectRatio,
      expectedAspectRatio: 1.4,
      relativeAspectError: Math.abs(native.metrics.aspectRatio - 1.4) / 1.4,
      analysisWidth: native.sourceWidth,
      analysisHeight: native.sourceHeight,
    },
    warnings: [
      "native_four_edge_v2_authoritative; legacy detection.method is an adapter compatibility slot only",
      ...native.reasonCodes,
      ...(native.frozen ? ["frozen_frame_ready_forbidden"] : []),
    ],
  };

  return {
    geometry,
    nativeDetector: {
      version: native.detectorVersion,
      reasonCodes: [...native.reasonCodes],
      fittedLines: native.fittedLines.map((line) => ({ ...line })),
      normalizedCorners: native.normalizedCorners,
      metrics: {
        ...native.metrics,
        perEdgeSupport: { ...native.metrics.perEdgeSupport },
      },
      processingMs: native.processingMs,
      frameAgeMs: native.frameAgeMs,
      droppedFrames: native.droppedFrames,
      frozen: native.frozen,
      stale: native.stale,
      motionDelta: native.motionDelta,
      hysteresis: { ...native.hysteresis },
      currentFrameAuthority: {
        ...native.currentFrameAuthority,
        rejectionCodes: [...native.currentFrameAuthority.rejectionCodes],
      },
      calibration: { ...native.calibration },
      sensorOrientation: { ...native.sensorOrientation },
    },
  };
}
