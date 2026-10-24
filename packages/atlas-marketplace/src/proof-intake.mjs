import { randomUUID } from 'node:crypto';
import { clone, hash, requireValue } from './contract.mjs';
import { authorityContext, authorityId, domainId } from './authority-context.mjs';
import { assertProofStorage } from './proof-storage.mjs';
import { assertProofImageValidator, PROOF_IMAGE_LIMITS } from './proof-image.mjs';

const instances = new WeakMap();
export const PROOF_PURPOSES = Object.freeze(['RETURN_REQUEST','PACK','DISPATCH','DELIVERY','RELEASE','RETURN_INSPECTION','RETURN_REVIEW','REFUND_REVIEW']);
export const PROOF_EVIDENCE_KINDS = Object.freeze(['FULFILLMENT','RETURN_REQUEST','RETURN_REQUEST_REVIEW','CASE_RESOLUTION','REFUND_REVIEW']);
const DAY = 86400000;
const text = value => typeof value==='string' && value.trim()===value && value.length>0 && value.length<=500;
const sync = (fn,args,code) => { requireValue(typeof fn==='function',code); const result=fn(...args); if(result&&typeof result.then==='function')void Promise.resolve(result).catch(()=>{}); requireValue(result===true,code); };
function policyCheck(value,context) {
  requireValue(value && value.environment===context.environment,'PROOF_POLICY_REQUIRED');
  for(const key of ['id','version','approvalRef','retentionRef','reviewerAuthorityRef'])requireValue(text(value[key]),'PROOF_POLICY_REQUIRED');
  for(const key of ['effectiveAt','expiresAt','retentionMs','maxObjectBytes','maxProofsPerOrder','maxRetainedObjects','uploadTtlMs','validationLeaseMs'])requireValue(Number.isSafeInteger(value[key])&&value[key]>=0,'PROOF_POLICY_REQUIRED');
  requireValue(value.expiresAt>value.effectiveAt && value.retentionMs>0 && value.maxObjectBytes>0 && value.maxObjectBytes<=PROOF_IMAGE_LIMITS.maxObjectBytes && value.maxProofsPerOrder>0&&value.maxProofsPerOrder<=50&&value.maxRetainedObjects>0&&value.maxRetainedObjects<=100000&&value.uploadTtlMs>0&&value.uploadTtlMs<=900000&&value.validationLeaseMs>=PROOF_IMAGE_LIMITS.timeoutMs&&value.validationLeaseMs<=120000,'PROOF_POLICY_REQUIRED');
  return clone(value);
}
const maps = state => ({uploads:state.marketplaceProofUploads??={},objects:state.marketplaceProofObjects??={},reviews:state.marketplaceProofReviews??={}});
const orderBinding = order => ({orderId:order.orderId,cardId:order.cardId,buyerId:order.buyerId,sellerId:order.sellerId,bindingHash:order.bindingHash,policyVersion:order.policyVersion});
function paidOrder(state,orderId){const order=state.orders[orderId],payment=state.intents[order?.paymentIntentId];requireValue(order&&payment?.kind==='PAYMENT'&&payment.status==='SUCCEEDED'&&payment.confirmed===true&&payment.orderId===orderId&&payment.bindingHash===order.bindingHash,'PROOF_ORDER_UNAVAILABLE');return order;}
function returnsOpen(state,order,now){const f=state.fulfillment[order.orderId];requireValue(f&&Number.isSafeInteger(f.deliveredAt)&&f.releaseNotBefore===f.deliveredAt+DAY&&now>=f.deliveredAt&&now<f.releaseNotBefore,'RETURN_WINDOW_CLOSED');}
function projection(upload,state){const proof=state.marketplaceProofObjects?.[upload.proofId],review=state.marketplaceProofReviews?.[upload.proofId];return {uploadId:upload.uploadId,proofId:proof?.proofId??null,orderId:upload.orderId,purpose:upload.purpose,status:upload.status,declaredType:upload.plan.declaredType,byteCount:upload.plan.byteCount,sha256:upload.plan.sha256,expiresAt:upload.expiresAt,createdAt:upload.createdAt,reviewStatus:review?.decision??'NOT_REVIEWED'};}

