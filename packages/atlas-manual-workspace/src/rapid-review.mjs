import { geometryBase, geometryStatus } from './geometry-actions.mjs';
import { defectBase, defectStatus } from './defect-actions.mjs';
const sides = ['FRONT', 'BACK'];
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const requireReview = (value, code='ATLAS_GEOMETRY_STALE') => { if (!value) throw {code}; };
const sameQuad = (a,b) => Array.isArray(a) && Array.isArray(b) && a.length===4 && b.length===4
  && a.every((p,i)=>Math.abs(p.x-b[i].x)<1e-12 && Math.abs(p.y-b[i].y)<1e-12);

/** One explicit side approval saves both outlines. Printed coordinates remain
 * in the source frame until physical preparation returns its NEW transform.
 * A caller-owned checkpoint resumes only acknowledged steps after a failure. */
export async function approveRapidGeometrySide(view, input, execute, sourceQuadToPrepared, checkpoint={}, refreshView=null) {
  const {side,physical,printedOriginal,printedAbsent=false}=input;
  requireReview(sides.includes(side) && typeof sourceQuadToPrepared==='function','ATLAS_GEOMETRY_HUMAN_REVIEW_REQUIRED');
  const target=JSON.stringify({side,base:input.base,physical,printedOriginal,printedAbsent});
  let current=view;
  const currentBase=()=>geometryBase(current.geometry,side,'REVIEW');
  if(checkpoint.target){
    requireReview(same(checkpoint.base,currentBase()));
    if(checkpoint.target!==target){
      requireReview(same(input.base,checkpoint.inputBase)||same(input.base,currentBase()));
      checkpoint.target=target;checkpoint.step=0;
    }
  }else {requireReview(same(input.base,currentBase()));checkpoint.target=target;checkpoint.inputBase=input.base;checkpoint.base=currentBase();checkpoint.step=0;}
  let compact=false;
  const save=async(action,intermediate=false)=>{
    const refresh=intermediate&&refreshView?'state':'view';
    try {
      current=await execute(action,{refresh});compact=refresh==='state';checkpoint.base=currentBase();
    } catch (error) {
      // A prior compact save can already be durable while the mounted editor
      // still shows its old base. Publish the saved state before returning a
      // failure; do not advance this checkpoint for an unacknowledged action.
      if (refreshView) await refreshView().catch(()=>{});
      throw error;
    }
  };
  if(checkpoint.step<1){
    if(!sameQuad(current.geometry.sides[side].physical?.quad,physical))
      await save({type:'GEOMETRY_EDIT',edit:{side,kind:'PHYSICAL',base:geometryBase(current.geometry,side,'PHYSICAL'),quad:physical}},true);
    checkpoint.step=1;
  }
  if(checkpoint.step<2){
    if(!current.geometry.sides[side].prepared)await save({type:'PREPARE_SIDE',side},true);
    requireReview(current.geometry.sides[side].prepared,'ATLAS_GEOMETRY_PREPARED_FRAME_REQUIRED');checkpoint.step=2;
  }
  if(checkpoint.step<3){
    if(printedAbsent){
      if(!current.geometry.sides[side].printedAbsence)await save({type:'MARK_PRINTED_ABSENT',side,base:geometryBase(current.geometry,side,'PRINTED')});
    }else{
      const printed=sourceQuadToPrepared(current.geometry,side,printedOriginal);
      requireReview(printed,'ATLAS_GEOMETRY_PRINTED_REQUIRED');
      if(!sameQuad(current.geometry.sides[side].printed?.quad,printed))
        await save({type:'GEOMETRY_EDIT',edit:{side,kind:'PRINTED',base:geometryBase(current.geometry,side,'PRINTED'),quad:printed}});
    }
    checkpoint.step=3;
  }
  return compact?refreshView():current;
}

/** Both side gestures name the exact geometry being confirmed. */
export async function confirmRapidGeometryPair(view, approvals, execute) {
  requireReview(sides.every(side=>same(approvals?.[side],geometryBase(view.geometry,side,'REVIEW'))),'ATLAS_GEOMETRY_HUMAN_REVIEW_REQUIRED');
  requireReview(geometryStatus(view.geometry).canConfirmBoth,'ATLAS_GEOMETRY_HUMAN_REVIEW_REQUIRED');
  if(geometryStatus(view.geometry).confirmed)return view;
  return execute({type:'CONFIRM_GEOMETRY',base:Object.fromEntries(sides.map(side=>[side,geometryBase(view.geometry,side,'REVIEW')])),reviewed:true});
}

/** Machine history does not veto the reviewer's current saved findings. */
export function rapidReviewStatus(view) {
  const geometry=geometryStatus(view.geometry);
  return {geometry:geometry.canConfirmBoth,findings:Boolean(geometry.confirmed&&view.defects&&defectStatus(view.defects).settled)};
}
export function rapidResumeStage(view) {
  if(!geometryStatus(view.geometry).confirmed)return 'geometry-review';
  return view.defects&&defectStatus(view.defects).confirmed?'report':'findings-review';
}

/** A side's explicit approval records its current inspection. After both sides,
 * the same gesture confirms the shown findings; final grade approval is separate.
 * An interrupted save resumes from the returned durable side records. */
export async function approveRapidFindingsSide(view,side,execute) {
  requireReview(sides.includes(side),'ATLAS_DEFECT_SIDE_REQUIRED');
  requireReview(rapidReviewStatus(view).findings,'ATLAS_DEFECT_MEASUREMENT_PENDING');
  let current=view;
  if(!defectStatus(current.defects).sides[side].inspected)
    current=await execute({type:'INSPECT_SIDE',side,base:defectBase(current.defects,side),inspected:true});
  const nextSide=sides.find(value=>!defectStatus(current.defects).sides[value].inspected);
  if(nextSide)return {view:current,nextSide,complete:false};
  if(!defectStatus(current.defects).confirmed)
    current=await execute({type:'CONFIRM_FINDINGS',base:Object.fromEntries(sides.map(value=>[value,defectBase(current.defects,value)])),reviewed:true});
  return {view:current,nextSide:null,complete:true};
}
