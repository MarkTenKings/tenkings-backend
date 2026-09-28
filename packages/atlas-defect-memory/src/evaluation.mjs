import { parseSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { canonical, digest, immutable, requireThat, hash, DEFECT_TYPES } from './contract.mjs';

const EVALUATION_SPLITS = ['SPECIMEN_HOLDOUT', 'DESIGN_HOLDOUT', 'PROSPECTIVE'];
const id = value => requireThat(typeof value === 'string' && value.length > 0 && value.length <= 512, 400, 'LEARNING_EVAL_ID_REQUIRED');
const finite = value => requireThat(Number.isFinite(value), 400, 'LEARNING_EVAL_VALUE_INVALID');
const seal = value => immutable({ ...value, sha256: digest(canonical(value, { maxBytes: 16777216 })) });
const ratio = (a, b) => b ? a / b : null;
function interval(success, total) {
  if (!total) return null;
  const z = 1.959963984540054, p = success / total, denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const radius = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return { lower: Math.max(0, center - radius), upper: Math.min(1, center + radius), method: 'WILSON_95' };
}

/** Exact mask overlap, with no fuzzy visual or model-judged scoring. */
export function traceIntersectionOverUnion(left, right) {
  const a = parseSpeedsterTraceRleV1(left), b = parseSpeedsterTraceRleV1(right);
  requireThat(a.width === b.width && a.height === b.height, 400, 'LEARNING_EVAL_FRAME_MISMATCH');
  let i = 0, j = 0, ar = a.runs[0], br = b.runs[0], intersection = 0, union = 0;
  while (i < a.runs.length && j < b.runs.length) {
    if (ar === 0) { ar = a.runs[++i]; continue; }
    if (br === 0) { br = b.runs[++j]; continue; }
    const count = Math.min(ar, br), av = i % 2, bv = j % 2;
    if (av && bv) intersection += count;
    if (av || bv) union += count;
    ar -= count; br -= count;
  }
  return union ? intersection / union : 1;
}

/** Specimens and originals cannot cross splits; design holdout is additionally
 * disjoint by family. A caller must supply a physical-specimen grouping, because
 * two different image hashes cannot establish two different physical cards. */
export function validateEvaluationCorpus(corpus) {
  requireThat(Array.isArray(corpus) && corpus.length > 0 && corpus.length <= 10000, 400, 'LEARNING_EVAL_CORPUS_REQUIRED');
  const ids = new Set(), specimens = new Map(), images = new Map(), families = new Map();
  for (const item of corpus) {
    id(item.id); id(item.specimenId); id(item.familyId);
    requireThat(!ids.has(item.id) && ['TRAIN', 'VALIDATION', ...EVALUATION_SPLITS].includes(item.split), 400, 'LEARNING_EVAL_CORPUS_INVALID');
    ids.add(item.id);
    requireThat(Array.isArray(item.originalSha256) && item.originalSha256.length === 2, 400, 'LEARNING_EVAL_SOURCE_REQUIRED');
    item.originalSha256.forEach(hash);
    for (const [map, keys] of [[specimens, [item.specimenId]], [images, item.originalSha256]]) for (const key of keys) {
      requireThat(!map.has(key) || map.get(key) === item.split, 409, 'LEARNING_EVAL_LEAKAGE'); map.set(key, item.split);
    }
    const splits = families.get(item.familyId) ?? new Set(); splits.add(item.split); families.set(item.familyId, splits);
    if (EVALUATION_SPLITS.includes(item.split)) {
      const truth = item.truth;
      requireThat(truth?.authority === 'INDEPENDENT_EXPERT_ADJUDICATION' && truth.resolved === true
        && Array.isArray(truth.reviewers) && new Set(truth.reviewers).size >= 2
        && truth.reviewers.every(reviewer => typeof reviewer === 'string' && reviewer.length > 0 && !(item.cardReviewers ?? []).includes(reviewer))
        && ['PHOTO_SUFFICIENT', 'PHYSICAL_INSPECTION', 'INSUFFICIENT'].includes(truth.captureEvidence), 409, 'LEARNING_EVAL_INDEPENDENT_TRUTH_REQUIRED');
      hash(truth.artifactSha256);
      requireThat(Array.isArray(truth.findings) && truth.findings.length <= 200 && Array.isArray(item.strata)
        && item.strata.length > 0, 400, 'LEARNING_EVAL_LABELS_REQUIRED');
      for (const finding of truth.findings) {
        requireThat(['FRONT', 'BACK'].includes(finding.side) && DEFECT_TYPES.includes(finding.defectType)
          && ['LOW', 'MODERATE', 'SEVERE'].includes(finding.severity), 400, 'LEARNING_EVAL_LABEL_INVALID');
        parseSpeedsterTraceRleV1(finding.trace);
      }
      requireThat(truth.clean === (truth.findings.length === 0) && typeof truth.clean === 'boolean', 400, 'LEARNING_EVAL_LABEL_INVALID');
      const { artifactSha256, ...label } = truth;
      requireThat(artifactSha256 === digest(canonical(label, { maxBytes: 4194304 })), 400, 'LEARNING_EVAL_TRUTH_HASH_MISMATCH');
    }
  }
  for (const splits of families.values()) requireThat(!splits.has('DESIGN_HOLDOUT') || splits.size === 1, 409, 'LEARNING_EVAL_DESIGN_LEAKAGE');
  return immutable(structuredClone(corpus));
}

function score(item, run, protocol) {
  const result = run.result;
  requireThat(['READY', 'REFUSED', 'ERROR'].includes(result?.status) && Array.isArray(result.findings)
    && result.findings.length <= 200 && (result.status === 'READY' || result.findings.length === 0), 400, 'LEARNING_EVAL_RESULT_INVALID');
  const sufficient = item.truth.captureEvidence !== 'INSUFFICIENT';
  const truth = sufficient ? item.truth.findings : [], predicted = result.status === 'READY' ? result.findings : [];
  for (const finding of predicted) {
    requireThat(['FRONT', 'BACK'].includes(finding.side) && DEFECT_TYPES.includes(finding.defectType), 400, 'LEARNING_EVAL_RESULT_INVALID');
    parseSpeedsterTraceRleV1(finding.trace);
  }
  const edges = [];
  for (const [i, actual] of truth.entries()) for (const [j, proposed] of predicted.entries()) if (actual.side === proposed.side) {
    const overlap = traceIntersectionOverUnion(actual.trace, proposed.trace);
    if (overlap >= protocol.iouThreshold) edges.push({ i, j, overlap });
  }
  edges.sort((a, b) => b.overlap - a.overlap || a.i - b.i || a.j - b.j);
  const expected = new Set(), found = new Set(), matches = [];
  for (const edge of edges) if (!expected.has(edge.i) && !found.has(edge.j)) {
    expected.add(edge.i); found.add(edge.j); matches.push(edge);
  }
  const severe = truth.filter(f => f.severity === 'SEVERE').length;
  return { id: item.id, specimenId: item.specimenId, split: item.split, strata: item.strata, sufficient,
    tp: matches.length, fp: sufficient ? predicted.length - matches.length : 0, fn: truth.length - matches.length,
    severe, severeFound: matches.filter(m => truth[m.i].severity === 'SEVERE').length,
    correctType: matches.filter(m => truth[m.i].defectType === predicted[m.j].defectType).length,
    overlapSum: matches.reduce((sum, m) => sum + m.overlap, 0), clean: sufficient && item.truth.clean,
    cleanFalsePositive: sufficient && item.truth.clean && predicted.length > 0,
    error: result.status === 'ERROR', abstained: result.status === 'REFUSED',
    insufficientAsserted: !sufficient && result.status === 'READY' && !result.insufficientEvidence,
    gradeAbsoluteError: sufficient && Number.isFinite(item.truth.grade) && Number.isFinite(result.grade) ? Math.abs(item.truth.grade - result.grade) : null,
    latencyMs: run.latencyMs, costUsd: run.costUsd };
}
function summarize(rows) {
  const sum = key => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  const tp = sum('tp'), fp = sum('fp'), fn = sum('fn'), severe = sum('severe'), severeFound = sum('severeFound');
  const clean = sum('clean'), cleanFP = sum('cleanFalsePositive'), ordered = rows.map(r => r.latencyMs).sort((a, b) => a - b);
  const grades = rows.filter(r => r.gradeAbsoluteError !== null);
  return { cases: rows.length, specimens: new Set(rows.map(r => r.specimenId)).size, tp, fp, fn,
    precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn),
    severeCount: severe, severeSpecimens: new Set(rows.filter(r => r.severe > 0).map(r => r.specimenId)).size,
    severeRecall: ratio(severeFound, severe), severeRecallInterval: interval(severeFound, severe),
    cleanCases: clean, cleanSpecimens: new Set(rows.filter(r => r.clean).map(r => r.specimenId)).size,
    cleanFalsePositiveRate: ratio(cleanFP, clean), cleanFalsePositiveInterval: interval(cleanFP, clean),
    typeAccuracy: ratio(sum('correctType'), tp), meanMatchedIoU: ratio(sum('overlapSum'), tp),
    errors: sum('error'), abstentions: sum('abstained'), insufficientAssertions: sum('insufficientAsserted'),
    gradeMAE: ratio(grades.reduce((n, r) => n + r.gradeAbsoluteError, 0), grades.length), gradeCases: grades.length,
    latencyP95Ms: ordered.length ? ordered[Math.ceil(ordered.length * .95) - 1] : null, costUsd: sum('costUsd') };
}
function pairedInterval(rows, iterations = 1000) {
  const specimens = [...new Set(rows.map(r => r.specimenId))].sort();
  if (specimens.length < 2) return null;
  const groups = specimens.map(id => rows.filter(r => r.specimenId === id));
  let state = 0x41544c41;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const values = { f1: [], severeRecall: [], cleanFalsePositiveRate: [] };
  for (let i = 0; i < iterations; i++) {
    const sample = Array.from({ length: groups.length }, () => groups[Math.floor(random() * groups.length)]).flat();
    const baseline = summarize(sample.map(r => r.baseline)), candidate = summarize(sample.map(r => r.candidate));
    for (const [key, deltas] of Object.entries(values)) if (baseline[key] !== null && candidate[key] !== null) deltas.push(candidate[key] - baseline[key]);
  }
  return Object.fromEntries(Object.entries(values).map(([key, deltas]) => {
    deltas.sort((a, b) => a - b);
    return [key, deltas.length ? { lower: deltas[Math.floor(deltas.length * .025)], upper: deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * .975))],
      method: 'PAIRED_SPECIMEN_BOOTSTRAP_95', iterations, seed: 'ATLA' } : null];
  }));
}

