import type { SpeedsterCardSide, SpeedsterConditionZone, SpeedsterReviewFinding } from './contracts';
import { isSpeedsterSourceMeasuredDefect } from './contracts';
import { speedsterFindingRegions } from './review-findings';
import { calculateSpeedsterReview } from './review';
import {
  calculateOverallGrade,
  calculateWeightedDamagePercent,
  combineFrontBackScore,
  type SpeedsterDefectArea,
} from './scoring';

/** New ATLAS awards use this version; historical Speedster/ATLAS reports keep their original rule. */
export const ATLAS_RULE_VERSION = 'ATLAS_2026_09_30_DAMAGE_1_5_V1' as const;
export const ATLAS_GLOBAL_DAMAGE_MULTIPLIER = 1.5 as const;

/** Percentages are scoring percentages, after the global 1.5 multiplier. */
export const ATLAS_CONDITION_BANDS = [
  { score: 10, lowerPercent: 0, lowerInclusive: true, upperPercent: 0.01, upperInclusive: true, label: 'Up to 0.010% scoring damage' },
  { score: 9.5, lowerPercent: 0.01, lowerInclusive: false, upperPercent: 0.02, upperInclusive: true, label: 'More than 0.010%, up to 0.020%' },
  { score: 9, lowerPercent: 0.02, lowerInclusive: false, upperPercent: 0.03, upperInclusive: true, label: 'More than 0.020%, up to 0.030%' },
  { score: 8, lowerPercent: 0.03, lowerInclusive: false, upperPercent: 0.04, upperInclusive: true, label: 'More than 0.030%, up to 0.040%' },
  { score: 7, lowerPercent: 0.04, lowerInclusive: false, upperPercent: 0.05, upperInclusive: true, label: 'More than 0.040%, up to 0.050%' },
  { score: 6, lowerPercent: 0.05, lowerInclusive: false, upperPercent: 0.06, upperInclusive: true, label: 'More than 0.050%, up to 0.060%' },
  { score: 5, lowerPercent: 0.06, lowerInclusive: false, upperPercent: 0.07, upperInclusive: true, label: 'More than 0.060%, up to 0.070%' },
  { score: 4, lowerPercent: 0.07, lowerInclusive: false, upperPercent: 0.08, upperInclusive: true, label: 'More than 0.070%, up to 0.080%' },
  { score: 3, lowerPercent: 0.08, lowerInclusive: false, upperPercent: 0.09, upperInclusive: true, label: 'More than 0.080%, up to 0.090%' },
  { score: 2, lowerPercent: 0.09, lowerInclusive: false, upperPercent: 0.1, upperInclusive: true, label: 'More than 0.090%, up to 0.100%' },
  { score: 1, lowerPercent: 0.1, lowerInclusive: false, upperPercent: null, upperInclusive: false, label: 'More than 0.100% scoring damage' },
] as const;

export function calculateAtlasScoringDamagePercent(baseWeightedDamagePercent: number): number {
  return Math.round(baseWeightedDamagePercent * ATLAS_GLOBAL_DAMAGE_MULTIPLIER * 1e12) / 1e12;
}

export function calculateAtlasConditionScore(baseWeightedDamagePercent: number): number {
  const scoringPercent = calculateAtlasScoringDamagePercent(baseWeightedDamagePercent);
  return ATLAS_CONDITION_BANDS.find(band => band.upperPercent === null || scoringPercent <= band.upperPercent)!.score;
}

type Capture = Parameters<typeof calculateSpeedsterReview>[0];
type GroupEntry = { findingIndex: number; regionIndex: number; defect: SpeedsterDefectArea; areaMm2: number; zonePercent: number };
const SIDES = ['FRONT', 'BACK'] as const;
const ZONES = ['CORNERS', 'EDGES', 'SURFACE'] as const;
const key = (side: SpeedsterCardSide, zone: SpeedsterConditionZone) => `${side}:${zone}`;

/** Reuse the historical measurement/review parser, then replace only ATLAS score decisions.
 * Persisted weightedDamagePercent remains the measured, type-weighted percentage;
 * the global factor is applied only when deciding the score and marginal effect.
 */
export function calculateAtlasReview(capture: Capture, defects: readonly SpeedsterReviewFinding[]) {
  const historical = calculateSpeedsterReview(capture, defects);
  const groups = new Map<string, GroupEntry[]>();
  for (const side of SIDES) for (const zone of ZONES) groups.set(key(side, zone), []);
  defects.forEach((finding, findingIndex) => {
    if (finding.reviewResult === 'REMOVED') return;
    speedsterFindingRegions(finding).forEach((region, regionIndex) => {
      groups.get(key(finding.side, region.zone))!.push({ findingIndex, regionIndex,
        defect: { areaMm2: region.measurement.areaMm2, defectType: finding.defectType },
        areaMm2: region.measurement.areaMm2, zonePercent: region.measurement.zonePercent });
    });
  });
  const sideGrade = (side: SpeedsterCardSide) => {
    const previous = historical.grade[side === 'FRONT' ? 'front' : 'back'];
    return { ...previous,
      corners: { ...previous.corners, score: calculateAtlasConditionScore(previous.corners.weightedDamagePercent) },
      edges: { ...previous.edges, score: calculateAtlasConditionScore(previous.edges.weightedDamagePercent) },
      surface: { ...previous.surface, score: calculateAtlasConditionScore(previous.surface.weightedDamagePercent) } };
  };
  const front = sideGrade('FRONT'), back = sideGrade('BACK');
  const subgrades = {
    centering: combineFrontBackScore(front.centering.score, back.centering.score),
    corners: combineFrontBackScore(front.corners.score, back.corners.score),
    edges: combineFrontBackScore(front.edges.score, back.edges.score),
    surface: combineFrontBackScore(front.surface.score, back.surface.score),
  };
  const grade = { front, back, subgrades, overall: calculateOverallGrade(subgrades) };
  const effectFor = (findingIndex: number, regionIndex: number, side: SpeedsterCardSide, zone: SpeedsterConditionZone) => {
    const entries = groups.get(key(side, zone))!;
    const measured = entries.find(entry => entry.areaMm2 > 0 && entry.zonePercent > 0);
    const eligibleAreaMm2 = measured ? measured.areaMm2 / (measured.zonePercent / 100) : 1;
    const withAll = grade[side === 'FRONT' ? 'front' : 'back'][zone.toLowerCase() as 'corners' | 'edges' | 'surface'].score;
    const withoutTarget = calculateAtlasConditionScore(calculateWeightedDamagePercent(eligibleAreaMm2,
      entries.filter(entry => entry.findingIndex !== findingIndex || entry.regionIndex !== regionIndex).map(entry => entry.defect)));
    return Math.max(0, (withoutTarget - withAll) * (side === 'FRONT' ? 0.7 : 0.3));
  };
  const reviewedDefects = historical.defects.map((finding, findingIndex) => {
    if (finding.reviewResult === 'REMOVED') return finding;
    if (isSpeedsterSourceMeasuredDefect(finding)) return { ...finding,
      measurementRegions: finding.measurementRegions.map((region, regionIndex) => ({ ...region,
        measurement: { ...region.measurement,
          subgradeEffect: effectFor(findingIndex, regionIndex, finding.side, region.zone) } })) };
    return { ...finding, measurement: { ...finding.measurement,
      subgradeEffect: effectFor(findingIndex, 0, finding.side, finding.zone) } };
  });
  return { defects: reviewedDefects, grade };
}
