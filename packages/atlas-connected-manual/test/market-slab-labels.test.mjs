import test from 'node:test';import assert from 'node:assert/strict';
import {digest} from '@atlas/manual-service/contract';
import {EBAY_SOLD_COMPS_V2_ENGINE_VERSION} from '@tenkings/ebay-sold-comps-v2';
import {createPresentationMarket,publishedMarketQuery} from '../src/presentation-market.mjs';
import {createMarketSlabLabeler,MARKET_SLAB_POLICY} from '../src/market-slab-labels.mjs';
import {readSavedListingPhoto} from '../src/variant-listing-provider.mjs';
import {publicationFixture} from './publication-fixture.mjs';
import {labelCatalog,labelPhoto} from './variant-label-fixture.mjs';
import {CODEX_LABEL_POLICY,CODEX_LABEL_MODEL,codexReadingKey,variantCodexChoice} from '../src/variant-codex.mjs';
async function fixture({photos=2,failSend=false,failPublication=false,priorReference=false,priorReferenceGrade,modelGate=null,onModel=()=>{},company='TAG',literal='2020 POKEMON\nMAGIKARP\n8.5',badPhoto=false,loseResponseAcknowledgement=false,responseMode=null,failBatches=[],unreadGrade=false,failImage=false}={}){
 const f=await publicationFixture();await f.publication.publish({},f.cardId,f.actionId);const manifest=JSON.parse(f.row.manifest),packet=await f.artifacts.read(manifest.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:manifest.packet.sourceHash});
 packet.report.cardProfile='POKEMON';packet.report.identity={cardName:'Magikarp',year:'2020',productSet:'Rebel Clash',cardNumber:'039/192',parallel:'Base'};
 packet.report.finalGrade=8.5;packet.report.grade.overall={rawGrade:8.5,displayGrade:8.5};
 const source={packet,publicHash:digest(JSON.stringify(packet))},catalog=labelCatalog(),rows=new Map(),calls={images:0,model:0},requests=[];let tail=Promise.resolve(),drop=failPublication,loseAck=loseResponseAcknowledgement;
 const tx={async $queryRawUnsafe(sql,key){if(sql.includes('SELECT v.decision')){assert(sql.includes("{card,draft,source,sourceHash}"));assert(sql.includes("{receipt,approval,sourceHash}"));return [{approved_identity:packet.report.identity,identity_hash:digest(JSON.stringify(packet.report.identity,Object.keys(packet.report.identity).sort())),decision:'SELECTED',candidate_id:catalog.candidates[0].candidateId,catalog:JSON.stringify(catalog),catalog_hash:catalog.snapshotHash}];}
  if(sql.includes('SELECT request_id'))return failSend?[]:[{request_id:'running'}];
  if(sql.includes('variant_catalog_cache')){const values=rows.get(key)??[];return (sql.includes('DESC')?[...values].reverse():values).slice(0,sql.includes('LIMIT 1')?1:2);}assert.fail(sql);},
  async $executeRawUnsafe(sql,...args){if(sql.includes('pg_advisory'))return 1;if(sql.includes('INSERT INTO')){const [key,snapshot,snapshot_hash]=args;
   if(drop&&key.startsWith('atlas-codex-market-reading:')&&!key.endsWith(':reservation')){drop=false;throw Error('simulated post-response publication interruption');}
   const list=rows.get(key)??[];list.push({snapshot,snapshot_hash});rows.set(key,list);if(loseAck&&key.endsWith(':response')){loseAck=false;throw Error('response acknowledgement lost');}return 1;}assert.fail(sql);}};
 const boundary={machineTransaction(_scope,fn){const next=tail.then(()=>fn({tx}));tail=next.catch(()=>{});return next;}};
 const imageUrl=i=>`https://i.ebayimg.com/images/g/market${i}/s-l1600.jpg`;
 if(priorReference){const image=labelPhoto(0).media,key=codexReadingKey({policy:CODEX_LABEL_POLICY,model:CODEX_LABEL_MODEL},image.sha256),value={schemaVersion:'atlas-codex-reading/v1',policy:CODEX_LABEL_POLICY,reading:{sha256:image.sha256,candidateKey:variantCodexChoice(catalog.candidates[0]).key,gradingCompany:'PSA',labelText:'2020 POKEMON\nMAGIKARP\nAUTOGRAPH GEM MT 10\nMINT 9',...(priorReferenceGrade===undefined?{}:{numericGrade:priorReferenceGrade}),reason:'Matching base label'},responseHash:digest('prior response'),requestKey:'prior'};const snapshot=JSON.stringify(value);rows.set(key,[{snapshot,snapshot_hash:digest(snapshot)}]);}
 const fetchImpl=async(url,options)=>{if(url.startsWith('https://i.ebayimg.com/')){calls.images++;assert.equal(options.redirect,'error');if(failImage)throw Error('Image transport unavailable');const i=Number(/market(\d+)/.exec(url)[1]);return new Response(labelPhoto(i).media.bytes,{headers:{'content-type':'image/png'}});}
  assert.equal(url,'https://api.openai.com/v1/responses');calls.model++;requests.push(JSON.parse(options.body));onModel();if(modelGate)await modelGate;if(failSend||failBatches.includes(calls.model))throw Error('unknown network outcome');
  if(responseMode==='http')return Response.json({error:'synthetic rejected request'},{status:503});
  if(responseMode==='json')return new Response('malformed response');
  if(responseMode==='incomplete')return Response.json({model:'gpt-6-astra',status:'incomplete',incomplete_details:{reason:'max_output_tokens'}});
  if(responseMode==='null')return Response.json(null);
  const body=JSON.parse(options.body);assert.doesNotMatch(options.body,/private submitted/);assert.match(body.input[0].content,/Any grading company/);assert.match(body.input[0].content,/C\. Holo/);
  const shas=body.text.format.schema.properties.readings.items.properties.sha256.enum;
  return Response.json({model:'gpt-6-astra',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({readings:shas.map((sha256,index)=>({sha256,gradingCompany:company,numericGrade:badPhoto&&index===0?'invalid':unreadGrade?null:8.5,labelText:literal,identityMatch:'MATCH',reason:'The visible card and abbreviated label are compatible.'}))})}]}]});};
 const label=createMarketSlabLabeler({boundary,apiKey:'synthetic-only-api-key',fetchImpl,inspectImage:async()=>({mimeType:'image/png',width:1,height:1})});
 const response={responsePolicy:'ATLAS_SLAB_V1',source:'EBAY_SOLD',engineVersion:EBAY_SOLD_COMPS_V2_ENGINE_VERSION,query:publishedMarketQuery(source).query,retrievedAt:'2026-10-11T01:00:00.000Z',marketQueryContext:null,acquisitionDiagnostics:{returnedItemCount:photos,retainedItemCount:photos,missingImageCount:0},items:Array.from({length:photos},(_,i)=>({id:`atlas-sale:${i}`,sourceIndex:i,title:null,listingUrl:null,providerItemId:null,imageUrl:imageUrl(i),soldDate:'2026-10-10',reportedPrice:null,soldPriceCents:null,currency:null,priceBasis:'UNKNOWN'}))};
 const job={card_id:f.cardId,source_hash:'approved draft content hash',approval_action_id:f.actionId,request_id:f.actionId,claim_id:f.cardId};
 return {label,source,response,job,rows,calls,requests};
}
test('every returned sale gets a photo reading; any company/fractional grade/newlines and unknown sale facts survive; next physical copy reuses all bytes and labels',async()=>{
 const f=await fixture({photos:10}),before=JSON.stringify(f.response),out=await f.label(f);assert.equal(out.imageMatch.policy,MARKET_SLAB_POLICY);
 assert.equal(out.imageMatch.readings.length,10);assert.equal(f.calls.model,2);assert.equal(f.calls.images,10);assert.deepEqual(f.requests.map(r=>r.text.format.schema.properties.readings.items.properties.sha256.enum.length),[8,2]);
 assert(out.imageMatch.readings.every(r=>r.gradingCompany==='TAG'&&r.numericGrade===8.5&&r.labelText.includes('\n')&&r.canonicalPrintingKey));assert.equal(JSON.stringify(f.response),before);assert.deepEqual(out.marketQueryContext,f.response.marketQueryContext);
 const repeated=await f.label({...f,job:{...f.job,card_id:'different physical copy'}});assert.deepEqual(repeated,out);assert.deepEqual(f.calls,{images:10,model:2});
 const codex=[...f.rows.entries()].filter(([k])=>k.startsWith('atlas-codex-market-reading:')&&!k.endsWith(':reservation')).map(([,v])=>JSON.parse(v[0].snapshot));
 assert.equal(codex.length,10);assert(codex.every(r=>r.image.url&&r.image.sha256===r.reading.sha256&&r.target.canonicalPrintingKey));
});
test('saved model response recovers after interrupted projection/publication without another call',async()=>{
 const f=await fixture({failPublication:true});await assert.rejects(f.label(f),/publication interruption/);assert.equal(f.calls.model,1);
 const saved=[...f.rows.entries()].find(([k])=>k.endsWith(':response'))[1][0].snapshot;
 const out=await f.label(f);assert.equal(out.imageMatch.counts.matched,2);assert.equal(f.calls.model,1);assert.equal([...f.rows.entries()].find(([k])=>k.endsWith(':response'))[1][0].snapshot,saved);
});
test('unknown label dispatch never repeats on another physical copy; rows remain explicitly uncertain',async()=>{
 const f=await fixture({failSend:true}),first=await f.label(f),again=await f.label({...f,job:{...f.job,card_id:'another'}});
 assert.equal(f.calls.model,1);assert.equal(first.imageMatch.counts.uncertain,2);assert.deepEqual(again,first);assert(first.imageMatch.readings.every(r=>r.numericGrade===null&&r.reason.includes('not be charged again')));
 assert.equal(first.imageMatch.counts.unknown,2);assert.equal([...f.rows.keys()].filter(key=>key.endsWith(':failure')).length,1);
 assert.throws(()=>createPresentationMarket().project(f.source,first),{code:'MARKET_LABEL_OUTCOME_UNKNOWN'});
});
test('previous canonical reference with an explicitly read overall grade is reused without a model call',async()=>{
 const f=await fixture({photos:1,priorReference:true,priorReferenceGrade:9});const out=await f.label(f);assert.equal(f.calls.model,0);assert.equal(out.imageMatch.readings[0].numericGrade,9);assert.equal(out.imageMatch.readings[0].gradingCompany,'PSA');
});
test('legacy literal autograph/card grade text is read once rather than inferred as the overall grade',async()=>{
 const f=await fixture({photos:1,priorReference:true}),out=await f.label(f);assert.equal(f.calls.model,1);assert.equal(out.imageMatch.readings[0].numericGrade,8.5);
 assert.deepEqual(await f.label(f),out);assert.equal(f.calls.model,1);
});
test('missing photos and duplicate rows remain visible while identical photo bytes cost one reading',async()=>{
 const f=await fixture({photos:1});f.response.items.push({...f.response.items[0],id:'atlas-sale:1',sourceIndex:1});f.response.items.push({...f.response.items[0],id:'atlas-sale:2',sourceIndex:2,imageUrl:null});
 const out=await f.label(f);assert.equal(out.imageMatch.readings.length,3);assert.equal(f.calls.model,1);assert.equal(f.calls.images,1);assert.equal(f.requests[0].text.format.schema.properties.readings.items.properties.sha256.enum.length,1);assert.equal(out.imageMatch.readings[2].identityMatch,'UNCERTAIN');
});