/** Explicit, private, same-store intake. Policy references and role labels do
 * not authorize themselves: host readiness and current actor/reviewer grants
 * must be independently checked synchronously at every commit and read. */
export function createMarketplaceProofIntake({enabled=false,store,context:suppliedContext,policy:suppliedPolicy,storage,validator,assertReady,authorize,clock=Date.now}={}) {
  const context=authorityContext(suppliedContext);
  if(!enabled)return Object.freeze({enabled:false});
  requireValue(store&&typeof store.read==='function'&&typeof store.transaction==='function','PROOF_STORE_REQUIRED');
  const policy=policyCheck(suppliedPolicy,context),policyHash=hash(policy);
  assertProofStorage(storage,{environment:context.environment,retentionRef:policy.retentionRef}); assertProofImageValidator(validator);
  requireValue(storage.binding.maxObjectBytes>=policy.maxObjectBytes && validator.limits.maxObjectBytes>=policy.maxObjectBytes,'PROOF_LIMIT_MISMATCH');
  const binding=Object.freeze({schema:'atlas-marketplace-proof-intake-v1',environment:context.environment,policyHash,storageHash:hash(storage.binding)}),pending=new Set();
  const prefix=context.environment==='SYNTHETIC_LOCAL'?'demo_':'atlas_';
  function runtimeReady(now=clock()) {
    requireValue(Number.isSafeInteger(now)&&now>=policy.effectiveAt&&now<policy.expiresAt,'PROOF_POLICY_UNAVAILABLE');
    sync(assertReady,[binding],'PROOF_RUNTIME_UNAVAILABLE');return true;
  }
  function check(actor,action,scope={},options={},now=clock()) {
    runtimeReady(now);
    authorityId(actor?.id,'actor',context);requireValue(['BUYER','STAFF'].includes(actor?.role),'PROOF_ACCESS_REFUSED');
    if(options.authorizeCommit)sync(options.authorizeCommit,[],'PROOF_ACCESS_REFUSED');
    sync(authorize,[actor,{action,...scope,policyHash}],'PROOF_ACCESS_REFUSED');
  }
  async function refresh(actor,action,scope,options) {
    check(actor,action,scope,options);
    if(options.refreshAuthorization!==undefined){requireValue(typeof options.refreshAuthorization==='function','PROOF_ACCESS_REFUSED');requireValue(await options.refreshAuthorization()===true,'PROOF_ACCESS_REFUSED');}
    check(actor,action,scope,options);
  }
  function authorizedOrder(state,actor,orderId,purpose,writing=false,now=clock()) {
    domainId(orderId,'order',context);requireValue(PROOF_PURPOSES.includes(purpose),'PROOF_PURPOSE_INVALID');
    const order=paidOrder(state,orderId);
    if(actor.role==='BUYER'){requireValue(order.buyerId===actor.id&&purpose==='RETURN_REQUEST','PROOF_ACCESS_REFUSED');if(writing)returnsOpen(state,order,now);}
    else requireValue(actor.role==='STAFF'&&(!writing||purpose!=='RETURN_REQUEST'),'PROOF_ACCESS_REFUSED');
    return order;
  }
  function uploadRow(state,actor,uploadId,writing=false,now=clock()) {
    domainId(uploadId,'upload',context);const row=state.marketplaceProofUploads?.[uploadId];requireValue(row,'PROOF_UNAVAILABLE');
    const order=authorizedOrder(state,actor,row.orderId,row.purpose,writing,now);
    requireValue(hash(orderBinding(order))===row.orderHash,'PROOF_BINDING_MISMATCH');
    if(writing||actor.role==='BUYER')requireValue(row.actorId===actor.id&&row.actorRole===actor.role,'PROOF_ACCESS_REFUSED');
    return row;
  }
  function proofRow(state,actor,proofId){domainId(proofId,'proof',context);const proof=state.marketplaceProofObjects?.[proofId];requireValue(proof,'PROOF_UNAVAILABLE');const upload=uploadRow(state,actor,proof.uploadId);requireValue(upload.status==='RETAINED'&&upload.proofId===proofId&&hash(proof.manifest)===proof.manifestHash,'PROOF_BINDING_MISMATCH');return {proof,upload};}
  function retained(row){const found=storage.get({objectKey:row.objectKey});requireValue(found&&row.manifest&&found.manifestHash===hash(row.manifest)&&hash(found.manifest)===hash(row.manifest),'PROOF_RETAINED_OBJECT_UNAVAILABLE');return found;}
  async function finish(actor,uploadId,options) {
    await refresh(actor,'UPLOAD',{},options);return store.transaction(tx=>{
    const row=uploadRow(tx.state,actor,uploadId);check(actor,'UPLOAD',{orderId:row.orderId,purpose:row.purpose},options,tx.now);
    if(row.status==='RETAINED')return projection(row,tx.state);
    requireValue(row.actorId===actor.id&&row.actorRole===actor.role&&row.status==='VALIDATED','PROOF_UPLOAD_NOT_READY');
    const original=retained(row);original.bytes.fill(0);
    const {objects}=maps(tx.state);requireValue(!objects[row.proofId],'PROOF_OBJECT_CONFLICT');
    objects[row.proofId]={proofId:row.proofId,uploadId,objectKey:row.objectKey,manifest:clone(row.manifest),manifestHash:hash(row.manifest),retainedAt:tx.now};
    row.status='RETAINED';row.completedAt=tx.now;
    tx.emit('MARKETPLACE_PROOF_RETAINED',{proofId:row.proofId,orderId:row.orderId,purpose:row.purpose,actorId:actor.id});return projection(row,tx.state);
  });}
  function refsFor(kind,input) {
    if(kind==='RETURN_REQUEST')return {purpose:'RETURN_REQUEST',refs:[input.evidenceRef],reviewed:false};
    if(kind==='RETURN_REQUEST_REVIEW')return {purpose:'RETURN_REVIEW',refs:[input.reviewRef],reviewed:true};
    if(kind==='REFUND_REVIEW')return {purpose:'REFUND_REVIEW',refs:[input.reviewRef],reviewed:true};
    if(kind==='CASE_RESOLUTION')return {purpose:'RETURN_INSPECTION',refs:[input.evidence?.ref,...['receivedParcelRef','inspectionFrontRef','inspectionBackRef','holderInspectionRef'].map(k=>input.evidence?.[k])],reviewed:true};
    if(kind==='FULFILLMENT'&&input.action==='PACK')return {purpose:'PACK',refs:[input.evidence?.ref,...['intakeFrontRef','intakeBackRef','holderConditionRef','packingPhotoRef','fittedInsertRef','firstSealRef','secondSealRef','cleanLabelAreaRef','resaleInstructionsRef','replacementKitRef'].map(k=>input.evidence?.[k])],reviewed:true};
    if(kind==='FULFILLMENT'&&input.action==='RELEASE')return {purpose:'RELEASE',refs:[input.evidence?.ref,input.evidence?.releaseReviewRef],reviewed:true};
    requireValue(false,'PROOF_EVIDENCE_KIND_UNSUPPORTED');
  }
  function assertEvidence(tx,{kind,actor,input},options={}) {
    const spec=refsFor(kind,input);check(actor,'VALIDATE',{orderId:input.orderId,purpose:spec.purpose},options,tx.now);
    const order=authorizedOrder(tx.state,actor,input.orderId,spec.purpose,false,tx.now);
    if(spec.purpose==='RETURN_REQUEST')requireValue(actor.role==='BUYER'&&actor.id===order.buyerId,'PROOF_ACCESS_REFUSED');
    else requireValue(actor.role==='STAFF','PROOF_ACCESS_REFUSED');
    for(const id of new Set(spec.refs)) {
      const {proof,upload}=proofRow(tx.state,actor,id);
      requireValue(upload.orderId===input.orderId&&upload.purpose===spec.purpose,'PROOF_BINDING_MISMATCH');
      if(spec.reviewed){const review=tx.state.marketplaceProofReviews?.[id];requireValue(review?.decision==='APPROVE'&&review.manifestHash===proof.manifestHash&&review.policyHash===policyHash,'PROOF_REVIEW_REQUIRED');}
    }
    return true;
  }
  const intake=Object.freeze({enabled:true,binding,limits:Object.freeze({maxObjectBytes:policy.maxObjectBytes,formats:PROOF_IMAGE_LIMITS.formats}),
    assertReady(){runtimeReady();assertProofStorage(storage,{environment:context.environment,retentionRef:policy.retentionRef});return true;},
    async prepare(actor,input,options={}) {
      check(actor,'PREPARE',{orderId:input.orderId,purpose:input.purpose},options);domainId(input.requestId,'request',context);
      requireValue(input&&Object.keys(input).every(k=>['requestId','orderId','purpose','declaredType','byteCount','sha256'].includes(k))&&PROOF_IMAGE_LIMITS.formats.includes(input.declaredType)&&Number.isSafeInteger(input.byteCount)&&input.byteCount>0&&input.byteCount<=policy.maxObjectBytes&&typeof input.sha256==='string'&&/^[a-f0-9]{64}$/.test(input.sha256),'PROOF_PLAN_INVALID');
      const requestHash=hash(input),uploadId=prefix+'upload_'+hash({actorId:actor.id,role:actor.role,requestId:input.requestId}).slice(0,32);
      await refresh(actor,'PREPARE',{orderId:input.orderId,purpose:input.purpose},options);
      return store.transaction(tx=>{
        check(actor,'PREPARE',{orderId:input.orderId,purpose:input.purpose},options,tx.now);const {uploads}=maps(tx.state),prior=uploads[uploadId];
        if(prior){requireValue(prior.requestHash===requestHash,'IDEMPOTENCY_CONFLICT');uploadRow(tx.state,actor,uploadId);return projection(prior,tx.state);}
        const order=authorizedOrder(tx.state,actor,input.orderId,input.purpose,true,tx.now),rows=Object.values(uploads);
        requireValue(rows.length<policy.maxRetainedObjects&&rows.filter(r=>r.orderId===input.orderId).length<policy.maxProofsPerOrder,'PROOF_QUOTA_EXCEEDED');
        const expiresAt=Math.min(tx.now+policy.uploadTtlMs,policy.expiresAt),retainUntil=tx.now+policy.retentionMs;
        requireValue(Number.isSafeInteger(expiresAt)&&Number.isSafeInteger(retainUntil),'PROOF_TIME_INVALID');
        const row={uploadId,proofId:prefix+'proof_'+hash(uploadId).slice(0,32),objectKey:hash({binding,uploadId}),requestHash,actorId:actor.id,actorRole:actor.role,orderId:input.orderId,orderBinding:orderBinding(order),orderHash:hash(orderBinding(order)),purpose:input.purpose,plan:{declaredType:input.declaredType,byteCount:input.byteCount,sha256:input.sha256},status:'PREPARED',createdAt:tx.now,expiresAt,retainUntil,attempts:0,policyHash};
        uploads[uploadId]=row;tx.emit('MARKETPLACE_PROOF_PREPARED',{uploadId,orderId:row.orderId,purpose:row.purpose,actorId:actor.id});return projection(row,tx.state);
      });
    },
    async upload(actor,{uploadId,bytes},options={}) {
      check(actor,'UPLOAD',{},options);requireValue(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=policy.maxObjectBytes,'PROOF_SOURCE_MISMATCH');
      requireValue(pending.size<2&&!pending.has(uploadId),'PROOF_UPLOAD_BUSY');pending.add(uploadId);const original=Buffer.from(bytes);
      try {
        let row=await store.read(state=>clone(uploadRow(state,actor,uploadId)));check(actor,'UPLOAD',{orderId:row.orderId,purpose:row.purpose},options);
        requireValue(original.length===row.plan.byteCount&&createDigest(original)===row.plan.sha256,'PROOF_SOURCE_MISMATCH');
        if(row.status==='RETAINED'){const saved=retained(row);saved.bytes.fill(0);await refresh(actor,'UPLOAD',{orderId:row.orderId,purpose:row.purpose},options);return store.read(state=>{const current=uploadRow(state,actor,uploadId);check(actor,'UPLOAD',{orderId:current.orderId,purpose:current.purpose},options);return projection(current,state);});}
        if(row.status!=='VALIDATED') {
          await refresh(actor,'UPLOAD',{orderId:row.orderId,purpose:row.purpose},options);
          const lease=randomUUID();row=await store.transaction(tx=>{
            const current=uploadRow(tx.state,actor,uploadId,true,tx.now);check(actor,'UPLOAD',{orderId:current.orderId,purpose:current.purpose},options,tx.now);
            requireValue(tx.now<current.expiresAt,'PROOF_UPLOAD_EXPIRED');requireValue(current.status==='PREPARED'||current.status==='VALIDATING'&&tx.now>=current.leaseUntil,'PROOF_UPLOAD_BUSY');requireValue(current.attempts<3,'PROOF_UPLOAD_ATTEMPTS_EXHAUSTED');
            current.status='VALIDATING';current.lease=lease;current.leaseUntil=tx.now+policy.validationLeaseMs;current.attempts++;return clone(current);
          });
          let validation;
          try {validation=await validator.validate({bytes:original,plan:row.plan});}
          catch(error){await refresh(actor,'UPLOAD',{orderId:row.orderId,purpose:row.purpose},options);await store.transaction(tx=>{const current=uploadRow(tx.state,actor,uploadId);check(actor,'UPLOAD',{orderId:current.orderId,purpose:current.purpose},options,tx.now);if(current.status==='VALIDATING'&&current.lease===lease){current.status=['PROOF_VALIDATOR_TIMEOUT','PROOF_VALIDATOR_BUSY','PROOF_DECODER_UNAVAILABLE'].includes(error.code)?'PREPARED':'REJECTED';current.failureCode=error.code??'PROOF_IMAGE_INVALID';}});throw error;}
          await refresh(actor,'UPLOAD',{orderId:row.orderId,purpose:row.purpose},options);
          row=await store.transaction(tx=>{const current=uploadRow(tx.state,actor,uploadId,true,tx.now);check(actor,'UPLOAD',{orderId:current.orderId,purpose:current.purpose},options,tx.now);requireValue(current.status==='VALIDATING'&&current.lease===lease&&tx.now<current.leaseUntil&&tx.now<current.expiresAt,'PROOF_UPLOAD_EXPIRED');
            current.status='VALIDATED';current.manifest={schema:'atlas-marketplace-retained-proof-v1',proofId:current.proofId,uploadId,environment:context.environment,storageId:storage.binding.storageId,retentionRef:policy.retentionRef,retainUntil:current.retainUntil,createdAt:current.createdAt,validatedAt:tx.now,policyHash,orderBinding:current.orderBinding,actorId:actor.id,actorRole:actor.role,purpose:current.purpose,byteCount:current.plan.byteCount,sha256:current.plan.sha256,validation};return clone(current);});
        }
        // Reusing a completed validation can only retain the same original hash,
        // order, actor and purpose. No replacement object key can be selected.
        await refresh(actor,'UPLOAD',{orderId:row.orderId,purpose:row.purpose},options);
        const publication=await store.read(state=>{const current=uploadRow(state,actor,uploadId,true);return {expiresAt:current.expiresAt,deliveredAt:state.fulfillment[row.orderId]?.deliveredAt,releaseNotBefore:state.fulfillment[row.orderId]?.releaseNotBefore};});
        check(actor,'UPLOAD',{orderId:row.orderId,purpose:row.purpose},options);
        const publicationNow=clock();requireValue(publicationNow<publication.expiresAt,'PROOF_UPLOAD_EXPIRED');
        if(actor.role==='BUYER')requireValue(Number.isSafeInteger(publication.deliveredAt)&&publication.releaseNotBefore===publication.deliveredAt+DAY&&publicationNow>=publication.deliveredAt&&publicationNow<publication.releaseNotBefore,'RETURN_WINDOW_CLOSED');
        storage.put({objectKey:row.objectKey,manifest:row.manifest,bytes:original});
        check(actor,'UPLOAD',{orderId:row.orderId,purpose:row.purpose},options);
        return await finish(actor,uploadId,options);
      }finally{original.fill(0);pending.delete(uploadId);}
    },
    async recover(actor,{uploadId},options={}) {
      check(actor,'RECOVER',{},options);const row=await store.read(state=>clone(uploadRow(state,actor,uploadId)));check(actor,'RECOVER',{orderId:row.orderId,purpose:row.purpose},options);
      if(row.status==='RETAINED'){const object=retained(row);object.bytes.fill(0);}
      if(row.status==='VALIDATED'){const object=storage.get({objectKey:row.objectKey});if(object){requireValue(object.manifestHash===hash(row.manifest),'PROOF_BINDING_MISMATCH');object.bytes.fill(0);return finish(actor,uploadId,options);}}
      await refresh(actor,'RECOVER',{orderId:row.orderId,purpose:row.purpose},options);
      return store.read(state=>{const current=uploadRow(state,actor,uploadId);check(actor,'RECOVER',{orderId:current.orderId,purpose:current.purpose},options);return projection(current,state);});
    },
    async read(actor,{proofId},options={}) {
      check(actor,'READ',{proofId},options);const row=await store.read(state=>proofRow(state,actor,proofId));check(actor,'READ',{proofId,orderId:row.upload.orderId,purpose:row.upload.purpose},options);
      const object=retained(row.upload);try {await store.read(state=>proofRow(state,actor,proofId));await refresh(actor,'READ',{proofId,orderId:row.upload.orderId,purpose:row.upload.purpose},options);check(actor,'READ',{proofId,orderId:row.upload.orderId,purpose:row.upload.purpose},options);return {authorized:true,bytes:Buffer.from(object.bytes),contentType:row.upload.plan.declaredType,sha256:row.upload.plan.sha256,byteCount:object.bytes.length};}finally{object.bytes.fill(0);}
    },
    async list(actor,{orderId},options={}) {
      check(actor,'LIST',{orderId},options);const result=await store.read(state=>{check(actor,'LIST',{orderId},options);const order=paidOrder(state,orderId);requireValue(actor.role==='STAFF'||actor.role==='BUYER'&&order.buyerId===actor.id,'PROOF_ACCESS_REFUSED');return {orderId,proofs:Object.values(state.marketplaceProofUploads??{}).filter(row=>row.orderId===orderId&&(actor.role==='STAFF'||row.actorId===actor.id&&row.purpose==='RETURN_REQUEST')).map(row=>projection(row,state)),limits:{maxObjectBytes:policy.maxObjectBytes,formats:[...PROOF_IMAGE_LIMITS.formats]}};});
      await refresh(actor,'LIST',{orderId},options);return result;
    },
    async review(actor,{requestId,proofId,decision,reviewRef,facts={}},options={}) {
      check(actor,'REVIEW',{proofId},options);requireValue(actor.role==='STAFF'&&['APPROVE','REJECT'].includes(decision),'PROOF_REVIEW_REFUSED');domainId(requestId,'review request',context);domainId(reviewRef,'review reference',context);
      const row=await store.read(state=>proofRow(state,actor,proofId));check(actor,'REVIEW',{proofId,orderId:row.upload.orderId,purpose:row.upload.purpose},options);const object=retained(row.upload);object.bytes.fill(0);
      if(row.upload.purpose==='DELIVERY'){requireValue(Object.keys(facts).sort().join()==='deliveredAt'&&Number.isSafeInteger(facts.deliveredAt)&&facts.deliveredAt>=0&&facts.deliveredAt<=clock(),'PROOF_REVIEW_FACTS_REQUIRED');}else requireValue(facts&&Object.keys(facts).length===0,'PROOF_REVIEW_FACTS_INVALID');
      const inputHash=hash({requestId,proofId,decision,reviewRef,facts,actorId:actor.id});
      await refresh(actor,'REVIEW',{proofId,orderId:row.upload.orderId,purpose:row.upload.purpose},options);
      return store.transaction(tx=>{const current=proofRow(tx.state,actor,proofId);check(actor,'REVIEW',{proofId,orderId:current.upload.orderId,purpose:current.upload.purpose},options,tx.now);const {reviews}=maps(tx.state),prior=reviews[proofId],receiptKey='proof-review:'+actor.id+':'+requestId,receipt=tx.state.receipts[receiptKey];
        if(receipt)requireValue(receipt.inputHash===inputHash,'IDEMPOTENCY_CONFLICT');
        if(prior){requireValue(prior.inputHash===inputHash,'PROOF_REVIEW_CONFLICT');return {proofId,decision:prior.decision,reviewRef:prior.reviewRef,reviewedAt:prior.reviewedAt};}
        reviews[proofId]={proofId,inputHash,decision,reviewRef,facts:clone(facts),actorId:actor.id,reviewedAt:tx.now,manifestHash:current.proof.manifestHash,policyHash,reviewerAuthorityRef:policy.reviewerAuthorityRef};
        tx.state.receipts[receiptKey]={inputHash,proofId};tx.emit('MARKETPLACE_PROOF_REVIEWED',{proofId,orderId:current.upload.orderId,actorId:actor.id,decision});return {proofId,decision,reviewRef,reviewedAt:tx.now};});
    },
    async validateEvidence(request,options={}) {
      requireValue(request.context===undefined||authorityContext(request.context)===context,'PROOF_CONTEXT_MISMATCH');
      const spec=refsFor(request.kind,request.input);check(request.actor,'VALIDATE',{orderId:request.input.orderId,purpose:spec.purpose},options);
      const uploads=await store.read(state=>{assertEvidence({state,now:clock()},request,options);return [...new Set(spec.refs)].map(id=>proofRow(state,request.actor,id).upload);});
      for(const upload of uploads){check(request.actor,'VALIDATE',{orderId:upload.orderId,purpose:upload.purpose},options);const object=retained(upload);object.bytes.fill(0);}
      await refresh(request.actor,'VALIDATE',{orderId:request.input.orderId,purpose:spec.purpose},options);
      return store.read(state=>assertEvidence({state,now:clock()},request,options));
    },
    assertInTransaction(tx,request,options={}){return assertEvidence(tx,request,options);}
  });
  instances.set(intake,{store,context,async authorizeCreate(authority,input){const {readR1ProofRequest}=await import('./auth-r1.mjs');const request=await readR1ProofRequest(authority),actor={id:request.actorId,role:request.actorRole};await refresh(actor,'PREPARE',{orderId:input.orderId,purpose:input.purpose},authority);return store.read(state=>{authorizedOrder(state,actor,input.orderId,input.purpose,true);check(actor,'PREPARE',{orderId:input.orderId,purpose:input.purpose},authority);return actor;});},async snapshot(authority,uploadId){const {readR1ProofRequest}=await import('./auth-r1.mjs');const request=await readR1ProofRequest(authority),actor={id:request.actorId,role:request.actorRole};await refresh(actor,'UPLOAD',{},authority);return store.read(state=>{const row=uploadRow(state,actor,uploadId,true);check(actor,'UPLOAD',{orderId:row.orderId,purpose:row.purpose},authority);requireValue(clock()<row.expiresAt,'PROOF_UPLOAD_EXPIRED');return clone(row);});}});return intake;
}
import { createHash } from 'node:crypto';
const createDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertMarketplaceProofIntake(intake,{store,context}={}) {const trusted=instances.get(intake);requireValue(trusted&&trusted.store===store&&trusted.context===authorityContext(context),'PROOF_INTAKE_UNAVAILABLE');return intake;}

// Original rows are read through this owned intake and a live canonical request.
export async function snapshotR1ProofUpload(intake,authority,uploadId){const state=instances.get(intake);requireValue(state,'PROOF_INTAKE_UNAVAILABLE');return state.snapshot(authority,uploadId);}

export async function authorizeR1ProofCreate(intake,authority,input){const state=instances.get(intake);requireValue(state,'PROOF_INTAKE_UNAVAILABLE');return state.authorizeCreate(authority,input);}
