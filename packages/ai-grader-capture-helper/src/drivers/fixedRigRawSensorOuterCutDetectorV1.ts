import { createHash } from 'node:crypto';
import { MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST } from '@tenkings/shared';
import {
  verifyCardGeometryNormalizedDenseContourV1,
  verifyCardGeometryObservedDenseContourV1,
  verifyCardGeometryRawToNormalizedTransformV1,
  type CardGeometryNormalizedDenseContourV1,
  type CardGeometryObservedDenseContourV1,
  type CardGeometryRawToNormalizedTransformV1,
} from './cardGeometry';
import type { FixedRigPointV1 } from './fixedRigCenteringV1';
import type {
  FixedRigIntendedOuterBoundaryAuthorityV1,
  FixedRigOuterCutRgbPlaneV1,
} from './fixedRigOuterCutDetectorV1';

export const FIXED_RIG_RAW_SENSOR_OUTER_CUT_DETECTOR_V1_ID =
  'fixed_rig_raw_sensor_outer_cut_detector_v1' as const;
export const FIXED_RIG_RAW_SENSOR_OUTER_CUT_DETECTOR_V1_VERSION =
  'fixed_rig_raw_sensor_outer_cut_detector_v1.3.0' as const;
export const FIXED_RIG_RAW_BOUND_OBSERVED_OUTER_CUT_ARTIFACT_V1_SCHEMA_VERSION =
  'fixed-rig-raw-bound-observed-outer-cut-artifact-v1' as const;

export interface FixedRigRawBoundObservedOuterCutArtifactV1 {
  schemaVersion: typeof FIXED_RIG_RAW_BOUND_OBSERVED_OUTER_CUT_ARTIFACT_V1_SCHEMA_VERSION;
  detectorId: typeof FIXED_RIG_RAW_SENSOR_OUTER_CUT_DETECTOR_V1_ID;
  detectorVersion: typeof FIXED_RIG_RAW_SENSOR_OUTER_CUT_DETECTOR_V1_VERSION;
  rawCoordinateFrame: 'auto_oriented_raw_image_pixels';
  normalizedCoordinateFrame: 'normalized_card_portrait_pixels';
  rawAllOnAssetId: string;
  rawAllOnAssetSha256: string;
  rawAllOnScalarPlaneSha256: string;
  rawWidthPx: number;
  rawHeightPx: number;
  normalizedAllOnAssetId: string;
  normalizedAllOnAssetSha256: string;
  normalizedWidthPx: number;
  normalizedHeightPx: number;
  rawToNormalizedTransformSha256: string;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationSha256: string;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
  segmentationBoundaryU95Px: number;
  intendedBoundaryArtifactSha256: string;
  intendedBoundaryProfileId: string;
  intendedBoundaryProfileVersion: string;
  contourAuthority: 'canonical_pixel_derived_dense_contour';
  canonicalRawContourSha256: string;
  canonicalNormalizedContourSha256: string;
  rawContour: FixedRigPointV1[];
  normalizedContour: FixedRigPointV1[];
  crossSectionCount: number;
  supportedCrossSectionCount: number;
  minimumGradientDigitalUnits: number;
  meanDetectedGradientDigitalUnits: number;
  minimumDetectedGradientDigitalUnits: number;
  confidence: number;
  u95ComponentsMm: {
    calibratedSegmentationBoundary: number;
    rawDetectorLocalization: number;
  };
  u95Mm: number;
  artifactSha256: string;
}

export type FixedRigRawBoundObservedOuterCutDetectionV1 =
  | { status: 'computed'; artifact: FixedRigRawBoundObservedOuterCutArtifactV1 }
  | {
      status: 'insufficient_evidence';
      failureKind: 'invalid_input';
      reasons: string[];
      requiresRecapture: true;
      cardDefectDeduction: 0;
    };

