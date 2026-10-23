import {canonicalJSON,clone,hash,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {assertProofDecoderValidation} from './proof-decoder-protocol.mjs';

const MARKERS=Object.freeze({classification:'UNQUALIFIED',customerPublicationAuthority:false,retentionAuthority:false});
const META='marketplaceProofRetentionJournal',OPS='marketplaceProofRetentionOperations',UPLOADS='marketplaceProofRetentionUploadIndex',PUBLICATIONS='marketplaceProofRetentionPublicationIndex';
const SCHEMA='atlas-proof-retention-operation-v1',RECORD='atlas-proof-retention-record-v1',MAX_BYTES=32768;
const PURPOSES=['RETURN_REQUEST','PACK','DISPATCH','DELIVERY','RELEASE','RETURN_INSPECTION','RETURN_REVIEW','REFUND_REVIEW'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const check=(value,code='PROOF_RETENTION_INVALID')=>requireValue(value,code);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&UUID.test(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const text=value=>typeof value==='string'&&value.length>0&&value.length<=500&&value.trim()===value;
const equal=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const own=(value,key)=>Object.hasOwn(value,key);
const data=value=>{const copy=decoderContractData(value);check(Buffer.byteLength(canonicalJSON(copy))<=MAX_BYTES);return copy;};
const publicationKey=o=>hash({ledgerId:o.publicationLedgerId,sessionId:o.publicationSessionId,operationId:o.publicationOperationId});
const orderBinding=o=>({orderId:o.orderId,cardId:o.cardId,buyerId:o.buyerId,sellerId:o.sellerId,bindingHash:o.bindingHash,policyVersion:o.policyVersion});
const projection=(row,state)=>({uploadId:row.uploadId,proofId:state.marketplaceProofObjects?.[row.proofId]?.proofId??null,orderId:row.orderId,purpose:row.purpose,status:row.status,declaredType:row.plan.declaredType,byteCount:row.plan.byteCount,sha256:row.plan.sha256,expiresAt:row.expiresAt,createdAt:row.createdAt,reviewStatus:state.marketplaceProofReviews?.[row.proofId]?.decision??'NOT_REVIEWED'});
const identityKeys=['schema','operationId','uploadId','proofId','orderId','orderHash','actorId','actorRole','actorAccessBindingHash','originalRequestHash','policyHash','intakeBindingHash','objectKey','manifestHash','originalSha256','originalByteCount','validationAttemptId','decoderRequestId','publicationLedgerId','publicationSessionId','publicationOperationId','publicationRevision','publicationEvidenceHash','qualificationSessionId','retentionFenceRevision','expectedUploadHash'];
const hashes=['orderHash','actorAccessBindingHash','originalRequestHash','policyHash','intakeBindingHash','objectKey','manifestHash','originalSha256','publicationEvidenceHash','expectedUploadHash'];
const uuids=['operationId','validationAttemptId','decoderRequestId','publicationLedgerId','publicationSessionId','publicationOperationId','qualificationSessionId'];

/** Trusted INTERNAL storage machinery only. Closed observations are unverified
 * data: this primitive never authenticates actors, publication or live fences.
 * The future concrete handler must gate it with genuine producers. It exposes
 * no customer endpoint, decoder, filesystem writer or authorization callback. */
export function createProofRetentionJournal(options={}){
  const input=engineDataOptions(options,[],['enabled','store','binding','maxOperations']);
  if(input.enabled!==true)return null;
  const binding=data(input.binding);decoderExact(binding,['schema','environment','policyHash','storageHash']);
  check(binding.schema==='atlas-marketplace-proof-intake-v1'&&['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(binding.environment)&&digest(binding.policyHash)&&digest(binding.storageHash));
  const maxOperations=input.maxOperations;check(Number.isSafeInteger(maxOperations)&&maxOperations>0&&maxOperations<=4096);
  const store=input.store;check(store&&Object.getPrototypeOf(store)===Object.prototype);
  const read=Object.getOwnPropertyDescriptor(store,'read')?.value,transaction=Object.getOwnPropertyDescriptor(store,'transaction')?.value;
  check(typeof read==='function'&&typeof transaction==='function','PROOF_RETENTION_STORE_REQUIRED');
  const bindingHash=hash(binding),metadata={schema:'atlas-proof-retention-journal-v1',bindingHash,maxOperations},unknownCommits=new Set(),unknownBarriers=new Set(),pendingCommits=new Set(),pendingBarriers=new Set();let closed=false;
  const ready=()=>{check(!closed,'PROOF_RETENTION_CLOSED');check(Object.getOwnPropertyDescriptor(store,'read')?.value===read&&Object.getOwnPropertyDescriptor(store,'transaction')?.value===transaction,'PROOF_RETENTION_STORE_CHANGED');};
  function identifier(value){check(typeof value==='string'&&(binding.environment==='SYNTHETIC_LOCAL'?/^demo_[a-zA-Z0-9_-]{1,100}$/.test(value):/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)&&!value.startsWith('demo_')&&!['constructor','prototype'].includes(value)));}
  function operation(value){
    const o=data(value);decoderExact(o,identityKeys);check(o.schema===SCHEMA&&hashes.every(key=>digest(o[key]))&&uuids.every(key=>uuid(o[key])));
    for(const key of ['uploadId','proofId','orderId'])identifier(o[key]);if(binding.environment==='SYNTHETIC_LOCAL')identifier(o.actorId);else check(uuid(o.actorId));
    check(['BUYER','STAFF'].includes(o.actorRole)&&o.intakeBindingHash===bindingHash&&o.policyHash===binding.policyHash&&integer(o.publicationRevision)&&o.publicationRevision>0&&integer(o.retentionFenceRevision)&&o.retentionFenceRevision>0&&Number.isSafeInteger(o.originalByteCount)&&o.originalByteCount>0&&o.originalByteCount<=10485760);
    check(o.objectKey===hash({binding,uploadId:o.uploadId}),'PROOF_RETENTION_BINDING');return o;
  }
  function row(state,o,retained){
    const current=state.marketplaceProofUploads?.[o.uploadId];check(current,'PROOF_RETENTION_UPLOAD_HOLD');const r=data(current),m=r.manifest;
    check(r.uploadId===o.uploadId&&r.proofId===o.proofId&&r.orderId===o.orderId&&r.actorId===o.actorId&&r.actorRole===o.actorRole&&r.objectKey===o.objectKey&&r.orderHash===o.orderHash&&r.policyHash===o.policyHash&&r.requestHash===o.originalRequestHash&&PURPOSES.includes(r.purpose),'PROOF_RETENTION_BINDING');
    check(r.status===(retained?'RETAINED':'VALIDATED'),'PROOF_RETENTION_UPLOAD_HOLD');
    check(integer(r.createdAt)&&integer(r.expiresAt)&&r.expiresAt>r.createdAt&&integer(r.retainUntil)&&r.retainUntil>r.createdAt&&integer(r.attempts),'PROOF_RETENTION_BINDING');
    decoderExact(r.plan,['declaredType','byteCount','sha256']);check(r.plan.byteCount===o.originalByteCount&&r.plan.sha256===o.originalSha256&&['image/png','image/jpeg'].includes(r.plan.declaredType),'PROOF_RETENTION_BINDING');
    decoderExact(m,['schema','proofId','uploadId','environment','storageId','retentionRef','retainUntil','createdAt','validatedAt','policyHash','orderBinding','actorId','actorRole','purpose','byteCount','sha256','validation']);
    check(m.schema==='atlas-marketplace-retained-proof-v1'&&m.proofId===o.proofId&&m.uploadId===o.uploadId&&m.environment===binding.environment&&text(m.storageId)&&text(m.retentionRef)&&m.retainUntil===r.retainUntil&&m.createdAt===r.createdAt&&integer(m.validatedAt)&&m.validatedAt>=m.createdAt&&m.policyHash===o.policyHash&&m.actorId===o.actorId&&m.actorRole===o.actorRole&&m.purpose===r.purpose&&m.byteCount===o.originalByteCount&&m.sha256===o.originalSha256&&hash(m)===o.manifestHash,'PROOF_RETENTION_BINDING');
    assertProofDecoderValidation(m.validation);check(m.validation.byteCount===o.originalByteCount&&m.validation.sha256===o.originalSha256&&m.validation.contentType===r.plan.declaredType,'PROOF_RETENTION_BINDING');
    decoderExact(r.orderBinding,['orderId','cardId','buyerId','sellerId','bindingHash','policyVersion']);
    check(Object.values(r.orderBinding).every(text)&&r.orderBinding.orderId===o.orderId&&hash(r.orderBinding)===o.orderHash&&equal(m.orderBinding,r.orderBinding),'PROOF_RETENTION_BINDING');
    if(!retained){
      const order=state.orders?.[o.orderId],payment=state.intents?.[order?.paymentIntentId];
      check(order&&payment?.kind==='PAYMENT'&&payment.status==='SUCCEEDED'&&payment.confirmed===true&&payment.orderId===o.orderId&&payment.bindingHash===order.bindingHash,'PROOF_RETENTION_ORDER_HOLD');
      check(equal(r.orderBinding,orderBinding(order)),'PROOF_RETENTION_BINDING');
    }
    check(o.actorRole==='BUYER'?r.orderBinding.buyerId===o.actorId&&r.purpose==='RETURN_REQUEST':r.purpose!=='RETURN_REQUEST','PROOF_RETENTION_BINDING');
    return current;
  }
  function tables(state,create=false){
    const present=[META,OPS,UPLOADS,PUBLICATIONS].map(key=>own(state,key));
    if(present.every(value=>!value)){
      if(!create)return {operations:{},uploads:{},publications:{}};
      state[META]=clone(metadata);state[OPS]={};state[UPLOADS]={};state[PUBLICATIONS]={};
    }else check(present.every(Boolean)&&equal(data(state[META]),metadata),'PROOF_RETENTION_JOURNAL_HOLD');
    const operations=state[OPS],uploads=state[UPLOADS],publications=state[PUBLICATIONS];
    for(const map of [operations,uploads,publications])check(map&&Object.getPrototypeOf(map)===Object.prototype&&Object.keys(map).length<=maxOperations,'PROOF_RETENTION_JOURNAL_HOLD');
    const ids=Object.keys(operations);check(Object.keys(uploads).length===ids.length&&Object.keys(publications).length===ids.length,'PROOF_RETENTION_JOURNAL_HOLD');
    for(const id of ids){
      const record=data(operations[id]);decoderExact(record,['schema','operation','operationHash','phase','recordedAt','result','retainedUploadHash','proofObjectHash','barrier']);
      const o=operation(record.operation);check(id===o.operationId&&record.schema===RECORD&&record.operationHash===hash(o)&&integer(record.recordedAt)&&uploads[o.uploadId]===id&&publications[publicationKey(o)]===id,'PROOF_RETENTION_JOURNAL_HOLD');
      if(record.phase==='COMMITTED'){
        check(record.barrier===null&&digest(record.retainedUploadHash)&&digest(record.proofObjectHash)&&record.result!==null,'PROOF_RETENTION_JOURNAL_HOLD');
        decoderExact(record.result,['uploadId','proofId','orderId','purpose','status','declaredType','byteCount','sha256','expiresAt','createdAt','reviewStatus']);check(record.result.reviewStatus==='NOT_REVIEWED','PROOF_RETENTION_JOURNAL_HOLD');
      }else{
        check(record.phase==='CANCELLED_BEFORE_COMMIT'&&record.result===null&&record.retainedUploadHash===null&&record.proofObjectHash===null,'PROOF_RETENTION_JOURNAL_HOLD');
        decoderExact(record.barrier,['barrierId','barrierRevision']);check(uuid(record.barrier.barrierId)&&integer(record.barrier.barrierRevision)&&record.barrier.barrierRevision>o.retentionFenceRevision,'PROOF_RETENTION_JOURNAL_HOLD');
      }
    }
    return {operations,uploads,publications};
  }
  function found(state,t,o){
    const prior=t.operations[o.operationId];
    check((!own(t.uploads,o.uploadId)||t.uploads[o.uploadId]===o.operationId)&&(!own(t.publications,publicationKey(o))||t.publications[publicationKey(o)]===o.operationId),'PROOF_RETENTION_CONFLICT');
    if(!prior)return null;
    check(equal(prior.operation,o)&&prior.operationHash===hash(o),'PROOF_RETENTION_CONFLICT');
    if(prior.phase==='COMMITTED'){
      const current=row(state,o,true),object=state.marketplaceProofObjects?.[o.proofId];
      check(hash(current)===prior.retainedUploadHash&&object&&hash(object)===prior.proofObjectHash&&object.uploadId===o.uploadId&&object.objectKey===o.objectKey&&object.manifestHash===o.manifestHash&&hash(object.manifest)===o.manifestHash&&object.retainedAt===prior.recordedAt&&current.completedAt===prior.recordedAt,'PROOF_RETENTION_ORIGINAL_HOLD');
      const currentProjection=projection(current,state);currentProjection.reviewStatus=prior.result.reviewStatus;check(equal(prior.result,currentProjection),'PROOF_RETENTION_ORIGINAL_HOLD');
    }
    return prior;
  }
  const report=(o,record)=>decoderFreeze({schema:'atlas-proof-retention-journal-report-v1',...MARKERS,operationId:o.operationId,operationHash:hash(o),disposition:record?.phase??'ABSENT_HOLD',record:record?clone(record):null});
  function write(options,cancel){
    ready();const value=engineDataOptions(options,['operation',...(cancel?['barrierId','barrierRevision']:[])]),o=operation(value.operation);
    const barrier=cancel?{barrierId:value.barrierId,barrierRevision:value.barrierRevision}:null;
    if(cancel)check(uuid(barrier.barrierId)&&integer(barrier.barrierRevision)&&barrier.barrierRevision>o.retentionFenceRevision);
    check(!unknownBarriers.has(o.operationId)&&(cancel||!unknownCommits.has(o.operationId)),'PROOF_RETENTION_UNKNOWN_HOLD');
    check(new Set([...unknownCommits,...unknownBarriers]).size<maxOperations||unknownCommits.has(o.operationId),'PROOF_RETENTION_CAPACITY_HOLD');
    const pending=cancel?pendingBarriers:pendingCommits;check(!pending.has(o.operationId),'PROOF_RETENTION_PENDING_HOLD');check(pending.size<maxOperations,'PROOF_RETENTION_CAPACITY_HOLD');
    function failed(cause){
      // This is the trusted store's error contract, never actor authority. The
      // owning publisher must persist dispatch uncertainty across process loss.
      if(cause&&typeof cause==='object'&&Object.getOwnPropertyDescriptor(cause,'code')?.value==='STORE_COMMIT_UNKNOWN')(cancel?unknownBarriers:unknownCommits).add(o.operationId);
      throw cause;
    }
    // The store owns real transaction/CAS semantics. This callback is strictly
    // synchronous; no read, refresh, publisher or decoder callback can run here.
    pending.add(o.operationId);let output;try{output=transaction.call(store,tx=>{
      ready();check(integer(tx.now),'PROOF_RETENTION_INVALID_CLOCK');const t=tables(tx.state,true),prior=found(tx.state,t,o);
      if(prior){if(prior.phase==='CANCELLED_BEFORE_COMMIT'){check(cancel,'PROOF_RETENTION_CANCELLED_HOLD');check(equal(prior.barrier,barrier),'PROOF_RETENTION_CONFLICT');}return report(o,prior);}
      check(Object.keys(t.operations).length<maxOperations,'PROOF_RETENTION_CAPACITY_HOLD');
      const current=row(tx.state,o,false);check(hash(current)===o.expectedUploadHash,'PROOF_RETENTION_CAS_HOLD');
      check(!own(tx.state.marketplaceProofObjects??{},o.proofId)&&!own(tx.state.marketplaceProofReviews??{},o.proofId),'PROOF_RETENTION_ORIGINAL_HOLD');
      check(tx.now>=current.manifest.validatedAt,'PROOF_RETENTION_INVALID_CLOCK');
      const record={schema:RECORD,operation:clone(o),operationHash:hash(o),phase:cancel?'CANCELLED_BEFORE_COMMIT':'COMMITTED',recordedAt:tx.now,result:null,retainedUploadHash:null,proofObjectHash:null,barrier};
      if(cancel)tx.emit('MARKETPLACE_PROOF_RETENTION_CANCELLED',{operationId:o.operationId,uploadId:o.uploadId,proofId:o.proofId,...barrier});
      else{
        const objects=tx.state.marketplaceProofObjects??={};
        objects[o.proofId]={proofId:o.proofId,uploadId:o.uploadId,objectKey:o.objectKey,manifest:clone(current.manifest),manifestHash:o.manifestHash,retainedAt:tx.now};
        current.status='RETAINED';current.completedAt=tx.now;
        tx.emit('MARKETPLACE_PROOF_RETAINED',{proofId:o.proofId,orderId:o.orderId,purpose:current.purpose,actorId:o.actorId});
        record.result=projection(current,tx.state);record.retainedUploadHash=hash(current);record.proofObjectHash=hash(objects[o.proofId]);
      }
      t.operations[o.operationId]=record;t.uploads[o.uploadId]=o.operationId;t.publications[publicationKey(o)]=o.operationId;return report(o,record);
    });}catch(cause){pending.delete(o.operationId);return failed(cause);}
    if(output&&typeof output.then==='function')return Promise.resolve(output).catch(failed).finally(()=>pending.delete(o.operationId));
    pending.delete(o.operationId);return output;
  }
  return Object.freeze({...MARKERS,binding:decoderFreeze(binding),maxOperations,
    commitRetention(options){return write(options,false);},
    cancelBeforeCommit(options){return write(options,true);},
    lookupRetention(options){ready();const value=engineDataOptions(options,['operation']),o=operation(value.operation);return read.call(store,state=>{ready();return report(o,found(state,tables(state),o));});},
    close(){closed=true;}
  });
}