test('saved market photo serving verifies exact retained bytes and cannot fetch or refresh',async()=>{
 const f=await fixture({photos:1}),out=await f.label(f),reading=out.imageMatch.readings[0];
 const cache={getRetained:async key=>{const row=f.rows.get(key)?.at(-1);return row?JSON.parse(row.snapshot):null;},put:()=>assert.fail('read only')};
 const photo=await readSavedListingPhoto(reading.imageUrl,reading.sha256,{cache});assert.equal(photo.sha256,reading.sha256);assert(photo.bytes.equals(labelPhoto(0).media.bytes));
 await assert.rejects(readSavedListingPhoto(reading.imageUrl,'f'.repeat(64),{cache}));assert.deepEqual(f.calls,{images:1,model:1});
});

test('unread company and literal outer whitespace are preserved; malformed per-photo data keeps valid peers without repeat billing',async()=>{
 const f=await fixture({company:null,literal:'\n  C. HOLO\n8.5 \n',badPhoto:true}),out=await f.label(f);
 const invalid=out.imageMatch.readings.find(r=>r.numericGrade===null),valid=out.imageMatch.readings.find(r=>r.numericGrade===8.5);assert.equal(invalid.identityMatch,'UNCERTAIN');
 assert.equal(valid.gradingCompany,null);assert.equal(valid.labelText,'\n  C. HOLO\n8.5 \n');
 assert.deepEqual(await f.label(f),out);assert.equal(f.calls.model,1);
 const preview=createPresentationMarket().project(f.source,out).preview;assert.equal(preview.candidates.length,1);assert.deepEqual(preview.labelProcessing,{state:'PARTIAL',completed:1,failed:1,unknown:0,unavailable:0,reasons:['MARKET_LABEL_READING_INVALID']});
});
test('concurrent overlapping physical jobs wait for a live owner then reuse the same paid response',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const f=await fixture({modelGate:gate,onModel:entered});
 const first=f.label(f);await started;await assert.rejects(f.label({...f,job:{...f.job,request_id:'another'}}),{code:'MARKET_LABEL_PENDING'});release();const result=await first;
 assert.deepEqual(await f.label(f),result);assert.equal(f.calls.model,1);
});
test('lost saved-response acknowledgement recovers the retained response without another dispatch',async()=>{
 const f=await fixture({loseResponseAcknowledgement:true});await assert.rejects(f.label(f),/acknowledgement lost/);assert.equal(f.calls.model,1);
 assert.equal((await f.label(f)).imageMatch.counts.matched,2);assert.equal(f.calls.model,1);
});

