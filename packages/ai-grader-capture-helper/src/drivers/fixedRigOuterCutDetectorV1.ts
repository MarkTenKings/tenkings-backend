import { createHash } from "node:crypto";
import { MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST } from "@tenkings/shared";
import type { FixedRigPointV1 } from "./fixedRigCenteringV1";

export const FIXED_RIG_OUTER_CUT_DETECTOR_V1_ID =
  "fixed_rig_normalized_outer_cut_detector_v1" as const;
export const FIXED_RIG_OUTER_CUT_DETECTOR_V1_VERSION =
  "fixed_rig_normalized_outer_cut_detector_v1.0.0" as const;
export const FIXED_RIG_OBSERVED_OUTER_CUT_ARTIFACT_V1_SCHEMA_VERSION =
  "fixed-rig-observed-outer-cut-artifact-v1" as const;

export interface FixedRigOuterCutRgbPlaneV1 {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

export interface FixedRigIntendedOuterBoundaryAuthorityV1 {
  profileId: string;
  profileVersion: string;
  artifactSha256: string;
  coordinateFrame: "normalized_card_portrait_pixels";
  contour: FixedRigPointV1[];
}

export interface FixedRigObservedOuterCutArtifactV1 {
  schemaVersion: typeof FIXED_RIG_OBSERVED_OUTER_CUT_ARTIFACT_V1_SCHEMA_VERSION;
  detectorId: typeof FIXED_RIG_OUTER_CUT_DETECTOR_V1_ID;
  detectorVersion: typeof FIXED_RIG_OUTER_CUT_DETECTOR_V1_VERSION;
  coordinateFrame: "normalized_card_portrait_pixels";
  normalizedAllOnAssetId: string;
  normalizedAllOnAssetSha256: string;
  normalizedAllOnScalarPlaneSha256: string;
  normalizedWidthPx: number;
  normalizedHeightPx: number;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationSha256: string;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
  segmentationBoundaryU95Px: number;
  intendedBoundaryArtifactSha256: string;
  intendedBoundaryProfileId: string;
  intendedBoundaryProfileVersion: string;
  contour: FixedRigPointV1[];
  crossSectionCount: number;
  supportedCrossSectionCount: number;
  minimumGradientDigitalUnits: number;
  meanDetectedGradientDigitalUnits: number;
  minimumDetectedGradientDigitalUnits: number;
  confidence: number;
  u95Mm: number;
  artifactSha256: string;
}

export type FixedRigObservedOuterCutDetectionV1 =
  | { status: "computed"; artifact: FixedRigObservedOuterCutArtifactV1 }
  | {
      status: "insufficient_evidence";
      reasons: string[];
      requiresRecapture: true;
      cardDefectDeduction: 0;
    };

export interface DetectFixedRigObservedOuterCutV1Input {
  normalizedAllOnRgb: FixedRigOuterCutRgbPlaneV1;
  normalizedAllOnAssetId: string;
  normalizedAllOnAssetSha256: string;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationSha256: string;
  intendedBoundary: FixedRigIntendedOuterBoundaryAuthorityV1;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
  segmentationBoundaryU95Px: number;
}

const POLICY = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance
  .outerCutBoundaryMeasurement;

function fail(reasons: string[]): FixedRigObservedOuterCutDetectionV1 {
  return {
    status: "insufficient_evidence",
    reasons: [...new Set(reasons)],
    requiresRecapture: true,
    cardDefectDeduction: 0,
  };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function round(value: number, decimals = 9): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function canonicalAuthorityContour(
  contour: readonly FixedRigPointV1[],
): ReadonlyArray<readonly [number, number]> {
  const points = contour.map((point) => [point.x, point.y] as const);
  if (points.length > 1 &&
      points[0]![0] === points.at(-1)![0] &&
      points[0]![1] === points.at(-1)![1]) {
    points.pop();
  }
  const rotations = (ordered: ReadonlyArray<readonly [number, number]>) =>
    ordered.map((_, offset) => [...ordered.slice(offset), ...ordered.slice(0, offset)]);
  return [...rotations(points), ...rotations([...points].reverse())]
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))[0] ?? [];
}

