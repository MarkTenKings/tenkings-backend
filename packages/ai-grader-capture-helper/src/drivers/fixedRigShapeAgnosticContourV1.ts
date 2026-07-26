import { createHash } from "node:crypto";

export const FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_SCHEMA_VERSION =
  "ten-kings-fixed-rig-shape-agnostic-contour-v1" as const;
export const FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_DETECTOR_ID =
  "fixed_rig_shape_agnostic_contour_v1" as const;
export const FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_DETECTOR_VERSION =
  "fixed_rig_shape_agnostic_contour_v1.0.0" as const;

export interface FixedRigContourPointV1 {
  x: number;
  y: number;
}

export interface FixedRigContourSupportV1 {
  point: FixedRigContourPointV1;
  contrast: number;
  support: "strong" | "limited";
}

export interface FixedRigContourOrientedBoundsV1 {
  center: FixedRigContourPointV1;
  widthMm: number;
  heightMm: number;
  angleDegrees: number;
  cornersMm: readonly [
    FixedRigContourPointV1,
    FixedRigContourPointV1,
    FixedRigContourPointV1,
    FixedRigContourPointV1,
  ];
}

export interface FixedRigContourCurvatureSampleV1 {
  pointMm: FixedRigContourPointV1;
  signedCurvaturePerMm: number;
  localRadiusMm: number | null;
  arcPositionMm: number;
}

export interface FixedRigContourCircularArcV1 {
  arcId: string;
  startArcPositionMm: number;
  endArcPositionMm: number;
  centerMm: FixedRigContourPointV1;
  radiusMm: number;
  sweepDegrees: number;
  radialResidualMm: number;
  sampleCount: number;
}

export interface FixedRigShapeAgnosticContourArtifactV1 {
  schemaVersion: typeof FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_SCHEMA_VERSION;
  detectorId: typeof FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_DETECTOR_ID;
  detectorVersion: typeof FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_DETECTOR_VERSION;
  coordinateFrame: "auto_oriented_raw_sensor_pixels";
  sourceAssetId: string;
  sourceAssetSha256: string;
  backgroundAssetId: string;
  backgroundAssetSha256: string;
  calibrationProfileId: string;
  calibrationSha256: string;
  widthPx: number;
  heightPx: number;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
  foregroundThreshold: number;
  foregroundPixelCount: number;
  foregroundCoverage: number;
  /** Placement/working-area observations are advisory and never erase a visible contour. */
  placementAdvisories: readonly string[];
  contour: readonly FixedRigContourPointV1[];
  contourSupport: readonly FixedRigContourSupportV1[];
  contourPointCount: number;
  contourPerimeterMm: number;
  enclosedAreaMm2: number;
  orientedBounds: FixedRigContourOrientedBoundsV1;
  curvatureSamples: readonly FixedRigContourCurvatureSampleV1[];
  circularArcs: readonly FixedRigContourCircularArcV1[];
  contourSha256: string;
  artifactSha256: string;
}

export interface FixedRigShapeAgnosticContourUnavailableV1 {
  schemaVersion: typeof FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_SCHEMA_VERSION;
  detectorId: typeof FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_DETECTOR_ID;
  detectorVersion: typeof FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_DETECTOR_VERSION;
  status: "unavailable";
  reasons: readonly string[];
}

export interface TraceFixedRigDenseContourV1Input {
  width: number;
  height: number;
  /** Scalar boundary field in the same coordinate frame as mask. */
  field: Float32Array;
  /** One connected material component. Interior holes are filled by the tracer. */
  mask: Uint8Array;
  threshold: number;
}

export interface TracedFixedRigDenseContourV1 {
  contour: readonly FixedRigContourPointV1[];
  contourSupport: readonly FixedRigContourSupportV1[];
  contourSha256: string;
}

export interface MeasureFixedRigDenseContourV1Input {
  contour: readonly FixedRigContourPointV1[];
  pixelsPerMmX: number;
  pixelsPerMmY: number;
}

export interface MeasuredFixedRigDenseContourV1 {
  contourPerimeterMm: number;
  enclosedAreaMm2: number;
  orientedBounds: FixedRigContourOrientedBoundsV1;
  curvatureSamples: readonly FixedRigContourCurvatureSampleV1[];
  circularArcs: readonly FixedRigContourCircularArcV1[];
}

