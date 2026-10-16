import test from 'node:test';
import assert from 'node:assert/strict';
import { rapidResumeStage, rapidReviewStatus, approveRapidGeometrySide, confirmRapidGeometryPair, approveRapidFindingsSide } from '../src/rapid-review.mjs';
import { createGeometryWorkspace, geometryBase, preparationBase, applyGeometryEdit, applyPreparedFrame, confirmBothGeometry } from '../src/geometry-actions.mjs';
import { markDefectSideInspected, confirmDefectFindings, defectBase, markDefectFindingReviewed } from '../src/defect-actions.mjs';
import { workspace } from './defect-fixtures.mjs';
function fixture() {
  const sides=['FRONT','BACK'],whole=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],printed=[{x:.04,y:.03},{x:.96,y:.03},{x:.96,y:.97},{x:.04,y:.97}];
  let geometry=createGeometryWorkspace({cardId:'synthetic-card',profile:'SPORTS',sides:Object.fromEntries(sides.map((side,i)=>[side,{cornerShape:'SQUARE',matColor:'BLACK',image:{version:1,originalSha256:String(i+1).repeat(64),frameId:side,frameSha256:String(i+3).repeat(64),width:1270,height:1778,coordinateSpace:'ORIENTED_DECODED'}}]))});
  for(const [i,side] of sides.entries()){
    geometry=applyGeometryEdit(geometry,{side,kind:'PHYSICAL',base:geometryBase(geometry,side,'PHYSICAL'),quad:whole,actor:'HUMAN'}).state;
    geometry=applyPreparedFrame(geometry,{side,base:preparationBase(geometry,side),frame:{id:`prepared-${side}`,version:1,rectified:{sha256:String(i+5).repeat(64),width:1270,height:1778},inspection:{sha256:String(i+7).repeat(64),width:1350,height:1858,cardBounds:{x:40,y:40,width:1270,height:1778}},sourceToRectified:[1269/1270,0,0,0,1777/1778,0,0,0,1]}}).state;
    geometry=applyGeometryEdit(geometry,{side,kind:'PRINTED',base:geometryBase(geometry,side,'PRINTED'),quad:printed,actor:'HUMAN'}).state;
  }
  const frames=Object.fromEntries(sides.map(side=>[side,geometry.sides[side].prepared.frame]));
  const f={view:{geometry,defects:workspace(),astra:{enabled:false}},actions:[]};
  f.execute=async action=>{
    f.actions.push(action);
    if(action.type==='GEOMETRY_EDIT')f.view={...f.view,geometry:applyGeometryEdit(f.view.geometry,{...action.edit,actor:'HUMAN'}).state};
    else if(action.type==='PREPARE_SIDE')f.view={...f.view,geometry:applyPreparedFrame(f.view.geometry,{side:action.side,base:preparationBase(f.view.geometry,action.side),frame:{...frames[action.side],id:'new-'+action.side,version:2,sourceToRectified:[1269/1270/.98,0,-.01*1269/.98,0,1777/1778/.98,-.01*1777/.98,0,0,1]}}).state};
    else if(action.type==='REVIEW_FINDING')f.view={...f.view,defects:markDefectFindingReviewed(f.view.defects,{side:action.side,base:action.base,findingId:action.findingId,actor:'HUMAN',reviewed:true,reviewerId:'reviewer',reviewedAt:'2026-09-28T12:00:00.000Z'}).state};
    else if(action.type==='CONFIRM_GEOMETRY') f.view={...f.view,geometry:confirmBothGeometry(f.view.geometry,{base:action.base,actor:'HUMAN',reviewed:action.reviewed}).state};
    else if(action.type==='INSPECT_SIDE')f.view={...f.view,defects:markDefectSideInspected(f.view.defects,{side:action.side,base:action.base,actor:'HUMAN',inspected:action.inspected}).state};
    else if(action.type==='CONFIRM_FINDINGS')f.view={...f.view,defects:confirmDefectFindings(f.view.defects,{base:action.base,actor:'HUMAN',reviewed:action.reviewed}).state};
    else throw Error('Unexpected approval or model action');
    return f.view;
  }; return f;
}

