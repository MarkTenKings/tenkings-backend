import { SPEEDSTER_RULE_VERSION, type SpeedsterCardProfile } from './contracts';
import { canonicalizeSpeedsterSessionIdentity } from './identity';
import { parsePersistedSpeedsterReviewFindings, speedsterFindingRegions } from './review-findings';
import { calculateSpeedsterReview } from './review';
import { measureSpeedsterCenteringBorders, SPEEDSTER_DEFECT_MULTIPLIERS, calculateConditionScore,
  calculateWeightedDamagePercent, calculateDefectSubgradeEffect, combineFrontBackScore,
  calculateOverallGrade, calculateCenteringScore } from './scoring';

type SideEvidence = Readonly<{ centeringQuad: unknown; inspectionImageSha256: string }>;
type SideInspection = Readonly<{ inspected: true; imageSha256: string; findingRevision: number }>;
export type AtlasManualReportSource = Readonly<{
  cardProfile: SpeedsterCardProfile;
  identity: unknown;
  draftRevision: number;
  findingRevisions: Readonly<{ front: number; back: number }>;
  capture: Readonly<{ front: SideEvidence; back: SideEvidence }>;
  reviewedDefects: unknown;
  manualInspection: Readonly<{
    method: 'HUMAN';
    front: SideInspection;
    back: SideInspection;
  }>;
}>;

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Pure draft content for a completed human inspection. No detector is implied.
 * The caller authenticates the inspector and owns authoritative revisions.
 * Relevant edits advance the report draft; finding/trace/type/removal/review/undo
 * edits also advance that side's finding revision. Image inspection is bound
 * per side, so identity or printed-border edits preserve still-valid inspection.
 * This check cannot prove that a human actually inspected a card.
 * It grants no approval, certificate, label, learning or publication authority.
 */
function buildAtlasManualReportV1(source: AtlasManualReportSource) {
  if (!record(source) || !['SPORTS', 'POKEMON'].includes(source.cardProfile)) {
    throw new Error('ATLAS_REPORT_IDENTITY_INVALID');
  }
  if (!Number.isSafeInteger(source.draftRevision) || source.draftRevision < 1) {
    throw new Error('ATLAS_MANUAL_REPORT_REVISION_INVALID');
  }
  const inspection = source.manualInspection;
  if (!record(inspection) || inspection.method !== 'HUMAN') {
    throw new Error('ATLAS_MANUAL_INSPECTION_REQUIRED');
  }
  for (const side of ['front', 'back'] as const) {
    const observed = inspection[side], current = source.capture?.[side];
    const revision = source.findingRevisions?.[side];
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error('ATLAS_MANUAL_REPORT_REVISION_INVALID');
    }
    if (!record(observed) || observed.inspected !== true) {
      throw new Error('ATLAS_MANUAL_INSPECTION_REQUIRED');
    }
    if (!current || !sha256(current.inspectionImageSha256) || !sha256(observed.imageSha256)) {
      throw new Error('ATLAS_MANUAL_INSPECTION_IMAGE_INVALID');
    }
    if (current.inspectionImageSha256 !== observed.imageSha256 || revision !== observed.findingRevision) {
      throw new Error('ATLAS_MANUAL_INSPECTION_STALE');
    }
  }
  const { front, back } = source.capture;

  const identity = canonicalizeSpeedsterSessionIdentity(source.cardProfile, source.identity);
  const defects = parsePersistedSpeedsterReviewFindings(source.reviewedDefects);
  if (new Set(defects.map(finding => finding.id)).size !== defects.length) {
    throw new Error('ATLAS_REPORT_FINDING_ID_CONFLICT');
  }
  const capture = {
    front: { centeringBorders: measureSpeedsterCenteringBorders(front.centeringQuad) },
    back: { centeringBorders: measureSpeedsterCenteringBorders(back.centeringQuad) },
  };
  const review = calculateSpeedsterReview(capture, defects);
  return {
    version: 'atlas-manual-draft-report-v1' as const,
    ruleVersion: SPEEDSTER_RULE_VERSION,
    cardProfile: source.cardProfile,
    identity,
    draftRevision: source.draftRevision,
    inspection: {
      method: 'HUMAN' as const,
      front: { inspected: true as const, imageSha256: inspection.front.imageSha256, findingRevision: inspection.front.findingRevision },
      back: { inspected: true as const, imageSha256: inspection.back.imageSha256, findingRevision: inspection.back.findingRevision },
    },
    grade: review.grade,
    findings: review.defects,
    findingCounts: {
      total: review.defects.length,
      included: review.defects.filter(finding => finding.reviewResult !== 'REMOVED').length,
      removed: review.defects.filter(finding => finding.reviewResult === 'REMOVED').length,
      unreviewed: review.defects.filter(finding => finding.reviewResult === 'UNREVIEWED').length,
    },
  };
}