export interface DetectFixedRigShapeAgnosticContourV1Input {
  width: number;
  height: number;
  /** Calibrated raw monochrome values normalized to 0..1. */
  observed: Float32Array;
  /** Empty-fixture reference captured in the same coordinate frame and lighting state. */
  background: Float32Array;
  sourceAssetId: string;
  sourceAssetSha256: string;
  backgroundAssetId: string;
  backgroundAssetSha256: string;
  calibrationProfileId: string;
  calibrationSha256: string;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
  minimumForegroundCoverage?: number;
  maximumForegroundCoverage?: number;
}

export type FixedRigShapeAgnosticContourDetectionV1 =
  | { status: "computed"; artifact: FixedRigShapeAgnosticContourArtifactV1 }
  | FixedRigShapeAgnosticContourUnavailableV1;

interface ScalarPoint extends FixedRigContourPointV1 {
  value: number;
}

interface Segment {
  start: ScalarPoint;
  end: ScalarPoint;
}

interface PhysicalContourPoint extends FixedRigContourPointV1 {
  arcPositionMm: number;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
// This is only a numerical floor for a calibrated floating-point comparison.
// It is deliberately far below one Mono8 digital unit: visible separation is
// established relative to the measured empty-fixture noise, not by a fixed
// "perfect conditions" contrast gate.
const MINIMUM_ABSOLUTE_DIFFERENCE = 0.25 / 255;
const LIMITED_SUPPORT_MULTIPLIER = 1.35;

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function finitePlane(plane: Float32Array, length: number): boolean {
  if (!(plane instanceof Float32Array) || plane.length !== length) return false;
  for (const value of plane) {
    if (!Number.isFinite(value) || value < 0 || value > 1) return false;
  }
  return true;
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return 0;
  const position = clamp(fraction, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const blend = position - lower;
  return (sorted[lower] ?? 0) * (1 - blend) + (sorted[upper] ?? 0) * blend;
}

function otsuThreshold(values: Float32Array): number {
  const histogram = new Uint32Array(256);
  for (const value of values) {
    const bin = clamp(Math.round(value * 255), 0, 255);
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }
  let totalMean = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    totalMean += index * (histogram[index] ?? 0);
  }
  let backgroundWeight = 0;
  let backgroundMean = 0;
  let bestVariance = -1;
  let bestThreshold = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    const count = histogram[index] ?? 0;
    backgroundWeight += count;
    if (backgroundWeight === 0) continue;
    const foregroundWeight = values.length - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundMean += index * count;
    const meanBackground = backgroundMean / backgroundWeight;
    const meanForeground = (totalMean - backgroundMean) / foregroundWeight;
    const betweenClassVariance =
      backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
    if (betweenClassVariance > bestVariance) {
      bestVariance = betweenClassVariance;
      bestThreshold = index;
    }
  }
  return bestThreshold / 255;
}

function foregroundThreshold(differences: Float32Array): number {
  const sampleStride = Math.max(1, Math.floor(differences.length / 200_000));
  const sampled: number[] = [];
  for (let index = 0; index < differences.length; index += sampleStride) {
    sampled.push(differences[index] ?? 0);
  }
  sampled.sort((left, right) => left - right);
  // The card normally occupies most of the live working area, so the global
  // median is often card material rather than empty fixture. Estimate noise
  // only from the lower-background population; otherwise a >50%-coverage card
  // raises its own foreground threshold above its visible material response.
  const backgroundCeiling = quantile(sampled, 0.02);
  const backgroundSamples = sampled.filter((value) => value <= backgroundCeiling);
  const backgroundLocation = quantile(backgroundSamples, 0.5);
  const deviations = backgroundSamples
    .map((value) => Math.abs(value - backgroundLocation))
    .sort((left, right) => left - right);
  const robustSigma = quantile(deviations, 0.5) * 1.4826;
  const noiseThreshold = backgroundLocation +
    Math.max(MINIMUM_ABSOLUTE_DIFFERENCE, robustSigma * 6);
  const otsu = otsuThreshold(differences);
  return round(clamp(Math.max(MINIMUM_ABSOLUTE_DIFFERENCE, noiseThreshold, otsu), 0, 1));
}

function connectedComponents(mask: Uint8Array, width: number, height: number): {
  labels: Int32Array;
  counts: number[];
} {
  const labels = new Int32Array(mask.length);
  labels.fill(-1);
  const counts: number[] = [];
  const queue = new Int32Array(mask.length);
  const neighbors = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ] as const;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start] !== -1) continue;
    const label = counts.length;
    let head = 0;
    let tail = 0;
    let count = 0;
    queue[tail++] = start;
    labels[start] = label;
    while (head < tail) {
      const index = queue[head++]!;
      count += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (!mask[neighbor] || labels[neighbor] !== -1) continue;
        labels[neighbor] = label;
        queue[tail++] = neighbor;
      }
    }
    counts.push(count);
  }
  return { labels, counts };
}

