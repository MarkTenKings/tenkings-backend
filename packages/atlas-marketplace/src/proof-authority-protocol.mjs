import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {parseProofDecoderEngineJSON} from './proof-decoder-engine-json.mjs';

// Closed, UNVERIFIED data only. No request, reviewer, publisher or decoder
// capability can be constructed by this module, including from a SQL reply.
export const PROOF_AUTHORITY_BYTES=16384;
export const PROOF_AUTHORITY_ROLES=decoderFreeze({
  REQUEST:['claim_stage_v1(jsonb)','lookup_stage_v1(uuid, text)','lookup_claim_v1(uuid, text)','begin_logout_v1(jsonb)'],
  SETTLER:['settle_stage_v1(jsonb)','lookup_stage_v1(uuid, text)','lookup_claim_v1(uuid, text)','read_drain_v1(uuid)'],
  REVOKER:['begin_mutation_v1(jsonb)','apply_mutation_v1(uuid, text)','read_drain_v1(uuid)'],
});
const check=(v,c='PROOF_AUTHORITY_PROTOCOL_INVALID')=>requireValue(v,c);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)&&!['constructor','prototype'].includes(v);
const text=v=>typeof v==='string'&&v.length>0&&v.length<=500&&v.trim()===v;
const decimal=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const exact=(o,k)=>decoderExact(o,k);
function data(value){const v=Buffer.isBuffer(value)?parseProofDecoderEngineJSON(value,{maxBytes:PROOF_AUTHORITY_BYTES}):decoderContractData(value);check(Buffer.byteLength(canonicalJSON(v))<=PROOF_AUTHORITY_BYTES);return v;}
function config(v){exact(v,['mode','origin','deploymentId','releaseSha','configHash']);check(['LOCAL_FIXTURE','PRODUCTION'].includes(v.mode)&&text(v.deploymentId)&&typeof v.origin==='string'&&v.origin.length<=500&&typeof v.releaseSha==='string'&&/^[a-f0-9]{40}$/.test(v.releaseSha)&&sha(v.configHash));let u;try{u=new URL(v.origin);}catch{check(false);}check(u.origin===v.origin&&['http:','https:'].includes(u.protocol)&&(v.mode!=='PRODUCTION'||u.protocol==='https:'));}
const common=['uploadId','proofId','orderId','orderHash','originalRequestHash','intakeBindingHash','originalSha256','originalByteCount'];
const stages={
  DECODE:[...common,'validationAttemptId','decoderRequestId','declaredType','originalBootId','deadlineBootNs','preparedReportHash'],
  PUBLISH:[...common,'publicationOperationId','validationAttemptId','decoderRequestId','objectKey','manifestHash','decoderCompletionHash','publicationIntentHash'],
  RETAIN:[...common,'operationId','objectKey','manifestHash','validationAttemptId','decoderRequestId','publicationLedgerId','publicationSessionId','publicationOperationId','publicationRevision','publicationEvidenceHash','qualificationSessionId','expectedUploadHash'],
};
function stageInput(stage,v){
  exact(v,stages[stage]);
  for(const key of ['uploadId','proofId','orderId'])check(identifier(v[key]));
  check(positive(v.originalByteCount)&&v.originalByteCount<=10485760);
  for(const key of stages[stage].filter(k=>k.endsWith('Hash')||k.endsWith('Sha256')||k==='objectKey'))check(sha(v[key]));
  for(const key of stages[stage].filter(k=>k.endsWith('Id')&&!['uploadId','proofId','orderId','originalBootId'].includes(k)))check(uuid(v[key]));
  if(stage==='DECODE')check(typeof v.originalBootId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.originalBootId)&&decimal(v.deadlineBootNs)&&['image/png','image/jpeg'].includes(v.declaredType));
  if(stage==='RETAIN')check(positive(v.publicationRevision));
}
const changes={
  STAFF_IDENTITY_ACCESS:['role','revoked','certificationUntil','trustedLearningUntil'],
  CUSTOMER_ACCOUNT_ACCESS:['revoked','phoneHash'],
  STAFF_CONTROL_CHANGE:['enabled','mode','origin','deploymentId','releaseSha','configHash','gradingPolicyHash'],
  CUSTOMER_CONTROL_CHANGE:['enabled','mode','origin','deploymentId','releaseSha','configHash'],
  CUSTOMER_SERVICE_CONTROL_CHANGE:['enabled','bindingHash','identificationEnabled'],
  PROOF_CONTROL_CHANGE:['enabled','replacementInstallationId'],
  PROOF_REVIEWER_REVOKE:['revoke'],PUBLISHER_SESSION_REVOKE:['revoke'],
};
function change(kind,v){exact(v,changes[kind]);for(const [k,x] of Object.entries(v)){
  if(['enabled','revoked','identificationEnabled'].includes(k))check(typeof x==='boolean');
  else if(k==='revoke')check(x===true);
  else if(k==='role')check(['REVIEWER','OBSERVER'].includes(x));
  else if(['certificationUntil','trustedLearningUntil'].includes(k))check(x===null||positive(x));
  else if(k==='replacementInstallationId')check(uuid(x));
  else if(k==='gradingPolicyHash')check(x===null||sha(x));
  else if(k.endsWith('Hash'))check(sha(x));
  else if(k==='mode')check(['LOCAL_FIXTURE','PRODUCTION'].includes(x));
  else if(k==='releaseSha')check(typeof x==='string'&&/^[a-f0-9]{40}$/.test(x));
  else check(text(x));
}if(kind.endsWith('CONTROL_CHANGE')&&Object.hasOwn(v,'origin'))config({mode:v.mode,origin:v.origin,deploymentId:v.deploymentId,releaseSha:v.releaseSha,configHash:v.configHash});}

