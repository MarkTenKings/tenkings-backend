import sharp from 'sharp';
import { MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST } from '@tenkings/shared';
import {
  projectApprovedFixedRigDesignReferenceV1,
  type FixedRigApprovedDesignReferencePixelsV1,
  type FixedRigDesignReferenceCorrespondenceV1,
  type FixedRigImmutableRasterEvidenceV1,
  type FixedRigNormalizedSourceEvidenceV1,
  type ProjectedApprovedFixedRigDesignReferenceV1,
} from './fixedRigDesignReferenceV1';
import type { FixedRigConditionDesignRegistrationV1 } from './fixedRigConditionSegmentationV1';

export const FIXED_RIG_AUTOMATIC_DESIGN_REGISTRATION_V1_VERSION =
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate
    .automaticRegistration.algorithmVersion;

export type FixedRigAutomaticDesignRegistrationV1Result =
  | {
      status: 'computed';
      projection: ProjectedApprovedFixedRigDesignReferenceV1;
      conditionRegistration: FixedRigConditionDesignRegistrationV1;
      correspondences: FixedRigDesignReferenceCorrespondenceV1[];
      algorithmVersion: typeof FIXED_RIG_AUTOMATIC_DESIGN_REGISTRATION_V1_VERSION;
    }
  | {
      status: 'insufficient_evidence';
      reasons: string[];
      requiresApprovedDesignReference: boolean;
      requiresRecapture: boolean;
      cardDefectDeduction: 0;
    };

export interface BuildFixedRigAutomaticDesignRegistrationV1Input {
  approvedReference: FixedRigApprovedDesignReferencePixelsV1;
  artifactEvidence: FixedRigImmutableRasterEvidenceV1;
  normalizedSourceEvidence: FixedRigNormalizedSourceEvidenceV1;
  measurementCalibration: {
    pixelsPerMmX: number;
    pixelsPerMmY: number;
  };
}

interface GrayImageV1 {
  width: number;
  height: number;
  data: Uint8Array;
}

const POLICY = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering
  .registeredDesignTemplate.automaticRegistration;

function insufficient(reason: string): FixedRigAutomaticDesignRegistrationV1Result {
  return {
    status: 'insufficient_evidence',
    reasons: [reason],
    requiresApprovedDesignReference: true,
    requiresRecapture: true,
    cardDefectDeduction: 0,
  };
}

async function decodeGray(bytes: Uint8Array): Promise<GrayImageV1> {
  const decoded = await sharp(bytes, { failOn: 'error' })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (decoded.info.channels !== 1) throw new Error('Raster did not decode to one grayscale channel.');
  return {
    width: decoded.info.width,
    height: decoded.info.height,
    data: new Uint8Array(decoded.data),
  };
}

function gradientAt(image: GrayImageV1, x: number, y: number): number {
  const at = (px: number, py: number) => Number(image.data[py * image.width + px]);
  const gx =
    -at(x - 1, y - 1) + at(x + 1, y - 1) -
    2 * at(x - 1, y) + 2 * at(x + 1, y) -
    at(x - 1, y + 1) + at(x + 1, y + 1);
  const gy =
    -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) +
    at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
  return Math.hypot(gx, gy) / 8;
}

function patchValues(image: GrayImageV1, centerX: number, centerY: number): number[] {
  const values: number[] = [];
  for (let dy = -POLICY.patchRadiusPx; dy <= POLICY.patchRadiusPx; dy += 1) {
    for (let dx = -POLICY.patchRadiusPx; dx <= POLICY.patchRadiusPx; dx += 1) {
      values.push(Number(image.data[(centerY + dy) * image.width + centerX + dx]) / 255);
    }
  }
  return values;
}

function patchMoments(values: readonly number[]): { mean: number; deviation: number } {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return { mean, deviation: Math.sqrt(variance) };
}

function normalizedCrossCorrelation(
  referenceValues: readonly number[],
  referenceMean: number,
  referenceDeviation: number,
  sourceValues: readonly number[],
): number {
  const source = patchMoments(sourceValues);
  if (source.deviation <= Number.EPSILON || referenceDeviation <= Number.EPSILON) return -1;
  let covariance = 0;
  for (let index = 0; index < referenceValues.length; index += 1) {
    covariance += (referenceValues[index]! - referenceMean) *
      (sourceValues[index]! - source.mean);
  }
  return covariance / (referenceValues.length * referenceDeviation * source.deviation);
}

