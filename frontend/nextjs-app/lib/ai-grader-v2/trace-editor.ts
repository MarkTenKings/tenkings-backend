import type { SpeedsterPoint, SpeedsterTraceProvenance } from "./contracts";

export const SPEEDSTER_CANONICAL_TRACE_GRID = Object.freeze({
  width: 1270,
  height: 1778,
  pixelsPerMm: 20,
});

export type SpeedsterCanonicalPixel = Readonly<{ x: number; y: number }>;

export type SpeedsterCanonicalCropTransform = Readonly<{
  version: "speedster-canonical-crop-affine-v1";
  crop: Readonly<{ x: number; y: number; width: number; height: number }>;
}>;

export type SpeedsterTraceTool = "HIGHLIGHTER" | "BRUSH" | "ERASER";
export type SpeedsterTraceCornerShape = "ROUNDED_3_18_MM" | "SQUARE";

export type SpeedsterHighlighterProposalRequest = Readonly<{
  canonicalPoints: readonly SpeedsterCanonicalPixel[];
  strokeWidthPixels: number;
  strokeWidthMm: number;
}>;

export function initializeSpeedsterHighlighterStrokes(
  provenance?: SpeedsterTraceProvenance,
): SpeedsterHighlighterProposalRequest[] {
  return (provenance?.highlighterStrokes ?? []).map((stroke) => ({
    canonicalPoints: stroke.canonicalPoints.map(({ x, y }) => ({ x, y })),
    strokeWidthPixels: Math.max(
      1,
      Math.round(stroke.strokeWidthMm * SPEEDSTER_CANONICAL_TRACE_GRID.pixelsPerMm),
    ),
    strokeWidthMm: stroke.strokeWidthMm,
  }));
}

export function buildSpeedsterTraceProvenanceRevision(input: {
  sourceViewId: string;
  cropTransform: SpeedsterCanonicalCropTransform;
  highlighterStrokes: readonly SpeedsterHighlighterProposalRequest[];
  priorTraceProvenance?: SpeedsterTraceProvenance;
  finalTraceSha256: string;
}): SpeedsterTraceProvenance {
  if (
    input.priorTraceProvenance &&
    input.priorTraceProvenance.sourceViewId !== input.sourceViewId
  ) {
    throw new Error("Existing Speedster trace provenance source view changed during revision.");
  }
  return {
    version: "speedster-trace-provenance-v1",
    sourceViewId: input.priorTraceProvenance?.sourceViewId ?? input.sourceViewId,
    cropTransform: input.priorTraceProvenance?.cropTransform ?? input.cropTransform,
    highlighterStrokes: input.highlighterStrokes.map((stroke) => ({
      canonicalPoints: stroke.canonicalPoints.map(({ x, y }) => ({ x, y })),
      strokeWidthMm: stroke.strokeWidthMm,
    })),
    finalTraceSha256: input.finalTraceSha256,
  };
}

type CropTransformInput = {
  anchor: SpeedsterPoint;
  cropWidthPixels?: number;
  panelAspectRatio?: number;
};

