import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createIntakeRepository, intakeGrantSQL } from '../src/repository.mjs';
import { createManualIntake } from '../src/service.mjs';
import { document } from '../src/contract.mjs';
import { createBatchRepository, batchGrantSQL } from '../../atlas-batch-grading/src/repository.mjs';
import { analysisReceiptGrantSQL } from '../../atlas-defect-analysis/src/repository.mjs';
import { earlyGeometryGrantSQL } from '../../atlas-connected-manual/src/early-geometry-store.mjs';
import { createManualRepository } from '../../atlas-manual-service/src/repository.mjs';

const output=process.env.ATLAS_DISCARD_EVIDENCE;
assert(output && resolve(output)===output,'Supply an absolute owned evidence directory');
await mkdir(output,{recursive:true,mode:0o700});
const fixture=await createOwnedManualFixture(process.argv.slice(2));
const checks=[],record=name=>checks.push(name),denied=(promise,code)=>assert.rejects(promise,error=>error.code===code);
let connection=fixture.connect();
const login=async phone=>{
 const boot=await connection.auth.bootstrap(''),cookie=`${fixture.config.cookies.browser}=${boot.browserToken}`;
 const challenge=await connection.auth.send(cookie,boot.csrf,{phone,requestId:randomUUID()},'fixture-discard');
 const verified=await connection.auth.verify(cookie,boot.csrf,{challengeId:challenge.challengeId,code:'424242'},'fixture-discard');
 return connection.auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`,verified.csrf);
};
const compose=()=>{
 const repository=createIntakeRepository({boundary:connection.boundary,keyPrefix:'intake',maxOriginalBytes:1024});
 const service=createManualIntake({repository,storage:{},artifacts:{}});
 return {repository,service};
};
let {repository,service}=compose();
try{
 await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual')+'\n'+batchGrantSQL('atlas_fixture_manual')+'\n'+earlyGeometryGrantSQL('atlas_fixture_manual')+'\n'+analysisReceiptGrantSQL('atlas_fixture_manual'),[],fixture.database.name);
 const owner=await login('+12025550141'),observer=await login('+12025550142'),other=await login('+12025550143');
 const create=async(staff=owner)=>{const input={requestId:randomUUID(),label:'Disposable discard fixture'};return {input,...await service.create(staff,input)};};
 const first=await create(),foreign=await create(other),localOnly=randomUUID();
 assert.equal(first.card.createRequestId,first.input.requestId);
 const attempt={requestId:randomUUID(),scope:'SELECTED',cardIds:[first.card.cardId,foreign.card.cardId]};
 await denied(service.discard(owner,attempt),'INTAKE_CARD_NOT_FOUND');
 assert.deepEqual(await service.discardStatus(owner,{cardIds:[first.card.cardId]}),{cardIds:[],createRequestIds:[]});
 await denied(service.discard(observer,{requestId:randomUUID(),scope:'ALL'}),'INTAKE_CARD_ACCESS_DENIED');
 record('cross-owner/observer refusal is atomic and leaks no retirement state');

 // Exact source metadata is synthetic; no storage/model/network operation occurs.
 for(const side of ['FRONT','BACK']){
  const {upload}=await repository.plan(owner,first.card.cardId,{requestId:randomUUID(),side,expectedVersion:0,sha256:'a'.repeat(64),byteCount:1});
  const observed={object:upload.plan.object,sha256:'a'.repeat(64),byteCount:1,contentType:'application/octet-stream'};
  await repository.recordVerification(owner,first.card.cardId,upload.uploadId,observed);
  await repository.recordSource(owner,first.card.cardId,upload.uploadId,{verificationHash:document(observed).hash,source:{fixture:true}});
 }
 const ready=(await service.read(owner,first.card.cardId)).card;
 const front=ready.sides.FRONT.upload,engine='c'.repeat(64),geometryClaim=randomUUID();
 await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual_connected.early_geometry_intent(upload_id,card_id,actor_id,access_version) VALUES($1::uuid,$2::uuid,$3::uuid,$4)',front.uploadId,ready.cardId,owner.id,1);
 // The fixture's actual identity version is authoritative for the CPU worker.
 await fixture.admin.$executeRawUnsafe('UPDATE atlas_manual_connected.early_geometry_intent SET access_version=(SELECT "accessVersion" FROM atlas_staff."StaffIdentity" WHERE id=$1::uuid) WHERE upload_id=$2::uuid',owner.id,front.uploadId);
 const geometryInput=document({policy:'atlas-early-photo-geometry-v1',cardId:ready.cardId,uploadId:front.uploadId,side:'FRONT',engineHash:engine,
   plan:front.plan,verification:front.verification,photoSource:front.source,settings:{matColor:'BLACK',cornerShape:'ROUNDED_3_18_MM'}}).text;
 assert.equal((await connection.manualClient.$queryRawUnsafe('SELECT atlas_manual_connected.queue_early_geometry($1) queued',geometryInput))[0].queued,true);
 const geometry=(await connection.manualClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.claim_early_geometry($1,$2::uuid)',engine,geometryClaim))[0];assert(geometry);

 const batch=createBatchRepository({boundary:connection.boundary,intakeRepository:repository});
 const {jobs}=await batch.enqueue(owner,{actionId:randomUUID(),cards:[{cardId:ready.cardId,sourceHash:ready.sourceHash}]});
 const claim=await batch.claim(owner,randomUUID(),2);assert.equal(claim.key,jobs[0].key);
 const content=document({fixture:'retained manual history'});
 await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,$2,$3,$4::uuid)',ready.cardId,content.text,content.hash,owner.id);
 const manual=createManualRepository({boundary:connection.boundary,validateAccess:({tx,cardId})=>repository.assertActiveInTransaction(tx,cardId)});
 assert.equal((await manual.load(owner,ready.cardId)).card.cardId,ready.cardId);
 const all={requestId:randomUUID(),scope:'ALL',createRequestIds:[localOnly]};
 const removed=await service.discard(owner,all);
 assert.deepEqual(removed.receipt.cardIds,[ready.cardId]);
 assert.deepEqual(removed.receipt.createRequestIds,[localOnly,first.input.requestId].sort());
 assert.equal((await service.list(owner)).cards.length,0);
 assert.equal((await batch.list(owner)).jobs.length,0);
 await denied(service.create(owner,first.input),'INTAKE_CARD_DELETED');
 await denied(service.create(owner,{requestId:localOnly,label:''}),'INTAKE_CARD_DELETED');
 for(const operation of [()=>service.read(owner,ready.cardId),()=>manual.load(owner,ready.cardId),()=>manual.status(owner,ready.cardId,randomUUID()),
  ()=>batch.enqueue(owner,{actionId:randomUUID(),cards:[{cardId:ready.cardId,sourceHash:ready.sourceHash}]}),
  ()=>batch.resume(owner,{key:claim.key,expectedRevision:claim.revision})])await denied(operation(),'INTAKE_CARD_DELETED');
 assert.equal(await batch.renew(owner,claim),false);
 assert.equal(await batch.finish(owner,claim,{kind:'CONTINUE'}),false);
 assert.equal(await batch.claim(owner,randomUUID(),2),null);
 const [job]=await fixture.admin.$queryRawUnsafe('SELECT state,claim_id,lease_until,code FROM atlas_manual_connected.batch_grading WHERE key=$1',claim.key);
 assert.deepEqual(job,{state:'NEEDS_ATTENTION',claim_id:null,lease_until:null,code:'INTAKE_CARD_DELETED'});
 const [kept]=await fixture.admin.$queryRawUnsafe('SELECT (SELECT count(*)::int FROM atlas_manual_intake.upload WHERE card_id=$1::uuid) uploads,(SELECT count(*)::int FROM atlas_manual.card WHERE id=$1::uuid) manual',ready.cardId);
 assert.deepEqual(kept,{uploads:2,manual:1});
 assert.equal((await connection.manualClient.$queryRawUnsafe('SELECT atlas_manual_connected.queue_early_geometry($1) queued',geometryInput))[0].queued,false);
 assert.equal((await connection.manualClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.pending_early_geometry($1,NULL,NULL)',engine)).length,0);
 assert.equal((await connection.manualClient.$queryRawUnsafe('SELECT atlas_manual_connected.finish_early_geometry($1,$2::uuid,$3,$4,$5) finished',geometry.key,geometryClaim,'READY','{}',null))[0].finished,false);
 const [finishedGeometry]=await fixture.admin.$queryRawUnsafe('SELECT state,claim_id,result,error FROM atlas_manual_connected.early_geometry WHERE key=$1',geometry.key);
 assert.deepEqual(finishedGeometry,{state:'FAILED',claim_id:null,result:null,error:'INTAKE_CARD_DELETED'});
 assert.equal((await connection.manualClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.claim_early_geometry($1,$2::uuid)',engine,randomUUID())).length,0);
 // Deleted unstarted work and a crashed worker with attempts remaining must
 // terminalize; neither may remain forever in the operational idle census.
 for(const state of ['QUEUED','RUNNING']){
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.early_geometry SET state=$2,attempts=1,claim_id=CASE WHEN $2='RUNNING' THEN $3::uuid ELSE NULL END,lease_until=CASE WHEN $2='RUNNING' THEN clock_timestamp()-interval '1 second' ELSE NULL END,error=NULL WHERE key=$1",geometry.key,state,randomUUID());
  assert.equal((await connection.manualClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.claim_early_geometry($1,$2::uuid)',engine,randomUUID())).length,0);
  const [reaped]=await fixture.admin.$queryRawUnsafe('SELECT state,claim_id,lease_until,result,error,attempts FROM atlas_manual_connected.early_geometry WHERE key=$1',geometry.key);
  assert.deepEqual(reaped,{state:'FAILED',claim_id:null,lease_until:null,result:null,error:'INTAKE_CARD_DELETED',attempts:1});
 }
 // Reaping must not free capacity while a live worker still holds its lease.
 const liveClaim=randomUUID();
 await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.early_geometry SET state='RUNNING',attempts=1,claim_id=$2::uuid,lease_until=clock_timestamp()+interval '1 minute',error=NULL WHERE key=$1",geometry.key,liveClaim);
 assert.equal((await connection.manualClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.claim_early_geometry($1,$2::uuid)',engine,randomUUID())).length,0);
 const [stillLive]=await fixture.admin.$queryRawUnsafe('SELECT state,claim_id,error FROM atlas_manual_connected.early_geometry WHERE key=$1',geometry.key);
 assert.deepEqual(stillLive,{state:'RUNNING',claim_id:liveClaim,error:null});
 assert.equal((await connection.manualClient.$queryRawUnsafe('SELECT atlas_manual_connected.finish_early_geometry($1,$2::uuid,$3,$4,$5) finished',geometry.key,liveClaim,'READY','{}',null))[0].finished,false);
 record('deleted queued and expired geometry claims terminalize below the retry cap; an unexpired CPU lease remains until its owner finishes');
 // Simulate a process dying after reserving ANALYZE but before a run exists.
 await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.batch_grading SET state='RUNNING',stage='ANALYZE',analysis_reserved=true,claim_id=$2::uuid,lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",claim.key,randomUUID());
 assert.equal(await batch.claim(owner,randomUUID(),2),null);
 const [crashed]=await fixture.admin.$queryRawUnsafe('SELECT state,analysis_reserved,claim_id FROM atlas_manual_connected.batch_grading WHERE key=$1',claim.key);
 assert.deepEqual(crashed,{state:'NEEDS_ATTENTION',analysis_reserved:false,claim_id:null});
 record('deleted cards disappear from intake/batch, block create/read/manual replay/admission/resume, release own running lease, retain original and grading records');

 const later=await create();assert.deepEqual(await service.discard(owner,all),removed);
 assert.deepEqual((await service.list(owner)).cards.map(c=>c.cardId),[later.card.cardId]);
 await denied(service.discard(owner,{...all,createRequestIds:[]}),'INTAKE_REQUEST_ID_CONFLICT');
 const status=await service.discardStatus(owner,{createRequestIds:[localOnly,first.input.requestId,later.input.requestId],cardIds:[foreign.card.cardId]});
 assert.deepEqual(status,{createRequestIds:[localOnly,first.input.requestId].sort(),cardIds:[]});
 assert.deepEqual(await service.discardStatus(owner,{cardIds:[ready.cardId]}),{cardIds:[ready.cardId],createRequestIds:[]});
 assert.equal((await service.list(other)).cards.length,1);
 record('lost ALL response replays frozen snapshot and cannot capture newer cards; status is owner-scoped and includes local-only IDs');

 // A stale URL can be delivered after discard, but the late metadata commit
 // and every fresh signing/processing request must refuse the retired card.
 const plan=await repository.plan(owner,later.card.cardId,{requestId:randomUUID(),side:'FRONT',expectedVersion:0,sha256:'b'.repeat(64),byteCount:1});
 let start,release;const began=new Promise(r=>start=r),gate=new Promise(r=>release=r);
 const delayed=createManualIntake({repository,storage:{createOriginalUpload:async()=>{start();await gate;return {url:'https://fixture.invalid'};}},artifacts:{}});
 const signing=delayed.sign(owner,later.card.cardId,plan.upload.uploadId);await began;
 const liability=randomUUID(),liabilityHash='d'.repeat(64),compact=document({fixture:true});
 await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,$2,$3,$4::uuid)',later.card.cardId,content.text,content.hash,owner.id);
 await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_defect_analysis.run(id,card_id,action_id,actor_id,base_hash,binding,binding_hash,request_hash,request_ref,request_evidence,evidence_hash,state,expires_at)
 VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$5,$6,$6,$7,'PREPARED',clock_timestamp()+interval '3 minutes')`,liability,later.card.cardId,randomUUID(),owner.id,liabilityHash,compact.text,compact.hash);
 await fixture.admin.$executeRawUnsafe("UPDATE atlas_defect_analysis.run SET state='DISPATCHED',dispatched_at=clock_timestamp() WHERE id=$1::uuid",liability);

 await service.discard(owner,{requestId:randomUUID(),scope:'SELECTED',cardIds:[later.card.cardId]});release();
 await denied(signing,'INTAKE_CARD_DELETED');
 await denied(repository.recordVerification(owner,later.card.cardId,plan.upload.uploadId,{object:plan.upload.plan.object,sha256:'b'.repeat(64),byteCount:1,contentType:'application/octet-stream'}),'INTAKE_CARD_DELETED');
 const response=document({state:'READY',responseRef:{fixture:true},resultRef:{fixture:true},responseHash:'e'.repeat(64),providerRequestId:'fixture',responseId:'fixture',httpStatus:200,usage:null,code:null}).text;
 assert.equal((await connection.manualClient.$queryRawUnsafe('SELECT atlas_defect_analysis.append_receipt($1::uuid,$2,$3,$4) saved',liability,liabilityHash,'RESPONSE',response))[0].saved,true);
 assert.equal((await fixture.admin.$queryRawUnsafe('SELECT count(*)::int n FROM atlas_defect_analysis.receipt WHERE analysis_id=$1::uuid',liability))[0].n,1);
 record('already-dispatched result receipt remains appendable after deletion without renewing card authority');
 record('late signed reply and late upload verification cannot reactivate a discarded card');

 // Actual concurrent transactions: exactly one ordering wins and either
 // ordering leaves a permanent retirement; the other owner's workspace lives.
 const raceId=randomUUID();
 const results=await Promise.allSettled([service.create(owner,{requestId:raceId,label:'race'}),service.discard(owner,{requestId:randomUUID(),scope:'SELECTED',createRequestIds:[raceId]})]);
 assert.equal(results[1].status,'fulfilled');
 if(results[0].status==='rejected')assert.equal(results[0].reason.code,'INTAKE_CARD_DELETED');
 await denied(service.create(owner,{requestId:raceId,label:'race'}),'INTAKE_CARD_DELETED');
 record('concurrent first-create and local-only discard serialize to non-resurrectable retirement');

 // A busy source transaction cannot create an exclusive-waiter deadlock.
 const busy=await create(),busyIntent={requestId:randomUUID(),scope:'SELECTED',cardIds:[busy.card.cardId]};
 let locked,unlock;const lockReady=new Promise(r=>locked=r),lockGate=new Promise(r=>unlock=r);
 const holding=fixture.admin.$transaction(async tx=>{await tx.$queryRawUnsafe('SELECT id FROM atlas_manual_intake.card WHERE id=$1::uuid FOR SHARE',busy.card.cardId);locked();await lockGate;},{timeout:5000});
 await lockReady;
 try{await denied(service.discard(owner,busyIntent),'INTAKE_DISCARD_BUSY');
   assert.deepEqual(await service.discardStatus(owner,{cardIds:[busy.card.cardId]}),{cardIds:[],createRequestIds:[]});}
 finally{unlock();await holding;}
 assert.deepEqual((await service.discard(owner,busyIntent)).receipt.cardIds,[busy.card.cardId]);
 record('real source-row contention returns bounded atomic busy refusal; identical pending request succeeds after release');

 // ALL is not a 100-card product cap. Explicit client selectors stay bounded.
 const values=Array.from({length:121},()=>({id:randomUUID(),pair:randomUUID(),request:randomUUID()}));
 for(const value of values){const request=document({requestId:value.request,label:'large owned fixture'});
  await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',value.id,value.pair,owner.id,value.request,request.hash,'large owned fixture');}
 const large=await service.discard(owner,{requestId:randomUUID(),scope:'ALL'});assert(large.receipt.cardIds.length>=123);
 assert.equal((await service.list(owner)).cards.length,0);
 await assert.rejects(service.discardStatus(owner,{createRequestIds:Array.from({length:101},()=>randomUUID())}));
 await assert.rejects(connection.manualClient.$executeRawUnsafe('DELETE FROM atlas_manual_intake.discarded_card'));
 await assert.rejects(fixture.admin.$executeRawUnsafe('DELETE FROM atlas_manual_intake.discarded_card'));
 await assert.rejects(fixture.admin.$executeRawUnsafe('UPDATE atlas_manual_intake.discard_request SET receipt=receipt'));
 // Direct old-serving INSERT cannot bypass a tombstone even without new JS.
 await assert.rejects(fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)',randomUUID(),randomUUID(),owner.id,localOnly,'a'.repeat(64),'stale create'));
 record('ALL retires more than 100 cards, selectors remain bounded, immutable SQL/role guards reject edits/deletes and stale SQL creates');
 const protectedCard=await create(),ordinaryCard=await create(),approvalId=randomUUID();
 await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id) VALUES($1::uuid,1,$2,$3,$4::uuid)',protectedCard.card.cardId,content.text,content.hash,owner.id);
 await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1::uuid,$2::uuid,$3::uuid,1,2,$4,$5,$5)',protectedCard.card.cardId,approvalId,owner.id,content.hash,content.text);
 await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1::uuid,$2::uuid,$3::uuid,1,$4,$4,$5)',protectedCard.card.cardId,approvalId,owner.id,content.hash,content.text);
 await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1::uuid,$2,$3)',protectedCard.card.cardId,'ar_'+randomUUID().replaceAll('-','').slice(0,24),'ATLAS-'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase());
 await fixture.admin.$executeRawUnsafe("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1::uuid,$2::uuid,1,'LOCAL_FIXTURE')",protectedCard.card.cardId,approvalId);
 const refused={requestId:randomUUID(),scope:'ALL'};
 await denied(service.discard(owner,refused),'INTAKE_CARD_HAS_COMMITTED_OBLIGATIONS');
 assert.deepEqual((await service.list(owner)).cards.map(c=>c.cardId).sort(),[protectedCard.card.cardId,ordinaryCard.card.cardId].sort());
 assert.equal((await fixture.admin.$queryRawUnsafe('SELECT count(*)::int n FROM atlas_manual_intake.discard_request WHERE owner_id=$1::uuid AND request_id=$2::uuid',owner.id,refused.requestId))[0].n,0);
 const handle=connection.auth.actors.get(owner),binding=Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(k=>[k,fixture.config[k]]));
 const [{result:dealer}]=await fixture.admin.$queryRawUnsafe('SELECT atlas_dealer.staff_call($1,$2,$3,$4::jsonb,$5::text[],$6::jsonb) result','read',handle.sessionHash,handle.browserHash,JSON.stringify(binding),[...fixture.config.phoneByHash.keys()],'{}');
 assert.deepEqual(dealer.manualCards.map(c=>c.id),[protectedCard.card.cardId]);
 record('publication obligation refuses whole ALL atomically, and dealer candidates exclude previously discarded manual cards');
 await writeFile(join(output,'result.json'),JSON.stringify({status:'PASS',checks,modelCalls:0,productionWrites:0},null,2));
 console.log(JSON.stringify({status:'PASS',checks:checks.length,output}));
}finally{await connection.close();await fixture.stop();await writeFile(join(output,'cleanup.json'),JSON.stringify({ownedFixtureStopped:true}));}