test('cross-batch recovery publishes previously paid shared images and still reads new sibling photos',async()=>{
 const f=await fixture({failPublication:true,photos:3}),firstPool={...f.response,items:f.response.items.slice(0,2)};
 await assert.rejects(f.label({...f,response:firstPool}),/publication interruption/);assert.equal(f.calls.model,1);
 const nextPool={...f.response,items:f.response.items.slice(1)},out=await f.label({...f,response:nextPool});
 assert.equal(out.imageMatch.counts.matched,2);assert.equal(f.calls.model,2);
 assert.deepEqual(f.requests.map(r=>r.text.format.schema.properties.readings.items.properties.sha256.enum.length),[2,1]);
 assert.deepEqual(await f.label({...f,response:nextPool}),out);assert.equal(f.calls.model,2);
});


test('HTTP refusal, malformed JSON and incomplete model bodies remain durable failed outcomes with no repeated charge',async()=>{
 for(const [responseMode,code] of [['http','MARKET_LABEL_RESPONSE_REJECTED'],['json','MARKET_LABEL_RESPONSE_INVALID'],['incomplete','MARKET_LABEL_RESPONSE_INCOMPLETE'],['null','MARKET_LABEL_RESPONSE_INCOMPLETE']]){
  const f=await fixture({responseMode}),out=await f.label(f);
  assert.equal(out.imageMatch.counts.failed,2);assert.equal(out.imageMatch.counts.completed,0);
  assert.throws(()=>createPresentationMarket().project(f.source,out),{code});
  const receipt=[...f.rows.entries()].find(([key])=>key.endsWith(':response'))[1][0].snapshot;
  assert.deepEqual(await f.label(f),out);assert.equal(f.calls.model,1);
  assert.equal([...f.rows.entries()].find(([key])=>key.endsWith(':response'))[1][0].snapshot,receipt);
 }
});
test('a failed batch retains successful sibling batches as selectable partial evidence',async()=>{
 const f=await fixture({photos:10,failBatches:[1]}),out=await f.label(f),preview=createPresentationMarket().project(f.source,out).preview;
 assert.equal(preview.candidates.length,2);assert.deepEqual(preview.labelProcessing,{state:'PARTIAL',completed:2,failed:0,unknown:8,unavailable:0,reasons:['MARKET_LABEL_OUTCOME_UNKNOWN']});
 assert.deepEqual(await f.label(f),out);assert.equal(f.calls.model,2);assert.equal(f.calls.images,10);
});
test('successfully read but unreadable grades are honest complete zero-result previews',async()=>{
 const f=await fixture({unreadGrade:true}),out=await f.label(f),preview=createPresentationMarket().project(f.source,out).preview;
 assert.equal(preview.candidates.length,0);assert.equal(preview.counts.unreadGrade,2);assert.equal(preview.labelProcessing.state,'COMPLETE');assert.equal(preview.labelProcessing.completed,2);
 assert.deepEqual(await f.label(f),out);assert.equal(f.calls.model,1);
});
test('unavailable photograph failures cannot be reported as a successful empty label search',async()=>{
 const f=await fixture({failImage:true}),out=await f.label(f);
 assert.equal(f.calls.model,0);assert.equal(out.imageMatch.counts.failed,2);
 assert.throws(()=>createPresentationMarket().project(f.source,out),{code:'MARKET_PHOTO_UNAVAILABLE'});
});
