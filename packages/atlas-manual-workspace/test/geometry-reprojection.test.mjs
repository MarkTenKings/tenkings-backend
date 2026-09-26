import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeometryWorkspace, applyGeometryEdit, applyPreparedFrame, geometryBase, preparationBase } from '../src/geometry-actions.mjs';
import { createDefectWorkspace, adoptDefectProposals, defectBase, defectStatus, markDefectSideInspected,
  runDefectMeasurement, applyDefectMeasurement, discardPendingDefectEdit, parseDefectWorkspace } from '../src/defect-actions.mjs';
import { beginDefectEdit } from '../src/defect-actions.mjs';
import { beginReprojectDefectFrame } from '../src/geometry-reprojection.mjs';
import { encodeSpeedsterTraceRleV1, decodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';

const WIDTH = 1270, HEIGHT = 1778, SIDES = ['FRONT', 'BACK'];
const sha = c => c.repeat(64);
function prepare(geometry, side, { scale = 1, x = 200, y = 200, skew = 0 } = {}) {
  // Independent known inverse mapping canonical (u,v) -> working pixels:
  // (x+u/scale, y+v/scale)/(1+skew*u). Its inverse is used by preparation.
  const project = (u,v) => ({ x: (x+u/scale)/(1+skew*u), y: (y+v/scale)/(1+skew*u) });
  const quad = [[0,0],[1269,0],[1269,1777],[0,1777]].map(([u,v]) => { const p=project(u,v); return {x:p.x/4000,y:p.y/5000}; });
  geometry = applyGeometryEdit(geometry, { side, kind: 'PHYSICAL', base: geometryBase(geometry, side, 'PHYSICAL'),
    quad, actor: 'HUMAN', proposal: null }).state;
  const version = geometry.sides[side].preparationRevision+1;
  // Inverse of [1/s,0,x, 0,1/s,y, k,0,1], homogeneous scale irrelevant.
  const a=1/scale, k=skew;
  const matrix = [a, k*x*0, -a*x, y*k, a-x*k, -a*y, -a*k, 0, a*a].map(value=>value===0?0:value);
  const frame = { id: `${side}-prepared-${version}`, version, sourceToRectified: matrix,
    rectified: { sha256: sha(version===1?'c':'e'), width:WIDTH,height:HEIGHT },
    inspection: { sha256:sha(version===1?'d':'f'),width:1350,height:1858,cardBounds:{x:40,y:40,width:WIDTH,height:HEIGHT} } };
  return applyPreparedFrame(geometry, {side,base:preparationBase(geometry,side),frame}).state;
}
function frame(slot) {return {imageVersion:slot.image.version,originalSha256:slot.image.originalSha256,
  preparationVersion:slot.prepared.frame.version,frameId:slot.prepared.frame.id,
  rectifiedImageSha256:slot.prepared.frame.rectified.sha256,inspectionImageSha256:slot.prepared.frame.inspection.sha256};}
function mask(rectangles = [[500,600,30,40]]) {
  const pixels = new Uint8Array(WIDTH*HEIGHT);
  for (const [x,y,w,h,value=1] of rectangles) for (let row=y;row<y+h;row++) pixels.fill(value,row*WIDTH+x,row*WIDTH+x+w);
  return pixels;
}
function fixture(rectangles, change = {}) {
  let previousGeometry = createGeometryWorkspace({cardId:'reprojection-fixture',profile:'SPORTS',sides:Object.fromEntries(SIDES.map(side=>[side,{
    image:{version:1,originalSha256:sha('a'),frameId:`${side}-working`,frameSha256:sha('b'),width:4000,height:5000,coordinateSpace:'ORIENTED_DECODED'},
    cornerShape:'SQUARE',matColor:'BLACK'}]))});
  for (const side of SIDES) previousGeometry=prepare(previousGeometry,side);
  const geometry=prepare(previousGeometry,'FRONT',change);
  let workspace=createDefectWorkspace({cardId:previousGeometry.cardId,profile:previousGeometry.profile,sides:Object.fromEntries(SIDES.map(side=>[side,{
    frame:frame(previousGeometry.sides[side]),cornerShape:'SQUARE'}]))});
  const finalTrace=encodeSpeedsterTraceRleV1(mask(rectangles));
  const finding={id:'FRONT:fixture',side:'FRONT',defectType:'VISIBLE_WHITENING',reviewResult:'UNREVIEWED',origin:'DETECTOR',
    confidence:.83,sourceViewId:'FRONT:inspection',supportingViewIds:['FRONT:detail'],finalTrace,measurementRegions:[],
    traceProvenance:{version:'speedster-trace-provenance-v1',sourceViewId:'FRONT:inspection',
      cropTransform:{version:'speedster-canonical-crop-affine-v1',crop:{x:480,y:580,width:120,height:150}},
      highlighterStrokes:[{canonicalPoints:[{x:505,y:605},{x:510,y:610}],strokeWidthMm:.2}],finalTraceSha256:finalTrace.sha256}};
  workspace=adoptDefectProposals(workspace,{side:'FRONT',base:defectBase(workspace,'FRONT'),findings:[finding],source:{method:'DETECTOR',version:'fixture',id:'original-analysis'}}).state;
  for(const side of SIDES)workspace=markDefectSideInspected(workspace,{side,base:defectBase(workspace,side),actor:'HUMAN',inspected:true}).state;
  return {workspace,side:'FRONT',previousGeometry,geometry};
}

test('identity and translation preserve exact holes, disconnected components, source history and Back', () => {
  const rectangles=[[500,600,30,40],[510,610,8,12,0],[800,900,2,2]];
  for (const shift of [0,10]) {
    const input=fixture(rectangles,{x:200+shift}), before=structuredClone(input);
    const pending=beginReprojectDefectFrame(input), source=input.workspace.sides.FRONT.findings[0], next=pending.sides.FRONT.findings[0];
    assert.deepEqual(decodeSpeedsterTraceRleV1(next.finalTrace),mask(rectangles.map(([x,...other])=>[x-shift,...other])));
    for(const field of ['id','defectType','origin','confidence','reviewResult','sourceViewId','supportingViewIds'])assert.deepEqual(next[field],source[field]);
    assert.deepEqual(next.geometryReprojections[0].sourceTraceProvenance,source.traceProvenance);
    assert.equal(next.geometryReprojections[0].sourceTraceSha256,source.finalTrace.sha256);
    assert.deepEqual(next.geometryReprojections[0].sourceImage,input.previousGeometry.sides.FRONT.image);
    assert.deepEqual(next.traceProvenance.highlighterStrokes,[]);
    assert.deepEqual(next.measurementRegions,[]);
    assert.deepEqual(pending.sides.BACK,input.workspace.sides.BACK);
    assert.equal(pending.sides.FRONT.inspection,null);assert.equal(pending.sides.FRONT.measurement,null);
    assert.equal(defectStatus(pending).canConfirm,false);assert.equal(defectStatus(pending).sides.FRONT.settled,false);
    assert.equal(pending.confirmation,null);assert.deepEqual(input,before);
  }
});

test('perspective reprojects the actual mask through source pixels rather than reusing canonical coordinates', () => {
  const input=fixture([[500,600,30,40]],{skew:.00005});
  const output=decodeSpeedsterTraceRleV1(beginReprojectDefectFrame(input).sides.FRONT.findings[0].finalTrace);
  // Independently apply the known new-canonical -> working -> old-canonical mapping.
  for(let y=600;y<710;y++)for(let x=490;x<580;x++){
    const oldX=Math.round((200+x)/(1+.00005*x)-200),oldY=Math.round((200+y)/(1+.00005*x)-200);
    assert.equal(output[y*WIDTH+x],oldX>=500&&oldX<530&&oldY>=600&&oldY<640?1:0);
  }
});

test('out-of-frame source pixels and disappearing isolated components are explicit holds with no mutations', () => {
  for (const [input,reason] of [[fixture([[2,500,20,20]],{x:210}),'TRACE_OUTSIDE_CORRECTED_CARD'],
    [fixture([[501,601,1,1],[600,600,40,40]],{scale:.5}),'TRACE_COMPONENT_LOST']]) {
    const before=structuredClone(input);
    assert.throws(()=>beginReprojectDefectFrame(input),error=>error.code==='ATLAS_DEFECT_GEOMETRY_REVIEW_REQUIRED'
      && error.details.reason===reason && error.details.findingIds[0]==='FRONT:fixture');
    assert.deepEqual(input,before);
  }
});

test('source replacements, stale preparation and malformed retained matrices never authorize reprojection', () => {
  const input=fixture();
  assert.throws(()=>beginReprojectDefectFrame({...input,geometry:input.previousGeometry}),/STALE/);
  for(const mutate of [value=>{value.workspace.sides.FRONT.frame.preparationVersion=2;},
    value=>{value.geometry.sides.FRONT.image.frameSha256=sha('9');},
    value=>{value.previousGeometry.sides.FRONT.prepared.frame.sourceToRectified[2]+=1;},
    value=>{value.geometry.cardId='different-card';}]){
    const bad=structuredClone(input);mutate(bad);assert.throws(()=>beginReprojectDefectFrame(bad));
  }
});

test('CPU remeasurement is required; failed results and discard cannot settle transformed traces', async () => {
  const input=fixture(undefined,{scale:1.02}),pending=beginReprojectDefectFrame(input);
  assert.throws(()=>markDefectSideInspected(pending,{side:'FRONT',base:defectBase(pending,'FRONT'),actor:'HUMAN',inspected:true}),/MEASUREMENT_PENDING/);
  assert.throws(()=>discardPendingDefectEdit(pending,{side:'FRONT',base:defectBase(pending,'FRONT'),actor:'HUMAN'}),/GEOMETRY_REVIEW_REQUIRED/);
  await assert.rejects(runDefectMeasurement(pending,'FRONT',async()=>{throw Error('CPU unavailable');}),/CPU unavailable/);
  await assert.rejects(runDefectMeasurement(pending,'FRONT',async()=>({defects:[]})),/MEASUREMENT_MISSING/);
  const result=await runDefectMeasurement(pending,'FRONT',async({findings,frame:captured})=>{
    assert.deepEqual(captured,pending.sides.FRONT.frame);return {defects:findings,receipt:{test:'binding-only'}};
  });
  const settled=applyDefectMeasurement(pending,result).state;
  assert.equal(settled.sides.FRONT.pending,null);assert.equal(settled.sides.FRONT.inspection,null);
  assert.deepEqual(settled.sides.FRONT.findings[0].geometryReprojections,pending.sides.FRONT.findings[0].geometryReprojections);
  assert.throws(()=>applyDefectMeasurement(input.workspace,result),/STALE/);
});

test('human correction and removal history survive; invalid marker cannot masquerade as ordinary remeasurement', () => {
  const input=fixture(),mutable=structuredClone(input.workspace),finding=mutable.sides.FRONT.findings[0];
  finding.reviewResult='REMOVED';finding.reviewResultBeforeRemoval='TYPE_CORRECTED';finding.defectType='FRAYING';
  mutable.sides.FRONT.humanEditedIds=[finding.id];input.workspace=parseDefectWorkspace(mutable);
  const pending=beginReprojectDefectFrame(input);
  assert.equal(pending.sides.FRONT.findings[0].reviewResult,'REMOVED');
  assert.equal(pending.sides.FRONT.findings[0].reviewResultBeforeRemoval,'TYPE_CORRECTED');
  assert.deepEqual(pending.sides.FRONT.humanEditedIds,[finding.id]);
  const bad=structuredClone(pending);bad.sides.FRONT.pending.geometryReprojection.previousFrame.originalSha256=sha('9');
  assert.throws(()=>parseDefectWorkspace(bad));
});

test('deliberately removed out-of-frame evidence remains source-bound and cannot restore stale coordinates', async () => {
  const input=fixture([[2,500,20,20]],{x:210}),mutable=structuredClone(input.workspace),finding=mutable.sides.FRONT.findings[0];
  finding.reviewResult='REMOVED';finding.reviewResultBeforeRemoval='UNREVIEWED';
  // Engine-only removal never permits discarding a trace from the current frame.
  input.workspace=parseDefectWorkspace(mutable);
  assert.throws(()=>beginReprojectDefectFrame(input),/GEOMETRY_REVIEW_REQUIRED/);
  mutable.sides.FRONT.humanEditedIds=[finding.id];input.workspace=parseDefectWorkspace(mutable);
  const before=structuredClone(input),pending=beginReprojectDefectFrame(input),retained=pending.sides.FRONT.findings[0];
  assert.equal(retained.reviewResult,'REMOVED');assert.equal(retained.finalTrace.sha256,finding.finalTrace.sha256);
  assert.deepEqual(retained.traceProvenance,finding.traceProvenance);assert.deepEqual(retained.measurementRegions,[]);
  assert.deepEqual(retained.geometryExclusion.sourceFrame,input.previousGeometry.sides.FRONT.prepared.frame);
  assert.deepEqual(retained.geometryExclusion.sourceImage,input.previousGeometry.sides.FRONT.image);
  assert.equal(retained.geometryExclusion.reason,'TRACE_OUTSIDE_CORRECTED_CARD');
  const result=await runDefectMeasurement(pending,'FRONT',async({findings})=>{
    assert.deepEqual(findings,[]);return {defects:[],receipt:{fixture:'no-included-findings'}};
  });
  const settled=applyDefectMeasurement(pending,result).state;
  assert.throws(()=>beginDefectEdit(settled,{side:'FRONT',base:defectBase(settled,'FRONT'),actor:'HUMAN',
    action:{type:'UNDO',defectIds:[finding.id]}}),/RETRACE_REQUIRED/);
  const expanded=beginReprojectDefectFrame({workspace:settled,side:'FRONT',previousGeometry:input.geometry,
    geometry:prepare(input.geometry,'FRONT',{x:200})});
  const recovered=expanded.sides.FRONT.findings[0];
  assert.equal(recovered.geometryExclusion,undefined);assert.equal(recovered.reviewResult,'REMOVED');
  assert.equal(recovered.finalTrace.sha256,finding.finalTrace.sha256);
  assert.deepEqual(recovered.geometryReprojections[0].sourceFrame,input.previousGeometry.sides.FRONT.prepared.frame);
  assert.deepEqual(input,before);
});

test('legacy exact detector masks become source traces, preserving detector classification and provenance', () => {
  const input=fixture(),mutable=structuredClone(input.workspace),finding=mutable.sides.FRONT.findings[0];
  const {finalTrace,traceProvenance,measurementRegions,...common}=finding;
  mutable.sides.FRONT.findings=[{...common,detectorMask:finalTrace,zone:'SURFACE',canonicalContour:[{x:.1,y:.1},{x:.2,y:.1},{x:.2,y:.2}],
    measurement:{pixelCount:1200,widthMm:1,heightMm:1,areaMm2:1,zonePercent:1,multiplier:1,weightedAreaMm2:1,subgradeEffect:1}}];
  input.workspace=parseDefectWorkspace(mutable);
  const next=beginReprojectDefectFrame(input).sides.FRONT.findings[0];
  assert.equal(next.finalTrace.sha256,finalTrace.sha256);assert.equal(next.detectorMask,undefined);
  assert.equal(next.geometryReprojections[0].sourceTraceProvenance,null);assert.equal(next.origin,'DETECTOR');
});

test('source-bound optical fingerprints are retained as history and invalidated for the new trace', () => {
  const input=fixture(),mutable=structuredClone(input.workspace),finding=mutable.sides.FRONT.findings[0];
  finding.featureFingerprint={fixture:'old-source-pixels'};finding.featureFingerprintTraceSha256=finding.finalTrace.sha256;
  input.workspace=parseDefectWorkspace(mutable);
  const next=beginReprojectDefectFrame(input).sides.FRONT.findings[0];
  assert.equal(next.featureFingerprint,undefined);assert.equal(next.featureFingerprintTraceSha256,undefined);
  assert.deepEqual(next.geometryReprojections[0].sourceFeatureFingerprint,finding.featureFingerprint);
});

test('a second correction extends source lineage and rejects the prior CPU result', async () => {
  const input=fixture(undefined,{x:210});
  const first=beginReprojectDefectFrame(input);
  const result=await runDefectMeasurement(first,'FRONT',async({findings})=>({defects:findings}));
  const measured=applyDefectMeasurement(first,result).state;
  const second=beginReprojectDefectFrame({workspace:measured,side:'FRONT',previousGeometry:input.geometry,
    geometry:prepare(input.geometry,'FRONT',{x:200})});
  assert.equal(second.sides.FRONT.findings[0].finalTrace.sha256,input.workspace.sides.FRONT.findings[0].finalTrace.sha256);
  const history=second.sides.FRONT.findings[0].geometryReprojections;
  assert.equal(history.length,2);assert.equal(history[1].sourceTraceSha256,history[0].targetTraceSha256);
  assert.deepEqual(history[0],first.sides.FRONT.findings[0].geometryReprojections[0]);
  assert.throws(()=>applyDefectMeasurement(second,result),/STALE/);
});

test('actual checked CPU remeasures changed geometry with preserved exact trace and deterministic physical area',
  {skip:!process.env.ATLAS_MEASUREMENT_PYTHON},async()=>{
    const {measureDefectWorkspaceEdit}=await import('../../atlas-measurement-runtime/src/index.mjs');
    const input=fixture(undefined,{scale:1.02}),pending=beginReprojectDefectFrame(input);
    const result=await measureDefectWorkspaceEdit({workspace:pending,side:'FRONT',pythonExecutable:process.env.ATLAS_MEASUREMENT_PYTHON,
      limits:{maxInputBytes:8_000_000,maxOutputBytes:8_000_000,maxFindings:128,timeoutMs:15000}});
    const settled=applyDefectMeasurement(pending,result).state,finding=settled.sides.FRONT.findings[0];
    const pixelCount=decodeSpeedsterTraceRleV1(finding.finalTrace).reduce((total,pixel)=>total+pixel,0);
    assert.notEqual(pixelCount,1200);
    assert.equal(finding.measurementRegions.reduce((total,region)=>total+region.measurement.pixelCount,0),pixelCount);
    assert.ok(Math.abs(finding.measurementRegions.reduce((total,region)=>total+region.measurement.areaMm2,0)-pixelCount*.05*.05)<1e-9);
    assert.equal(result.receipt.version,'atlas-manual-cpu-measurement-v1');
    assert.deepEqual(finding.geometryReprojections,pending.sides.FRONT.findings[0].geometryReprojections);
    assert.deepEqual(settled.sides.BACK,input.workspace.sides.BACK);
  });
