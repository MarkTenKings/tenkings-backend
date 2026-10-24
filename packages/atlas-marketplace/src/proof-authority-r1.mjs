// Concrete canonical coordinator. It accepts existing private IO owners, never
// actor assertions, authorize callbacks, reports, qualification JSON or SQL text.
import {randomUUID,createHash} from 'node:crypto';
import {hash,canonicalJSON,requireValue} from './contract.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {decoderFreeze} from './proof-decoder-profile.mjs';
import {readR1ProofRequest} from './auth-r1.mjs';
import {snapshotR1ProofUpload,authorizeR1ProofCreate} from './proof-intake.mjs';
import {assertProofIntakeAccountedPostgres,proofIntakeAccountedAttemptSubmission} from './proof-intake-protected-postgres.mjs';
import {assertProofAuthorityPostgres,assertProofAuthorityCommittedReport} from './proof-authority-postgres.mjs';
import {assertProofDecoderTargetBrokerClient,assertProofDecoderPreparedSubmissionBeforeDeadline,assertProofDecoderClientOutcome,assertProofDecoderClientOutcomeBeforeDeadline} from './proof-decoder-target-broker.mjs';
import {assertProofPublicationLifecycleOwner} from './proof-publication-store.mjs';
import {publicationSessionBinding} from './proof-publication-lifecycle.mjs';
import {assertProofRetentionPostgresWriter,assertProofRetentionPostgresOutcome} from './proof-retention-postgres-writer.mjs';
const producers=new WeakSet(),ioOwners=new WeakSet(),check=(v,c='PROOF_AUTHORITY_JOIN_REQUIRED')=>requireValue(v,c),same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const proofProjection=row=>({uploadId:row.uploadId,proofId:null,orderId:row.orderId,purpose:row.purpose,status:row.status,declaredType:row.plan.declaredType,byteCount:row.plan.byteCount,sha256:row.plan.sha256,expiresAt:row.expiresAt,createdAt:row.createdAt,reviewStatus:'NOT_REVIEWED'});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertR1ProofAuthorityProducer(value){check(producers.has(value),'PROOF_AUTHORITY_PRODUCER_REQUIRED');return value;}
export async function createR1ProofAuthorityProducer(options={}){
 const o=engineDataOptions(options,[],['enabled','requestGateway','settlerGateway','revokerGateway','publisher','decoderClient','retentionWriter','accountedIntake','expectedDatabase','intake','sessionBinding','publisherSessionId']);
 if(o.enabled!==true)return null;
 const request=assertProofAuthorityPostgres(o.requestGateway,'REQUEST',true),settler=assertProofAuthorityPostgres(o.settlerGateway,'SETTLER',true),revoker=assertProofAuthorityPostgres(o.revokerGateway,'REVOKER',true);
 const publisher=assertProofPublicationLifecycleOwner(o.publisher,{retention:true}),client=assertProofDecoderTargetBrokerClient(o.decoderClient),writer=assertProofRetentionPostgresWriter(o.retentionWriter),binding=publicationSessionBinding(o.sessionBinding),sessionId=o.publisherSessionId,accounted=assertProofIntakeAccountedPostgres(o.accountedIntake);
 const installation=accounted.binding.installedIntake;check(installation&&same(installation.binding,o.intake?.binding)&&['PROVIDER_SANDBOX','PRODUCTION'].includes(installation.binding.environment),'PROOF_AUTHORITY_INTAKE_BINDING');
 check(accounted.binding.schema==='atlas-r1-proof-intake-connection-v1'&&writer.binding.connection.schema==='atlas-r1-proof-retention-connection-v1'&&accounted.binding.database===o.expectedDatabase&&writer.binding.connection.database===o.expectedDatabase&&same(accounted.binding.endpoint,writer.binding.connection.endpoint),'PROOF_AUTHORITY_INSTALLED_GATEWAYS_REQUIRED');
 const handles=new WeakMap(),active=new Set(),logouts=new Map(),creates=new Map();let closed=false,busy=false,poisoned=false;
 const [staffClass,customerClass]=await Promise.all([import('../../../frontend/atlas-app/lib/server/access/auth.mjs'),import('../../../frontend/atlas-customer/lib/server/auth.mjs')]);
 function ready(){check(!closed&&!poisoned,'PROOF_AUTHORITY_HELD');const s=publisher.lookupSession({sessionId}).record;check(s?.phase==='ACTIVE'&&same(s.binding,binding),'PROOF_AUTHORITY_PUBLISHER_BINDING');const status=publisher.status();check(!status.closed&&!status.poisoned,'PROOF_AUTHORITY_PUBLISHER_BINDING');return status;}
 ready();check([publisher,client,writer,accounted].every(x=>!ioOwners.has(x)),'PROOF_AUTHORITY_IO_ALREADY_OWNED');check(hash(o.intake?.binding)===binding.intakeBindingHash&&same(writer.binding.intakeBinding,o.intake.binding),'PROOF_AUTHORITY_INTAKE_BINDING');
 const common=row=>({uploadId:row.uploadId,proofId:row.proofId,orderId:row.orderId,orderHash:row.orderHash,originalRequestHash:row.requestHash,intakeBindingHash:binding.intakeBindingHash,originalSha256:row.plan.sha256,originalByteCount:row.plan.byteCount});
 async function live(authority){ready();const value=await readR1ProofRequest(authority);check(!value.signal.aborted,'PROOF_AUTHORITY_REQUEST_ENDED');return value;}
 function report(value,gateway,action){assertProofAuthorityCommittedReport(value,{gateway,action});return value;}
 async function claim(authority,stage,stageInput,priorStageId=null){
  const source=await live(authority),value={schema:'atlas-proof-stage-claim-v1',installationId:binding.installationId,requestId:source.requestId,requestBindingHash:source.requestBindingHash,source:source.source,sessionHash:source.sessionHash,browserHash:source.browserHash,configBinding:source.configBinding,originalRequestDeadlineAt:source.originalRequestDeadlineAt,stageId:randomUUID(),stage,priorStageId,stageInput};
  // The original ID is allocated once. Unknown COMMIT never mints a handle or
  // launches IO; reconciliation can only look up that original claim.
  let result;try{result=report(await request.claimStage(value),request,'claim_stage_v1');}catch(error){error.reconciliation=Object.freeze({stageId:value.stageId,claimHash:hash(value)});throw error;}
  check(result.schema==='atlas-proof-stage-report-v1'&&result.state==='OUTSTANDING'&&result.stage===stage&&result.stageBinding.stageId===value.stageId&&result.stageBinding.requestId===source.requestId&&result.stageBinding.requestBindingHash===source.requestBindingHash&&result.publisherSessionId===sessionId,'PROOF_AUTHORITY_STAGE_REFUSED');
  check(same(Object.fromEntries(Object.keys(binding).map(k=>[k,result.stageBinding[k]])),binding),'PROOF_AUTHORITY_INSTALLATION_CHANGED');
  await live(authority);return result;
 }
 async function settle(stage,disposition,outcomeHash,barrier=null){
  const result=report(await settler.settleStage({schema:'atlas-proof-stage-settle-v1',installationId:binding.installationId,stageId:stage.stageBinding.stageId,operationHash:stage.stageBinding.operationHash,settlementId:randomUUID(),disposition,outcomeHash,publisherBarrierId:barrier?.barrierId??null,publisherBarrierRevision:barrier?.barrierRevision??null}),settler,'settle_stage_v1');
  check(result.schema==='atlas-proof-stage-report-v1'&&result.stageBinding.stageId===stage.stageBinding.stageId&&result.stageBinding.operationHash===stage.stageBinding.operationHash&&result.state===({COMPLETE:'SETTLED_COMPLETE',NO_EFFECT:'SETTLED_NO_EFFECT',UNKNOWN_HELD:'UNKNOWN_HELD'}[disposition]),'PROOF_AUTHORITY_SETTLEMENT_HELD');return result;
 }
 function owned(handle,authority,phase){const e=handles.get(handle);check(e&&e.authority===authority&&e.phase===phase&&!e.signal.aborted,'PROOF_AUTHORITY_HANDLE_REQUIRED');return e;}
 async function exclusive(work){check(!busy,'PROOF_AUTHORITY_BUSY');busy=true;try{return await work();}finally{busy=false;}}
 const producer=Object.freeze({classification:'UNQUALIFIED',authority:false,
  async prepare(authority,input){return exclusive(async()=>{
   await live(authority);const requestInput=engineDataOptions(input,['requestId','orderId','purpose','declaredType','byteCount','sha256']),actor=await authorizeR1ProofCreate(o.intake,authority,requestInput),key=hash({actor,requestId:requestInput.requestId});
   const prior=creates.get(key);if(prior){check(same(prior.operation.request,requestInput),'PROOF_AUTHORITY_CREATE_CONFLICT');check(prior.result?.disposition==='COMMITTED','PROOF_AUTHORITY_CREATE_HELD');return proofProjection(prior.result.record.upload);}
   check(creates.size<installation.maxOperations,'PROOF_AUTHORITY_CAPACITY_HOLD');
   const prepared=accounted.prepareCreate({actor,request:requestInput}),operation=accounted.preparedReport(prepared),entry={prepared,operation,result:null};creates.set(key,entry);
   await live(authority);entry.result=await accounted.commitPrepared(prepared);check(entry.result.disposition==='COMMITTED','PROOF_AUTHORITY_CREATE_HELD');
   await live(authority);return proofProjection(entry.result.record.upload);
  });},
  async upload(authority,options){const handle=await producer.decode(authority,options);await producer.publish(authority,handle);return producer.retain(authority,handle);},
  async decode(authority,options){return exclusive(async()=>{
   check(active.size===0,'PROOF_AUTHORITY_BUSY');const v=engineDataOptions(options,['uploadId','bytes']),r=await live(authority),row=await snapshotR1ProofUpload(o.intake,authority,v.uploadId);
   check(Buffer.isBuffer(v.bytes)&&row.status==='PREPARED'&&row.attempts===0&&v.bytes.length===row.plan.byteCount&&digest(v.bytes)===row.plan.sha256,'PROOF_AUTHORITY_ACCOUNTED_VALIDATION_REQUIRED');
   const created=[...creates.values()].find(x=>x.result?.disposition==='COMMITTED'&&x.result.record.upload.uploadId===row.uploadId);
   check(created&&same(created.result.record.upload,row),'PROOF_AUTHORITY_ORIGINAL_CREATE_REQUIRED');
   const original=Buffer.from(v.bytes),prepared=client.prepareRequest({bytes:original,plan:row.plan,signal:r.signal}),p=assertProofDecoderPreparedSubmissionBeforeDeadline(prepared,{client});
   const e={authority,row,original,signal:r.signal,prepared,phase:'CLAIMING',stage:null,completion:null};active.add(e);const abort=()=>{e.original?.fill(0);e.original=null;};r.signal.addEventListener('abort',abort,{once:true});e.abort=abort;
   try{
    e.attempt=await accounted.reserveDecoderAttempt({createOperation:created.operation,client,prepared});e.prepared=null;
    const attempt=accounted.decoderAttemptReport(e.attempt);check(attempt.phase==='RESERVED','PROOF_AUTHORITY_ACCOUNTING_HELD');e.validationAttemptId=attempt.attemptId;
    e.stage=await claim(authority,'DECODE',{...common(row),validationAttemptId:e.validationAttemptId,decoderRequestId:p.requestId,declaredType:row.plan.declaredType,originalBootId:p.bootId,deadlineBootNs:p.deadlineBootNs,preparedReportHash:hash(p)});
    const dispatchId=randomUUID();publisher.beginDecoderDispatch({operationId:dispatchId,expectedRevision:ready().revision,sessionId,stageBinding:e.stage.stageBinding,client,prepared:proofIntakeAccountedAttemptSubmission(accounted,e.attempt)});e.phase='DISPATCHED';
    const accountedResult=await accounted.submitDecoderAttempt(e.attempt),outcome=accounted.decoderAttemptOutcome(e.attempt);
    const disposition=assertProofDecoderClientOutcome(outcome,{client});
    publisher.settleDecoderDispatch({operationId:randomUUID(),expectedRevision:publisher.status().revision,dispatchOperationId:dispatchId,client,outcome});
    const successful=disposition.disposition==='COMPLETE_CLEAN'&&disposition.completion?.outcome==='SUCCESS';
    e.stage=await settle(e.stage,successful?'COMPLETE':disposition.disposition==='UNKNOWN'?'UNKNOWN_HELD':'NO_EFFECT',hash(disposition));
    check(successful&&accountedResult.phase==='SETTLED','PROOF_AUTHORITY_DECODE_REFUSED');assertProofDecoderClientOutcomeBeforeDeadline(outcome,{client});await live(authority);
    const validation=await accounted.prepareValidationFromAttempt(e.attempt);await live(authority);
    const validated=await accounted.commitPrepared(validation);check(validated.disposition==='COMMITTED','PROOF_AUTHORITY_VALIDATION_COMMIT_REQUIRED');await live(authority);
    e.validated=validated.record;
    e.completion=outcome;e.phase='DECODED';const handle=Object.freeze({});handles.set(handle,e);return handle;
   }catch(error){
    if(e.prepared)try{client.discardPrepared(e.prepared);}catch{}e.phase='HELD';abort();if(e.stage?.state==='OUTSTANDING')poisoned=true;throw error;
   }
  });},
  async publish(authority,handle){return exclusive(async()=>{
   const e=owned(handle,authority,'DECODED');e.phase='PUBLISH_CLAIMING';await live(authority);
   const row=await snapshotR1ProofUpload(o.intake,authority,e.row.uploadId),observed=assertProofDecoderClientOutcomeBeforeDeadline(e.completion,{client});
   // VALIDATE must already be committed by the dedicated accounted gateway.
   // This coordinator never writes proof maps through a generic state writer.
   check(row.status==='VALIDATED'&&same(row,e.validated.upload)&&row.manifest&&same(common(row),common(e.row))&&same(row.manifest.validation,observed.completion.validation),'PROOF_AUTHORITY_VALIDATION_COMMIT_REQUIRED');
   const operationId=randomUUID(),manifestHash=hash(row.manifest),stage=await claim(authority,'PUBLISH',{...common(row),publicationOperationId:operationId,validationAttemptId:e.validationAttemptId,decoderRequestId:observed.request.requestId,objectKey:row.objectKey,manifestHash,decoderCompletionHash:hash(observed),publicationIntentHash:hash({operationId,objectKey:row.objectKey,manifestHash,originalSha256:row.plan.sha256})},e.stage.stageBinding.stageId);
   try{
    await live(authority);const result=publisher.publishOriginal({operationId,expectedRevision:ready().revision,sessionId,stageBinding:stage.stageBinding,objectKey:row.objectKey,manifest:row.manifest,bytes:e.original});
    e.stage=await settle(stage,'COMPLETE',hash(result));e.row=row;e.publication=result;e.phase='PUBLISHED';e.original?.fill(0);e.original=null;return handle;
   }catch(error){poisoned=true;e.phase='HELD';e.original?.fill(0);e.original=null;throw error;}
  });},
  async retain(authority,handle){return exclusive(async()=>{
   const e=owned(handle,authority,'PUBLISHED');e.phase='RETAIN_CLAIMING';await live(authority);const row=await snapshotR1ProofUpload(o.intake,authority,e.row.uploadId),found=publisher.lookupOriginal({objectKey:row.objectKey,manifestHash:hash(row.manifest)}),publication=found.publication;
   check(found.observation==='TRACKED_ORIGINAL'&&publication&&same(row,e.row),'PROOF_AUTHORITY_ORIGINAL_REQUIRED');
   const original=publisher.lookupOperation({operationId:e.stage.operationId}).record;check(original?.phase==='COMPLETED','PROOF_AUTHORITY_ORIGINAL_REQUIRED');
   const stage=await claim(authority,'RETAIN',{...common(row),operationId:randomUUID(),objectKey:row.objectKey,manifestHash:hash(row.manifest),validationAttemptId:e.validationAttemptId,decoderRequestId:assertProofDecoderClientOutcome(e.completion,{client}).request.requestId,publicationLedgerId:publisher.status().ledgerId,publicationSessionId:sessionId,publicationOperationId:e.stage.operationId,publicationRevision:original.completedRevision,publicationEvidenceHash:publication.publicationEvidenceHash,qualificationSessionId:binding.qualificationSessionId,expectedUploadHash:hash(row)},e.stage.stageBinding.stageId);
   const prepared=writer.prepareRetention({operation:stage.retentionOperation}),dispatchId=randomUUID();e.retention={stage,prepared,dispatchId};
   try{
    await live(authority);publisher.beginRetentionDispatch({operationId:dispatchId,expectedRevision:ready().revision,sessionId,stageBinding:stage.stageBinding,writer,prepared});
    let outcome;try{outcome=await writer.commitPrepared(prepared);}catch(error){outcome=error;}const observed=assertProofRetentionPostgresOutcome(outcome,{writer});
    publisher.settleRetentionDispatch({operationId:randomUUID(),expectedRevision:publisher.status().revision,dispatchOperationId:dispatchId,writer,outcome});
    if(observed.disposition!=='COMMITTED'){e.phase='RETENTION_HELD';check(false,'PROOF_AUTHORITY_RETENTION_HELD');}
    e.stage=await settle(stage,'COMPLETE',hash(observed));e.phase='RETAINED';active.delete(e);e.signal.removeEventListener('abort',e.abort);return observed.report.record.result;
   }catch(error){e.phase='RETENTION_HELD';throw error;}
  });},
  bindLogout(auth){
   const source=auth instanceof staffClass.DurableStaffAuth?'STAFF':auth instanceof customerClass.CustomerAuth?'CUSTOMER':null;check(source,'PROOF_AUTHORITY_CANONICAL_AUTH_REQUIRED');const config=auth.config,configBinding=decoderFreeze(Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(k=>[k,config[k]])));
   return async tokens=>{
    check(!closed,'PROOF_AUTHORITY_HELD');check(auth.config===config&&same(configBinding,Object.fromEntries(Object.keys(configBinding).map(k=>[k,config[k]]))),'PROOF_AUTHORITY_CONFIG_CHANGED');const key=hash({source,...tokens});
    check(logouts.size<4096,'PROOF_AUTHORITY_CAPACITY_HOLD');check(!logouts.has(key),'PROOF_AUTHORITY_LOGOUT_ALREADY_STARTED');const value={schema:'atlas-proof-logout-begin-v1',requestId:randomUUID(),requestBindingHash:hash({source,configBinding,...tokens}),source,...tokens,configBinding,mutationId:randomUUID()};logouts.set(key,value);
    const drain=report(await request.beginLogout(value),request,'begin_logout_v1');check(drain.schema==='atlas-proof-drain-report-v1'&&drain.publisherSessionId===sessionId,'PROOF_AUTHORITY_DRAIN_REQUIRED');
    const barriers=[];
    for(const scope of drain.fences){const barrierId=randomUUID();publisher.beginScopeBarrier({operationId:randomUUID(),expectedRevision:publisher.status().revision,sessionId,canonicalMutationId:drain.mutationId,barrierId,barrierRevision:drain.barrierRevision,scope});barriers.push(barrierId);}
    // An in-flight owner must finish or produce a real C1 tombstone. Absence,
    // disconnect, timeout and caller data never release this drain.
    for(const e of active){if(e.retention&&drain.outstandingStages.some(s=>s.stageBinding.stageId===e.retention.stage.stageBinding.stageId)){
     const outcome=await writer.cancelPrepared(e.retention.prepared,{barrierId:barriers[0],barrierRevision:drain.barrierRevision}),observed=assertProofRetentionPostgresOutcome(outcome,{writer});check(['COMMITTED','CANCELLED_BEFORE_COMMIT'].includes(observed.disposition),'PROOF_AUTHORITY_RETENTION_HELD');
     publisher.settleRetentionDispatch({operationId:randomUUID(),expectedRevision:publisher.status().revision,dispatchOperationId:e.retention.dispatchId,writer,outcome});await settle(e.retention.stage,observed.disposition==='COMMITTED'?'COMPLETE':'NO_EFFECT',hash(observed),{barrierId:barriers[0],barrierRevision:drain.barrierRevision});active.delete(e);
    }}
    const checked=report(await settler.readDrain({mutationId:drain.mutationId}),settler,'read_drain_v1');check(checked.outstandingStages.length===0,'PROOF_AUTHORITY_DRAIN_REQUIRED');
    const settled=barriers.map(barrierId=>{const x=publisher.settleScopeBarrier({operationId:randomUUID(),expectedRevision:publisher.status().revision,barrierId});check(x.record?.phase==='LOCAL_QUIESCENT','PROOF_AUTHORITY_DRAIN_REQUIRED');return x.record;});
    const drained=report(await settler.settleDrain({schema:'atlas-proof-drain-settle-v1',mutationId:drain.mutationId,mutationHash:drain.mutationHash,barrierHash:hash(settled)}),settler,'settle_drain_v1');check(drained.state==='SETTLED','PROOF_AUTHORITY_DRAIN_REQUIRED');
    const applied=report(await revoker.applyMutation({mutationId:drain.mutationId,mutationHash:drain.mutationHash}),revoker,'apply_mutation_v1');check(applied.state==='APPLIED','PROOF_AUTHORITY_DRAIN_REQUIRED');return source==='CUSTOMER'?{signedOut:true}:undefined;
   };
  },
  async close(){closed=true;for(const e of active){e.original?.fill(0);e.original=null;e.phase='HELD';}await client.close();await accounted.close();await writer.close();request.close();settler.close();revoker.close();publisher.close();return {closed:true,unresolved:active.size};}
 });for(const io of [publisher,client,writer,accounted])ioOwners.add(io);producers.add(producer);return producer;
}
