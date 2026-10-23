import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {assertProofDecoderPlan,assertProofDecoderValidation} from './proof-decoder-protocol.mjs';

// Internal data rules, not authority, authentication or a receipt brand. The
// concrete owned store uses these same rules for writes and historical reads.
export const PUBLICATION_LIFECYCLE_LIMITS=Object.freeze({sessions:1024,publicationsPerSession:128,objects:32768,operations:65536,events:262144,databaseBytes:268435456,originalBytes:17179869184,recordBytes:32768,fences:12,reserveEvents:64,reserveOperations:2});
export const lifecycleCheck=(value,code='PUBLICATION_LIFECYCLE_INVALID')=>requireValue(value,code);
export const lifecycleUUID=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export const lifecycleDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const check=lifecycleCheck,uuid=lifecycleUUID,digest=lifecycleDigest,L=PUBLICATION_LIFECYCLE_LIMITS;
const integer=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const positive=(v,max)=>integer(v,max)&&v>0;
const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=9223372036854775807n;
const boot=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const kinds=['SESSION_OPEN','SESSION_DRAIN','SESSION_CLOSE','PUBLICATION','SCOPE_BARRIER','SCOPE_SETTLE','EXTERNAL_HOLD','DECODE_DISPATCH','DECODE_SETTLE','DECODE_UNKNOWN'];
export const PUBLICATION_DRAIN_REASONS=Object.freeze(['OPERATOR_REVOKED','SERVICE_STOP','ADMISSION_REVOKED']);
export function publicationData(input,keys){const v=decoderContractData(input);decoderExact(v,keys);check(Buffer.byteLength(canonicalJSON(v))<=L.recordBytes);if(keys.includes('expectedRevision'))check(integer(v.expectedRevision,L.events-1));if(keys.includes('operationId'))check(uuid(v.operationId));return v;}
export function publicationSessionBinding(input){const v=publicationData(input,['installationId','qualificationSessionId','qualificationEvidenceHash','sourceClosureHash','policyHash','intakeBindingHash']);check(uuid(v.installationId)&&uuid(v.qualificationSessionId));for(const k of ['qualificationEvidenceHash','sourceClosureHash','policyHash','intakeBindingHash'])check(digest(v[k]));return decoderFreeze(v);}
export function publicationScope(input){const v=publicationData(input,['fenceId','sourceKind','sourceKeyHash','sourceGenerationHash','ordinal','revision']);check(uuid(v.fenceId)&&['STAFF','CUSTOMER','SESSION','BROWSER','ACCESS','CONTROL','POLICY','INSTALLATION','REQUEST','ORDER','UPLOAD','PUBLISHER'].includes(v.sourceKind)&&digest(v.sourceKeyHash)&&digest(v.sourceGenerationHash)&&positive(v.ordinal,Number.MAX_SAFE_INTEGER)&&positive(v.revision,Number.MAX_SAFE_INTEGER));return decoderFreeze(v);}
export const publicationScopeKey=input=>{const scope=publicationScope(input);return hash({sourceKind:scope.sourceKind,sourceKeyHash:scope.sourceKeyHash,sourceGenerationHash:scope.sourceGenerationHash});};
export function publicationStageBinding(input,binding){
  const v=publicationData(input,['stageId','stageRevision','requestId','requestBindingHash','actorAccessBindingHash','operationHash','installationId','qualificationSessionId','qualificationEvidenceHash','sourceClosureHash','policyHash','intakeBindingHash','bootId','deadlineBootNs','fences']);
  check(uuid(v.stageId)&&uuid(v.requestId)&&positive(v.stageRevision,Number.MAX_SAFE_INTEGER)&&boot(v.bootId)&&decimal(v.deadlineBootNs)&&BigInt(v.deadlineBootNs)>0n);
  for(const k of ['requestBindingHash','actorAccessBindingHash','operationHash'])check(digest(v[k]));
  const b=publicationSessionBinding(Object.fromEntries(Object.keys(publicationSessionBinding(binding)).map(k=>[k,v[k]])));check(same(b,binding),'PUBLICATION_SESSION_BINDING_MISMATCH');
  check(Array.isArray(v.fences)&&v.fences.length>0&&v.fences.length<=L.fences);
  let previous='';const sources=new Set();for(const item of v.fences){const scope=publicationScope(item),source=hash({sourceKind:scope.sourceKind,sourceKeyHash:scope.sourceKeyHash});check(scope.fenceId>previous&&!sources.has(source));previous=scope.fenceId;sources.add(source);}
  return decoderFreeze(v);
}
export function publicationStageLive(input,clock){const stage=decoderContractData(input),{bootId,nowNs}=engineDataOptions(clock,['bootId','nowNs']);check(typeof nowNs==='bigint'&&nowNs>=0n&&boot(bootId)&&decimal(stage.deadlineBootNs));check(stage.bootId===bootId&&BigInt(stage.deadlineBootNs)>nowNs&&BigInt(stage.deadlineBootNs)-nowNs<=15000000000n,'PUBLICATION_STAGE_EXPIRED');}
export function publicationLifecycleState(input){
  const v=publicationData(input,['revision','latestSessionId','lastCloseHash','sessionCount','operationCount','objectCount','originalBytes','heldOperationId','externalHoldCount','unsettledBarrierCount']);
  check(integer(v.revision,L.events-1)&&(v.latestSessionId===null||uuid(v.latestSessionId))&&digest(v.lastCloseHash)&&integer(v.sessionCount,L.sessions)&&integer(v.operationCount,L.operations)&&integer(v.objectCount,L.objects)&&integer(v.originalBytes,L.originalBytes)&&(v.heldOperationId===null||uuid(v.heldOperationId))&&integer(v.externalHoldCount,L.operations)&&integer(v.unsettledBarrierCount,L.operations));return decoderFreeze(v);
}
export function publicationCapacity(state,{newSession=false,newObjectBytes=0,maintenance=false,pendingDispatches=0}={}){
  publicationLifecycleState(state);check(typeof newSession==='boolean'&&typeof maintenance==='boolean'&&integer(newObjectBytes,10485760)&&integer(pendingDispatches,1));
  check(state.operationCount<L.operations-(maintenance?0:L.reserveOperations+state.unsettledBarrierCount+pendingDispatches)&&state.revision+3<L.events-(maintenance?0:L.reserveEvents+state.unsettledBarrierCount),'PUBLICATION_STORE_FULL');
  if(newSession)check(state.sessionCount<L.sessions,'PUBLICATION_STORE_FULL');
  if(newObjectBytes)check(state.objectCount<L.objects&&state.originalBytes+newObjectBytes<=L.originalBytes,'PUBLICATION_STORE_FULL');
}
export function publicationSession(input){
  const v=publicationData(input,['sessionId','binding','previousSessionId','previousCloseHash','phase','reason','openedRevision','revision','publicationCount','byteCount','closeHash']);
  check(uuid(v.sessionId)&&(v.previousSessionId===null||uuid(v.previousSessionId))&&digest(v.previousCloseHash)&&['ACTIVE','DRAINING','CLOSED'].includes(v.phase)&&positive(v.openedRevision,L.events-1)&&integer(v.revision,L.events-1)&&v.revision>=v.openedRevision&&integer(v.publicationCount,L.publicationsPerSession)&&integer(v.byteCount,L.originalBytes));publicationSessionBinding(v.binding);
  check(v.phase==='ACTIVE'?v.reason===null:PUBLICATION_DRAIN_REASONS.includes(v.reason));check(v.phase==='CLOSED'?digest(v.closeHash):v.closeHash===null);
  if(v.phase==='CLOSED')check(v.closeHash===hash({...v,closeHash:null}),'PUBLICATION_CLOSE_MISMATCH');return decoderFreeze(v);
}
export function reducePublicationSession(input,action,revision){
  const current=publicationSession(input),a=decoderContractData(action);check(positive(revision,L.events-1)&&revision>current.revision);let next={...current,revision};
  if(a.kind==='DRAIN'){decoderExact(a,['kind','reason']);check(current.phase==='ACTIVE'&&PUBLICATION_DRAIN_REASONS.includes(a.reason),'PUBLICATION_SESSION_HELD');next={...next,phase:'DRAINING',reason:a.reason};}
  else if(a.kind==='COMPLETE'){decoderExact(a,['kind','byteCount']);check(current.phase==='ACTIVE'&&current.publicationCount<L.publicationsPerSession&&positive(a.byteCount,10485760),'PUBLICATION_SESSION_HELD');next={...next,publicationCount:current.publicationCount+1,byteCount:current.byteCount+a.byteCount};}
  else if(a.kind==='CLOSE'){decoderExact(a,['kind']);check(current.phase==='DRAINING','PUBLICATION_SESSION_HELD');next={...next,phase:'CLOSED'};next.closeHash=hash(next);}
  else check(false);
  return publicationSession(next);
}
export function publicationRequest(input){const v=publicationData(input,['objectKey','manifestHash','byteCount','sha256']);check(digest(v.objectKey)&&digest(v.manifestHash)&&positive(v.byteCount,10485760)&&digest(v.sha256));return decoderFreeze(v);}
export function publicationOperation(input){
  const v=publicationData(input,['operationId','kind','request','phase','intentRevision','completedRevision','revision']);check(uuid(v.operationId)&&kinds.includes(v.kind)&&['INTENT','COMPLETED','UNKNOWN'].includes(v.phase)&&positive(v.intentRevision,L.events-1)&&integer(v.revision,L.events-1)&&v.revision>=v.intentRevision&&(v.completedRevision===null||integer(v.completedRevision,L.events-1)&&v.completedRevision>=v.intentRevision&&v.completedRevision<=v.revision));check((v.phase==='COMPLETED')===(v.completedRevision!==null));
  const r=v.request;
  if(v.kind==='SESSION_OPEN'){decoderExact(r,['previousSessionId','previousCloseHash','binding','sessionId']);check((r.previousSessionId===null||uuid(r.previousSessionId))&&uuid(r.sessionId)&&digest(r.previousCloseHash));publicationSessionBinding(r.binding);}
  else if(v.kind==='PUBLICATION'){decoderExact(r,['sessionId','binding','stageBinding','original']);check(uuid(r.sessionId));publicationStageBinding(r.stageBinding,publicationSessionBinding(r.binding));publicationRequest(r.original);}
  else if(v.kind==='SESSION_DRAIN'){decoderExact(r,['sessionId','reason']);check(uuid(r.sessionId)&&PUBLICATION_DRAIN_REASONS.includes(r.reason));}
  else if(v.kind==='SESSION_CLOSE'){decoderExact(r,['sessionId']);check(uuid(r.sessionId));}
  else if(v.kind==='SCOPE_BARRIER'){decoderExact(r,['sessionId','canonicalMutationId','barrierId','barrierRevision','scope']);check(uuid(r.sessionId)&&uuid(r.canonicalMutationId)&&uuid(r.barrierId)&&positive(r.barrierRevision,Number.MAX_SAFE_INTEGER));publicationScope(r.scope);check(r.barrierRevision>r.scope.revision);}
  else if(v.kind==='SCOPE_SETTLE'){decoderExact(r,['barrierId']);check(uuid(r.barrierId));}
  else if(v.kind==='DECODE_DISPATCH'){decoderExact(r,['identityHash','identity']);publicationDecoderIdentity(r.identity);check(digest(r.identityHash)&&r.identityHash===hash(r.identity));}
  else if(['DECODE_SETTLE','DECODE_UNKNOWN'].includes(v.kind)){decoderExact(r,['dispatchOperationId','identityHash','outcomeHash']);check(uuid(r.dispatchOperationId)&&digest(r.identityHash)&&digest(r.outcomeHash));}
  else {decoderExact(r,['sessionId','kind','identityHash']);check(uuid(r.sessionId)&&['DECODE','RETAIN'].includes(r.kind)&&digest(r.identityHash));}
  check(v.kind==='PUBLICATION'||v.phase==='COMPLETED');
  return decoderFreeze(v);
}
export function publicationBarrier(input){const v=publicationData(input,['barrierId','sessionId','canonicalMutationId','barrierRevision','scope','phase','recordedRevision','revision']);check(uuid(v.barrierId)&&uuid(v.sessionId)&&uuid(v.canonicalMutationId)&&positive(v.barrierRevision,Number.MAX_SAFE_INTEGER)&&['DRAINING','LOCAL_QUIESCENT'].includes(v.phase)&&positive(v.recordedRevision,L.events-1)&&integer(v.revision,L.events-1)&&v.revision>=v.recordedRevision);publicationScope(v.scope);check(v.barrierRevision>v.scope.revision);return decoderFreeze(v);}
export function publicationHold(input){const v=publicationData(input,['operationId','sessionId','kind','identityHash','revision']);check(uuid(v.operationId)&&uuid(v.sessionId)&&['DECODE','RETAIN'].includes(v.kind)&&digest(v.identityHash)&&positive(v.revision,L.events-1));return decoderFreeze(v);}
export function publicationRow(input){const v=publicationData(input,['operationId','sessionId','request','stageBinding','binding','phase','intentRevision','completedRevision','revision','evidenceHash']);check(uuid(v.operationId)&&uuid(v.sessionId)&&['INTENT','COMPLETED','UNKNOWN'].includes(v.phase)&&positive(v.intentRevision,L.events-1)&&integer(v.revision,L.events-1)&&v.revision>=v.intentRevision);publicationRequest(v.request);publicationStageBinding(v.stageBinding,publicationSessionBinding(v.binding));check(v.phase==='COMPLETED'?integer(v.completedRevision,L.events-1)&&v.completedRevision>v.intentRevision&&v.completedRevision===v.revision&&digest(v.evidenceHash):v.completedRevision===null&&v.evidenceHash===null);return decoderFreeze(v);}

