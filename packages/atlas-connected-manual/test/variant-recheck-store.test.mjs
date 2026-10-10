import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantJobStore,variantBinding,variantAnalysisActionId,validateVariantAction,validateVariantContributionPacket,variantCorrectionRequiresRecheck} from '../src/variant-job-store.mjs';

function fixture({firstConfirmation=false}={}){
 const principal={id:randomUUID(),role:'REVIEWER'},card={cardId:randomUUID(),revision:4,draft:{source:{sourceHash:digest('pair')},identityRevision:2,identity:{cardName:'Magikarp',year:'2020',productSet:'Rebel Clash',cardNumber:'039/192',parallel:'Reverse Holo',layoutType:'POKEMON'}}};
 card.contentHash=digest(canonical(card.draft));const b=variantBinding(card),actionId=randomUUID(),requestHash=digest('request');
 const confirmation={card_id:card.cardId,action_id:randomUUID(),analysis_action_id:actionId,source_hash:b.sourceHash,identity_revision:b.identityRevision,identity_hash:b.identityHash,reprocess_required:true,decision:'MANUAL',job_key:null};
 const binding=canonical({sourceHash:b.sourceHash,identityRevision:b.identityRevision}),evidence=canonical({profile:'POKEMON'}),run={id:randomUUID(),state:'DISPATCHED',request_hash:requestHash,binding,binding_hash:digest(binding),request_evidence:evidence,evidence_hash:digest(evidence),response_evidence:canonical({state:'READY',responseHash:digest('response')}),outcome_evidence:null,accepted:false,expires_at:new Date(Date.now()+60000)};
 let inTransaction=false,compatible=true,compatibilityCalls=0;const writes=[];
 const tx={async $queryRawUnsafe(sql){if(sql.includes('FROM atlas_manual.card'))return [{id:card.cardId,revision:card.revision,owner_id:principal.id,editors:[],readers:[],approvers:[],content:canonical(card.draft),content_hash:card.contentHash}];if(sql.includes('variant_confirmation'))return firstConfirmation?[]:[confirmation];if(sql.includes('request_refusal'))return [];if(sql.includes('FROM atlas_defect_analysis.run'))return [run];throw Error(sql);},async $executeRawUnsafe(sql,...args){writes.push({sql,args});return 1;}};
 const boundary={async transaction(staff,work){assert.equal(inTransaction,false);inTransaction=true;try{return await work({tx,principal});}finally{inTransaction=false;}},machineTransaction:async()=>assert.fail('no machine work')};
 const store=createVariantJobStore({boundary,analysisCompatible:async({card:c,run:r})=>{assert.equal(inTransaction,false,'hydration cannot hold a DB transaction');assert.equal(c.contentHash,card.contentHash);assert.equal(r.analysisId,run.id);compatibilityCalls++;return compatible;}});
 const action={type:'VARIANT_CONFIRM',sourceHash:b.sourceHash,identityRevision:b.identityRevision,identityHash:b.identityHash,jobId:null,resultHash:null,decision:'MANUAL',candidateId:null,reviewed:true,manualParallel:'Reverse Holo',observedFeatures:'Physical reverse reflective pattern observed'};
 return {store,card,principal,confirmation,run,action,writes,tx,setCompatible:v=>compatible=v,compatibilityCalls:()=>compatibilityCalls};
}
test('first physical finish confirmation and exact collector aliases do not invent a new grading correction',()=>{
 const original={cardName:'Charizard ex',year:'2024',productSet:'Paldean Fates',cardNumber:'054/091',parallel:null,layoutType:'POKEMON'};
 const confirmed={...original,cardNumber:'054/91',parallel:'English Holo'};
 assert.equal(variantCorrectionRequiresRecheck(original,confirmed),false);
 assert.equal(variantCorrectionRequiresRecheck({...original,parallel:'Holofoil'},confirmed),false);
 assert.equal(variantCorrectionRequiresRecheck({...original,parallel:'English Holofoil'},confirmed),false);
 assert.equal(variantCorrectionRequiresRecheck({...original,parallel:'Reverse Holofoil'},{...confirmed,parallel:'English Reverse Holo'}),false);
 assert.equal(variantCorrectionRequiresRecheck(confirmed,{...confirmed,cardName:'CHARIZARD EX',cardNumber:'#54/091',productSet:'Paldean  Fates'}),false);
 for(const change of [{cardNumber:'054/092'},{cardNumber:'054'},{cardNumber:'RC054/091'},{year:'2025'},{cardName:'Mew ex'},{productSet:'Hidden Fates'},{layoutType:'TRAINER'},{parallel:'English Reverse Holo'},{parallel:'French Holo'},{parallel:null}])
  assert.equal(variantCorrectionRequiresRecheck(confirmed,{...confirmed,...change}),true,JSON.stringify(change));
 // Base, absent denominator and unrecognized finish wording are not aliases.
 assert.equal(variantCorrectionRequiresRecheck({...original,parallel:'Base'},confirmed),true);
 assert.equal(variantCorrectionRequiresRecheck({...original,cardNumber:null},confirmed),true);
 assert.equal(variantCorrectionRequiresRecheck({...original,parallel:'Cosmos Holo'},confirmed),true);
 const sports={playerName:'Drake Maye',year:'2025',manufacturer:'Panini',productSet:'Donruss Optic Football',cardNumber:'DTBH-DME',parallel:null,insert:null};
 assert.equal(variantCorrectionRequiresRecheck(sports,{...sports,parallel:'Blue Hyper Prizm'}),false);
 assert.equal(variantCorrectionRequiresRecheck({...sports,parallel:'Blue Hyper Prizm'},{...sports,parallel:'Red Hyper Prizm'}),true);
 assert.equal(variantCorrectionRequiresRecheck(sports,{...sports,insert:'Different insert',parallel:'Blue Hyper Prizm'}),true);
});
test('initial unknown finish persists explicit human confirmation without a recheck; known printing corrections remain gated',async()=>{
 for(const previous of [null,'Holo']){
  const f=fixture({firstConfirmation:true});f.card.draft.identity.parallel=previous;f.card.contentHash=digest(canonical(f.card.draft));
  const binding=variantBinding(f.card),action={...f.action,...binding,manualParallel:'English Reverse Holo'};delete action.cardId;
  const next={...f.card.draft,identity:{...f.card.draft.identity,parallel:action.manualParallel},identityRevision:f.card.draft.identityRevision+1};
  await f.store.validateCommit({tx:f.tx,principal:f.principal,cardId:f.card.cardId,input:{actionId:randomUUID(),action},draft:next});
  assert.equal(f.writes[0].args[11],previous!==null);assert.equal(f.writes[0].args[4],next.identityRevision);
  assert.equal(f.writes[1].sql.includes('variant_contribution'),true);assert.equal(f.compatibilityCalls(),0);
 }
});
test('first confirmation still rejects obsolete source, identity and proposed draft before any durable writes',async()=>{
 for(const mutation of ['source','identity','draft']){
  const f=fixture({firstConfirmation:true}),action={...f.action},draft=structuredClone(f.card.draft);
  if(mutation==='source')action.sourceHash=digest('other photos');
  if(mutation==='identity')action.identityRevision++;
  if(mutation==='draft')draft.identity.parallel='Holo';
  await assert.rejects(f.store.validateCommit({tx:f.tx,principal:f.principal,cardId:f.card.cardId,input:{actionId:randomUUID(),action},draft}),{code:mutation==='source'?'VARIANT_SOURCE_STALE':'VARIANT_IDENTITY_STALE'});
  assert.equal(f.writes.length,0);
 }
});
test('known READY stale geometry exposes explicit retry, and exact server fence replaces only that saved analysis',async()=>{
 const f=fixture();assert.equal((await f.store.currentConfirmation({},f.card)).recheck_retryable,false);
 f.setCompatible(false);const status=await f.store.currentConfirmation({},f.card);assert.equal(status.recheck_state,'READY');assert.equal(status.recheck_retryable,true);assert.equal(status.recheck_reason,'VARIANT_ANALYSIS_STALE');
 const guard=await f.store.prepareConfirmation({staff:{},card:f.card,action:f.action});const actionId=randomUUID();
 await f.store.validateCommit({tx:f.tx,principal:f.principal,cardId:f.card.cardId,input:{actionId,action:f.action},draft:f.card.draft,commitGuard:guard});
 const confirmation=f.writes.find(w=>w.sql.includes('variant_confirmation'));assert.equal(confirmation.args[12],variantAnalysisActionId(actionId));assert.notEqual(confirmation.args[12],f.confirmation.analysis_action_id);assert.equal(confirmation.args[11],true);
 assert(f.compatibilityCalls()>=3);assert.equal(f.writes.length,2,'only confirmation and ordinary metadata outbox persist');
});
test('stale READY recovery guard cannot survive changed card, response, request or nonterminal evidence',async()=>{
 for(const mutation of ['card','response','request','unknown']){
  const f=fixture();f.setCompatible(false);const guard=await f.store.prepareConfirmation({staff:{},card:f.card,action:f.action});
  if(mutation==='card'){f.card.draft.extra='new';f.card.contentHash=digest(canonical(f.card.draft));}
  if(mutation==='response')f.run.response_evidence=canonical({state:'READY',responseHash:digest('different response')});
  if(mutation==='request')f.run.request_hash=digest('different request');
  if(mutation==='unknown'){f.run.response_evidence=null;f.run.outcome_evidence=canonical({state:'UNKNOWN'});}
  await assert.rejects(f.store.validateCommit({tx:f.tx,principal:f.principal,cardId:f.card.cardId,input:{actionId:randomUUID(),action:f.action},draft:f.card.draft,commitGuard:guard}),{code:'VARIANT_RECHECK_STALE'});assert.equal(f.writes.length,0);
 }
});
test('UNKNOWN and pending rechecks never hydrate into replacement authority; ordinary reconfirm retains original action',async()=>{
 for(const state of ['UNKNOWN','PREPARED','DISPATCHED']){
  const f=fixture();f.setCompatible(false);f.run.response_evidence=null;f.run.state=state==='UNKNOWN'?'DISPATCHED':state;f.run.outcome_evidence=state==='UNKNOWN'?canonical({state}):null;
  assert.equal((await f.store.currentConfirmation({},f.card)).recheck_retryable,false);assert.equal(await f.store.prepareConfirmation({staff:{},card:f.card,action:f.action}),null);assert.equal(f.compatibilityCalls(),0);
  await f.store.validateCommit({tx:f.tx,principal:f.principal,cardId:f.card.cardId,input:{actionId:randomUUID(),action:f.action},draft:f.card.draft});assert.equal(f.writes[0].args[12],f.confirmation.analysis_action_id);
 }
});