function regionCandidates(
  image: GrayImageV1,
  column: number,
  row: number,
): Array<{ x: number; y: number; gradient: number }> {
  const insetX = Math.ceil(image.width * POLICY.insetFraction);
  const insetY = Math.ceil(image.height * POLICY.insetFraction);
  const usableWidth = image.width - insetX * 2;
  const usableHeight = image.height - insetY * 2;
  const left = Math.floor(insetX + usableWidth * column / POLICY.regionColumns);
  const right = Math.ceil(insetX + usableWidth * (column + 1) / POLICY.regionColumns);
  const top = Math.floor(insetY + usableHeight * row / POLICY.regionRows);
  const bottom = Math.ceil(insetY + usableHeight * (row + 1) / POLICY.regionRows);
  const margin = POLICY.patchRadiusPx + 1;
  const candidates: Array<{ x: number; y: number; gradient: number }> = [];
  for (let y = Math.max(margin, top); y < Math.min(image.height - margin, bottom); y += 1) {
    for (let x = Math.max(margin, left); x < Math.min(image.width - margin, right); x += 1) {
      const gradient = gradientAt(image, x, y);
      if (gradient >= POLICY.minimumGradientDigitalUnits) candidates.push({ x, y, gradient });
    }
  }
  candidates.sort((left, right) => right.gradient - left.gradient ||
    left.y - right.y || left.x - right.x);
  const selected: Array<{ x: number; y: number; gradient: number }> = [];
  for (const candidate of candidates) {
    if (selected.some((entry) =>
      Math.hypot(entry.x - candidate.x, entry.y - candidate.y) <=
        POLICY.minimumReferenceCandidateSeparationPx)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= POLICY.maximumReferenceCandidatesPerRegion) break;
  }
  return selected;
}

function matchCandidate(
  reference: GrayImageV1,
  source: GrayImageV1,
  candidate: { x: number; y: number; gradient: number },
  searchRadiusX: number,
  searchRadiusY: number,
): { x: number; y: number; ncc: number } | undefined {
  if (candidate.gradient < POLICY.minimumGradientDigitalUnits) return undefined;
  const referenceValues = patchValues(reference, candidate.x, candidate.y);
  const referenceMoments = patchMoments(referenceValues);
  if (referenceMoments.deviation < POLICY.minimumReferencePatchStandardDeviation) {
    return undefined;
  }
  const expectedX = Math.round(candidate.x * source.width / reference.width);
  const expectedY = Math.round(candidate.y * source.height / reference.height);
  const margin = POLICY.patchRadiusPx;
  const minimumX = Math.max(margin, expectedX - searchRadiusX);
  const maximumX = Math.min(source.width - margin - 1, expectedX + searchRadiusX);
  const minimumY = Math.max(margin, expectedY - searchRadiusY);
  const maximumY = Math.min(source.height - margin - 1, expectedY + searchRadiusY);
  const score = (x: number, y: number): number => normalizedCrossCorrelation(
    referenceValues,
    referenceMoments.mean,
    referenceMoments.deviation,
    patchValues(source, x, y),
  );
  const coarse: Array<{ x: number; y: number; ncc: number }> = [];
  const xSamples = new Set<number>([minimumX, maximumX, Math.min(maximumX, Math.max(minimumX, expectedX))]);
  const ySamples = new Set<number>([minimumY, maximumY, Math.min(maximumY, Math.max(minimumY, expectedY))]);
  for (let x = minimumX; x <= maximumX; x += POLICY.coarseSearchStridePx) xSamples.add(x);
  for (let y = minimumY; y <= maximumY; y += POLICY.coarseSearchStridePx) ySamples.add(y);
  for (const y of [...ySamples].sort((left, right) => left - right)) {
    for (const x of [...xSamples].sort((left, right) => left - right)) {
      coarse.push({ x, y, ncc: score(x, y) });
    }
  }
  coarse.sort((left, right) => right.ncc - left.ncc ||
    Math.hypot(left.x - expectedX, left.y - expectedY) -
      Math.hypot(right.x - expectedX, right.y - expectedY) ||
    left.y - right.y || left.x - right.x);
  const refined = new Map<string, { x: number; y: number; ncc: number }>();
  for (const seed of coarse.slice(0, POLICY.coarseCandidateCount)) {
    for (let y = Math.max(minimumY, seed.y - POLICY.coarseRefinementRadiusPx);
      y <= Math.min(maximumY, seed.y + POLICY.coarseRefinementRadiusPx); y += 1) {
      for (let x = Math.max(minimumX, seed.x - POLICY.coarseRefinementRadiusPx);
        x <= Math.min(maximumX, seed.x + POLICY.coarseRefinementRadiusPx); x += 1) {
        const key = x + ',' + y;
        if (!refined.has(key)) refined.set(key, { x, y, ncc: score(x, y) });
      }
    }
  }
  const matches = [...refined.values()];
  matches.sort((left, right) => right.ncc - left.ncc ||
    Math.hypot(left.x - expectedX, left.y - expectedY) -
      Math.hypot(right.x - expectedX, right.y - expectedY) ||
    left.y - right.y || left.x - right.x);
  const best = matches[0];
  if (!best || best.ncc < POLICY.minimumNormalizedCrossCorrelation) return undefined;
  const second = matches.find((entry) =>
    Math.hypot(entry.x - best.x, entry.y - best.y) > POLICY.ambiguityExclusionRadiusPx);
  if (second && best.ncc - second.ncc < POLICY.minimumBestVsSecondNccDelta) return undefined;
  const parabolaOffset = (negative: number, center: number, positive: number): number => {
    const denominator = negative - 2 * center + positive;
    if (!Number.isFinite(denominator) || denominator >= -Number.EPSILON) return 0;
    return Math.max(-0.5, Math.min(0.5, 0.5 * (negative - positive) / denominator));
  };
  const offsetX = best.x > minimumX && best.x < maximumX
    ? parabolaOffset(score(best.x - 1, best.y), best.ncc, score(best.x + 1, best.y))
    : 0;
  const offsetY = best.y > minimumY && best.y < maximumY
    ? parabolaOffset(score(best.x, best.y - 1), best.ncc, score(best.x, best.y + 1))
    : 0;
  return { x: best.x + offsetX, y: best.y + offsetY, ncc: best.ncc };
}

