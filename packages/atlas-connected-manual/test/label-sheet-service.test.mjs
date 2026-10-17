import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '@atlas/manual-service/contract';
import { createLabelService, LABEL_EXPORT_PROFILES } from '../src/label-sheet-service.mjs';
import { createManualFinishing } from '../src/finishing.mjs';
import { publicationFixture } from './publication-fixture.mjs';
import { LABEL_EXPORT_PROFILE_V1 } from '@atlas/finishing/label-sheet';

async function fixture({ cardProfile = 'SPORTS' } = {}) {
  const identity = cardProfile === 'SPORTS' ? { playerName:'Nick Smith Jr',year:'2023',manufacturer:'Panini',productSet:'Prizm',cardNumber:'1' } : { cardName:'Mewtwo',year:'1999',manufacturer:'Wizards',productSet:'Base Set',cardNumber:'10/102' };
  const f = await publicationFixture({ cardProfile, identity });
  f.row.mode='PRODUCTION'; await f.publication.publish({},f.cardId,f.actionId);
  const id=randomUUID(),actor=randomUUID(),item={id,actor_id:actor,access_version:1,card_id:f.cardId,action_id:f.actionId,purpose:'ORIGINAL'},saved=[];let pending=true,failed=0;
  const repository={pendingCandidates:async()=>pending?[{id,actor_id:actor,access_version:1,kind:'ITEM'}]:[],claimItem:async()=>pending?item:null,
    finishItem:async(_staff,_claim,result)=>{pending=false;saved.push(result);},failItem:async()=>{failed++;}};
  const finishing=createManualFinishing({repository:f.repository,artifacts:f.artifacts});
  const boundary={machineOwner:({ownerId,accessVersion})=>({id:ownerId,accessVersion})};
  const storage={write(){assert.fail('no export needed');},download(){assert.fail('no download needed');}};
  const service=createLabelService({repository,finishing,boundary,storage});
  return{f,item,repository,boundary,service,storage,saved,get failed(){return failed;}};
}

test('durable pending work renders only an exact authoritative PUBLISHED packet and keeps approved grade',async()=>{
  const f=await fixture();assert.equal(await f.service.runPending(),1);assert.equal(await f.service.runPending(),0);
  assert.equal(f.saved.length,1);const out=f.saved[0];assert.equal(out.state,'READY');
  assert.equal(out.snapshot.grade,f.f.full.finalGrade);assert.deepEqual(out.snapshot.identity,f.f.full.identity);
  assert.equal(out.snapshot.reportNumber,f.f.row.report_number);assert.equal(out.materialProfileId,'atlas-v4-gold-v1');
  assert.equal(out.artworkHash,digest(out.printSvg));assert.notEqual(out.previewSvg,out.printSvg);
});
test('failed publication lineage never produces artwork or assignment',async()=>{
  const f=await fixture();f.f.row.source_hash=digest('changed');assert.equal(await f.service.runPending(),0);assert.equal(f.failed,1);assert.equal(f.saved.length,0);
});
test('concurrent runPending calls share one finite worker pass',async()=>{
  const f=await fixture();const out=await Promise.all([f.service.runPending(),f.service.runPending()]);assert.deepEqual(out,[1,1]);assert.equal(f.saved.length,1);
});
test('browser supplied grade/material/artwork and wrong export profile are refused',async()=>{
  const f=await fixture(),requestId=randomUUID(),sheetId=randomUUID();
  assert.throws(()=>f.service.prepareSheetExport({},sheetId,{requestId,expectedSheetRevision:1,exportProfileId:LABEL_EXPORT_PROFILES.SHEET,grade:10}),{code:'LABEL_REQUEST_INVALID'});
  assert.throws(()=>f.service.prepareIndividualExport({},randomUUID(),{requestId,expectedLabelHash:digest('label'),exportProfileId:LABEL_EXPORT_PROFILES.SHEET}),{code:'LABEL_PROFILE_INVALID'});
  assert.throws(()=>f.service.reprint({},randomUUID(),{requestId,expectedLabelHash:digest('label'),reason:''}),{code:'LABEL_REPRINT_REASON_REQUIRED'});
});
test('download reauthorizes all source members after signing; no print event is implicit',async()=>{
  let count=0,printed=0;const exportId=randomUUID(),sheetId=randomUUID(),sha256=digest('png'),row={id:exportId,kind:'SHEET',sheet_id:sheetId,state:'READY',sha256,manifest_hash:digest('manifest'),byte_count:100,content_type:'image/png',object_ref:'{}'};
  const service=createLabelService({boundary:{machineOwner(){}},finishing:{loadPacket(){}},repository:{pendingCandidates(){},async export(){count++;if(count===2)throw Object.assign(new Error('revoked'),{status:404,code:'MANUAL_CARD_NOT_FOUND'});return{row};},confirmPrint(){printed++;}},
    storage:{write(){},download:async()=>({url:'https://example.invalid/fixture',expiresAt:'2026-10-15T00:00:00Z'})}});
  await assert.rejects(service.download({}, {exportId,sheetId,input:{requestId:randomUUID(),expectedExportSha256:sha256}}),{code:'MANUAL_CARD_NOT_FOUND'});assert.equal(printed,0);assert.equal(count,2);
});