test('accepted background collection stays DISPATCHED until its saved polling deadline; neither state grants retry',async()=>{
 const f=fixture();f.run.response_evidence=null;f.run.outcome_evidence=canonical({state:'UNKNOWN'});f.run.accepted=true;f.run.acceptance_evidence=canonical({pollUntil:new Date(Date.now()+60000).toISOString()});
 let saved=await f.store.currentConfirmation({},f.card);assert.equal(saved.recheck_state,'DISPATCHED');assert.equal(saved.recheck_retryable,false);
 f.run.acceptance_evidence=canonical({pollUntil:new Date(Date.now()-60000).toISOString()});saved=await f.store.currentConfirmation({},f.card);assert.equal(saved.recheck_state,'UNKNOWN');assert.equal(saved.recheck_retryable,false);assert.equal(f.compatibilityCalls(),0);
});

test('optional reference permission preserves exact explicit rights in immutable metadata outbox; absence stays null',async()=>{
 for(const basis of [null,'owned_original','licensed','permission']){const f=fixture();const permission=basis?{basis,detail:'I captured these card photographs and authorize reference review.',consumers:['inventory','atlas']}:null;if(permission)f.action.referencePermission=permission;
  await f.store.validateCommit({tx:f.tx,principal:f.principal,cardId:f.card.cardId,input:{actionId:randomUUID(),action:f.action},draft:f.card.draft});const payload=JSON.parse(f.writes[1].args[4]);assert.deepEqual(payload.referencePermission,permission);assert.equal(payload.sourceHash,f.action.sourceHash);assert.equal(payload.decision,'MANUAL');
 }
});
test('photo permission requires a concrete reviewed choice, explicit basis, exact consumers and bounded trimmed detail',()=>{
 const valid={basis:'owned_original',detail:'Own original photographs',consumers:['inventory','atlas']};
 for(const permission of [null,{}, {...valid,basis:'provider'}, {...valid,detail:''},{...valid,detail:' trailing '},{...valid,detail:'x'.repeat(1001)},{...valid,detail:'line\nbreak'},{...valid,consumers:['atlas']},{...valid,consumers:['atlas','inventory']},{...valid,extra:true}]){const f=fixture();assert.throws(()=>validateVariantAction({...f.action,referencePermission:permission}));}
 const f=fixture(),{manualParallel,observedFeatures,...hold}=f.action;assert.throws(()=>validateVariantAction({...hold,decision:'UNRESOLVED',referencePermission:valid}),{code:'VARIANT_REFERENCE_PERMISSION_INVALID'});
});

