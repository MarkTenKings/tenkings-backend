import { createHash } from 'node:crypto';
import { MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST } from '@tenkings/shared';
import {
  transformNormalizedPointToRawV1,
  transformRawPointToNormalizedV1,
  verifyCardGeometryRawToNormalizedTransformV1,
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
  'fixed_rig_raw_sensor_outer_cut_detector_v1.2.0' as const;
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
      reasons: string[];
      requiresRecapture: true;
      cardDefectDeduction: 0;
    };

export interface DetectFixedRigRawBoundObservedOuterCutV1Input {
  rawAllOnRgb: FixedRigOuterCutRgbPlaneV1;
  rawAllOnAssetId: string;
  rawAllOnAssetSha256: string;
  normalizedAllOnAssetId: string;
  normalizedAllOnAssetSha256: string;
  rawToNormalizedTransform: CardGeometryRawToNormalizedTransformV1;
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
const MAX_EFFECTIVE_SEARCH_MULTIPLIER = 4;
const ROUNDED_CORNER_RECOVERY_MARGIN_MM = 0.2;

function fail(reasons: string[]): FixedRigRawBoundObservedOuterCutDetectionV1 {
  return {
    status: 'insufficient_evidence',
    reasons: [...new Set(reasons)],
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

function normalizationAspectMismatchMm(
  transform: CardGeometryRawToNormalizedTransformV1,
  pixelsPerMmX: number,
): number {
  const expectedRawCropWidth = transform.crop.heightPx *
    transform.outputWidthPx / transform.outputHeightPx;
  const halfWidthMismatchRawPx = Math.abs(
    transform.crop.widthPx - expectedRawCropWidth,
  ) / 2;
  const normalizedPixelsPerRawCropPixel =
    transform.outputWidthPx / transform.crop.widthPx;
  return halfWidthMismatchRawPx * normalizedPixelsPerRawCropPixel / pixelsPerMmX;
}

function sortedGradientCandidates(input: {
  plane: FixedRigOuterCutRgbPlaneV1;
  point: FixedRigPointV1;
  normal: FixedRigPointV1;
  searchPixels: number;
}): Array<{ gradient: number; offset: number }> {
  const candidates: Array<{ gradient: number; offset: number }> = [];
  for (let offset = -input.searchPixels; offset < input.searchPixels; offset += 1) {
    const first = lumaAt(
      input.plane,
      input.point.x + input.normal.x * offset,
      input.point.y + input.normal.y * offset,
    );
    const second = lumaAt(
      input.plane,
      input.point.x + input.normal.x * (offset + 1),
      input.point.y + input.normal.y * (offset + 1),
    );
    if (first === undefined || second === undefined) continue;
    candidates.push({ gradient: Math.abs(second - first), offset: offset + 0.5 });
  }
  candidates.sort((left, right) => right.gradient - left.gradient ||
    Math.abs(left.offset) - Math.abs(right.offset) || left.offset - right.offset);
  return candidates;
}

function isRoundedCornerSample(tangent: FixedRigPointV1): boolean {
  return Math.abs(tangent.x) > 1e-6 && Math.abs(tangent.y) > 1e-6;
}

export function verifyFixedRigRawBoundObservedOuterCutArtifactV1(
  artifact: FixedRigRawBoundObservedOuterCutArtifactV1,
): boolean {
  const { artifactSha256, ...payload } = artifact;
  return isSha256(artifactSha256) && sha256(payload) === artifactSha256;
}

export function detectFixedRigRawBoundObservedOuterCutV1(
  input: DetectFixedRigRawBoundObservedOuterCutV1Input,
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
  if (!isIdentifier(input.calibrationProfileId) || !isIdentifier(input.calibrationVersion) ||
      !isSha256(input.calibrationSha256)) {
    reasons.push('Finalized calibration profile identity, version, and SHA-256 are required.');
  }
  const intended = input.intendedBoundary;
  if (!isIdentifier(intended.profileId) || !isIdentifier(intended.profileVersion) ||
      !isSha256(intended.artifactSha256) ||
      intended.coordinateFrame !== 'normalized_card_portrait_pixels' ||
      intended.contour.length < 4 ||
      intended.contour.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
        point.x < 0 || point.x > transform.outputWidthPx ||
        point.y < 0 || point.y > transform.outputHeightPx) ||
      signedPolygonArea(intended.contour) === 0 ||
      intendedBoundarySha256(intended) !== intended.artifactSha256) {
    reasons.push('The exact intended outer-boundary authority is malformed or its SHA-256 does not reproduce.');
  }
  if (!Number.isFinite(input.pixelsPerMmX) || input.pixelsPerMmX <= 0 ||
      !Number.isFinite(input.pixelsPerMmY) || input.pixelsPerMmY <= 0 ||
      !Number.isFinite(input.segmentationBoundaryU95Px) ||
      input.segmentationBoundaryU95Px <= 0) {
    reasons.push('Positive finalized scale and segmentation-boundary U95 are required.');
  }
  if (reasons.length) return fail(reasons);

  const rawIntended = intended.contour.map((point) =>
    transformNormalizedPointToRawV1(transform, point));
  if (rawIntended.some((point) => point.x < 0 || point.x > plane.width - 1 ||
      point.y < 0 || point.y > plane.height - 1)) {
    return fail(['The intended perimeter search band is not contained in the raw sensor image.']);
  }
  const crossSectionCount = POLICY.crossSectionsPerSide * 4;
  const perimeter = sampleFullPerimeter(rawIntended, crossSectionCount);
  if (perimeter.length !== crossSectionCount) {
    return fail(['The intended boundary could not be sampled across its complete raw perimeter.']);
  }
  const clockwise = signedPolygonArea(rawIntended) > 0;
  const minimumGradient = POLICY.minimumDirectionalGradientDigitalUnits / 255;
  const segmentationBoundaryMm = calibratedSegmentationBoundaryMm(input);
  const geometryMismatchMm = normalizationAspectMismatchMm(
    transform,
    input.pixelsPerMmX,
  );
  // The manifest band remains the first and authoritative search. A failed
  // nominal cross-section may use only the exact calibration U95 plus the
  // measured 5:7 normalization mismatch to reach the same physical edge.
  // This compensates upstream localization error without lowering the edge
  // gradient, accepting a missing sample, or consulting another image.
  const effectiveSearchHalfWidthMm = POLICY.searchHalfWidthMm +
    segmentationBoundaryMm + geometryMismatchMm;
  const maximumEffectiveSearchHalfWidthMm =
    POLICY.searchHalfWidthMm * MAX_EFFECTIVE_SEARCH_MULTIPLIER;
  if (effectiveSearchHalfWidthMm > maximumEffectiveSearchHalfWidthMm) {
    return fail([
      'The raw-to-normalized geometry mismatch exceeds the bounded outer-cut recovery envelope.',
    ]);
  }
  const detectedRaw: FixedRigPointV1[] = [];
  const gradients: number[] = [];
  let unsupported = 0;
  let ambiguous = 0;
  for (const sample of perimeter) {
    const normal = clockwise
      ? { x: sample.tangent.y, y: -sample.tangent.x }
      : { x: -sample.tangent.y, y: sample.tangent.x };
    const mmPerNormalPixel = rawVectorLengthMm(
      transform,
      normal,
      input.pixelsPerMmX,
      input.pixelsPerMmY,
    );
    if (!(mmPerNormalPixel > 0)) {
      unsupported += 1;
      continue;
    }
    const nominalSearchPixels = Math.max(
      1,
      Math.ceil(POLICY.searchHalfWidthMm / mmPerNormalPixel),
    );
    const effectiveSearchPixels = Math.max(
      nominalSearchPixels,
      Math.ceil(effectiveSearchHalfWidthMm / mmPerNormalPixel),
    );
    const roundedCornerSearchPixels = isRoundedCornerSample(sample.tangent)
      ? Math.max(
          effectiveSearchPixels,
          Math.ceil(
            (effectiveSearchHalfWidthMm + ROUNDED_CORNER_RECOVERY_MARGIN_MM) /
              mmPerNormalPixel,
          ),
        )
      : effectiveSearchPixels;
    let candidates = sortedGradientCandidates({
      plane,
      point: sample.point,
      normal,
      searchPixels: nominalSearchPixels,
    });
    let strongest = candidates[0];
    if (!strongest || strongest.gradient < minimumGradient) {
      // Recovery is deliberately staged: a supported nominal observation is
      // never replaced by a farther artwork or glare transition.
      candidates = sortedGradientCandidates({
        plane,
        point: sample.point,
        normal,
        searchPixels: effectiveSearchPixels,
      });
      strongest = candidates[0];
    }
    if ((!strongest || strongest.gradient < minimumGradient) &&
        roundedCornerSearchPixels > effectiveSearchPixels) {
      // Rounded-corner samples carry one additional, tightly bounded physical
      // profile margin. Straight edges never receive it, and it is consulted
      // only after both the manifest and calibrated geometry envelopes fail.
      candidates = sortedGradientCandidates({
        plane,
        point: sample.point,
        normal,
        searchPixels: roundedCornerSearchPixels,
      });
      strongest = candidates[0];
    }
    if (!strongest || strongest.gradient < minimumGradient) {
      unsupported += 1;
      continue;
    }
    if (candidates.some((candidate, index) => index > 0 &&
        candidate.gradient === strongest.gradient &&
        Math.abs(candidate.offset - strongest.offset) > 1)) {
      ambiguous += 1;
      continue;
    }
    detectedRaw.push({
      x: round(sample.point.x + normal.x * strongest.offset),
      y: round(sample.point.y + normal.y * strongest.offset),
    });
    gradients.push(strongest.gradient * 255);
  }
  if (unsupported || ambiguous || detectedRaw.length !== crossSectionCount) {
    return fail([
      ...(unsupported ? [
        unsupported + ' raw perimeter cross-sections lacked the manifest minimum gradient.',
      ] : []),
      ...(ambiguous ? [
        ambiguous + ' raw perimeter cross-sections had tied boundary peaks.',
      ] : []),
      'Every physical edge and rounded-corner arc requires unambiguous raw exterior evidence.',
    ]);
  }
  const normalizedContour = detectedRaw.map((point) => {
    const normalized = transformRawPointToNormalizedV1(transform, point);
    return {
      x: round(Math.max(0, Math.min(transform.outputWidthPx, normalized.x))),
      y: round(Math.max(0, Math.min(transform.outputHeightPx, normalized.y))),
    };
  });
  const meanGradient = gradients.reduce((sum, value) => sum + value, 0) / gradients.length;
  const minimumDetectedGradient = Math.min(...gradients);
  const calibratedSegmentationBoundary = segmentationBoundaryMm;
  const rawDetectorLocalization = POLICY.minimumResidualLimitPx * Math.max(
    rawVectorLengthMm(transform, { x: 1, y: 0 }, input.pixelsPerMmX, input.pixelsPerMmY),
    rawVectorLengthMm(transform, { x: 0, y: 1 }, input.pixelsPerMmX, input.pixelsPerMmY),
  );
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
    rawContour: detectedRaw,
    normalizedContour,
    crossSectionCount,
    supportedCrossSectionCount: detectedRaw.length,
    minimumGradientDigitalUnits: POLICY.minimumDirectionalGradientDigitalUnits,
    meanDetectedGradientDigitalUnits: round(meanGradient, 6),
    minimumDetectedGradientDigitalUnits: round(minimumDetectedGradient, 6),
    confidence: round(Math.min(
      1,
      minimumDetectedGradient / POLICY.minimumDirectionalGradientDigitalUnits,
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