/** Offline only: supplied provider outputs and expert labels are compared.
 * No provider call, live activation, invented labels or accuracy claim occurs.
 * Required artifact hashes must have been verified against private files. */
export function compareLearningEvaluation(input, { verifiedArtifactHashes = new Set() } = {}) {
  const corpus = validateEvaluationCorpus(input.corpus), protocol = input.protocol;
  requireThat(protocol?.version === 'atlas-learning-evaluation-protocol-v1' && ['legacy-defect-family-v1', 'balanced-defect-v1'].includes(protocol.candidatePolicy),
    400, 'LEARNING_EVAL_PROTOCOL_REQUIRED');
  requireThat(Number.isFinite(Date.parse(protocol.registeredAt)) && protocol.iouThreshold > 0 && protocol.iouThreshold <= 1
    && Array.isArray(protocol.requiredStrata) && protocol.requiredStrata.length > 0
    && Number.isInteger(protocol.minimumCases) && protocol.minimumCases > 0
    && Number.isInteger(protocol.minimumSpecimens) && protocol.minimumSpecimens > 0
    && Number.isInteger(protocol.minimumSevere) && protocol.minimumSevere > 0
    && Number.isInteger(protocol.minimumClean) && protocol.minimumClean > 0
    && Number.isInteger(protocol.minimumSevereSpecimens) && protocol.minimumSevereSpecimens > 0
    && Number.isInteger(protocol.minimumCleanSpecimens) && protocol.minimumCleanSpecimens > 0
    && Number.isInteger(protocol.minimumGradeCases) && protocol.minimumGradeCases > 0
    && Number.isInteger(protocol.minimumProspective) && protocol.minimumProspective > 0
    && Number.isInteger(protocol.minimumProspectiveSpecimens) && protocol.minimumProspectiveSpecimens > 0
    && Number.isInteger(protocol.minimumPerStratumSpecimens) && protocol.minimumPerStratumSpecimens > 0
    && Number.isInteger(protocol.minimumPerStratum) && protocol.minimumPerStratum > 0, 400, 'LEARNING_EVAL_PROTOCOL_INVALID');
  for (const key of ['minimumF1Delta', 'minimumSevereRecallDelta', 'maximumCleanFPRDelta', 'maximumErrorRate', 'maximumLatencyRatio', 'maximumCostRatio']) finite(protocol[key]);
  requireThat(Number.isFinite(protocol.maximumPairGapMs) && protocol.maximumPairGapMs > 0
    && Number.isFinite(protocol.maximumStratumRecallLoss) && protocol.maximumStratumRecallLoss >= 0
    && Number.isFinite(protocol.maximumStratumCleanFPRIncrease) && protocol.maximumStratumCleanFPRIncrease >= 0,
  400, 'LEARNING_EVAL_PROTOCOL_INVALID');
  requireThat(Number.isFinite(protocol.maximumGradeMAEIncrease) && protocol.maximumGradeMAEIncrease >= 0, 400, 'LEARNING_EVAL_PROTOCOL_INVALID');
  hash(protocol.baselineReleaseSha256); hash(protocol.candidateCorpusSha256); hash(protocol.modelPromptPolicySha256);
  hash(protocol.policySettingsSha256);
  for (const key of ['modelPromptSha256', 'imagePolicySha256', 'scoringPolicySha256']) hash(protocol.bindings?.[key]);
  if (protocol.registrySha256 !== undefined) {
    for (const key of ['registrySha256', 'reviewerQualitySha256', 'policySettingsSha256']) hash(protocol[key]);
    for (const key of ['modelPromptSha256', 'imagePolicySha256', 'scoringPolicySha256']) hash(protocol.bindings?.[key]);
  }
  const protocolHash = digest(canonical(protocol));
  requireThat(Array.isArray(input.runs) && input.runs.length <= 20000, 400, 'LEARNING_EVAL_RUNS_REQUIRED');
  const tested = corpus.filter(c => EVALUATION_SPLITS.includes(c.split)), paired = [], requiredArtifacts = new Set([protocolHash]);
  for (const item of tested) {
    requiredArtifacts.add(item.truth.artifactSha256);
    const pair = input.runs.filter(r => r.caseId === item.id);
    requireThat(pair.length === 2 && pair.some(r => r.arm === 'BASELINE') && pair.some(r => r.arm === 'CANDIDATE'), 409, 'LEARNING_EVAL_PAIRED_RUNS_REQUIRED');
    for (const run of pair) {
      requireThat(run.protocolSha256 === protocolHash && Date.parse(run.startedAt) > Date.parse(protocol.registeredAt)
        && run.sourceBindingSha256 === item.sourceBindingSha256 && run.modelPromptPolicySha256 === protocol.modelPromptPolicySha256,
      409, 'LEARNING_EVAL_BINDING_MISMATCH');
      hash(run.requestSha256); hash(run.responseSha256); hash(run.resultSha256); hash(run.sourceBindingSha256);
      requireThat(run.resultSha256 === digest(canonical(run.result, { maxBytes: 4194304 })), 409, 'LEARNING_EVAL_RESULT_HASH_MISMATCH');
      requireThat(run.arm === 'BASELINE' ? run.releaseSha256 === protocol.baselineReleaseSha256
        : run.corpusSha256 === protocol.candidateCorpusSha256, 409, 'LEARNING_EVAL_RELEASE_MISMATCH');
      requireThat(Array.isArray(run.lessonSources) && run.lessonSources.length <= 12 && typeof run.providerModel === 'string' && run.providerModel.length > 0,
        400, 'LEARNING_EVAL_PROVENANCE_REQUIRED');
      for (const lesson of run.lessonSources) {
        id(lesson.specimenId); id(lesson.familyId); hash(lesson.originalSha256);
        requireThat(lesson.specimenId !== item.specimenId && !item.originalSha256.includes(lesson.originalSha256)
          && (item.split !== 'DESIGN_HOLDOUT' || lesson.familyId !== item.familyId), 409, 'LEARNING_EVAL_RETRIEVAL_LEAKAGE');
        requireThat(corpus.some(source => source.split === 'TRAIN' && source.specimenId === lesson.specimenId
          && source.familyId === lesson.familyId && source.originalSha256.includes(lesson.originalSha256)), 409, 'LEARNING_EVAL_UNDECLARED_MEMORY_SOURCE');
      }
      finite(run.latencyMs); finite(run.costUsd);
      requireThat(run.latencyMs >= 0 && run.costUsd >= 0, 400, 'LEARNING_EVAL_VALUE_INVALID');
      for (const field of ['requestSha256', 'responseSha256', 'resultSha256']) requiredArtifacts.add(run[field]);
    }
    requireThat(pair[0].providerModel === pair[1].providerModel, 409, 'LEARNING_EVAL_MODEL_DRIFT');
    requireThat(Math.abs(Date.parse(pair[0].startedAt) - Date.parse(pair[1].startedAt)) <= protocol.maximumPairGapMs,
      409, 'LEARNING_EVAL_PAIR_WINDOW_EXCEEDED');
    paired.push({ id: item.id, specimenId: item.specimenId, split: item.split,
      baseline: score(item, pair.find(r => r.arm === 'BASELINE'), protocol), candidate: score(item, pair.find(r => r.arm === 'CANDIDATE'), protocol) });
  }
  requireThat(input.runs.length === paired.length * 2, 400, 'LEARNING_EVAL_UNMATCHED_RUN');
  const baseline = summarize(paired.map(r => r.baseline)), candidate = summarize(paired.map(r => r.candidate));
  const strata = Object.fromEntries(protocol.requiredStrata.map(stratum => [stratum, {
    baseline: summarize(paired.filter(r => r.baseline.strata.includes(stratum)).map(r => r.baseline)),
    candidate: summarize(paired.filter(r => r.candidate.strata.includes(stratum)).map(r => r.candidate)) }]));
  const deltaIntervals = pairedInterval(paired), f1DeltaInterval = deltaIntervals?.f1 ?? null, blockers = [];
  if ([...requiredArtifacts].some(value => !verifiedArtifactHashes.has(value))) blockers.push('PRIVATE_ARTIFACTS_NOT_VERIFIED');
  if (baseline.cases < protocol.minimumCases || baseline.severeCount < protocol.minimumSevere || baseline.cleanCases < protocol.minimumClean)
    blockers.push('INSUFFICIENT_HELD_OUT_COVERAGE');
  if (baseline.specimens < protocol.minimumSpecimens || baseline.severeSpecimens < protocol.minimumSevereSpecimens
    || baseline.cleanSpecimens < protocol.minimumCleanSpecimens) blockers.push('INSUFFICIENT_INDEPENDENT_SPECIMENS');
  if (paired.filter(r => r.split === 'PROSPECTIVE').length < protocol.minimumProspective) blockers.push('INSUFFICIENT_PROSPECTIVE_SHADOW');
  if (new Set(paired.filter(r => r.split === 'PROSPECTIVE').map(r => r.specimenId)).size < protocol.minimumProspectiveSpecimens)
    blockers.push('INSUFFICIENT_PROSPECTIVE_SPECIMENS');
  if (Object.values(strata).some(s => s.baseline.cases < protocol.minimumPerStratum || s.baseline.specimens < protocol.minimumPerStratumSpecimens)) blockers.push('MISSING_REQUIRED_STRATA');
  if (Object.values(strata).some(s => s.baseline.recall !== null && s.candidate.recall < s.baseline.recall - protocol.maximumStratumRecallLoss
    || s.baseline.cleanFalsePositiveRate !== null && s.candidate.cleanFalsePositiveRate > s.baseline.cleanFalsePositiveRate + protocol.maximumStratumCleanFPRIncrease))
    blockers.push('STRATUM_NON_REGRESSION_GATE');
  if (!f1DeltaInterval || f1DeltaInterval.lower < protocol.minimumF1Delta) blockers.push('F1_IMPROVEMENT_NOT_ESTABLISHED');
  if (!deltaIntervals?.severeRecall || deltaIntervals.severeRecall.lower < protocol.minimumSevereRecallDelta) blockers.push('SEVERE_RECALL_GATE');
  if (!deltaIntervals?.cleanFalsePositiveRate || deltaIntervals.cleanFalsePositiveRate.upper > protocol.maximumCleanFPRDelta) blockers.push('CLEAN_FALSE_POSITIVE_GATE');
  if (!candidate.cases || candidate.errors / candidate.cases > protocol.maximumErrorRate) blockers.push('ERROR_RATE_GATE');
  if (candidate.insufficientAssertions > baseline.insufficientAssertions) blockers.push('INSUFFICIENT_EVIDENCE_REGRESSION');
  if (baseline.gradeCases < protocol.minimumGradeCases || candidate.gradeCases < protocol.minimumGradeCases
    || candidate.gradeMAE > baseline.gradeMAE + protocol.maximumGradeMAEIncrease) blockers.push('DETERMINISTIC_GRADE_CALIBRATION_GATE');
  if (candidate.latencyP95Ms > baseline.latencyP95Ms * protocol.maximumLatencyRatio) blockers.push('LATENCY_GATE');
  if (candidate.costUsd > baseline.costUsd * protocol.maximumCostRatio) blockers.push('COST_GATE');
  return seal({ version: 'atlas-learning-evaluation-v1', status: blockers.length ? 'BLOCKED' : 'ELIGIBLE_FOR_OWNER_REVIEW',
    policySettingsSha256: protocol.policySettingsSha256, bindings: protocol.bindings,
    ...(protocol.registrySha256 ? { registrySha256: protocol.registrySha256, reviewerQualitySha256: protocol.reviewerQualitySha256 } : {}),
    protocolSha256: protocolHash, baselineReleaseSha256: protocol.baselineReleaseSha256,
    candidateCorpusSha256: protocol.candidateCorpusSha256, candidatePolicy: protocol.candidatePolicy,
    corpusSha256: digest(canonical(corpus, { maxBytes: 16777216 })), baseline, candidate, strata, f1DeltaInterval, deltaIntervals, blockers,
    limitations: ['Software verifies supplied artifact bindings, not expert identity or honesty; independent truth audit remains required.',
      'Reported intervals do not guarantee future improvement or remove optical limitations.',
      'Matched-mask IoU uses a frozen greedy matching policy; held-out labels never enter inference requests.',
      'Geometry and scoring-policy activation require their own role-specific evaluation; this gate activates defect examples only.'] });
}

/** Strip labels before exporting a prospective collection plan. */
export function shadowCollectionPlan(corpus, protocol) {
  const checked = validateEvaluationCorpus(corpus);
  return seal({ version: 'atlas-learning-shadow-plan-v1', protocolSha256: digest(canonical(protocol)),
    jobs: checked.filter(c => EVALUATION_SPLITS.includes(c.split)).flatMap(item => {
      const arms = ['BASELINE', 'CANDIDATE'];
      if (parseInt(digest(`${item.id}:${digest(canonical(protocol))}`).slice(0, 2), 16) % 2) arms.reverse();
      return arms.map(arm => ({
      caseId: item.id, arm, sourceBindingSha256: item.sourceBindingSha256, originalSha256: item.originalSha256,
      idempotencyKey: digest(canonical({ caseId: item.id, arm, protocolSha256: digest(canonical(protocol)) })) }));
    }),
    dispatch: 'REQUIRES_AUTHORIZED_BUDGET_AND_EXISTING_RECEIPT_EXECUTOR', paidCallsMade: 0 });
}
