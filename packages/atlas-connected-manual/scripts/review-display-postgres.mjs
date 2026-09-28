// Called only with the owned synthetic fixture, never an ambient database URL.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createMachineStaffBoundary,machineGrantSQL} from '@atlas/manual-service/machine-auth';
import {createIntakeRepository,intakeGrantSQL} from '@atlas/manual-intake/repository';
import {createManualIntake} from '@atlas/manual-intake';
import {createPhotoProcessor} from '@atlas/manual-intake/photo-processing';
import {connectedGrantSQL} from '../src/details.mjs';
import {recordEarlyGeometryIntent} from '../src/early-geometry-store.mjs';
import {createReviewDisplayStore,reviewDisplayGrantSQL} from '../src/review-display-store.mjs';
import {memoryPhotoStorage,sha} from '../../atlas-manual-intake/test/helpers.mjs';
import {createManualRepository} from '@atlas/manual-service/repository';
import {createManualService} from '@atlas/manual-service';
import {createPublicationRepository,publicationGrantSQL} from '../src/publication-repository.mjs';
import {createManualPublication} from '../src/publication.mjs';
import {publicationFixture} from '../test/publication-fixture.mjs';
import {rgb16Png} from '../../atlas-photo-runtime/test/helpers.mjs';

export async function runReviewDisplayPostgres({fixture,output}){
 assert(fixture?.cluster?.directory&&fixture.database.name.startsWith('atlas_'));
 for(const grant of [intakeGrantSQL,connectedGrantSQL,machineGrantSQL,reviewDisplayGrantSQL,publicationGrantSQL])
  await fixture.cluster.sql(grant('atlas_fixture_manual'),[],fixture.database.name);
 const connection=fixture.connect(),{boundary,manualClient,auth}=connection;const checks=[];
 try{
  const boot=await auth.bootstrap(''),browser=`${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge=await auth.send(browser,boot.csrf,{phone:'+12025550141',requestId:randomUUID()},'display-fixture');
  const verified=await auth.verify(browser,boot.csrf,{challengeId:challenge.challengeId,code:'424242'},'display-fixture');
  const staff=await auth.authenticate(`${browser}; ${fixture.config.cookies.session}=${verified.token}`,verified.csrf);
  const machine=createMachineStaffBoundary({boundary,auth,manualClient});
  const {storage}=memoryPhotoStorage(),repository=createIntakeRepository({boundary:machine,keyPrefix:'intake',maxOriginalBytes:1000000,sourceCommitted:recordEarlyGeometryIntent});
  const intake=createManualIntake({repository,storage,artifacts:fixture.artifacts,processPhoto:createPhotoProcessor({storage,keyPrefix:'intake',decodeLimits:{maxInputBytes:1000000,maxPixels:1000000,maxRasterBytes:8000000,maxOutputBytes:1000000,timeoutMs:10000}})});
  const cardId=(await intake.create(staff,{requestId:randomUUID(),label:'Durable display fixture'})).card.cardId;
  const sources={};
  for(const side of ['FRONT','BACK']){
   const bytes=rgb16Png(12,16),planned=await intake.plan(staff,cardId,{requestId:randomUUID(),side,expectedVersion:0,sha256:sha(bytes),byteCount:bytes.length});
   await storage.writeOriginal({uploadPlan:planned.upload.plan,bytes});await intake.complete(staff,cardId,planned.upload.uploadId);await intake.prepare(staff,cardId,planned.upload.uploadId);
   sources[side]=await intake.readSource(staff,cardId,planned.upload.uploadId);
  }
  assert.equal(sources.FRONT.photo.original.content.sha256,sources.BACK.photo.original.content.sha256);
  assert.notEqual(sources.FRONT.upload.source.ref.sha256,sources.BACK.upload.source.ref.sha256);
  const store=createReviewDisplayStore({boundary:machine,client:manualClient,intakeRepository:repository});
  assert.equal(await store.discover(8),4);assert.equal(await store.discover(8),0);
  checks.push('post-commit discovery stages four source-bound jobs once without browser reads');
  const claims=(await Promise.all([store.claim(2),store.claim(2),store.claim(2)])).filter(Boolean);
  assert(claims.length>=1&&claims.length<=2);if(claims.length===1)claims.push(await store.claim(2));assert.equal(claims.filter(Boolean).length,2);assert.equal(await store.claim(2),null);
  assert(claims.filter(Boolean).every(j=>j.variant==='context'));
  let [a,b]=claims.filter(Boolean);assert(await store.renew(a));
  assert.equal(await store.finish({...a,claim_id:randomUUID()},{result:{fixture:true},sourceImageSha256:'a'.repeat(64)}),false);
  const expired=a;await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.review_display SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",a.id);
  assert.equal(await store.finish(a,{code:'DISPLAY_LEASE_LOST'}),false);assert.equal((await store.read(a.photoSource,a.variant)).state,'RUNNING');
  a=await store.claim(2);assert.equal(a.id,expired.id);assert.notEqual(a.claim_id,expired.claim_id);
  assert.equal(await store.finish(a,{result:{fixture:true},sourceImageSha256:'a'.repeat(64)}),true);
  await assert.rejects(manualClient.$executeRawUnsafe(`UPDATE atlas_manual_connected.review_display SET state='QUEUED',result=NULL,result_hash=NULL,source_image_hash=NULL WHERE photo_hash=$1 AND variant=$2`,a.photo_hash,a.variant),/immutable/);
  const cold=createReviewDisplayStore({boundary:machine,client:manualClient,intakeRepository:repository});assert.equal((await cold.read(a.photoSource,a.variant)).state,'READY');
  checks.push('global claim limit, context-first scheduling, renewable claim, lost-claim rejection and immutable ready evidence survive new store instance');
  // Replace the side while its worker holds a claim. The late outcome must not
  // become selected evidence, and its abandoned capacity is released.
  const old=sources[b.side],replacement=rgb16Png(14,18);
  await intake.plan(staff,cardId,{requestId:randomUUID(),side:b.side,expectedVersion:1,sha256:sha(replacement),byteCount:replacement.length});
  assert.equal(await store.renew(b),false);
  assert.equal(await store.finish(b,{result:{fixture:'late'},sourceImageSha256:'b'.repeat(64)}),false);
  assert.equal((await cold.read(b.photoSource,b.variant)).state,'SUPERSEDED');
  checks.push('replacement fences renewal/adoption and clears obsolete active capacity without touching original bytes');
  const next=await store.claim(2);assert(next&&next.upload_id!==old.upload.uploadId);
  await store.finish(next,{code:'PHOTO_STORAGE_TIMEOUT',retry:true});
  const pending=await cold.read(next.photoSource,next.variant);assert.equal(pending.state,'QUEUED');assert.equal(pending.code,'PHOTO_STORAGE_TIMEOUT');
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.review_display SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",next.id);
  let failed=await store.claim(2);assert.equal(failed.id,next.id);await store.finish(failed,{code:'PHOTO_DECODE_INVALID'});
  for(let attempt=0;attempt<3;attempt++){
    const input={side:failed.side,photoSourceHash:failed.photo_hash,jobId:failed.id,actionId:randomUUID()};
    await assert.rejects(store.retry(staff,cardId,{...input,photoSourceHash:'f'.repeat(64)}),{code:'DISPLAY_SOURCE_CHANGED'});
    const retry=await store.retry(staff,cardId,input);assert.deepEqual(await store.retry(staff,cardId,input),retry);
    await assert.rejects(store.retry(staff,cardId,{...input,actionId:randomUUID()}),{code:'DISPLAY_RETRY_CONFLICT'});
    failed=await store.claim(2);assert.equal(failed.id,retry.jobId);assert.equal(failed.recovery,attempt+1);
    await store.finish(failed,{code:'PHOTO_DECODE_INVALID'});
  }
  await assert.rejects(store.retry(staff,cardId,{side:failed.side,photoSourceHash:failed.photo_hash,jobId:failed.id,actionId:randomUUID()}),{code:'DISPLAY_RETRY_NOT_ALLOWED'});
  checks.push('failed display recovery is source-fenced, idempotent across lost replies, append-only and capped at three explicit retries');
  // Same original bytes, different owner and card. Discard the earlier source
  // after discovery; it must not poison the later upload or consume a claim.
  const boot2=await auth.bootstrap(''),browser2=`${fixture.config.cookies.browser}=${boot2.browserToken}`;
  const challenge2=await auth.send(browser2,boot2.csrf,{phone:'+12025550143',requestId:randomUUID()},'display-fixture-other');
  const verified2=await auth.verify(browser2,boot2.csrf,{challengeId:challenge2.challengeId,code:'424242'},'display-fixture-other');
  const other=await auth.authenticate(`${browser2}; ${fixture.config.cookies.session}=${verified2.token}`,verified2.csrf);
  const otherPrincipal=await boundary.transaction(other,async({principal})=>principal);
  async function duplicate(actor=other){const id=(await intake.create(actor,{requestId:randomUUID(),label:'Identical-byte fixture'})).card.cardId;
    const bytes=rgb16Png(12,16),p=await intake.plan(actor,id,{requestId:randomUUID(),side:'FRONT',expectedVersion:0,sha256:sha(bytes),byteCount:bytes.length});
    await storage.writeOriginal({uploadPlan:p.upload.plan,bytes});await intake.complete(actor,id,p.upload.uploadId);await intake.prepare(actor,id,p.upload.uploadId);
    return {id,...await intake.readSource(actor,id,p.upload.uploadId)};}
  const first=await duplicate();assert.equal(await store.discover(8),2);
  const firstClaim=await store.claim(2);assert.equal(firstClaim.card_id,first.id);
  const discardId=randomUUID();
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash)
    VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`,otherPrincipal.id,discardId,sha('{}'));
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id)
    SELECT owner_id,create_request_id,id,$2::uuid FROM atlas_manual_intake.card WHERE id=$1::uuid`,first.id,discardId);
  const second=await duplicate();assert.equal(first.photo.original.content.sha256,second.photo.original.content.sha256);
  assert.notEqual(first.upload.source.ref.sha256,second.upload.source.ref.sha256);assert.notEqual(first.upload.source.ref.sha256,sources.FRONT.upload.source.ref.sha256);
  assert.equal(await store.renew(firstClaim),false);assert.equal(await store.finish(firstClaim,{code:'DISPLAY_SOURCE_CHANGED'}),false);
  assert.equal(await store.discover(8),2);const secondClaim=await store.claim(2);assert.equal(secondClaim.card_id,second.id);
  checks.push('identical original bytes across sides/cards/owners use distinct source artifact identities; discarded first queued/running source cannot poison re-upload');
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET "accessVersion"="accessVersion"+1 WHERE id=$1::uuid',otherPrincipal.id);
  assert.equal(await store.renew(secondClaim),false);assert.equal(await store.finish(secondClaim,{code:'DISPLAY_SOURCE_CHANGED'}),false);
  assert.equal(await store.discover(8),2);const renewed=await store.claim(2);
  assert.equal(renewed.card_id,second.id);assert.equal(renewed.access_version,otherPrincipal.accessVersion+1);assert.notEqual(renewed.id,secondClaim.id);
  await store.finish(renewed,{code:'PHOTO_DECODE_INVALID'});
  checks.push('renewed current reviewer authority creates a separate generation; old access cannot renew or adopt pending work');
  for(let i=0;i<4;i++){const j=await store.claim(2);if(!j)break;await store.finish(j,{code:'DISPLAY_FIXTURE_FINISHED'});}
  // A published artifact remains a separate authority after its source is no
  // longer selected by intake. Creating this synthetic approval uses the real
  // repository transaction; it never touches a real card or grading provider.
  const pub=await publicationFixture(),publicationRepository=createPublicationRepository({boundary});
  const manual=createManualRepository({boundary,approvalCommitted:publicationRepository.approvalCommitted});
  await manual.provision(staff,{cardId:pub.cardId,draft:pub.draft});
  const service=createManualService({repository:manual,reduce:({card})=>card.draft,buildReport:async()=>pub.approval});
  await service.execute(staff,pub.cardId,{actionId:pub.actionId,expectedRevision:1,action:{type:'APPROVE_REPORT',reportHash:pub.row.report_hash,reviewed:true}});
  const publication=createManualPublication({repository:publicationRepository,artifacts:pub.artifacts,storage:pub.storage,readSource:async(_staff,_id,upload)=>({photo:pub.photos[upload.side]})});
  await publication.publish(staff,pub.cardId,pub.actionId);
  const [publishedBefore]=await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.publication WHERE card_id=$1::uuid',pub.cardId);
  assert.equal(await store.discover(8),2);assert.equal(await store.discover(8),0);
  const laterIntake=await duplicate(staff);assert.equal(await store.discover(8),2);
  const publicationClaims=(await Promise.all([store.claim(2),store.claim(2),store.claim(2)])).filter(Boolean);
  assert(publicationClaims.length>=1&&publicationClaims.length<=2);if(publicationClaims.length===1)publicationClaims.push(await store.claim(2));
  assert.equal(publicationClaims.filter(Boolean).length,2);assert.equal(await store.claim(2),null);assert(publicationClaims.filter(Boolean).every(j=>j.publication&&j.card_id===pub.cardId));
  let [pubJob,pubBack]=publicationClaims.filter(Boolean);assert(await store.renew(pubJob));
  await assert.rejects(store.retry(staff,pub.cardId,{side:pubJob.side,photoSourceHash:pubJob.manifest_hash,jobId:pubJob.id,actionId:randomUUID()}));
  await assert.rejects(manualClient.$executeRawUnsafe("UPDATE atlas_manual_connected.published_review_display SET manifest='{}' WHERE id=$1::uuid",pubJob.id),/permission denied|immutable/);
  assert.equal(await store.finish({...pubJob,claim_id:randomUUID()},{result:{fixture:true},sourceImageSha256:'c'.repeat(64)}),false);
  const expiredPublished=pubJob;await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.published_review_display SET attempts=7,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",pubJob.id);
  assert.equal(await store.finish(pubJob,{code:'DISPLAY_LEASE_LOST'}),false);
  const duringBackoff=await store.claim(2);assert.equal(duringBackoff.card_id,laterIntake.id);await store.finish(duringBackoff,{code:'DISPLAY_FIXTURE_FINISHED'});
  const [deferred]=await fixture.admin.$queryRawUnsafe('SELECT state,code,available_at>clock_timestamp() AS delayed FROM atlas_manual_connected.published_review_display WHERE id=$1::uuid',pubJob.id);
  assert.deepEqual(deferred,{state:'QUEUED',code:'DISPLAY_LEASE_EXPIRED',delayed:true});
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.published_review_display SET available_at='2000-01-01T00:00:00Z' WHERE id=$1::uuid",pubJob.id);
  pubJob=await store.claim(2);assert.equal(pubJob.attempts,8);
  assert.equal(pubJob.id,expiredPublished.id);assert.notEqual(pubJob.claim_id,expiredPublished.claim_id);
  assert.equal(await store.finish(pubJob,{result:{fixture:true},sourceImageSha256:'c'.repeat(64)}),true);
  await store.finish(pubBack,{code:'PHOTO_STORAGE_TIMEOUT',retry:true});
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.published_review_display SET available_at=clock_timestamp()+interval '1 hour' WHERE id=$1::uuid",pubBack.id);
  assert.deepEqual((await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.publication WHERE card_id=$1::uuid',pub.cardId))[0],publishedBefore);
  for(let i=0;i<2;i++){const j=await store.claim(2);if(!j)break;assert.equal(j.card_id,laterIntake.id);await store.finish(j,{code:'DISPLAY_FIXTURE_FINISHED'});}
  // Synthetic discard is deliberately elevated in the owned fixture. Normal
  // application discard itself refuses a published-card obligation.
  const tombstone=randomUUID(),createId=randomUUID();
  const principal=await boundary.transaction(staff,async({principal})=>principal);
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'Published source tombstone fixture')`,pub.cardId,randomUUID(),principal.id,createId,sha('fixture'));
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash)
    VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`,principal.id,tombstone,sha('{}'));
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id)
    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`,principal.id,createId,pub.cardId,tombstone);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.published_review_display SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",pubBack.id);
  assert.equal(await store.claim(2),null);
  checks.push('older published authority wins over newer intake; expired attempt7 resumes as attempt8 after capped delay under shared capacity; cannot become an intake retry; immutable report preserved; discard fences historical work');
  // The selected source is older than a later upload, and its full job must
  // be discovered before unrelated contexts. Hints only affect ordering.
  const selectedCard=await duplicate(staff),backgroundCard=await duplicate(staff);
  const priorityPhotoHashes=[selectedCard.upload.source.ref.sha256];
  assert.equal(await store.discover(1,{priorityPhotoHashes}),1);
  assert.equal((await store.read(selectedCard.upload.source,'context')).state,'QUEUED');
  assert.equal(await store.read(backgroundCard.upload.source,'context'),null);
  assert.equal(await store.discover(1,{priorityPhotoHashes}),1);
  assert.equal((await store.read(selectedCard.upload.source,'full')).state,'QUEUED');
  assert.equal(await store.discover(8),2);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.review_display SET available_at=clock_timestamp()-interval '20 seconds' WHERE card_id=$1::uuid",backgroundCard.id);
  const selectedContext=await store.claim(2,{priorityPhotoHashes,lane:'selected'});
  assert.equal(selectedContext.card_id,selectedCard.id);assert.equal(selectedContext.variant,'context');await store.finish(selectedContext,{code:'DISPLAY_FIXTURE_FINISHED'});
  const selectedFull=await store.claim(2,{priorityPhotoHashes,lane:'selected'});
  assert.equal(selectedFull.card_id,selectedCard.id);assert.equal(selectedFull.variant,'full');
  const responsiveContext=await store.claim(2,{priorityPhotoHashes,lane:'context'});
  assert.equal(responsiveContext.card_id,backgroundCard.id);assert.equal(responsiveContext.variant,'context');
  assert.equal(await store.claim(2,{priorityPhotoHashes,lane:'selected'}),null);
  await store.finish(selectedFull,{code:'PHOTO_STORAGE_TIMEOUT',retry:true});await store.finish(responsiveContext,{code:'DISPLAY_FIXTURE_FINISHED'});
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.review_display SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1::uuid",selectedFull.id);
  const oldest=await store.claim(2,{priorityPhotoHashes,lane:'oldest'});assert.equal(oldest.card_id,backgroundCard.id);assert.equal(oldest.variant,'full');await store.finish(oldest,{code:'DISPLAY_FIXTURE_FINISHED'});
  const recoveredSelected=await store.claim(2,{priorityPhotoHashes,lane:'selected'});assert.equal(recoveredSelected.id,selectedFull.id);await store.finish(recoveredSelected,{code:'DISPLAY_FIXTURE_FINISHED'});
  checks.push('ephemeral selected-source hints prioritize discovery and full encoding ahead of unrelated backlog; context and oldest turns retain responsiveness/fairness under the same global capacity and authority fences');
  const [grants]=await fixture.admin.$queryRawUnsafe(`SELECT has_table_privilege('atlas_fixture_manual','atlas_staff."StaffIdentity"','SELECT') staff_read,
    has_table_privilege('atlas_fixture_manual','atlas_manual_connected.review_display','DELETE') delete_job`);
  assert.equal(grants.staff_read,false);assert.equal(grants.delete_job,false);
  checks.push('transient retry is durable; new grants do not expose StaffIdentity or permit deletion');
  const receipt={status:'REVIEW_DISPLAY_POSTGRES_PASS',productionEffects:false,checks};
  await writeFile(join(output,'review-display-postgres.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});return receipt;
 }finally{await connection.close();}
}
