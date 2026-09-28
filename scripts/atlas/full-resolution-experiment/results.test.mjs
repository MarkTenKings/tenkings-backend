import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonical, digest } from '../../../packages/atlas-defect-analysis/src/contract.mjs';
import { descriptorSha256 } from '../../../packages/atlas-photo-core/src/index.mjs';
import { gradingIdentity, FIELDS } from '../../../packages/atlas-connected-manual/src/details.mjs';
import { interpretResponse, scoreExperiment, verifyEvidenceBinding, assertFrozenStateBinding, verifyExperimentInputs } from './results.mjs';
const evidence = () => ({ policy: 'atlas-source-resolution-experiment-v1', analysisId: 'experiment', model: 'gpt-6-astra',
  sourceBindingSha256: 'a'.repeat(64), knowledge: { revision: 'frozen', lessonIds: [] }, diagnosticOnly: false,
  sourceSides: { FRONT: { width: 100, height: 140, workingSha256: 'b'.repeat(64), sourceToRectified: [1269/99,0,0,0,1777/139,0,0,0,1] } },
  images: [{ id: 'FRONT:whole', side: 'FRONT', sourceImageSha256: 'b'.repeat(64), sha256: 'b'.repeat(64), crop: {x:0,y:0,width:100,height:140} }] });
