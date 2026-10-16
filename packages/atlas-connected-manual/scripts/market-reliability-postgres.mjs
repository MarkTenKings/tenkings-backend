// Called only by the owned disposable market qualification harness.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '@atlas/manual-service/contract';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createManualService } from '@atlas/manual-service';
import { EBAY_SOLD_COMPS_V2_ENGINE_VERSION } from '@tenkings/ebay-sold-comps-v2';
import { createMarketJobStore } from '../src/market-job-store.mjs';
import { createMarketWorker } from '../src/market-worker.mjs';
import { createMarketSlabLabeler } from '../src/market-slab-labels.mjs';
import { createPublicationRepository } from '../src/publication-repository.mjs';
import { publishedMarketQuery } from '../src/presentation-market.mjs';
import { labelPhoto } from '../test/variant-label-fixture.mjs';

export async function qualifyMarketReliability({fixture, machine, store, staff, principal, approve, approved, publication, artifacts, checks}) {
  const due = requestId => fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET available_at=clock_timestamp()-interval '1 second' WHERE request_id=$1::uuid",requestId);
  const raw = async requestId => (await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.market_job WHERE request_id=$1::uuid',requestId))[0];
  const response = query => ({source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query,retrievedAt:new Date().toISOString(),
    responsePolicy:'ATLAS_SLAB_V1',items:[],acquisitionDiagnostics:{returnedItemCount:0,retainedItemCount:0,missingImageCount:0}});
  async function savedJob() {
    const card=await approve({publish:true}),job=await store.claim(2);assert.equal(job.card_id,card.cardId);
    const source=await approved.loadPacket(staff,card.cardId,card.actionId);
    assert(await store.bind(job,source));assert(await store.dispatch(job));
    assert(await store.recordResponse(job,response(publishedMarketQuery(source).query)));
    return {card,job,source};
  }
  async function discard(card) {
    const requestId=randomUUID();
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash)
      VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`,principal.id,requestId,digest('{}'));
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`,principal.id,card.createId,card.cardId,requestId);
  }

  // Actual worker + labeler + store + PostgreSQL locks. Only remote transports
  // are synthetic. Both physical cards keep separate approval/result bindings.
  await fixture.cluster.sql(`GRANT SELECT ON atlas_manual_connected.variant_job,atlas_manual_connected.variant_confirmation,atlas_manual_connected.variant_catalog_cache TO atlas_fixture_manual;
    GRANT INSERT ON atlas_manual_connected.variant_catalog_cache TO atlas_fixture_manual;`,[],fixture.database.name);
  let release,entered,queries=0,models=0;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  const labelMarket=createMarketSlabLabeler({boundary:machine,apiKey:'synthetic-market-qualification',inspectImage:async()=>({mimeType:'image/png',width:1,height:1}),fetchImpl:async(url,options)=>{
    if(url.startsWith('https://i.ebayimg.com/'))return new Response(labelPhoto(20).media.bytes,{headers:{'content-type':'image/png'}});
    assert.equal(url,'https://api.openai.com/v1/responses');models++;entered();await gate;
    const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-astra');assert.equal(body.reasoning.effort,'xhigh');
    const shas=body.text.format.schema.properties.readings.items.properties.sha256.enum;
    return Response.json({model:'gpt-6-astra',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({readings:shas.map(sha256=>({sha256,gradingCompany:'PSA',numericGrade:9,labelText:'VISIBLE SYNTHETIC LABEL 9',identityMatch:'UNCERTAIN',evidenceKind:'SLABBED',reason:'Synthetic retained evidence.'}))})}]}]});
  }});
  const provider=async input=>{queries++;return {...response(input.queryOverride),items:[{id:'atlas-sale:0',sourceIndex:0,title:'Synthetic sale',listingUrl:null,providerItemId:null,imageUrl:'https://i.ebayimg.com/images/g/repeated-market-fixture/s-l1600.jpg',soldDate:null,reportedPrice:null,soldPriceCents:null,currency:null,priceBasis:'UNKNOWN'}],acquisitionDiagnostics:{returnedItemCount:1,retainedItemCount:1,missingImageCount:0}};};
  const makeWorker=()=>createMarketWorker({store,approved,publication,artifacts,provider,labelMarket,authorityFor:job=>machine.machineOwner({ownerId:job.actor_id,accessVersion:job.access_version}),concurrency:2});
  const leader=makeWorker(),follower=makeWorker(),first=await approve({publish:true});
  const ownerWork=leader.drainOnce();
  await Promise.race([started,ownerWork.then(()=>assert.fail('Owner finished without dispatching the fixture label request'))]);
  const second=await approve({publish:true});
  const approvals=await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=ANY($1::uuid[]) ORDER BY card_id',[first.cardId,second.cardId]);
  let retained;
  for(let index=0;index<12;index++){
    await due(second.actionId);await follower.drainOnce();const row=await raw(second.actionId);
    assert.equal(row.state,'QUEUED');assert.equal(row.code,'MARKET_LABEL_PENDING');assert.equal(row.attempts,1);
    assert.equal(row.audit.filter(event=>event.event==='WAIT').length,index+1);
    retained??={response:row.response,response_hash:row.response_hash,dispatch_id:row.dispatch_id};
    for(const [key,value] of Object.entries(retained))assert.equal(row[key],value);
    assert.equal(queries,2);assert.equal(models,1);
  }
  release();await ownerWork;assert.equal((await raw(first.actionId)).state,'READY');
  await due(second.actionId);await follower.drainOnce();const completed=await raw(second.actionId);
  assert.equal(completed.state,'READY');assert.equal(completed.attempts,1);assert.equal(queries,2);assert.equal(models,1);
  for(const [key,value] of Object.entries(retained))assert.equal(completed[key],value);
  assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=ANY($1::uuid[]) ORDER BY card_id',[first.cardId,second.cardId]),approvals);
  await Promise.all([leader.stop(),follower.stop()]);
  checks.push('real PostgreSQL worker/labeler integration: two independent cards, twelve shared waits at one logical attempt, late owner completion, READY for both with one sold search per card and one shared Astra request, exact sold/approval bytes retained');

  for(const ownerEnd of ['EXPIRED','DELETED']) {
    let settle,dispatchStarted;const awaiting=new Promise(resolve=>settle=resolve),dispatched=new Promise(resolve=>dispatchStarted=resolve);
    let modelCalls=0;
    const photoIndex=ownerEnd==='EXPIRED'?21:22;
    const fetchImpl=async(url,options)=>{
      if(url.startsWith('https://i.ebayimg.com/')){const index=Number(/abandoned-market-(\d+)/.exec(url)[1]);return new Response(labelPhoto(index).media.bytes,{headers:{'content-type':'image/png'}});}
      modelCalls++;if(modelCalls===1){dispatchStarted();await awaiting;if(ownerEnd==='EXPIRED')throw Error('Synthetic unknown transport outcome');}
      const shas=JSON.parse(options.body).text.format.schema.properties.readings.items.properties.sha256.enum;
      return Response.json({model:'gpt-6-astra',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({readings:shas.map(sha256=>({sha256,gradingCompany:'PSA',numericGrade:9,labelText:'SAVED PUBLIC LABEL 9',identityMatch:'UNCERTAIN',evidenceKind:'SLABBED',reason:'Synthetic retained public evidence.'}))})}]}]});
    };
    const makeLabeler=()=>createMarketSlabLabeler({boundary:machine,apiKey:'synthetic-abandoned-market',inspectImage:async()=>({mimeType:'image/png',width:1,height:1}),fetchImpl});
    const abandonedLabeler=makeLabeler(),otherProcessLabeler=makeLabeler(),owner=await savedJob();
    const approvalBefore=await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=$1::uuid',owner.card.cardId);
    const pool={...response(publishedMarketQuery(owner.source).query),items:[{id:'atlas-sale:0',imageUrl:`https://i.ebayimg.com/images/g/abandoned-market-${photoIndex}/s-l1600.jpg`}]};
    const inFlight=abandonedLabeler({source:owner.source,response:pool,job:owner.job});await dispatched;
    if(ownerEnd==='EXPIRED')await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1::uuid",owner.job.request_id);
    else await discard(owner.card);
    const borrowerPool={...pool,items:[...pool.items,{id:'atlas-sale:1',imageUrl:`https://i.ebayimg.com/images/g/abandoned-market-${photoIndex+50}/s-l1600.jpg`}]};
    const borrowerInput={source:owner.source,response:borrowerPool,job:{...owner.job,request_id:randomUUID(),claim_id:randomUUID()}};
    const borrower=await otherProcessLabeler(borrowerInput);
    assert.equal(borrower.imageMatch.counts.unknown,1);assert.equal(borrower.imageMatch.counts.completed,1);assert.equal(modelCalls,2,'Only the independent clean sibling may dispatch');
    settle();await inFlight;
    const future=await otherProcessLabeler({...borrowerInput,job:{...borrowerInput.job,request_id:randomUUID(),claim_id:randomUUID()}});
    assert.equal(future.imageMatch.counts.unknown,ownerEnd==='EXPIRED'?1:0);
    assert.equal(future.imageMatch.counts.completed,ownerEnd==='EXPIRED'?1:2);
    assert.equal(modelCalls,2,'A late successful response can serve future copies without replacing history or resending');
    assert.deepEqual(await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.approval WHERE card_id=$1::uuid',owner.card.cardId),approvalBefore);
    // Settle only the owned synthetic job after exercising the missing-owner path.
    if(ownerEnd==='DELETED')await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1::uuid",owner.job.request_id);
    const maintenance=await store.claim(2);
    if(maintenance){assert.equal(maintenance.request_id,owner.job.request_id);await store.finish(maintenance,{code:'SYNTHETIC_DONE',disposition:'UNAVAILABLE'});}
  }
  checks.push('expired/deleted shared owner yields honest UNKNOWN while a clean sibling completes; no duplicate dispatch; a deleted owner late successful public response is retained for future copies, with approval bytes unchanged');

  const failures=await savedJob();let current=failures.job;
  for(let failure=1;failure<=6;failure++){
    assert.equal(current.attempts,failure);
    for(let wait=0;wait<3;wait++){
      assert(await store.finish(current,{code:'MARKET_LABEL_PENDING',disposition:'WAIT'}));
      assert.equal(await store.finish(current,{code:'MARKET_LABEL_PENDING',disposition:'WAIT'}),false,'A second finish cannot add a wait or steal a later claim');
      await due(current.request_id);const next=await store.claim(2);assert.equal(next.attempts,failure);assert.notEqual(next.claim_id,current.claim_id);
      assert.equal(await store.finish(current,{code:'MARKET_PROCESSING_INTERRUPTED',disposition:'RETRY'}),false);current=next;
    }
    assert(await store.finish(current,{code:'MARKET_PROCESSING_INTERRUPTED',disposition:'RETRY'}));
    const finished=await raw(current.request_id);assert.equal(finished.state,failure===6?'FAILED':'QUEUED');
    if(failure<6){await due(current.request_id);current=await store.claim(2);}
  }
  assert.equal(await store.claim(2),null);
  const expiring=await savedJob();assert(await store.finish(expiring.job,{code:'MARKET_LABEL_PENDING',disposition:'WAIT'}));
  await due(expiring.job.request_id);const waiting=await store.claim(2);assert.equal(waiting.attempts,1);
  await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual_connected.market_job SET lease_until=clock_timestamp()-interval '1 second' WHERE request_id=$1::uuid",waiting.request_id);
  const resumed=await store.claim(2);assert.equal(resumed.attempts,2);assert.equal(resumed.code,'MARKET_LEASE_EXPIRED');
  assert.equal(await store.finish(waiting,{code:'MARKET_LABEL_PENDING',disposition:'WAIT'}),false);
  await store.finish(resumed,{code:'SYNTHETIC_DONE',disposition:'UNAVAILABLE'});
  checks.push('WAIT is claim-fenced and idempotent; five earlier real failures survive repeated waits; attempt-six wait continues then sixth real failure stops; lease expiry consumes its logical attempt normally');

  // Reconstruct historical old-worker finishes through the real immutable-row
  // trigger, without altering the journal or requiring a migration.
  async function legacyPending({mixed=false,missing=false,retired=false,corrupt=false,reapproved=false}={}) {
    const f=await savedJob();let claim=f.job.claim_id;
    for(let attempt=1;attempt<=6;attempt++){
      const state=attempt===6?'FAILED':'QUEUED',code=mixed&&attempt===1?'MARKET_PROCESSING_INTERRUPTED':'MARKET_LABEL_PENDING';
      const event={event:state,code,claimId:claim,at:new Date().toISOString()};
      await fixture.admin.$executeRawUnsafe(`UPDATE atlas_manual_connected.market_job SET state=$2,code=$3,claim_id=NULL,lease_until=NULL,
        audit=audit||$4::jsonb WHERE request_id=$1::uuid`,f.job.request_id,state,code,JSON.stringify(missing&&attempt===2?[]:[event]));
      if(attempt<6){claim=randomUUID();await fixture.admin.$executeRawUnsafe(`UPDATE atlas_manual_connected.market_job SET state='RUNNING',attempts=attempts+1,
        claim_id=$2::uuid,lease_until=clock_timestamp()+interval '3 minutes' WHERE request_id=$1::uuid`,f.job.request_id,claim);}
    }
    if(retired)await discard(f.card);
    if(corrupt)await fixture.admin.$executeRawUnsafe(`UPDATE atlas_manual_connected.market_job SET audit=audit||$2::jsonb WHERE request_id=$1::uuid`,f.job.request_id,JSON.stringify([{event:'RECLASSIFY'}]));
    if(reapproved){
      const publications=createPublicationRepository({boundary:machine});
      const repository=createManualRepository({boundary:machine,approvalCommitted:context=>publications.approvalCommitted(context)});
      const service=createManualService({repository,reduce:({card})=>card.draft,buildReport:async()=>f.card.approval});
      const card=await service.read(staff,f.card.cardId);
      await service.execute(staff,f.card.cardId,{actionId:randomUUID(),expectedRevision:card.revision,action:{type:'APPROVE_REPORT',reportHash:f.card.row.report_hash,reviewed:true}});
    }
    return {...f,before:await raw(f.job.request_id)};
  }
  const excluded=[];
  for(const options of [{mixed:true},{missing:true},{retired:true},{corrupt:true},{reapproved:true}])excluded.push(await legacyPending(options));
  const recoverable=await legacyPending(),another=await approve({publish:true});
  const recoveryReads=[];
  const monitoredBoundary={machineTransaction:(actor,work)=>machine.machineTransaction(actor,context=>work({...context,tx:{
    $executeRawUnsafe:(...args)=>context.tx.$executeRawUnsafe(...args),
    $queryRawUnsafe:async(sql,...args)=>{const rows=await context.tx.$queryRawUnsafe(sql,...args);
      if(sql.includes('CROSS JOIN LATERAL (SELECT'))recoveryReads.push(rows.map(row=>row.request_id));return rows;},
  }}))};
  const monitoredStore=createMarketJobStore({boundary:monitoredBoundary});
  const contenders=await Promise.all(Array.from({length:4},()=>createMarketJobStore({boundary:monitoredBoundary}).claim(2)));
  const claims=contenders.filter(Boolean);assert.equal(new Set(claims.map(row=>row.request_id)).size,claims.length);assert(claims.length<=2);
  while(claims.length<2){const next=await monitoredStore.claim(2);assert(next);claims.push(next);}
  assert.equal(new Set(claims.map(row=>row.request_id)).size,2);assert.equal(await monitoredStore.claim(2),null);
  assert(recoveryReads.every(rows=>rows.length<=1));assert.deepEqual(recoveryReads.flat(),[recoverable.job.request_id]);
  const recovered=claims.find(row=>row.request_id===recoverable.job.request_id);assert(recovered);assert.equal(recovered.recoveries,1);assert.equal(recovered.attempts,1);
  const repaired=await raw(recovered.request_id);assert.equal(repaired.response,recoverable.before.response);assert.equal(repaired.response_hash,recoverable.before.response_hash);assert.equal(repaired.dispatch_id,recoverable.before.dispatch_id);
  assert.deepEqual(repaired.audit.slice(0,-1),recoverable.before.audit);assert.equal(repaired.audit.at(-1).kind,'SHARED_LABEL_WAIT');
  for(const untouched of excluded)assert.deepEqual(await raw(untouched.job.request_id),untouched.before);
  assert(await store.finish(recovered,{code:'MARKET_LABEL_PENDING',disposition:'WAIT'}));
  const otherClaim=claims.find(row=>row.request_id===another.actionId);assert(otherClaim);
  await assert.rejects(store.finish(otherClaim,{code:'MARKET_LABEL_PENDING',disposition:'WAIT'}),{code:'MARKET_RESPONSE_REQUIRED'});
  assert.throws(()=>store.finish(otherClaim,{code:'MARKET_LABEL_PENDING',disposition:'RETRY'}),{code:'MARKET_RESULT_INVALID'});
  assert.throws(()=>store.finish(otherClaim,{code:'MARKET_PROCESSING_INTERRUPTED',disposition:'WAIT'}),{code:'MARKET_RESULT_INVALID'});
  await store.finish(otherClaim,{code:'SYNTHETIC_DONE',disposition:'UNAVAILABLE'});
  await due(recovered.request_id);const afterRestart=await createMarketJobStore({boundary:machine}).claim(2);
  assert.equal(afterRestart.request_id,recovered.request_id);assert.equal(afterRestart.recoveries,1);assert.equal(afterRestart.attempts,1);
  await store.finish(afterRestart,{code:'SYNTHETIC_DONE',disposition:'UNAVAILABLE'});
  checks.push('parallel PostgreSQL claims recover only fully evidenced pending-only legacy exhaustion once; mixed errors, missing receipts, deleted cards, retired work and superseded approvals stay byte-identical; original sold response/dispatch/audit prefix survive restart; WAIT requires retained response and exact pending disposition');
  checks.push('actual SQL prefilters five older excluded legacy histories before LIMIT 1: only the later eligible saved response reaches JavaScript once, subsequent polls return zero recovery rows, with no exclusion writes or starvation');
}