export const ATLAS_FINAL_GRADE_POLICY = 'atlas-final-half-point-v1' as const;
/** Half and quarter points are binary-exact; adding an epsilon would cross a
 * legitimate just-below-quarter raw value at the lower end of the scale. */
export function calculateAtlasFinalGrade(rawGrade: number): number {
  if (!Number.isFinite(rawGrade) || rawGrade < 1 || rawGrade > 10) throw new RangeError('ATLAS_FINAL_GRADE_INVALID');
  return Math.round(rawGrade * 2) / 2;
}

/** New ATLAS reports award a half-point final grade directly from the raw
 * overall. The unchanged Speedster grade retains its tenth-point detail.
 * Historical V1 report artifacts are read under their original policy.
 */
export function previewAtlasManualReport(source: AtlasManualReportSource) {
  const report = buildAtlasManualReportV1(source);
  return { ...report, version: 'atlas-manual-draft-report-v2' as const,
    finalGrade: calculateAtlasFinalGrade(report.grade.overall.rawGrade), finalGradePolicy: ATLAS_FINAL_GRADE_POLICY };
}

type AtlasManualReport = ReturnType<typeof buildAtlasManualReportV1> | ReturnType<typeof previewAtlasManualReport>;

// Presentation descriptors for the unchanged scoring functions. Boundary tests
// bind every endpoint to those functions; these descriptors never assign grades.
const CONDITION_BANDS = [
  { score: 10, lowerPercent: 0, lowerInclusive: true, upperPercent: 0.2, upperInclusive: true, label: 'Up to 0.2% weighted damage' },
  { score: 9, lowerPercent: 0.2, lowerInclusive: false, upperPercent: 1, upperInclusive: true, label: 'More than 0.2%, up to 1%' },
  { score: 8, lowerPercent: 1, lowerInclusive: false, upperPercent: 2, upperInclusive: true, label: 'More than 1%, up to 2%' },
  { score: 7, lowerPercent: 2, lowerInclusive: false, upperPercent: 3.5, upperInclusive: true, label: 'More than 2%, up to 3.5%' },
  { score: 6, lowerPercent: 3.5, lowerInclusive: false, upperPercent: 5, upperInclusive: false, label: 'More than 3.5%, below 5%' },
  { score: 5, lowerPercent: 5, lowerInclusive: true, upperPercent: 6, upperInclusive: false, label: 'At least 5%, below 6%' },
  { score: 4, lowerPercent: 6, lowerInclusive: true, upperPercent: 7, upperInclusive: false, label: 'At least 6%, below 7%' },
  { score: 3, lowerPercent: 7, lowerInclusive: true, upperPercent: 8, upperInclusive: false, label: 'At least 7%, below 8%' },
  { score: 2, lowerPercent: 8, lowerInclusive: true, upperPercent: 10, upperInclusive: false, label: 'At least 8%, below 10%' },
  { score: 1, lowerPercent: 10, lowerInclusive: true, upperPercent: null, upperInclusive: false, label: 'At least 10% weighted damage' },
] as const;
const REPORT_SIDES = ['FRONT', 'BACK'] as const;
const REPORT_ZONES = ['CORNERS', 'EDGES', 'SURFACE'] as const;
const REPORT_CATEGORIES = ['centering', 'corners', 'edges', 'surface'] as const;

/** Read-only explanation of a verified persisted manual report. It is returned
 * beside the report, never appended to the immutable report/approval snapshot.
 * Existing score functions remain the authority. No image/mask remeasurement,
 * provider call, proposal adoption or grading-policy change occurs here.
 */
