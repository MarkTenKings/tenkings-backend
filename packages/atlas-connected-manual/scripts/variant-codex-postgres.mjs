import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PrismaClient} from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import {createMachineStaffBoundary} from '@atlas/manual-service/machine-auth';
import {createVariantJobStore} from '../src/variant-job-store.mjs';
import {variantWorkerRoleSQL,variantWorkerGrantSQL} from '../src/variant-worker-grants.mjs';
import {prepareVariantListingRequest} from '../src/variant-listing-provider.mjs';
import {createVariantPhotoProvider,prepareVariantLabelRequest} from '../src/variant-photo-provider.mjs';
import {createVariantCatalogService} from '../src/variant-catalog.mjs';
import {createVariantWorker} from '../src/variant-worker.mjs';
import {codexLibraryKey,variantCodexChoice,codexReadingKey} from '../src/variant-codex.mjs';
import {labelCatalog,labelPhoto,labelResponse} from '../test/variant-label-fixture.mjs';

/** Actual restricted PostgreSQL transactions in the caller's owned disposable cluster only. */
export async function validateCodexJournal({fixture,connection,store,staff,seed,review}) {
 const role='atlas_fixture_codex_second',password=randomBytes(24).toString('hex');
 await fixture.cluster.sql(variantWorkerRoleSQL(role),[],fixture.database.name);
 await fixture.cluster.sql(`ALTER ROLE "${role}" LOGIN PASSWORD '${password}'`,[],fixture.database.name);
 await fixture.cluster.sql(variantWorkerGrantSQL(role),[],fixture.database.name);
 const url=new URL(fixture.database.adminUrl);url.username=role;url.password=password;url.searchParams.set('connection_limit','1');
 const client=new PrismaClient({datasources:{db:{url:url.href}},errorFormat:'minimal'});
 try {
  const second=createVariantJobStore({boundary:createMachineStaffBoundary({boundary:connection.boundary,auth:connection.auth,manualClient:client})});
  const catalog=labelCatalog({count:5}),cards=[await seed(),await seed()];await store.discover();const jobs=[await store.claim(2),await second.claim(2)];
  assert.deepEqual(new Set(jobs.map(j=>j.card_id)),new Set(cards));for(const job of jobs)assert(await store.saveCatalog(job,catalog));
  let calls=0;const provider=createVariantPhotoProvider({apiKey:'synthetic-secret-not-a-key',readReferenceImage:async r=>labelPhoto(catalog.referencePhotos.findIndex(p=>p.imageId===r.imageId)).media,
   fetchImpl:async(_url,options)=>{calls++;const body=JSON.parse(options.body),choices=JSON.parse(body.input[1].content[0].text).choices;
    const hashes=body.text.format.schema.properties.readings.items.properties.sha256.enum;
    const readings=hashes.map(sha256=>{const index=catalog.referencePhotos.findIndex(p=>p.sha256===sha256),candidate=catalog.candidates[Math.floor(index/2)];return {sha256,candidateKey:variantCodexChoice(candidate).key,gradingCompany:'PSA',labelText:`Exact fixture label ${candidate.label}`,reason:'Synthetic exact label association.'};});
    return Response.json(labelResponse({photos:hashes.map(sha256=>({sha256})),choices},readings));}});
  const selections=[catalog.referencePhotos.slice(0,8),catalog.referencePhotos.slice(2,10)].map(photos=>photos.map(p=>p.sha256));
  const requests=selections.map(shas=>prepareVariantLabelRequest(catalog,shas)),prepared=await Promise.all(selections.map(photoShas=>provider.prepare({catalog,photoShas})));
  const stores=[store,second],attempts=await Promise.allSettled(stores.map((value,index)=>value.labelSource(jobs[index],requests[index],prepared[index].evidence)));
  // Remote fixture latency can exhaust the serving boundary's 1.5s lock
  // wait. That contender has no reservation or paid capability. Observe its
  // next worker turn after the winning transaction commits; never retry HTTP.
  const reservations=[];for(let index=0;index<attempts.length;index++){const attempt=attempts[index];
   if(attempt.status==='fulfilled')reservations.push(attempt.value);else{assert.equal(attempt.reason.meta?.code,'55P03');reservations.push(await stores[index].labelSource(jobs[index],requests[index],prepared[index].evidence));}}
  assert.deepEqual(reservations.map(r=>r.state).sort(),['PENDING','RESERVED']);const winner=reservations.findIndex(r=>r.state==='RESERVED');
  const response=await provider({prepared:prepared[winner]});assert(await store.saveLabelSource(reservations[winner].reservation,response));
  assert(await second.saveLabelSource(reservations[winner].reservation,response));await assert.rejects(store.saveLabelSource(reservations[winner].reservation,{...response,bodyText:'{}'}),{code:'VARIANT_LABEL_RESPONSE_CONFLICT'});
  await store.publishLabelSource(jobs[winner],requests[winner]);assert.equal((await second.codexReadings(jobs[1])).readings.length,8);
  const known=await store.codexReadings(jobs[0]),remaining=catalog.referencePhotos.filter(p=>!known.readings.some(r=>r.sha256===p.sha256)).map(p=>p.sha256);
  const request=prepareVariantLabelRequest(catalog,remaining),last=await provider.prepare({catalog,photoShas:remaining}),reservation=await store.labelSource(jobs[0],request,last.evidence);
  assert.equal(reservation.state,'RESERVED');assert(await store.saveLabelSource(reservation.reservation,await provider({prepared:last})));await store.publishLabelSource(jobs[0],request);
  assert.equal(calls,2);for(const job of jobs){const referenceLabels=await store.codexReadings(job);assert.equal(referenceLabels.readings.length,10);assert(await store.finish(job,{result:{catalog,referenceLabels,suggestion:{candidateId:null,confidence:null,reason:'Human chooses the physical printing.',evidence:[]}}}));}
  const firstResult=await review.status(staff,cards[0]);assert.equal(firstResult.result.referenceLabels.readings.length,10);
  for(const candidate of catalog.candidates){const choice=variantCodexChoice(candidate),saved=await store.cache.getRetained(codexLibraryKey(choice));assert.equal(saved.references.length,2);assert.equal(await store.cache.get(codexLibraryKey(choice)),null);}
  const [unchanged]=await fixture.admin.$queryRawUnsafe('SELECT count(*)::int n FROM atlas_manual_connected.variant_job WHERE key=ANY($1::text[]) AND dispatch_id IS NULL AND response IS NULL',jobs.map(j=>j.key));assert.equal(unchanged.n,2);
  await assert.rejects(store.cache.put(codexReadingKey(request,remaining[0]),{expiresAt:'2099-01-01T00:00:00.000Z'}),{code:'VARIANT_LISTING_JOURNAL_RESERVED'});
  // A later physical card, fresh metadata bytes and restarted service all use the permanent library.
  const later=await seed(),updated=labelCatalog({count:5,source:'new official source',capturedAt:'2026-10-11T00:00:00.000Z'});
  const forbid=()=>assert.fail('A saved card type must not acquire/search/read/model again');
  const service=createVariantCatalogService({cache:store.cache,providers:[{prepare:async()=>({candidates:updated.candidates,problems:[],truncated:false})}],listingProvider:{fetchSource:forbid,acquireImages:forbid},now:()=>Date.parse(updated.capturedAt)});
  const restarted=createVariantPhotoProvider({apiKey:'synthetic-secret-not-a-key',readReferenceImage:forbid,fetchImpl:forbid});
  const worker=createVariantWorker({store,catalog:service,provider:restarted});await worker.drainOnce();
  const after=await review.status(staff,later);assert.equal(after.state,'READY');assert.equal(after.result.referenceLabels.readings.length,10);assert.equal(calls,2);
  assert(after.result.referenceLabels.readings.every(r=>after.result.catalog.candidates.some(c=>c.candidateId===r.candidateId)));assert.deepEqual(await review.status(staff,cards[0]),firstResult);
  // Only an explicit saved refresh generation can authorize a fresh missing-reference source key.
  const refreshId=randomUUID(),refresh=await review.refresh(staff,later,{requestId:refreshId,sourceHash:after.sourceHash,identityRevision:after.identityRevision,identityHash:after.identityHash,jobId:after.jobId});
  const refreshJob=await store.claim(1);assert.equal(refreshJob.key,refresh.jobId);
  const printing={name:'Missing fixture printing',language:null},refreshRequest=prepareVariantListingRequest(refreshJob.input.identity,printing,{graded:true,generation:refreshId});
  const forged=randomUUID();await assert.rejects(store.reserveListingSource({...refreshJob,input:{...refreshJob.input,generation:forged}},prepareVariantListingRequest(refreshJob.input.identity,printing,{graded:true,generation:forged})),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
  const refreshReservation=await store.reserveListingSource(refreshJob,refreshRequest);assert.equal(refreshReservation.state,'RESERVED');
  const bodyText=JSON.stringify({keyword:refreshRequest.query,page:1,totalItems:0,hasNextPage:false,items:[]});
  const source={schemaVersion:'variant-listing-response/v1',requestKey:refreshRequest.requestKey,url:refreshRequest.url,httpStatus:200,contentType:'application/json',bodyText,sha256:(await import('node:crypto')).createHash('sha256').update(bodyText).digest('hex'),capturedAt:'2026-10-11T00:00:00.000Z'};
  assert(await store.saveListingSource(refreshReservation.reservation,source));assert.equal((await store.reserveListingSource(refreshJob,refreshRequest)).state,'REUSED');
  assert(await store.saveCatalog(refreshJob,after.result.catalog));assert(await store.finish(refreshJob,{result:after.result}));
  // Saved response without publication recovers using its original public catalog,
  // even when a later job has a changed roster and overlapping batch grouping.
  const interruptedCard=await seed();await store.discover();const interrupted=await store.claim(1),originalCatalog=labelCatalog({count:6});assert(await store.saveCatalog(interrupted,originalCatalog));
  const interruptedShas=originalCatalog.referencePhotos.slice(10).map(p=>p.sha256),interruptedRequest=prepareVariantLabelRequest(originalCatalog,interruptedShas);
  const originalEvidence={policy:interruptedRequest.policy,model:interruptedRequest.model,request:interruptedRequest,requestSha256:'a'.repeat(64)};
  const originalReservation=await store.labelSource(interrupted,interruptedRequest,originalEvidence);assert.equal(originalReservation.state,'RESERVED');
  const raw={version:interruptedRequest.policy,requestEvidence:originalEvidence,httpStatus:200,requestId:null,bodyText:JSON.stringify(labelResponse(interruptedRequest))};
  assert(await store.saveLabelSource(originalReservation.reservation,raw));assert(await store.finish(interrupted,{state:'FAILED',code:'SYNTHETIC_CRASH_AFTER_RESPONSE'}));
  const recoveryCard=await seed();await store.discover();const recovery=await store.claim(1),newRoster=labelCatalog({count:7,source:'new roster'});assert(await store.saveCatalog(recovery,newRoster));
  const recover=await store.labelSource(recovery,prepareVariantLabelRequest(newRoster,newRoster.referencePhotos.slice(11,13).map(p=>p.sha256)));
  assert.equal(recover.state,'RECOVER');assert.deepEqual(recover.request,interruptedRequest);await store.publishLabelSource(recovery,recover.request);
  const recoveredLabels=await store.codexReadings(recovery);assert.equal(recoveredLabels.readings.length,12);assert.equal(calls,2);
  assert(await store.finish(recovery,{result:{catalog:newRoster,referenceLabels:recoveredLabels,suggestion:{candidateId:null,confidence:null,reason:'Recovered public evidence.',evidence:[]}}}));
  // Unknown dispatch remains reserved across lease expiry and a different batch grouping.
  const unknownCard=await seed();await store.discover();const unknown=await store.claim(1),newCatalog=labelCatalog({count:8,photos:16});assert(await store.saveCatalog(unknown,newCatalog));
  const shas=newCatalog.referencePhotos.slice(14).map(p=>p.sha256),unresolved=prepareVariantLabelRequest(newCatalog,shas),evidence={policy:unresolved.policy,model:unresolved.model,request:unresolved,requestSha256:'f'.repeat(64)};
  assert.equal((await store.labelSource(unknown,unresolved,evidence)).state,'RESERVED');await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.variant_job SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",unknown.key);
  const recovered=await store.claim(1);assert.equal(recovered.card_id,unknownCard);assert.equal((await store.labelSource(recovered,prepareVariantLabelRequest(newCatalog,[shas[0]]))).state,'UNKNOWN');
  assert(await store.finish(recovered,{state:'UNKNOWN',code:'VARIANT_PROVIDER_OUTCOME_UNKNOWN'}));
  return ['ATLAS Codex: two independent restricted cap-one clients serialize overlapping label batches per exact image; 10 photos across5printings use2bounded fixture model calls, no physical uploads',
   'ATLAS Codex: immutable raw responses, per-image readings and canonical printing libraries persist; duplicate saves idempotent, conflicting save/generic overwrite refused; legacy job dispatch columns unchanged',
   'ATLAS Codex: a different physical submission plus updated source/capture evidence reuses all5printing/10photo associations after service restart with ZERO listing, image or model calls and unchanged earlier result',
   'ATLAS Codex: only the current explicit saved refresh generation authorizes a fresh missing-reference search; forged generation refused and exact generation replay reuses its source',
   'ATLAS Codex: paid response saved before an interrupted projection recovers offline under a changed catalog roster and overlapping batch; earlier job may already be terminal',
   'ATLAS Codex: expired uncertain dispatch remains globally fenced even under a different batch grouping; no automatic redispatch'];
 } finally {await client.$disconnect();}
}
