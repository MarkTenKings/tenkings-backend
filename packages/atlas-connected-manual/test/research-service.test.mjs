import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {researchFixture} from './research-fixture.mjs';
import {createPresentationMarketService} from '../src/presentation-market-service.mjs';

test('actual research core, acknowledged providers and current market selection preserve report and cross-grader facts',async()=>{
 const f=await researchFixture(),before=JSON.stringify(f.source.packet),input=f.command();
 const result=await f.service.preview(f.staff,f.cardId,input);
 assert.equal(result.state,'READY');assert.equal(result.preview.candidates.length,1);
 assert.equal(result.preview.candidates[0].sale.grade,'9');assert.equal(result.preview.atlasGrade,10);
 assert(!result.preview.query.includes('PSA'));assert.equal(result.research.candidates[0].conditionDecision.classification,'rejected');
 assert.equal(result.research.candidates[0].identityMatch,true);assert.equal(result.research.candidates[0].imageCompared,true);
 assert.equal(result.research.catalog.status,'not_configured');assert.equal('estimate' in result.research,false);
 const source=f.calls.find(c=>c.url.startsWith('https://api.sold-comps.com/'));assert.equal(new URL(source.url).searchParams.get('count'),'40');assert.equal(new URL(source.url).searchParams.get('hydrateBoa'),'false');
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

test('catalog absence is truthful; explicit metadata proposal shares advisory learning but no images, keys or human review',async()=>{
 const f=await researchFixture({catalog:true}),input=f.command(),result=await f.service.preview(f.staff,f.cardId,input);
 assert.equal(result.state,'READY');assert.equal(result.research.catalog.status,'no_publication');assert.equal(result.research.knowledge.canContribute,true);
 const command={previewId:input.requestId,observationId:randomUUID()},sent=await f.service.contribute(f.staff,f.cardId,command);
 assert.equal(sent.disposition,'requires_authorized_review');assert.equal(f.proposals.length,1);
 const proposal=f.proposals[0].proposal;assert.equal(proposal.images.length,0);assert.equal(proposal.basedOnPublication,null);assert.equal(proposal.sources.at(-1).kind,'DERIVED');
 assert(proposal.note.includes('Unreviewed machine'));assert(!JSON.stringify(proposal).includes(f.cardId));assert(!JSON.stringify(proposal).includes('private/'));
 const replay=await f.create().contribute(f.staff,f.cardId,command);assert.deepEqual(replay,sent);assert.equal(f.proposals.length,1);
});

test('explicit lost contribution receipt reconciliation repeats only the host-idempotent proposal and never claims publication',async()=>{
 const f=await researchFixture({catalog:true}),input=f.command();await f.service.preview(f.staff,f.cardId,input);f.loseProposal=true;
 const command={previewId:input.requestId,observationId:randomUUID()};await assert.rejects(f.service.contribute(f.staff,f.cardId,command));assert.equal(f.proposals.length,1);
 f.loseProposal=false;const recovered=await f.create().contribute(f.staff,f.cardId,command);assert.equal(recovered.disposition,'requires_authorized_review');assert.equal(f.proposals.length,2);assert.deepEqual(f.proposals[1],f.proposals[0]);assert.equal(f.events.get(command.observationId).filter(e=>e.event==='DISPATCH').length,1);
});

test('proposal initialization rollback and lost receipt recover with the same intent after unrelated presentation edits',async()=>{
 const f=await researchFixture({catalog:true}),input=f.command();await f.service.preview(f.staff,f.cardId,input);
 const command={previewId:input.requestId,observationId:randomUUID()};f.loseInit();await assert.rejects(f.service.contribute(f.staff,f.cardId,command));assert.equal(f.searches.has(command.observationId),false);assert.equal(f.proposals.length,0);
 f.loseProposal=true;await assert.rejects(f.service.contribute(f.staff,f.cardId,command));
 await f.repo.commit(f.staff,f.cardId,f.command());f.loseProposal=false;
 const replay=await f.create().contribute(f.staff,f.cardId,command);assert.equal(replay.disposition,'requires_authorized_review');assert.equal(f.proposals.length,2);assert.deepEqual(f.proposals[0],f.proposals[1]);
});

test('explicit proposal reconciliation retains an acknowledged unavailable host reply and recovers only that exact idempotent payload',async()=>{
 const f=await researchFixture({catalog:true}),input=f.command();await f.service.preview(f.staff,f.cardId,input);const command={previewId:input.requestId,observationId:randomUUID()};
 f.proposalUnavailable=true;await assert.rejects(f.service.contribute(f.staff,f.cardId,command),{code:'RESEARCH_CATALOG_UNAVAILABLE'});
 f.proposalUnavailable=false;const recovered=await f.create().contribute(f.staff,f.cardId,command);assert.equal(recovered.state,'RECORDED');
 assert.deepEqual(f.proposals[0],f.proposals[1]);const events=f.events.get(command.observationId);assert.equal(events.filter(e=>e.event==='DISPATCH').length,2);assert.equal(events.filter(e=>e.event==='RESPONSE').length,2);
 const count=f.calls.length;await f.create().contribute(f.staff,f.cardId,command);assert.equal(f.calls.length,count);
});