test('private reference packet accepts only exact action payload lineage and durable artifact references',async()=>{
 const payload={referencePermission:{basis:'owned_original',detail:'Owned test photographs',consumers:['inventory','atlas']}},cardId=randomUUID(),job={action_id:randomUUID(),claim_id:randomUUID(),card_id:cardId,payload,payload_hash:digest(canonical(payload))},lineage=digest(canonical({cardId,kind:'VARIANT_REFERENCE',sourceHash:job.payload_hash})),sha=digest('private artifact');
 const packet={sourceHash:job.payload_hash,ref:{key:'atlas-private/'+cardId+'/VARIANT_REFERENCE/'+lineage+'-'+sha+'.json',sha256:sha,lineageSha256:lineage,byteCount:12000,kind:'VARIANT_REFERENCE',cardId}};assert.deepEqual(validateVariantContributionPacket(job,packet),packet);
 let writes=0;const store=createVariantJobStore({boundary:{machineTransaction:async(_,work)=>work({tx:{$executeRawUnsafe:async(sql,...args)=>{writes++;assert(sql.includes("state='RUNNING'")&&sql.includes('lease_until>clock_timestamp()'));assert.match(sql,/display_owner_current/);assert(sql.includes('reference_packet IS NULL OR reference_packet=$3'));assert.equal(args[0],job.action_id);assert.equal(args[2],canonical(packet));return 1;}}})}});assert.equal(await store.saveContributionPacket(job,packet),true);assert.equal(writes,1);
 for(const changed of [{...packet,sourceHash:digest('wrong')},{...packet,ref:{...packet.ref,cardId:randomUUID()}},{...packet,ref:{...packet.ref,kind:'GEOMETRY'}},{...packet,ref:{...packet.ref,lineageSha256:digest('wrong')}},{...packet,ref:{...packet.ref,key:'https://external.invalid/private.jpg'}},{...packet,ref:{...packet.ref,bytes:'private photo'}},{...packet,ref:{...packet.ref,byteCount:16777217}}])await assert.rejects(store.saveContributionPacket(job,changed));
 await assert.rejects(store.saveContributionPacket({...job,payload:{referencePermission:null}},packet));assert.equal(writes,1);
});
