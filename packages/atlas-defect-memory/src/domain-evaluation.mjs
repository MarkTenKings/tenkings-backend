import { canonical, digest, immutable, requireThat, hash } from './contract.mjs';
import { validateEvaluationCorpus, compareLearningEvaluation } from './evaluation.mjs';

const seal = value => immutable({ ...value, sha256: digest(canonical(value, { maxBytes: 16777216 })) });
const heldout = c => ['SPECIMEN_HOLDOUT', 'DESIGN_HOLDOUT', 'PROSPECTIVE'].includes(c.split);
const check = value => requireThat(value, 409, 'LEARNING_DOMAIN_EVIDENCE_INVALID');
const average = rows => rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : null;
const p95 = rows => rows.length ? [...rows].sort((a, b) => a - b)[Math.ceil(rows.length * .95) - 1] : null;
const quad = value => { check(Array.isArray(value) && value.length === 4 && value.every(p => Number.isFinite(p.x)
  && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)); return value; };
function error(actual, proposed, dimensions) {
  quad(actual); quad(proposed); const diagonal = Math.hypot(dimensions.width, dimensions.height);
  const corners = actual.map((p, i) => Math.hypot((p.x - proposed[i].x) * dimensions.width, (p.y - proposed[i].y) * dimensions.height) / diagonal);
  const edges = actual.map((p, i) => { const next = (i + 1) % 4;
    return Math.hypot((p.x + actual[next].x - proposed[i].x - proposed[next].x) * dimensions.width / 2,
      (p.y + actual[next].y - proposed[i].y - proposed[next].y) * dimensions.height / 2) / diagonal; });
  return { corner: Math.max(...corners), edge: average(edges) };
}
function metrics(rows) {
  return { cases: rows.length, specimens: new Set(rows.map(r => r.specimenId)).size,
    sufficientCases: rows.filter(r => r.physicalCorner !== null).length,
    sufficientSpecimens: new Set(rows.filter(r => r.physicalCorner !== null).map(r => r.specimenId)).size,
    physicalCornerP95: p95(rows.filter(r => r.physicalCorner !== null).map(r => r.physicalCorner)),
    physicalEdgeMean: average(rows.filter(r => r.physicalEdge !== null).map(r => r.physicalEdge)),
    printedCornerP95: p95(rows.filter(r => r.printedCorner !== null).map(r => r.printedCorner)),
    printedEdgeMean: average(rows.filter(r => r.printedEdge !== null).map(r => r.printedEdge)),
    printedCases: rows.filter(r => r.printedCorner !== null).length,
    absentCases: rows.filter(r => r.absent).length, absentSpecimens: new Set(rows.filter(r => r.absent).map(r => r.specimenId)).size,
    absentBorderFalsePositiveRate: average(rows.filter(r => r.absent).map(r => Number(r.falseBorder))),
    abstentionRate: average(rows.map(r => Number(r.abstained))), errorRate: average(rows.map(r => Number(r.error))),
    latencyP95Ms: p95(rows.map(r => r.latencyMs)), costUsd: rows.reduce((n, r) => n + r.costUsd, 0),
    unsupportedCentering: rows.filter(r => r.unsupportedCentering).length,
    insufficientAssertions: rows.filter(r => r.insufficientAssertion).length };
}

/** Clean learning is gated against the complete defect benchmark too: fewer
 * false positives cannot hide newly missed serious damage or grade regression. */
export function compareCleanLearningEvaluation(input, options) {
  requireThat(input.protocol?.domain === 'CLEAN', 400, 'LEARNING_DOMAIN_REQUIRED');
  hash(input.protocol.registrySha256); hash(input.protocol.reviewerQualitySha256);
  const { sha256: _hash, ...report } = compareLearningEvaluation(input, options);
  return seal({ ...report, domain: 'CLEAN', registrySha256: input.protocol.registrySha256,
    reviewerQualitySha256: input.protocol.reviewerQualitySha256 });
}

/** Native geometry candidates are evaluated in their own exact source frame.
 * Missing proposals incur the maximum normalized error; abstention cannot make
 * the error average appear better by removing hard or borderless photographs. */
