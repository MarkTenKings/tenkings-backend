import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantJobStore,variantBinding,VARIANT_POLICY} from '../src/variant-job-store.mjs';
import {variantReviewStatus} from '../src/variant-service.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture({confirmed=true,approved=true}={}){
 const principal={id:randomUUID(),role:'REVIEWER',accessVersion:1},card={cardId:randomUUID(),revision:14,draft:{
  source:{sourceHash:digest('saved photos')},identityRevision:2,identity:{playerName:'Jaxson Dart',year:'2025',manufacturer:'Panini',productSet:'Donruss Optic Football — Donruss Threads',cardNumber:'DTBH-JDT',parallel:'Base',insert:null},
  geometry:{sourceHash:digest('human geometry')},defects:{sourceHash:digest('human findings')}}};
 card.contentHash=digest(canonical(card.draft));const binding=variantBinding(card);
 const confirmation=confirmed?{action_id:randomUUID(),decision:'MANUAL',source_hash:binding.sourceHash,identity_revision:binding.identityRevision,identity_hash:binding.identityHash,job_key:null}:null;
 const jobs=[],writes=[],order=[],hooks={};let tail=Promise.resolve();
 const transaction=async(kind,work)=>{
  let unlock=null;const tx={
   async $queryRawUnsafe(sql,...args){
    if(sql.includes('FROM atlas_manual.card')){
     if(sql.includes('FOR UPDATE'))order.push(`${kind}:card-lock`);
     const row={id:card.cardId,revision:card.revision,owner_id:principal.id,editors:[],readers:[],approvers:[],access_version:1,content:canonical(card.draft),content_hash:digest(canonical(card.draft))};
     if(sql.includes('ORDER BY c.id')){const rows=!confirmed&&!approved&&!jobs.length?[row]:[];await hooks.afterScan?.();return rows;}
     return [row];
    }
    if(sql.includes('variant_confirmation'))return confirmation&&args[1]===confirmation.source_hash&&args[2]===confirmation.identity_revision&&args[3]===confirmation.identity_hash?[confirmation]:[];
    if(sql.includes('atlas_manual.approval'))return approved?[{approved:1}]:[];
    if(sql.includes('variant_job')){
     if(sql.includes('generation=$2'))return jobs.filter(j=>j.card_id===args[0]&&j.generation===args[1]);
     if(sql.includes('WHERE key=$1'))return jobs.filter(j=>j.key===args[0]);
     return jobs.filter(j=>j.card_id===args[0]&&j.source_hash===args[1]&&j.identity_revision===args[2]
      &&(sql.includes('identity_hash=$4')?j.identity_hash===args[3]:j.policy===args[3]));
    }
    throw Error(sql);
   },
   async $executeRawUnsafe(sql,...args){
    if(sql.startsWith('SELECT pg_advisory_xact_lock')){const previous=tail,next=deferred();tail=next.promise;await previous;unlock=next.resolve;order.push(`${kind}:preparation-lock`);return 1;}
    assert.match(sql,/^INSERT INTO atlas_manual_connected.variant_job/,'reference preparation must not write any human state');
    await hooks.beforeInsert?.(kind);
    const explicit=sql.includes('policy,generation'),offset=explicit?1:0,input=args[8+offset];
    const row={key:args[0],card_id:args[1],actor_id:args[2],access_version:args[3],policy:args[4],generation:explicit?args[5]:'00000000-0000-0000-0000-000000000000',
     source_hash:args[5+offset],identity_revision:args[6+offset],identity_hash:args[7+offset],input,input_hash:args[9+offset],state:'QUEUED',attempts:0};
    jobs.push(row);writes.push({sql,args});return 1;
   },
  };
  try{return await work({tx,principal});}finally{unlock?.();}
 };
 const store=createVariantJobStore({boundary:{transaction:(_staff,work)=>transaction('human',work),machineTransaction:(_id,work)=>transaction('machine',work)}});
 const request={requestId:randomUUID(),...Object.fromEntries(['sourceHash','identityRevision','identityHash'].map(k=>[k,binding[k]])),jobId:null};
 return {store,card,confirmation,jobs,writes,order,hooks,request};
}
test('initial reference preparation preserves approved manual Base and all human work, with exact replay',async()=>{
 const f=fixture(),before=structuredClone({card:f.card,confirmation:f.confirmation});
 const status=variantReviewStatus(await f.store.read({},f.card.cardId));
 assert.equal(status.state,'NOT_REQUESTED');assert.equal(status.jobId,null);assert.equal(status.refreshable,true);assert.equal(status.approvalReady,true);
 const key=await f.store.refresh({},f.card.cardId,f.request);
 assert.equal(await f.store.refresh({},f.card.cardId,f.request),key);assert.equal(f.jobs.length,1);
 assert.equal(JSON.parse(f.jobs[0].input).reuseJobKey,null);assert.equal(f.jobs[0].generation,f.request.requestId);
 const after=variantReviewStatus(await f.store.read({},f.card.cardId));assert.equal(after.state,'QUEUED');assert.equal(after.approvalReady,true);assert.deepEqual(after.confirmation,status.confirmation);
 assert.deepEqual({card:f.card,confirmation:f.confirmation},before);assert.equal(f.writes.length,1);
 assert(f.order.indexOf('human:preparation-lock')<f.order.indexOf('human:card-lock'));
 f.card.draft.identityRevision++;
 assert.equal(await f.store.refresh({},f.card.cardId,f.request),key,'lost response reconciles the same generation after a later identity edit');
 assert.equal(f.writes.length,1);
});
test('explicit initial preparation wins a discovery scan race without a second ordinary job',async()=>{
 const f=fixture({confirmed:false,approved:false}),scanned=deferred(),resume=deferred();
 f.hooks.afterScan=async()=>{scanned.resolve();await resume.promise;};
 const discovery=f.store.discover();await scanned.promise;
 await f.store.refresh({},f.card.cardId,f.request);resume.resolve();
 assert.equal(await discovery,0);assert.equal(f.jobs.length,1);assert.equal(f.writes.length,1);
});
test('ordinary corrected-identity discovery wins initial preparation race; later null-job request refuses',async()=>{
 const f=fixture({confirmed:false,approved:false}),inserting=deferred(),resume=deferred();
 f.hooks.beforeInsert=async kind=>{if(kind==='machine'){inserting.resolve();await resume.promise;}};
 const discovery=f.store.discover();await inserting.promise;
 const initial=f.store.refresh({},f.card.cardId,f.request),rejected=assert.rejects(initial,{code:'VARIANT_REFRESH_UNAVAILABLE'});
 resume.resolve();assert.equal(await discovery,1);await rejected;
 assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].policy,VARIANT_POLICY);assert.equal(f.jobs[0].generation,'00000000-0000-0000-0000-000000000000');
});
test('initial reference preparation refuses source or identity drift and remains idempotent under double click',async()=>{
 for(const change of [{sourceHash:digest('new photos')},{identityRevision:3},{identityHash:digest('other identity')}]){
  const f=fixture();await assert.rejects(f.store.refresh({},f.card.cardId,{...f.request,...change}),{code:Object.hasOwn(change,'sourceHash')?'VARIANT_SOURCE_STALE':'VARIANT_IDENTITY_STALE'});assert.equal(f.writes.length,0);
 }
 const f=fixture();const outcomes=await Promise.allSettled([f.store.refresh({},f.card.cardId,f.request),f.store.refresh({},f.card.cardId,{...f.request,requestId:randomUUID()})]);
 assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);assert.equal(outcomes.find(v=>v.status==='rejected').reason.code,'VARIANT_REFRESH_UNAVAILABLE');assert.equal(f.jobs.length,1);
});
