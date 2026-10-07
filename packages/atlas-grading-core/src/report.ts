import { SPEEDSTER_RULE_VERSION, isSpeedsterSourceMeasuredDefect, type SpeedsterCardProfile, type SpeedsterReviewFinding } from './contracts';
import { canonicalizeSpeedsterSessionIdentity } from './identity';
import { parsePersistedSpeedsterReviewFindings } from './review-findings';
import { calculateSpeedsterReview, completeSpeedsterReview, publicSpeedsterDefects } from './review';
import { measureSpeedsterCenteringBorders } from './scoring';

type Source = Readonly<{
  cardProfile: SpeedsterCardProfile;
  identity: unknown;
  capture: Readonly<{ front: Readonly<{ centeringQuad: unknown }>; back: Readonly<{ centeringQuad: unknown }> }>;
  reviewedDefects: unknown;
  gradeReport: unknown;
}>;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ATLAS_REPORT_SOURCE_INVALID');
  return value as Record<string, unknown>;
};
const comparable = (value: unknown): string => JSON.stringify(value, (_key, entry) => {
  if (typeof entry === 'number' && !Number.isFinite(entry)) throw new Error('ATLAS_REPORT_SOURCE_INVALID');
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return entry;
});
function calculate(source: Source, finalize: boolean) {
  if (!['SPORTS', 'POKEMON'].includes(source.cardProfile)) throw new Error('ATLAS_REPORT_IDENTITY_INVALID');
  const identity = canonicalizeSpeedsterSessionIdentity(source.cardProfile, source.identity);
  const saved = object(source.gradeReport);
  if (typeof saved.detectorVersion !== 'string' || !saved.detectorVersion.length || saved.detectorVersion.length > 160)
    throw new Error('ATLAS_REPORT_DETECTION_REQUIRED');
  const capture = { front: { centeringBorders: measureSpeedsterCenteringBorders(source.capture?.front?.centeringQuad) },
    back: { centeringBorders: measureSpeedsterCenteringBorders(source.capture?.back?.centeringQuad) } };
  const original = parsePersistedSpeedsterReviewFindings(source.reviewedDefects);
  if (new Set(original.map(f => f.id)).size !== original.length) throw new Error('ATLAS_REPORT_FINDING_ID_CONFLICT');
  const current = calculateSpeedsterReview(capture, original);
  // A plausible score is insufficient: the service's saved result must agree
  // exactly with recalculation from its confirmed quads and measured findings.
  const savedGrade = { front: saved.front, back: saved.back, subgrades: saved.subgrades, overall: saved.overall };
  if (comparable(savedGrade) !== comparable(current.grade)) throw new Error('ATLAS_REPORT_GRADE_MISMATCH');
  const review = finalize ? calculateSpeedsterReview(capture, completeSpeedsterReview(original)) : current;
  return { version: 'atlas-graded-report-v1' as const, ruleVersion: SPEEDSTER_RULE_VERSION, cardProfile: source.cardProfile,
    identity, detectorVersion: saved.detectorVersion, grade: review.grade, findings: review.defects,
    findingCounts: { total: review.defects.length, included: review.defects.filter(f => f.reviewResult !== 'REMOVED').length,
      removed: review.defects.filter(f => f.reviewResult === 'REMOVED').length,
      unreviewed: review.defects.filter(f => f.reviewResult === 'UNREVIEWED').length } };
}

/** Deterministic content only. The caller must authenticate and load its source. */
export function previewAtlasReport(source: Source) { return calculate(source, false); }

/** Call only inside exact human approval orchestration; this allocates no ID,
 * writes no state and grants no publication/certification/learning authority. */
export function finalizeAtlasReportContent(source: Source) { return calculate(source, true); }

export function presentAtlasFindings(findings: readonly SpeedsterReviewFinding[], visibility: 'DRAFT' | 'APPROVED') {
  if (visibility !== 'DRAFT' && visibility !== 'APPROVED') throw new Error('ATLAS_REPORT_VISIBILITY_INVALID');
  const selected = visibility === 'APPROVED'
    ? publicSpeedsterDefects(findings).filter(finding => ['ACCEPTED', 'SMART_MARKED', 'TYPE_CORRECTED'].includes(finding.reviewResult))
    : findings;
  // Explicit presentation projection: Memory exemplars, fingerprints, internal
  // annotations and full trace/mask bodies stay in the immutable source.
  return selected.map(finding => {
    const common = { id: finding.id, side: finding.side, defectType: finding.defectType,
      ...(finding.origin ? { origin: finding.origin } : {}),
      ...(finding.detectedDefectType ? { detectedDefectType: finding.detectedDefectType } : {}),
      confidence: finding.confidence, sourceViewId: finding.sourceViewId, supportingViewIds: [...finding.supportingViewIds],
      reviewResult: finding.reviewResult };
    const measurement = (value: { widthMm: number; heightMm: number; areaMm2: number; zonePercent: number;
      multiplier: number; weightedAreaMm2: number; subgradeEffect: number; pixelCount?: number }) => ({
      widthMm: value.widthMm, heightMm: value.heightMm, areaMm2: value.areaMm2, zonePercent: value.zonePercent,
      multiplier: value.multiplier, weightedAreaMm2: value.weightedAreaMm2, subgradeEffect: value.subgradeEffect,
      ...(value.pixelCount === undefined ? {} : { pixelCount: value.pixelCount }) });
    const points = (values: readonly { x: number; y: number }[]) => values.map(({ x, y }) => ({ x, y }));
    return isSpeedsterSourceMeasuredDefect(finding) ? { ...common, traceSha256: finding.finalTrace?.sha256,
      measurementRegions: finding.measurementRegions.map(region => ({ zone: region.zone,
        canonicalContour: points(region.canonicalContour), measurement: measurement(region.measurement) })) }
      : { ...common, zone: finding.zone, canonicalContour: points(finding.canonicalContour), measurement: measurement(finding.measurement) };
  });
}