function retainLargestComponent(mask: Uint8Array, width: number, height: number): {
  mask: Uint8Array;
  count: number;
} {
  const { labels, counts } = connectedComponents(mask, width, height);
  let selected = -1;
  let selectedCount = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index] ?? 0;
    if (count > selectedCount) {
      selected = index;
      selectedCount = count;
    }
  }
  const output = new Uint8Array(mask.length);
  if (selected < 0) return { mask: output, count: 0 };
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] === selected) output[index] = 1;
  }
  return { mask: output, count: selectedCount };
}

function fillInteriorHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const exterior = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  const enqueue = (x: number, y: number) => {
    const index = y * width + x;
    if (mask[index] || exterior[index]) return;
    exterior[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }
  const output = Uint8Array.from(mask);
  for (let index = 0; index < output.length; index += 1) {
    if (!output[index] && !exterior[index]) output[index] = 1;
  }
  return output;
}

function edgeInterpolation(
  first: FixedRigContourPointV1,
  second: FixedRigContourPointV1,
  firstValue: number,
  secondValue: number,
  threshold: number,
): ScalarPoint {
  const denominator = secondValue - firstValue;
  const t = Math.abs(denominator) < 1e-12
    ? 0.5
    : clamp((threshold - firstValue) / denominator, 0, 1);
  return {
    x: round(first.x + (second.x - first.x) * t),
    y: round(first.y + (second.y - first.y) * t),
    value: round(Math.abs(secondValue - firstValue)),
  };
}

function marchingSegments(
  field: Float32Array,
  mask: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): Segment[] {
  const segments: Segment[] = [];
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const topLeftIndex = y * width + x;
      const topRightIndex = topLeftIndex + 1;
      const bottomLeftIndex = topLeftIndex + width;
      const bottomRightIndex = bottomLeftIndex + 1;
      const bits =
        (mask[topLeftIndex] ? 1 : 0) |
        (mask[topRightIndex] ? 2 : 0) |
        (mask[bottomRightIndex] ? 4 : 0) |
        (mask[bottomLeftIndex] ? 8 : 0);
      if (bits === 0 || bits === 15) continue;
      const top = edgeInterpolation(
        { x, y },
        { x: x + 1, y },
        field[topLeftIndex] ?? 0,
        field[topRightIndex] ?? 0,
        threshold,
      );
      const right = edgeInterpolation(
        { x: x + 1, y },
        { x: x + 1, y: y + 1 },
        field[topRightIndex] ?? 0,
        field[bottomRightIndex] ?? 0,
        threshold,
      );
      const bottom = edgeInterpolation(
        { x, y: y + 1 },
        { x: x + 1, y: y + 1 },
        field[bottomLeftIndex] ?? 0,
        field[bottomRightIndex] ?? 0,
        threshold,
      );
      const left = edgeInterpolation(
        { x, y },
        { x, y: y + 1 },
        field[topLeftIndex] ?? 0,
        field[bottomLeftIndex] ?? 0,
        threshold,
      );
      const push = (start: ScalarPoint, end: ScalarPoint) => segments.push({ start, end });
      switch (bits) {
        case 1: push(left, top); break;
        case 2: push(top, right); break;
        case 3: push(left, right); break;
        case 4: push(right, bottom); break;
        case 5: {
          const center = (
            (field[topLeftIndex] ?? 0) +
            (field[topRightIndex] ?? 0) +
            (field[bottomRightIndex] ?? 0) +
            (field[bottomLeftIndex] ?? 0)
          ) / 4;
          if (center >= threshold) {
            push(top, right);
            push(bottom, left);
          } else {
            push(left, top);
            push(right, bottom);
          }
          break;
        }
        case 6: push(top, bottom); break;
        case 7: push(left, bottom); break;
        case 8: push(bottom, left); break;
        case 9: push(bottom, top); break;
        case 10: {
          const center = (
            (field[topLeftIndex] ?? 0) +
            (field[topRightIndex] ?? 0) +
            (field[bottomRightIndex] ?? 0) +
            (field[bottomLeftIndex] ?? 0)
          ) / 4;
          if (center >= threshold) {
            push(left, top);
            push(right, bottom);
          } else {
            push(top, right);
            push(bottom, left);
          }
          break;
        }
        case 11: push(bottom, right); break;
        case 12: push(right, left); break;
        case 13: push(right, top); break;
        case 14: push(top, left); break;
        default: break;
      }
    }
  }
  return segments;
}

