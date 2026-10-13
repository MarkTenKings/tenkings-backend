import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canonical, digest } from '../src/contract.mjs';
import { validatedLearningPolicy, learningPromotionPlan } from '../src/promotion.mjs';
import { roleFixture, seal } from './role-fixtures.mjs';

function promotionFixture() {
  const f = roleFixture(), settings = Object.fromEntries(['id', 'domain', 'selection', 'geometry', 'promotion', 'bindings', 'validFrom', 'validUntil'].map(k => [k, f.policy[k]]));
  const evaluation = seal({ version: 'synthetic-harness-report', domain: f.domain, status: 'ELIGIBLE_FOR_OWNER_REVIEW', blockers: [],
    registrySha256: f.registry.sha256, reviewerQualitySha256: f.quality.sha256, policySettingsSha256: digest(canonical(settings)), bindings: settings.bindings });
  const ownerApproval = { ...f.policy.ownerApproval, evaluationSha256: evaluation.sha256 };
  const policy = validatedLearningPolicy({ settings, evaluation, registry: f.registry, quality: f.quality, ownerApproval, now: f.now });
  const manifest = { version: 'atlas-learning-release-v1', policy: 'balanced-defect-v1', publications: [] };
  const active = { id: 'synthetic-baseline', manifest, manifestSha256: digest(canonical(manifest)) };
  const document = { source: f.candidates[0].source, examples: [f.candidates[0].example] };
  const feedback = { document, sha256: digest(canonical(document)) }, publication = { revision: 1, sha256: digest('synthetic-publication') };
  const audit = seal({ status: 'PASS', feedbackSha256: feedback.sha256, publicationSha256: publication.sha256, reviewers: ['expert-a', 'expert-b'] });
  const monitoring = seal({ status: 'PASS', policySha256: policy.sha256, activeReleaseSha256: active.manifestSha256,
    cases: 20, measuredAt: '2026-09-27T23:00:00Z' });
  const input = { id: 'synthetic-promotion', active, domain: f.domain, policy, registry: f.registry, quality: f.quality,
    targetScope: f.target, candidates: [{ publication, feedback, audit }], monitoring,
    verifiedArtifactHashes: [audit.sha256, monitoring.sha256], now: f.now };
  return { f, settings, evaluation, ownerApproval, input };
}
// Synthetic authorization data exercises binding only; it is never Mark's
// approval, a real benchmark or a production activation artifact.
function reviewedInput(input) {
  const review = learningPromotionPlan(input), settings = Object.fromEntries(
    ['id', 'domain', 'selection', 'geometry', 'promotion', 'bindings', 'validFrom', 'validUntil'].map(k => [k, input.policy[k]]));
  const evaluation = seal({ version: 'atlas-domain-learning-evaluation-v1', domain: input.domain,
    status: 'ELIGIBLE_FOR_OWNER_REVIEW', blockers: [], baselineReleaseSha256: input.active.manifestSha256,
    candidateCorpusSha256: review.candidateCorpusSha256, policySettingsSha256: digest(canonical(settings)),
    registrySha256: input.registry.sha256, reviewerQualitySha256: input.quality.sha256, bindings: input.policy.bindings });
  const independentTruthAuditSha256 = digest('synthetic-promotion-truth-audit');
  return { ...input, evaluation, ownerApproval: { purpose: 'PROMOTE_LEARNING_RELEASE', reviewSha256: review.sha256,
    evaluationSha256: evaluation.sha256, approvedBy: 'synthetic-owner', approvedAt: '2026-09-27T23:30:00Z', independentTruthAuditSha256 },
  verifiedArtifactHashes: [...input.verifiedArtifactHashes, digest(`${JSON.stringify(evaluation, null, 2)}\n`), independentTruthAuditSha256] };
}
test('policy creation binds exact evaluated settings, registry, reviewer quality and independent owner audit', () => {
  const x = promotionFixture();
  assert.throws(() => validatedLearningPolicy({ ...x, registry: x.f.registry, quality: x.f.quality, ownerApproval: null, now: x.f.now }));
  assert.throws(() => validatedLearningPolicy({ ...x, settings: { ...x.settings, selection: { ...x.settings.selection, maximum: 12 } },
    registry: x.f.registry, quality: x.f.quality, now: x.f.now }), { code: 'LEARNING_VALIDATED_POLICY_REQUIRED' });
});
test('promotion admits only audited scoped labels and emits immutable membership plus source/current-release SQL fences', () => {
  const input = reviewedInput(promotionFixture().input), plan = learningPromotionPlan(input);
  assert.equal(plan.changesMade, false); assert.equal(plan.requiresPrivilegedExecution, true);
  assert.equal(plan.manifest.publications.length, 1); assert.deepEqual(plan.manifest.promotion.sampleRequired, [1]);
  assert.equal(plan.manifest.learningScopes.CLEAN.policy.sha256, input.policy.sha256);
  assert.deepEqual(plan.manifest.learningMembership, { DEFECT: [], CLEAN: [1], GEOMETRY: [] });
  assert.match(plan.sql, /Promotion source changed/); assert.match(plan.sql, /j.state='PREPARED'/);
  assert.match(plan.sql, /discarded_card/); assert.match(plan.sql, /FOR UPDATE OF c/);
  assert(!plan.sql.includes('defect_memory_publication')); assert(!plan.sql.includes('DELETE'));
  assert.deepEqual(plan.manifest.promotion.ownerApproval, input.ownerApproval);
  assert.equal(plan.manifest.promotion.evaluationSha256, input.evaluation.sha256);
});
test('policy approval alone prepares a sealed candidate for evaluation without activation SQL', () => {
  const { input } = promotionFixture(), review = learningPromotionPlan(input);
  assert.equal(review.status, 'REQUIRES_OWNER_REVIEW'); assert.equal(review.changesMade, false);
  assert.equal(review.requiresOwnerApproval, true); assert.equal(Object.hasOwn(review, 'sql'), false);
  assert.equal(Object.hasOwn(review, 'sqlSha256'), false);
  assert.equal(review.candidateManifest.publications.length, 1);
  assert.equal(review.candidateCorpusSha256, digest(canonical(review.candidateManifest.publications)));
  const { sha256, ...body } = review; assert.equal(sha256, digest(canonical(body, { maxBytes: 16777216 })));
});
test('promotion requires a fresh exact-release approval and verified comparison against the active baseline', () => {
  for (const mutate of [
    x => { x.evaluation = null; },
    x => { x.ownerApproval = x.policy.ownerApproval; },
    x => { x.ownerApproval.reviewSha256 = digest('another-release'); },
    x => { x.ownerApproval.evaluationSha256 = digest('another-evaluation'); },
    x => { x.ownerApproval.approvedBy = ''; },
    x => { x.ownerApproval.approvedAt = '2027-01-01'; },
    x => { x.verifiedArtifactHashes = x.verifiedArtifactHashes.filter(h => h !== x.ownerApproval.independentTruthAuditSha256); },
    x => { x.verifiedArtifactHashes = x.verifiedArtifactHashes.filter(h => h !== digest(`${JSON.stringify(x.evaluation, null, 2)}\n`)); },
    x => { x.id = 'different-promotion'; },
  ]) { const input = reviewedInput(promotionFixture().input); mutate(input); assert.throws(() => learningPromotionPlan(input)); }
  for (const [key, value] of [
    ['status', 'BLOCKED'], ['domain', 'GEOMETRY'], ['baselineReleaseSha256', digest('previous-baseline')],
    ['candidateCorpusSha256', digest('another-corpus')], ['policySettingsSha256', digest('other-settings')],
    ['registrySha256', digest('other-registry')], ['reviewerQualitySha256', digest('other-quality')],
    ['bindings', { modelPromptSha256: digest('different-model'), imagePolicySha256: digest('image'), scoringPolicySha256: digest('score') }],
  ]) {
    const input = reviewedInput(promotionFixture().input), { sha256: _old, ...body } = input.evaluation;
    input.evaluation = seal({ ...body, [key]: value }); input.ownerApproval.evaluationSha256 = input.evaluation.sha256;
    input.verifiedArtifactHashes.push(digest(`${JSON.stringify(input.evaluation, null, 2)}\n`));
    assert.throws(() => learningPromotionPlan(input), { code: 'LEARNING_PROMOTION_EVALUATION_REQUIRED' });
  }
});
test('missing monitoring, independent audit, expired policy and unsupported label cannot promote themselves', () => {
  for (const mutate of [
    x => { x.input.verifiedArtifactHashes = []; },
    x => { x.input.candidates[0].audit = null; },
    x => { x.input.now = Date.parse('2027-01-01'); },
    x => { x.input.candidates[0].feedback.document.examples[0].label = 'UNINSPECTED';
      x.input.candidates[0].feedback.sha256 = digest(canonical(x.input.candidates[0].feedback.document)); },
  ]) { const x = promotionFixture(); mutate(x); assert.throws(() => learningPromotionPlan(x.input)); }
});

