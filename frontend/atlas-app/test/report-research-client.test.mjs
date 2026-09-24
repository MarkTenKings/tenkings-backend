import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createReportResearchClient} from '../lib/report-research-client.mjs';
import {createReportMarketClient} from '../lib/report-market-client.mjs';
function fixture(){
  const values=new Map(),calls=[],staffId=randomUUID(),cardId=randomUUID(),approvalActionId=randomUUID();
  const f={values,calls,approvalActionId};
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  f.options={staffId,cardId,approvalActionId,storage,cryptoImpl:{randomUUID},request:async(path,options)=>{
    calls.push({path,options});if(!options)return {approvalActionId:f.approvalActionId,revision:0};
    assert.ok(values.size);
    if(path.endsWith('/search')){if(f.search)return f.search(options.body);return {state:'READY',previewId:options.body.requestId,preview:{binding:{approvalVersion:1}},research:{version:'atlas-research-preview-v1'}};}
    if(path.endsWith('/contribute')){if(f.contribute)return f.contribute(options.body);return {state:'RECORDED',disposition:'requires_authorized_review',receipt:{proposalId:'fixture',outcome:'recorded'}};}
    assert.ok(path.endsWith('/market/select'));return {approvalActionId:f.approvalActionId,revision:1,presentation:{market:{sales:options.body.selectedIds.map(id=>({id}))}}};
  }};
  f.client=createReportResearchClient(f.options);return f;
}
test('deep and simple research reserve separate browser intents and share reviewed selection',async()=>{
  const f=fixture();assert.equal(f.calls.length,0);
  const basic=await createReportMarketClient(f.options).preview(),deep=await f.client.preview();assert.notEqual(deep.previewId,basic.previewId);
  assert.equal(f.calls.filter(c=>c.path.endsWith('/research/search')).length,1);
  assert.equal(f.values.size,2);
  await f.client.select({previewId:deep.previewId,selectedIds:['sale:one']});assert.equal(f.values.size,1);
  assert.ok([...f.values.keys()][0].startsWith('atlas-report-market:'));
});
test('unknown research survives reload with the exact request and no provider route fallback',async()=>{
  const f=fixture();f.search=()=>{throw Error('lost');};await assert.rejects(f.client.preview());const first=f.calls.at(-1).options.body;
  f.client=createReportResearchClient(f.options);f.search=body=>({state:'UNKNOWN',previewId:body.requestId});await assert.rejects(f.client.preview(),{code:'MARKET_SEARCH_UNKNOWN'});
  assert.deepEqual(f.calls.at(-1).options.body,first);assert.ok(f.calls.filter(c=>c.options).every(c=>c.path.endsWith('/research/search')));
});
test('observation is persisted before dispatch and unknown replay survives reload without a second id',async()=>{
  const f=fixture(),preview=await f.client.preview();f.contribute=()=>{throw Error('lost receipt');};
  await assert.rejects(f.client.contribute(preview.previewId));const first=f.calls.at(-1).options.body;
  await assert.rejects(f.client.preview(),{code:'RESEARCH_OBSERVATION_PENDING'});
  f.client=createReportResearchClient(f.options);f.contribute=undefined;await f.client.reconcileObservation();
  assert.deepEqual(f.calls.at(-1).options.body,first);assert.equal(f.client.pendingObservation(),null);
  assert.deepEqual(Object.keys(first).sort(),['observationId','previewId']);
});
test('unconfirmed receipt and storage failure never discard an unknown contribution',async()=>{
  const f=fixture();f.contribute=()=>({state:'RECORDED',disposition:'already_published',receipt:{proposalId:'fixture',outcome:'recorded'}});
  await assert.rejects(f.client.contribute(randomUUID()),{code:'RESEARCH_OBSERVATION_UNCONFIRMED'});assert.ok(f.client.pendingObservation());
  const count=f.calls.length,bad=createReportResearchClient({...f.options,staffId:randomUUID(),storage:{getItem:()=>null,setItem:()=>{throw Error('disk');},removeItem:()=>{}}});
  await assert.rejects(bad.contribute(randomUUID()),/disk/);assert.equal(f.calls.length,count);
});
test('changed approval requires authenticated current status and never submits the old observation',async()=>{
  const f=fixture();f.contribute=()=>{throw Error('lost');};await assert.rejects(f.client.contribute(randomUUID()));
  f.approvalActionId=randomUUID();const next=createReportResearchClient({...f.options,approvalActionId:f.approvalActionId}),count=f.calls.filter(c=>c.options).length;
  await assert.rejects(next.contribute(),{code:'RESEARCH_OBSERVATION_APPROVAL_STALE'});
  assert.deepEqual(await next.reconcileObservation(),{state:'SUPERSEDED'});assert.equal(f.calls.filter(c=>c.options).length,count);assert.equal(next.pendingObservation(),null);
});