function pointKey(point: FixedRigContourPointV1): string {
  return `${Math.round(point.x * 1_000_000)}:${Math.round(point.y * 1_000_000)}`;
}

function polygonArea(points: readonly FixedRigContourPointV1[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function joinClosedContours(segments: readonly Segment[]): ScalarPoint[][] {
  const adjacency = new Map<string, Array<{ segmentIndex: number; point: ScalarPoint }>>();
  segments.forEach((segment, segmentIndex) => {
    for (const point of [segment.start, segment.end]) {
      const key = pointKey(point);
      const entries = adjacency.get(key) ?? [];
      entries.push({ segmentIndex, point });
      adjacency.set(key, entries);
    }
  });
  const consumed = new Uint8Array(segments.length);
  const loops: ScalarPoint[][] = [];
  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    if (consumed[startIndex]) continue;
    const start = segments[startIndex]!;
    const loop: ScalarPoint[] = [start.start];
    let current = start.end;
    consumed[startIndex] = 1;
    let guard = 0;
    while (guard++ <= segments.length + 1) {
      loop.push(current);
      if (pointKey(current) === pointKey(loop[0]!) && loop.length >= 4) {
        loop.pop();
        loops.push(loop);
        break;
      }
      const candidates = adjacency.get(pointKey(current)) ?? [];
      const next = candidates.find((candidate) => !consumed[candidate.segmentIndex]);
      if (!next) break;
      const segment = segments[next.segmentIndex]!;
      consumed[next.segmentIndex] = 1;
      current = pointKey(segment.start) === pointKey(current) ? segment.end : segment.start;
    }
  }
  return loops.filter((loop) => loop.length >= 3 && Math.abs(polygonArea(loop)) >= 1);
}

function physicalPoint(
  point: FixedRigContourPointV1,
  pixelsPerMmX: number,
  pixelsPerMmY: number,
): FixedRigContourPointV1 {
  return { x: point.x / pixelsPerMmX, y: point.y / pixelsPerMmY };
}

function cross(
  origin: FixedRigContourPointV1,
  first: FixedRigContourPointV1,
  second: FixedRigContourPointV1,
): number {
  return (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x);
}

function convexHull(points: readonly FixedRigContourPointV1[]): FixedRigContourPointV1[] {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  if (sorted.length <= 2) return sorted;
  const lower: FixedRigContourPointV1[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: FixedRigContourPointV1[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function orientedBounds(points: readonly FixedRigContourPointV1[]): FixedRigContourOrientedBoundsV1 {
  const hull = convexHull(points);
  let best:
    | {
        area: number;
        angle: number;
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
      }
    | undefined;
  for (let index = 0; index < hull.length; index += 1) {
    const current = hull[index]!;
    const next = hull[(index + 1) % hull.length]!;
    const angle = Math.atan2(next.y - current.y, next.x - current.x);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of hull) {
      const x = point.x * cosine + point.y * sine;
      const y = -point.x * sine + point.y * cosine;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const area = (maxX - minX) * (maxY - minY);
    if (!best || area < best.area) best = { area, angle, minX, maxX, minY, maxY };
  }
  if (!best) throw new Error("A non-empty physical contour is required.");
  const unrotate = (x: number, y: number): FixedRigContourPointV1 => ({
    x: x * Math.cos(best!.angle) - y * Math.sin(best!.angle),
    y: x * Math.sin(best!.angle) + y * Math.cos(best!.angle),
  });
  let width = best.maxX - best.minX;
  let height = best.maxY - best.minY;
  let angle = best.angle;
  let corners = [
    unrotate(best.minX, best.minY),
    unrotate(best.maxX, best.minY),
    unrotate(best.maxX, best.maxY),
    unrotate(best.minX, best.maxY),
  ] as [
    FixedRigContourPointV1,
    FixedRigContourPointV1,
    FixedRigContourPointV1,
    FixedRigContourPointV1,
  ];
  if (height < width) {
    [width, height] = [height, width];
    angle += Math.PI / 2;
    corners = [corners[1], corners[2], corners[3], corners[0]];
  }
  const center = {
    x: corners.reduce((sum, point) => sum + point.x, 0) / 4,
    y: corners.reduce((sum, point) => sum + point.y, 0) / 4,
  };
  let degrees = angle * 180 / Math.PI;
  while (degrees <= -90) degrees += 180;
  while (degrees > 90) degrees -= 180;
  return {
    center: { x: round(center.x), y: round(center.y) },
    widthMm: round(width),
    heightMm: round(height),
    angleDegrees: round(degrees),
    cornersMm: [
      { x: round(corners[0].x), y: round(corners[0].y) },
      { x: round(corners[1].x), y: round(corners[1].y) },
      { x: round(corners[2].x), y: round(corners[2].y) },
      { x: round(corners[3].x), y: round(corners[3].y) },
    ],
  };
}

function distance(first: FixedRigContourPointV1, second: FixedRigContourPointV1): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function physicalContour(
  contour: readonly FixedRigContourPointV1[],
  pixelsPerMmX: number,
  pixelsPerMmY: number,
): { points: PhysicalContourPoint[]; perimeterMm: number } {
  const points = contour.map((point) => physicalPoint(point, pixelsPerMmX, pixelsPerMmY));
  const withArc: PhysicalContourPoint[] = [];
  let arcPositionMm = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) arcPositionMm += distance(points[index - 1]!, points[index]!);
    withArc.push({ ...points[index]!, arcPositionMm });
  }
  const perimeterMm = arcPositionMm + distance(points[points.length - 1]!, points[0]!);
  return { points: withArc, perimeterMm };
}

function circularIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

function contourCurvature(
  points: readonly PhysicalContourPoint[],
  perimeterMm: number,
): FixedRigContourCurvatureSampleV1[] {
  if (points.length < 5 || perimeterMm <= 0) return [];
  const targetSpanMm = clamp(perimeterMm / 160, 0.35, 1.25);
  const averageStep = perimeterMm / points.length;
  const offset = clamp(Math.round(targetSpanMm / Math.max(averageStep, 1e-9)), 2, Math.floor(points.length / 6));
  const samples: FixedRigContourCurvatureSampleV1[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[circularIndex(index - offset, points.length)]!;
    const current = points[index]!;
    const next = points[circularIndex(index + offset, points.length)]!;
    const first = distance(previous, current);
    const second = distance(current, next);
    const chord = distance(previous, next);
    const twiceArea = cross(previous, current, next);
    const denominator = first * second * chord;
    const signedCurvature = denominator > 1e-12 ? (2 * twiceArea) / denominator : 0;
    const radius = Math.abs(signedCurvature) > 1e-6 ? 1 / Math.abs(signedCurvature) : null;
    samples.push({
      pointMm: { x: round(current.x), y: round(current.y) },
      signedCurvaturePerMm: round(signedCurvature),
      localRadiusMm: radius === null ? null : round(radius),
      arcPositionMm: round(current.arcPositionMm),
    });
  }
  return samples;
}

function solveThreeByThree(matrix: number[][], vector: number[]): number[] | null {
  const augmented = matrix.map((row, index) => [...row, vector[index] ?? 0]);
  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    for (let entry = column; entry < 4; entry += 1) augmented[column]![entry] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let entry = column; entry < 4; entry += 1) {
        augmented[row]![entry] -= factor * augmented[column]![entry]!;
      }
    }
  }
  return augmented.map((row) => row[3]!);
}