test('mixed confirmations admitted for clean cannot activate sibling defect or geometry labels', () => {
  const { input } = promotionFixture(), candidate = input.candidates[0];
  candidate.feedback.document.examples.push({ kind: 'DEFECT', label: 'ADDED' }, { kind: 'GEOMETRY', label: 'CORRECTED' });
  candidate.feedback.sha256 = digest(canonical(candidate.feedback.document));
  const { sha256: _old, ...audit } = candidate.audit;
  candidate.audit = seal({ ...audit, feedbackSha256: candidate.feedback.sha256 });
  input.verifiedArtifactHashes.push(candidate.audit.sha256);
  input.active.manifest.publications = [{ revision: 99, sha256: digest('prior-defect-baseline') }];
  input.active.manifestSha256 = digest(canonical(input.active.manifest));
  const { sha256: _m, ...monitor } = input.monitoring;
  input.monitoring = seal({ ...monitor, activeReleaseSha256: input.active.manifestSha256 });
  input.verifiedArtifactHashes.push(input.monitoring.sha256);
  const plan = learningPromotionPlan(reviewedInput(input));
  assert.deepEqual(plan.manifest.learningMembership, { DEFECT: [99], CLEAN: [1], GEOMETRY: [] });
  assert.equal(plan.manifest.learningScopes.DEFECT, undefined);
});

