// Internal concrete storage producer. A private origin is never actor authority.
import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {createPostgresStore} from './store-postgres.mjs';
import {createProofRetentionJournal} from './proof-retention-journal.mjs';
import {intakeProtectedInstallation} from './proof-intake-protected-protocol.mjs';
import {createProofRetentionProtectedPostgresStore} from './proof-retention-protected-postgres.mjs';
import {createProofRetentionPostgresConnectionOwner,createProofRetentionProtectedConnectionOwner,createProofRetentionIntakeConnectionOwner,createR1ProofRetentionIntakeConnectionOwner} from './proof-retention-postgres-connection.mjs';

const writers=new WeakMap(),check=(v,c='RETENTION_WRITER_INVALID')=>requireValue(v,c);
const MARKERS=Object.freeze({classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false});
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const keys=['schema','operationId','uploadId','proofId','orderId','orderHash','actorId','actorRole','actorAccessBindingHash','originalRequestHash','policyHash','intakeBindingHash','objectKey','manifestHash','originalSha256','originalByteCount','validationAttemptId','decoderRequestId','publicationLedgerId','publicationSessionId','publicationOperationId','publicationRevision','publicationEvidenceHash','qualificationSessionId','retentionFenceRevision','expectedUploadHash'];
const hashes=['orderHash','actorAccessBindingHash','originalRequestHash','policyHash','intakeBindingHash','objectKey','manifestHash','originalSha256','publicationEvidenceHash','expectedUploadHash'];
const ids=['operationId','validationAttemptId','decoderRequestId','publicationLedgerId','publicationSessionId','publicationOperationId','qualificationSessionId'];
const positive=v=>Number.isSafeInteger(v)&&v>0;
const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
function data(value,fields){const v=decoderContractData(value);decoderExact(v,fields);check(Buffer.byteLength(canonicalJSON(v))<=32768);return v;}
export function retentionWriterBinding(input){const b=data(input,['schema','environment','policyHash','storageHash']);check(b.schema==='atlas-marketplace-proof-intake-v1'&&['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(b.environment)&&digest(b.policyHash)&&digest(b.storageHash));return decoderFreeze(b);}
export function retentionPreparedOperation(input,binding){
  const b=retentionWriterBinding(binding),o=data(input,keys);check(o.schema==='atlas-proof-retention-operation-v1'&&hashes.every(k=>digest(o[k]))&&ids.every(k=>uuid(o[k])));
  const identifier=v=>typeof v==='string'&&(b.environment==='SYNTHETIC_LOCAL'?/^demo_[a-zA-Z0-9_-]{1,100}$/.test(v):/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)&&!v.startsWith('demo_')&&!['constructor','prototype'].includes(v));
  check(['uploadId','proofId','orderId'].every(k=>identifier(o[k]))&&(b.environment==='SYNTHETIC_LOCAL'?identifier(o.actorId):uuid(o.actorId))&&['BUYER','STAFF'].includes(o.actorRole));
  check(o.intakeBindingHash===hash(b)&&o.policyHash===b.policyHash&&positive(o.publicationRevision)&&positive(o.retentionFenceRevision)&&positive(o.originalByteCount)&&o.originalByteCount<=10485760&&o.objectKey===hash({binding:b,uploadId:o.uploadId}),'RETENTION_WRITER_BINDING');return decoderFreeze(o);
}
export function assertProofRetentionPostgresWriter(value){check(writers.has(value),'RETENTION_WRITER_REQUIRED');return value;}
export function assertProofRetentionPreparedSubmission(handle,options){const {writer}=engineDataOptions(options,['writer']),state=writers.get(writer);check(state&&state.handles.has(handle),'RETENTION_PREPARED_REQUIRED');const entry=state.handles.get(handle);check(entry.phase==='PREPARED'&&!state.closed,'RETENTION_PREPARED_CONSUMED');return entry.report;}
export function assertProofRetentionPostgresOutcome(value,options){const {writer}=engineDataOptions(options,['writer']),state=writers.get(writer);check(state&&value&&typeof value==='object'&&state.outcomes.has(value),'RETENTION_OUTCOME_REQUIRED');return state.outcomes.get(value);}

/** The initial adapter intentionally supports SYNTHETIC_LOCAL only. Its generic
 * three-function role is not the future protected retention gateway. Real
 * canonical production composition must install that separate audited adapter. */
export function createProofRetentionPostgresWriter(options={}){
  const input=engineDataOptions(options,[],['enabled','configuration','binding','maxOperations']);if(input.enabled!==true)return null;
  const binding=retentionWriterBinding(input.binding),maxOperations=input.maxOperations;check(binding.environment==='SYNTHETIC_LOCAL','RETENTION_PROTECTED_GATEWAY_REQUIRED');check(positive(maxOperations)&&maxOperations<=4096);
  const owner=createProofRetentionPostgresConnectionOwner({enabled:true,configuration:input.configuration});
  const store=createPostgresStore({enabled:true,pool:owner,environment:binding.environment,expectedRole:owner.binding.role,expectedDatabase:owner.binding.database,expectedFunctionOwner:owner.binding.functionOwner});
  return createOwnedWriter(binding,maxOperations,owner,store);
}
export function createProofRetentionProtectedPostgresWriter(options={}){
  const input=engineDataOptions(options,[],['enabled','configuration','binding','maxOperations']);if(input.enabled!==true)return null;
  const binding=retentionWriterBinding(input.binding),maxOperations=input.maxOperations;check(binding.environment==='SYNTHETIC_LOCAL','RETENTION_PROTECTED_AUTHORITY_NOT_IMPLEMENTED');check(positive(maxOperations)&&maxOperations<=4096);
  const owner=createProofRetentionProtectedConnectionOwner({enabled:true,configuration:input.configuration,binding,maxOperations}),store=createProofRetentionProtectedPostgresStore({enabled:true,owner});
  return createOwnedWriter(binding,maxOperations,owner,store);
}
// Same private retention producer, explicitly composed with the separately
// installed/audited intake closure. No initial-intake write rights are granted.
export function createProofRetentionIntakePostgresWriter(options={}){
 const input=engineDataOptions(options,[],['enabled','configuration','installation','maxOperations']);if(input.enabled!==true)return null;
 const installation=intakeProtectedInstallation(input.installation),maxOperations=input.maxOperations;check(positive(maxOperations)&&maxOperations<=4096);
 const owner=createProofRetentionIntakeConnectionOwner({enabled:true,configuration:input.configuration,installation,maxOperations}),store=createProofRetentionProtectedPostgresStore({enabled:true,owner});
 return createOwnedWriter(installation.binding,maxOperations,owner,store);
}
export function createR1ProofRetentionIntakePostgresWriter(options={}){
 const input=engineDataOptions(options,[],['enabled','configuration','installation','maxOperations']);if(input.enabled!==true)return null;
 const installation=intakeProtectedInstallation(input.installation),maxOperations=input.maxOperations;check(positive(maxOperations)&&maxOperations<=4096);
 const owner=createR1ProofRetentionIntakeConnectionOwner({enabled:true,configuration:input.configuration,installation,maxOperations}),store=createProofRetentionProtectedPostgresStore({enabled:true,owner});
 return createOwnedWriter(installation.binding,maxOperations,owner,store);
}
function createOwnedWriter(binding,maxOperations,owner,store){
  const journal=createProofRetentionJournal({enabled:true,store,binding,maxOperations}),state={handles:new WeakMap(),outcomes:new WeakMap(),closed:false},registered=new Map();let busy=false;
  const writerBinding=decoderFreeze({schema:'atlas-proof-retention-writer-binding-v1',...MARKERS,intakeBinding:binding,connection:owner.binding,maxOperations});
  function entry(handle){check(!state.closed,'RETENTION_WRITER_CLOSED');check(state.handles.has(handle),'RETENTION_PREPARED_REQUIRED');return state.handles.get(handle);}
  function remember(value,e,action,disposition,report){const observed=decoderFreeze({schema:'atlas-proof-retention-writer-outcome-v1',...MARKERS,writerBindingHash:hash(writerBinding),operationHash:hash(e.operation),operation:e.operation,action,disposition,report});state.outcomes.set(value,observed);return value;}
  async function perform(handle,action,barrier=null){
    const e=entry(handle);check(!busy,'RETENTION_WRITER_BUSY');
    if(action==='COMMIT')check(e.phase==='PREPARED','RETENTION_COMMIT_CONSUMED');
    if(action==='LOOKUP'){check(e.phase!=='PREPARED','RETENTION_LOOKUP_BEFORE_DISPATCH');check(e.lookups<8,'RETENTION_LOOKUP_BOUND');e.lookups++;}
    if(action==='CANCEL'){check(!e.cancelDispatched,'RETENTION_CANCEL_CONSUMED');check(uuid(barrier.barrierId)&&positive(barrier.barrierRevision)&&barrier.barrierRevision>e.operation.retentionFenceRevision);e.cancelDispatched=true;e.phase='CANCEL_DISPATCHED';}
    if(action==='COMMIT')e.phase='COMMIT_DISPATCHED';busy=true;
    try{
      const report=await(action==='COMMIT'?journal.commitRetention({operation:e.operation}):action==='CANCEL'?journal.cancelBeforeCommit({operation:e.operation,...barrier}):journal.lookupRetention({operation:e.operation}));
      check(report.operationHash===hash(e.operation)&&report.operationId===e.operation.operationId&&['COMMITTED','CANCELLED_BEFORE_COMMIT','ABSENT_HOLD'].includes(report.disposition),'RETENTION_WRITER_RESULT');
      if(report.record)check(same(report.record.operation,e.operation),'RETENTION_WRITER_RESULT');
      if(report.disposition==='COMMITTED'||report.disposition==='CANCELLED_BEFORE_COMMIT')e.phase='TERMINAL';
      const result=decoderFreeze({...report});return remember(result,e,action,report.disposition,result);
    }catch{
      // Every failed dispatch/read remains unresolved. No error text or caller
      // JSON can turn it into a no-effect claim; the original ID is never retried.
      if(action!=='LOOKUP')e.phase='UNKNOWN';
      const error=Object.assign(new Error('RETENTION_STORAGE_OUTCOME_UNKNOWN'),{code:'RETENTION_STORAGE_OUTCOME_UNKNOWN'});remember(error,e,action,'UNKNOWN',null);throw error;
    }finally{busy=false;}
  }
  const writer=Object.freeze({...MARKERS,binding:writerBinding,
    prepareRetention(options){check(!state.closed&&!busy,'RETENTION_WRITER_UNAVAILABLE');const {operation}=engineDataOptions(options,['operation']),o=retentionPreparedOperation(operation,binding);check(!registered.has(o.operationId),'RETENTION_OPERATION_ALREADY_PREPARED');check(registered.size<maxOperations,'RETENTION_WRITER_CAPACITY');const report=decoderFreeze({schema:'atlas-proof-retention-prepared-v1',...MARKERS,writerBindingHash:hash(writerBinding),operationHash:hash(o),operation:o});const handle=Object.freeze({report});state.handles.set(handle,{operation:o,report,phase:'PREPARED',cancelDispatched:false,lookups:0});registered.set(o.operationId,handle);return handle;},
    commitPrepared(handle){return perform(handle,'COMMIT');},
    lookupPrepared(handle){return perform(handle,'LOOKUP');},
    cancelPrepared(handle,options){const barrier=engineDataOptions(options,['barrierId','barrierRevision']);return perform(handle,'CANCEL',barrier);},
    lookupDisposition(value){return assertProofRetentionPostgresOutcome(value,{writer});},
    async close(){state.closed=true;journal.close();store.close();await owner.close();}
  });writers.set(writer,state);return writer;
}
