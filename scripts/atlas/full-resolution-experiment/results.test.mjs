import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretResponse, scoreExperiment } from './results.mjs';
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
