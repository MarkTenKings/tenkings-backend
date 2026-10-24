import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PROOF_AUTHORITY_ROLES,parseProofAuthorityRequest,parseProofAuthorityReply,proofAuthorityRequestHash} from '../src/proof-authority-protocol.mjs';
import {createProofAuthorityPostgres,assertProofAuthorityCommittedReport} from '../src/proof-authority-postgres.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,h='a'.repeat(64);
const cfg={mode:'LOCAL_FIXTURE',origin:'http://localhost',deploymentId:'fixture',releaseSha:'b'.repeat(40),configHash:h};
const common={uploadId:'demo_upload',proofId:'demo_proof',orderId:'demo_order',orderHash:h,originalRequestHash:h,intakeBindingHash:h,originalSha256:h,originalByteCount:200};
function claim(stage='DECODE'){
  const fields={DECODE:{validationAttemptId:id(2),decoderRequestId:id(3),declaredType:'image/png',originalBootId:id(4),deadlineBootNs:'1000000000',preparedReportHash:h},
    PUBLISH:{publicationOperationId:id(5),validationAttemptId:id(2),decoderRequestId:id(3),objectKey:h,manifestHash:h,decoderCompletionHash:h,publicationIntentHash:h},
    RETAIN:{operationId:id(6),objectKey:h,manifestHash:h,validationAttemptId:id(2),decoderRequestId:id(3),publicationLedgerId:id(7),publicationSessionId:id(8),publicationOperationId:id(5),publicationRevision:1,publicationEvidenceHash:h,qualificationSessionId:id(9),expectedUploadHash:h}};
  return {schema:'atlas-proof-stage-claim-v1',installationId:id(10),requestId:id(11),requestBindingHash:h,source:'STAFF',sessionHash:h,browserHash:h,configBinding:cfg,originalRequestDeadlineAt:1000000000,stageId:id(12),stage,priorStageId:stage==='DECODE'?null:id(13),stageInput:{...common,...fields[stage]}};
}
const unavailable=()=>({schema:'atlas-proof-authority-observation-v1',classification:'UNQUALIFIED',authority:false,status:'UNAVAILABLE',reason:'CANONICAL_JOIN_REQUIRED',requestHash:null});
const absent=()=>({...unavailable(),status:'ABSENT_HOLD',reason:'NO_ORIGINAL_RECORD'});
const digest=x=>createHash('sha256').update(x).digest('hex');