type CompletedStrokeInput = {
  trace: Uint8Array;
  tool: SpeedsterTraceTool;
  points: readonly SpeedsterCanonicalPixel[];
  strokeWidthPixels: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function finitePositive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function traceIndex(point: SpeedsterCanonicalPixel) {
  return point.y * SPEEDSTER_CANONICAL_TRACE_GRID.width + point.x;
}

function assertTrace(trace: Uint8Array) {
  const expected = SPEEDSTER_CANONICAL_TRACE_GRID.width * SPEEDSTER_CANONICAL_TRACE_GRID.height;
  if (trace.length !== expected) {
    throw new Error(`Speedster trace must contain exactly ${expected} canonical pixels.`);
  }
}

function canonicalNormalizedToContinuousPixel(point: SpeedsterPoint): SpeedsterPoint {
  return {
    x: clamp(point.x, 0, 1) * (SPEEDSTER_CANONICAL_TRACE_GRID.width - 1),
    y: clamp(point.y, 0, 1) * (SPEEDSTER_CANONICAL_TRACE_GRID.height - 1),
  };
}

export function createSpeedsterCanonicalCropTransform({
  anchor,
  cropWidthPixels = 400,
  panelAspectRatio = 1,
}: CropTransformInput): SpeedsterCanonicalCropTransform {
  const maxWidth = SPEEDSTER_CANONICAL_TRACE_GRID.width - 1;
  const maxHeight = SPEEDSTER_CANONICAL_TRACE_GRID.height - 1;
  const width = Math.min(maxWidth, finitePositive(cropWidthPixels, 400));
  const height = Math.min(maxHeight, width / finitePositive(panelAspectRatio, 1));
  const canonicalAnchor = canonicalNormalizedToContinuousPixel(anchor);
  return {
    version: "speedster-canonical-crop-affine-v1",
    crop: {
      x: clamp(canonicalAnchor.x - width / 2, 0, maxWidth - width),
      y: clamp(canonicalAnchor.y - height / 2, 0, maxHeight - height),
      width,
      height,
    },
  };
}

export function createSpeedsterContourCropTransform(
  contour: readonly SpeedsterPoint[],
  options: { minimumWidthPixels?: number; paddingRatio?: number; panelAspectRatio?: number } = {},
): SpeedsterCanonicalCropTransform {
  const pixels = contour.map(canonicalNormalizedToContinuousPixel);
  if (pixels.length === 0) {
    return createSpeedsterCanonicalCropTransform({
      anchor: { x: 0.5, y: 0.5 },
      cropWidthPixels: options.minimumWidthPixels,
      panelAspectRatio: options.panelAspectRatio,
    });
  }
  const xs = pixels.map(({ x }) => x);
  const ys = pixels.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const panelAspect = finitePositive(options.panelAspectRatio ?? 1, 1);
  const padding = finitePositive(options.paddingRatio ?? 0.9, 0.9);
  const minimumWidth = finitePositive(options.minimumWidthPixels ?? 260, 260);
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const cropWidth = Math.max(
    minimumWidth,
    contentWidth * (1 + padding * 2),
    contentHeight * panelAspect * (1 + padding * 2),
  );
  return createSpeedsterCanonicalCropTransform({
    anchor: {
      x: ((minX + maxX) / 2) / (SPEEDSTER_CANONICAL_TRACE_GRID.width - 1),
      y: ((minY + maxY) / 2) / (SPEEDSTER_CANONICAL_TRACE_GRID.height - 1),
    },
    cropWidthPixels: cropWidth,
    panelAspectRatio: panelAspect,
  });
}

export function createSpeedsterTraceCropTransform(
  trace: Uint8Array,
  options: { minimumWidthPixels?: number; paddingRatio?: number; panelAspectRatio?: number } = {},
): SpeedsterCanonicalCropTransform {
  assertTrace(trace);
  let minimumX: number = SPEEDSTER_CANONICAL_TRACE_GRID.width;
  let maximumX: number = -1;
  let minimumY: number = SPEEDSTER_CANONICAL_TRACE_GRID.height;
  let maximumY: number = -1;
  for (let y = 0; y < SPEEDSTER_CANONICAL_TRACE_GRID.height; y += 1) {
    const rowOffset = y * SPEEDSTER_CANONICAL_TRACE_GRID.width;
    for (let x = 0; x < SPEEDSTER_CANONICAL_TRACE_GRID.width; x += 1) {
      if (trace[rowOffset + x] === 0) continue;
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
    }
  }
  if (maximumX < minimumX || maximumY < minimumY) {
    return createSpeedsterCanonicalCropTransform({
      anchor: { x: 0.5, y: 0.5 },
      cropWidthPixels: options.minimumWidthPixels,
      panelAspectRatio: options.panelAspectRatio,
    });
  }

  const maxWidth = SPEEDSTER_CANONICAL_TRACE_GRID.width - 1;
  const maxHeight = SPEEDSTER_CANONICAL_TRACE_GRID.height - 1;
  const panelAspect = finitePositive(options.panelAspectRatio ?? 1, 1);
  const padding = finitePositive(options.paddingRatio ?? 0.9, 0.9);
  const minimumWidth = finitePositive(options.minimumWidthPixels ?? 260, 260);
  const contentWidth = Math.max(1, maximumX - minimumX);
  const contentHeight = Math.max(1, maximumY - minimumY);
  const requestedWidth = Math.max(
    minimumWidth,
    contentWidth * (1 + padding * 2),
    contentHeight * panelAspect * (1 + padding * 2),
  );
  const requestedHeight = requestedWidth / panelAspect;
  const width = Math.min(maxWidth, Math.max(contentWidth, requestedWidth));
  const height = Math.min(maxHeight, Math.max(contentHeight, requestedHeight));
  const centerX = (minimumX + maximumX) / 2;
  const centerY = (minimumY + maximumY) / 2;

  return {
    version: "speedster-canonical-crop-affine-v1",
    crop: {
      x: clamp(centerX - width / 2, 0, maxWidth - width),
      y: clamp(centerY - height / 2, 0, maxHeight - height),
      width,
      height,
    },
  };
}

export function panelPointToCanonicalPixel(
  point: SpeedsterPoint,
  transform: SpeedsterCanonicalCropTransform,
): SpeedsterCanonicalPixel {
  return {
    x: Math.round(clamp(
      transform.crop.x + clamp(point.x, 0, 1) * transform.crop.width,
      0,
      SPEEDSTER_CANONICAL_TRACE_GRID.width - 1,
    )),
    y: Math.round(clamp(
      transform.crop.y + clamp(point.y, 0, 1) * transform.crop.height,
      0,
      SPEEDSTER_CANONICAL_TRACE_GRID.height - 1,
    )),
  };
}

export function canonicalPixelToPanelPoint(
  point: SpeedsterCanonicalPixel,
  transform: SpeedsterCanonicalCropTransform,
): SpeedsterPoint {
  return {
    x: (point.x - transform.crop.x) / transform.crop.width,
    y: (point.y - transform.crop.y) / transform.crop.height,
  };
}

export function canonicalCropToNormalizedBounds(transform: SpeedsterCanonicalCropTransform) {
  return {
    x: transform.crop.x / (SPEEDSTER_CANONICAL_TRACE_GRID.width - 1),
    y: transform.crop.y / (SPEEDSTER_CANONICAL_TRACE_GRID.height - 1),
    width: transform.crop.width / (SPEEDSTER_CANONICAL_TRACE_GRID.width - 1),
    height: transform.crop.height / (SPEEDSTER_CANONICAL_TRACE_GRID.height - 1),
  };
}

export function createEmptySpeedsterTrace() {
  return new Uint8Array(
    SPEEDSTER_CANONICAL_TRACE_GRID.width * SPEEDSTER_CANONICAL_TRACE_GRID.height,
  );
}

export function clipSpeedsterTraceToCrop(
  trace: Uint8Array,
  transform: SpeedsterCanonicalCropTransform,
) {
  assertTrace(trace);
  const clipped = createEmptySpeedsterTrace();
  const minimumX = clamp(
    Math.ceil(transform.crop.x),
    0,
    SPEEDSTER_CANONICAL_TRACE_GRID.width - 1,
  );
  const maximumX = clamp(
    Math.floor(transform.crop.x + transform.crop.width),
    0,
    SPEEDSTER_CANONICAL_TRACE_GRID.width - 1,
  );
  const minimumY = clamp(
    Math.ceil(transform.crop.y),
    0,
    SPEEDSTER_CANONICAL_TRACE_GRID.height - 1,
  );
  const maximumY = clamp(
    Math.floor(transform.crop.y + transform.crop.height),
    0,
    SPEEDSTER_CANONICAL_TRACE_GRID.height - 1,
  );
  if (minimumX > maximumX || minimumY > maximumY) return clipped;
  for (let y = minimumY; y <= maximumY; y += 1) {
    const rowOffset = y * SPEEDSTER_CANONICAL_TRACE_GRID.width;
    clipped.set(
      trace.subarray(rowOffset + minimumX, rowOffset + maximumX + 1),
      rowOffset + minimumX,
    );
  }
  return clipped;
}

export function clipSpeedsterTraceToMaterial(
  trace: Uint8Array,
  cornerShape: SpeedsterTraceCornerShape,
) {
  assertTrace(trace);
  if (cornerShape === "SQUARE") return trace.slice();
  if (cornerShape !== "ROUNDED_3_18_MM") {
    throw new Error("Speedster corner shape must be ROUNDED_3_18_MM or SQUARE.");
  }
  const clipped = createEmptySpeedsterTrace();
  const radiusMm = 3.18;
  const radiusSquared = radiusMm * radiusMm;
  for (let y = 0; y < SPEEDSTER_CANONICAL_TRACE_GRID.height; y += 1) {
    const yMm = (y + 0.5) * 88.9 / SPEEDSTER_CANONICAL_TRACE_GRID.height;
    const yDistance = Math.min(yMm, 88.9 - yMm);
    const rowOffset = y * SPEEDSTER_CANONICAL_TRACE_GRID.width;
    for (let x = 0; x < SPEEDSTER_CANONICAL_TRACE_GRID.width; x += 1) {
      const offset = rowOffset + x;
      if (trace[offset] === 0) continue;
      const xMm = (x + 0.5) * 63.5 / SPEEDSTER_CANONICAL_TRACE_GRID.width;
      const xDistance = Math.min(xMm, 63.5 - xMm);
      const insideCornerCircle =
        (xDistance - radiusMm) ** 2 + (yDistance - radiusMm) ** 2 <= radiusSquared;
      if (xDistance >= radiusMm || yDistance >= radiusMm || insideCornerCircle) {
        clipped[offset] = 1;
      }
    }
  }
  return clipped;
}

export function clipSpeedsterTraceToEditorBounds(
  trace: Uint8Array,
  transform: SpeedsterCanonicalCropTransform,
  cornerShape: SpeedsterTraceCornerShape,
) {
  return clipSpeedsterTraceToMaterial(
    clipSpeedsterTraceToCrop(trace, transform),
    cornerShape,
  );
}

function paintDisc(
  trace: Uint8Array,
  center: SpeedsterCanonicalPixel,
  radius: number,
  value: 0 | 1,
) {
  const minimumX = Math.max(0, Math.floor(center.x - radius));
  const maximumX = Math.min(
    SPEEDSTER_CANONICAL_TRACE_GRID.width - 1,
    Math.ceil(center.x + radius),
  );
  const minimumY = Math.max(0, Math.floor(center.y - radius));
  const maximumY = Math.min(
    SPEEDSTER_CANONICAL_TRACE_GRID.height - 1,
    Math.ceil(center.y + radius),
  );
  const radiusSquared = radius * radius;
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const deltaX = x - center.x;
      const deltaY = y - center.y;
      if (deltaX * deltaX + deltaY * deltaY <= radiusSquared) {
        trace[traceIndex({ x, y })] = value;
      }
    }
  }
}

