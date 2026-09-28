import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '../src/contract.mjs';
import { compareGeometryLearningEvaluation, compareCleanLearningEvaluation } from '../src/domain-evaluation.mjs';
import { roleFixture } from './role-fixtures.mjs';

// Every label/output here is synthetic software input, never optical truth.
function geometryFixture() {
  const f = roleFixture('GEOMETRY');
  const protocol = { version: 'atlas-geometry-learning-evaluation-v1', domain: 'GEOMETRY', registeredAt: '2026-09-20T00:00:00Z',
    registrySha256: f.registry.sha256, reviewerQualitySha256: f.quality.sha256, policySettingsSha256: digest('settings'), bindings: f.policy.bindings,
    baselineReleaseSha256: digest('baseline'), candidateCorpusSha256: digest('candidate'), modelPromptPolicySha256: digest('native-engine'),
    minimumCases: 4, minimumSpecimens: 4, minimumProspective: 2, minimumPrintedCases: 2, minimumAbsentSpecimens: 2, minimumPerStratum: 4,
    minimumProspectiveSpecimens: 2, minimumPerStratumSpecimens: 4,
    requiredStrata: ['SYNTHETIC'], maximumPhysicalCornerP95: .01, maximumPhysicalEdgeMean: .01,
    maximumPrintedCornerP95: .01, maximumPrintedEdgeMean: .01, maximumErrorIncrease: 0,
    maximumAbsentBorderFalsePositiveRate: 0, maximumAbstentionIncrease: 0, maximumErrorRate: 0,
    maximumLatencyRatio: 1.2, maximumCostRatio: 1.2, maximumPairGapMs: 1000 };
  const protocolSha256 = digest(canonical(protocol));
  const corpus = Array.from({ length: 4 }, (_, i) => {
    const label = { authority: 'INDEPENDENT_EXPERT_ADJUDICATION', resolved: true, reviewers: ['expert-a', 'expert-b'],
      captureEvidence: 'PHOTO_SUFFICIENT', findings: [], clean: true,
      geometry: { physical: f.physical, printedStatus: i % 2 ? 'ABSENT' : 'PRESENT', printed: i % 2 ? null : f.printed,
        width: 1000, height: 1400, frameSha256: digest(`frame-${i}`) } };
    return { id: `case-${i}`, specimenId: `specimen-${i}`, familyId: `family-${i}`, split: i < 2 ? 'SPECIMEN_HOLDOUT' : 'PROSPECTIVE',
      originalSha256: [digest(`front-${i}`), digest(`back-${i}`)], sourceBindingSha256: digest(`source-${i}`),
      cardReviewers: ['original-reviewer'], strata: ['SYNTHETIC'], truth: { ...label, artifactSha256: digest(canonical(label, { maxBytes: 4194304 })) } };
  });
  const runs = corpus.flatMap(c => ['BASELINE', 'CANDIDATE'].map(arm => {
    const result = { status: 'READY', frameSha256: c.truth.geometry.frameSha256,
      physical: arm === 'BASELINE' ? f.physical.map(p => ({ x: p.x + .04, y: p.y })) : f.physical,
      printed: arm === 'BASELINE' ? f.printed : c.truth.geometry.printed };
    return { caseId: c.id, arm, result, resultSha256: digest(canonical(result)), requestSha256: digest(`request-${c.id}-${arm}`), responseSha256: digest(`response-${c.id}-${arm}`),
      protocolSha256, sourceBindingSha256: c.sourceBindingSha256, startedAt: '2026-09-21T00:00:00Z', providerModel: 'synthetic-native-no-inference',
      modelPromptPolicySha256: protocol.modelPromptPolicySha256, releaseSha256: protocol.baselineReleaseSha256, corpusSha256: protocol.candidateCorpusSha256,
      lessonSources: [], latencyMs: 20, costUsd: 0 };
  }));
  const input = { protocol, corpus, runs };
  const evidence = () => ({ verifiedArtifactHashes: new Set([protocolSha256, ...corpus.map(c => c.truth.artifactSha256), ...runs.flatMap(r => [r.requestSha256, r.responseSha256, r.resultSha256])]) });
  return { input, evidence };
}
test('separate geometry gates compare source-frame physical/printed errors and absent borders without changing deterministic grades', () => {
  const f = geometryFixture(), report = compareGeometryLearningEvaluation(f.input, f.evidence());
  assert.equal(report.status, 'ELIGIBLE_FOR_OWNER_REVIEW'); assert.equal(report.candidate.physicalCornerP95, 0);
  assert.equal(report.baseline.absentBorderFalsePositiveRate, 1); assert.equal(report.candidate.absentBorderFalsePositiveRate, 0);
  assert.equal(report.candidate.absentSpecimens, 2); assert.equal(report.domain, 'GEOMETRY');
  assert.equal(compareGeometryLearningEvaluation(f.input).status, 'BLOCKED');
  assert.throws(() => compareCleanLearningEvaluation(f.input));
});
test('geometry frame/model/self-memory drift is refused and abstention cannot hide a bad proposal', () => {
  for (const mutate of [
    f => { f.input.runs[1].providerModel = 'other'; },
    f => { f.input.runs[1].sourceBindingSha256 = digest('other'); },
    f => { f.input.runs[1].lessonSources = [{ specimenId: f.input.corpus[0].specimenId, originalSha256: f.input.corpus[0].originalSha256[0] }]; },
  ]) { const f = geometryFixture(); mutate(f); assert.throws(() => compareGeometryLearningEvaluation(f.input, f.evidence())); }
  const f = geometryFixture(), run = f.input.runs[1]; run.result = { status: 'REFUSED', frameSha256: run.result.frameSha256 };
  run.resultSha256 = digest(canonical(run.result));
  const report = compareGeometryLearningEvaluation(f.input, f.evidence());
  assert(report.blockers.includes('GEOMETRY_ERROR_GATE')); assert(report.blockers.includes('GEOMETRY_FAILURE_GATE'));
});
test('a made-up border or numerical centering on a borderless case blocks geometry activation', () => {
  const f = geometryFixture(), run = f.input.runs.find(r => r.caseId === 'case-1' && r.arm === 'CANDIDATE');
  run.result.centering = 50; run.resultSha256 = digest(canonical(run.result));
  assert(compareGeometryLearningEvaluation(f.input, f.evidence()).blockers.includes('BORDER_ABSENCE_GATE'));
});
test('an all-borderless stratum needs absence coverage and does not require invented printed-border coordinates', () => {
  const f = geometryFixture();
  f.input.protocol.requiredStrata = ['ABSENT', 'PRESENT']; f.input.protocol.minimumPerStratum = 2; f.input.protocol.minimumPerStratumSpecimens = 2;
  const protocolSha256 = digest(canonical(f.input.protocol));
  for (const c of f.input.corpus) c.strata = [c.truth.geometry.printedStatus];
  for (const run of f.input.runs) run.protocolSha256 = protocolSha256;
  const verified = f.evidence().verifiedArtifactHashes; verified.add(protocolSha256);
  assert.equal(compareGeometryLearningEvaluation(f.input, { verifiedArtifactHashes: verified }).status, 'ELIGIBLE_FOR_OWNER_REVIEW');
});