export interface SealFixedRigCanonicalObservedOuterCutV1Input {
  rawAllOnRgb: FixedRigOuterCutRgbPlaneV1;
  rawAllOnAssetId: string;
  rawAllOnAssetSha256: string;
  normalizedAllOnAssetId: string;
  normalizedAllOnAssetSha256: string;
  rawToNormalizedTransform: CardGeometryRawToNormalizedTransformV1;
  observedRawContour: CardGeometryObservedDenseContourV1;
  observedNormalizedContour: CardGeometryNormalizedDenseContourV1;
  calibrationProfileId: string;
  calibrationVersion: string;
  calibrationSha256: string;
  /** Comparison-only product profile. It cannot seed or alter the observation. */
  intendedBoundary: FixedRigIntendedOuterBoundaryAuthorityV1;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
  segmentationBoundaryU95Px: number;
}

const POLICY = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance
  .outerCutBoundaryMeasurement;

function fail(
  reasons: string[],
): FixedRigRawBoundObservedOuterCutDetectionV1 {
  const exactReasons = [...new Set(reasons)];
  return {
    status: 'insufficient_evidence',
    failureKind: 'invalid_input',
    reasons: exactReasons,
    requiresRecapture: true,
    cardDefectDeduction: 0,
  };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function round(value: number, decimals = 9): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function scalarPlaneSha256(plane: FixedRigOuterCutRgbPlaneV1): string {
  const bytes = Buffer.allocUnsafe(plane.data.length * 8);
  for (let index = 0; index < plane.data.length; index += 1) {
    bytes.writeDoubleLE(Number(plane.data[index]), index * 8);
  }
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalContour(
  contour: readonly FixedRigPointV1[],
): ReadonlyArray<readonly [number, number]> {
  const points = contour.map((point) => [point.x, point.y] as const);
  if (points.length > 1 && points[0]![0] === points.at(-1)![0] &&
      points[0]![1] === points.at(-1)![1]) points.pop();
  const rotations = (ordered: ReadonlyArray<readonly [number, number]>) =>
    ordered.map((_, offset) => [...ordered.slice(offset), ...ordered.slice(0, offset)]);
  return [...rotations(points), ...rotations([...points].reverse())]
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))[0] ?? [];
}