function paintStroke(
  trace: Uint8Array,
  points: readonly SpeedsterCanonicalPixel[],
  width: number,
  value: 0 | 1,
) {
  const radius = Math.max(0.5, width / 2);
  points.forEach((point, index) => {
    const previous = points[index - 1] ?? point;
    const steps = Math.max(Math.abs(point.x - previous.x), Math.abs(point.y - previous.y), 1);
    for (let step = 0; step <= steps; step += 1) {
      paintDisc(trace, {
        x: Math.round(previous.x + ((point.x - previous.x) * step) / steps),
        y: Math.round(previous.y + ((point.y - previous.y) * step) / steps),
      }, radius, value);
    }
  });
}

export function applyCompletedSpeedsterTraceStroke({
  trace,
  tool,
  points,
  strokeWidthPixels,
}: CompletedStrokeInput): {
  trace: Uint8Array;
  proposalRequest: SpeedsterHighlighterProposalRequest | null;
} {
  assertTrace(trace);
  const width = Math.max(1, Math.round(finitePositive(strokeWidthPixels, 1)));
  const canonicalPoints = points.map(({ x, y }) => ({
    x: clamp(Math.round(x), 0, SPEEDSTER_CANONICAL_TRACE_GRID.width - 1),
    y: clamp(Math.round(y), 0, SPEEDSTER_CANONICAL_TRACE_GRID.height - 1),
  }));
  if (tool === "HIGHLIGHTER") {
    return {
      trace,
      proposalRequest: {
        canonicalPoints,
        strokeWidthPixels: width,
        strokeWidthMm: width / SPEEDSTER_CANONICAL_TRACE_GRID.pixelsPerMm,
      },
    };
  }

  const edited = trace.slice();
  paintStroke(edited, canonicalPoints, width, tool === "BRUSH" ? 1 : 0);
  return { trace: edited, proposalRequest: null };
}