// Exact schema allowlist; legacy tables and rows are kept intact. Indexed
// projections point back to their last immutable event for bounded replay.
const sql={
 lifecycle_meta:'CREATE TABLE lifecycle_meta(id INTEGER PRIMARY KEY CHECK(id=1),origin TEXT NOT NULL,state TEXT NOT NULL)',
 lifecycle_operations:'CREATE TABLE lifecycle_operations(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,record TEXT NOT NULL)',
 publisher_sessions:'CREATE TABLE publisher_sessions(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,record TEXT NOT NULL)',
 scope_generations:'CREATE TABLE scope_generations(id TEXT PRIMARY KEY,generation_key TEXT UNIQUE NOT NULL,source_key TEXT NOT NULL,ordinal INTEGER NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL,UNIQUE(source_key,ordinal))',
 scope_barriers:'CREATE TABLE scope_barriers(id TEXT PRIMARY KEY,generation_key TEXT UNIQUE NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL)',
 publication_v2:'CREATE TABLE publication_v2(id TEXT PRIMARY KEY,object_key TEXT UNIQUE NOT NULL,session_id TEXT NOT NULL,stage_id TEXT UNIQUE NOT NULL,request_id TEXT UNIQUE NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL)',
 publication_v2_by_session:'CREATE INDEX publication_v2_by_session ON publication_v2(session_id)',
 external_holds:'CREATE TABLE external_holds(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,record TEXT NOT NULL)',
 lifecycle_events:'CREATE TABLE lifecycle_events(revision INTEGER PRIMARY KEY,previous_hash TEXT NOT NULL,record TEXT NOT NULL,event_hash TEXT NOT NULL)',
 lifecycle_events_no_update:"CREATE TRIGGER lifecycle_events_no_update BEFORE UPDATE ON lifecycle_events BEGIN SELECT RAISE(ABORT,'immutable event'); END",
 lifecycle_events_no_delete:"CREATE TRIGGER lifecycle_events_no_delete BEFORE DELETE ON lifecycle_events BEGIN SELECT RAISE(ABORT,'immutable event'); END",
 lifecycle_origin_immutable:"CREATE TRIGGER lifecycle_origin_immutable BEFORE UPDATE OF origin ON lifecycle_meta BEGIN SELECT RAISE(ABORT,'immutable origin'); END"
};
for(const table of ['metadata','operations','events'])for(const verb of ['INSERT','UPDATE','DELETE']){const name=`legacy_${table}_no_${verb.toLowerCase()}`;sql[name]=`CREATE TRIGGER ${name} BEFORE ${verb} ON ${table} BEGIN SELECT RAISE(ABORT,'frozen legacy'); END`;}
for(const table of ['lifecycle_operations','publisher_sessions','scope_generations','scope_barriers','publication_v2','external_holds']){const name=`${table}_no_delete`;sql[name]=`CREATE TRIGGER ${name} BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'retained history'); END`;}
export const PUBLICATION_LIFECYCLE_SQL=Object.freeze(sql);