const finding = () => ({ side: 'FRONT', imageId: 'FRONT:whole', defectType: 'VISIBLE_WHITENING', localContour: [{x:20,y:20},{x:30,y:20},{x:30,y:30}], observation: 'Visible edge mark.', uncertainty: 'MEDIUM', lessonIds: [] });
const body = (findings, e) => ({ id: 'resp_fixture', model: e.model, status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text: JSON.stringify({ sourceBindingSha256: e.sourceBindingSha256, knowledgeRevision: e.knowledge.revision, findings, limitations: [] }) }] }] });
test('source coordinates are mapped before existing measurement; no machine approval is produced', () => {
  const e=evidence(), r=interpretResponse(body([finding()],e),e); assert.equal(r.validCount,1); assert.equal(r.canScore,true);
  assert(Math.abs(r.analysis.proposals[0].canonicalContour[0].x-20/99)<1e-12); assert.equal(r.humanApproval,false);
});
test('one invalid contour remains in raw evidence and prevents whole-card scoring', async () => {
  const e=evidence(), bad=finding(); bad.localContour[0].x=-0.01;
  const r=interpretResponse(body([finding(),bad],e),e); assert.equal(r.validCount,1); assert.equal(r.invalidCount,1); assert.equal(r.rows.length,2);
  assert.equal(r.canScore,false); await assert.rejects(scoreExperiment(null,null,r,null),/incomplete\/invalid/);
});
test('missing physical preparation preserves source findings with unavailable canonical coordinates and no grade', () => {
  const e=evidence();e.diagnosticOnly=true;e.sourceSides.FRONT.sourceToRectified=null;
  const r=interpretResponse(body([finding()],e),e);assert.equal(r.unmappableCount,1);assert.equal(r.canScore,false);assert.equal(r.rows[0].canonicalContour,null);
});
test('wrong source/response/memory/image bindings and unsupported output cannot become a measured finding', () => {
  const e=evidence(), b=body([finding()],e);assert.throws(()=>interpretResponse(b,{...e,sourceBindingSha256:'c'.repeat(64)}));
  assert.throws(()=>interpretResponse({...b,output:[{type:'tool_call'}]},e));
  const changed=evidence();changed.images[0].sourceImageSha256='c'.repeat(64);assert.equal(interpretResponse(b,changed).invalidCount,1);
  const f=finding();f.lessonIds=['invented'];assert.equal(interpretResponse(body([f],e),e).invalidCount,1);
});
test('unverified response echoes cannot authorize scoring, even with entirely valid findings', async () => {
  const e = evidence(), r = interpretResponse(body([finding()], e), e);
  await assert.rejects(scoreExperiment({}, [], r, null), /verified frozen experiment inputs required/);
});
test('production string and token accounting restrictions remain enforced', () => {
  const e = evidence(), f = finding(); f.observation = ' padded ';
  assert.equal(interpretResponse(body([f], e), e).canScore, false);
  const b = body([finding()], e); b.usage = { input_tokens: 10, output_tokens: 5, total_tokens: 14 };
  assert.throws(() => interpretResponse(b, e), /DEFECT_ANALYSIS_USAGE_INVALID/);
});
function bind(e) {
  const { policy, cardId, profile, cornerShapes, sourceSides, images, knowledge, baselineEvidenceHash } = e;
  e.sourceBindingSha256 = digest(canonical({ policy, cardId, profile, cornerShapes, sourceSides, images, knowledge,
    baselineEvidenceHash }, 262144)); return e;
}
function frozenFixture() {
  const cardId = '11111111-1111-4111-8111-111111111111';
  const details = { fields: Object.fromEntries(FIELDS.map(k => [k, ''])), profile: 'SPORTS', layoutType: null,
    cornerShape: 'SQUARE', matColor: 'BLACK', parallel: '', insert: '', touched: [], sourceHash: null };
  Object.assign(details.fields, { name: 'Fixture', year: '2026', manufacturer: 'Fixture', set_name: 'Fixture' });
  const card = { cardId, label: 'Card-42', snapshot: { details }, baseline: null, geometryArtifacts: [], sides: {} };
  const e = { policy: 'atlas-source-resolution-experiment-v1', cardId, label: card.label, profile: details.profile,
    identity: gradingIdentity(details), cornerShapes: { FRONT: 'SQUARE', BACK: 'SQUARE' }, sourceSides: {}, images: [],
    knowledge: {}, baselineAnalysisId: null, baselineEvidenceHash: null, baselineRequestHash: null,
    productionWrites: false, humanApproval: false, diagnosticOnly: true };
  const artifact = (kind, value) => ({ ref: { cardId, kind, sha256: digest(JSON.stringify(value)),
    byteCount: Buffer.byteLength(JSON.stringify(value)) }, value });
  for (const [i, side] of ['FRONT', 'BACK'].entries()) {
    const working = { id: `working-${side}`, originalDescriptorSha256: String(i+1).repeat(64),
      sourceToFrame: [1,0,0,0,1,0,0,0,1], raster: { dimensions: { width: 100, height: 140 }, content: { sha256: String(i+3).repeat(64) } } };
    const photo = { original: { binding: { cardId, side, pairId: 'frozen-pair', version: 1 }, content: { sha256: String(i+5).repeat(64) } }, workingFrame: working };
    card.sides[side] = { photo: artifact('PHOTO_SOURCE', photo), prepared: null };
    card.geometryArtifacts.push(artifact('EARLY_GEOMETRY', { binding: { cardId, side }, photoFrame: structuredClone(working), preparation: null }));
    e.sourceSides[side] = { originalSha256: photo.original.content.sha256, workingSha256: working.raster.content.sha256,
      originalToWorking: working.sourceToFrame, workingDescriptorSha256: descriptorSha256(working), width: 100, height: 140,
      sourceToRectified: null, preparedFrame: null, preparedArtifactSha256: null, sourceCardPolygon: null };
  }
  return { card, extra: [], evidence: bind(e) };
}
test('exact prepare binding protects every scoring-relevant source and lesson field', () => {
  const { evidence: e } = frozenFixture(); verifyEvidenceBinding(e);
  for (const mutate of [x => x.cardId += 'x', x => x.profile = 'POKEMON', x => x.cornerShapes.FRONT = 'ROUNDED_3_18_MM',
    x => x.sourceSides.FRONT.width++, x => x.sourceSides.FRONT.sourceToRectified = [1,0,0,0,1,0,0,0,1],
    x => x.images.push({ id: 'substitute' }), x => x.knowledge.revision = 'changed', x => x.baselineEvidenceHash = 'f'.repeat(64)]) {
    const changed = structuredClone(e); mutate(changed); assert.throws(() => verifyEvidenceBinding(changed), /binding changed/);
  }
});
test('rebinding substituted evidence cannot bypass the independently frozen manifest', () => {
  const { evidence: e, card, extra } = frozenFixture(); assertFrozenStateBinding(e, card, extra);
  for (const mutate of [x => x.sourceSides.FRONT.workingSha256 = 'f'.repeat(64), x => x.sourceSides.FRONT.width++,
    x => x.sourceSides.FRONT.originalToWorking[2] = 1, x => x.sourceSides.FRONT.sourceToRectified = [1,0,0,0,1,0,0,0,1]]) {
    const changed = structuredClone(e); mutate(changed); bind(changed);
    assert.throws(() => assertFrozenStateBinding(changed, card, extra), /source\/geometry substitution/);
  }
});
test('card, paired source, artifact and identity substitution fail before measurement', () => {
  const { evidence: e, card, extra } = frozenFixture();
  for (const mutate of [x => x.cardId += 'x', x => x.label = 'Card-43', x => x.snapshot.details.fields.name = 'Other',
    x => x.sides.BACK.photo.value.original.binding.pairId = 'other-pair',
    x => x.geometryArtifacts[0].value.photoFrame.raster.dimensions.width++]) {
    const changed = structuredClone(card); mutate(changed); assert.throws(() => assertFrozenStateBinding(e, changed, extra));
  }
});
test('paid-request byte substitution is rejected before baseline restoration or scoring', () => {
  const { evidence: e, card, extra } = frozenFixture(); e.requestHash = digest('{}'); e.requestByteCount = 2;
  const manifest = { version: e.policy, cards: [card, ...Array.from({length: 5}, (_, i) => ({ cardId: `other-${i}`, label: `Other-${i}` }))] };
  assert.throws(() => verifyExperimentInputs({ manifestText: JSON.stringify(manifest), extraText: JSON.stringify(extra),
    evidenceText: JSON.stringify(e), requestText: '{"changed":true}', label: card.label }), /strictly equal/);
});