test('offline CLI verifies actual comparison bytes and keeps draft generation separate from approval', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-promotion-cli-'));
  try {
    const input = reviewedInput(promotionFixture().input), artifacts = [];
    const saveArtifact = (name, bytes) => {
      const path = join(root, name); writeFileSync(path, bytes); artifacts.push({ path, sha256: digest(bytes) }); return path;
    };
    for (const [name, value] of [['monitoring', input.monitoring], ['audit', input.candidates[0].audit]]) {
      const { sha256: _sha, ...body } = value; saveArtifact(`${name}.json`, canonical(body));
    }
    const evaluationPath = saveArtifact('comparison-report.json', `${JSON.stringify(input.evaluation, null, 2)}\n`);
    saveArtifact('truth-audit.txt', 'synthetic-promotion-truth-audit');
    const cli = fileURLToPath(new URL('../scripts/evaluate.mjs', import.meta.url));
    const run = (name, value) => {
      const inputPath = join(root, `${name}-input.json`), outputPath = join(root, `${name}-output.json`);
      writeFileSync(inputPath, JSON.stringify({ ...value, artifacts }));
      const process = spawnSync(globalThis.process.execPath, [cli, 'promote-plan', inputPath, outputPath], { encoding: 'utf8' });
      return { process, outputPath, output: existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, 'utf8')) : null };
    };
    const draft = run('draft', { ...input, ownerApproval: null }); assert.equal(draft.process.status, 0, draft.process.stderr);
    assert.equal(draft.output.status, 'REQUIRES_OWNER_REVIEW'); assert.equal(Object.hasOwn(draft.output, 'sql'), false);
    const approved = run('approved', input); assert.equal(approved.process.status, 0, approved.process.stderr);
    assert.equal(approved.output.status, 'OWNER_APPROVED_REQUIRES_PRIVILEGED_EXECUTION');
    assert.equal(approved.output.manifest.promotion.evaluationSha256, input.evaluation.sha256);
    writeFileSync(evaluationPath, 'changed comparison bytes');
    const tampered = run('tampered', input); assert.notEqual(tampered.process.status, 0);
    assert.equal(tampered.output, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
