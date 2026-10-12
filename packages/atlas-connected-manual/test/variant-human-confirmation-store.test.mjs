import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantJobStore,variantBinding,validateVariantAction,validateVariantContributionPacket,variantSelectedIdentity} from '../src/variant-job-store.mjs';
import {variantReviewStatus} from '../src/variant-service.mjs';
import {importScrydexVariantCandidates,scrydexVariantSearchUrl} from '@tenkings/card-catalog-evidence';
function fixture({confirmed=true}={}){
 const principal={id:randomUUID(),role:'REVIEWER',accessVersion:1},card={cardId:randomUUID(),revision:4,draft:{source:{sourceHash:digest('pair')},identityRevision:2,identity:{cardName:'Magikarp',year:'2020',productSet:'Rebel Clash',cardNumber:'039/192',parallel:'Reverse Holo',layoutType:'POKEMON'}}};
 card.contentHash=digest(canonical(card.draft));const b=variantBinding(card);
 const confirmation={card_id:card.cardId,action_id:randomUUID(),analysis_action_id:randomUUID(),source_hash:b.sourceHash,identity_revision:b.identityRevision,identity_hash:b.identityHash,reprocess_required:true,decision:'MANUAL',job_key:null,observed_features:'Historical saved note'};
 const writes=[],reads=[];const tx={async $queryRawUnsafe(sql,...args){reads.push(sql);if(sql.includes('FROM atlas_manual.card'))return [{id:card.cardId,revision:card.revision,owner_id:principal.id,editors:[],readers:[],approvers:[],content:canonical(card.draft),content_hash:card.contentHash}];if(sql.includes('variant_confirmation'))return confirmed&&args[1]===confirmation.source_hash&&args[2]===confirmation.identity_revision&&args[3]===confirmation.identity_hash?[confirmation]:[];if(sql.includes('variant_job')||sql.includes('atlas_manual.approval'))return [];throw Error(sql);},async $executeRawUnsafe(sql,...args){writes.push({sql,args});return 1;}};
 const boundary={transaction:async(staff,work)=>work({tx,principal}),machineTransaction:async()=>assert.fail('no machine work')};
 const store=createVariantJobStore({boundary}),action={type:'VARIANT_CONFIRM',sourceHash:b.sourceHash,identityRevision:b.identityRevision,identityHash:b.identityHash,jobId:null,resultHash:null,decision:'MANUAL',candidateId:null,reviewed:true,manualParallel:'Reverse Holo'};
 return {store,card,principal,confirmation,action,writes,reads,tx};
}
test('Base and named printing confirmations save without notes, catalog or automatic analysis for initial and changed finishes',async()=>{
 for(const previous of [null,'Holo','Reverse Holo'])for(const printing of ['Base','English Cosmos Holo']){
  const f=fixture({confirmed:false});f.card.draft.identity.parallel=previous;f.card.contentHash=digest(canonical(f.card.draft));
  const b=variantBinding(f.card),action={...f.action,sourceHash:b.sourceHash,identityRevision:b.identityRevision,identityHash:b.identityHash,manualParallel:printing};
  const next={...f.card.draft,identity:{...f.card.draft.identity,parallel:printing},identityRevision:f.card.draft.identityRevision+1};
  validateVariantAction(action);await f.store.validateCommit({tx:f.tx,principal:f.principal,cardId:f.card.cardId,input:{actionId:randomUUID(),action},draft:next});
  assert.equal(f.writes.length,2);assert.match(f.writes[0].sql,/reprocess_required\) VALUES\(.*false\)/);assert.doesNotMatch(f.writes[0].sql,/analysis_action_id|observed_features/);
  const payload=JSON.parse(f.writes[1].args[4]);assert.equal(payload.parallel,printing);assert.equal(Object.hasOwn(payload,'observedFeatures'),false);assert(!f.reads.some(sql=>sql.includes('atlas_defect_analysis')));
 }
});
test('physical confirmation preserves source and exact identity checks and never silently defaults Base',async()=>{
 for(const mutation of ['source','identity','draft']){
  const f=fixture(),action={...f.action},draft=structuredClone(f.card.draft);
  if(mutation==='source')action.sourceHash=digest('other photos');if(mutation==='identity')action.identityRevision++;if(mutation==='draft')draft.identity.parallel='Holo';
  await assert.rejects(f.store.validateCommit({tx:f.tx,principal:f.principal,cardId:f.card.cardId,input:{actionId:randomUUID(),action},draft}),{code:mutation==='source'?'VARIANT_SOURCE_STALE':'VARIANT_IDENTITY_STALE'});assert.equal(f.writes.length,0);
 }
 const f=fixture();for(const manualParallel of ['', '   ', 'x'.repeat(121)])assert.throws(()=>validateVariantAction({...f.action,manualParallel}));
 assert.throws(()=>validateVariantAction({...f.action,reviewed:false}));assert.throws(()=>validateVariantAction({...f.action,observedFeatures:'Retired request field'}));
});
test('current human decisions permit approval independently of historical unfinished reanalysis and retain old notes for reading',async()=>{
 const f=fixture();await f.store.assertApproval({},f.card);const saved=await f.store.read({},f.card.cardId);assert.equal(saved.approvalReady,true);
 const status=variantReviewStatus(saved);assert.equal(status.confirmation.observedFeatures,'Historical saved note');assert.equal(Object.hasOwn(status.confirmation,'reprocessRequired'),false);
 assert(!f.reads.some(sql=>sql.includes('atlas_defect_analysis')));assert.equal(f.store.pendingRechecks,undefined);assert.equal(f.store.prepareConfirmation,undefined);
 for(const change of ['source','identity']){const changed=structuredClone(f.card);if(change==='source')changed.draft.source.sourceHash=digest('replacement');else changed.draft.identity.parallel='Different';await assert.rejects(f.store.assertApproval({},changed),{code:'VARIANT_CONFIRMATION_REQUIRED'});}
});
test('missing or unresolved physical confirmation still cannot approve a card',async()=>{
 const missing=fixture({confirmed:false});await assert.rejects(missing.store.assertApproval({},missing.card),{code:'VARIANT_CONFIRMATION_REQUIRED'});
 const unresolved=fixture();unresolved.confirmation.decision='UNRESOLVED';await assert.rejects(unresolved.store.assertApproval({},unresolved.card),{code:'VARIANT_CONFIRMATION_REQUIRED'});
});
test('optional photo contribution needs explicit rights basis and consumers, never prose',()=>{
 const f=fixture(),valid={basis:'owned_original',consumers:['inventory','atlas']};validateVariantAction({...f.action,referencePermission:valid});
 for(const permission of [null,{}, {...valid,basis:'provider'}, {...valid,consumers:['atlas']},{...valid,extra:true}])assert.throws(()=>validateVariantAction({...f.action,referencePermission:permission}));
 const {manualParallel,...hold}=f.action;assert.throws(()=>validateVariantAction({...hold,decision:'UNRESOLVED',referencePermission:valid}),{code:'VARIANT_REFERENCE_PERMISSION_INVALID'});
});
test('Scrydex-verified series names preserve saved set identity during first printing confirmation',()=>{
 const target={category:'POKEMON',name:'Pikachu',year:'2023',setName:'Scarlet & Violet—151',cardNumber:'025/165'};
 const source={url:scrydexVariantSearchUrl(target),sha256:digest('retained Scrydex fixture')};
 const record={id:'sv3pt5-25',name:'Pikachu',number:'25',printed_number:'025/165',language_code:'EN',
  expansion:{id:'sv3pt5',name:'151',series:'Scarlet & Violet',release_date:'2023/09/22',is_online_only:false},
  variants:[{name:'cosmosHolofoil',images:[]}],images:[]};
 for(const productSet of ['Scarlet & Violet—151','Scarlet & Violet - 151','Scarlet & Violet 151','151']){
  const original={cardName:'Pikachu',year:'2023',productSet,cardNumber:'025/165',parallel:null,layoutType:'POKEMON'};
  const [candidate]=importScrydexVariantCandidates({identity:{category:'POKEMON',name:'Pikachu',year:'2023',setName:productSet,cardNumber:'025/165'},card:record,source});
  assert(candidate);assert.equal(candidate.identity.setName,'151');assert(!candidate.warnings.includes('SET_NAME_REQUIRES_REVIEW'));
  const selected=variantSelectedIdentity({draft:{identity:original}},{decision:'SELECTED',candidateId:candidate.candidateId},{catalog:{candidates:[candidate]}});
  assert.deepEqual(selected,{...original,parallel:'English Cosmos Holofoil'});
  const disputed={...candidate,warnings:[...candidate.warnings,'SET_NAME_REQUIRES_REVIEW']};
  const reviewed=variantSelectedIdentity({draft:{identity:original}},{decision:'SELECTED',candidateId:candidate.candidateId},{catalog:{candidates:[disputed]}});
  assert.equal(reviewed.productSet,'151');
 }
});
test('private reference packet accepts only exact action payload lineage and durable artifact references',async()=>{
 const payload={referencePermission:{basis:'owned_original',detail:'Owned test photographs',consumers:['inventory','atlas']}},cardId=randomUUID(),job={action_id:randomUUID(),claim_id:randomUUID(),card_id:cardId,payload,payload_hash:digest(canonical(payload))},lineage=digest(canonical({cardId,kind:'VARIANT_REFERENCE',sourceHash:job.payload_hash})),sha=digest('private artifact');
 const packet={sourceHash:job.payload_hash,ref:{key:'atlas-private/'+cardId+'/VARIANT_REFERENCE/'+lineage+'-'+sha+'.json',sha256:sha,lineageSha256:lineage,byteCount:12000,kind:'VARIANT_REFERENCE',cardId}};assert.deepEqual(validateVariantContributionPacket(job,packet),packet);
 let writes=0;const store=createVariantJobStore({boundary:{machineTransaction:async(_,work)=>work({tx:{$executeRawUnsafe:async(sql,...args)=>{writes++;assert(sql.includes("state='RUNNING'")&&sql.includes('lease_until>clock_timestamp()'));assert.match(sql,/display_owner_current/);assert(sql.includes('reference_packet IS NULL OR reference_packet=$3'));assert.equal(args[0],job.action_id);assert.equal(args[2],canonical(packet));return 1;}}})}});assert.equal(await store.saveContributionPacket(job,packet),true);assert.equal(writes,1);
 for(const changed of [{...packet,sourceHash:digest('wrong')},{...packet,ref:{...packet.ref,cardId:randomUUID()}},{...packet,ref:{...packet.ref,kind:'GEOMETRY'}},{...packet,ref:{...packet.ref,lineageSha256:digest('wrong')}},{...packet,ref:{...packet.ref,key:'https://external.invalid/private.jpg'}},{...packet,ref:{...packet.ref,bytes:'private photo'}},{...packet,ref:{...packet.ref,byteCount:16777217}}])await assert.rejects(store.saveContributionPacket(job,changed));
 await assert.rejects(store.saveContributionPacket({...job,payload:{referencePermission:null}},packet));assert.equal(writes,1);
});
