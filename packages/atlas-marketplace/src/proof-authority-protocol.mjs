import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {publicationStageBinding,publicationScope} from './proof-publication-lifecycle.mjs';
import {retentionPreparedOperation} from './proof-retention-postgres-writer.mjs';
import {parseProofDecoderEngineJSON} from './proof-decoder-engine-json.mjs';

// Closed, UNVERIFIED data only. No request, reviewer, publisher or decoder
// capability can be constructed by this module, including from a SQL reply.
export const PROOF_AUTHORITY_BYTES=16384;
export const PROOF_AUTHORITY_ROLES=decoderFreeze({
  REQUEST:['observe_access_v1(jsonb)','claim_stage_v1(jsonb)','lookup_stage_v1(uuid, text)','lookup_claim_v1(uuid, text)','begin_logout_v1(jsonb)'],
  SETTLER:['settle_stage_v1(jsonb)','lookup_stage_v1(uuid, text)','lookup_claim_v1(uuid, text)','read_drain_v1(uuid)','settle_drain_v1(jsonb)'],
  REVOKER:['authorize_mutation_v1(jsonb)','begin_mutation_v1(jsonb)','apply_mutation_v1(uuid, text)','read_drain_v1(uuid)'],
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
  if(action==='observe_access_v1'){
    if(v.schema==='atlas-proof-installation-observe-v1'){exact(v,['schema','installationId']);check(uuid(v.installationId));}
    else{exact(v,['schema','installationId','requestId','requestBindingHash','source','sessionHash','browserHash','configBinding','originalRequestDeadlineAt']);check(v.schema==='atlas-proof-access-observe-v1'&&uuid(v.installationId)&&uuid(v.requestId)&&sha(v.requestBindingHash)&&['STAFF','CUSTOMER'].includes(v.source)&&sha(v.sessionHash)&&sha(v.browserHash)&&positive(v.originalRequestDeadlineAt));config(v.configBinding);}
  }else if(action==='claim_stage_v1'){
    exact(v,['schema','installationId','requestId','requestBindingHash','source','sessionHash','browserHash','configBinding','originalRequestDeadlineAt','stageId','stage','priorStageId','stageInput']);
    check(v.schema==='atlas-proof-stage-claim-v1'&&uuid(v.installationId)&&uuid(v.requestId)&&sha(v.requestBindingHash)&&['STAFF','CUSTOMER'].includes(v.source)&&sha(v.sessionHash)&&sha(v.browserHash)&&positive(v.originalRequestDeadlineAt)&&uuid(v.stageId)&&Object.hasOwn(stages,v.stage));config(v.configBinding);stageInput(v.stage,v.stageInput);
    check(v.stage==='DECODE'?v.priorStageId===null:uuid(v.priorStageId));
  }else if(['lookup_stage_v1','lookup_claim_v1','apply_mutation_v1'].includes(action)){
    const id=action==='apply_mutation_v1'?'mutationId':'stageId',digest=action==='lookup_claim_v1'?'claimHash':action==='apply_mutation_v1'?'mutationHash':'operationHash';exact(v,[id,digest]);check(uuid(v[id])&&sha(v[digest]));
  }else if(action==='settle_drain_v1'){exact(v,['schema','mutationId','mutationHash','barrierHash']);check(v.schema==='atlas-proof-drain-settle-v1'&&uuid(v.mutationId)&&sha(v.mutationHash)&&sha(v.barrierHash));
  }else if(action==='read_drain_v1'){exact(v,['mutationId']);check(uuid(v.mutationId));
  }else if(action==='begin_logout_v1'){
    exact(v,['schema','requestId','requestBindingHash','source','sessionHash','browserHash','configBinding','mutationId']);check(v.schema==='atlas-proof-logout-begin-v1'&&uuid(v.requestId)&&uuid(v.mutationId)&&sha(v.requestBindingHash)&&['STAFF','CUSTOMER'].includes(v.source)&&sha(v.sessionHash)&&sha(v.browserHash));config(v.configBinding);
  }else if(action==='authorize_mutation_v1'){
    exact(v,['schema','requestId','requestBindingHash','source','sessionHash','browserHash','configBinding','originalRequestDeadlineAt','mutation','reason']);
    check(v.schema==='atlas-proof-operator-authorization-v1'&&uuid(v.requestId)&&sha(v.requestBindingHash)&&v.source==='STAFF'&&sha(v.sessionHash)&&sha(v.browserHash)&&positive(v.originalRequestDeadlineAt)&&text(v.reason));config(v.configBinding);
    parseProofAuthorityRequest('begin_mutation_v1',{...v.mutation,operatorAuthorityRef:'0'.repeat(64)});
    exact(v.mutation,['schema','mutationId','kind','subjectId','expectedBeforeHash','change']);
  }else if(action==='begin_mutation_v1'){
    exact(v,['schema','mutationId','kind','subjectId','expectedBeforeHash','change','operatorAuthorityRef']);check(v.schema==='atlas-proof-mutation-begin-v1'&&uuid(v.mutationId)&&typeof v.kind==='string'&&Object.hasOwn(changes,v.kind)&&identifier(v.subjectId)&&sha(v.expectedBeforeHash)&&sha(v.operatorAuthorityRef));change(v.kind,v.change);
  }else if(action==='settle_stage_v1'){
    exact(v,['schema','installationId','stageId','operationHash','settlementId','disposition','outcomeHash','publisherBarrierId','publisherBarrierRevision']);check(v.schema==='atlas-proof-stage-settle-v1'&&uuid(v.installationId)&&uuid(v.stageId)&&sha(v.operationHash)&&uuid(v.settlementId)&&['COMPLETE','NO_EFFECT','UNKNOWN_HELD'].includes(v.disposition)&&sha(v.outcomeHash));check(v.publisherBarrierId===null?v.publisherBarrierRevision===null:uuid(v.publisherBarrierId)&&positive(v.publisherBarrierRevision));
  }else check(false);
  return decoderFreeze(v);
}
export function proofAuthorityRequestHash(action,input){return hash(parseProofAuthorityRequest(action,input));}

// SQL reports remain data. Only the concrete transport can attest that a
// particular report came from its audited transaction and completed COMMIT.
export function parseProofAuthorityReply(input){
  const v=data(input);
  check(v.classification==='UNQUALIFIED'&&v.authority===false);
  if(v.schema==='atlas-proof-authority-observation-v1'){
    exact(v,['schema','classification','authority','status','reason','requestHash']);
    check(['UNAVAILABLE','ABSENT_HOLD'].includes(v.status)&&['CANONICAL_JOIN_REQUIRED','NO_ORIGINAL_RECORD'].includes(v.reason)&&(v.requestHash===null||sha(v.requestHash)));
    check(v.status==='UNAVAILABLE'?v.reason==='CANONICAL_JOIN_REQUIRED':v.reason==='NO_ORIGINAL_RECORD');
  }else if(v.schema==='atlas-proof-installation-report-v1'){
    exact(v,['schema','classification','authority','requestHash','installationId','publisherSessionId','publisherLedgerId','sessionBinding','intakeBinding','staffBinding','customerBinding','controlRevision','reviewerGrants','expiresAt','observedAt']);
    check(sha(v.requestHash)&&uuid(v.installationId)&&uuid(v.publisherSessionId)&&uuid(v.publisherLedgerId)&&positive(v.controlRevision)&&positive(v.expiresAt)&&positive(v.observedAt)&&v.expiresAt>v.observedAt&&Array.isArray(v.reviewerGrants)&&v.reviewerGrants.length<=16);
    config(v.staffBinding);config(v.customerBinding);check(v.sessionBinding.installationId===v.installationId&&v.sessionBinding.intakeBindingHash===hash(v.intakeBinding)&&v.sessionBinding.policyHash===v.intakeBinding.policyHash);
    const ids=new Set();for(const row of v.reviewerGrants){exact(row,['identityId','accessVersion','policyHash','revokedAt']);check(uuid(row.identityId)&&!ids.has(row.identityId)&&positive(row.accessVersion)&&sha(row.policyHash)&&(row.revokedAt===null||positive(row.revokedAt)));ids.add(row.identityId);}
  }else if(v.schema==='atlas-proof-access-report-v1'){
    exact(v,['schema','classification','authority','requestHash','installationId','publisherSessionId','policyHash','source','actorId','accessVersion','requestId','requestBindingHash','controlRevision','deadlineAt','observedAt']);
    check(sha(v.requestHash)&&uuid(v.installationId)&&uuid(v.publisherSessionId)&&sha(v.policyHash)&&['STAFF','CUSTOMER'].includes(v.source)&&uuid(v.actorId)&&positive(v.accessVersion)&&uuid(v.requestId)&&sha(v.requestBindingHash)&&positive(v.controlRevision)&&positive(v.deadlineAt)&&positive(v.observedAt)&&v.deadlineAt>v.observedAt&&v.deadlineAt-v.observedAt<=60000);
  }else if(v.schema==='atlas-proof-operator-report-v1'){
    exact(v,['schema','classification','authority','requestHash','mutationId','operatorAuthorityRef']);check(sha(v.requestHash)&&uuid(v.mutationId)&&sha(v.operatorAuthorityRef));
  }else if(v.schema==='atlas-proof-stage-report-v1'){
    exact(v,['schema','classification','authority','requestHash','stage','state','stageBinding','operationId','retentionOperation','intakeBinding','publisherSessionId','deadlineAt','observedAt']);
    check(sha(v.requestHash)&&Object.hasOwn(stages,v.stage)&&['OUTSTANDING','SETTLED_COMPLETE','SETTLED_NO_EFFECT','UNKNOWN_HELD'].includes(v.state)&&uuid(v.operationId)&&uuid(v.publisherSessionId)&&positive(v.deadlineAt)&&positive(v.observedAt));
    const b=v.stageBinding,session=Object.fromEntries(['installationId','qualificationSessionId','qualificationEvidenceHash','sourceClosureHash','policyHash','intakeBindingHash'].map(k=>[k,b[k]]));
    publicationStageBinding(b,session);check(hash(v.intakeBinding)===b.intakeBindingHash);
    if(v.stage==='RETAIN'){const o=retentionPreparedOperation(v.retentionOperation,v.intakeBinding);check(hash(o)===b.operationHash&&o.operationId===v.operationId&&o.retentionFenceRevision===b.stageRevision&&o.actorAccessBindingHash===b.actorAccessBindingHash&&o.publicationSessionId===v.publisherSessionId);}
    else check(v.retentionOperation===null);
  }else if(v.schema==='atlas-proof-drain-report-v1'){
    exact(v,['schema','classification','authority','requestHash','mutationId','mutationHash','state','barrierRevision','publisherSessionId','fences','outstandingStages','barrierHash']);
    check(sha(v.requestHash)&&uuid(v.mutationId)&&sha(v.mutationHash)&&['DRAINING','SETTLED','APPLIED','UNKNOWN_HELD'].includes(v.state)&&positive(v.barrierRevision)&&uuid(v.publisherSessionId)&&Array.isArray(v.fences)&&v.fences.length<=12&&Array.isArray(v.outstandingStages)&&v.outstandingStages.length<=1&&(v.barrierHash===null||sha(v.barrierHash)));
    const ids=new Set();for(const f of v.fences){publicationScope(f);check(!ids.has(f.fenceId)&&f.revision<v.barrierRevision);ids.add(f.fenceId);}
    for(const r of v.outstandingStages){const stage=parseProofAuthorityReply(r);check(stage.schema==='atlas-proof-stage-report-v1'&&stage.publisherSessionId===v.publisherSessionId&&stage.stageBinding.fences.some(f=>ids.has(f.fenceId)));}
    check(!['SETTLED','APPLIED'].includes(v.state)||v.barrierHash!==null&&v.outstandingStages.length===0);
  }else check(false);
  return decoderFreeze(v);
}
