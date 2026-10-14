import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {researchFixture} from './research-fixture.mjs';
import {createPresentationMarketService} from '../src/presentation-market-service.mjs';

test('actual research core, acknowledged providers and current market selection preserve report and cross-grader facts',async()=>{
 const f=await researchFixture(),before=JSON.stringify(f.source.packet),input=f.command();
 const result=await f.service.preview(f.staff,f.cardId,input);
 assert.equal(result.state,'READY');assert.equal(result.preview.candidates.length,1);
 assert.equal(result.preview.candidates[0].sale.grade,'9');assert.equal(result.preview.atlasGrade,f.source.packet.report.finalGrade);
 assert(!result.preview.query.includes('PSA'));assert.equal(result.research.candidates[0].conditionDecision.classification,'rejected');
 assert.equal(result.research.candidates[0].identityMatch,true);assert.equal(result.research.candidates[0].imageCompared,true);
 assert.equal('catalog' in result.research,false);assert.equal('knowledge' in result.research,false);assert.equal('estimate' in result.research,false);
 const source=f.calls.find(c=>c.url.startsWith('https://api.sold-comps.com/'));assert.equal(new URL(source.url).searchParams.get('keyword'),'2026 Fixture Local only Synthetic report');assert.equal(new URL(source.url).searchParams.get('count'),'40');assert.equal(new URL(source.url).searchParams.get('hydrateBoa'),'false');
 assert(f.calls.every(c=>c.redirect==='error'));const count=f.calls.length;
 assert.deepEqual(await f.create().preview(f.staff,f.cardId,input),result);assert.equal(f.calls.length,count);
 const market=createPresentationMarketService({repository:f.repo,approved:f.approved,artifacts:f.artifacts});
 const selected=await market.select(f.staff,f.cardId,{requestId:randomUUID(),approvalActionId:f.actionId,expectedRevision:0,previewId:input.requestId,selectedIds:['ebay:111111111110']});
 assert.equal(selected.presentation.market.sales[0].priceMinor,1875);assert.equal(selected.presentation.market.sales[0].grade,'9');assert.equal(JSON.stringify(f.source.packet),before);
 assert.equal(f.events.get(input.requestId).filter(r=>r.event==='DISPATCH').length,f.calls.length);
});

test('unknown sold dispatch is fenced across process recreation and changed request binding',async()=>{
 const f=await researchFixture();f.failSource=true;const input=f.command();
 assert.equal((await f.service.preview(f.staff,f.cardId,input)).state,'UNKNOWN');assert.equal(f.calls.length,1);
 f.failSource=false;assert.equal((await f.create().preview(f.staff,f.cardId,input)).state,'UNKNOWN');assert.equal(f.calls.length,1);
 await assert.rejects(f.service.preview(f.staff,f.cardId,{...input,expectedRevision:1}),{code:'PRESENTATION_REQUEST_CONFLICT'});
});

test('a retained source plus unknown model remains useful evidence without a second dispatch or invented comparison',async()=>{
 const f=await researchFixture();f.failModel=true;const input=f.command(),result=await f.service.preview(f.staff,f.cardId,input);
 assert.equal(result.state,'READY');assert.equal(result.research.effectsUnknown,1);assert.equal(result.research.candidates[0].imageCompared,false);
 assert.equal(result.research.candidates[0].identityMatch,null);const count=f.calls.length;
 await f.create().preview(f.staff,f.cardId,input);assert.equal(f.calls.length,count);
});

test('durable completion recovers a lost final result write without any provider repeat',async()=>{
 const f=await researchFixture();f.loseFinish();const input=f.command();
 assert.equal((await f.service.preview(f.staff,f.cardId,input)).state,'UNKNOWN');const count=f.calls.length;
 assert.equal((await f.create().preview(f.staff,f.cardId,input)).state,'READY');assert.equal(f.calls.length,count);
});

test('atomic reservation initialization rolls back without effects and basic research request kinds stay distinct',async()=>{
 const f=await researchFixture(),input=f.command();f.loseInit();await assert.rejects(f.service.preview(f.staff,f.cardId,input));assert.equal(f.calls.length,0);
 assert.equal(f.searches.has(input.requestId),false);assert.equal((await f.create().preview(f.staff,f.cardId,input)).state,'READY');const count=f.calls.length;
 const basic=f.command();await f.repository.reserveMarket(f.staff,f.cardId,basic);
 await assert.rejects(f.service.preview(f.staff,f.cardId,basic),{code:'RESEARCH_REQUEST_KIND_CONFLICT'});assert.equal(f.calls.length,count);
});

test('foreign staff and superseded report cannot replay private research or buy effects',async()=>{
 const f=await researchFixture(),input=f.command();await f.service.preview(f.staff,f.cardId,input);const count=f.calls.length;
 await assert.rejects(f.service.preview({},f.cardId,input));
 f.row.action_id=randomUUID();await assert.rejects(f.service.preview(f.staff,f.cardId,input),{code:'PRESENTATION_APPROVAL_STALE'});assert.equal(f.calls.length,count);
});

test('independent research has no contribution capability or catalog transport, even with retired config supplied',async()=>{
 const f=await researchFixture();f.config.catalogToken='T'.repeat(43);const service=f.create(),input=f.command();
 const result=await service.preview(f.staff,f.cardId,input);assert.equal(result.state,'READY');assert.equal(service.contribute,undefined);
 assert(f.calls.length>0);assert(f.calls.every(c=>['api.sold-comps.com','api.openai.com','i.ebayimg.com'].includes(new URL(c.url).hostname)));
 const sends=f.calls.length;assert.deepEqual(await f.create().preview(f.staff,f.cardId,input),result);assert.equal(f.calls.length,sends);
});
