import test from 'node:test';
import assert from 'node:assert/strict';
import { approveRapidStage, rapidReviewStatus } from '../src/rapid-review.mjs';
import { createGeometryWorkspace, geometryBase, preparationBase, applyGeometryEdit, applyPreparedFrame, confirmBothGeometry } from '../src/geometry-actions.mjs';
import { markDefectSideInspected, confirmDefectFindings, defectBase } from '../src/defect-actions.mjs';
import { workspace } from './defect-fixtures.mjs';
function fixture() {
  const sides=['FRONT','BACK'],whole=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],printed=[{x:.04,y:.03},{x:.96,y:.03},{x:.96,y:.97},{x:.04,y:.97}];
  let geometry=createGeometryWorkspace({cardId:'synthetic-card',profile:'SPORTS',sides:Object.fromEntries(sides.map((side,i)=>[side,{cornerShape:'SQUARE',matColor:'BLACK',image:{version:1,originalSha256:String(i+1).repeat(64),frameId:side,frameSha256:String(i+3).repeat(64),width:1270,height:1778,coordinateSpace:'ORIENTED_DECODED'}}]))});
  for(const [i,side] of sides.entries()){
    geometry=applyGeometryEdit(geometry,{side,kind:'PHYSICAL',base:geometryBase(geometry,side,'PHYSICAL'),quad:whole,actor:'HUMAN'}).state;
    geometry=applyPreparedFrame(geometry,{side,base:preparationBase(geometry,side),frame:{id:`prepared-${side}`,version:1,rectified:{sha256:String(i+5).repeat(64),width:1270,height:1778},inspection:{sha256:String(i+7).repeat(64),width:1350,height:1858,cardBounds:{x:40,y:40,width:1270,height:1778}},sourceToRectified:[1269/1270,0,0,0,1777/1778,0,0,0,1]}}).state;
    geometry=applyGeometryEdit(geometry,{side,kind:'PRINTED',base:geometryBase(geometry,side,'PRINTED'),quad:printed,actor:'HUMAN'}).state;
  }
  const f={view:{geometry,defects:workspace(),astra:{enabled:false}},actions:[]};
  f.execute=async action=>{
    f.actions.push(action);
    if(action.type==='CONFIRM_GEOMETRY') f.view={...f.view,geometry:confirmBothGeometry(f.view.geometry,{base:action.base,actor:'HUMAN',reviewed:action.reviewed}).state};
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
test('unmeasurable observations prevent bulk confirmation and a failed side save stops the sequence',async()=>{
 const f=fixture();await approveRapidStage('geometry',f.view,f.execute);
 f.view.finalReview={report:{analysisId:'original',unmeasurableProposals:[{id:'missing'}]}};
 assert.equal(rapidReviewStatus(f.view).unresolved,1);await assert.rejects(approveRapidStage('findings',f.view,f.execute));assert.equal(f.actions.length,1);
 f.view.assistance={reviews:[{analysisId:'original',proposalId:'missing'}]};let calls=0;
 await assert.rejects(approveRapidStage('findings',f.view,async action=>{calls++;if(calls===2)throw Error('connection lost');return f.execute(action);}));
 assert.equal(calls,2);assert.equal(f.view.defects.confirmation,null);assert.equal(f.actions.at(-1).side,'FRONT');
 await approveRapidStage('findings',f.view,f.execute);assert.ok(f.view.defects.confirmation);
});
