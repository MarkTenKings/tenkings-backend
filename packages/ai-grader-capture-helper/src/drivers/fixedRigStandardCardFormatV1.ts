import { createHash } from 'node:crypto';
import { MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST } from '@tenkings/shared';
import type { FixedRigPointV1 } from './fixedRigCenteringV1';
import type { FixedRigIntendedOuterBoundaryAuthorityV1 } from './fixedRigOuterCutDetectorV1';

const STANDARD_CARD = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST
  .cardFormats.standardTradingCard;
export const FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID = STANDARD_CARD.profileId;
export const FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_VERSION = STANDARD_CARD.profileVersion;
export const FIXED_RIG_STANDARD_TRADING_CARD_WIDTH_MM = STANDARD_CARD.widthMm;
export const FIXED_RIG_STANDARD_TRADING_CARD_HEIGHT_MM = STANDARD_CARD.heightMm;
export const FIXED_RIG_STANDARD_TRADING_CARD_CORNER_RADIUS_MM = STANDARD_CARD.cornerRadiusMm;

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

function hashBoundary(boundary: Omit<FixedRigIntendedOuterBoundaryAuthorityV1, 'artifactSha256'>): string {
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: 'fixed-rig-intended-outer-boundary-v1',
    profileId: boundary.profileId,
    profileVersion: boundary.profileVersion,
    coordinateFrame: boundary.coordinateFrame,
    contour: canonicalContour(boundary.contour),
  }), 'utf8').digest('hex');
}

function roundedRectangleContour(input: {
  width: number;
  height: number;
  widthMm: number;
  heightMm: number;
  radiusMm: number;
  segmentsPerArc: number;
}): FixedRigPointV1[] {
  const { width, height } = input;
  const radiusX = width * input.radiusMm / input.widthMm;
  const radiusY = height * input.radiusMm / input.heightMm;
  const contour: FixedRigPointV1[] = [{ x: radiusX, y: 0 }, { x: width - radiusX, y: 0 }];
  const arcs = [
    { cx: width - radiusX, cy: radiusY, start: -Math.PI / 2, end: 0 },
    { cx: width - radiusX, cy: height - radiusY, start: 0, end: Math.PI / 2 },
    { cx: radiusX, cy: height - radiusY, start: Math.PI / 2, end: Math.PI },
    { cx: radiusX, cy: radiusY, start: Math.PI, end: Math.PI * 1.5 },
  ];
  const segmentsPerArc = input.segmentsPerArc;
  arcs.forEach((arc, arcIndex) => {
    const last = arcIndex === arcs.length - 1 ? segmentsPerArc - 1 : segmentsPerArc;
    for (let index = 1; index <= last; index += 1) {
      const angle = arc.start + (arc.end - arc.start) * index / segmentsPerArc;
      contour.push({
        x: Number((arc.cx + radiusX * Math.cos(angle)).toFixed(9)),
        y: Number((arc.cy + radiusY * Math.sin(angle)).toFixed(9)),
      });
    }
  });
  return contour;
}

export function buildFixedRigRoundedRectangleBoundaryV1(input: {
  normalizedWidthPx: number;
  normalizedHeightPx: number;
  profileId: string;
  profileVersion: string;
  widthMm: number;
  heightMm: number;
  radiusMm: number;
  contourArcSegmentsPerCorner: number;
}): FixedRigIntendedOuterBoundaryAuthorityV1 {
  if (!Number.isSafeInteger(input.normalizedWidthPx) || input.normalizedWidthPx < 100 ||
      !Number.isSafeInteger(input.normalizedHeightPx) || input.normalizedHeightPx < 100) {
    throw new Error('Standard card-format authority requires positive integer normalized dimensions.');
  }
  if (!Number.isFinite(input.widthMm) || input.widthMm <= 0 ||
      !Number.isFinite(input.heightMm) || input.heightMm <= 0 ||
      !Number.isFinite(input.radiusMm) || input.radiusMm <= 0 ||
      !Number.isSafeInteger(input.contourArcSegmentsPerCorner) ||
      input.contourArcSegmentsPerCorner < 4) {
    throw new Error('Rounded card-format authority requires exact positive physical geometry.');
  }
  const withoutHash = {
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    coordinateFrame: 'normalized_card_portrait_pixels' as const,
    contour: roundedRectangleContour({
      width: input.normalizedWidthPx,
      height: input.normalizedHeightPx,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      radiusMm: input.radiusMm,
      segmentsPerArc: input.contourArcSegmentsPerCorner,
    }),
  };
  return { ...withoutHash, artifactSha256: hashBoundary(withoutHash) };
}

export function buildFixedRigStandardTradingCardBoundaryV1(input: {
  normalizedWidthPx: number;
  normalizedHeightPx: number;
}): FixedRigIntendedOuterBoundaryAuthorityV1 {
  return buildFixedRigRoundedRectangleBoundaryV1({
    normalizedWidthPx: input.normalizedWidthPx,
    normalizedHeightPx: input.normalizedHeightPx,
    profileId: FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID,
    profileVersion: FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_VERSION,
    widthMm: FIXED_RIG_STANDARD_TRADING_CARD_WIDTH_MM,
    heightMm: FIXED_RIG_STANDARD_TRADING_CARD_HEIGHT_MM,
    radiusMm: FIXED_RIG_STANDARD_TRADING_CARD_CORNER_RADIUS_MM,
    contourArcSegmentsPerCorner: STANDARD_CARD.contourArcSegmentsPerCorner,
  });
}
