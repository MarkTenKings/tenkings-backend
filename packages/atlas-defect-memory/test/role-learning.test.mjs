import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, digest } from '../src/contract.mjs';
import { readRoleLearning } from '../src/role-repository.mjs';
import { selectRoleLearning, consumeCleanLearning, consumeGeometryLearning, normalizeLearningIdentity,
  validateLearningRegistry } from '../src/role-learning.mjs';
import { buildAstraDefectRequest, restorePreparedRequest, validateRequestEvidence } from '../../atlas-defect-analysis/src/index.mjs';
import { inputFixture } from '../../atlas-defect-analysis/test/fixtures.mjs';
import { roleFixture, seal } from './role-fixtures.mjs';

test('unactivated role falls back, normalized names preserve grouping, contradictory original/specimen identities fail', () => {
  assert.equal(selectRoleLearning({ domain: 'GEOMETRY', policy: null }).status, 'BASELINE');
  assert.equal(normalizeLearningIdentity('  SÝNTHETIC　Family  '), 'sýnthetic family');
  const f = roleFixture(), { sha256: _sha, ...body } = f.registry;
  body.cards[1].originalSha256[0] = body.cards[0].originalSha256[0];
  assert.throws(() => validateLearningRegistry(seal(body)), { code: 'LEARNING_ORIGINAL_IDENTITY_CONFLICT' });
});
test('same physical specimen retakes, unknown identity, mismatched negative design and unproven reviewer quality are excluded', () => {
  for (const mutate of [
    f => { f.registry.cards[1].specimenId = f.registry.cards[0].specimenId; },
    f => { f.target.cardId = '10000000-0000-4000-8000-000000000999'; },
    f => { f.registry.cards[1].designId = 'different design'; },
    f => { f.quality.reviewers[0].correct = 50; },
  ]) {
    const f = roleFixture(); mutate(f);
    const { sha256: _r, ...r } = f.registry, { sha256: _q, ...q } = f.quality, { sha256: _p, ...p } = f.policy;
    f.registry = seal(r); f.quality = seal(q); f.policy = seal({ ...p, registrySha256: f.registry.sha256, reviewerQualitySha256: f.quality.sha256 });
    const result = selectRoleLearning(f); assert.equal(result.examples.length, 0); assert.equal(result.status, 'BASELINE');
  }
});
test('clean consumer loads exact source-bound PNG, enters real Astra request and restores byte-exact evidence', async () => {
  const f = roleFixture(), selection = selectRoleLearning(f);
  const cleanLearning = await consumeCleanLearning({ selection, loadImage: async () => f.image });
  assert.equal(cleanLearning.examples.length, 1);
  const input = { ...inputFixture(), cleanLearning }, prepared = buildAstraDefectRequest(input);
  assert(prepared.requestText.includes('HUMAN_REVIEWED_CLEAN_EXAMPLE'));
  assert.equal(prepared.request.input[1].content.filter(c => c.type === 'input_image').length, 11);
  assert.equal(validateRequestEvidence(prepared.evidence).cleanLearning.consumer.selectionSha256, selection.sha256);
  const restored = restorePreparedRequest(prepared); assert.equal(restored.requestText, prepared.requestText);
  assert.equal(restored.evidenceHash, prepared.evidenceHash);
  const invalid = await consumeCleanLearning({ selection, loadImage: async () => ({ ...f.image, sourceSha256: digest('wrong') }) });
  assert.equal(invalid.examples.length, 0); assert.equal(invalid.evidence.unavailable.length, 1);
  await assert.rejects(consumeCleanLearning({ selection, loadImage: async () => { throw Object.assign(Error(), { status: 403 }); } }));
});
test('geometry consumer ranks only native current-frame candidates, abstains on ambiguous ties and never copies source coordinates', () => {
  const f = roleFixture('GEOMETRY'), selection = selectRoleLearning(f), frame = digest('current-frame');
  const candidates = [{ id: 'native-good', engineSha256: f.policy.bindings.modelPromptSha256, frameSha256: frame, nativeSupported: true, authority: 'PROPOSER_ONLY', physical: f.physical, printed: f.printed },
    { id: 'native-other', engineSha256: f.policy.bindings.modelPromptSha256, frameSha256: frame, nativeSupported: true, authority: 'PROPOSER_ONLY', physical: f.physical,
      printed: f.printed.map(p => ({ x: p.x + .1, y: p.y })) }];
  const result = consumeGeometryLearning({ selection, policy: f.policy, targetFrameSha256: frame, candidates });
  assert.equal(result.status, 'CANDIDATE'); assert.equal(result.selectedCandidateId, 'native-good');
  assert.equal(result.requiresHumanConfirmation, true); assert(!JSON.stringify(result).includes('"physical"'));
  assert.equal(consumeGeometryLearning({ selection, policy: f.policy, targetFrameSha256: frame,
    candidates: [candidates[0], { ...candidates[0], id: 'equal' }] }).status, 'ABSTAIN');
  assert.throws(() => consumeGeometryLearning({ selection, policy: f.policy, targetFrameSha256: digest('other'), candidates }), { code: 'LEARNING_GEOMETRY_SOURCE_MISMATCH' });
  assert.throws(() => consumeGeometryLearning({ selection: selectRoleLearning(roleFixture()), policy: f.policy, targetFrameSha256: frame, candidates }));
});
test('active role reader isolates corrupt feedback, bounds source queries and records expired-policy fallback', async () => {
  const f = roleFixture(), scope = { policy: f.policy, registry: f.registry, quality: f.quality };
  const manifest = canonical({ learningScopes: { CLEAN: scope } });
  const source = { ...f.candidates[0].source, cardId: f.registry.cards[2].cardId };
  const example = { ...f.candidates[0].example, frame: { ...f.candidates[0].example.frame, originalSha256: f.registry.cards[2].originalSha256[0] } };
  const feedback = canonical({ source, examples: [example] }); let queries = 0;
  const tx = { async $queryRawUnsafe(sql, ...args) {
    if (sql.includes('SELECT r.id')) return [{ id: 'fixture-release', manifest, manifest_hash: digest(manifest) }];
    queries++; assert(args[1].length <= 512);
    return [{ card_id: f.candidates[0].source.cardId, action_id: source.actionId, revision: 1, feedback: '{}', feedback_hash: digest('wrong') },
      { card_id: source.cardId, action_id: source.actionId, revision: 2, feedback, feedback_hash: digest(feedback) }];
  } };
  const result = await readRoleLearning(tx, f); assert.equal(result.selection.examples.length, 1);
  assert.equal(result.selection.unavailable.length, 1); assert.equal(result.selection.status, 'READY');
  const expired = await readRoleLearning(tx, { ...f, now: Date.parse('2027-01-01') });
  assert.equal(expired.selection.reason, 'POLICY_EXPIRED'); assert.equal(queries, 1);
  await assert.rejects(readRoleLearning(tx, { ...f, target: { ...f.target, originalSha256: [] } }), { code: 'LEARNING_TARGET_INVALID' });
  await assert.rejects(readRoleLearning(tx, { ...f, target: { ...f.target, side: 'OTHER' } }), { code: 'LEARNING_TARGET_INVALID' });
});
test('malformed individual clean metadata cannot poison the real null-side request path', async () => {
  for (const mutate of [candidate => { candidate.example.side = 'INVALID'; },
    candidate => { candidate.source.cardId = 'invalid'; }, candidate => { candidate.example.frame.frameId = ''; }]) {
    const f = roleFixture(); f.target.side = null;
    const broken = structuredClone(f.candidates[0]); broken.id = digest('broken'); mutate(broken);
    const selection = selectRoleLearning({ ...f, candidates: [broken, ...f.candidates] });
    assert.equal(selection.examples.length, 1);
    assert.equal(selection.decisions.find(d => d.id === broken.id).reason, 'EXAMPLE_INVALID');
    const cleanLearning = await consumeCleanLearning({ selection, loadImage: async () => f.image });
    assert.equal(cleanLearning.evidence.unavailable.length, 1);
    assert.doesNotThrow(() => buildAstraDefectRequest({ ...inputFixture(), cleanLearning }));
  }
  const f = roleFixture(), original = selectRoleLearning(f), { sha256: _, ...body } = original;
  const cloned = structuredClone(body); cloned.examples[0].example.side = 'INVALID';
  const fallback = await consumeCleanLearning({ selection: seal(cloned), loadImage: async () => f.image });
  assert.equal(fallback.examples.length, 0); assert.equal(fallback.evidence.unavailable.length, 1);
});
test('rectified printed-border features are independent of physical card translation and uniform photo scale', () => {
  const f = roleFixture('GEOMETRY'), selection = selectRoleLearning(f), targetFrameSha256 = digest('translated-frame');
  const candidates = [{ id: 'same-border-new-placement', engineSha256: f.policy.bindings.modelPromptSha256,
    frameSha256: targetFrameSha256, nativeSupported: true, authority: 'PROPOSER_ONLY',
    physical: f.physical.map(p => ({ x: p.x * .7 + .1, y: p.y * .7 + .03 })), printed: f.printed }];
  const result = consumeGeometryLearning({ selection, policy: f.policy, targetFrameSha256, candidates });
  assert.equal(result.status, 'CANDIDATE'); assert(result.candidates[0].distance < 1e-12);
});
test('optional clean references skip invalid PNG/IHDR and exhausted byte/count budgets without changing current inputs', async () => {
  const f = roleFixture(), selection = selectRoleLearning(f);
  for (const corrupt of [bytes => { bytes[0] = 0; }, bytes => { bytes.writeUInt32BE(1, 16); }]) {
    const bytes = Buffer.from(f.image.bytes); corrupt(bytes);
    const cleanLearning = await consumeCleanLearning({ selection, loadImage: async () => ({ ...f.image, bytes, sha256: digest(bytes) }) });
    assert.equal(cleanLearning.examples.length, 0); assert.equal(cleanLearning.evidence.unavailable.length, 1);
    assert.doesNotThrow(() => buildAstraDefectRequest({ ...inputFixture(), cleanLearning }));
  }
  for (const budgets of [{ remainingImageBytes: f.image.bytes.byteLength - 1 }, { limit: 0 }]) {
    const cleanLearning = await consumeCleanLearning({ selection, loadImage: async () => f.image, ...budgets });
    assert.equal(cleanLearning.examples.length, 0); assert.equal(cleanLearning.evidence.unavailable[0].reason, 'CLEAN_EXAMPLE_BUDGET');
    const original = inputFixture(), before = original.images.map(s => s.whole.sha256);
    const prepared = buildAstraDefectRequest({ ...original, cleanLearning });
    assert.deepEqual(original.images.map(s => s.whole.sha256), before);
    assert.equal(restorePreparedRequest(prepared).requestHash, prepared.requestHash);
  }
});