function fitCircle(points: readonly FixedRigContourPointV1[]): {
  center: FixedRigContourPointV1;
  radius: number;
  residual: number;
} | null {
  if (points.length < 5) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  let sumXXX = 0;
  let sumYYY = 0;
  let sumXYY = 0;
  let sumXXY = 0;
  for (const point of points) {
    const xx = point.x * point.x;
    const yy = point.y * point.y;
    sumX += point.x;
    sumY += point.y;
    sumXX += xx;
    sumYY += yy;
    sumXY += point.x * point.y;
    sumXXX += xx * point.x;
    sumYYY += yy * point.y;
    sumXYY += point.x * yy;
    sumXXY += xx * point.y;
  }
  const count = points.length;
  const solution = solveThreeByThree(
    [
      [sumXX, sumXY, sumX],
      [sumXY, sumYY, sumY],
      [sumX, sumY, count],
    ],
    [
      -(sumXXX + sumXYY),
      -(sumXXY + sumYYY),
      -(sumXX + sumYY),
    ],
  );
  if (!solution) return null;
  const center = { x: -solution[0]! / 2, y: -solution[1]! / 2 };
  const radiusSquared = center.x ** 2 + center.y ** 2 - solution[2]!;
  if (!(radiusSquared > 0)) return null;
  const radius = Math.sqrt(radiusSquared);
  const residual = Math.sqrt(
    points.reduce((sum, point) => sum + (distance(center, point) - radius) ** 2, 0) / count,
  );
  return { center, radius, residual };
}

