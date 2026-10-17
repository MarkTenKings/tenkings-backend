import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createLabelService, LABEL_EXPORT_PROFILES, LABEL_BLACK_INK_EXPORT_PROFILES } from '../src/label-sheet-service.mjs';
import { createManualFinishing } from '../src/finishing.mjs';
import { publicationFixture } from './publication-fixture.mjs';
import { LABEL_EXPORT_PROFILE_V1, LABEL_BLACK_INK_EXPORT_PROFILE_V1, LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1,
  renderLabelBlackInkSvg, renderLabelBlackInkPreviewSvg } from '@atlas/finishing/label-sheet';
import { LABEL_V4_RENDERER_PROFILE_HASH } from '@atlas/finishing/label-v4';
import { LABEL_JIG_V1 } from '@atlas/finishing/label-sheet-geometry';
import { labelFailureHash } from '../src/label-sheet-repository.mjs';

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

test('downloads report the immutable saved format for legacy and foil requests after reauthorization',async()=>{
  for(const profiles of [LABEL_EXPORT_PROFILES,LABEL_BLACK_INK_EXPORT_PROFILES])for(const kind of ['SINGLE','SHEET']) {
    const exportId=randomUUID(),sourceId=randomUUID(),sha256=digest('saved-png'),row={id:exportId,kind,
      ...(kind==='SINGLE'?{item_id:sourceId}:{sheet_id:sourceId}),profile_id:profiles[kind],state:'READY',sha256,
      manifest_hash:digest('saved-manifest'),byte_count:100,content_type:'image/png',object_ref:'{}'};
    const before=structuredClone(row),target={exportId,...(kind==='SINGLE'?{itemId:sourceId}:{sheetId:sourceId})};let reads=0;
    const service=createLabelService({boundary:{machineOwner(){}},finishing:{loadPacket(){}},repository:{pendingCandidates(){},export:async()=>{reads++;return{row};}},
      storage:{write(){assert.fail('Download never stores again');},download:async(binding,saved)=>{
        assert.deepEqual(binding,{exportId,manifestHash:row.manifest_hash,kind});assert.equal(saved.sha256,sha256);
        return{url:'https://example.invalid/saved',expiresAt:'2026-10-17T00:00:00Z',exportProfileId:'untrusted-storage-value'};
      }}});
    const result=await service.download({},{...target,input:{requestId:randomUUID(),expectedExportSha256:sha256}});
    assert.equal(result.exportProfileId,profiles[kind]);assert.equal(result.url,'https://example.invalid/saved');assert.equal(reads,2);assert.deepEqual(row,before);
  }
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

test('both black-ink exports render the immutable requested profile and save separate PNG bindings',async()=>{
  const f=await fixture({cardProfile:'POKEMON'});assert.equal(await f.service.runPending(),1);
  const artwork=f.saved[0],before=structuredClone(artwork),sheetId=randomUUID(),writes=[];let queued=null,finished=null,failures=0;
  f.repository.prepareExport=async(_staff,{kind,id,input})=>{
    const exportId=randomUUID();queued={id:exportId,kind,profile_id:input.exportProfileId,manifest_hash:digest('same-artwork-manifest'),
      sheet_id:kind==='SHEET'?id:null,item_id:kind==='SINGLE'?id:null,state:'PREPARING'};
    return{exportId,exportProfileId:queued.profile_id,state:'PREPARING'};
  };
  f.repository.pendingCandidates=async()=>queued&&!finished?[{id:queued.id,actor_id:f.item.actor_id,access_version:1,kind:'EXPORT'}]:[];
  f.repository.claimExport=async()=>({row:queued,items:[{slot:1,print_svg:artwork.printSvg,artwork_hash:artwork.artworkHash}]});
  f.repository.export=async()=>({row:queued});
  f.repository.finishExport=async(_staff,_claim,result)=>{finished=result;};
  f.repository.failExport=async()=>{failures++;};
  f.storage.write=async(binding,bytes,{sha256,contentType})=>{
    assert.equal(binding.exportId,queued.id);assert.equal(binding.kind,queued.kind);assert.equal(digest(bytes),sha256);assert.equal(contentType,'image/png');
    writes.push({binding,sha256,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});
    return{object:{key:`fixture/${binding.exportId}/${sha256}.png`},sha256,byteCount:bytes.length};
  };
  for(const kind of ['SINGLE','SHEET']) {
    finished=null;
    const profile=kind==='SINGLE'?LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1:LABEL_BLACK_INK_EXPORT_PROFILE_V1;
    const input={requestId:randomUUID(),exportProfileId:LABEL_BLACK_INK_EXPORT_PROFILES[kind],
      ...(kind==='SINGLE'?{expectedLabelHash:artwork.artworkHash}:{expectedSheetRevision:1})};
    const result=await (kind==='SINGLE'?f.service.prepareIndividualExport({},f.item.id,input):f.service.prepareSheetExport({},sheetId,input));
    assert.equal(result.exportProfileId,profile.id);assert.equal(await f.service.runPending(),1);
    assert.equal(finished.mapping.exportProfileId,profile.id);assert.equal(finished.mapping.renderProfileHash,profile.hash);
    assert.equal(finished.mapping.alphaPolicy,profile.alphaPolicy);
    assert.equal(writes.at(-1).width,profile.pixelWidth);assert.equal(writes.at(-1).height,profile.pixelHeight);
    assert.equal(await f.service.runPending(),0);
  }
  assert.equal(failures,0);assert.equal(writes.length,2);assert.notEqual(writes[0].binding.exportId,writes[1].binding.exportId);
  assert.deepEqual(artwork,before);
  assert.equal(LABEL_EXPORT_PROFILES.SHEET,'atlas-v4-sheet-800ppi-diagnostic-v2');
  assert.equal(LABEL_EXPORT_PROFILES.SINGLE,'atlas-v4-individual-2400ppi-v1');
});

test('export kind allowlists reject cross-kind, unknown and omitted profiles before reservation',async()=>{
  const f=await fixture();f.repository.prepareExport=()=>assert.fail('Invalid profiles cannot reserve or freeze');
  for(const exportProfileId of [LABEL_EXPORT_PROFILES.SHEET,LABEL_BLACK_INK_EXPORT_PROFILES.SHEET,'black',undefined])
    assert.throws(()=>f.service.prepareIndividualExport({},f.item.id,{requestId:randomUUID(),expectedLabelHash:digest('label'),exportProfileId}),{code:'LABEL_PROFILE_INVALID'});
  for(const exportProfileId of [LABEL_EXPORT_PROFILES.SINGLE,LABEL_BLACK_INK_EXPORT_PROFILES.SINGLE,'black',undefined])
    assert.throws(()=>f.service.prepareSheetExport({},randomUUID(),{requestId:randomUUID(),expectedSheetRevision:1,exportProfileId}),{code:'LABEL_PROFILE_INVALID'});
});

test('a renderer returning another profile fails before storage and cannot replace the queued black export',async()=>{
  const id=randomUUID(),row={id,kind:'SINGLE',profile_id:LABEL_BLACK_INK_EXPORT_PROFILES.SINGLE,manifest_hash:digest('manifest')};
  const printSvg='<svg/>',bytes=Buffer.from('wrong profile');let failures=0;
  const repository={pendingCandidates:async()=>[{id,actor_id:randomUUID(),access_version:1,kind:'EXPORT'}],
    claimExport:async()=>({row,items:[{print_svg:printSvg,artwork_hash:digest(printSvg)}]}),failExport:async()=>{failures++;},
    export:()=>assert.fail('Invalid result cannot authorize storage'),finishExport:()=>assert.fail('Cannot finish')};
  const service=createLabelService({repository,boundary:{machineOwner:value=>value},finishing:{loadPacket(){}},
    storage:{write(){assert.fail('Cannot store mismatched format');},download(){}},
    renderer:{label(){},sheet(){},individual:async(_item,options)=>{
      assert.deepEqual(options,{exportProfileId:row.profile_id});return{bytes,sha256:digest(bytes),manifest:{exportProfileId:LABEL_EXPORT_PROFILES.SINGLE}};
    }}});
  assert.equal(await service.runPending(),0);assert.equal(failures,1);
});

test('foil artwork previews derive from verified saved print geometry and the saved material without mutation',async()=>{
  for(const cardProfile of ['SPORTS','POKEMON']) {
    const f=await fixture({cardProfile});await f.service.runPending();const out=f.saved[0];
    const item={...f.item,state:'READY',print_svg:out.printSvg,preview_svg:out.previewSvg,artwork_hash:out.artworkHash,material_profile_id:out.materialProfileId};
    const before=structuredClone(item),artwork={printSvg:out.printSvg,artworkHash:out.artworkHash};
    f.repository.item=async()=>item;
    for(const [mode,expected] of [['print',out.printSvg],['preview',out.previewSvg],['print-foil',renderLabelBlackInkSvg(artwork)],
      ['preview-foil',renderLabelBlackInkPreviewSvg(artwork,{previewMaterial:cardProfile==='SPORTS'?'gold':'holo'})]]) {
      const result=await f.service.artwork({},{itemId:item.id,mode});
      assert.equal(result.bytes.toString(),expected);assert.equal(result.sha256,digest(expected));assert.equal(result.contentType,'image/svg+xml');
    }
    assert.deepEqual(item,before);
    item.material_profile_id='unknown';await assert.rejects(f.service.artwork({},{itemId:item.id,mode:'preview-foil'}),{code:'LABEL_MATERIAL_UNCONFIGURED'});
    item.artwork_hash=digest('tampered');await assert.rejects(f.service.artwork({},{itemId:item.id,mode:'print-foil'}),{code:'LABEL_ARTWORK_INVALID'});
  }
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

test('automatic recovery reserves one deterministic successor from a verified old snapshot before any storage read',async()=>{
  const id=randomUUID(),actor=randomUUID(),snapshot=canonical({cardProfile:'POKEMON',grade:8.5,identity:{cardName:'Sylveon ex'}});
  const item={id,actor_id:actor,access_version:1,card_id:randomUUID(),action_id:randomUUID(),approval_version:1,
    source_revision:1,source_hash:digest('source'),report_hash:digest('report'),public_hash:digest('public'),
    purpose:'ORIGINAL',state:'NEEDS_LAYOUT',snapshot,snapshot_hash:digest(snapshot),code:'METADATA_OVERFLOW',attempts:1,
    renderer_profile_hash:null,material_profile_id:null,jig_hash:null};
  const captured=[],discovery=[],before=structuredClone(item);
  const repository={pendingCandidates:async(...args)=>{discovery.push(args);return[{id,actor_id:actor,access_version:1,kind:'LAYOUT_RECOVERY'}];},
    item:async()=>item,retryLayout:async(...args)=>{captured.push(args);return{state:'PENDING_RENDER'};}};
  const service=createLabelService({repository,boundary:{machineOwner:input=>input},
    finishing:{loadPacket(){assert.fail('Storage is read only by bounded successor rendering');}},
    storage:{write(){assert.fail('No export');},download(){assert.fail('No download');}}});
  assert.equal(await service.runPending(),1);assert.equal(await service.runPending(),1);
  assert.deepEqual(discovery,[[4,{rendererProfileHash:LABEL_V4_RENDERER_PROFILE_HASH}],[4,{rendererProfileHash:LABEL_V4_RENDERER_PROFILE_HASH}]]);
  assert.deepEqual(captured[0],captured[1]);assert.deepEqual(captured[0][2],{
    requestId:captured[0][2].requestId,expectedFailureHash:labelFailureHash(item),expectedRendererProfileHash:LABEL_V4_RENDERER_PROFILE_HASH});
  assert.match(captured[0][2].requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.deepEqual(captured[0][3],{rendererProfileHash:LABEL_V4_RENDERER_PROFILE_HASH,materialProfileId:'atlas-v4-holo-v1',jigHash:LABEL_JIG_V1.jigHash});
  assert.deepEqual(captured[0][4],{automatic:true});assert.deepEqual(item,before);
});

test('automatic recovery requires explicit saved card category and never infers stock from a name',async()=>{
  let writes=0;
  const repository={pendingCandidates:async()=>[{id:randomUUID(),actor_id:randomUUID(),access_version:1,kind:'LAYOUT_RECOVERY'}],
    item:async()=>({snapshot:canonical({identity:{cardName:'Sylveon ex'}})}),retryLayout:async()=>{writes++;}};
  const service=createLabelService({repository,boundary:{machineOwner:input=>input},finishing:{loadPacket(){assert.fail('No storage read');}},storage:{write(){},download(){}}});
  assert.equal(await service.runPending(),0);assert.equal(writes,0);
});

test('failed layout output always records its attempted profile, material and jig even if a renderer omits the hash',async()=>{
  const f=await fixture({cardProfile:'POKEMON'}),finishing=createManualFinishing({repository:f.f.repository,artifacts:f.f.artifacts});
  const service=createLabelService({repository:f.repository,boundary:f.boundary,finishing,storage:f.storage,
    renderer:{label:()=>({state:'NEEDS_LAYOUT',diagnostics:{code:'METADATA_OVERFLOW'}}),sheet(){},individual(){}}});
  assert.equal(await service.runPending(),1);
  const result=f.saved[0];assert.equal(result.state,'NEEDS_LAYOUT');assert.equal(result.rendererProfileHash,LABEL_V4_RENDERER_PROFILE_HASH);
  assert.equal(result.materialProfileId,'atlas-v4-holo-v1');assert.equal(result.jigHash,LABEL_JIG_V1.jigHash);
  assert.equal(result.snapshot.cardProfile,'POKEMON');assert.equal(result.snapshot.grade,f.f.full.finalGrade);
});

test('render exceptions retain the attempted profile while a storage failure never guesses a material',async()=>{
  const f=await fixture({cardProfile:'POKEMON'}),failures=[];
  f.repository.failItem=async(...args)=>failures.push(args);
  const finishing=createManualFinishing({repository:f.f.repository,artifacts:f.f.artifacts});
  const service=createLabelService({repository:f.repository,boundary:f.boundary,finishing,storage:f.storage,
    renderer:{label(){throw new Error('local renderer failure');},sheet(){},individual(){}}});
  assert.equal(await service.runPending(),0);
  assert.deepEqual(failures[0][2],{rendererProfileHash:LABEL_V4_RENDERER_PROFILE_HASH,jigHash:LABEL_JIG_V1.jigHash,materialProfileId:'atlas-v4-holo-v1'});
  const unavailable=createLabelService({repository:f.repository,boundary:f.boundary,finishing:{loadPacket(){throw new Error('storage unavailable');}},storage:f.storage});
  assert.equal(await unavailable.runPending(),0);
  assert.deepEqual(failures[1][2],{rendererProfileHash:LABEL_V4_RENDERER_PROFILE_HASH,jigHash:LABEL_JIG_V1.jigHash,materialProfileId:null});
});