const geometryApproval=async f=>confirmRapidGeometryPair(f.view,Object.fromEntries(['FRONT','BACK'].map(side=>[side,geometryBase(f.view.geometry,side,'REVIEW')])),f.execute);
const findingsApproval=async f=>{await approveRapidFindingsSide(f.view,'FRONT',f.execute);return approveRapidFindingsSide(f.view,'BACK',f.execute);};
test('side approval prepares changed physical geometry before projecting printed source points and confirms only exact pair gestures',async()=>{
 const f=fixture(),input={side:'FRONT',base:geometryBase(f.view.geometry,'FRONT','REVIEW'),physical:[{x:.01,y:.01},{x:.99,y:.01},{x:.99,y:.99},{x:.01,y:.99}],printedOriginal:[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}]};
 const approved=await approveRapidGeometrySide(f.view,input,f.execute,(geometry,side,quad)=>{
  assert.equal(side,'FRONT');assert.equal(geometry.sides.FRONT.prepared.frame.id,'new-FRONT');assert.deepEqual(quad,input.printedOriginal);return quad;
 });
 assert.deepEqual(f.actions.map(a=>a.type),['GEOMETRY_EDIT','PREPARE_SIDE','GEOMETRY_EDIT']);
 assert.equal(f.actions[2].edit.base.prepared.frame.id,'new-FRONT');
 const approvals={FRONT:geometryBase(approved.geometry,'FRONT','REVIEW')};
 await assert.rejects(confirmRapidGeometryPair(f.view,approvals,f.execute));assert.equal(f.actions.length,3);
 approvals.BACK=geometryBase(f.view.geometry,'BACK','REVIEW');await confirmRapidGeometryPair(f.view,approvals,f.execute);
 assert.equal(f.actions.at(-1).type,'CONFIRM_GEOMETRY');assert.equal(f.actions.some(a=>a.type==='APPROVE_REPORT'),false);
});

test('failed preparation retains an exact checkpoint, retries only preparation, and refuses concurrent geometry drift',async()=>{
 const f=fixture(),checkpoint={},input={side:'FRONT',base:geometryBase(f.view.geometry,'FRONT','REVIEW'),physical:[{x:.01,y:.01},{x:.99,y:.01},{x:.99,y:.99},{x:.01,y:.99}],printedOriginal:[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}]};
 let fail=true;const execute=async action=>{if(action.type==='PREPARE_SIDE'&&fail){fail=false;throw Error('Preparation held');}return f.execute(action);};
 await assert.rejects(approveRapidGeometrySide(f.view,input,execute,(_g,_s,q)=>q,checkpoint),/Preparation held/);
 assert.deepEqual(f.actions.map(a=>a.type),['GEOMETRY_EDIT']);assert.equal(checkpoint.step,1);
 await approveRapidGeometrySide(f.view,input,execute,(_g,_s,q)=>q,checkpoint);
 assert.deepEqual(f.actions.map(a=>a.type),['GEOMETRY_EDIT','PREPARE_SIDE','GEOMETRY_EDIT']);
 const changed={...f.view,geometry:applyGeometryEdit(f.view.geometry,{side:'FRONT',kind:'PRINTED',base:geometryBase(f.view.geometry,'FRONT','PRINTED'),quad:[{x:.11,y:.11},{x:.89,y:.11},{x:.89,y:.89},{x:.11,y:.89}],actor:'HUMAN'}).state};
 await assert.rejects(approveRapidGeometrySide(changed,input,execute,(_g,_s,q)=>q,checkpoint));assert.equal(f.actions.length,3);
});