test('three closed stage inputs preserve data and leave C1 authority fields to the DB producer',()=>{
  for(const stage of ['DECODE','PUBLISH','RETAIN']){
    const input=claim(stage),result=parseProofAuthorityRequest('claim_stage_v1',Buffer.from(JSON.stringify(input)));
    assert.deepEqual(result,input);assert.ok(Object.isFrozen(result.stageInput));input.stageInput.originalByteCount=1;assert.equal(result.stageInput.originalByteCount,200);
    for(const key of ['actorId','actorRole','policyHash','actorAccessBindingHash','retentionFenceRevision'])assert.throws(()=>parseProofAuthorityRequest('claim_stage_v1',{...result,stageInput:{...result.stageInput,[key]:1}}));
  }
});
test('claim rejects wrong order, excess authority, invalid numbers, UUIDs, hashes and original deadline shapes',()=>{
  const changes=[{stage:'constructor'},{stage:{toString:()=> 'DECODE'}},{priorStageId:id(1)},{stageId:'anything'},{requestBindingHash:'a'.repeat(63)},{originalRequestDeadlineAt:Infinity},{accessVersion:7}];
  for(const c of changes)assert.throws(()=>parseProofAuthorityRequest('claim_stage_v1',{...claim(),...c}));
  for(const c of [{originalByteCount:0},{originalByteCount:10485761},{deadlineBootNs:'01'},{deadlineBootNs:'9223372036854775808'},{declaredType:'image/webp'},{originalBootId:2}])assert.throws(()=>parseProofAuthorityRequest('claim_stage_v1',{...claim(),stageInput:{...claim().stageInput,...c}}));
  assert.throws(()=>parseProofAuthorityRequest('claim_stage_v1',{...claim(),configBinding:{...cfg,mode:'PRODUCTION'}}));
});
test('duplicate keys, invalid UTF8, hooks, cycles, unknown keys and encoded-size overflow refuse without invoking getters',()=>{
  assert.throws(()=>parseProofAuthorityRequest('lookup_claim_v1',Buffer.from(`{"stageId":"${id(1)}","claimHash":"${h}","claimHash":"${h}"}`)));
  assert.throws(()=>parseProofAuthorityRequest('lookup_claim_v1',Buffer.from([0xff])));
  let reads=0;const x={stageId:id(1)};Object.defineProperty(x,'claimHash',{enumerable:true,get(){reads++;return h;}});assert.throws(()=>parseProofAuthorityRequest('lookup_claim_v1',x));assert.equal(reads,0);
  const cycle={};cycle.self=cycle;assert.throws(()=>parseProofAuthorityRequest('lookup_claim_v1',cycle));
  assert.throws(()=>parseProofAuthorityRequest('lookup_claim_v1',Buffer.alloc(16385,32)));
  assert.throws(()=>parseProofAuthorityRequest('lookup_claim_v1',{stageId:id(1),claimHash:h,constructor:null}));
});
test('stable claim hash and exact original lookup preserve lost-reply correlation',()=>{
  const v=claim('RETAIN');assert.equal(proofAuthorityRequestHash('claim_stage_v1',v),proofAuthorityRequestHash('claim_stage_v1',Object.fromEntries(Object.entries(v).reverse())));
  assert.deepEqual(parseProofAuthorityRequest('lookup_claim_v1',{stageId:v.stageId,claimHash:proofAuthorityRequestHash('claim_stage_v1',v)}),{stageId:v.stageId,claimHash:proofAuthorityRequestHash('claim_stage_v1',v)});
  assert.throws(()=>parseProofAuthorityRequest('lookup_claim_v1',{stageId:v.stageId,operationHash:h}));
});
test('finite mutation/settlement shapes have no SQL, field-list or arbitrary permit seam',()=>{
  const v={schema:'atlas-proof-mutation-begin-v1',mutationId:id(1),kind:'STAFF_IDENTITY_ACCESS',subjectId:id(2),expectedBeforeHash:h,change:{role:'REVIEWER',revoked:true,certificationUntil:null,trustedLearningUntil:null},operatorAuthorityRef:h};
  assert.deepEqual(parseProofAuthorityRequest('begin_mutation_v1',v),v);
  for(const c of [{kind:'SQL'},{change:{...v.change,accessVersion:99}},{operatorAuthorityRef:true}])assert.throws(()=>parseProofAuthorityRequest('begin_mutation_v1',{...v,...c}));
  const s={schema:'atlas-proof-stage-settle-v1',installationId:id(1),stageId:id(2),operationHash:h,settlementId:id(3),disposition:'UNKNOWN_HELD',outcomeHash:h,publisherBarrierId:null,publisherBarrierRevision:null};
  assert.deepEqual(parseProofAuthorityRequest('settle_stage_v1',s),s);assert.throws(()=>parseProofAuthorityRequest('settle_stage_v1',{...s,publisherBarrierRevision:1}));assert.throws(()=>parseProofAuthorityRequest('settle_stage_v1',{...s,disposition:'RETRY'}));
});
test('SQL observations stay unqualified; even shaped positive data is rejected',()=>{
  for(const reply of [unavailable(),absent()])assert.deepEqual(parseProofAuthorityReply(reply),reply);
  for(const changes of [{authority:true},{status:'COMPLETE'},{classification:'QUALIFIED'},{receipt:{}},{reason:'NO_ORIGINAL_RECORD'}])assert.throws(()=>parseProofAuthorityReply({...unavailable(),...changes}));
});