// v3 stores genuine producer observations only after the owning IO module has
// checked private origin. These exported parsers are data rules, never brands.
export function publicationPreparedReport(input){
  const v=publicationData(input,['schema','classification','executionAllowed','freshPublicationAllowed','requestId','deadlineBootNs','plan','bootId','epoch','bindingHash','profileHash','limitsHash']);
  check(v.schema==='atlas-proof-decoder-prepared-request-v1'&&v.classification==='UNQUALIFIED'&&v.executionAllowed===false&&v.freshPublicationAllowed===false&&uuid(v.requestId)&&boot(v.bootId)&&decimal(v.deadlineBootNs)&&BigInt(v.deadlineBootNs)>0n&&typeof v.epoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v.epoch));
  for(const k of ['bindingHash','profileHash','limitsHash'])check(digest(v[k]));assertProofDecoderPlan(v.plan);return decoderFreeze(v);
}
export function publicationDecoderIdentity(input){
  const v=publicationData(input,['schema','ledgerId','sessionId','binding','stageBinding','prepared']);
  check(v.schema==='atlas-proof-publication-decoder-identity-v1'&&uuid(v.ledgerId)&&uuid(v.sessionId));const b=publicationSessionBinding(v.binding),s=publicationStageBinding(v.stageBinding,b),p=publicationPreparedReport(v.prepared);
  check(p.bootId===s.bootId&&p.deadlineBootNs===s.deadlineBootNs,'PUBLICATION_DISPATCH_BINDING');return decoderFreeze(v);
}
export function publicationDecoderOutcome(input){
  const v=publicationData(input,['schema','classification','executionAllowed','freshPublicationAllowed','disposition','request','completion']);
  check(v.schema==='atlas-proof-decoder-client-disposition-v1'&&v.classification==='UNQUALIFIED'&&v.executionAllowed===false&&v.freshPublicationAllowed===false&&['COMPLETE_CLEAN','KNOWN_NO_START_SENT','UNKNOWN'].includes(v.disposition));const p=publicationPreparedReport(v.request);
  if(v.disposition!=='COMPLETE_CLEAN')check(v.completion===null);
  else{
    const c=v.completion;decoderExact(c,['schema','classification','executionAllowed','freshPublicationAllowed','requestId','nonce','bindingHash','jobId','outcome','reportedCleanup','validation','bootId','epoch']);
    check(c.schema==='atlas-proof-decoder-target-broker-v2'&&c.classification==='UNQUALIFIED'&&c.executionAllowed===false&&c.freshPublicationAllowed===false&&uuid(c.jobId)&&digest(c.nonce)&&c.requestId===p.requestId&&c.bindingHash===p.bindingHash&&c.bootId===p.bootId&&c.epoch===p.epoch&&['SUCCESS','INVALID_IMAGE'].includes(c.outcome)&&c.reportedCleanup==='OBSERVED');
    if(c.outcome==='SUCCESS'){assertProofDecoderValidation(c.validation);check(c.validation.sha256===p.plan.sha256&&c.validation.byteCount===p.plan.byteCount&&c.validation.contentType===p.plan.declaredType);}else check(c.validation===null);
  }
  return decoderFreeze(v);
}
export function publicationDecoderDispatch(input){
  const v=publicationData(input,['operationId','sessionId','identityHash','identity','revision']);const i=publicationDecoderIdentity(v.identity);
  check(uuid(v.operationId)&&v.sessionId===i.sessionId&&v.identityHash===hash(i)&&positive(v.revision,L.events-1));return decoderFreeze(v);
}
export function publicationDecoderSettlement(input){
  const v=publicationData(input,['operationId','dispatchOperationId','sessionId','identityHash','outcomeHash','outcome','revision']);const o=publicationDecoderOutcome(v.outcome);
  check(uuid(v.operationId)&&uuid(v.dispatchOperationId)&&uuid(v.sessionId)&&digest(v.identityHash)&&v.outcomeHash===hash(o)&&positive(v.revision,L.events-1));return decoderFreeze(v);
}
export function publicationDispatchMigration(input){
  const v=publicationData(input,['schema','migrationId','priorRevision','priorHeadHash','priorStateHash','revision']);
  check(v.schema==='atlas-proof-publication-dispatch-migration-v3'&&uuid(v.migrationId)&&positive(v.priorRevision,L.events-2)&&digest(v.priorHeadHash)&&digest(v.priorStateHash)&&v.revision===v.priorRevision+1);return decoderFreeze(v);
}
const dispatchSQL={
 decoder_dispatches:'CREATE TABLE decoder_dispatches(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,stage_id TEXT UNIQUE NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL)',
 decoder_settlements:'CREATE TABLE decoder_settlements(id TEXT PRIMARY KEY,dispatch_id TEXT UNIQUE NOT NULL,revision INTEGER NOT NULL,record TEXT NOT NULL)',
 decoder_dispatch_migration:'CREATE TABLE decoder_dispatch_migration(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,record TEXT NOT NULL)'
};
for(const table of ['decoder_dispatches','decoder_settlements','decoder_dispatch_migration'])for(const verb of ['UPDATE','DELETE'])dispatchSQL[`${table}_no_${verb.toLowerCase()}`]=`CREATE TRIGGER ${table}_no_${verb.toLowerCase()} BEFORE ${verb} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable decoder dispatch'); END`;
export const PUBLICATION_DISPATCH_SQL=Object.freeze(dispatchSQL);