test('front then back review confirms current findings without per-finding clicks or report approval',async()=>{
 const f=fixture();assert.equal(rapidReviewStatus(f.view).findings,false);assert.equal(f.actions.length,0);
 await assert.rejects(approveRapidFindingsSide(f.view,'FRONT',f.execute));
 await geometryApproval(f);f.actions=[];
 const front=await approveRapidFindingsSide(f.view,'FRONT',f.execute);assert.equal(front.complete,false);assert.equal(front.nextSide,'BACK');assert.equal(f.view.defects.confirmation,null);
 const back=await approveRapidFindingsSide(f.view,'BACK',f.execute);assert.equal(back.complete,true);assert.ok(f.view.defects.confirmation);
 assert.deepEqual(f.actions.map(a=>a.type),['INSPECT_SIDE','INSPECT_SIDE','CONFIRM_FINDINGS']);
});
test('historical unmeasurable observations, stale or pending AI and metadata rechecks do not veto human review',async()=>{
 for(const status of ['READY','STALE','RUNNING','UNKNOWN','REFUSED']){
  const f=fixture();await geometryApproval(f);f.actions=[];
  f.view.finalReview={report:{analysisId:'old',unmeasurableProposals:[{id:'off-card'}]}};
  f.view.astra={enabled:true,status,resumeAvailable:true};
  f.view.variantVerification={confirmation:{reprocessRequired:true,recheckState:'DISPATCHED'}};
  assert.equal(rapidReviewStatus(f.view).findings,true,status);
  await findingsApproval(f);assert.ok(f.view.defects.confirmation,status);
  assert.equal(rapidResumeStage(f.view),'report');assert.equal(f.actions.some(a=>a.type==='APPROVE_REPORT'),false);
 }
});
test('zero findings still allow the same two side reviews',async()=>{
 const f=fixture();f.view.defects=workspace(false);await geometryApproval(f);f.actions=[];
 await findingsApproval(f);assert.deepEqual(f.actions.map(a=>a.type),['INSPECT_SIDE','INSPECT_SIDE','CONFIRM_FINDINGS']);
});
test('failed final confirmation resumes without duplicate side decisions',async()=>{
 const f=fixture();await geometryApproval(f);f.actions=[];await approveRapidFindingsSide(f.view,'FRONT',f.execute);
 await assert.rejects(approveRapidFindingsSide(f.view,'BACK',async a=>{if(a.type==='CONFIRM_FINDINGS')throw Error('network');return f.execute(a);}));
 assert.equal(f.view.defects.confirmation,null);assert.deepEqual(f.actions.map(a=>a.type),['INSPECT_SIDE','INSPECT_SIDE']);
 await approveRapidFindingsSide(f.view,'BACK',f.execute);assert.deepEqual(f.actions.map(a=>a.type),['INSPECT_SIDE','INSPECT_SIDE','CONFIRM_FINDINGS']);
});
test('navigation remains free to start with back, then returns the outstanding front side',async()=>{
 const f=fixture();await geometryApproval(f);const result=await approveRapidFindingsSide(f.view,'BACK',f.execute);
 assert.equal(result.nextSide,'FRONT');assert.equal(result.complete,false);
 await approveRapidFindingsSide(f.view,'FRONT',f.execute);assert.ok(f.view.defects.confirmation);
});
test('resume reads saved progress and never writes decisions',async()=>{
 const f=fixture();assert.equal(rapidResumeStage(f.view),'geometry-review');await geometryApproval(f);
 assert.equal(rapidResumeStage(f.view),'findings-review');await findingsApproval(f);const count=f.actions.length;
 assert.equal(rapidResumeStage(f.view),'report');assert.equal(f.actions.length,count);
});

test('edited geometry uses compact authoritative reads only between saves and returns a full view',async()=>{
 const f=fixture(),modes=[],input={side:'FRONT',base:geometryBase(f.view.geometry,'FRONT','REVIEW'),physical:[{x:.01,y:.01},{x:.99,y:.01},{x:.99,y:.99},{x:.01,y:.99}],printedOriginal:[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}]};
 const execute=async(action,options)=>{modes.push(options.refresh);return f.execute(action);};let boundaryReads=0;
 await approveRapidGeometrySide(f.view,input,execute,(_g,_s,q)=>q,{},async()=>{boundaryReads++;return f.view;});
 assert.deepEqual(modes,['state','state','view']);assert.equal(boundaryReads,0,'final printed save already refreshed the full view');
 assert.equal(f.actions[2].edit.base.prepared.frame.id,'new-FRONT');
});

test('failed preparation publishes acknowledged compact geometry so the retained draft can retry',async()=>{
 const f=fixture(),checkpoint={},input={side:'BACK',base:geometryBase(f.view.geometry,'BACK','REVIEW'),physical:[{x:.01,y:.01},{x:.99,y:.01},{x:.99,y:.99},{x:.01,y:.99}],printedOriginal:[{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}]};
 let mounted=f.view,fail=true,refreshes=0;
 const execute=async(action,options)=>{if(action.type==='PREPARE_SIDE'&&fail){fail=false;throw {code:'ATLAS_DEFECT_STALE'};}const next=await f.execute(action);if(options.refresh==='view')mounted=next;return next;};
 const refresh=async()=>{refreshes++;mounted=f.view;return mounted;};
 await assert.rejects(approveRapidGeometrySide(mounted,input,execute,(_g,_s,q)=>q,checkpoint,refresh),{code:'ATLAS_DEFECT_STALE'});
 assert.equal(refreshes,1);assert.deepEqual(checkpoint.base,geometryBase(mounted.geometry,'BACK','REVIEW'));
 await approveRapidGeometrySide(mounted,input,execute,(_g,_s,q)=>q,checkpoint,refresh);
 assert.deepEqual(f.actions.map(a=>a.type),['GEOMETRY_EDIT','PREPARE_SIDE','GEOMETRY_EDIT']);
});