export function explainAtlasManualReport(report: AtlasManualReport) {
  if (!record(report) || !['atlas-manual-draft-report-v1', 'atlas-manual-draft-report-v2'].includes(report.version)
    || report.ruleVersion !== SPEEDSTER_RULE_VERSION) throw new Error('ATLAS_REPORT_EXPLANATION_INVALID');
  const isHalfPointReport = report.version === 'atlas-manual-draft-report-v2';
  if (isHalfPointReport ? report.finalGradePolicy !== ATLAS_FINAL_GRADE_POLICY
    : 'finalGrade' in report || 'finalGradePolicy' in report) throw new Error('ATLAS_REPORT_EXPLANATION_INVALID');
  const findings = parsePersistedSpeedsterReviewFindings(report.findings);
  if (new Set(findings.map(finding => finding.id)).size !== findings.length) throw new Error('ATLAS_REPORT_FINDING_ID_CONFLICT');
  const requireEqual = (actual: number, expected: number) => {
    if (!Number.isFinite(actual) || actual !== expected) throw new Error('ATLAS_REPORT_EXPLANATION_GRADE_MISMATCH');
  };
  const groups = REPORT_SIDES.flatMap(side => REPORT_ZONES.map(zone => {
    const entries = findings.flatMap(finding => finding.side === side && finding.reviewResult !== 'REMOVED'
      ? speedsterFindingRegions(finding).filter(region => region.zone === zone)
        .map(region => ({ findingId: finding.id, region, defectType: finding.defectType })) : []);
    const measured = entries.find(({ region: { measurement: m } }) => m.areaMm2 > 0 && m.zonePercent > 0);
    // The historical calculator uses 1 as an empty-group arithmetic fallback.
    // That is not a physical zone measurement and must never be shown as one.
    const eligibleAreaMm2 = measured ? measured.region.measurement.areaMm2 / (measured.region.measurement.zonePercent / 100) : null;
    const defects = entries.map(({ region, defectType }) => ({ areaMm2: region.measurement.areaMm2, defectType }));
    const weightedDamagePercent = calculateWeightedDamagePercent(eligibleAreaMm2 ?? 1, defects);
    const score = calculateConditionScore(weightedDamagePercent);
    const persisted = report.grade[side === 'FRONT' ? 'front' : 'back'][zone.toLowerCase() as 'corners' | 'edges' | 'surface'];
    requireEqual(persisted.weightedDamagePercent, weightedDamagePercent); requireEqual(persisted.score, score);
    return { side, zone, entries, defects, eligibleAreaMm2, weightedDamagePercent, score };
  }));
  const groupFor = (side: typeof REPORT_SIDES[number], zone: typeof REPORT_ZONES[number]) => groups.find(group => group.side === side && group.zone === zone)!;
  const sides = Object.fromEntries(REPORT_SIDES.map(side => {
    const centering = report.grade[side === 'FRONT' ? 'front' : 'back'].centering;
    const worstPercent = Math.max(...centering.leftRightBalance, ...centering.topBottomBalance);
    // Persisted balances are already normalized to 12 decimal places. Their
    // rounded axis totals can differ slightly from 100; do not renormalize them.
    // A synthetic exact-100 axis preserves the original worst-percent input to
    // the unchanged centering function, including threshold-adjacent values.
    requireEqual(centering.score, calculateCenteringScore({ leftMm: worstPercent, rightMm: 100 - worstPercent,
      topMm: 50, bottomMm: 50 }));
    return [side, {
      centering: { ...centering, worstPercent, deductionFromTen: 10 - centering.score, withinTenTolerance: worstPercent <= 55 },
      ...Object.fromEntries(REPORT_ZONES.map(zone => {
        const group = groupFor(side, zone);
        return [zone, { eligibleAreaMm2: group.eligibleAreaMm2,
          rawAreaMm2: group.defects.reduce((sum, finding) => sum + finding.areaMm2, 0),
          weightedAreaMm2: group.defects.reduce((sum, finding) => sum + finding.areaMm2 * SPEEDSTER_DEFECT_MULTIPLIERS[finding.defectType], 0),
          weightedDamagePercent: group.weightedDamagePercent, score: group.score, deductionFromTen: 10 - group.score,
          tenBandMaxWeightedAreaMm2: group.eligibleAreaMm2 === null ? null : group.eligibleAreaMm2 * 0.002,
          scoreBand: CONDITION_BANDS.find(band => band.score === group.score)!,
        }];
      })),
    }];
  }));
  const categories = Object.fromEntries(REPORT_CATEGORIES.map(category => {
    const frontScore = report.grade.front[category].score, backScore = report.grade.back[category].score;
    const subgrade = combineFrontBackScore(frontScore, backScore);
    requireEqual(report.grade.subgrades[category], subgrade);
    return [category, { frontScore, backScore, subgrade, deductionFromTen: 10 - subgrade, overallContribution: subgrade / 4 }];
  }));
  const overall = calculateOverallGrade(report.grade.subgrades);
  requireEqual(report.grade.overall.rawGrade, overall.rawGrade); requireEqual(report.grade.overall.displayGrade, overall.displayGrade);
  const finalGrade = isHalfPointReport ? calculateAtlasFinalGrade(overall.rawGrade) : overall.displayGrade;
  if (isHalfPointReport) requireEqual(report.finalGrade, finalGrade);
  const finalGradePolicy = isHalfPointReport ? ATLAS_FINAL_GRADE_POLICY : 'atlas-historical-tenth-v1';
  return structuredClone({
    version: 'atlas-manual-grade-explanation-v1' as const,
    ruleVersion: report.ruleVersion,
    policy: {
      conditionBands: CONDITION_BANDS, defectMultipliers: SPEEDSTER_DEFECT_MULTIPLIERS,
      frontWeight: 0.7, backWeight: 0.3, categoryWeight: 0.25,
      conditionFormula: '100 × sum(measured area × defect multiplier) ÷ eligible category area',
      centeringFormula: 'Worse border percentage ≤55: 10; through 95: 10 − (percentage − 55) ÷ 5; above 95: 1',
      centering: { toleranceWorstPercent: 55, linearThroughPercent: 95, percentPerPoint: 5 },
      overallFormula: '(centering + corners + edges + surface) ÷ 4',
      rounding: 'Nearest tenth; category scores and the raw overall remain unrounded',
      finalGradePolicy, finalGradeRoundingInput: 'rawGrade',
      finalGradeFormula: isHalfPointReport
        ? 'Round the raw overall directly to the nearest 0.5; exact quarter-point ties round upward. The tenth-point detail is not an intermediate input.'
        : 'Historical V1 report: the original nearest-tenth display grade remains the final grade.',
      measurementNormalizationDecimals: 12, scoreMinimum: 1, scoreMaximum: 10, additionalCaps: null,
      marginalEffectsAdditive: false,
      marginalEffectMeaning: 'Removing this measured region from the current totals may cross a score band. These effects are not additive; overlap ownership is not remeasured.',
    },
    sides, categories,
    findings: findings.map(finding => ({ id: finding.id, side: finding.side, defectType: finding.defectType,
      reviewResult: finding.reviewResult, included: finding.reviewResult !== 'REMOVED',
      regions: speedsterFindingRegions(finding).map(region => {
        const group = groupFor(finding.side, region.zone), included = finding.reviewResult !== 'REMOVED';
        const index = included ? group.entries.findIndex(entry => entry.findingId === finding.id) : -1;
        const denominator = included ? group.eligibleAreaMm2
          : region.measurement.areaMm2 > 0 && region.measurement.zonePercent > 0
            ? region.measurement.areaMm2 / (region.measurement.zonePercent / 100) : null;
        const multiplier = SPEEDSTER_DEFECT_MULTIPLIERS[finding.defectType];
        const scoreWithoutFinding = included ? calculateConditionScore(calculateWeightedDamagePercent(group.eligibleAreaMm2 ?? 1,
          group.defects.filter((_, entryIndex) => entryIndex !== index))) : group.score;
        const marginalSubgradeEffect = included ? calculateDefectSubgradeEffect(finding.side, group.eligibleAreaMm2 ?? 1, group.defects, index) : 0;
        return { zone: region.zone, ...region.measurement, multiplier,
          weightedAreaMm2: region.measurement.areaMm2 * multiplier,
          weightedDamagePercent: included && denominator !== null
            ? calculateWeightedDamagePercent(denominator, [{ areaMm2: region.measurement.areaMm2, defectType: finding.defectType }]) : 0,
          eligibleAreaMm2: denominator, scoreWithFinding: group.score, scoreWithoutFinding,
          subgradeEffect: marginalSubgradeEffect, marginalSubgradeEffect, marginalOverallEffect: marginalSubgradeEffect / 4 };
      }),
    })),
    overall: { ...overall, roundingDelta: overall.displayGrade - overall.rawGrade,
      rawDeductionFromTen: 10 - overall.rawGrade, displayDeductionFromTen: 10 - overall.displayGrade,
      finalGrade, finalGradePolicy, finalRoundingDelta: finalGrade - overall.rawGrade },
  });
}
