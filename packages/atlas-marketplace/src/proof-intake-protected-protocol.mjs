// Closed structural storage data only. No actor, decoder or fence authority.
import {canonicalJSON,clone,hash,requireValue} from './contract.mjs';
import {decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {assertProofDecoderValidation} from './proof-decoder-protocol.mjs';
const check=(v,c='INTAKE_PROTECTED_INVALID')=>requireValue(v,c);
const equal=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const id=(v,c)=>typeof v==='string'&&(c.binding.environment==='SYNTHETIC_LOCAL'?/^demo_[a-zA-Z0-9_-]{1,100}$/.test(v):/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)&&!v.startsWith('demo_')&&!['constructor','prototype'].includes(v));
const actorId=(v,c)=>c.binding.environment==='SYNTHETIC_LOCAL'?id(v,c):uuid(v);
const prefix=c=>c?.binding.environment==='SYNTHETIC_LOCAL'||!c?'demo_':'atlas_';
const text=v=>typeof v==='string'&&v.length>0&&v.length<=500&&v.trim()===v;
const integer=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const purposes=['RETURN_REQUEST','PACK','DISPATCH','DELIVERY','RELEASE','RETURN_INSPECTION','RETURN_REVIEW','REFUND_REVIEW'];
const policyKeys=['environment','id','version','approvalRef','retentionRef','reviewerAuthorityRef','effectiveAt','expiresAt','retentionMs','maxObjectBytes','maxProofsPerOrder','maxRetainedObjects','uploadTtlMs','validationLeaseMs'];
const copy=v=>{const d=decoderContractData(v);check(Buffer.byteLength(canonicalJSON(d))<=32768);return d;};
export function intakeProtectedInstallation(input){
 const c=copy(input);decoderExact(c,['schema','binding','policy','storage','maxOperations']);
 decoderExact(c.binding,['schema','environment','policyHash','storageHash']);decoderExact(c.policy,policyKeys);decoderExact(c.storage,['schema','storageId','environment','retentionRef','keyId','maxObjectBytes']);
 const b=c.binding,p=c.policy,s=c.storage;
 check(c.schema==='atlas-proof-intake-installed-v1'&&b.schema==='atlas-marketplace-proof-intake-v1'&&['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(b.environment)&&p.environment===b.environment&&s.environment===b.environment,'INTAKE_PROTECTED_AUTHORITY_NOT_IMPLEMENTED');
 check(digest(b.policyHash)&&digest(b.storageHash)&&hash(p)===b.policyHash&&hash(s)===b.storageHash);
 for(const k of ['id','version','approvalRef','retentionRef','reviewerAuthorityRef'])check(text(p[k]));
 for(const k of policyKeys.slice(6))check(integer(p[k]));
 check(p.expiresAt>p.effectiveAt&&p.retentionMs>0&&integer(p.maxObjectBytes,1,10485760)&&integer(p.maxProofsPerOrder,1,50)&&integer(p.maxRetainedObjects,1,100000)&&integer(p.uploadTtlMs,1,900000)&&integer(p.validationLeaseMs,15000,120000));
 check(s.schema==='atlas-marketplace-proof-encrypted-v1'&&text(s.storageId)&&text(s.retentionRef)&&s.retentionRef===p.retentionRef&&typeof s.keyId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s.keyId)&&integer(s.maxObjectBytes,p.maxObjectBytes,10485760)&&integer(c.maxOperations,2,4096));
 return decoderFreeze(c);
}
export function intakeProtectedOperation(input,installation){
 const c=intakeProtectedInstallation(installation),o=copy(input);check(o.kind==='CREATE'||o.kind==='VALIDATE');
 decoderExact(o,['schema','operationId','kind','atMs','bindingHash',...(o.kind==='CREATE'?['actor','request']:['createOperationId','createOperationHash','expectedUploadHash','validationAttemptId','decoderRequestId','validation'])]);
 check(o.schema==='atlas-proof-intake-operation-v1'&&uuid(o.operationId)&&integer(o.atMs)&&o.bindingHash===hash(c.binding));
 if(o.kind==='CREATE'){
  decoderExact(o.actor,['id','role']);decoderExact(o.request,['requestId','orderId','purpose','declaredType','byteCount','sha256']);const r=o.request;
  check(actorId(o.actor.id,c)&&['BUYER','STAFF'].includes(o.actor.role)&&id(r.requestId,c)&&id(r.orderId,c)&&purposes.includes(r.purpose)&&['image/png','image/jpeg'].includes(r.declaredType)&&integer(r.byteCount,1,c.policy.maxObjectBytes)&&digest(r.sha256));
 }else{check(uuid(o.createOperationId)&&digest(o.createOperationHash)&&digest(o.expectedUploadHash)&&uuid(o.validationAttemptId)&&uuid(o.decoderRequestId));assertProofDecoderValidation(o.validation);}
 return decoderFreeze(o);
}
export const intakeProtectedUploadId=(o,c)=>prefix(c)+'upload_'+hash({actorId:o.actor.id,role:o.actor.role,requestId:o.request.requestId}).slice(0,32);
function orderAt(state,actor,orderId,purpose,now){
 const order=state.orders?.[orderId],payment=state.intents?.[order?.paymentIntentId];
 check(order&&payment?.kind==='PAYMENT'&&payment.status==='SUCCEEDED'&&payment.confirmed===true&&payment.orderId===orderId&&payment.bindingHash===order.bindingHash,'INTAKE_PROTECTED_ORDER_HOLD');
 const b=Object.fromEntries(['orderId','cardId','buyerId','sellerId','bindingHash','policyVersion'].map(k=>[k,order[k]]));check(Object.values(b).every(text)&&b.orderId===orderId);
 check(actor.role==='BUYER'?b.buyerId===actor.id&&purpose==='RETURN_REQUEST':purpose!=='RETURN_REQUEST','INTAKE_PROTECTED_ORDER_HOLD');
 if(actor.role==='BUYER'){const f=state.fulfillment?.[orderId];check(f&&integer(f.deliveredAt)&&f.releaseNotBefore===f.deliveredAt+86400000&&now>=f.deliveredAt&&now<f.releaseNotBefore,'INTAKE_PROTECTED_ORDER_HOLD');}
 return b;
}
// Closed observed counts, not authority. Outstanding original CREATE records
// reserve their future VALIDATE row; expiry/failure never releases that slot.
export function intakeProtectedCapacity(input,installation,kind){
 const c=intakeProtectedInstallation(installation),v=copy(input);decoderExact(v,['schema','operations','creates','validations','reservedValidations']);
 check(v.schema==='atlas-proof-intake-capacity-v1'&&['operations','creates','validations','reservedValidations'].every(k=>integer(v[k],0,c.maxOperations))&&v.validations<=v.creates&&v.operations===v.creates+v.validations&&v.reservedValidations===v.creates-v.validations&&v.operations+v.reservedValidations<=c.maxOperations,'INTAKE_PROTECTED_CAPACITY_HOLD');
 check(kind==='CREATE'||kind==='VALIDATE');check(kind==='CREATE'?v.operations+v.reservedValidations+2<=c.maxOperations:v.reservedValidations>0&&v.operations<c.maxOperations,'INTAKE_PROTECTED_CAPACITY');
 return decoderFreeze(v);
}
// Pure projection used by the concrete adapter. Tests are algorithm evidence,
// never a positive database/decoder/actor capability. Existing rows are copied.
export function projectIntakeProtectedOperation(state,input,installation,originalCreate=null,capacity){
 const c=intakeProtectedInstallation(installation),o=intakeProtectedOperation(input,c),p=c.policy;intakeProtectedCapacity(capacity,c,o.kind);
 check(integer(o.atMs,p.effectiveAt,p.expiresAt-1),'INTAKE_PROTECTED_EXPIRED');
 check(state&&Object.getPrototypeOf(state)===Object.prototype&&Array.isArray(state.events));
 const uploads=state.marketplaceProofUploads??{};check(uploads&&Object.getPrototypeOf(uploads)===Object.prototype);
 let upload,event;
 if(o.kind==='CREATE'){
  const uploadId=intakeProtectedUploadId(o,c),r=o.request,b=orderAt(state,o.actor,r.orderId,r.purpose,o.atMs);
  check(!Object.hasOwn(uploads,uploadId),'INTAKE_PROTECTED_ORIGINAL_HOLD');
  const rows=Object.values(uploads);check(rows.length<p.maxRetainedObjects&&rows.filter(v=>v?.orderId===r.orderId).length<p.maxProofsPerOrder,'INTAKE_PROTECTED_QUOTA');
  const expiresAt=Math.min(o.atMs+p.uploadTtlMs,p.expiresAt),retainUntil=o.atMs+p.retentionMs;check(integer(expiresAt)&&integer(retainUntil)&&expiresAt>o.atMs&&retainUntil>o.atMs);
  upload={uploadId,proofId:prefix(c)+'proof_'+hash(uploadId).slice(0,32),objectKey:hash({binding:c.binding,uploadId}),requestHash:hash(r),actorId:o.actor.id,actorRole:o.actor.role,orderId:r.orderId,orderBinding:b,orderHash:hash(b),purpose:r.purpose,plan:{declaredType:r.declaredType,byteCount:r.byteCount,sha256:r.sha256},status:'PREPARED',createdAt:o.atMs,expiresAt,retainUntil,attempts:0,policyHash:c.binding.policyHash};
  event={type:'MARKETPLACE_PROOF_PREPARED',payload:{uploadId,orderId:r.orderId,purpose:r.purpose,actorId:o.actor.id}};
 }else{
  check(originalCreate,'INTAKE_PROTECTED_ORIGINAL_HOLD');const rec=intakeProtectedRecord(originalCreate,c);check(rec.operation.kind==='CREATE'&&rec.operation.operationId===o.createOperationId&&rec.operationHash===o.createOperationHash,'INTAKE_PROTECTED_ORIGINAL_HOLD');
  const prior=rec.upload,current=uploads[prior.uploadId];check(current&&equal(current,prior)&&hash(current)===o.expectedUploadHash&&current.status==='PREPARED'&&current.attempts===0,'INTAKE_PROTECTED_ORIGINAL_HOLD');
  const b=orderAt(state,{id:current.actorId,role:current.actorRole},current.orderId,current.purpose,o.atMs);check(equal(b,current.orderBinding)&&o.atMs>=current.createdAt&&o.atMs<current.expiresAt,'INTAKE_PROTECTED_EXPIRED');
  const v=o.validation;check(v.contentType===current.plan.declaredType&&v.byteCount===current.plan.byteCount&&v.sha256===current.plan.sha256,'INTAKE_PROTECTED_ORIGINAL_HOLD');
  // Legacy attempts are not retrospectively recategorized. New operational and
  // content accounting must be joined to the existing lifecycle before shipping.
  upload={...clone(current),status:'VALIDATED',manifest:{schema:'atlas-marketplace-retained-proof-v1',proofId:current.proofId,uploadId:current.uploadId,environment:c.binding.environment,storageId:c.storage.storageId,retentionRef:p.retentionRef,retainUntil:current.retainUntil,createdAt:current.createdAt,validatedAt:o.atMs,policyHash:current.policyHash,orderBinding:clone(current.orderBinding),actorId:current.actorId,actorRole:current.actorRole,purpose:current.purpose,byteCount:current.plan.byteCount,sha256:current.plan.sha256,validation:clone(v)}};
  event={type:'MARKETPLACE_PROOF_VALIDATED',payload:{uploadId:current.uploadId,operationId:o.operationId,validationAttemptId:o.validationAttemptId,decoderRequestId:o.decoderRequestId}};
 }
 check(!Object.hasOwn(state.marketplaceProofObjects??{},upload.proofId)&&!Object.hasOwn(state.marketplaceProofReviews??{},upload.proofId),'INTAKE_PROTECTED_ORIGINAL_HOLD');
 const next=clone(state);next.marketplaceProofUploads={...clone(uploads),[upload.uploadId]:upload};next.events.push({...event,sequence:state.events.length+1,at:o.atMs,environment:c.binding.environment});
 return {next,upload:clone(upload),dispatchKey:hash({kind:o.kind,uploadId:upload.uploadId})};
}
const samePlan=(p,r)=>p.declaredType===r.declaredType&&p.byteCount===r.byteCount&&p.sha256===r.sha256;
export function intakeProtectedRecord(input,installation){
 const c=intakeProtectedInstallation(installation),r=copy(input);decoderExact(r,['schema','operation','operationHash','dispatchKey','upload','uploadHash','revision']);const o=intakeProtectedOperation(r.operation,c);
 check(r.schema==='atlas-proof-intake-record-v1'&&r.operationHash===hash(o)&&digest(r.uploadHash)&&r.uploadHash===hash(r.upload)&&integer(r.revision,1)&&r.dispatchKey===hash({kind:o.kind,uploadId:r.upload.uploadId}));
 const u=r.upload;decoderExact(u,['uploadId','proofId','objectKey','requestHash','actorId','actorRole','orderId','orderBinding','orderHash','purpose','plan','status','createdAt','expiresAt','retainUntil','attempts','policyHash',...(o.kind==='VALIDATE'?['manifest']:[])]);
 decoderExact(u.plan,['declaredType','byteCount','sha256']);decoderExact(u.orderBinding,['orderId','cardId','buyerId','sellerId','bindingHash','policyVersion']);
 check(id(u.uploadId,c)&&u.proofId===prefix(c)+'proof_'+hash(u.uploadId).slice(0,32)&&u.objectKey===hash({binding:c.binding,uploadId:u.uploadId})&&u.policyHash===c.binding.policyHash&&digest(u.requestHash)&&actorId(u.actorId,c)&&id(u.orderId,c)&&['BUYER','STAFF'].includes(u.actorRole)&&purposes.includes(u.purpose)&&Object.values(u.orderBinding).every(text)&&u.orderBinding.orderId===u.orderId&&u.orderHash===hash(u.orderBinding));
 check(['image/png','image/jpeg'].includes(u.plan.declaredType)&&integer(u.plan.byteCount,1,c.policy.maxObjectBytes)&&digest(u.plan.sha256)&&integer(u.createdAt,c.policy.effectiveAt,c.policy.expiresAt-1)&&u.expiresAt===Math.min(u.createdAt+c.policy.uploadTtlMs,c.policy.expiresAt)&&integer(u.expiresAt,u.createdAt+1)&&u.retainUntil===u.createdAt+c.policy.retentionMs&&integer(u.retainUntil,u.createdAt+1)&&u.attempts===0);
 check(u.actorRole==='BUYER'?u.orderBinding.buyerId===u.actorId&&u.purpose==='RETURN_REQUEST':u.purpose!=='RETURN_REQUEST');
 if(o.kind==='CREATE')check(u.uploadId===intakeProtectedUploadId(o,c)&&u.status==='PREPARED'&&u.requestHash===hash(o.request)&&u.createdAt===o.atMs&&u.actorId===o.actor.id&&u.actorRole===o.actor.role&&u.orderId===o.request.orderId&&u.purpose===o.request.purpose&&samePlan(u.plan,o.request));
 else{
  const m=u.manifest;decoderExact(m,['schema','proofId','uploadId','environment','storageId','retentionRef','retainUntil','createdAt','validatedAt','policyHash','orderBinding','actorId','actorRole','purpose','byteCount','sha256','validation']);
  check(u.status==='VALIDATED'&&m.schema==='atlas-marketplace-retained-proof-v1'&&m.environment===c.binding.environment&&m.storageId===c.storage.storageId&&m.retentionRef===c.policy.retentionRef&&m.validatedAt===o.atMs&&o.atMs>=u.createdAt&&o.atMs<u.expiresAt&&equal(m.validation,o.validation)&&m.byteCount===u.plan.byteCount&&m.sha256===u.plan.sha256&&o.validation.contentType===u.plan.declaredType&&o.validation.byteCount===u.plan.byteCount&&o.validation.sha256===u.plan.sha256);
  for(const k of ['proofId','uploadId','retainUntil','createdAt','policyHash','orderBinding','actorId','actorRole','purpose'])check(equal(m[k],u[k]));
 }
 return decoderFreeze(r);
}