function unwrapCircularRuns(indices: readonly number[], length: number): number[][] {
  if (!indices.length) return [];
  const runs: number[][] = [[indices[0]!]];
  for (let index = 1; index < indices.length; index += 1) {
    const value = indices[index]!;
    const previous = indices[index - 1]!;
    if (value === previous + 1) runs[runs.length - 1]!.push(value);
    else runs.push([value]);
  }
  if (runs.length > 1 && runs[0]![0] === 0 && runs[runs.length - 1]!.at(-1) === length - 1) {
    const merged = [...runs[runs.length - 1]!, ...runs[0]!.map((value) => value + length)];
    return [merged, ...runs.slice(1, -1)];
  }
  return runs;
}

function circularArcs(
  points: readonly PhysicalContourPoint[],
  curvature: readonly FixedRigContourCurvatureSampleV1[],
  perimeterMm: number,
  pixelsPerMmX: number,
  pixelsPerMmY: number,
): FixedRigContourCircularArcV1[] {
  if (points.length !== curvature.length || points.length < 8) return [];
  const minimumPixelsPerMm = Math.min(pixelsPerMmX, pixelsPerMmY);
  const completeFit = fitCircle(points);
  if (completeFit &&
      completeFit.radius * minimumPixelsPerMm >= 8 &&
      completeFit.residual <= Math.max(0.08, completeFit.radius * 0.015)) {
    return [{
      arcId: "observed-arc-1",
      startArcPositionMm: 0,
      endArcPositionMm: round(perimeterMm),
      centerMm: { x: round(completeFit.center.x), y: round(completeFit.center.y) },
      radiusMm: round(completeFit.radius),
      sweepDegrees: 360,
      radialResidualMm: round(completeFit.residual),
      sampleCount: points.length,
    }];
  }
  const curved = curvature
    .map((sample, index) => ({ sample, index }))
    .filter(({ sample }) =>
      Math.abs(sample.signedCurvaturePerMm) >= 0.04 &&
      sample.localRadiusMm !== null &&
      sample.localRadiusMm <= Math.max(25, perimeterMm / 3))
    .map(({ index }) => index);
  const runs = unwrapCircularRuns(curved, points.length);
  const arcs: FixedRigContourCircularArcV1[] = [];
  for (const run of runs) {
    if (run.length < 5) continue;
    const runPoints = run.map((index) => points[circularIndex(index, points.length)]!);
    const fit = fitCircle(runPoints);
    if (!fit) continue;
    // A fitted radius must span enough independently observed sensor pixels to
    // distinguish a physical arc from raster stair-stepping around a sharp
    // polygon vertex. This gate is based only on calibrated sampling density,
    // never on an expected product radius.
    if (fit.radius * minimumPixelsPerMm < 8) continue;
    const radialResidualLimit = Math.max(0.08, fit.radius * 0.08);
    if (fit.residual > radialResidualLimit) continue;
    const first = runPoints[0]!;
    const last = runPoints[runPoints.length - 1]!;
    const startAngle = Math.atan2(first.y - fit.center.y, first.x - fit.center.x);
    const endAngle = Math.atan2(last.y - fit.center.y, last.x - fit.center.x);
    let sweep = Math.abs((endAngle - startAngle) * 180 / Math.PI);
    if (sweep > 180) sweep = 360 - sweep;
    const runLength = run.reduce((sum, value, index) => {
      if (index === 0) return sum;
      return sum + distance(
        points[circularIndex(run[index - 1]!, points.length)]!,
        points[circularIndex(value, points.length)]!,
      );
    }, 0);
    const circumferenceSweep = runLength / fit.radius * 180 / Math.PI;
    sweep = Math.max(sweep, circumferenceSweep);
    if (sweep < 18) continue;
    const startPosition = points[circularIndex(run[0]!, points.length)]!.arcPositionMm;
    let endPosition = points[circularIndex(run[run.length - 1]!, points.length)]!.arcPositionMm;
    if (run[run.length - 1]! >= points.length) endPosition += perimeterMm;
    arcs.push({
      arcId: `observed-arc-${arcs.length + 1}`,
      startArcPositionMm: round(startPosition),
      endArcPositionMm: round(endPosition),
      centerMm: { x: round(fit.center.x), y: round(fit.center.y) },
      radiusMm: round(fit.radius),
      sweepDegrees: round(sweep),
      radialResidualMm: round(fit.residual),
      sampleCount: runPoints.length,
    });
  }
  return arcs;
}

function unavailable(reasons: readonly string[]): FixedRigShapeAgnosticContourUnavailableV1 {
  return {
    schemaVersion: FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_SCHEMA_VERSION,
    detectorId: FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_DETECTOR_ID,
    detectorVersion: FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_DETECTOR_VERSION,
    status: "unavailable",
    reasons,
  };
}