export function compareGeometryLearningEvaluation(input, { verifiedArtifactHashes = new Set() } = {}) {
  const corpus = validateEvaluationCorpus(input.corpus), p = input.protocol;
  check(p?.domain === 'GEOMETRY' && p.version === 'atlas-geometry-learning-evaluation-v1' && Number.isFinite(Date.parse(p.registeredAt)));
  for (const key of ['registrySha256', 'reviewerQualitySha256', 'baselineReleaseSha256', 'candidateCorpusSha256', 'modelPromptPolicySha256', 'policySettingsSha256']) hash(p[key]);
  for (const key of ['modelPromptSha256', 'imagePolicySha256', 'scoringPolicySha256']) hash(p.bindings?.[key]);
  for (const key of ['minimumCases', 'minimumSpecimens', 'minimumProspective', 'minimumProspectiveSpecimens',
    'minimumPrintedCases', 'minimumAbsentSpecimens', 'minimumPerStratum', 'minimumPerStratumSpecimens'])
    check(Number.isInteger(p[key]) && p[key] > 0);
  for (const key of ['maximumPhysicalCornerP95', 'maximumPhysicalEdgeMean', 'maximumPrintedCornerP95', 'maximumPrintedEdgeMean',
    'maximumErrorIncrease', 'maximumAbsentBorderFalsePositiveRate', 'maximumAbstentionIncrease', 'maximumErrorRate', 'maximumLatencyRatio', 'maximumCostRatio', 'maximumPairGapMs'])
    check(Number.isFinite(p[key]) && p[key] >= 0);
  check(p.maximumPairGapMs > 0 && Array.isArray(p.requiredStrata) && p.requiredStrata.length > 0);
  const protocolSha256 = digest(canonical(p)), needed = new Set([protocolSha256]), pairs = [];
  check(Array.isArray(input.runs) && input.runs.length <= 20000);
  for (const c of corpus.filter(heldout)) {
    const truth = c.truth.geometry; check(truth && ['PRESENT', 'ABSENT', 'UNCERTAIN'].includes(truth.printedStatus)
      && Number.isSafeInteger(truth.width) && truth.width > 1 && Number.isSafeInteger(truth.height) && truth.height > 1);
    const sufficient = c.truth.captureEvidence !== 'INSUFFICIENT';
    hash(truth.frameSha256); if (sufficient) { quad(truth.physical); if (truth.printedStatus === 'PRESENT') quad(truth.printed); }
    needed.add(c.truth.artifactSha256); const runs = input.runs.filter(r => r.caseId === c.id);
    check(runs.length === 2 && runs.some(r => r.arm === 'BASELINE') && runs.some(r => r.arm === 'CANDIDATE'));
    check(runs[0].providerModel === runs[1].providerModel && typeof runs[0].providerModel === 'string'
      && Math.abs(Date.parse(runs[0].startedAt) - Date.parse(runs[1].startedAt)) <= p.maximumPairGapMs);
    const row = { specimenId: c.specimenId, split: c.split, strata: c.strata };
    for (const r of runs) {
      check(r.protocolSha256 === protocolSha256 && Date.parse(r.startedAt) > Date.parse(p.registeredAt)
        && r.modelPromptPolicySha256 === p.modelPromptPolicySha256 && r.sourceBindingSha256 === c.sourceBindingSha256
        && (r.arm === 'BASELINE' ? r.releaseSha256 === p.baselineReleaseSha256 : r.corpusSha256 === p.candidateCorpusSha256));
      for (const k of ['requestSha256', 'responseSha256', 'resultSha256']) { hash(r[k]); needed.add(r[k]); }
      check(r.resultSha256 === digest(canonical(r.result, { maxBytes: 4194304 })) && Number.isFinite(r.latencyMs) && r.latencyMs >= 0
        && Number.isFinite(r.costUsd) && r.costUsd >= 0 && Array.isArray(r.lessonSources) && r.lessonSources.length <= 12);
      for (const source of r.lessonSources) check(source.specimenId !== c.specimenId && !c.originalSha256.includes(source.originalSha256)
        && (c.split !== 'DESIGN_HOLDOUT' || source.familyId !== c.familyId)
        && corpus.some(t => t.split === 'TRAIN' && t.specimenId === source.specimenId && t.familyId === source.familyId && t.originalSha256.includes(source.originalSha256)));
      const result = r.result; check(['READY', 'REFUSED', 'ERROR'].includes(result.status) && result.frameSha256 === truth.frameSha256);
      const physical = !sufficient ? { corner: null, edge: null }
        : result.status === 'READY' && result.physical ? error(truth.physical, result.physical, truth) : { corner: 1, edge: 1 };
      const printed = sufficient && truth.printedStatus === 'PRESENT' ? result.status === 'READY' && result.printed
        ? error(truth.printed, result.printed, truth) : { corner: 1, edge: 1 } : null;
      row[r.arm] = { specimenId: c.specimenId, physicalCorner: physical.corner, physicalEdge: physical.edge,
        printedCorner: printed?.corner ?? null, printedEdge: printed?.edge ?? null,
        absent: sufficient && truth.printedStatus === 'ABSENT', falseBorder: sufficient && truth.printedStatus === 'ABSENT' && Boolean(result.printed),
        unsupportedCentering: truth.printedStatus !== 'PRESENT' && Number.isFinite(result.centering),
        insufficientAssertion: !sufficient && result.status === 'READY' && Boolean(result.physical || result.printed || Number.isFinite(result.centering)),
        abstained: result.status === 'REFUSED', error: result.status === 'ERROR', latencyMs: r.latencyMs, costUsd: r.costUsd };
    }
    pairs.push(row);
  }
  check(input.runs.length === pairs.length * 2);
  const baseline = metrics(pairs.map(r => r.BASELINE)), candidate = metrics(pairs.map(r => r.CANDIDATE)), blockers = [];
  const strata = Object.fromEntries(p.requiredStrata.map(s => [s, { baseline: metrics(pairs.filter(r => r.strata.includes(s)).map(r => r.BASELINE)),
    candidate: metrics(pairs.filter(r => r.strata.includes(s)).map(r => r.CANDIDATE)) }]));
  if ([...needed].some(h => !verifiedArtifactHashes.has(h))) blockers.push('PRIVATE_ARTIFACTS_NOT_VERIFIED');
  if (baseline.sufficientCases < p.minimumCases || baseline.sufficientSpecimens < p.minimumSpecimens || baseline.printedCases < p.minimumPrintedCases
    || baseline.absentSpecimens < p.minimumAbsentSpecimens || pairs.filter(r => r.split === 'PROSPECTIVE').length < p.minimumProspective)
    blockers.push('GEOMETRY_COVERAGE_GATE');
  if (new Set(pairs.filter(r => r.split === 'PROSPECTIVE').map(r => r.specimenId)).size < p.minimumProspectiveSpecimens)
    blockers.push('GEOMETRY_PROSPECTIVE_SPECIMEN_GATE');
  const checkMetrics = (a, b) => b.physicalCornerP95 === null
    || b.physicalCornerP95 > p.maximumPhysicalCornerP95 || b.physicalEdgeMean > p.maximumPhysicalEdgeMean
    || a.printedCases > 0 && (b.printedCornerP95 === null || b.printedCornerP95 > p.maximumPrintedCornerP95 || b.printedEdgeMean > p.maximumPrintedEdgeMean)
    || ['physicalCornerP95', 'physicalEdgeMean', 'printedCornerP95', 'printedEdgeMean'].some(k => a[k] !== null && b[k] > a[k] + p.maximumErrorIncrease);
  if (checkMetrics(baseline, candidate)) blockers.push('GEOMETRY_ERROR_GATE');
  if (Object.values(strata).some(s => s.baseline.cases < p.minimumPerStratum || s.baseline.specimens < p.minimumPerStratumSpecimens
    || checkMetrics(s.baseline, s.candidate))) blockers.push('GEOMETRY_STRATUM_GATE');
  if (candidate.absentBorderFalsePositiveRate === null || candidate.absentBorderFalsePositiveRate > p.maximumAbsentBorderFalsePositiveRate
    || candidate.unsupportedCentering > 0 || candidate.insufficientAssertions > 0) blockers.push('BORDER_ABSENCE_GATE');
  if (candidate.abstentionRate > baseline.abstentionRate + p.maximumAbstentionIncrease || candidate.errorRate > p.maximumErrorRate) blockers.push('GEOMETRY_FAILURE_GATE');
  if (candidate.latencyP95Ms > baseline.latencyP95Ms * p.maximumLatencyRatio || candidate.costUsd > baseline.costUsd * p.maximumCostRatio) blockers.push('GEOMETRY_COST_GATE');
  return seal({ version: 'atlas-domain-learning-evaluation-v1', domain: 'GEOMETRY', status: blockers.length ? 'BLOCKED' : 'ELIGIBLE_FOR_OWNER_REVIEW',
    protocolSha256, registrySha256: p.registrySha256, reviewerQualitySha256: p.reviewerQualitySha256,
    policySettingsSha256: p.policySettingsSha256, bindings: p.bindings,
    baselineReleaseSha256: p.baselineReleaseSha256, candidateCorpusSha256: p.candidateCorpusSha256,
    corpusSha256: digest(canonical(corpus, { maxBytes: 16777216 })), baseline, candidate, strata, blockers,
    limitations: ['Normalized source-frame corner and edge error does not establish physical truth without independent adjudication.',
      'A point-estimate gate cannot guarantee future improvement; preregistered uncertainty review is required in the independent audit.'] });
}