function intendedBoundarySha256(
  boundary: FixedRigIntendedOuterBoundaryAuthorityV1,
): string {
  return sha256({
    schemaVersion: 'fixed-rig-intended-outer-boundary-v1',
    profileId: boundary.profileId,
    profileVersion: boundary.profileVersion,
    coordinateFrame: boundary.coordinateFrame,
    contour: canonicalContour(boundary.contour),
  });
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

function rawVectorLengthMm(
  transform: CardGeometryRawToNormalizedTransformV1,
  vector: FixedRigPointV1,
  pixelsPerMmX: number,
  pixelsPerMmY: number,
): number {
  const [a, b, , d, e] = transform.matrix;
  return Math.hypot(
    (a * vector.x + b * vector.y) / pixelsPerMmX,
    (d * vector.x + e * vector.y) / pixelsPerMmY,
  );
}

function calibratedSegmentationBoundaryMm(input: {
  segmentationBoundaryU95Px: number;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
}): number {
  return input.segmentationBoundaryU95Px * Math.max(
    1 / input.pixelsPerMmX,
    1 / input.pixelsPerMmY,
  );
}

export function verifyFixedRigRawBoundObservedOuterCutArtifactV1(
  artifact: FixedRigRawBoundObservedOuterCutArtifactV1,
): boolean {
  const { artifactSha256, ...payload } = artifact;
  return artifact.contourAuthority === 'canonical_pixel_derived_dense_contour' &&
    isSha256(artifact.canonicalRawContourSha256) &&
    isSha256(artifact.canonicalNormalizedContourSha256) &&
    isSha256(artifactSha256) &&
    sha256(payload) === artifactSha256;
}

/**
 * Seals the canonical pixel-derived contour into the mathematical grading
 * contract. Expected product geometry is recorded only as comparison metadata:
 * it never seeds, moves, clips, or vetoes an observed contour point.
 *
 * Local gradient support affects private confidence/U95 only. A visible
 * contour remains measurable in ordinary low-contrast ("foggy") evidence.
 */
export function sealFixedRigCanonicalObservedOuterCutV1(
  input: SealFixedRigCanonicalObservedOuterCutV1Input,
): FixedRigRawBoundObservedOuterCutDetectionV1 {
  const reasons: string[] = [];
  const plane = input.rawAllOnRgb;
  const invalidPlane = Array.from(plane.data).some((sample) =>
    !Number.isFinite(Number(sample)) || Number(sample) < 0 || Number(sample) > 1);
  if (!Number.isSafeInteger(plane.width) || plane.width < 1 ||
      !Number.isSafeInteger(plane.height) || plane.height < 1 ||
      plane.data.length !== plane.width * plane.height * 3 || invalidPlane) {
    reasons.push('Raw all-on RGB must contain exactly three finite 0..1 samples per sensor pixel.');
  }
  if (!isIdentifier(input.rawAllOnAssetId) || !isSha256(input.rawAllOnAssetSha256) ||
      !isIdentifier(input.normalizedAllOnAssetId) || !isSha256(input.normalizedAllOnAssetSha256)) {
    reasons.push('Exact raw and normalized all-on identities and SHA-256 values are required.');
  }
  const transform = input.rawToNormalizedTransform;
  if (!verifyCardGeometryRawToNormalizedTransformV1(transform) ||
      transform.sourceSha256 !== input.rawAllOnAssetSha256 ||
      transform.sourceWidthPx !== plane.width || transform.sourceHeightPx !== plane.height) {
    reasons.push('The hash-bound raw-to-normalized transform must name this exact raw all-on plane.');
  }
  if (
    input.observedRawContour.sourceAssetSha256 !== input.rawAllOnAssetSha256 ||
    !verifyCardGeometryObservedDenseContourV1(
      input.observedRawContour,
      plane.width,
      plane.height,
    ) ||
    !verifyCardGeometryNormalizedDenseContourV1({
      contour: input.observedNormalizedContour,
      observed: input.observedRawContour,
      transform,
    })
  ) {
    reasons.push('The canonical dense contour is malformed or not hash-bound through normalization.');
  }
  if (!isIdentifier(input.calibrationProfileId) || !isIdentifier(input.calibrationVersion) ||
      !isSha256(input.calibrationSha256)) {
    reasons.push('Finalized calibration profile identity, version, and SHA-256 are required.');
  }
  const intended = input.intendedBoundary;
  if (!isIdentifier(intended.profileId) || !isIdentifier(intended.profileVersion) ||
      !isSha256(intended.artifactSha256) ||
      intended.coordinateFrame !== 'normalized_card_portrait_pixels' ||
      intended.contour.length < 3 ||
      intendedBoundarySha256(intended) !== intended.artifactSha256) {
    reasons.push('The comparison-only intended outer-boundary authority is malformed.');
  }
  if (!Number.isFinite(input.pixelsPerMmX) || input.pixelsPerMmX <= 0 ||
      !Number.isFinite(input.pixelsPerMmY) || input.pixelsPerMmY <= 0 ||
      !Number.isFinite(input.segmentationBoundaryU95Px) ||
      input.segmentationBoundaryU95Px <= 0) {
    reasons.push('Positive finalized scale and segmentation-boundary U95 are required.');
  }
  if (reasons.length) return fail(reasons);

  const rawContour = input.observedRawContour.points.map((point) => ({
    x: point.x,
    y: point.y,
  }));
  const normalizedContour = input.observedNormalizedContour.points.map((point) => ({
    x: point.x,
    y: point.y,
  }));
  const minimumGradient = POLICY.minimumDirectionalGradientDigitalUnits;
  const gradients = rawContour.map((point, index) => {
    const before = rawContour[(index - 1 + rawContour.length) % rawContour.length]!;
    const after = rawContour[(index + 1) % rawContour.length]!;
    const tangentLength = Math.hypot(after.x - before.x, after.y - before.y);
    if (!(tangentLength > 1e-9)) return 0;
    const normal = {
      x: -(after.y - before.y) / tangentLength,
      y: (after.x - before.x) / tangentLength,
    };
    const first = lumaAt(plane, point.x - normal.x, point.y - normal.y);
    const second = lumaAt(plane, point.x + normal.x, point.y + normal.y);
    return first === undefined || second === undefined
      ? 0
      : Math.abs(second - first) * 255;
  });
  const supportedCrossSectionCount = gradients.filter(
    (gradient) => gradient >= minimumGradient,
  ).length;
  const nonzeroGradients = gradients.filter((gradient) => gradient > 0);
  const meanGradient = nonzeroGradients.length
    ? nonzeroGradients.reduce((sum, value) => sum + value, 0) / nonzeroGradients.length
    : 0;
  const minimumDetectedGradient = nonzeroGradients.length
    ? Math.min(...nonzeroGradients)
    : 0;
  const supportFraction = rawContour.length
    ? supportedCrossSectionCount / rawContour.length
    : 0;
  const calibratedSegmentationBoundary = calibratedSegmentationBoundaryMm(input);
  const baseLocalizationMm = POLICY.minimumResidualLimitPx * Math.max(
    rawVectorLengthMm(transform, { x: 1, y: 0 }, input.pixelsPerMmX, input.pixelsPerMmY),
    rawVectorLengthMm(transform, { x: 0, y: 1 }, input.pixelsPerMmX, input.pixelsPerMmY),
  );
  const privateQualityPenalty = 1 + (1 - supportFraction) * 4;
  const rawDetectorLocalization = baseLocalizationMm * privateQualityPenalty;
  const u95Mm = Math.hypot(calibratedSegmentationBoundary, rawDetectorLocalization);
  const payload = {
    schemaVersion: FIXED_RIG_RAW_BOUND_OBSERVED_OUTER_CUT_ARTIFACT_V1_SCHEMA_VERSION,
    detectorId: FIXED_RIG_RAW_SENSOR_OUTER_CUT_DETECTOR_V1_ID,
    detectorVersion: FIXED_RIG_RAW_SENSOR_OUTER_CUT_DETECTOR_V1_VERSION,
    rawCoordinateFrame: 'auto_oriented_raw_image_pixels' as const,
    normalizedCoordinateFrame: 'normalized_card_portrait_pixels' as const,
    rawAllOnAssetId: input.rawAllOnAssetId,
    rawAllOnAssetSha256: input.rawAllOnAssetSha256,
    rawAllOnScalarPlaneSha256: scalarPlaneSha256(plane),
    rawWidthPx: plane.width,
    rawHeightPx: plane.height,
    normalizedAllOnAssetId: input.normalizedAllOnAssetId,
    normalizedAllOnAssetSha256: input.normalizedAllOnAssetSha256,
    normalizedWidthPx: transform.outputWidthPx,
    normalizedHeightPx: transform.outputHeightPx,
    rawToNormalizedTransformSha256: transform.transformSha256,
    calibrationProfileId: input.calibrationProfileId,
    calibrationVersion: input.calibrationVersion,
    calibrationSha256: input.calibrationSha256,
    pixelsPerMmX: round(input.pixelsPerMmX),
    pixelsPerMmY: round(input.pixelsPerMmY),
    segmentationBoundaryU95Px: round(input.segmentationBoundaryU95Px),
    intendedBoundaryArtifactSha256: intended.artifactSha256,
    intendedBoundaryProfileId: intended.profileId,
    intendedBoundaryProfileVersion: intended.profileVersion,
    contourAuthority: 'canonical_pixel_derived_dense_contour' as const,
    canonicalRawContourSha256: input.observedRawContour.contourSha256,
    canonicalNormalizedContourSha256: input.observedNormalizedContour.contourSha256,
    rawContour,
    normalizedContour,
    crossSectionCount: rawContour.length,
    supportedCrossSectionCount,
    minimumGradientDigitalUnits: minimumGradient,
    meanDetectedGradientDigitalUnits: round(meanGradient, 6),
    minimumDetectedGradientDigitalUnits: round(minimumDetectedGradient, 6),
    confidence: round(Math.min(
      1,
      0.25 + 0.75 * Math.max(
        supportFraction,
        input.observedRawContour.strongSupportFraction,
      ),
    ), 6),
    u95ComponentsMm: {
      calibratedSegmentationBoundary: round(calibratedSegmentationBoundary),
      rawDetectorLocalization: round(rawDetectorLocalization),
    },
    u95Mm: round(u95Mm),
  };
  return {
    status: 'computed',
    artifact: { ...payload, artifactSha256: sha256(payload) },
  };
}
