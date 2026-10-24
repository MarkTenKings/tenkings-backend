// Bounded structural storage projection. Private broker provenance is checked
// by the concrete adapter; this module never authenticates observations.
import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {intakeProtectedInstallation,intakeProtectedRecord} from './proof-intake-protected-protocol.mjs';
import {publicationPreparedReport,publicationDecoderOutcome} from './proof-publication-lifecycle.mjs';
import {createProofValidationLifecycleContract,reduceProofValidationLifecycle} from './proof-validation-lifecycle.mjs';
const check=(v,c='INTAKE_ACCOUNTING_INVALID')=>requireValue(v,c),same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const markers={classification:'UNQUALIFIED',authority:'NOT_IMPLEMENTED'};
export function intakeAccountingInstallation(input,installation){
 const v=decoderContractData(input),c=intakeProtectedInstallation(installation);decoderExact(v,['schema','intakeInstallationHash','operationalLimit']);
 check(v.schema==='atlas-proof-intake-accounting-installed-v1'&&v.intakeInstallationHash===hash(c)&&Number.isSafeInteger(v.operationalLimit)&&v.operationalLimit>=1&&v.operationalLimit<=16);return decoderFreeze(v);
}
export function intakeAccountingInitial(created,installation,accounting){
 const c=intakeProtectedInstallation(installation),a=intakeAccountingInstallation(accounting,c),r=intakeProtectedRecord(created,c);
 check(r.operation.kind==='CREATE'&&r.upload.status==='PREPARED'&&r.upload.attempts===0,'INTAKE_ACCOUNTING_ORIGINAL');
 return createProofValidationLifecycleContract({original:{uploadId:r.upload.uploadId,objectKey:r.upload.objectKey,plan:r.upload.plan},legacy:{status:r.upload.status,attempts:r.upload.attempts,snapshotHash:r.uploadHash,manifestHash:null},operationalLimit:a.operationalLimit});
}
export function intakeAccountingEntry(input,created,installation){
 const v=decoderContractData(input),r=intakeProtectedRecord(created,installation);decoderExact(v,['schema','createOperationId','createOperationHash','prepared','action','observation']);
 const p=publicationPreparedReport(v.prepared),a=v.action;
 check(v.schema==='atlas-proof-intake-accounting-entry-v1'&&r.operation.kind==='CREATE'&&v.createOperationId===r.operation.operationId&&v.createOperationHash===r.operationHash&&same(p.plan,r.upload.plan),'INTAKE_ACCOUNTING_ORIGINAL');
 check(a.requestId===p.requestId&&a.originalHash===hash({uploadId:r.upload.uploadId,objectKey:r.upload.objectKey,plan:r.upload.plan}),'INTAKE_ACCOUNTING_ORIGINAL');
 if(a.kind==='OBSERVE_OUTCOME'){
  if(v.observation===null)check(a.outcome==='TRANSPORT_FAILURE'&&a.submissionObservation==='UNKNOWN'&&a.effectObservation==='UNKNOWN'&&a.inputObservation==='UNKNOWN');
  else{
   const o=publicationDecoderOutcome(v.observation);check(same(o.request,p),'INTAKE_ACCOUNTING_ORIGINAL');
   const expected=intakeAccountingOutcome(o);for(const key of Object.keys(expected))check(a[key]===expected[key]);
  }
 }else check(v.observation===null);
 if(a.kind==='RESERVE')check(a.at>=r.upload.createdAt&&a.at<r.upload.expiresAt&&a.leaseUntil<=r.upload.expiresAt&&a.leaseUntil<=installation.policy.expiresAt);
 return decoderFreeze(v);
}
export function intakeAccountingOutcome(input){
 const o=publicationDecoderOutcome(input);
 if(o.disposition==='COMPLETE_CLEAN')return decoderFreeze({outcome:o.completion.outcome,submissionObservation:'SUBMITTED_CLAIM',effectObservation:'CLEANUP_CLAIM',inputObservation:'COMPLETE_CLAIM'});
 if(o.disposition==='KNOWN_NO_START_SENT')return decoderFreeze({outcome:'TRANSPORT_FAILURE',submissionObservation:'NOT_SUBMITTED_CLAIM',effectObservation:'NO_EFFECT_CLAIM',inputObservation:'INCOMPLETE'});
 return decoderFreeze({outcome:'TRANSPORT_FAILURE',submissionObservation:'UNKNOWN',effectObservation:'UNKNOWN',inputObservation:'UNKNOWN'});
}
export function intakeAccountingRead(input,created,installation,accounting){
 const v=decoderContractData(input);decoderExact(v,['schema','createOperationId','createOperationHash','entries']);
 const r=intakeProtectedRecord(created,installation);check(v.schema==='atlas-proof-intake-accounting-read-v1'&&v.createOperationId===r.operation.operationId&&v.createOperationHash===r.operationHash&&Array.isArray(v.entries)&&v.entries.length<=64);
 let state=intakeAccountingInitial(r,installation,accounting);const entries=[],prepared=new Map();
 for(const raw of v.entries){
  const e=intakeAccountingEntry(raw,r,installation),a=e.action;
  if(a.kind==='RESERVE'){check(!prepared.has(a.attemptId)&&!entries.some(x=>x.prepared.requestId===e.prepared.requestId),'INTAKE_ACCOUNTING_CONFLICT');prepared.set(a.attemptId,e.prepared);}
  else check(same(prepared.get(a.attemptId),e.prepared),'INTAKE_ACCOUNTING_CONFLICT');
  const change=reduceProofValidationLifecycle({state,expectedRevision:state.revision,action:a});check(change.writeRequired,'INTAKE_ACCOUNTING_CONFLICT');state=change.next;entries.push(e);
 }
 // Hash the ordered entry digests, not the growing full read. This closed
 // domain-separated tuple stays bounded independently of 64-entry history.
 const head={schema:'atlas-proof-intake-accounting-head-v1',createOperationId:v.createOperationId,createOperationHash:v.createOperationHash,entryHashes:entries.map(e=>hash(e))};
 return decoderFreeze({...markers,read:v,state,headHash:hash(head)});
}
export function projectIntakeAccounting(input,entry,created,installation,accounting){
 const prior=intakeAccountingRead(input,created,installation,accounting),e=intakeAccountingEntry(entry,created,installation),old=prior.read.entries.find(x=>x.action.actionId===e.action.actionId||(x.action.kind===e.action.kind&&x.action.attemptId===e.action.attemptId));
 if(old){check(same(old,e),'INTAKE_ACCOUNTING_CONFLICT');return decoderFreeze({...prior,replay:true,writeRequired:false});}
 const next=intakeAccountingRead({...prior.read,entries:[...prior.read.entries,e]},created,installation,accounting);return decoderFreeze({...next,replay:false,writeRequired:true});
}
export function intakeAccountingValidation(read,operation,created,installation,accounting){
 const v=intakeAccountingRead(read,created,installation,accounting),a=v.state.accounting,entry=v.read.entries.find(e=>e.action.kind==='OBSERVE_OUTCOME'&&e.action.attemptId===operation.validationAttemptId);
 check(a.disposition==='VALIDATION_REVIEW_REQUIRED'&&a.holdReason===null&&a.activeAttemptId===null&&entry?.action.outcome==='SUCCESS'&&entry.observation?.disposition==='COMPLETE_CLEAN'&&entry.prepared.requestId===operation.decoderRequestId&&same(entry.observation.completion.validation,operation.validation)&&operation.createOperationId===created.operation.operationId&&operation.createOperationHash===created.operationHash&&operation.expectedUploadHash===created.uploadHash,'INTAKE_ACCOUNTING_VALIDATION_HOLD');return v;
}