// Private frozen inputs are optional; enable this read-only integration check by
// supplying their existing directory. No provider call or output write occurs.
test('all six retained paid inputs pass; source/evidence/card/request/receipt substitutions fail',
  { skip: !process.env.ATLAS_EXPERIMENT_FIXTURE_ROOT }, async () => {
    const root = resolve(process.env.ATLAS_EXPERIMENT_FIXTURE_ROOT);
    const text = path => readFile(path, 'utf8'), json = async path => JSON.parse(await text(path));
    const manifestText = await text(resolve(root, 'input-manifest.private.json')), manifest = JSON.parse(manifestText);
    const extraText = await text(resolve(root, 'extra-artifacts.private.json'));
    const threadsMemory = await json(resolve(root, 'threads-memory.private.json'));
    for (const card of manifest.cards) {
      const template = card.baseline ? card : manifest.cards.find(c => c.label === 'Card-41');
      const args = { manifestText, extraText, threadsMemory, label: card.label,
        evidenceText: await text(resolve(root, card.label, 'evidence.json')), requestText: await text(resolve(root, card.label, 'request.json')),
        baselineRequestText: await text(template.baselineRequestPath), dispatchIntent: await json(resolve(root, card.label, 'dispatch.intent.json')),
        accepted: await json(resolve(root, card.label, 'accepted.json')) };
      const verified = verifyExperimentInputs(args);
      assert.equal(verified.verification.inputManifestSha256, digest(manifestText));
      assert.equal(verified.verification.evidenceSha256, digest(args.evidenceText));
      assert.equal(verified.verification.requestSha256, digest(args.requestText));
      const substituted = JSON.parse(args.evidenceText); substituted.sourceSides.FRONT.sourceToRectified[2] += 1;
      assert.throws(() => verifyExperimentInputs({ ...args, evidenceText: JSON.stringify(substituted) }), /binding changed/);
      bind(substituted);
      assert.throws(() => verifyExperimentInputs({ ...args, evidenceText: JSON.stringify(substituted) }), /source\/geometry substitution/);
      const swapped = manifest.cards.find(c => c.cardId !== card.cardId);
      assert.throws(() => assertFrozenStateBinding(verified.evidence, swapped, verified.extra));
      const badManifest = JSON.parse(manifestText), selected = badManifest.cards.find(c => c.cardId === card.cardId);
      selected.sides.FRONT.photo.value.workingFrame.raster.dimensions.width++;
      assert.throws(() => verifyExperimentInputs({ ...args, manifestText: JSON.stringify(badManifest) }), /manifest artifact changed/);
      assert.throws(() => verifyExperimentInputs({ ...args, requestText: args.requestText + '\n' }));
      assert.throws(() => verifyExperimentInputs({ ...args, accepted: { ...args.accepted, requestHash: 'f'.repeat(64) } }));
      const validBody = body([], verified.evidence); validBody.id = verified.verification.acceptedResponseId;
      assert.throws(() => interpretResponse({ ...validBody, id: 'resp_substituted' }, verified.evidence), /accepted paid request/);
      const result = interpretResponse(validBody, verified.evidence);
      if (result.canScore) {
        await assert.rejects(scoreExperiment(swapped, verified.extra, result, null), /scoring card changed/);
        await assert.rejects(scoreExperiment(verified.card, [], result, null), /scoring artifacts changed/);
        const changed = structuredClone(result); await assert.rejects(scoreExperiment(verified.card, verified.extra, changed, null), /verified frozen/);
        result.analysis.proposals.push({}); await assert.rejects(scoreExperiment(verified.card, verified.extra, result, null), /findings changed/);
      }
      verified.evidence.sourceSides.FRONT.sourceToRectified[2] += 1;
      assert.throws(() => interpretResponse(validBody, verified.evidence), /verified evidence changed/);
    }
  });