/**
 * Shared dense-boundary primitive used by both live placement preview and the
 * sealed grading artifact. It observes the supplied component boundary; it
 * does not fit or seed an expected rectangle, aspect ratio, or corner radius.
 */
export function traceFixedRigDenseContourV1(
  input: TraceFixedRigDenseContourV1Input,
): TracedFixedRigDenseContourV1 | undefined {
  if (
    !Number.isSafeInteger(input.width) ||
    input.width < 2 ||
    !Number.isSafeInteger(input.height) ||
    input.height < 2 ||
    !(input.field instanceof Float32Array) ||
    input.field.length !== input.width * input.height ||
    !(input.mask instanceof Uint8Array) ||
    input.mask.length !== input.width * input.height ||
    !Number.isFinite(input.threshold)
  ) {
    return;
  }
  const material = fillInteriorHoles(input.mask, input.width, input.height);
  const segments = marchingSegments(
    input.field,
    material,
    input.width,
    input.height,
    input.threshold,
  );
  const loops = joinClosedContours(segments);
  if (!loops.length) return;
  loops.sort((left, right) => Math.abs(polygonArea(right)) - Math.abs(polygonArea(left)));
  let contour = loops[0]!;
  if (polygonArea(contour) < 0) contour = [...contour].reverse();
  const contourPoints = contour.map((point) => ({ x: round(point.x), y: round(point.y) }));
  const contourSupport = contour.map((point) => ({
    point: { x: round(point.x), y: round(point.y) },
    contrast: round(point.value),
    support: point.value >= input.threshold * LIMITED_SUPPORT_MULTIPLIER
      ? "strong" as const
      : "limited" as const,
  }));
  return {
    contour: contourPoints,
    contourSupport,
    contourSha256: sha256({
      coordinateFrame: "observed_dense_contour_pixels",
      contour: contourPoints,
    }),
  };
}

export function measureFixedRigDenseContourV1(
  input: MeasureFixedRigDenseContourV1Input,
): MeasuredFixedRigDenseContourV1 | undefined {
  if (
    input.contour.length < 3 ||
    !Number.isFinite(input.pixelsPerMmX) ||
    input.pixelsPerMmX <= 0 ||
    !Number.isFinite(input.pixelsPerMmY) ||
    input.pixelsPerMmY <= 0
  ) {
    return;
  }
  const physical = physicalContour(
    input.contour,
    input.pixelsPerMmX,
    input.pixelsPerMmY,
  );
  const physicalPoints = physical.points.map((point) => ({ x: point.x, y: point.y }));
  const curvature = contourCurvature(physical.points, physical.perimeterMm);
  return {
    contourPerimeterMm: round(physical.perimeterMm),
    enclosedAreaMm2: round(Math.abs(polygonArea(physicalPoints))),
    orientedBounds: orientedBounds(physicalPoints),
    curvatureSamples: curvature,
    circularArcs: circularArcs(
      physical.points,
      curvature,
      physical.perimeterMm,
      input.pixelsPerMmX,
      input.pixelsPerMmY,
    ),
  };
}

export function verifyFixedRigShapeAgnosticContourArtifactV1(
  artifact: FixedRigShapeAgnosticContourArtifactV1,
): boolean {
  const { artifactSha256, ...payload } = artifact;
  const contourSha256 = sha256({
    coordinateFrame: artifact.coordinateFrame,
    sourceAssetSha256: artifact.sourceAssetSha256,
    calibrationSha256: artifact.calibrationSha256,
    contour: artifact.contour,
  });
  return SHA256_PATTERN.test(artifactSha256) &&
    SHA256_PATTERN.test(artifact.contourSha256) &&
    contourSha256 === artifact.contourSha256 &&
    sha256(payload) === artifactSha256;
}

