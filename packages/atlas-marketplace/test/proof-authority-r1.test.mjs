import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/contract.mjs';
import {parseProofAuthorityReply,parseProofAuthorityRequest} from '../src/proof-authority-protocol.mjs';
import {assertProofAuthorityCommittedReport} from '../src/proof-authority-postgres.mjs';
import {createR1ProofAuthorityProducer,assertR1ProofAuthorityProducer,reconcileR1ProofAuthorityOriginal,reconcileR1ProofAuthorityMutation} from '../src/proof-authority-r1.mjs';
import {assertProofPublicationLifecycleOwner} from '../src/proof-publication-store.mjs';
import {readR1ProofRequest,bindR1ProofLogout,r1ProofLogout} from '../src/auth-r1.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,h='a'.repeat(64);
// These tuples validate algorithms only. They are not canonical access,
// installed SQL, a native owner, a committed report or target qualification.
function stageReport(retain=false){
 const intakeBinding={schema:'atlas-marketplace-proof-intake-v1',environment:'SYNTHETIC_LOCAL',policyHash:h,storageHash:h};
 const session={installationId:id(1),qualificationSessionId:id(2),qualificationEvidenceHash:h,sourceClosureHash:h,policyHash:h,intakeBindingHash:hash(intakeBinding)};
 const operation={schema:'atlas-proof-retention-operation-v1',operationId:id(3),uploadId:'demo_upload',proofId:'demo_proof',orderId:'demo_order',orderHash:h,actorId:'demo_actor',actorRole:'BUYER',actorAccessBindingHash:h,originalRequestHash:h,policyHash:h,intakeBindingHash:hash(intakeBinding),objectKey:hash({binding:intakeBinding,uploadId:'demo_upload'}),manifestHash:h,originalSha256:h,originalByteCount:10,validationAttemptId:id(4),decoderRequestId:id(5),publicationLedgerId:id(6),publicationSessionId:id(7),publicationOperationId:id(8),publicationRevision:3,publicationEvidenceHash:h,qualificationSessionId:id(2),retentionFenceRevision:4,expectedUploadHash:h};
 const scope={fenceId:id(9),sourceKind:'SESSION',sourceKeyHash:h,sourceGenerationHash:h,ordinal:1,revision:1};
 return {schema:'atlas-proof-stage-report-v1',classification:'UNQUALIFIED',authority:false,requestHash:h,stage:retain?'RETAIN':'DECODE',state:'OUTSTANDING',stageBinding:{...session,stageId:id(10),stageRevision:4,requestId:id(11),requestBindingHash:h,actorAccessBindingHash:h,operationHash:retain?hash(operation):h,bootId:id(12),deadlineBootNs:'1000000000',fences:[scope]},operationId:retain?id(3):id(5),retentionOperation:retain?operation:null,intakeBinding,publisherSessionId:id(7),deadlineAt:200,observedAt:100};
}
test('closed positive SQL report remains data and cannot become any private producer or owner',async()=>{
 for(const retain of [false,true]){const parsed=parseProofAuthorityReply(stageReport(retain));assert.equal(parsed.authority,false);assert.throws(()=>assertR1ProofAuthorityProducer(parsed));assert.throws(()=>assertProofPublicationLifecycleOwner(parsed));assert.throws(()=>assertProofAuthorityCommittedReport(parsed,{gateway:{},action:'claim_stage_v1'}));}
 await assert.rejects(readR1ProofRequest({authorizeCommit:()=>true,refreshAuthorization:()=>true}),{code:'AUTH_BOUNDARY_UNAVAILABLE'});
});
test('full RETAIN identity, stage fence, installed binding and publication session must agree',()=>{
 const r=stageReport(true);
 for(const changed of [{...r,operationId:id(99)},{...r,publisherSessionId:id(99)},{...r,stageBinding:{...r.stageBinding,stageRevision:5}},{...r,stageBinding:{...r.stageBinding,operationHash:h}},{...r,retentionOperation:{...r.retentionOperation,actorId:'demo_other'}},{...r,intakeBinding:{...r.intakeBinding,policyHash:'b'.repeat(64)}}])assert.throws(()=>parseProofAuthorityReply(changed));
 assert.throws(()=>parseProofAuthorityReply({...r,authority:true}));assert.throws(()=>parseProofAuthorityReply({...r,receipt:{}}));
});
test('drain settlement cannot hide an outstanding stage or weaken its original fence',()=>{
 const stage=stageReport(),drain={schema:'atlas-proof-drain-report-v1',classification:'UNQUALIFIED',authority:false,requestHash:h,mutationId:id(13),mutationHash:h,state:'DRAINING',barrierRevision:5,publisherSessionId:id(7),fences:stage.stageBinding.fences,outstandingStages:[stage],barrierHash:null};
 assert.deepEqual(parseProofAuthorityReply(drain),drain);
 for(const patch of [{state:'APPLIED'},{state:'SETTLED',barrierHash:h},{barrierRevision:1},{outstandingStages:[stage,stage]},{fences:[]}])assert.throws(()=>parseProofAuthorityReply({...drain,...patch}));
 const applied={...drain,state:'APPLIED',outstandingStages:[],barrierHash:h};assert.deepEqual(parseProofAuthorityReply(applied),applied);
 assert.deepEqual(parseProofAuthorityRequest('settle_drain_v1',{schema:'atlas-proof-drain-settle-v1',mutationId:id(13),mutationHash:h,barrierHash:h}),{schema:'atlas-proof-drain-settle-v1',mutationId:id(13),mutationHash:h,barrierHash:h});
});
test('producer is cold by default and copied callback IO cannot enable it or replace canonical logout',async()=>{
 assert.equal(await createR1ProofAuthorityProducer(),null);
 await assert.rejects(createR1ProofAuthorityProducer({enabled:true,requestGateway:{claimStage:()=>stageReport()}}),{code:'PROOF_AUTHORITY_ADAPTER_REQUIRED'});
 const auth={};assert.equal(r1ProofLogout(auth),null);await assert.rejects(bindR1ProofLogout(auth,{bindLogout:()=>async()=>{}}),{code:'PROOF_AUTHORITY_PRODUCER_REQUIRED'});assert.equal(r1ProofLogout(auth),null);
});