export async function buildFixedRigAutomaticDesignRegistrationV1(
  input: BuildFixedRigAutomaticDesignRegistrationV1Input,
): Promise<FixedRigAutomaticDesignRegistrationV1Result> {
  let reference: GrayImageV1;
  let source: GrayImageV1;
  try {
    [reference, source] = await Promise.all([
      decodeGray(input.artifactEvidence.bytes),
      decodeGray(input.normalizedSourceEvidence.bytes),
    ]);
  } catch {
    return insufficient('Approved reference or normalized source could not be decoded as exact raster evidence.');
  }
  if (reference.width !== input.approvedReference.artifactWidthPx ||
      reference.height !== input.approvedReference.artifactHeightPx ||
      source.width !== input.normalizedSourceEvidence.widthPx ||
      source.height !== input.normalizedSourceEvidence.heightPx) {
    return insufficient('Decoded design-reference/source dimensions do not match their immutable metadata.');
  }
  if (!Number.isFinite(input.measurementCalibration.pixelsPerMmX) ||
      input.measurementCalibration.pixelsPerMmX <= 0 ||
      !Number.isFinite(input.measurementCalibration.pixelsPerMmY) ||
      input.measurementCalibration.pixelsPerMmY <= 0) {
    return insufficient('Automatic registration requires finalized positive pixel/mm calibration on both axes.');
  }
  const searchRadiusX = Math.ceil(
    POLICY.maximumSupportedTranslationMm * input.measurementCalibration.pixelsPerMmX,
  );
  const searchRadiusY = Math.ceil(
    POLICY.maximumSupportedTranslationMm * input.measurementCalibration.pixelsPerMmY,
  );
  const regionMatchGroups: Array<{
    row: number;
    column: number;
    matches: Array<{
      candidate: { x: number; y: number; gradient: number };
      match: { x: number; y: number; ncc: number };
    }>;
  }> = [];
  for (let row = 0; row < POLICY.regionRows; row += 1) {
    for (let column = 0; column < POLICY.regionColumns; column += 1) {
      const regionMatches = regionCandidates(reference, column, row)
        .map((candidate) => ({
          candidate,
          match: matchCandidate(reference, source, candidate, searchRadiusX, searchRadiusY),
        }))
        .filter((entry): entry is {
          candidate: { x: number; y: number; gradient: number };
          match: { x: number; y: number; ncc: number };
        } => entry.match !== undefined)
        .sort((left, right) => right.match.ncc - left.match.ncc ||
          right.candidate.gradient - left.candidate.gradient ||
          left.candidate.y - right.candidate.y || left.candidate.x - right.candidate.x);
      if (regionMatches.length) regionMatchGroups.push({ row, column, matches: regionMatches });
    }
  }
  const allMatches = regionMatchGroups.flatMap((group) => group.matches);
  const displacementDistance = (
    left: { candidate: { x: number; y: number }; match: { x: number; y: number } },
    right: { candidate: { x: number; y: number }; match: { x: number; y: number } },
  ) => Math.hypot(
    (left.match.x - left.candidate.x) - (right.match.x - right.candidate.x),
    (left.match.y - left.candidate.y) - (right.match.y - right.candidate.y),
  );
  const consensusSeed = [...allMatches].sort((left, right) => {
    const leftSupport = regionMatchGroups.filter((group) => group.matches.some((entry) =>
      displacementDistance(left, entry) <=
        POLICY.maximumConsensusDisplacementResidualPx)).length;
    const rightSupport = regionMatchGroups.filter((group) => group.matches.some((entry) =>
      displacementDistance(right, entry) <=
        POLICY.maximumConsensusDisplacementResidualPx)).length;
    return rightSupport - leftSupport || right.match.ncc - left.match.ncc ||
      right.candidate.gradient - left.candidate.gradient ||
      left.candidate.y - right.candidate.y || left.candidate.x - right.candidate.x;
  })[0];
  const correspondences: FixedRigDesignReferenceCorrespondenceV1[] = [];
  if (consensusSeed) {
    for (const group of regionMatchGroups) {
      const accepted = group.matches
        .filter((entry) => displacementDistance(consensusSeed, entry) <=
          POLICY.maximumConsensusDisplacementResidualPx)
        .sort((left, right) => right.match.ncc - left.match.ncc ||
          displacementDistance(consensusSeed, left) - displacementDistance(consensusSeed, right) ||
          right.candidate.gradient - left.candidate.gradient)[0];
      if (!accepted) continue;
      const { candidate, match } = accepted;
      correspondences.push({
        correspondenceId: 'automatic-region-' + group.row.toString().padStart(2, '0') +
          '-' + group.column.toString().padStart(2, '0'),
        designReferencePointPx: { x: candidate.x, y: candidate.y },
        normalizedSourcePointPx: { x: match.x, y: match.y },
      });
    }
  }
  const bounded = correspondences.slice(0, POLICY.maximumCorrespondences);
  if (bounded.length <
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate.minimumInlierCount) {
    return insufficient(
      'Automatic registration produced ' + bounded.length +
      ' unambiguous spatial matches; the manifest requires at least ' +
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate.minimumInlierCount + '.',
    );
  }
  try {
    const projection = projectApprovedFixedRigDesignReferenceV1({
      approvedReference: input.approvedReference,
      artifactEvidence: input.artifactEvidence,
      normalizedSourceEvidence: input.normalizedSourceEvidence,
      transformType: POLICY.transformType,
      correspondences: bounded,
    });
    const projectedRegistration = projection.registration;
    if (projectedRegistration.profile !== 'registered_design_template_v1' ||
        !projectedRegistration.designReferenceId ||
        !projectedRegistration.designReferenceSha256 ||
        projectedRegistration.transformType === 'robust_line_fit') {
      return insufficient('Automatic projection did not produce an exact registered-design transform.');
    }
    return {
      status: 'computed',
      projection,
      conditionRegistration: {
        designReferenceId: projectedRegistration.designReferenceId,
        designReferenceSha256: projectedRegistration.designReferenceSha256,
        transformType: projectedRegistration.transformType,
        transformMatrix: [...projectedRegistration.transformMatrix],
        registrationResidualPx: projectedRegistration.registrationResidualPx,
        inlierCount: projectedRegistration.inlierCount,
        inlierFraction: projectedRegistration.inlierFraction,
        confidence: projectedRegistration.confidence,
      },
      correspondences: bounded,
      algorithmVersion: FIXED_RIG_AUTOMATIC_DESIGN_REGISTRATION_V1_VERSION,
    };
  } catch (error) {
    return insufficient(
      error instanceof Error ? error.message : 'Automatic design registration did not satisfy V1 acceptance.',
    );
  }
}
