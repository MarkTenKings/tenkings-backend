import test from 'node:test';
import assert from 'node:assert/strict';
import { approveRapidStage, rapidReviewStatus, approveRapidGeometrySide, confirmRapidGeometryPair, approveRapidFinding } from '../src/rapid-review.mjs';
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
test('rapid status and navigation do not approve; explicit stages use current saved bases and never approve the report',async()=>{
 const f=fixture();assert.deepEqual(rapidReviewStatus(f.view),{geometry:true,findings:false,unresolved:0});assert.equal(f.actions.length,0);
 await assert.rejects(approveRapidStage('findings',f.view,f.execute));assert.equal(f.actions.length,0);
 await approveRapidStage('geometry',f.view,f.execute);assert.equal(rapidReviewStatus(f.view).findings,true);
 await approveRapidStage('findings',f.view,f.execute);
 assert.deepEqual(f.actions.map(a=>a.type),['CONFIRM_GEOMETRY','INSPECT_SIDE','INSPECT_SIDE','CONFIRM_FINDINGS']);
 assert.equal(f.actions[3].base.FRONT.findingRevision,f.actions[1].base.findingRevision);assert.equal(f.actions[3].base.FRONT.reviewRevision,f.actions[1].base.reviewRevision+1);assert.ok(f.view.defects.confirmation);
 const count=f.actions.length;await approveRapidStage('findings',f.view,f.execute);assert.equal(f.actions.length,count);
});

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

test('last explicit finding approval confirms findings in the same sequence without a checkbox or report approval',async()=>{
 const f=fixture();await approveRapidStage('geometry',f.view,f.execute);f.actions=[];
 const first=f.view.defects.sides.FRONT.findings[0].id,second=f.view.defects.sides.BACK.findings[0].id;
 let result=await approveRapidFinding(f.view,first,f.execute);assert.equal(result.nextFindingId,second);assert.equal(result.complete,false);
 result=await approveRapidFinding(f.view,second,f.execute);assert.equal(result.complete,true);assert.ok(result.view.defects.confirmation);
 assert.deepEqual(f.actions.map(a=>a.type),['REVIEW_FINDING','REVIEW_FINDING','INSPECT_SIDE','INSPECT_SIDE','CONFIRM_FINDINGS']);
});
test('unmeasurable observations prevent bulk confirmation and a failed side save stops the sequence',async()=>{
 const f=fixture();await approveRapidStage('geometry',f.view,f.execute);
 f.view.finalReview={report:{analysisId:'original',unmeasurableProposals:[{id:'missing'}]}};
 assert.equal(rapidReviewStatus(f.view).unresolved,1);await assert.rejects(approveRapidStage('findings',f.view,f.execute));assert.equal(f.actions.length,1);
 f.view.assistance={reviews:[{analysisId:'original',proposalId:'missing'}]};let calls=0;
 await assert.rejects(approveRapidStage('findings',f.view,async action=>{calls++;if(calls===2)throw Error('connection lost');return f.execute(action);}));
 assert.equal(calls,2);assert.equal(f.view.defects.confirmation,null);assert.equal(f.actions.at(-1).side,'FRONT');
 await approveRapidStage('findings',f.view,f.execute);assert.ok(f.view.defects.confirmation);
});

test('one bulk gesture confirms both sides, keeps a rejection and a corrected type, and resumes a failed save without duplicate side review',async()=>{
  const f=fixture();await approveRapidStage('geometry',f.view,f.execute);f.actions=[];
  const defects=structuredClone(f.view.defects);
  defects.sides.FRONT.findings[0].defectType='VISIBLE_WHITENING';defects.sides.BACK.findings[0].reviewResultBeforeRemoval=defects.sides.BACK.findings[0].reviewResult;defects.sides.BACK.findings[0].reviewResult='REMOVED';
  f.view={...f.view,defects};let fail=true;
  await assert.rejects(approveRapidStage('findings',f.view,async action=>{if(action.type==='CONFIRM_FINDINGS'&&fail){fail=false;throw Error('reply unavailable');}return f.execute(action);}));
  assert.deepEqual(f.actions.map(action=>action.type),['INSPECT_SIDE','INSPECT_SIDE']);assert.equal(f.view.defects.confirmation,null);
  await approveRapidStage('findings',f.view,f.execute);
  assert.deepEqual(f.actions.map(action=>action.type),['INSPECT_SIDE','INSPECT_SIDE','CONFIRM_FINDINGS']);
  assert.equal(f.view.defects.sides.FRONT.findings[0].defectType,'VISIBLE_WHITENING');assert.equal(f.view.defects.sides.BACK.findings[0].reviewResult,'REMOVED');
  assert.ok(f.view.defects.confirmation);assert.equal(f.actions.some(action=>action.type==='APPROVE_REPORT'),false);
});

test('confirmed findings still submit a fresh exact proposal roster after a genuine identity recheck',async()=>{
  const f=fixture();await approveRapidStage('geometry',f.view,f.execute);await approveRapidStage('findings',f.view,f.execute);f.actions=[];
  const proposal={id:'fresh-proposal',side:'BACK',reviewStatus:'UNREVIEWED',canonicalContour:[{x:.2,y:.2},{x:.3,y:.2},{x:.3,y:.3}]};
  f.view={...f.view,astra:{enabled:true,status:'READY',analysisId:'fresh-analysis',base:Object.fromEntries(['FRONT','BACK'].map(side=>[side,defectBase(f.view.defects,side)])),proposals:[proposal],proposalReview:{analysisId:'fresh-analysis',resultHash:'f'.repeat(64),proposalIds:[proposal.id]}}};
  const offered=structuredClone(f.view.astra.proposalReview);assert.ok(f.view.defects.confirmation);assert.equal(rapidReviewStatus(f.view).findings,true);
  await approveRapidStage('findings',f.view,f.execute);
  assert.deepEqual(f.actions.map(action=>action.type),['CONFIRM_FINDINGS']);assert.deepEqual(f.actions[0].proposalReview,offered);
});

test('zero findings still require an explicit both-side confirmation',async()=>{
  const f=fixture();f.view.defects=workspace(false);await approveRapidStage('geometry',f.view,f.execute);f.actions=[];
  assert.equal(f.view.defects.confirmation,null);assert.equal(rapidReviewStatus(f.view).findings,true);assert.equal(f.actions.length,0);
  await approveRapidStage('findings',f.view,f.execute);assert.deepEqual(f.actions.map(action=>action.type),['INSPECT_SIDE','INSPECT_SIDE','CONFIRM_FINDINGS']);
});
