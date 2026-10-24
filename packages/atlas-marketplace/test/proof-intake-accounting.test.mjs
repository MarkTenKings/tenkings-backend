import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hash,canonicalJSON} from '../src/contract.mjs';
import {projectIntakeProtectedOperation} from '../src/proof-intake-protected-protocol.mjs';
import {intakeAccountingInstallation,intakeAccountingInitial,intakeAccountingRead,intakeAccountingOutcome,projectIntakeAccounting,intakeAccountingValidation} from '../src/proof-intake-accounting.mjs';
import {createProofIntakeAccountedPostgres} from '../src/proof-intake-protected-postgres.mjs';
import {createProofIntakeAccountedConnectionOwner} from '../src/proof-retention-postgres-connection.mjs';
import {takeProofDecoderPreparedSubmission,assertProofDecoderPreparedSubmissionBeforeDeadline} from '../src/proof-decoder-target-broker.mjs';
// Synthetic transition inputs only. No client/native/outcome brand is mocked.
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
function setup(limit=16){const f=fixture();f.accounting={schema:'atlas-proof-intake-accounting-installed-v1',intakeInstallationHash:hash(f.installation),operationalLimit:limit};f.read={schema:'atlas-proof-intake-accounting-read-v1',createOperationId:f.created.operation.operationId,createOperationHash:f.created.operationHash,entries:[]};return f;}
const parse=f=>intakeAccountingRead(f.read,f.created,f.installation,f.accounting);
const apply=(f,e)=>projectIntakeAccounting(f.read,e,f.created,f.installation,f.accounting);
function attempt(f,at=3000){return {attemptId:randomUUID(),leaseId:randomUUID(),requestId:f.observation.request.requestId,originalHash:hash({uploadId:f.created.upload.uploadId,objectKey:f.created.upload.objectKey,plan:f.created.upload.plan}),at};}
function entry(f,a,kind,extra={},observation=null){return {schema:'atlas-proof-intake-accounting-entry-v1',createOperationId:f.created.operation.operationId,createOperationHash:f.created.operationHash,prepared:f.observation.request,action:{kind,actionId:randomUUID(),...a,...extra},observation};}
function append(f,e){const next=apply(f,e);f.read=next.read;return next;}
function reserve(f,a){return append(f,entry(f,a,'RESERVE',{leaseUntil:a.at+1000}));}
function observe(f,a,disposition='COMPLETE_CLEAN',outcome='SUCCESS',at=a.at+2){const o={...f.observation,disposition,completion:disposition==='COMPLETE_CLEAN'?{...f.observation.completion,outcome,validation:outcome==='SUCCESS'?f.observation.completion.validation:null}:null};return entry(f,a,'OBSERVE_OUTCOME',{at,...intakeAccountingOutcome(o)},o);}
test('accounting is installed, bounded, separate from immutable legacy attempts and closed to coercion',()=>{
 const f=setup(),before=structuredClone(f),s=intakeAccountingInitial(f.created,f.installation,f.accounting);
 assert.equal(s.accounting.operationalAttempts,0);assert.equal(s.accounting.contentRejections,0);assert.equal(s.accounting.legacyAttempts,0);assert.equal(s.requirement.legacy.snapshotHash,f.created.uploadHash);assert.deepEqual(f,before);
 for(const patch of [{operationalLimit:0},{operationalLimit:17},{operationalLimit:'16'},{intakeInstallationHash:hash('other')},{qualified:true}])assert.throws(()=>intakeAccountingInstallation({...f.accounting,...patch},f.installation));
 let calls=0;assert.throws(()=>intakeAccountingInstallation({...f.accounting,get operationalLimit(){calls++;return 16;}},f.installation));assert.equal(calls,0);
 const adopted=structuredClone(f.created);adopted.upload.attempts=3;adopted.uploadHash=hash(adopted.upload);assert.throws(()=>intakeAccountingInitial(adopted,f.installation,f.accounting));
});
test('exact duplicate reserve and outcome are idempotent; conflicting IDs and reordered submission refuse',()=>{
 const f=setup(),a=attempt(f),r=entry(f,a,'RESERVE',{leaseUntil:4000});append(f,r);assert.equal(apply(f,r).writeRequired,false);assert.equal(parse(f).state.accounting.operationalAttempts,1);
 assert.throws(()=>apply(f,{...r,action:{...r.action,at:3001}}),{code:'INTAKE_ACCOUNTING_CONFLICT'});
 const beforeSubmit=observe(f,a);assert.equal(apply(f,beforeSubmit).state.accounting.holdReason,'CONTRADICTORY_EFFECT_CLAIMS');
 append(f,entry(f,a,'SUBMIT_INTENT',{at:3001}));const o=observe(f,a);append(f,o);assert.equal(apply(f,o).writeRequired,false);assert.equal(parse(f).state.accounting.disposition,'VALIDATION_REVIEW_REQUIRED');
 assert.throws(()=>apply(f,{...o,action:{...o.action,actionId:randomUUID()}}),{code:'INTAKE_ACCOUNTING_CONFLICT'});
 assert.equal(f.created.upload.attempts,0);assert.equal(parse(f).state.accounting.contentRejections,0);
});
test('same-byte uploads cannot borrow the CREATE/hash/storage association or change prepared deadline',()=>{
 const f=setup(),a=attempt(f);reserve(f,a);const e=entry(f,a,'SUBMIT_INTENT',{at:3001});
 for(const patch of [{createOperationId:randomUUID()},{createOperationHash:hash('other')},{prepared:{...e.prepared,deadlineBootNs:'1000000001'}},{action:{...e.action,originalHash:hash('another-upload')}}])assert.throws(()=>apply(f,{...e,...patch}));
 const other=setup();other.created.operation.request.sha256=f.created.operation.request.sha256;assert.throws(()=>intakeAccountingRead(f.read,other.created,other.installation,other.accounting));
 assert.throws(()=>apply(f,{...e,action:{...e.action,leaseId:randomUUID()}}));
});
test('sixteen known-no-start operational attempts fit bounded history; seventeenth refuses without content count',()=>{
 const f=setup();for(let i=0;i<16;i++){
  f.observation={...f.observation,request:{...f.observation.request,requestId:randomUUID()}};const a=attempt(f,3000+i*10);reserve(f,a);append(f,entry(f,a,'SUBMIT_INTENT',{at:a.at+1}));append(f,observe(f,a,'KNOWN_NO_START_SENT','SUCCESS',a.at+2));
 }
 const parsed=parse(f),head={schema:'atlas-proof-intake-accounting-head-v1',createOperationId:f.read.createOperationId,createOperationHash:f.read.createOperationHash,entryHashes:f.read.entries.map(e=>hash(e))};
 assert.ok(Buffer.byteLength(canonicalJSON(f.read))>32768);assert.ok(Buffer.byteLength(canonicalJSON(head))<8192);assert.equal(parsed.headHash,hash(head));assert.notEqual(parsed.headHash,hash(f.read));
 for(const altered of [{...head,entryHashes:[...head.entryHashes].reverse()},{...head,entryHashes:head.entryHashes.slice(1)},{...head,createOperationId:randomUUID()},{...head,createOperationHash:hash('other')},{...head,schema:'atlas-proof-intake-accounting-read-v1'}])assert.notEqual(parsed.headHash,hash(altered));
 const empty={schema:head.schema,createOperationId:f.read.createOperationId,createOperationHash:f.read.createOperationHash,entryHashes:[]};assert.equal(intakeAccountingRead({...f.read,entries:[]},f.created,f.installation,f.accounting).headHash,hash(empty));
 const s=parsed.state;assert.equal(s.accounting.operationalAttempts,16);assert.equal(s.accounting.contentRejections,0);assert.equal(s.accounting.disposition,'OPERATIONAL_BUDGET_REVIEW_REQUIRED');assert.equal(s.events.length,48);assert.equal(f.created.upload.attempts,0);
 f.observation={...f.observation,request:{...f.observation.request,requestId:randomUUID()}};assert.throws(()=>reserve(f,attempt(f,3200)),{code:'PROOF_VALIDATION_TRANSITION_DENIED'});
});
test('invalid image counts content once only after complete submitted cleanup; unknown and expiry absorb later success',()=>{
 const f=setup(),a=attempt(f);reserve(f,a);append(f,entry(f,a,'SUBMIT_INTENT',{at:3001}));const invalid=observe(f,a,'COMPLETE_CLEAN','INVALID_IMAGE');append(f,invalid);assert.equal(apply(f,invalid).state.accounting.contentRejections,1);assert.equal(parse(f).state.accounting.disposition,'CONTENT_REJECTION_REVIEW_REQUIRED');
 for(const kind of ['UNKNOWN','EXPIRE_LEASE']){
  const x=setup(),b=attempt(x);reserve(x,b);append(x,entry(x,b,'SUBMIT_INTENT',{at:3001}));
  if(kind==='UNKNOWN'){append(x,observe(x,b,'UNKNOWN'));assert.throws(()=>append(x,observe(x,b,'COMPLETE_CLEAN','SUCCESS',3003)));}
  else {append(x,entry(x,b,'EXPIRE_LEASE',{at:4000}));append(x,observe(x,b,'COMPLETE_CLEAN','SUCCESS',4001));}
  const s=parse(x).state;assert.equal(s.accounting.disposition,'UNRESOLVED_HOLD');assert.equal(s.accounting.contentRejections,0);assert.equal(s.accounting.activeAttemptId,b.attemptId);
  x.observation={...x.observation,request:{...x.observation.request,requestId:randomUUID()}};assert.throws(()=>reserve(x,attempt(x,5000)),{code:'PROOF_VALIDATION_TRANSITION_DENIED'});
 }
});
test('validation consumes exact successful accounted attempt and never a raw observation or different DTO',()=>{
 const f=setup(),a=attempt(f);reserve(f,a);append(f,entry(f,a,'SUBMIT_INTENT',{at:3001}));append(f,observe(f,a));
 const operation={validationAttemptId:a.attemptId,decoderRequestId:a.requestId,validation:f.observation.completion.validation,createOperationId:f.created.operation.operationId,createOperationHash:f.created.operationHash,expectedUploadHash:f.created.uploadHash};
 assert.equal(intakeAccountingValidation(f.read,operation,f.created,f.installation,f.accounting).state.accounting.operationalAttempts,1);
 for(const patch of [{validationAttemptId:randomUUID()},{decoderRequestId:randomUUID()},{expectedUploadHash:hash('other')},{validation:{...operation.validation,width:2}}])assert.throws(()=>intakeAccountingValidation(f.read,{...operation,...patch},f.created,f.installation,f.accounting),{code:'INTAKE_ACCOUNTING_VALIDATION_HOLD'});
 const corrupt=structuredClone(f.read);corrupt.entries[2].observation.completion.validation.sha256=hash('other');assert.throws(()=>intakeAccountingRead(corrupt,f.created,f.installation,f.accounting));
});
test('accounted factories remain default-off and transfer refuses non-private handles without calling supplied methods',()=>{
 for(const factory of [createProofIntakeAccountedPostgres,createProofIntakeAccountedConnectionOwner]){assert.equal(factory(),null);for(const key of ['pool','client','observer','authorize','clock','outcomeVerifier'])assert.throws(()=>factory({[key]:()=>assert.fail('called')}));}
 let calls=0;const client={status(){calls++;},submitPrepared(){calls++;},boottimeNanoseconds(){calls++;}},handle={report:setup().observation.request};
 for(const verify of [takeProofDecoderPreparedSubmission,assertProofDecoderPreparedSubmissionBeforeDeadline]){assert.throws(()=>verify(handle,{client}),{code:'DECODER_BROKER_CLIENT_REQUIRED'});assert.throws(()=>verify(handle,{get client(){calls++;return client;}}));}assert.equal(calls,0);
});
