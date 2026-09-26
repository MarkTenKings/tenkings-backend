import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createManualWorkflow } from '../src/workflow.mjs';
import { digest, stateDocument } from '../../atlas-manual-service/src/contract.mjs';
import { createGeometryWorkspace, applyGeometryEdit, applyPreparedFrame, geometryBase, preparationBase } from '../../atlas-manual-workspace/src/geometry-actions.mjs';
import { runDefectMeasurement, parseDefectWorkspace, defectBase } from '../../atlas-manual-workspace/src/defect-actions.mjs';
import { workspace as defectsFixture } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';
import { decodeSpeedsterTraceRleV1, encodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';

const clone = value => structuredClone(value), sha = digit => digit.repeat(64), sides = ['FRONT','BACK'];
const quad = [{x:.125,y:.1},{x:.875,y:.1},{x:.875,y:.9},{x:.125,y:.9}];
function prepared(geometry, side) {
  const slot=geometry.sides[side],version=slot.preparationRevision+1,q=slot.physical.quad;
  const x=q[0].x*1600,y=q[0].y*2400,sx=1269/((q[1].x-q[0].x)*1600),sy=1777/((q[3].y-q[0].y)*2400);
  const index=sides.indexOf(side);
  return applyPreparedFrame(geometry,{side,base:preparationBase(geometry,side),frame:{
    id:version===1?`prepared-${side}`:`corrected-${side}-${version}`,version,sourceToRectified:[sx,0,-x*sx,0,sy,-y*sy,0,0,1],
    rectified:{sha256:sha(version===1?String(index+5):'c'),width:1270,height:1778},
    inspection:{sha256:sha(version===1?String(index+3):'d'),width:1350,height:1858,cardBounds:{x:40,y:40,width:1270,height:1778}},
  }}).state;
}
async function setup({native=false,edge=false}={}) {
  let defects=defectsFixture();const objects=new Map(),receipts=new Map();let card;
  if(edge){
    const mutable=clone(defects),pixels=new Uint8Array(1270*1778);
    for(let y=600;y<605;y++)pixels.fill(1,y*1270+1260,y*1270+1265);
    const finalTrace=encodeSpeedsterTraceRleV1(pixels),original=mutable.sides.FRONT.findings[0];
    const {detectorMask,zone,canonicalContour,measurement,...retained}=original;
    mutable.sides.FRONT.findings.push({...retained,id:'FRONT:outside-corrected-card',finalTrace,measurementRegions:[],
      traceProvenance:{version:'speedster-trace-provenance-v1',sourceViewId:original.sourceViewId,
        cropTransform:{version:'speedster-canonical-crop-affine-v1',crop:{x:0,y:0,width:1269,height:1777}},
        highlighterStrokes:[],finalTraceSha256:finalTrace.sha256}});
    defects=parseDefectWorkspace(mutable);
  }
  const store=async value=>{const sourceHash=digest(JSON.stringify(value)),ref={id:sourceHash};objects.set(ref.id,clone(value));return {ref,sourceHash};};
  const artifacts={async write(value){return (await store(value)).ref;},async read(ref){return clone(objects.get(ref.id));}};
  let geometry=createGeometryWorkspace({cardId:defects.cardId,profile:defects.profile,sides:Object.fromEntries(sides.map((side,index)=>[side,{
    image:{version:1,originalSha256:sha(String(index+1)),frameId:`working-${side}`,frameSha256:sha('a'),width:1600,height:2400,coordinateSpace:'ORIENTED_DECODED'},
    cornerShape:'SQUARE',matColor:'BLACK'}]))});
  for(const side of sides){geometry=applyGeometryEdit(geometry,{side,kind:'PHYSICAL',base:geometryBase(geometry,side,'PHYSICAL'),quad,actor:'HUMAN',proposal:null}).state;geometry=prepared(geometry,side);}
  const draft={version:'atlas-manual-workflow-v2',source:{sourceHash:sha('b')},geometry:await store(geometry),defects:await store(defects),identity:{},identityRevision:1};
  if(edge){const report={cardId:defects.cardId,sourceHash:sha('b'),findings:sides.flatMap(side=>defects.sides[side].findings)};
    draft.finalReview=await store({version:'atlas-final-review-v1',report,reportHash:digest(JSON.stringify(report))});}
  card={cardId:defects.cardId,revision:1,contentHash:stateDocument(draft).hash,draft};
  const counts={prepares:0,measurements:0,commits:0,failMeasurement:false};
  const repository={async load(){return {card:clone(card),principal:{id:'reviewer',actorKind:'HUMAN',canCertify:true}};},
    async findAction(_staff,_id,input){return receipts.get(input.actionId)??null;},
    async commit(_staff,input){assert.equal(input.input.expectedRevision,card.revision);assert.equal(input.baseHash,card.contentHash);
      const saved=stateDocument(input.draft);card={...card,revision:card.revision+1,contentHash:saved.hash,draft:saved.draft};counts.commits++;
      const result={card:clone(card)};receipts.set(input.input.actionId,result);return result;}};
  const workflow=createManualWorkflow({repository,artifacts,prepare:async({geometry,side})=>{counts.prepares++;return prepared(geometry,side);},
    pythonExecutable:process.env.ATLAS_MEASUREMENT_PYTHON,
    measurementLimits:{maxInputBytes:8_000_000,maxOutputBytes:8_000_000,maxFindings:128,timeoutMs:15000},
    measure:async args=>{counts.measurements++;if(counts.failMeasurement)throw Error('Synthetic CPU unavailable');
      if(native){const {measureDefectWorkspaceEdit}=await import('../../atlas-measurement-runtime/src/index.mjs');return measureDefectWorkspaceEdit(args);}
      return runDefectMeasurement(args.workspace,args.side,async({findings})=>({defects:findings,receipt:{test:'state-binding-only'}}));}});
  const command=action=>({actionId:randomUUID(),expectedRevision:card.revision,action});
  const execute=input=>workflow.service.execute({},card.cardId,input);
  const shrink=1.02;
  const edit=()=>command({type:'GEOMETRY_EDIT',edit:{side:'FRONT',kind:'PHYSICAL',base:geometryBase(geometry,'FRONT','PHYSICAL'),
    quad:[quad[0],{x:.125+.75/shrink,y:.1},{x:.125+.75/shrink,y:.1+.8/shrink},{x:.125,y:.1+.8/shrink}]}});
  return {counts,command,execute,edit,card:()=>clone(card),state:()=>workflow.hydrate(card),artifact:ref=>clone(objects.get(ref.id))};
}

test('physical correction retains the source artifact and commits reprojection only after successful measurement',async()=>{
  const f=await setup(),original=f.card(),before=await f.state();
  await f.execute(f.edit());const edited=f.card();
  assert.deepEqual(edited.draft.geometryBeforeEdit.FRONT,original.draft.geometry);
  assert.equal((await f.state()).geometry.sides.FRONT.prepared,null);
  assert.deepEqual((await f.state()).defects,before.defects);
  f.counts.failMeasurement=true;
  await assert.rejects(f.execute(f.command({type:'PREPARE_SIDE',side:'FRONT'})),/Synthetic CPU unavailable/);
  assert.deepEqual(f.card(),edited);assert.equal(f.counts.commits,1);
  f.counts.failMeasurement=false;
  const prepare=f.command({type:'PREPARE_SIDE',side:'FRONT'});await f.execute(prepare);
  const after=await f.state();
  assert.equal(f.card().draft.geometryBeforeEdit,undefined);assert.equal(after.defects.sides.FRONT.pending,null);
  assert.equal(after.defects.sides.FRONT.findings.length,before.defects.sides.FRONT.findings.length);
  assert.deepEqual(after.defects.sides.BACK,before.defects.sides.BACK);
  assert.equal(after.defects.sides.FRONT.findings[0].id,before.defects.sides.FRONT.findings[0].id);
  assert.equal(after.defects.sides.FRONT.findings[0].geometryReprojections.length,1);
  await f.execute(prepare);assert.equal(f.counts.commits,2);assert.equal(f.counts.prepares,2);
});

test('restore, reject false positive and retry a narrower outline retains every finding and its proper source frame',async()=>{
  const f=await setup({edge:true}),original=f.card(),before=await f.state();
  await f.execute(f.edit());const held=f.card();
  await assert.rejects(f.execute(f.command({type:'PREPARE_SIDE',side:'FRONT'})),/GEOMETRY_REVIEW_REQUIRED/);
  assert.deepEqual(f.card(),held);assert.deepEqual((await f.state()).defects,before.defects);
  await f.execute(f.command({type:'RESTORE_GEOMETRY',side:'FRONT'}));
  let state=await f.state();assert.deepEqual(state.geometry.sides.FRONT.prepared,before.geometry.sides.FRONT.prepared);
  assert.equal(f.card().draft.geometryBeforeEdit,undefined);
  await f.execute(f.command({type:'DEFECT_EDIT',side:'FRONT',base:defectBase(state.defects,'FRONT'),
    edit:{type:'REMOVE',defectIds:['FRONT:outside-corrected-card']}}));
  await f.execute(f.command({type:'MEASURE_SIDE',side:'FRONT'}));
  state=await f.state();
  await f.execute(f.command({type:'GEOMETRY_EDIT',edit:{side:'FRONT',kind:'PHYSICAL',base:geometryBase(state.geometry,'FRONT','PHYSICAL'),
    quad:[quad[0],{x:.125+.75/1.02,y:.1},{x:.125+.75/1.02,y:.1+.8/1.02},{x:.125,y:.1+.8/1.02}]}}));
  await f.execute(f.command({type:'PREPARE_SIDE',side:'FRONT'}));
  const after=await f.state(),retained=after.defects.sides.FRONT.findings.find(finding=>finding.id==='FRONT:outside-corrected-card');
  assert.deepEqual(after.defects.sides.FRONT.findings.map(f=>f.id).sort(),before.defects.sides.FRONT.findings.map(f=>f.id).sort());
  assert.equal(retained.reviewResult,'REMOVED');assert.equal(retained.reviewResultBeforeRemoval,'UNREVIEWED');
  assert.deepEqual(retained.finalTrace,before.defects.sides.FRONT.findings[1].finalTrace);
  assert.deepEqual(retained.geometryExclusion.sourceFrame,before.geometry.sides.FRONT.prepared.frame);
  assert.deepEqual(retained.measurementRegions,[]);assert.equal(after.defects.sides.FRONT.pending,null);
  assert.equal(after.defects.sides.FRONT.findings.find(f=>f.id===before.defects.sides.FRONT.findings[0].id).geometryReprojections.length,1);
  assert.deepEqual(after.defects.sides.BACK,before.defects.sides.BACK);
  assert.deepEqual(f.artifact(original.draft.defects.ref),before.defects);
  assert.equal(after.defects.confirmation,null);assert.equal(after.geometry.sides.FRONT.confirmation,null);
  await assert.rejects(f.execute(f.command({type:'DEFECT_EDIT',side:'FRONT',base:defectBase(after.defects,'FRONT'),
    edit:{type:'UNDO',defectIds:[retained.id]}})),/RETRACE_REQUIRED/);
});

test('native workflow correction automatically remeasures the preserved trace against corrected physical dimensions',
  {skip:!process.env.ATLAS_MEASUREMENT_PYTHON},async()=>{
    const f=await setup({native:true}),before=await f.state();await f.execute(f.edit());
    await f.execute(f.command({type:'PREPARE_SIDE',side:'FRONT'}));
    const after=await f.state(),finding=after.defects.sides.FRONT.findings[0];
    const expected=decodeSpeedsterTraceRleV1(finding.finalTrace).reduce((sum,pixel)=>sum+pixel,0);
    // A 1.02 scale can legitimately preserve the pixel count under nearest-
    // neighbor sampling. The changed hash proves the trace moved; exact CPU
    // area/count must agree with the resulting mask, not an assumed area delta.
    assert.notEqual(finding.finalTrace.sha256,before.defects.sides.FRONT.findings[0].detectorMask.sha256);
    assert.equal(finding.measurementRegions.reduce((sum,region)=>sum+region.measurement.pixelCount,0),expected);
    assert.ok(Math.abs(finding.measurementRegions.reduce((sum,region)=>sum+region.measurement.areaMm2,0)-expected*.0025)<1e-9);
    assert.equal(after.defects.sides.FRONT.measurement.receipt.version,'atlas-manual-cpu-measurement-v1');
    assert.deepEqual(after.defects.sides.BACK,before.defects.sides.BACK);
    assert.equal(finding.reviewResult,'UNREVIEWED');assert.equal(finding.origin,'DETECTOR');
  });