export function rasterizeSpeedsterCanonicalContour(
  contour: readonly SpeedsterPoint[],
): Uint8Array {
  const trace = createEmptySpeedsterTrace();
  if (contour.length < 3) return trace;
  const pixels = contour.map(canonicalNormalizedToContinuousPixel);
  const minimumX = Math.max(0, Math.floor(Math.min(...pixels.map(({ x }) => x))));
  const maximumX = Math.min(
    SPEEDSTER_CANONICAL_TRACE_GRID.width - 1,
    Math.ceil(Math.max(...pixels.map(({ x }) => x))),
  );
  const minimumY = Math.max(0, Math.floor(Math.min(...pixels.map(({ y }) => y))));
  const maximumY = Math.min(
    SPEEDSTER_CANONICAL_TRACE_GRID.height - 1,
    Math.ceil(Math.max(...pixels.map(({ y }) => y))),
  );

  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      let inside = false;
      for (let current = 0, previous = pixels.length - 1; current < pixels.length; previous = current, current += 1) {
        const a = pixels[current];
        const b = pixels[previous];
        const crosses = (a.y > y) !== (b.y > y) &&
          x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
        if (crosses) inside = !inside;
      }
      if (inside) trace[traceIndex({ x, y })] = 1;
    }
  }
  return trace;
}

export function isNonEmptySpeedsterTrace(trace: Uint8Array) {
  assertTrace(trace);
  return trace.some((value) => value !== 0);
}

export function copyVisibleSpeedsterTrace(trace: Uint8Array) {
  assertTrace(trace);
  return trace.slice();
}
