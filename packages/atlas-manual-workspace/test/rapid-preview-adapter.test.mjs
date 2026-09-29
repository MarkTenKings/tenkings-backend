import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {before,test} from 'node:test';
import {createRapidPreviewAdapter} from '../scripts/rapid-preview-adapter.mjs';
import {geometryBase,geometryStatus,printedQuadOnOriginal} from '../src/geometry-actions.mjs';
import {defectStatus} from '../src/defect-actions.mjs';
import {sourceQuadToPrepared,focusedGeometryOutlines} from '../src/geometry-focus.mjs';
import {approveRapidGeometrySide,confirmRapidGeometryPair,approveRapidFinding} from '../src/rapid-review.mjs';
import {decodeSpeedsterTraceRleV1} from '@atlas/grading-core/trace-codec';

const pythonExecutable=process.env.ATLAS_FIXTURE_PYTHON;
if(pythonExecutable&&!pythonExecutable.startsWith('/'))throw Error('ATLAS_FIXTURE_PYTHON must be an absolute local CPU Python executable');
const nativeTest=(name,run)=>test(name,{skip:!pythonExecutable&&'Set ATLAS_FIXTURE_PYTHON to run the local CPU demo tests'},run);
let adapter,holdPreparation=false;
before(async()=>{if(pythonExecutable)adapter=await createRapidPreviewAdapter({pythonExecutable,beforePrepare:async()=>{if(holdPreparation)throw Error('Held local preparation');}});});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const closeQuad=(actual,expected)=>actual.forEach((p,i)=>{assert.ok(Math.abs(p.x-expected[i].x)<1e-9);assert.ok(Math.abs(p.y-expected[i].y)<1e-9);});
const inputFor=(view,side)=>{
  const outlines=structuredClone(focusedGeometryOutlines(view.geometry,side));
  outlines.physical[0].x-=.003;outlines.physical[0].y-=.003;
  outlines.printedOriginal[0].x+=.004;outlines.printedOriginal[0].y+=.004;
  return {side,base:geometryBase(view.geometry,side,'REVIEW'),physical:outlines.physical,printedOriginal:outlines.printedOriginal};
};

nativeTest('initial demo descriptors name actual decoded and prepared bytes',()=>{
  const view=adapter.view();
  for(const side of ['FRONT','BACK'])for(const image of Object.values(view.images[side])){
    const asset=adapter.asset(image.sha256);assert.equal(sha(asset.bytes),image.sha256);assert.equal(asset.bytes.length,image.byteCount);
    assert.equal(image.url,`/images/${image.sha256}`);
  }
  assert.equal(view.geometry.sides.FRONT.prepared.frame.rectified.sha256,view.images.FRONT.rectified.sha256);
});

nativeTest('physical edit prepares actual bytes, reprojects and remeasures findings, then saves printed source points',async()=>{
  const before=adapter.view(),input=inputFor(before,'FRONT');
  const current=await approveRapidGeometrySide(before,input,adapter.execute,sourceQuadToPrepared,{});
  assert.equal(current.geometry.sides.FRONT.preparationRevision,2);
  assert.notEqual(current.images.FRONT.inspection.sha256,before.images.FRONT.inspection.sha256);
  assert.equal(sha(adapter.asset(current.images.FRONT.inspection.sha256).bytes),current.images.FRONT.inspection.sha256);
  closeQuad(current.geometry.sides.FRONT.physical.quad,input.physical);
  closeQuad(printedQuadOnOriginal(current.geometry,'FRONT'),input.printedOriginal);
  assert.deepEqual(current.defects.sides.BACK,before.defects.sides.BACK);
  assert.deepEqual(current.geometry.sides.BACK,before.geometry.sides.BACK);
  const slot=current.defects.sides.FRONT,finding=slot.findings[0];
  assert.equal(finding.id,before.defects.sides.FRONT.findings[0].id);
  assert.equal(slot.frame.inspectionImageSha256,current.images.FRONT.inspection.sha256);
  assert.equal(slot.frame.preparationVersion,2);assert.equal(slot.pending,null);
  assert.equal(slot.measurement.receipt.version,'atlas-manual-cpu-measurement-v1');
  assert.notEqual(finding.finalTrace.sha256,before.defects.sides.FRONT.findings[0].detectorMask.sha256);
  const area=decodeSpeedsterTraceRleV1(finding.finalTrace).reduce((n,p)=>n+p,0)*.0025;
  assert.ok(Math.abs(finding.measurementRegions.reduce((n,r)=>n+r.measurement.areaMm2,0)-area)<1e-9);
  assert.deepEqual(adapter.actions().map(a=>a.type),['GEOMETRY_EDIT','PREPARE_SIDE','GEOMETRY_EDIT']);
});