function intendedBoundarySha256(boundary: FixedRigIntendedOuterBoundaryAuthorityV1): string {
  return canonicalSha256({
    schemaVersion: "fixed-rig-intended-outer-boundary-v1",
    profileId: boundary.profileId,
    profileVersion: boundary.profileVersion,
    coordinateFrame: boundary.coordinateFrame,
    contour: canonicalAuthorityContour(boundary.contour),
  });
}

function scalarPlaneSha256(plane: FixedRigOuterCutRgbPlaneV1): string {
  const bytes = Buffer.allocUnsafe(plane.data.length * 8);
  for (let index = 0; index < plane.data.length; index += 1) {
    bytes.writeDoubleLE(Number(plane.data[index]), index * 8);
  }
  return createHash("sha256").update(bytes).digest("hex");
}

function signedPolygonArea(contour: readonly FixedRigPointV1[]): number {
  let twiceArea = 0;
  for (let index = 0; index < contour.length; index += 1) {
    const current = contour[index]!;
    const next = contour[(index + 1) % contour.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function sampleFullPerimeter(
  contour: readonly FixedRigPointV1[],
  count: number,
): Array<{ point: FixedRigPointV1; tangent: FixedRigPointV1 }> {
  const segments = contour.map((point, index) => {
    const next = contour[(index + 1) % contour.length]!;
    return { point, next, length: Math.hypot(next.x - point.x, next.y - point.y) };
  }).filter((segment) => segment.length > 1e-9);
  const perimeter = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (!(perimeter > 0)) return [];
  const samples: Array<{ point: FixedRigPointV1; tangent: FixedRigPointV1 }> = [];
  let segmentIndex = 0;
  let segmentStart = 0;
  for (let index = 0; index < count; index += 1) {
    const target = perimeter * index / count;
    while (segmentIndex < segments.length - 1 &&
        segmentStart + segments[segmentIndex]!.length < target) {
      segmentStart += segments[segmentIndex]!.length;
      segmentIndex += 1;
    }
    const segment = segments[segmentIndex]!;
    const mix = (target - segmentStart) / segment.length;
    samples.push({
      point: {
        x: segment.point.x + (segment.next.x - segment.point.x) * mix,
        y: segment.point.y + (segment.next.y - segment.point.y) * mix,
      },
      tangent: {
        x: (segment.next.x - segment.point.x) / segment.length,
        y: (segment.next.y - segment.point.y) / segment.length,
      },
    });
  }
  return samples;
}

function lumaAt(plane: FixedRigOuterCutRgbPlaneV1, x: number, y: number): number | undefined {
  if (x < 0 || y < 0 || x > plane.width - 1 || y > plane.height - 1) return undefined;
  const left = Math.floor(x);
  const right = Math.min(plane.width - 1, left + 1);
  const top = Math.floor(y);
  const bottom = Math.min(plane.height - 1, top + 1);
  const mixX = x - left;
  const mixY = y - top;
  const pixel = (px: number, py: number) => {
    const index = (py * plane.width + px) * 3;
    return 0.2126 * Number(plane.data[index]) +
      0.7152 * Number(plane.data[index + 1]) +
      0.0722 * Number(plane.data[index + 2]);
  };
  const upper = pixel(left, top) * (1 - mixX) + pixel(right, top) * mixX;
  const lower = pixel(left, bottom) * (1 - mixX) + pixel(right, bottom) * mixX;
  return upper * (1 - mixY) + lower * mixY;
}

export function detectFixedRigObservedOuterCutV1(
  input: DetectFixedRigObservedOuterCutV1Input,
): FixedRigObservedOuterCutDetectionV1 {
  const reasons: string[] = [];
  const plane = input.normalizedAllOnRgb;
  let invalidPlaneSample = false;
  for (let index = 0; index < plane.data.length; index += 1) {
    const value = Number(plane.data[index]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      invalidPlaneSample = true;
      break;
    }
  }
  if (!Number.isSafeInteger(plane.width) || plane.width < 1 ||
      !Number.isSafeInteger(plane.height) || plane.height < 1 ||
      plane.data.length !== plane.width * plane.height * 3 ||
      invalidPlaneSample) {
    reasons.push("Normalized all-on RGB must contain exactly three finite 0..1 samples per calibrated pixel.");
  }
  if (!isIdentifier(input.normalizedAllOnAssetId) || !isSha256(input.normalizedAllOnAssetSha256)) {
    reasons.push("Normalized all-on source identity and SHA-256 are invalid.");
  }
  if (!isIdentifier(input.calibrationProfileId) || !isIdentifier(input.calibrationVersion) ||
      !isSha256(input.calibrationSha256)) {
    reasons.push("Finalized calibration profile identity, version, and SHA-256 are invalid.");
  }
  const intended = input.intendedBoundary;
  if (!isIdentifier(intended.profileId) || !isIdentifier(intended.profileVersion) ||
      !isSha256(intended.artifactSha256) || intended.coordinateFrame !== "normalized_card_portrait_pixels" ||
      intended.contour.length < 4 || intended.contour.some((point) =>
        !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x < 0 || point.x > plane.width || point.y < 0 || point.y > plane.height) ||
      signedPolygonArea(intended.contour) === 0) {
    reasons.push("Exact intended outer-boundary profile authority is malformed or outside the normalized frame.");
  } else if (intendedBoundarySha256(intended) !== intended.artifactSha256) {
    reasons.push("Exact intended outer-boundary profile SHA-256 does not reproduce.");
  }
  if (!Number.isFinite(input.pixelsPerMmX) || input.pixelsPerMmX <= 0 ||
      !Number.isFinite(input.pixelsPerMmY) || input.pixelsPerMmY <= 0 ||
      !Number.isFinite(input.segmentationBoundaryU95Px) || input.segmentationBoundaryU95Px <= 0) {
    reasons.push("Finalized scale and positive segmentation-boundary U95 are required.");
  }
  if (reasons.length) return fail(reasons);

  const crossSectionCount = POLICY.crossSectionsPerSide * 4;
  const perimeter = sampleFullPerimeter(intended.contour, crossSectionCount);
  if (perimeter.length !== crossSectionCount) {
    return fail(["The exact intended boundary could not be sampled across its complete perimeter."]);
  }
  const clockwise = signedPolygonArea(intended.contour) > 0;
  const minimumGradient = POLICY.minimumDirectionalGradientDigitalUnits / 255;
  const detected: FixedRigPointV1[] = [];
  const gradients: number[] = [];
  const unsupported: number[] = [];
  const ambiguous: number[] = [];
  perimeter.forEach((sample, sampleIndex) => {
    const normal = clockwise
      ? { x: sample.tangent.y, y: -sample.tangent.x }
      : { x: -sample.tangent.y, y: sample.tangent.x };
    const mmPerNormalPixel = Math.hypot(
      normal.x / input.pixelsPerMmX,
      normal.y / input.pixelsPerMmY,
    );
    const searchPixels = Math.max(1, Math.ceil(POLICY.searchHalfWidthMm / mmPerNormalPixel));
    const candidates: Array<{ gradient: number; offset: number }> = [];
    for (let offset = -searchPixels; offset < searchPixels; offset += 1) {
      const first = lumaAt(
        plane,
        sample.point.x + normal.x * offset,
        sample.point.y + normal.y * offset,
      );
      const second = lumaAt(
        plane,
        sample.point.x + normal.x * (offset + 1),
        sample.point.y + normal.y * (offset + 1),
      );
      if (first === undefined || second === undefined) continue;
      candidates.push({ gradient: Math.abs(second - first), offset: offset + 0.5 });
    }
    candidates.sort((left, right) => right.gradient - left.gradient ||
      Math.abs(left.offset) - Math.abs(right.offset) || left.offset - right.offset);
    const strongest = candidates[0];
    if (!strongest || strongest.gradient < minimumGradient) {
      unsupported.push(sampleIndex);
      return;
    }
    // Adjacent equal-gradient samples are one bilinear transition plateau. A
    // second equal peak separated by at least one intervening sample is a
    // genuinely ambiguous boundary and must fail closed.
    if (candidates.some((candidate, index) => index > 0 &&
        candidate.gradient === strongest.gradient &&
        Math.abs(candidate.offset - strongest.offset) > 1)) {
      ambiguous.push(sampleIndex);
      return;
    }
    detected.push({
      x: round(sample.point.x + normal.x * strongest.offset),
      y: round(sample.point.y + normal.y * strongest.offset),
    });
    gradients.push(strongest.gradient * 255);
  });
  if (unsupported.length || ambiguous.length || detected.length !== crossSectionCount) {
    return fail([
      ...(unsupported.length ? [
        `${unsupported.length} full-perimeter cross-sections lacked the manifest minimum boundary gradient.`,
      ] : []),
      ...(ambiguous.length ? [
        `${ambiguous.length} full-perimeter cross-sections had tied boundary peaks and were ambiguous.`,
      ] : []),
      "Every intended edge and rounded-corner arc must have supported, unambiguous observed-cut evidence.",
    ]);
  }
  const meanGradient = gradients.reduce((sum, value) => sum + value, 0) / gradients.length;
  const minimumDetectedGradient = Math.min(...gradients);
  const u95Mm = input.segmentationBoundaryU95Px * Math.max(
    1 / input.pixelsPerMmX,
    1 / input.pixelsPerMmY,
  );
  const payload = {
    schemaVersion: FIXED_RIG_OBSERVED_OUTER_CUT_ARTIFACT_V1_SCHEMA_VERSION,
    detectorId: FIXED_RIG_OUTER_CUT_DETECTOR_V1_ID,
    detectorVersion: FIXED_RIG_OUTER_CUT_DETECTOR_V1_VERSION,
    coordinateFrame: "normalized_card_portrait_pixels" as const,
    normalizedAllOnAssetId: input.normalizedAllOnAssetId,
    normalizedAllOnAssetSha256: input.normalizedAllOnAssetSha256,
    normalizedAllOnScalarPlaneSha256: scalarPlaneSha256(plane),
    normalizedWidthPx: plane.width,
    normalizedHeightPx: plane.height,
    calibrationProfileId: input.calibrationProfileId,
    calibrationVersion: input.calibrationVersion,
    calibrationSha256: input.calibrationSha256,
    pixelsPerMmX: round(input.pixelsPerMmX),
    pixelsPerMmY: round(input.pixelsPerMmY),
    segmentationBoundaryU95Px: round(input.segmentationBoundaryU95Px),
    intendedBoundaryArtifactSha256: intended.artifactSha256,
    intendedBoundaryProfileId: intended.profileId,
    intendedBoundaryProfileVersion: intended.profileVersion,
    contour: detected,
    crossSectionCount,
    supportedCrossSectionCount: detected.length,
    minimumGradientDigitalUnits: POLICY.minimumDirectionalGradientDigitalUnits,
    meanDetectedGradientDigitalUnits: round(meanGradient, 6),
    minimumDetectedGradientDigitalUnits: round(minimumDetectedGradient, 6),
    confidence: round(Math.min(1, minimumDetectedGradient / POLICY.minimumDirectionalGradientDigitalUnits), 6),
    u95Mm: round(u95Mm),
  };
  return {
    status: "computed",
    artifact: { ...payload, artifactSha256: canonicalSha256(payload) },
  };
}

export function verifyFixedRigObservedOuterCutArtifactV1(
  artifact: FixedRigObservedOuterCutArtifactV1,
): boolean {
  const { artifactSha256, ...payload } = artifact;
  return isSha256(artifactSha256) && canonicalSha256(payload) === artifactSha256;
}
