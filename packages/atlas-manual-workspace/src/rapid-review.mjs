import { geometryBase, geometryStatus } from './geometry-actions.mjs';
import { defectBase, defectStatus, reviewedDefectFindingIds } from './defect-actions.mjs';
import { collectiveProposalReview } from './astra-review-ui.mjs';
const sides = ['FRONT', 'BACK'];
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const requireReview = (value, code='ATLAS_GEOMETRY_STALE') => { if (!value) throw {code}; };
const sameQuad = (a,b) => Array.isArray(a) && Array.isArray(b) && a.length===4 && b.length===4
  && a.every((p,i)=>Math.abs(p.x-b[i].x)<1e-12 && Math.abs(p.y-b[i].y)<1e-12);

/** One explicit side approval saves both outlines. Printed coordinates remain
 * in the source frame until physical preparation returns its NEW transform.
 * A caller-owned checkpoint resumes only acknowledged steps after a failure. */
export async function approveRapidGeometrySide(view, input, execute, sourceQuadToPrepared, checkpoint={}) {
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
  const save=async action=>{current=await execute(action);checkpoint.base=currentBase();};
  if(checkpoint.step<1){
    if(!sameQuad(current.geometry.sides[side].physical?.quad,physical))
      await save({type:'GEOMETRY_EDIT',edit:{side,kind:'PHYSICAL',base:geometryBase(current.geometry,side,'PHYSICAL'),quad:physical}});
    checkpoint.step=1;
  }
  if(checkpoint.step<2){
    if(!current.geometry.sides[side].prepared)await save({type:'PREPARE_SIDE',side});
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
  return current;
}

/** Both side gestures must still name the exact geometry being confirmed. */
export async function confirmRapidGeometryPair(view, approvals, execute) {
  requireReview(sides.every(side=>same(approvals?.[side],geometryBase(view.geometry,side,'REVIEW'))),'ATLAS_GEOMETRY_HUMAN_REVIEW_REQUIRED');
  return approveRapidStage('geometry',view,execute);
}

/** The final finding's explicit Approve also saves the side attestations and
 * findings confirmation; it never approves/publishes the final report. */
export async function approveRapidFinding(view, findingId, execute) {
  requireReview(geometryStatus(view.geometry).confirmed && view.defects && defectStatus(view.defects).settled,'ATLAS_DEFECT_CONFIRMATION_REQUIRED');
  let current=view;
  const findings=()=>sides.flatMap(side=>current.defects.sides[side].findings.filter(f=>f.reviewResult!=='REMOVED').map(f=>({...f,side})));
  if(findingId){
    const finding=findings().find(f=>f.id===findingId);requireReview(finding,'ATLAS_DEFECT_FINDING_REQUIRED');
    if(!reviewedDefectFindingIds(current.defects,finding.side).includes(finding.id))
      current=await execute({type:'REVIEW_FINDING',side:finding.side,base:defectBase(current.defects,finding.side),findingId,reviewed:true});
  }
  const next=findings().find(f=>!reviewedDefectFindingIds(current.defects,f.side).includes(f.id));
  if(next)return {view:current,nextFindingId:next.id,complete:false};
  current=await approveRapidStage('findings',current,execute);
  return {view:current,nextFindingId:null,complete:true};
}
export function rapidReviewStatus(view) {
  const geometry = geometryStatus(view.geometry);
  const unresolved = (view.finalReview?.report.unmeasurableProposals ?? []).filter(proposal =>
    !view.assistance?.reviews?.some(review => review.analysisId === view.finalReview.report.analysisId && review.proposalId === proposal.id));
  const proposals = view.defects ? collectiveProposalReview(view.defects, view.astra) : null;
  return { geometry: geometry.canConfirmBoth, findings: Boolean(geometry.confirmed && view.defects && defectStatus(view.defects).settled && proposals?.ready && !unresolved.length), unresolved: unresolved.length };
}
// Only an explicit Approve gesture calls this function. Navigation never does.
// Every sequential save uses the returned current revision, including recovery.
export async function approveRapidStage(stage, view, execute) {
  const status = rapidReviewStatus(view);
  if (stage === 'geometry') {
    if (!status.geometry) throw { code: 'ATLAS_GEOMETRY_HUMAN_REVIEW_REQUIRED' };
    if (geometryStatus(view.geometry).confirmed) return view;
    return execute({ type: 'CONFIRM_GEOMETRY', base: Object.fromEntries(sides.map(side => [side, geometryBase(view.geometry, side, 'REVIEW')])), reviewed: true });
  }
  if (stage !== 'findings' || !status.findings) throw { code: 'ATLAS_DEFECT_CONFIRMATION_REQUIRED' };
  const current = await inspectBothDefectSides(view, execute);
  if (!rapidReviewStatus(current).findings) throw { code: 'ATLAS_DEFECT_CONFIRMATION_REQUIRED' };
  if (defectStatus(current.defects).confirmed) return current;
  const { proposalReview } = collectiveProposalReview(current.defects, current.astra);
  return execute({ type: 'CONFIRM_FINDINGS', base: Object.fromEntries(sides.map(side => [side, defectBase(current.defects, side)])), reviewed: true, ...(proposalReview ? { proposalReview } : {}) });
}

/** One explicit human attestation, two durable side records, current bases throughout. */
export async function inspectBothDefectSides(view, execute) {
  let current = view;
  if (!current.defects || !defectStatus(current.defects).settled) throw {code:'ATLAS_DEFECT_MEASUREMENT_PENDING'};
  for (const side of sides) {
    if (!defectStatus(current.defects).sides[side].inspected)
      current = await execute({type:'INSPECT_SIDE',side,base:defectBase(current.defects,side),inspected:true});
  }
  return current;
}