nativeTest('preparation failure preserves durable outline and prior evidence; retry resumes without repeating the edit',async()=>{
  const before=adapter.view(),input=inputFor(before,'BACK'),checkpoint={};holdPreparation=true;
  await assert.rejects(approveRapidGeometrySide(before,input,adapter.execute,sourceQuadToPrepared,checkpoint),/Held local preparation/);
  const held=adapter.view();assert.equal(held.geometry.sides.BACK.prepared,null);assert.equal(held.images.BACK.inspection,undefined);
  closeQuad(held.geometry.sides.BACK.physical.quad,input.physical);
  assert.deepEqual(held.defects.sides.BACK.frame,before.defects.sides.BACK.frame);
  assert.deepEqual(held.defects.sides.BACK.findings,before.defects.sides.BACK.findings);
  const physicalWrites=()=>adapter.actions().filter(a=>a.type==='GEOMETRY_EDIT'&&a.edit.side==='BACK'&&a.edit.kind==='PHYSICAL').length;
  assert.equal(physicalWrites(),1);holdPreparation=false;
  const current=await approveRapidGeometrySide(held,input,adapter.execute,sourceQuadToPrepared,checkpoint);
  assert.equal(physicalWrites(),1);assert.equal(current.geometry.sides.BACK.preparationRevision,2);
  closeQuad(printedQuadOnOriginal(current.geometry,'BACK'),input.printedOriginal);
});

nativeTest('stale writes are rejected and returned snapshots cannot mutate saved geometry',async()=>{
  const before=adapter.view(),wrong=structuredClone(geometryBase(before.geometry,'FRONT','PHYSICAL'));wrong.physicalRevision--;
  await assert.rejects(adapter.execute({type:'GEOMETRY_EDIT',edit:{side:'FRONT',kind:'PHYSICAL',base:wrong,quad:before.geometry.sides.FRONT.physical.quad}}));
  assert.deepEqual(adapter.view(),before);
  const snapshot=adapter.view();snapshot.geometry.sides.FRONT.physical.quad[0].x=0;
  assert.deepEqual(adapter.view(),before);
});

nativeTest('both edited sides proceed through finding decisions to a real draft grade, never report certification',async()=>{
  let current=adapter.view();
  const approvals=Object.fromEntries(['FRONT','BACK'].map(side=>[side,geometryBase(current.geometry,side,'REVIEW')]));
  current=await confirmRapidGeometryPair(current,approvals,adapter.execute);assert.equal(geometryStatus(current.geometry).confirmed,true);
  for(const side of ['FRONT','BACK'])current=(await approveRapidFinding(current,current.defects.sides[side].findings[0].id,adapter.execute)).view;
  assert.equal(defectStatus(current.defects).confirmed,true);
  const preview=adapter.preview();assert.ok(Number.isFinite(preview.report.finalGrade));assert.equal(preview.canCertify,false);
  assert.equal(preview.report.findings.length,2);
  await assert.rejects(adapter.execute({type:'APPROVE_REPORT'}),/Unsupported synthetic action/);
  assert.equal(adapter.actions().some(a=>a.type==='APPROVE_REPORT'),false);
});
