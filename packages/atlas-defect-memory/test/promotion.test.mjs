import test from 'node:test';
import assert from 'node:assert/strict';
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
test('policy creation binds exact evaluated settings, registry, reviewer quality and independent owner audit', () => {
  const x = promotionFixture();
  assert.throws(() => validatedLearningPolicy({ ...x, registry: x.f.registry, quality: x.f.quality, ownerApproval: null, now: x.f.now }));
  assert.throws(() => validatedLearningPolicy({ ...x, settings: { ...x.settings, selection: { ...x.settings.selection, maximum: 12 } },
    registry: x.f.registry, quality: x.f.quality, now: x.f.now }), { code: 'LEARNING_VALIDATED_POLICY_REQUIRED' });
});
test('promotion admits only audited scoped labels and emits immutable membership plus source/current-release SQL fences', () => {
  const { input } = promotionFixture(), plan = learningPromotionPlan(input);
  assert.equal(plan.changesMade, false); assert.equal(plan.requiresPrivilegedExecution, true);
  assert.equal(plan.manifest.publications.length, 1); assert.deepEqual(plan.manifest.promotion.sampleRequired, [1]);
  assert.equal(plan.manifest.learningScopes.CLEAN.policy.sha256, input.policy.sha256);
  assert.deepEqual(plan.manifest.learningMembership, { DEFECT: [], CLEAN: [1], GEOMETRY: [] });
  assert.match(plan.sql, /Promotion source changed/); assert.match(plan.sql, /j.state='PREPARED'/);
  assert.match(plan.sql, /discarded_card/); assert.match(plan.sql, /FOR UPDATE OF c/);
  assert(!plan.sql.includes('defect_memory_publication')); assert(!plan.sql.includes('DELETE'));
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
  const plan = learningPromotionPlan(input);
  assert.deepEqual(plan.manifest.learningMembership, { DEFECT: [99], CLEAN: [1], GEOMETRY: [] });
  assert.equal(plan.manifest.learningScopes.DEFECT, undefined);
});
