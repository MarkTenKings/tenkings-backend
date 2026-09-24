import test from 'node:test';
import assert from 'node:assert/strict';
import {researchFixture} from './research-fixture.mjs';
import {createResearchEffects} from '../src/research-effects.mjs';
const url='https://api.sold-comps.com/v1/scrape?keyword=synthetic';
async function harness(){const f=await researchFixture(),input=f.command();await f.repo.reserveMarket(f.staff,f.cardId,input,tx=>f.journal.initializeInTransaction(tx,f.cardId,input.requestId,{kind:'RESEARCH'}));return {f,input,create:fetchImpl=>createResearchEffects({journal:f.journal,artifacts:f.artifacts,staff:f.staff,cardId:f.cardId,requestId:input.requestId,sourceHash:f.source.publicHash,fetchImpl})};}
test('response arriving after caller abort is durably retained and recovered without repeating the network effect',async()=>{
 const {f,input,create}=await harness();let release,entered;const ready=new Promise(r=>{entered=r;});let calls=0;
 const fetchImpl=async()=>{calls++;entered();await new Promise(r=>{release=r;});return Response.json({owned:'late response'},{headers:{'x-request-id':'owned-provider-request','set-cookie':'must-not-be-retained'}});};
 const controller=new AbortController(),pending=create(fetchImpl)(url,{signal:controller.signal});await ready;controller.abort();release();await assert.rejects(pending);
 const replay=await create(fetchImpl)(url);assert.deepEqual(await replay.json(),{owned:'late response'});assert.equal(calls,1);assert.equal(replay.headers.get('set-cookie'),null);
 assert.equal(f.events.get(input.requestId).filter(e=>e.event==='DISPATCH').length,1);assert(f.events.get(input.requestId).some(e=>e.event==='RESPONSE'));
});
test('an unobserved HTTP response does not cancel a running research operation; retry observes pending then saved result',async()=>{
 const f=await researchFixture(),original=f.config.fetchImpl;let release,entered;const ready=new Promise(r=>{entered=r;});
 f.config.fetchImpl=async(url,init)=>{if(url.startsWith('https://api.sold-comps.com/')){entered();await new Promise(r=>{release=r;});}return original(url,init);};
 const service=f.create(),input=f.command(),unobserved=service.preview(f.staff,f.cardId,input);await ready;
 assert.equal((await service.preview(f.staff,f.cardId,input)).state,'PENDING');release();const result=await unobserved;assert.equal(result.state,'READY');
 const count=f.calls.length;assert.deepEqual(await f.create().preview(f.staff,f.cardId,input),result);assert.equal(f.calls.length,count);
});
test('large model requests retain their exact bytes without weakening small public-envelope limits',async()=>{
 const {f,input,create}=await harness(),body=JSON.stringify({model:'fixture',input:'x'.repeat(16000)});let calls=0;
 const effect=create(async(_url,init)=>{calls++;assert.equal(init.body,body);return Response.json({usage:{total_tokens:4},output:[]});});
 await effect('https://api.openai.com/v1/responses',{method:'POST',body});await effect('https://api.openai.com/v1/responses',{method:'POST',body});assert.equal(calls,1);
 const receipt=f.events.get(input.requestId).find(e=>e.event==='RESPONSE'),saved=await f.artifacts.read(receipt.evidence.ref,{cardId:f.cardId,kind:'RESEARCH_RESPONSE',sourceHash:f.source.publicHash});assert.equal(saved.usage.total_tokens,4);
});

test('concurrent original and explicit proposal reconciliation preserve the first durable receipt despite recorded/replay response differences',async()=>{
 const {f,input}=await harness();let release,entered,calls=0;const ready=new Promise(r=>{entered=r;});
 const fetchImpl=async()=>{calls++;if(calls===1){entered();await new Promise(r=>{release=r;});return Response.json({receipt:{outcome:'recorded'}});}return Response.json({receipt:{outcome:'replay'}});};
 const opts={journal:f.journal,artifacts:f.artifacts,staff:f.staff,cardId:f.cardId,requestId:input.requestId,sourceHash:f.source.publicHash,fetchImpl};
 const endpoint='https://collect.tenkings.co/api/internal/card-catalog/v1/proposals',request={method:'POST',body:'{"proposal":"same exact synthetic intent"}'};
 const first=createResearchEffects(opts)(endpoint,request);await ready;
 const retried=await createResearchEffects({...opts,reconcileCatalogProposal:true})(endpoint,request);release();const original=await first;
 assert.deepEqual(await retried.json(),{receipt:{outcome:'replay'}});assert.deepEqual(await original.json(),{receipt:{outcome:'replay'}});
 assert.equal(f.events.get(input.requestId).filter(e=>e.event==='RESPONSE').length,1);assert.equal(f.events.get(input.requestId).filter(e=>e.event==='DISPATCH').length,1);
});