function committedFailureFixture(failAt){
 const f=fixture(),checkpoint={},input={side:'FRONT',base:geometryBase(f.view.geometry,'FRONT','REVIEW'),physical:[{x:.01,y:.01},{x:.99,y:.01},{x:.99,y:.99},{x:.01,y:.99}],printedOriginal:[{x:.12,y:.13},{x:.88,y:.13},{x:.88,y:.87},{x:.12,y:.87}]};
 f.view={...f.view,card:{cardId:f.view.geometry.cardId,revision:1,contentHash:'saved-1'}};
 let failed=false,refreshes=0;
 const execute=async(action,options)=>{
  await f.execute(action);
  const revision=f.view.card.revision+1;f.view={...f.view,card:{...f.view.card,revision,contentHash:`saved-${revision}`}};
  if(!failed&&f.actions.length===failAt){failed=true;throw{code:'MANUAL_SAVED_REFRESH_REQUIRED',committed:true,committedRevision:revision,committedHash:f.view.card.contentHash};}
  return f.view;
 };
 const refresh=async()=>{refreshes++;return f.view;};
 return{f,input,checkpoint,execute,refresh,refreshes:()=>refreshes};
}
for(const [failAt,stage] of [[1,'physical edit'],[2,'preparation'],[3,'printed edit']])test(`known committed ${stage} with failed refresh resumes exact saved state without duplicate edits`,async()=>{
 const{f,input,checkpoint,execute,refresh,refreshes}=committedFailureFixture(failAt),printed=structuredClone(input.printedOriginal);
 await assert.rejects(approveRapidGeometrySide(f.view,input,execute,(_g,_s,q)=>q,checkpoint,refresh),{code:'MANUAL_SAVED_REFRESH_REQUIRED',committed:true});
 assert.equal(refreshes(),1);assert.equal(checkpoint.saved.revision,f.view.card.revision);
 assert.equal(checkpoint.step,failAt-1,'a committed error does not blindly advance the sequence');
 await approveRapidGeometrySide(f.view,input,execute,(_g,_s,q)=>q,checkpoint,refresh);
 assert.deepEqual(f.actions.map(a=>a.type),['GEOMETRY_EDIT','PREPARE_SIDE','GEOMETRY_EDIT']);
 assert.deepEqual(f.actions[0].edit.quad,input.physical);assert.deepEqual(f.actions[2].edit.quad,printed);
 assert.deepEqual(input.printedOriginal,printed);assert.equal(checkpoint.saved,undefined);assert.equal(checkpoint.step,3);
});
for(const drift of ['newer revision','different content','different card','older view'])test(`known-commit geometry recovery rejects ${drift} rather than rebasing the retained draft`,async()=>{
 const{f,input,checkpoint,execute,refresh}=committedFailureFixture(1);
 await assert.rejects(approveRapidGeometrySide(f.view,input,execute,(_g,_s,q)=>q,checkpoint,refresh));
 const changed=structuredClone(f.view);
 if(drift==='newer revision')changed.card.revision++;
 if(drift==='different content')changed.card.contentHash='replacement-photos-or-other-edit';
 if(drift==='different card')changed.geometry.cardId='other-card';
 if(drift==='older view')changed.card.revision--;
 await assert.rejects(approveRapidGeometrySide(changed,input,execute,(_g,_s,q)=>q,checkpoint,refresh),{code:'ATLAS_GEOMETRY_STALE'});
 assert.equal(f.actions.length,1);assert.ok(checkpoint.saved);assert.equal(checkpoint.step,0);
});
test('an unknown geometry save does not authorize checkpoint rebasing from a changed view',async()=>{
 const{f,input,checkpoint,execute,refresh}=committedFailureFixture(1);
 const unknown=async(...args)=>{try{return await execute(...args);}catch{throw{code:'NETWORK_FAILED'};}};
 await assert.rejects(approveRapidGeometrySide(f.view,input,unknown,(_g,_s,q)=>q,checkpoint,refresh),{code:'NETWORK_FAILED'});
 assert.equal(checkpoint.saved,undefined);
 await assert.rejects(approveRapidGeometrySide(f.view,input,execute,(_g,_s,q)=>q,checkpoint,refresh),{code:'ATLAS_GEOMETRY_STALE'});
 assert.equal(f.actions.length,1);
});
