// Explicit local operator qualification. Structural rows/outcomes only; this
// never claims canonical authority, decoder provenance or installs anything.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hash,canonicalJSON} from '../src/contract.mjs';
import {createR1ProofIntakeAccountedPostgres} from '../src/proof-intake-protected-postgres.mjs';
import {createR1ProofIntakeAccountedConnectionOwner} from '../src/proof-retention-postgres-connection.mjs';
import {createR1ProofRetentionIntakePostgresWriter} from '../src/proof-retention-postgres-writer.mjs';
import {publicationRetentionWriterBinding} from '../src/proof-publication-retention.mjs';
import {projectIntakeProtectedOperation} from '../src/proof-intake-protected-protocol.mjs';
import {intakeAccountingRead,intakeAccountingOutcome,projectIntakeAccounting} from '../src/proof-intake-accounting.mjs';

export async function qualifyInstalledIntake({configuration,retentionConfiguration,installation,accounting,create,genericClient}){
 assert.equal(process.versions.node,'22.16.0');assert.equal(configuration.endpoint.kind,'LOCAL_UNIX');assert.equal(installation.binding.environment,'PROVIDER_SANDBOX');
 const intake=createR1ProofIntakeAccountedPostgres({enabled:true,configuration,installation,accounting}),owner=createR1ProofIntakeAccountedConnectionOwner({enabled:true,configuration,installation,accounting});
 const retention=createR1ProofRetentionIntakePostgresWriter({enabled:true,configuration:retentionConfiguration,installation,maxOperations:4});
 let connection,refusals=0;
 async function q(sql,values){connection??=await owner.connect();try{return(await connection.query(sql,values)).rows;}catch(error){connection.release();connection=null;throw error;}}
 const state=async()=>(await q('SELECT * FROM atlas_marketplace.read_intake_state_v1()'))[0];
 try{
  publicationRetentionWriterBinding(retention.binding);
  const initial=await state();assert.equal(initial.revision,'0');
  const prepared=intake.prepareCreate(create),created=await intake.commitPrepared(prepared);assert.equal(created.disposition,'COMMITTED');const r=created.record;
  assert.match(r.upload.uploadId,/^atlas_upload_/);assert.match(r.upload.actorId,/^[a-f0-9-]{36}$/);assert.equal(r.upload.attempts,0);
  const current=await state(),next=structuredClone(current.document);next.marketplaceProofUploads[r.upload.uploadId].status='VALIDATED';
  await assert.rejects(genericClient.query('SELECT atlas_marketplace.commit_state($1,$2,$3::jsonb,$4,$5)',[current.revision,current.state_hash,canonicalJSON(next),hash(next),Date.now()]));refusals++;
  const markers={classification:'UNQUALIFIED',executionAllowed:false,freshPublicationAllowed:false},request={schema:'atlas-proof-decoder-prepared-request-v1',...markers,requestId:randomUUID(),deadlineBootNs:'1000000000',plan:r.upload.plan,bootId:randomUUID(),epoch:'STRUCTURAL_SQL_ONLY',bindingHash:hash('structural'),profileHash:hash('structural-profile'),limitsHash:hash('structural-limits')},attemptId=randomUUID(),leaseId=randomUUID();
  const validation={schema:'atlas-marketplace-proof-image-v1',decoder:'sharp-0.33.5/libvips-8.15.3',contentType:r.upload.plan.declaredType,byteCount:r.upload.plan.byteCount,sha256:r.upload.plan.sha256,width:1,height:1};
  const observation={schema:'atlas-proof-decoder-client-disposition-v1',...markers,disposition:'COMPLETE_CLEAN',request,completion:{schema:'atlas-proof-decoder-target-broker-v2',...markers,requestId:request.requestId,nonce:hash('structural'),bindingHash:request.bindingHash,jobId:randomUUID(),outcome:'SUCCESS',reportedCleanup:'OBSERVED',validation,bootId:request.bootId,epoch:request.epoch}};
  const operation={schema:'atlas-proof-intake-operation-v1',operationId:randomUUID(),kind:'VALIDATE',atMs:Date.now(),bindingHash:hash(installation.binding),createOperationId:r.operation.operationId,createOperationHash:r.operationHash,expectedUploadHash:r.uploadHash,validationAttemptId:attemptId,decoderRequestId:request.requestId,validation};
  const capacity=(await q('SELECT atlas_marketplace.read_intake_capacity_v1() AS capacity'))[0].capacity,projection=projectIntakeProtectedOperation(current.document,operation,installation,r,capacity);
  const commitArgs=()=>[current.revision,current.state_hash,canonicalJSON(operation),canonicalJSON(projection.next),hash(projection.next)];
  await assert.rejects(q('SELECT atlas_marketplace.commit_accounted_intake_validation_v1($1,$2,$3::jsonb,$4::jsonb,$5) AS record',commitArgs()));refusals++;
  for(const kind of ['RESERVE','SUBMIT_INTENT','OBSERVE_OUTCOME']){
   const read=(await q('SELECT atlas_marketplace.read_intake_accounting_v1($1::uuid,$2) AS document',[r.operation.operationId,r.operationHash]))[0].document,prior=intakeAccountingRead(read,r,installation,accounting),at=Date.now();
   const entry={schema:'atlas-proof-intake-accounting-entry-v1',createOperationId:r.operation.operationId,createOperationHash:r.operationHash,prepared:request,action:{kind,actionId:randomUUID(),at,attemptId,leaseId,requestId:request.requestId,originalHash:hash({uploadId:r.upload.uploadId,objectKey:r.upload.objectKey,plan:r.upload.plan}),...(kind==='RESERVE'?{leaseUntil:at+15000}:kind==='OBSERVE_OUTCOME'?intakeAccountingOutcome(observation):{})},observation:kind==='OBSERVE_OUTCOME'?observation:null};
   const projected=projectIntakeAccounting(read,entry,r,installation,accounting);assert.deepEqual((await q('SELECT atlas_marketplace.commit_intake_accounting_v1($1::uuid,$2,$3,$4::jsonb,$5::jsonb) AS document',[r.operation.operationId,r.operationHash,prior.headHash,canonicalJSON(entry),canonicalJSON(projected.read)]))[0].document,projected.read);
  }
  const validated=(await q('SELECT atlas_marketplace.commit_accounted_intake_validation_v1($1,$2,$3::jsonb,$4::jsonb,$5) AS record',commitArgs()))[0].record;assert.equal(validated.upload.status,'VALIDATED');assert.equal(validated.upload.attempts,0);assert.equal(validated.upload.objectKey,r.upload.objectKey);
  for(const sql of ['SELECT * FROM atlas_marketplace.proof_intake_operations_v1',"SELECT atlas_marketplace.commit_state_internal_v1(0,'x','{}'::jsonb,'x',0)"]){await assert.rejects(q(sql));refusals++;}
  const final=await state();assert.equal(final.revision,'2');assert.equal(final.document.events.length,2);
  return {passed:true,classification:'UNQUALIFIED',canonicalAuthorityTested:false,privateDecoderTested:false,groups:3,refusals,revision:final.revision,stateHash:final.state_hash};
 }finally{connection?.release();await intake.close();await owner.close();await retention.close();}
}