test('restart reconciliation refuses copied SQL and retention owners without dispatching callbacks',async()=>{
 let calls=0;const fake={lookupClaim(){calls++;},readDrain(){calls++;},lookupOriginal(){calls++;}};
 await assert.rejects(reconcileR1ProofAuthorityOriginal({settlerGateway:fake,retentionWriter:fake,stageId:id(1),claimHash:h}),{code:'PROOF_AUTHORITY_ADAPTER_REQUIRED'});
 await assert.rejects(reconcileR1ProofAuthorityMutation({revokerGateway:fake,mutationId:id(1),mutationHash:h}),{code:'PROOF_AUTHORITY_ADAPTER_REQUIRED'});assert.equal(calls,0);
});
test('operator authorization is closed current-session data and does not upgrade its SQL audit reference',()=>{
 const mutation={schema:'atlas-proof-mutation-begin-v1',mutationId:id(1),kind:'STAFF_IDENTITY_ACCESS',subjectId:id(2),expectedBeforeHash:h,change:{role:'OBSERVER',revoked:true,certificationUntil:null,trustedLearningUntil:null}};
 const value={schema:'atlas-proof-operator-authorization-v1',requestId:id(3),requestBindingHash:h,source:'STAFF',sessionHash:h,browserHash:h,configBinding:{mode:'PRODUCTION',origin:'https://example.test',deploymentId:'test',releaseSha:'a'.repeat(40),configHash:h},originalRequestDeadlineAt:10,mutation,reason:'test'};
 assert.deepEqual(parseProofAuthorityRequest('authorize_mutation_v1',value),value);
 for(const changed of [{...value,source:'CUSTOMER'},{...value,operator:{grant:true}},{...value,mutation:{...mutation,operatorAuthorityRef:h}},{...value,reason:''}])assert.throws(()=>parseProofAuthorityRequest('authorize_mutation_v1',changed));
 const report=parseProofAuthorityReply({schema:'atlas-proof-operator-report-v1',classification:'UNQUALIFIED',authority:false,requestHash:h,mutationId:id(1),operatorAuthorityRef:h});assert.throws(()=>assertR1ProofAuthorityProducer(report));
});