export function detectFixedRigShapeAgnosticContourV1(
  input: DetectFixedRigShapeAgnosticContourV1Input,
): FixedRigShapeAgnosticContourDetectionV1 {
  const reasons: string[] = [];
  const pixelCount = input.width * input.height;
  if (!Number.isSafeInteger(input.width) || input.width < 8 ||
      !Number.isSafeInteger(input.height) || input.height < 8) {
    reasons.push("Raw contour detection requires integer frame dimensions of at least 8 x 8.");
  }
  if (!finitePlane(input.observed, pixelCount) || !finitePlane(input.background, pixelCount)) {
    reasons.push("Observed and empty-fixture planes must contain one finite normalized monochrome sample per raw pixel.");
  }
  for (const [name, value] of [
    ["sourceAssetId", input.sourceAssetId],
    ["backgroundAssetId", input.backgroundAssetId],
    ["calibrationProfileId", input.calibrationProfileId],
  ] as const) {
    if (!IDENTIFIER_PATTERN.test(value)) reasons.push(`${name} must be an exact bounded identifier.`);
  }
  for (const [name, value] of [
    ["sourceAssetSha256", input.sourceAssetSha256],
    ["backgroundAssetSha256", input.backgroundAssetSha256],
    ["calibrationSha256", input.calibrationSha256],
  ] as const) {
    if (!SHA256_PATTERN.test(value)) reasons.push(`${name} must be a lowercase SHA-256.`);
  }
  if (!Number.isFinite(input.pixelsPerMmX) || input.pixelsPerMmX <= 0 ||
      !Number.isFinite(input.pixelsPerMmY) || input.pixelsPerMmY <= 0) {
    reasons.push("Positive calibrated pixels-per-millimeter values are required.");
  }
  if (reasons.length) return unavailable(reasons);

  const differences = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    differences[index] = Math.abs((input.observed[index] ?? 0) - (input.background[index] ?? 0));
  }
  const threshold = foregroundThreshold(differences);
  const initial = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    if ((differences[index] ?? 0) >= threshold) initial[index] = 1;
  }
  const selected = retainLargestComponent(initial, input.width, input.height);
  if (!selected.count) return unavailable(["No connected material contour was observed against the empty-fixture reference."]);
  const material = fillInteriorHoles(selected.mask, input.width, input.height);
  let materialCount = 0;
  for (const value of material) materialCount += value;
  const coverage = materialCount / pixelCount;
  const minimumCoverage = input.minimumForegroundCoverage ?? 0.02;
  const maximumCoverage = input.maximumForegroundCoverage ?? 0.95;
  const placementAdvisories = coverage < minimumCoverage || coverage > maximumCoverage
    ? [
        `Observed material coverage ${round(coverage)} is outside the preferred working-area envelope ${minimumCoverage}..${maximumCoverage}; the visible contour remains measured.`,
      ]
    : [];
  const traced = traceFixedRigDenseContourV1({
    width: input.width,
    height: input.height,
    field: differences,
    mask: material,
    threshold,
  });
  if (!traced) return unavailable(["The observed material mask did not produce a closed dense contour."]);
  const measured = measureFixedRigDenseContourV1({
    contour: traced.contour,
    pixelsPerMmX: input.pixelsPerMmX,
    pixelsPerMmY: input.pixelsPerMmY,
  });
  if (!measured) return unavailable(["The observed dense contour could not be measured in calibrated physical coordinates."]);
  const contourPoints = traced.contour;
  const contourSupport = traced.contourSupport;
  const contourSha256 = sha256({
    coordinateFrame: "auto_oriented_raw_sensor_pixels",
    sourceAssetSha256: input.sourceAssetSha256,
    calibrationSha256: input.calibrationSha256,
    contour: contourPoints,
  });
  const payload = {
    schemaVersion: FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_SCHEMA_VERSION,
    detectorId: FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_DETECTOR_ID,
    detectorVersion: FIXED_RIG_SHAPE_AGNOSTIC_CONTOUR_V1_DETECTOR_VERSION,
    coordinateFrame: "auto_oriented_raw_sensor_pixels" as const,
    sourceAssetId: input.sourceAssetId,
    sourceAssetSha256: input.sourceAssetSha256,
    backgroundAssetId: input.backgroundAssetId,
    backgroundAssetSha256: input.backgroundAssetSha256,
    calibrationProfileId: input.calibrationProfileId,
    calibrationSha256: input.calibrationSha256,
    widthPx: input.width,
    heightPx: input.height,
    pixelsPerMmX: round(input.pixelsPerMmX),
    pixelsPerMmY: round(input.pixelsPerMmY),
    foregroundThreshold: threshold,
    foregroundPixelCount: materialCount,
    foregroundCoverage: round(coverage),
    placementAdvisories,
    contour: contourPoints,
    contourSupport,
    contourPointCount: contourPoints.length,
    contourPerimeterMm: measured.contourPerimeterMm,
    enclosedAreaMm2: measured.enclosedAreaMm2,
    orientedBounds: measured.orientedBounds,
    curvatureSamples: measured.curvatureSamples,
    circularArcs: measured.circularArcs,
    contourSha256,
  };
  const artifact: FixedRigShapeAgnosticContourArtifactV1 = {
    ...payload,
    artifactSha256: sha256(payload),
  };
  return { status: "computed", artifact };
}
