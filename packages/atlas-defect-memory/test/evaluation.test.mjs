import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '../src/contract.mjs';
import { validateEvaluationCorpus, compareLearningEvaluation, shadowCollectionPlan, traceIntersectionOverUnion } from '../src/evaluation.mjs';
import { fixtures } from './fixtures.mjs';

// These are synthetic harness assertions, not an optical benchmark or expert
// ground truth. No test receipt may be used for production activation.
function evaluationFixture() {
  const f = fixtures(), finding = f.defects.sides.FRONT.findings[0];
  const truthFinding = { side: 'FRONT', defectType: finding.defectType, severity: 'SEVERE', trace: finding.finalTrace ?? finding.detectorMask };
  const publications = [{ revision: 1, sha256: digest('fixture-publication') }];
  const protocol = { version: 'atlas-learning-evaluation-protocol-v1', registeredAt: '2026-01-01T00:00:00.000Z',
    candidatePolicy: 'balanced-defect-v1', policySettingsSha256: digest('synthetic-selection-policy'),
    bindings: { modelPromptSha256: digest('synthetic-model'), imagePolicySha256: digest('synthetic-image'), scoringPolicySha256: digest('synthetic-score') }, iouThreshold: .5, requiredStrata: ['SYNTHETIC_HARNESS_ONLY'],
    minimumCases: 4, minimumSevere: 2, minimumClean: 2, minimumProspective: 2, minimumPerStratum: 4, minimumGradeCases: 4,
    minimumSpecimens: 4, minimumSevereSpecimens: 2, minimumCleanSpecimens: 2,
    minimumProspectiveSpecimens: 2, minimumPerStratumSpecimens: 4,
    minimumF1Delta: 0, minimumSevereRecallDelta: 0, maximumCleanFPRDelta: 0, maximumErrorRate: 0,
    maximumLatencyRatio: 1.2, maximumCostRatio: 2, baselineReleaseSha256: digest('baseline'),
    maximumPairGapMs: 60000, maximumStratumRecallLoss: 0, maximumStratumCleanFPRIncrease: 0, maximumGradeMAEIncrease: 0,
    candidateCorpusSha256: digest(canonical(publications)), modelPromptPolicySha256: digest('frozen-policy') };
  const protocolHash = digest(canonical(protocol));
  const corpus = Array.from({ length: 4 }, (_, i) => {
    const label = { authority: 'INDEPENDENT_EXPERT_ADJUDICATION', resolved: true, reviewers: ['synthetic-expert-a', 'synthetic-expert-b'],
      captureEvidence: 'PHOTO_SUFFICIENT', clean: i % 2 === 0, findings: i % 2 ? [truthFinding] : [], grade: i % 2 ? 8 : 10 };
    return { id: `fixture-${i}`, specimenId: `specimen-${i}`, familyId: `family-${i}`, split: i < 2 ? 'SPECIMEN_HOLDOUT' : 'PROSPECTIVE',
      originalSha256: [digest(`front-${i}`), digest(`back-${i}`)], sourceBindingSha256: digest(`source-${i}`),
      cardReviewers: ['synthetic-original-reviewer'], strata: ['SYNTHETIC_HARNESS_ONLY'],
      truth: { ...label, artifactSha256: digest(canonical(label, { maxBytes: 4194304 })) } };
  });
  const runs = corpus.flatMap(item => ['BASELINE', 'CANDIDATE'].map(arm => {
    const result = { status: 'READY', findings: arm === 'CANDIDATE' ? item.truth.findings.map(({ severity, ...f }) => f) : [], grade: item.truth.grade };
    return { caseId: item.id, arm, protocolSha256: protocolHash, sourceBindingSha256: item.sourceBindingSha256,
      startedAt: '2026-01-02T00:00:00.000Z', modelPromptPolicySha256: protocol.modelPromptPolicySha256,
      requestSha256: digest(`request-${item.id}-${arm}`), responseSha256: digest(`response-${item.id}-${arm}`),
      resultSha256: digest(canonical(result, { maxBytes: 4194304 })), releaseSha256: protocol.baselineReleaseSha256,
      corpusSha256: protocol.candidateCorpusSha256, providerModel: 'synthetic-no-inference', lessonSources: [], latencyMs: 100, costUsd: 0, result };
  }));
  const verifiedArtifactHashes = new Set([protocolHash, ...corpus.map(c => c.truth.artifactSha256),
    ...runs.flatMap(r => [r.requestSha256, r.responseSha256, r.resultSha256])]);
  return { input: { corpus, protocol, runs }, verifiedArtifactHashes, publications, trace: truthFinding.trace };
}
test('exact RLE scoring, independent labels, paired runs and frozen criteria produce reproducible harness results', () => {
  const f = evaluationFixture(); assert.equal(traceIntersectionOverUnion(f.trace, f.trace), 1);
  const a = compareLearningEvaluation(f.input, f), b = compareLearningEvaluation(f.input, f);
  assert.equal(a.sha256, b.sha256); assert.equal(a.candidate.severeRecall, 1); assert.equal(a.baseline.severeRecall, 0);
  assert.equal(a.status, 'ELIGIBLE_FOR_OWNER_REVIEW');
  assert.equal(compareLearningEvaluation(f.input).status, 'BLOCKED');
});
test('specimen/retake and held-out design leakage are refused before any scoring', () => {
  for (const mutate of [
    input => { input.corpus[2].specimenId = input.corpus[0].specimenId; },
    input => { input.corpus[2].originalSha256[0] = input.corpus[0].originalSha256[0]; },
    input => { input.corpus[2].split = 'DESIGN_HOLDOUT'; input.corpus[2].familyId = input.corpus[0].familyId; },
  ]) { const { input } = evaluationFixture(); mutate(input); assert.throws(() => validateEvaluationCorpus(input.corpus), /LEARNING_EVAL_(?:LEAKAGE|DESIGN_LEAKAGE)/); }
});
test('retakes within an allowed partition cannot inflate independent clean or severe coverage', () => {
  for (const [retake, original, metric] of [[2, 0, 'cleanSpecimens'], [3, 1, 'severeSpecimens']]) {
    const f = evaluationFixture(), source = f.input.corpus[original], repeat = f.input.corpus[retake];
    Object.assign(repeat, { specimenId: source.specimenId, familyId: source.familyId, split: source.split });
    const report = compareLearningEvaluation(f.input, f);
    assert.equal(report.baseline.cases, 4);
    assert.equal(report.baseline[metric], 1);
    assert(report.blockers.includes('INSUFFICIENT_INDEPENDENT_SPECIMENS'));
  }
});
test('same reviewer, unadjudicated labels and modified truth cannot count as independent expert evidence', () => {
  for (const mutate of [
    input => { input.corpus[0].truth.reviewers[0] = input.corpus[0].cardReviewers[0]; },
    input => { input.corpus[0].truth.resolved = false; },
    input => { input.corpus[0].truth.clean = false; },
  ]) { const { input } = evaluationFixture(); mutate(input); assert.throws(() => compareLearningEvaluation(input)); }
});
test('requests made before protocol registration, model drift, leakage and unmatched reruns cannot pass', () => {
  for (const mutate of [
    input => { input.runs[0].startedAt = '2025-01-01T00:00:00.000Z'; },
    input => { input.runs[0].providerModel = 'different'; },
    input => { input.runs[0].lessonSources = [{ specimenId: input.corpus[0].specimenId, familyId: input.corpus[0].familyId, originalSha256: input.corpus[0].originalSha256[0] }]; },
    input => { input.runs.push(structuredClone(input.runs[0])); },
  ]) { const { input } = evaluationFixture(); mutate(input); assert.throws(() => compareLearningEvaluation(input)); }
});
test('shadow plan never exports independent truth, severity, grades or expert identity to inference', () => {
  const { input } = evaluationFixture(), plan = shadowCollectionPlan(input.corpus, input.protocol);
  const text = JSON.stringify(plan);
  for (const forbidden of ['synthetic-expert', 'findings', 'severity', 'truth', 'trace']) assert(!text.includes(forbidden));
  assert.equal(plan.paidCallsMade, 0); assert.equal(new Set(plan.jobs.map(j => j.idempotencyKey)).size, 8);
});