test('a denied machine owner cannot abort later eligible work in the same pass',async()=>{
  const f=await fixture(),bad=randomUUID(),owner=f.boundary.machineOwner;
  f.boundary.machineOwner=input=>{if(input.ownerId===bad)throw new Error('revoked fixture owner');return owner(input);};
  f.repository.pendingCandidates=async()=>[{id:randomUUID(),actor_id:bad,access_version:1,kind:'ITEM'},{id:f.item.id,actor_id:f.item.actor_id,access_version:1,kind:'ITEM'}];
  assert.equal(await f.service.runPending(),1);assert.equal(f.saved.length,1);
});

test('equal approved grades select configured Sports gold and Pokemon holo independently',async()=>{
  const sports=await fixture(),pokemon=await fixture({cardProfile:'POKEMON'});
  assert.equal(await sports.service.runPending(),1);assert.equal(await pokemon.service.runPending(),1);
  assert.equal(sports.saved[0].snapshot.grade,pokemon.saved[0].snapshot.grade);
  assert.equal(sports.saved[0].materialProfileId,'atlas-v4-gold-v1');assert.equal(sports.saved[0].snapshot.previewMaterial,'gold');
  assert.equal(pokemon.saved[0].materialProfileId,'atlas-v4-holo-v1');assert.equal(pokemon.saved[0].snapshot.previewMaterial,'holo');
});

test('queued current-profile sheet export reaches the real renderer and saves that same profile',async()=>{
  const f=await fixture();assert.equal(await f.service.runPending(),1);
  const artwork=f.saved[0],sheetId=randomUUID(),exportId=randomUUID();let queued=null,finished=null,failures=0,writes=0;
  f.repository.prepareExport=async(_staff,{kind,id,input})=>{
    assert.equal(kind,'SHEET');assert.equal(id,sheetId);assert.equal(input.exportProfileId,LABEL_EXPORT_PROFILE_V1.id);
    queued={id:exportId,kind,profile_id:input.exportProfileId,manifest_hash:digest('manifest'),sheet_id:sheetId,state:'QUEUED'};
    return{exportId,sheetId,state:'QUEUED'};
  };
  f.repository.pendingCandidates=async()=>queued&&!finished?[{id:exportId,actor_id:f.item.actor_id,access_version:1,kind:'EXPORT'}]:[];
  f.repository.claimExport=async()=>({row:queued,items:[{slot:1,print_svg:artwork.printSvg,artwork_hash:artwork.artworkHash}]});
  f.repository.export=async()=>({row:queued});
  f.repository.finishExport=async(_staff,_claim,result)=>{finished=result;};
  f.repository.failExport=async()=>{failures++;};
  f.storage.write=async(binding,bytes,{sha256,contentType})=>{
    writes++;assert.equal(binding.exportId,exportId);assert.equal(digest(bytes),sha256);assert.equal(contentType,'image/png');
    return{sha256,byteCount:bytes.length};
  };
  assert.equal(LABEL_EXPORT_PROFILES.SHEET,'atlas-v4-sheet-800ppi-diagnostic-v2');
  await f.service.prepareSheetExport({},sheetId,{requestId:randomUUID(),expectedSheetRevision:1,exportProfileId:LABEL_EXPORT_PROFILES.SHEET});
  assert.equal(await f.service.runPending(),1);assert.equal(failures,0);assert.equal(writes,1);
  assert.equal(finished.mapping.exportProfileId,queued.profile_id);
  assert.equal(finished.mapping.renderProfileHash,LABEL_EXPORT_PROFILE_V1.hash);
  assert.equal(finished.mapping.rasterReceipt.rasterizer,LABEL_EXPORT_PROFILE_V1.rasterizer);
  assert.equal(await f.service.runPending(),0);
  assert.throws(()=>f.service.prepareSheetExport({},sheetId,{requestId:randomUUID(),expectedSheetRevision:1,exportProfileId:'atlas-v4-sheet-800ppi-diagnostic-v1'}),{code:'LABEL_PROFILE_INVALID'});
});


test('layout retry accepts only exact failure/profile intent and binds authoritative material',async()=>{
  const f=await fixture({cardProfile:'POKEMON'}),input={requestId:randomUUID(),expectedFailureHash:digest('failure'),expectedRendererProfileHash:digest('profile')};
  f.repository.item=async()=>f.item;let captured;
  f.repository.retryLayout=async(...args)=>{captured=args;return{state:'PENDING_RENDER'};};
  await f.service.retryLayout({},f.item.id,input);assert.deepEqual(captured[2],input);assert.equal(captured[3].materialProfileId,'atlas-v4-holo-v1');assert.match(captured[3].rendererProfileHash,/^[a-f0-9]{64}$/);
  for(const extra of [{grade:10},{materialProfileId:'gold'},{printSvg:'<svg/>'},{reason:'change'}])
    await assert.rejects(f.service.retryLayout({},f.item.id,{...input,...extra}),{code:'LABEL_REQUEST_INVALID'});
});

test('a layout generation renders its same approved packet without copying failed artwork',async()=>{
  const f=await fixture();f.item.purpose='LAYOUT_RETRY';f.item.original_item_id=randomUUID();
  f.repository.item=()=>assert.fail('Layout retry must render exact approved report, not copy failed artwork');
  assert.equal(await f.service.runPending(),1);assert.deepEqual(f.saved[0].snapshot.identity,f.f.full.identity);assert.equal(f.saved[0].snapshot.grade,f.f.full.finalGrade);
});
