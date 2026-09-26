import test from 'node:test';
import assert from 'node:assert/strict';
import { finalReviewPreview, finalReviewDecisions, proposalFindingId } from '../src/final-review.mjs';
import { digest } from '@atlas/manual-service/contract';
import { workspace } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';
import { parseDefectWorkspace } from '../../atlas-manual-workspace/src/defect-actions.mjs';
import { encodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { SPEEDSTER_RULE_VERSION } from '@atlas/grading-core/contracts';

const sides=['FRONT','BACK'],quad=[{x:.04,y:.03},{x:.96,y:.03},{x:.96,y:.97},{x:.04,y:.97}];
function fixture(){
  const defects=structuredClone(workspace()),geometry={sides:Object.fromEntries(sides.map(side=>{
    const frame=defects.sides[side].frame;
    return [side,{image:{version:frame.imageVersion,originalSha256:frame.originalSha256},physical:{actor:'ENGINE',proposal:{ambiguous:false}},
      prepared:{frame:{id:frame.frameId,version:frame.preparationVersion,inspection:{sha256:frame.inspectionImageSha256},rectified:{sha256:frame.rectifiedImageSha256}}},
      printed:side==='FRONT'?{quad,actor:'ENGINE'}:null,confirmation:null}];
  }))};
  const original={version:'atlas-machine-provisional-report-v1',authority:'MACHINE_PROPOSAL',certification:null,
    identity:{},ruleVersion:SPEEDSTER_RULE_VERSION,finalGradePolicy:'atlas-final-half-point-v1',grade:null,proposedGrade:null,
    calculationState:'GEOMETRY_UNRESOLVED',unresolvedGeometry:[{side:'BACK',code:'PRINTED_GEOMETRY_UNRESOLVED'}],
    findings:sides.flatMap(side=>defects.sides[side].findings),geometryReview:{machine:true},limitations:['Original missing border warning'],measurementReceipts:[{receipt:'original-frame-only'}]};
  return {card:{revision:4,contentHash:'c'.repeat(64)},state:{geometry,defects,identity:{playerName:'Synthetic final review'},finalReview:{report:original,reportHash:digest(JSON.stringify(original))}}};
}
test('prepared final review without a printed border returns exact partial evidence, not an endless pending result',()=>{
  const f=fixture(),before=structuredClone(f.state),preview=finalReviewPreview(f.card,f.state);
  assert.equal(preview.state,'READY');assert.equal(preview.report.calculationState,'GEOMETRY_UNRESOLVED');assert.equal(preview.explanation,null);
  assert.equal(preview.report.grade,null);assert.equal(preview.report.proposedGrade,null);assert.equal(preview.report.geometry.BACK.centeringQuad,null);
  assert.deepEqual(preview.report.findings,f.state.finalReview.report.findings);assert.deepEqual(preview.report.unresolvedGeometry,[{side:'BACK',code:'PRINTED_GEOMETRY_UNRESOLVED'}]);
  assert.equal(preview.reportHash,digest(JSON.stringify(preview.report)));assert.deepEqual(f.state,before);
  assert.equal(preview.report.authority,'HUMAN_REVIEW_DRAFT');assert.equal(preview.report.certification,null);
});
test('saved printed correction refreshes numbers and current warnings while preserving original machine receipts and authority',()=>{
  const f=fixture();f.state.finalReview.report.analysisLimitations=['Capture glare may obscure damage.'];
  const original=structuredClone(f.state.finalReview),partial=finalReviewPreview(f.card,f.state);
  f.state.geometry.sides.BACK.printed={quad,actor:'HUMAN'};
  f.state.defects.sides.FRONT.measurement={base:{frameId:'prepared-FRONT'},receipt:{version:'current-cpu-receipt'}};
  const complete=finalReviewPreview({...f.card,revision:5,contentHash:'d'.repeat(64)},f.state);
  assert.equal(complete.report.calculationState,'COMPLETE');assert.ok(Number.isFinite(complete.report.proposedGrade));assert.ok(complete.explanation);
  assert.deepEqual(complete.report.unresolvedGeometry,[]);assert.deepEqual(complete.report.limitations,['Capture glare may obscure damage.']);
  assert.equal(complete.report.geometryReview.sides.BACK.printedActor,'HUMAN');assert.equal(complete.report.geometryReview.sides.BACK.confirmed,false);
  assert.deepEqual(complete.report.originalMachineEvidence.measurementReceipts,original.report.measurementReceipts);
  assert.equal(complete.report.measurementReceipts.length,1);assert.equal(complete.report.measurementReceipts[0].receipt.version,'current-cpu-receipt');
  assert.notEqual(complete.reportHash,partial.reportHash);assert.deepEqual(f.state.finalReview,original);
});
test('physical preparation, measurement, and frame mismatch withhold stale numbers and evidence',()=>{
  for(const change of [f=>{f.state.geometry.sides.FRONT.prepared=null;},f=>{f.state.defects.sides.FRONT.pending={action:{type:'REMEASURE'}};},
    f=>{f.state.defects.sides.FRONT.frame.rectifiedImageSha256='a'.repeat(64);},f=>{f.state.defects.sides.FRONT.frame.frameId='wrong-frame';}]){
    const f=fixture();change(f);const result=finalReviewPreview(f.card,f.state);assert.equal(result.state,'PENDING');assert.equal(result.report,undefined);
  }
});
test('explicit findings confirmation records removal as rejection without altering original proposal or creating a new finding',()=>{
  const f=fixture(),proposal={id:'original-proposal',side:'FRONT'},finding=f.state.defects.sides.FRONT.findings[0];
  finding.id=proposalFindingId(proposal.id);
  const original=structuredClone(finding);finding.reviewResult='REMOVED';finding.reviewResultBeforeRemoval='UNREVIEWED';
  const finalReview={report:{analysisId:'machine-analysis',findings:[original],geometry:{FRONT:{frame:structuredClone(f.state.defects.sides.FRONT.frame)}}},proposals:[proposal]};
  const before=structuredClone(finalReview),result=finalReviewDecisions({finalReview,defects:f.state.defects,principal:{id:'human-reviewer'}});
  assert.equal(result.reviews.length,1);assert.equal(result.reviews[0].action,'REJECT');assert.equal(result.reviews[0].findingId,finding.id);
  assert.equal(result.reviews[0].reviewerId,'human-reviewer');assert.deepEqual(finalReview,before);
});
test('confirmation accepts a validated trace above the compact document limit and still detects pixel, type and frame changes',()=>{
  const f=fixture(),proposal={id:'complex-original',side:'FRONT'},pixels=new Uint8Array(1270*1778);
  for(let y=100;y<1700;y++)for(let x=100;x<1200;x+=10)pixels[y*1270+x]=1;
  const finalTrace=encodeSpeedsterTraceRleV1(pixels);
  assert.ok(Buffer.byteLength(JSON.stringify(finalTrace))>262144);
  const {detectorMask,zone,canonicalContour,measurement,...common}=f.state.defects.sides.FRONT.findings[0];
  const original={...common,id:proposalFindingId(proposal.id),finalTrace,
    measurementRegions:[{zone,canonicalContour,measurement}],traceProvenance:{version:'speedster-trace-provenance-v1',
      sourceViewId:common.sourceViewId,cropTransform:{version:'speedster-canonical-crop-affine-v1',crop:{x:0,y:0,width:1269,height:1777}},
      highlighterStrokes:[],finalTraceSha256:finalTrace.sha256}};
  const finalReview={report:{analysisId:'machine-analysis',findings:[original],
    geometry:{FRONT:{frame:structuredClone(f.state.defects.sides.FRONT.frame)}}},proposals:[proposal]};
  f.state.defects.sides.FRONT.findings=[{...original,reviewResult:'ACCEPTED'}];
  const decide=defects=>finalReviewDecisions({finalReview,defects:parseDefectWorkspace(defects),principal:{id:'human-reviewer'}}).reviews[0];
  assert.equal(decide(f.state.defects).action,'ACCEPT');
  pixels[100*1270+101]=1;
  const correctedTrace=encodeSpeedsterTraceRleV1(pixels);
  for(const mutate of [value=>{const finding=value.sides.FRONT.findings[0];finding.finalTrace=correctedTrace;
    finding.traceProvenance={...finding.traceProvenance,finalTraceSha256:correctedTrace.sha256};},
    value=>{value.sides.FRONT.findings[0].defectType='FRAYING';},
    value=>{value.sides.FRONT.frame.frameId='corrected-frame';value.sides.FRONT.frame.preparationVersion++;}]){
    const corrected=structuredClone(f.state.defects);mutate(corrected);assert.equal(decide(corrected).action,'TRACE_SAVE');
  }
  const removed=structuredClone(f.state.defects),finding=removed.sides.FRONT.findings[0];
  finding.reviewResultBeforeRemoval=finding.reviewResult;finding.reviewResult='REMOVED';
  assert.equal(decide(removed).action,'REJECT');assert.equal(original.finalTrace.sha256,finalTrace.sha256);
});