export function parseProofAuthorityRequest(action,input){
  check(typeof action==='string');const v=data(input);
  if(action==='claim_stage_v1'){
    exact(v,['schema','installationId','requestId','requestBindingHash','source','sessionHash','browserHash','configBinding','originalRequestDeadlineAt','stageId','stage','priorStageId','stageInput']);
    check(v.schema==='atlas-proof-stage-claim-v1'&&uuid(v.installationId)&&uuid(v.requestId)&&sha(v.requestBindingHash)&&['STAFF','CUSTOMER'].includes(v.source)&&sha(v.sessionHash)&&sha(v.browserHash)&&positive(v.originalRequestDeadlineAt)&&uuid(v.stageId)&&Object.hasOwn(stages,v.stage));config(v.configBinding);stageInput(v.stage,v.stageInput);
    check(v.stage==='DECODE'?v.priorStageId===null:uuid(v.priorStageId));
  }else if(['lookup_stage_v1','lookup_claim_v1','apply_mutation_v1'].includes(action)){
    const id=action==='apply_mutation_v1'?'mutationId':'stageId',digest=action==='lookup_claim_v1'?'claimHash':action==='apply_mutation_v1'?'mutationHash':'operationHash';exact(v,[id,digest]);check(uuid(v[id])&&sha(v[digest]));
  }else if(action==='read_drain_v1'){exact(v,['mutationId']);check(uuid(v.mutationId));
  }else if(action==='begin_logout_v1'){
    exact(v,['schema','requestId','requestBindingHash','source','sessionHash','browserHash','configBinding','mutationId']);check(v.schema==='atlas-proof-logout-begin-v1'&&uuid(v.requestId)&&uuid(v.mutationId)&&sha(v.requestBindingHash)&&['STAFF','CUSTOMER'].includes(v.source)&&sha(v.sessionHash)&&sha(v.browserHash));config(v.configBinding);
  }else if(action==='begin_mutation_v1'){
    exact(v,['schema','mutationId','kind','subjectId','expectedBeforeHash','change','operatorAuthorityRef']);check(v.schema==='atlas-proof-mutation-begin-v1'&&uuid(v.mutationId)&&typeof v.kind==='string'&&Object.hasOwn(changes,v.kind)&&identifier(v.subjectId)&&sha(v.expectedBeforeHash)&&sha(v.operatorAuthorityRef));change(v.kind,v.change);
  }else if(action==='settle_stage_v1'){
    exact(v,['schema','installationId','stageId','operationHash','settlementId','disposition','outcomeHash','publisherBarrierId','publisherBarrierRevision']);check(v.schema==='atlas-proof-stage-settle-v1'&&uuid(v.installationId)&&uuid(v.stageId)&&sha(v.operationHash)&&uuid(v.settlementId)&&['COMPLETE','NO_EFFECT','UNKNOWN_HELD'].includes(v.disposition)&&sha(v.outcomeHash));check(v.publisherBarrierId===null?v.publisherBarrierRevision===null:uuid(v.publisherBarrierId)&&positive(v.publisherBarrierRevision));
  }else check(false);
  return decoderFreeze(v);
}
export function proofAuthorityRequestHash(action,input){return hash(parseProofAuthorityRequest(action,input));}

// This tranche accepts only truthful unavailable/absence observations. Positive
// runtime reports need the missing canonical producer and a reviewed parser
// extension; even a correctly shaped positive JSON reply is refused today.
export function parseProofAuthorityReply(input){
  const v=data(input);exact(v,['schema','classification','authority','status','reason','requestHash']);
  check(v.schema==='atlas-proof-authority-observation-v1'&&v.classification==='UNQUALIFIED'&&v.authority===false&&['UNAVAILABLE','ABSENT_HOLD'].includes(v.status)&&['CANONICAL_JOIN_REQUIRED','NO_ORIGINAL_RECORD'].includes(v.reason)&&(v.requestHash===null||sha(v.requestHash)));
  check(v.status==='UNAVAILABLE'?v.reason==='CANONICAL_JOIN_REQUIRED':v.reason==='NO_ORIGINAL_RECORD');
  return decoderFreeze(v);
}
