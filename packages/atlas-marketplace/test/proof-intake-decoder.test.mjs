import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hash} from '../src/contract.mjs';
import {intakeDecodedValidationFields} from '../src/proof-intake-decoder.mjs';
import {projectIntakeProtectedOperation} from '../src/proof-intake-protected-protocol.mjs';
import {assertProofDecoderClientOutcomeBeforeDeadline,assertProofDecoderClientOutcome} from '../src/proof-decoder-target-broker.mjs';
import {createProofIntakeProtectedPostgres} from '../src/proof-intake-protected-postgres.mjs';
// Structural synthetic inputs only. No fake native/client/outcome brands exist.
function fixture(){
 const policy={environment:'SYNTHETIC_LOCAL',id:'fixture',version:'v1',approvalRef:'unverified-fixture',retentionRef:'fixture-retention',reviewerAuthorityRef:'unverified-reviewer',effectiveAt:1000,expiresAt:1000000,retentionMs:86400000,maxObjectBytes:10485760,maxProofsPerOrder:2,maxRetainedObjects:10,uploadTtlMs:900000,validationLeaseMs:15000};
 const storage={schema:'atlas-marketplace-proof-encrypted-v1',storageId:'fixture',environment:'SYNTHETIC_LOCAL',retentionRef:policy.retentionRef,keyId:'fixture-key',maxObjectBytes:10485760};
 const installation={schema:'atlas-proof-intake-installed-v1',binding:{schema:'atlas-marketplace-proof-intake-v1',environment:'SYNTHETIC_LOCAL',policyHash:hash(policy),storageHash:hash(storage)},policy,storage,maxOperations:8};
 const order={orderId:'demo_order',cardId:'demo_card',buyerId:'demo_buyer',sellerId:'demo_seller',bindingHash:hash('paid'),policyVersion:'fixture-v1',paymentIntentId:'demo_payment'},state={journals:[],events:[],orders:{demo_order:order},intents:{demo_payment:{kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:'demo_order',bindingHash:order.bindingHash}},fulfillment:{demo_order:{deliveredAt:1000,releaseNotBefore:86401000}}};
 const operation={schema:'atlas-proof-intake-operation-v1',operationId:randomUUID(),kind:'CREATE',atMs:2000,bindingHash:hash(installation.binding),actor:{id:'demo_buyer',role:'BUYER'},request:{requestId:'demo_request',orderId:'demo_order',purpose:'RETURN_REQUEST',declaredType:'image/png',byteCount:68,sha256:hash('original')}};
 const projected=projectIntakeProtectedOperation(state,operation,installation,null,{schema:'atlas-proof-intake-capacity-v1',operations:0,creates:0,validations:0,reservedValidations:0});
 const created={schema:'atlas-proof-intake-record-v1',operation,operationHash:hash(operation),dispatchKey:projected.dispatchKey,upload:projected.upload,uploadHash:hash(projected.upload),revision:1};
 const markers={classification:'UNQUALIFIED',executionAllowed:false,freshPublicationAllowed:false},request={schema:'atlas-proof-decoder-prepared-request-v1',...markers,requestId:randomUUID(),deadlineBootNs:'1000000000',plan:projected.upload.plan,bootId:randomUUID(),epoch:'SYNTHETIC_ONLY',bindingHash:hash('binding'),profileHash:hash('profile'),limitsHash:hash('limits')};
 const validation={schema:'atlas-marketplace-proof-image-v1',decoder:'sharp-0.33.5/libvips-8.15.3',contentType:'image/png',byteCount:68,sha256:operation.request.sha256,width:1,height:1};
 const completion={schema:'atlas-proof-decoder-target-broker-v2',...markers,requestId:request.requestId,nonce:hash('nonce'),bindingHash:request.bindingHash,jobId:randomUUID(),outcome:'SUCCESS',reportedCleanup:'OBSERVED',validation,bootId:request.bootId,epoch:request.epoch};
 return {installation,created,observation:{schema:'atlas-proof-decoder-client-disposition-v1',...markers,disposition:'COMPLETE_CLEAN',request,completion},atMs:3000};
}
const project=f=>intakeDecodedValidationFields({created:f.created,observation:f.observation,atMs:f.atMs},f.installation);
test('projection derives DTO and decoder ID together from the exact original CREATE',()=>{
 const f=fixture(),before=structuredClone(f),v=project(f);assert.deepEqual(f,before);assert.deepEqual(v,{createOperationId:f.created.operation.operationId,createOperationHash:f.created.operationHash,expectedUploadHash:f.created.uploadHash,decoderRequestId:f.observation.request.requestId,validation:f.observation.completion.validation});assert.ok(Object.isFrozen(v.validation));assert.equal(v.qualification,undefined);assert.equal(v.authority,undefined);
});
test('uncertain, no-start, rejected-image and contradictory completions cannot prepare VALIDATE',()=>{
 const f=fixture();for(const disposition of ['UNKNOWN','KNOWN_NO_START_SENT'])assert.throws(()=>project({...f,observation:{...f.observation,disposition,completion:null}}),{code:'INTAKE_DECODER_NO_CLEAN_SUCCESS'});
 assert.throws(()=>project({...f,observation:{...f.observation,completion:{...f.observation.completion,outcome:'INVALID_IMAGE',validation:null}}}),{code:'INTAKE_DECODER_NO_CLEAN_SUCCESS'});
 for(const patch of [{requestId:randomUUID()},{bootId:randomUUID()},{epoch:'other'},{bindingHash:hash('other')},{reportedCleanup:'UNKNOWN'}])assert.throws(()=>project({...f,observation:{...f.observation,completion:{...f.observation.completion,...patch}}}));
});
test('same-shape different original, policy, storage or CREATE snapshot is refused',()=>{
 const f=fixture();for(const patch of [{sha256:hash('other')},{byteCount:69},{declaredType:'image/jpeg'}]){
  const observation=structuredClone(f.observation);Object.assign(observation.request.plan,patch);Object.assign(observation.completion.validation,{sha256:observation.request.plan.sha256,byteCount:observation.request.plan.byteCount,contentType:observation.request.plan.declaredType});assert.throws(()=>project({...f,observation}),{code:'INTAKE_DECODER_BINDING'});
 }
 for(const field of ['requestHash','objectKey','proofId']){const changed=structuredClone(f.created);changed.upload[field]=hash('changed');changed.uploadHash=hash(changed.upload);assert.throws(()=>project({...f,created:changed}));}
 const other=structuredClone(f.installation);other.storage.storageId='other';other.binding.storageHash=hash(other.storage);assert.throws(()=>project({...f,installation:other}));
 const policy=structuredClone(f.installation);policy.policy.version='v2';policy.binding.policyHash=hash(policy.policy);assert.throws(()=>project({...f,installation:policy}));
});
test('the original upload/policy window and closed scalar shapes are mandatory',()=>{
 const f=fixture();for(const atMs of [1999,f.created.upload.expiresAt,'3000'])assert.throws(()=>project({...f,atMs}),{code:'INTAKE_DECODER_WINDOW'});
 assert.throws(()=>project({...f,atMs:3000.5}),{code:'DECODER_CONTRACT_INVALID'});
 let reads=0;assert.throws(()=>intakeDecodedValidationFields({created:f.created,observation:f.observation,get atMs(){reads++;return 3000;}},f.installation));assert.equal(reads,0);
 assert.throws(()=>intakeDecodedValidationFields({created:f.created,observation:f.observation,atMs:3000,qualified:true},f.installation));
});
test('stricter deadline verifier still requires the actual same-client private outcome before reading any clock',()=>{
 let calls=0;const fake={status(){calls++;return {closed:false,quarantined:false};},boottimeNanoseconds(){calls++;return 0n;}},f=fixture();
 for(const verify of [assertProofDecoderClientOutcome,assertProofDecoderClientOutcomeBeforeDeadline]){
  for(const value of [f.observation,f.observation.completion,new Error('COMPLETE_CLEAN')])assert.throws(()=>verify(value,{client:fake}),{code:'DECODER_BROKER_CLIENT_REQUIRED'});
  assert.throws(()=>verify(f.observation.completion,{get client(){calls++;return fake;}}));
 }
 assert.equal(calls,0);
});
test('owned intake remains default-off and refuses injected decoder or authority factories',()=>{
 assert.equal(createProofIntakeProtectedPostgres(),null);let called=0;
 for(const key of ['decoder','qualify','outcomeVerifier','clock','client'])assert.throws(()=>createProofIntakeProtectedPostgres({[key]:()=>{called++;}}));assert.equal(called,0);
});
