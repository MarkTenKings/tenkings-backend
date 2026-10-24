// Source-owned INTERNAL storage adapter. No public endpoint or authority.
import {intakeDecodedValidationFields} from './proof-intake-decoder.mjs';
import {assertProofDecoderPreparedSubmission,takeProofDecoderPreparedSubmission,assertProofDecoderPreparedSubmissionBeforeDeadline,assertProofDecoderClientOutcome,assertProofDecoderClientOutcomeBeforeDeadline} from './proof-decoder-target-broker.mjs';
import {randomUUID} from 'node:crypto';
import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {assertJournal} from './ledger.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {decoderFreeze} from './proof-decoder-profile.mjs';
import {createProofIntakeProtectedConnectionOwner,createProofIntakeAccountedConnectionOwner} from './proof-retention-postgres-connection.mjs';
import {intakeProtectedInstallation,intakeProtectedOperation,intakeProtectedRecord,intakeProtectedUploadId,projectIntakeProtectedOperation} from './proof-intake-protected-protocol.mjs';
import {intakeAccountingInstallation,intakeAccountingRead,intakeAccountingOutcome,projectIntakeAccounting,intakeAccountingValidation} from './proof-intake-accounting.mjs';
const check=(v,c)=>requireValue(v,c),same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const decoderClaims=new WeakMap();
const markers={classification:'UNQUALIFIED',customerPublicationAuthority:false,canonicalAuthorityTested:false,decoderAuthority:false};
export function createProofIntakeProtectedPostgres(options={}){return createIntake(options,false);}
export function createProofIntakeAccountedPostgres(options={}){return createIntake(options,true);}
function createIntake(options,accounted){
 const input=engineDataOptions(options,[],['enabled','configuration','installation',...(accounted?['accounting']:[])]);if(input.enabled!==true)return null;
 const installation=intakeProtectedInstallation(input.installation),accounting=accounted?intakeAccountingInstallation(input.accounting,installation):null,owner=accounted?createProofIntakeAccountedConnectionOwner({enabled:true,configuration:input.configuration,installation,accounting}):createProofIntakeProtectedConnectionOwner({enabled:true,configuration:input.configuration,installation});
 const handles=new WeakMap(),attemptHandles=new WeakMap(),openAttempts=new Set(),heldCreates=new Set(),decoderOwner=Object.freeze({});let closed=false,active=false,preparedCount=0;
 const ready=()=>check(!closed,'INTAKE_PROTECTED_CLOSED');
 function fresh(evidence){if(evidence)assertProofDecoderClientOutcomeBeforeDeadline(evidence.outcome,{client:evidence.client});}
 function register(operation,evidence=null,reserved=false){
  ready();if(!reserved){check(preparedCount<installation.maxOperations,'INTAKE_PROTECTED_CAPACITY');preparedCount++;}
  const handle=Object.freeze({});handles.set(handle,{operation,consumed:false,result:null,evidence});return handle;
 }
 function prepare(kind,value){
  ready();check(preparedCount<installation.maxOperations,'INTAKE_PROTECTED_CAPACITY');
  const fields=engineDataOptions(value,kind==='CREATE'?['actor','request']:['createOperationId','createOperationHash','expectedUploadHash','validationAttemptId','decoderRequestId','validation'],[]);
  const operation=intakeProtectedOperation({schema:'atlas-proof-intake-operation-v1',operationId:randomUUID(),kind,atMs:Date.now(),bindingHash:hash(installation.binding),...fields},installation);
  return register(operation);
 }
 function owned(handle){ready();const h=handles.get(handle);check(h,'INTAKE_PROTECTED_HANDLE_REQUIRED');return h;}
 function report(record,operation){
  if(record===null)return decoderFreeze({...markers,disposition:'ABSENT_HOLD',operation,operationHash:hash(operation)});
  const r=intakeProtectedRecord(record,installation);check(same(r.operation,operation),'INTAKE_PROTECTED_ORIGINAL_HOLD');
  return decoderFreeze({...markers,disposition:'COMMITTED',record:r});
 }
 async function original(client,operation){const {rows}=await client.query('SELECT atlas_marketplace.lookup_intake_operation_v1($1::uuid,$2) AS record',[operation.operationId,hash(operation)]);check(rows.length===1,'INTAKE_PROTECTED_RESULT');return report(rows[0].record,operation);}
 async function lookup(operation){
  ready();check(!active,'INTAKE_PROTECTED_BUSY');active=true;let client;
  try{client=await owner.connect();return await original(client,operation);}finally{client?.release();active=false;}
 }
 function attemptOwned(handle){ready();const h=attemptHandles.get(handle);check(h,'INTAKE_ACCOUNTING_HANDLE_REQUIRED');return h;}
 function attemptReport(h){return decoderFreeze({schema:'atlas-proof-intake-accounted-attempt-v1',...markers,phase:h.phase,createOperationId:h.create.operationId,createOperationHash:hash(h.create),attemptId:h.attemptId,leaseId:h.leaseId,prepared:h.request,reservation:h.reserve.action,lifecycle:h.last?.state??null});}
 function discardAttempt(h){if(h.prepared){let outcome;try{outcome=h.client.discardPrepared(h.prepared);}catch(error){outcome=error;}try{const observation=assertProofDecoderClientOutcome(outcome,{client:h.client});check(same(observation.request,h.request),'INTAKE_ACCOUNTING_ORIGINAL');h.outcome=outcome;h.observation=observation;}catch{}h.prepared=null;}}
 async function accountingRead(connection,create,created){
  const result=await connection.query('SELECT atlas_marketplace.read_intake_accounting_v1($1::uuid,$2) AS document',[create.operationId,hash(create)]);
  check(result.rows.length===1,'INTAKE_ACCOUNTING_READ');return intakeAccountingRead(result.rows[0].document,created,installation,accounting);
 }
 function entryFor(h,kind,extra={},observation=null){return decoderFreeze({schema:'atlas-proof-intake-accounting-entry-v1',createOperationId:h.create.operationId,createOperationHash:hash(h.create),prepared:h.request,action:{kind,actionId:randomUUID(),at:Date.now(),attemptId:h.attemptId,leaseId:h.leaseId,requestId:h.request.requestId,originalHash:h.originalHash,...extra},observation});}
 async function persistAccounting(h,entry,needsPrepared){
  let connection,began=false,commitAttempted=false;
  try{
   ready();if(needsPrepared)assertProofDecoderPreparedSubmissionBeforeDeadline(h.prepared,{client:h.client});
   connection=await owner.connect();ready();if(needsPrepared)assertProofDecoderPreparedSubmissionBeforeDeadline(h.prepared,{client:h.client});
   await connection.query('BEGIN');began=true;await connection.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
   const found=await original(connection,h.create);check(found.disposition==='COMMITTED','INTAKE_ACCOUNTING_ORIGINAL');h.created=found.record;
   const prior=await accountingRead(connection,h.create,found.record),projected=projectIntakeAccounting(prior.read,entry,found.record,installation,accounting);
   ready();if(needsPrepared)assertProofDecoderPreparedSubmissionBeforeDeadline(h.prepared,{client:h.client});
   const result=await connection.query('SELECT atlas_marketplace.commit_intake_accounting_v1($1::uuid,$2,$3,$4::jsonb,$5::jsonb) AS document',[h.create.operationId,hash(h.create),prior.headHash,canonicalJSON(entry),canonicalJSON(projected.read)]);
   check(result.rows.length===1&&same(result.rows[0].document,projected.read),'INTAKE_ACCOUNTING_COMMIT');
   ready();if(needsPrepared)assertProofDecoderPreparedSubmissionBeforeDeadline(h.prepared,{client:h.client});
   commitAttempted=true;await connection.query('COMMIT');began=false;ready();if(needsPrepared)assertProofDecoderPreparedSubmissionBeforeDeadline(h.prepared,{client:h.client});return projected;
  }catch(error){if(began&&!commitAttempted)try{await connection.query('ROLLBACK');}catch{}throw error;}
  finally{connection?.release();}
 }
 const accountedMethods=accounted?{
  async reserveDecoderAttempt(options){
   ready();check(!active,'INTAKE_PROTECTED_BUSY');check(openAttempts.size===0,'INTAKE_ACCOUNTING_BUSY');
   const v=engineDataOptions(options,['createOperation','client','prepared']),create=intakeProtectedOperation(v.createOperation,installation);check(create.kind==='CREATE'&&!heldCreates.has(create.operationId),'INTAKE_ACCOUNTING_ORIGINAL');
   const request=assertProofDecoderPreparedSubmission(v.prepared,{client:v.client});check(same(request.plan,{declaredType:create.request.declaredType,byteCount:create.request.byteCount,sha256:create.request.sha256}),'INTAKE_ACCOUNTING_ORIGINAL');
   // The original public key is deleted synchronously. Only this closure keeps
   // its replacement, so no concurrent caller can submit while SQL is pending.
   const transferred=takeProofDecoderPreparedSubmission(v.prepared,{client:v.client}),at=Date.now(),leaseUntil=Math.min(at+Number((BigInt(request.deadlineBootNs)-BigInt(transferred.observedAtBootNs))/1000000n),create.atMs+installation.policy.uploadTtlMs,installation.policy.expiresAt);
   const uploadId=intakeProtectedUploadId(create),h={create,client:v.client,prepared:transferred.handle,request,attemptId:randomUUID(),leaseId:randomUUID(),phase:'CLAIMED',originalHash:hash({uploadId,objectKey:hash({binding:installation.binding,uploadId}),plan:request.plan}),last:null,observation:null,outcome:null,validationClaimed:false};
   h.reserve=entryFor(h,'RESERVE',{at,leaseUntil});const handle=Object.freeze({});attemptHandles.set(handle,h);openAttempts.add(h);active=true;
   try{check(leaseUntil>at,'INTAKE_ACCOUNTING_EXPIRED');h.last=await persistAccounting(h,h.reserve,true);h.phase='RESERVED';}
   catch{h.phase='UNKNOWN';heldCreates.add(h.create.operationId);discardAttempt(h);openAttempts.delete(h);}finally{active=false;}
   return handle;
  },
  decoderAttemptReport(handle){return attemptReport(attemptOwned(handle));},
  decoderAttemptOutcome(handle){const h=attemptOwned(handle);check(!active&&h.outcome,'INTAKE_ACCOUNTING_OUTCOME_UNAVAILABLE');assertProofDecoderClientOutcome(h.outcome,{client:h.client});return h.outcome;},
  async submitDecoderAttempt(handle){
   const h=attemptOwned(handle);check(!active&&h.phase==='RESERVED','INTAKE_ACCOUNTING_SUBMISSION_HELD');active=true;h.phase='RUNNING';h.submit=entryFor(h,'SUBMIT_INTENT');
   try{
    h.last=await persistAccounting(h,h.submit,true);
    // Definite COMMIT above is necessary. No lost-response lookup may turn a
    // previously uncertain dispatch into permission to execute it later.
    ready();assertProofDecoderPreparedSubmissionBeforeDeadline(h.prepared,{client:h.client});
    let outcome;try{outcome=await h.client.submitPrepared(h.prepared);}catch(error){outcome=error;}finally{h.prepared=null;}
    let observation=null;
    try{observation=assertProofDecoderClientOutcome(outcome,{client:h.client});check(same(observation.request,h.request),'INTAKE_ACCOUNTING_ORIGINAL');if(observation.disposition==='COMPLETE_CLEAN')assertProofDecoderClientOutcomeBeforeDeadline(outcome,{client:h.client});}
    catch{observation=null;}
    h.observation=observation;h.outcome=outcome;
    const fields=observation?intakeAccountingOutcome(observation):{outcome:'TRANSPORT_FAILURE',submissionObservation:'UNKNOWN',effectObservation:'UNKNOWN',inputObservation:'UNKNOWN'};
    h.observe=entryFor(h,'OBSERVE_OUTCOME',fields,observation);h.last=await persistAccounting(h,h.observe,false);
    h.phase=h.last.state.accounting.holdReason===null?'SETTLED':'HELD';if(h.phase==='HELD')heldCreates.add(h.create.operationId);return attemptReport(h);
   }catch{h.phase='UNKNOWN';heldCreates.add(h.create.operationId);discardAttempt(h);return attemptReport(h);}finally{openAttempts.delete(h);active=false;}
  },
  async prepareValidationFromAttempt(handle){
   const h=attemptOwned(handle);check(!active&&h.phase==='SETTLED'&&!h.validationClaimed&&h.last.state.accounting.disposition==='VALIDATION_REVIEW_REQUIRED','INTAKE_ACCOUNTING_VALIDATION_HOLD');h.validationClaimed=true;
   return prepareDecoded({createOperation:h.create,client:h.client,outcome:h.outcome},h);
  },
  async lookupDecoderAttempt(handle){
   const h=attemptOwned(handle);check(!active,'INTAKE_PROTECTED_BUSY');active=true;let connection;
   try{connection=await owner.connect();const found=await original(connection,h.create);check(found.disposition==='COMMITTED','INTAKE_ACCOUNTING_ORIGINAL');const observed=await accountingRead(connection,h.create,found.record);return decoderFreeze({attempt:attemptReport(h),observed});}
   finally{connection?.release();active=false;}
  }
 }:{};
 async function prepareDecoded(options,attempt=null){
   ready();check(!active,'INTAKE_PROTECTED_BUSY');check(preparedCount<installation.maxOperations,'INTAKE_PROTECTED_CAPACITY');
   const v=engineDataOptions(options,['createOperation','client','outcome']),create=intakeProtectedOperation(v.createOperation,installation);check(create.kind==='CREATE','INTAKE_DECODER_ORIGINAL_REQUIRED');
   const observation=assertProofDecoderClientOutcome(v.outcome,{client:v.client}),prior=decoderClaims.get(v.outcome);
   if(prior){const failure=Object.assign(new Error('INTAKE_DECODER_OUTCOME_CONSUMED'),{code:'INTAKE_DECODER_OUTCOME_CONSUMED'});if(prior.owner===decoderOwner&&prior.claim.createOperationHash===hash(create))failure.preparation=prior.claim;throw failure;}
   const claim=decoderFreeze({schema:'atlas-proof-intake-decoder-preparation-v1',...markers,createOperationId:create.operationId,createOperationHash:hash(create),operationId:randomUUID(),validationAttemptId:attempt?.attemptId??randomUUID(),decoderRequestId:observation.request?.requestId??null,atMs:Date.now(),decoderRequest:observation.request});
   // Global same-process claim precedes every async boundary. Unknown reads,
   // timeouts and close never release it or allocate replacement identities.
   decoderClaims.set(v.outcome,{owner:decoderOwner,claim});preparedCount++;active=true;let connection;
   const evidence=Object.freeze({client:v.client,outcome:v.outcome,attempt});
   try{
    fresh(evidence);connection=await owner.connect();ready();fresh(evidence);
    const found=await original(connection,create);check(found.disposition==='COMMITTED','INTAKE_PROTECTED_ORIGINAL_HOLD');ready();fresh(evidence);
    if(attempt){check(attempt.create.operationId===create.operationId&&attempt.observation&&same(attempt.observation.request,observation.request),'INTAKE_ACCOUNTING_ORIGINAL');const observed=await accountingRead(connection,create,found.record);ready();fresh(evidence);check(observed.state.accounting.disposition==='VALIDATION_REVIEW_REQUIRED'&&observed.read.entries.some(e=>e.action.attemptId===attempt.attemptId&&e.action.kind==='OBSERVE_OUTCOME'&&e.observation&&same(e.observation,observation)),'INTAKE_ACCOUNTING_VALIDATION_HOLD');}
    const fields=intakeDecodedValidationFields({created:found.record,observation,atMs:claim.atMs},installation);
    const operation=intakeProtectedOperation({schema:'atlas-proof-intake-operation-v1',operationId:claim.operationId,kind:'VALIDATE',atMs:claim.atMs,bindingHash:hash(installation.binding),validationAttemptId:claim.validationAttemptId,...fields},installation);
    return register(operation,evidence,true);
   }catch{throw Object.assign(new Error('INTAKE_DECODER_PREPARATION_HOLD'),{code:'INTAKE_DECODER_PREPARATION_HOLD',preparation:claim});}
   finally{connection?.release();active=false;}
 }
 return Object.freeze({...markers,binding:owner.binding,
  prepareCreate(value){return prepare('CREATE',value);},
  ...(!accounted?{prepareValidation(value){return prepare('VALIDATE',value);},prepareValidationFromDecoder(options){return prepareDecoded(options);}}:accountedMethods),
  preparedReport(handle){return owned(handle).operation;},
  async commitPrepared(handle){
   const h=owned(handle);check(!h.consumed&&!active,'INTAKE_PROTECTED_COMMIT_CONSUMED');h.consumed=true;active=true;let client,began=false,commitAttempted=false;
   try{
    check(Date.now()-h.operation.atMs<=15000,'INTAKE_PROTECTED_EXPIRED');fresh(h.evidence);client=await owner.connect();ready();fresh(h.evidence);
    await client.query('BEGIN');began=true;await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
    const {rows}=await client.query('SELECT * FROM atlas_marketplace.read_intake_state_v1()');check(rows.length===1,'INTAKE_PROTECTED_STATE');const row=rows[0];
    check(row.format==='atlas-marketplace-v2'&&row.environment==='SYNTHETIC_LOCAL'&&Number.isSafeInteger(Number(row.revision))&&Number(row.revision)>=0&&hash(row.document)===row.state_hash,'INTAKE_PROTECTED_STATE');assertJournal(row.document.journals);
    let created=null;
    if(h.operation.kind==='VALIDATE'){
     // The actual immutable CREATE record is read by ID. The projection is
     // compared again inside the locked gateway; no stale read grants commit.
     const found=await client.query('SELECT atlas_marketplace.lookup_intake_operation_v1($1::uuid,$2) AS record',[h.operation.createOperationId,h.operation.createOperationHash]);
     check(found.rows.length===1&&found.rows[0].record!==null,'INTAKE_PROTECTED_ORIGINAL_HOLD');created=intakeProtectedRecord(found.rows[0].record,installation);
    }
    const capacity=(await client.query('SELECT atlas_marketplace.read_intake_capacity_v1() AS capacity')).rows;check(capacity.length===1,'INTAKE_PROTECTED_CAPACITY_HOLD');
    const projected=projectIntakeProtectedOperation(row.document,h.operation,installation,created,capacity[0].capacity);
    fresh(h.evidence);
    if(h.evidence?.attempt){const observed=await accountingRead(client,h.evidence.attempt.create,created);intakeAccountingValidation(observed.read,h.operation,created,installation,accounting);fresh(h.evidence);}
    const committed=await client.query(h.evidence?.attempt?'SELECT atlas_marketplace.commit_accounted_intake_validation_v1($1,$2,$3::jsonb,$4::jsonb,$5) AS record':'SELECT atlas_marketplace.commit_intake_operation_v1($1,$2,$3::jsonb,$4::jsonb,$5) AS record',[row.revision,row.state_hash,canonicalJSON(h.operation),canonicalJSON(projected.next),hash(projected.next)]);
    check(committed.rows.length===1,'INTAKE_PROTECTED_RESULT');const result=report(committed.rows[0].record,h.operation);check(result.disposition==='COMMITTED'&&same(result.record.upload,projected.upload)&&result.record.revision===Number(row.revision)+1,'INTAKE_PROTECTED_RESULT');
    ready();fresh(h.evidence);commitAttempted=true;await client.query('COMMIT');began=false;ready();fresh(h.evidence);h.result=result;return result;
   }catch(error){
    if(began&&!commitAttempted)try{await client.query('ROLLBACK');}catch{}
    // Any failed submission is an absorbing local uncertainty. The original
    // operation may only be looked up; no handle reset or commit retry exists.
    h.result=decoderFreeze({...markers,disposition:'UNKNOWN',operation:h.operation,operationHash:hash(h.operation)});return h.result;
   }finally{client?.release();active=false;}
  },
  async lookupPrepared(handle){const h=owned(handle);check(h.consumed,'INTAKE_PROTECTED_NOT_SUBMITTED');return lookup(h.operation);},
  async lookupOriginal(value){return lookup(intakeProtectedOperation(value,installation));},
  async close(){closed=true;const endings=[];for(const h of openAttempts){heldCreates.add(h.create.operationId);if(h.phase==='RUNNING')endings.push(h.client.close());else discardAttempt(h);}try{await owner.close();}finally{await Promise.allSettled(endings);}}
 });
}