// A transport-fault model only. It returns UNAVAILABLE/ABSENT_HOLD, never an
// authenticated principal, native receipt, admitted stage or real PG evidence.
function model({unsafe=false,extra=false,changed=false,loseCommit=false,positive=false,blockCommit=false}={}){
  const calls=[],releases=[],definitions=Object.fromEntries(PROOF_AUTHORITY_ROLES.REQUEST.map(n=>[n,`synthetic-definition:${n}`]));
  let unblock,commitStarted;const started=new Promise(r=>commitStarted=r),wait=new Promise(r=>unblock=r);
  const client={async query(sql,args){calls.push({sql,args});
    if(sql.includes('current_user AS role'))return {rows:[{role:'atlas_proof_request',database:'fixture',rolsuper:unsafe,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,rolinherit:false,membership:false,database_owner:false}]};
    if(sql.includes('AS gateway_usage'))return {rows:[{gateway_usage:true,database_write:false,schema_write:false,direct_table:false,sequence_access:false}]};
    if(sql.includes('pg_get_functiondef'))return {rows:[...Object.entries(definitions).map(([name,definition])=>({schema:'atlas_proof_authority',name,definer:true,config:['search_path=pg_catalog'],owner:'atlas_proof_authority_owner',definition:changed?definition+'x':definition})),...(extra?[{name:'extra()'}]:[])]};
    if(sql.startsWith('SELECT atlas_proof_authority.'))return {rows:[{result:positive?{...unavailable(),authority:true}:sql.includes('lookup_')?absent():unavailable()}]};
    if(sql==='COMMIT'){commitStarted();if(blockCommit)await wait;if(loseCommit){loseCommit=false;throw new Error('synthetic lost reply');}}
    return {rows:[]};
  },release(broken){releases.push(broken);}};
  const pool={async connect(){return client;}},options={enabled:true,pool,roleKind:'REQUEST',expectedRole:'atlas_proof_request',expectedDatabase:'fixture',expectedFunctionOwner:'atlas_proof_authority_owner',functionHashes:Object.fromEntries(Object.entries(definitions).map(([n,d])=>[n,digest(d)]))};
  return {calls,releases,options,started,unblock};
}
test('default off and closed invalid options do not connect or admit callbacks',()=>{
  let calls=0;assert.equal(createProofAuthorityPostgres({pool:{connect(){calls++;}}}),null);assert.equal(calls,0);
  assert.throws(()=>createProofAuthorityPostgres({enabled:false,authorize:()=>true}));
  const m=model();assert.throws(()=>createProofAuthorityPostgres({...m.options,functionHashes:{...m.options.functionHashes,'extra()':h}}));assert.equal(m.calls.length,0);
  const a=createProofAuthorityPostgres(m.options);assert.equal(a.authority,false);assert.equal(a.settleStage,undefined);assert.equal(a.applyMutation,undefined);
});
test('unsafe role, extra grants and changed function definitions fail before gateway dispatch',async()=>{
  for(const flags of [{unsafe:true},{extra:true},{changed:true}]){
    const m=model(flags),a=createProofAuthorityPostgres(m.options);await assert.rejects(a.lookupClaim({stageId:id(1),claimHash:h}));assert.equal(m.calls.some(x=>x.sql.startsWith('SELECT atlas_proof_authority.')),false);assert.deepEqual(m.releases,[true]);
  }
});
test('unavailable/absent transport returns data only and rejects positive SQL without COMMIT',async()=>{
  const m=model(),a=createProofAuthorityPostgres(m.options);assert.deepEqual(await a.claimStage(claim()),unavailable());assert.deepEqual(await a.lookupClaim({stageId:id(1),claimHash:h}),absent());
  const p=model({positive:true}),b=createProofAuthorityPostgres(p.options);await assert.rejects(b.claimStage(claim()));assert.ok(p.calls.some(x=>x.sql==='ROLLBACK'));assert.equal(p.calls.some(x=>x.sql==='COMMIT'),false);
});
test('unknown mutation COMMIT is absorbing locally; exact original lookup remains available',async()=>{
  const m=model({loseCommit:true}),a=createProofAuthorityPostgres(m.options);await assert.rejects(a.claimStage(claim()),e=>e.code==='PROOF_AUTHORITY_COMMIT_UNKNOWN');
  const count=m.calls.length;await assert.rejects(a.claimStage(claim()),e=>e.code==='PROOF_AUTHORITY_UNKNOWN_HOLD');assert.equal(m.calls.length,count);assert.equal(m.releases.at(-1),true);
  assert.deepEqual(await a.lookupClaim({stageId:claim().stageId,claimHash:proofAuthorityRequestHash('claim_stage_v1',claim())}),absent());
  await assert.rejects(a.claimStage(claim()),e=>e.code==='PROOF_AUTHORITY_UNKNOWN_HOLD');assert.equal(m.calls.filter(x=>x.sql.startsWith('SELECT atlas_proof_authority.claim_stage')).length,1);
});
test('pending duplicate, changed-ID payload, capacity and close all refuse without new dispatch',async()=>{
  const m=model({blockCommit:true}),a=createProofAuthorityPostgres({...m.options,maxTrackedMutations:1});const first=a.claimStage(claim());await m.started;
  await assert.rejects(a.claimStage(claim()),e=>e.code==='PROOF_AUTHORITY_PENDING_HOLD');m.unblock();await first;
  await assert.rejects(a.claimStage({...claim(),requestBindingHash:'b'.repeat(64)}),e=>e.code==='PROOF_AUTHORITY_ID_CONFLICT');
  await assert.rejects(a.claimStage({...claim(),stageId:id(90)}),e=>e.code==='PROOF_AUTHORITY_CAPACITY_HOLD');a.close();await assert.rejects(a.lookupClaim({stageId:id(1),claimHash:h}));assert.equal(m.calls.filter(x=>x.sql.startsWith('SELECT atlas_proof_authority.claim_stage')).length,1);
});

test('audited reply origin is available only after completed COMMIT and never transfers to a JSON copy',async()=>{
 const m=model({blockCommit:true}),a=createProofAuthorityPostgres(m.options),pending=a.claimStage(claim());await m.started;
 assert.throws(()=>assertProofAuthorityCommittedReport(unavailable(),{gateway:a,action:'claim_stage_v1'}));m.unblock();const result=await pending;
 assert.deepEqual(assertProofAuthorityCommittedReport(result,{gateway:a,action:'claim_stage_v1'}),claim());
 assert.throws(()=>assertProofAuthorityCommittedReport({...result},{gateway:a,action:'claim_stage_v1'}));
 assert.throws(()=>assertProofAuthorityCommittedReport(result,{gateway:a,action:'lookup_claim_v1'}));
 const other=createProofAuthorityPostgres(model().options);assert.throws(()=>assertProofAuthorityCommittedReport(result,{gateway:other,action:'claim_stage_v1'}));
});
