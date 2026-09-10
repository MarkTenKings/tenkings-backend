import { requireThat as check } from '../src/strict.mjs';

export function validateCohort(rows, { memorySpecimens = [], holdOutFamilies = true, candidateManifestHash } = {}) {
  check(/^sha256:[a-f0-9]{64}$/.test(candidateManifestHash), 'COHORT_CANDIDATE_REQUIRED');
  const specimenSplits = new Map(), captureSplits = new Map(), familySplits = new Map(), seen = new Set();
  const sourceSplits = new Map();
  for (const r of rows) {
    check(typeof r.caseId === 'string' && !seen.has(r.caseId), 'COHORT_CASE_ID'); seen.add(r.caseId);
    check(['DEVELOPMENT', 'CALIBRATION', 'LOCKED_QUALITY', 'RELIABILITY'].includes(r.split), 'COHORT_SPLIT');
    check(r.candidateManifestHash === candidateManifestHash, 'COHORT_CANDIDATE_DRIFT');
    check(Array.isArray(r.sourceHashes) && r.sourceHashes.length === 2 && r.sourceHashes.every(h => /^sha256:[a-f0-9]{64}$/.test(h)), 'COHORT_SOURCE_HASHES');
    if (r.split !== 'RELIABILITY') for (const source of r.sourceHashes) {
      check(!sourceSplits.has(source) || sourceSplits.get(source) === r.split, 'SOURCE_SPLIT_LEAKAGE');
      sourceSplits.set(source, r.split);
    }
    for (const [key, map] of [['physicalSpecimenId', specimenSplits], ['captureGroupId', captureSplits], ['familyId', familySplits]]) {
      check(typeof r[key] === 'string' && r[key].length > 0, 'COHORT_GROUP_ID');
      if (key !== 'familyId' || holdOutFamilies) check(!map.has(r[key]) || map.get(r[key]) === r.split, 'COHORT_LEAKAGE');
      map.set(r[key], r.split);
    }
    if (r.split === 'LOCKED_QUALITY') check(!memorySpecimens.includes(r.physicalSpecimenId), 'MEMORY_LEAKAGE');
  }
  return { admittedCases: rows.length, groupedSpecimens: specimenSplits.size, heldOutFamilies: holdOutFamilies };
}

export function rateIncludingAbstentions(admittedCaseIds, results, predicate) {
  check(admittedCaseIds.length > 0 && new Set(admittedCaseIds).size === admittedCaseIds.length, 'ADMITTED_ROSTER_REQUIRED');
  check(results.length === admittedCaseIds.length && new Set(results.map(r => r.caseId)).size === results.length && results.every(r => admittedCaseIds.includes(r.caseId)), 'RESULT_ROSTER_MISMATCH');
  check(results.every(r => ['MEASURED', 'ABSTAINED', 'FAILED'].includes(r.status)), 'RESULT_STATUS');
  const successes = results.filter(r => r.status === 'MEASURED' && predicate(r)).length;
  return { numerator: successes, denominator: results.length, rate: successes / results.length, abstentions: results.filter(r => r.status === 'ABSTAINED').length, failures: results.filter(r => r.status === 'FAILED').length };
}

export function zeroFailureUpperBound(independentSpecimens, confidence = 0.95) {
  check(Number.isSafeInteger(independentSpecimens) && independentSpecimens > 0 && confidence > 0 && confidence < 1, 'INTERVAL_INPUT');
  return 1 - (1 - confidence) ** (1 / independentSpecimens);
}

export function staffingScenario(cards, allCardReviewSeconds, captureSeconds, productiveFraction) {
  check([cards, allCardReviewSeconds, captureSeconds, productiveFraction].every(n => Number.isFinite(n) && n > 0) && productiveFraction <= 1, 'STAFFING_INPUT');
  return { status: 'PLANNING_ASSUMPTIONS_NOT_MEASUREMENTS', reviewStaffMinutes: cards * allCardReviewSeconds / 60 / productiveFraction, captureStaffMinutes: cards * captureSeconds / 60 / productiveFraction, includesPhysicalFinishing: false };
}
