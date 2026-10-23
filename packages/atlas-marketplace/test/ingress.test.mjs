import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { financeFixture, NOW } from './finance-fixtures.mjs';
import { preparePayment, voidPreparedPayment } from '../src/finance.mjs';
import { retainFinanceWebhook, createWebhookIngressWorker, webhookIngressHealth } from '../src/ingress.mjs';
import { scopedWebhookBinding } from '../src/webhook.mjs';
const endpoints = [{ id: 'platform_endpoint', scope: 'PLATFORM', secret: 'whsec_platform_ingress_fixture' }, { id: 'connected_endpoint', scope: 'CONNECTED', secret: 'whsec_connected_ingress_fixture' }];
const scope = { platformAccountId: 'acct_platform', allowedConnectedAccountIds: ['acct_seller'], expectedLivemode: false };
function signed(event, index=0) { const rawBody=Buffer.from(JSON.stringify(event)), time=NOW/1000; return {rawBody,signature:`t=${time},v1=${createHmac('sha256',endpoints[index].secret).update(`${time}.`).update(rawBody).digest('hex')}`}; }
async function setup(t) {
 let now=NOW;const f=financeFixture({clock:()=>now});t.after(()=>f.store.close());
 f.store.transaction(tx=>preparePayment(tx,{intentId:'payment_one',order:f.order,policy:f.policy,platformAccountId:'acct_platform',connectedAccountId:'acct_seller'}));
 await f.execute('payment_one');f.provider.resolve('payment_one',{status:'succeeded'});
 const event={id:'evt_ingress',object:'event',type:'payment_intent.succeeded',livemode:false,data:{object:{id:f.store.read(s=>s.intents.payment_one.objectId),object:'payment_intent',metadata:{atlas_marketplace_intent:'payment_one'},billing_details:{email:'never-retain@example.test'}}}};
 const retain=(value=event,extra={})=>retainFinanceWebhook({enabled:true,store:f.store,...signed(value),endpoints,...scope,now:NOW,maxRetained:2,assertRuntimeReady:()=>true,...extra});
 const options={enabled:true,store:f.store,provider:f.provider,config:{...scope,configurationHash:scopedWebhookBinding({endpoints}).configurationHash,maxItems:2,concurrency:2,maxAttempts:2,retryDelayMs:1000,leaseMs:2000,maxRoutingItems:10},assertRuntimeReady:()=>true,settlePayments:async()=>{}};
 return {...f,event,retain,options,advance:delta=>now+=delta};
}
test('fast ACK retains immutable minimal envelope, duplicates, delayed restart worker and exact original settlement',async t=>{
 const f=await setup(t);let reads=0,settles=0;const retrieve=f.provider.retrieve;f.options.provider={...f.provider,retrieve:async(...args)=>{reads++;return retrieve(...args);}};f.options.settlePayments=async({intentIds})=>{assert.deepEqual(intentIds,['payment_one']);settles++;};
 assert.equal((await f.retain()).status,'QUEUED');assert.equal(reads,0);assert.equal(f.store.read(s=>s.journals.length),0);
 assert.equal(JSON.stringify(f.store.read(s=>s.financeWebhookIngress)).includes('never-retain'),false);
 assert.equal((await f.retain()).status,'DUPLICATE');f.advance(600000);
 const worker=createWebhookIngressWorker(f.options);await Promise.all([worker.run({runId:'first'}),createWebhookIngressWorker(f.options).run({runId:'second'})]);
 assert.equal(reads,1);assert.equal(settles,1);assert.equal(f.store.read(s=>s.intents.payment_one.dispatchCount),1);assert.equal(f.store.read(s=>s.financeWebhookIngress.evt_ingress.status),'DONE');assert.equal(f.store.read(s=>s.journals.length),1);
 await worker.run({runId:'restart'});assert.equal(reads,1);assert.equal(webhookIngressHealth(f.store.read(),scope,NOW).pending,0);
});
test('invalid signature/scope leaves store untouched; changed signed delivery quarantines durably; capacity backpressures',async t=>{
 const f=await setup(t), before=f.store.read();await assert.rejects(f.retain(f.event,{signature:'t=0,v1=bad'}));assert.deepEqual(f.store.read(),before);
 await assert.rejects(f.retain({...f.event,account:'acct_seller'}),{code:'WEBHOOK_ENDPOINT_SCOPE_MISMATCH'});
 const foreign={...f.event,account:'acct_foreign'};await assert.rejects(f.retain(foreign,signed(foreign,1)),{code:'WEBHOOK_SCOPE_MISMATCH'});
 await f.retain();await assert.rejects(f.retain({...f.event,type:'payment_intent.processing'}),{code:'WEBHOOK_DELIVERY_CONFLICT'});assert.equal(f.store.read(s=>s.financeWebhookIngress.evt_ingress.status),'QUARANTINED');
 await f.retain({...f.event,id:'evt_second'});await assert.rejects(f.retain({...f.event,id:'evt_third'}),{code:'WEBHOOK_INGRESS_CAPACITY'});assert.equal((await f.retain()).status,'DUPLICATE');
 assert.equal(f.store.read(s=>s.journals.length),0);
});
test('retry preserves original financial object; failed settlement resumes, attempts exhaust, leases recover after restart',async t=>{
 const f=await setup(t);await f.retain();let calls=0;f.options.settlePayments=async()=>{calls++;if(calls===1)throw Object.assign(new Error(),{code:'SETTLEMENT_UNAVAILABLE'});};
 const worker=createWebhookIngressWorker(f.options);await worker.run({runId:'one'});assert.equal(f.store.read(s=>s.financeWebhookIngress.evt_ingress.status),'RETRY_REQUIRED');assert.equal(f.store.read(s=>s.journals.length),1);
 f.advance(1000);await worker.run({runId:'two'});assert.equal(calls,2);assert.equal(f.store.read(s=>s.financeWebhookIngress.evt_ingress.status),'DONE');assert.equal(f.store.read(s=>s.journals.length),1);
 await f.retain({...f.event,id:'evt_restart'});f.store.transaction(tx=>{const r=tx.state.financeWebhookIngress.evt_restart;r.status='PROCESSING';r.attempts=1;r.lease={token:'dead',runId:'dead',expiresAt:NOW};});
 await createWebhookIngressWorker({...f.options,provider:{...f.provider,retrieve:async()=>{throw Object.assign(new Error(),{code:'PROVIDER_UNAVAILABLE'});}}}).run({runId:'recover'});
 assert.equal(f.store.read(s=>s.financeWebhookIngress.evt_restart.status),'EXHAUSTED');assert.equal(f.store.read(s=>s.intents.payment_one.dispatchCount),1);
});
test('local void only releases a never-dispatched payment and cannot authorize provider unpaid evidence',async t=>{
 const f=financeFixture();t.after(()=>f.store.close());f.store.transaction(tx=>preparePayment(tx,{intentId:'payment_one',order:f.order,policy:f.policy,platformAccountId:'acct_platform',connectedAccountId:'acct_seller'}));
 const row=f.store.transaction(tx=>voidPreparedPayment(tx,{intentId:'payment_one'}));assert.equal(row.status,'VOIDED');assert.equal(row.terminalUnpaid,false);assert.deepEqual(f.store.transaction(tx=>voidPreparedPayment(tx,{intentId:'payment_one'})),row);await assert.rejects(f.execute('payment_one'),{code:'RECONCILIATION_REQUIRED'});assert.equal(f.store.read(s=>s.journals.length),0);
});

test('explicit bounded historical configuration admits retained verified receipts; unapproved rotation and malformed event ids fail closed',async t=>{const f=await setup(t);for(const id of ['__proto__','constructor'])await assert.rejects(f.retain({...f.event,id}),{code:'INVALID_WEBHOOK_EVENT'});await f.retain();const current=digestFixture('new_secret_configuration');const unapproved=createWebhookIngressWorker({...f.options,config:{...f.options.config,configurationHash:current}});const held=await unapproved.run({runId:'unapproved_rotation'});assert.equal(held.status,'REVIEW_REQUIRED');assert.equal(held.results[0].status,'REVIEW_REQUIRED');assert.equal(f.store.read(s=>s.financeWebhookIngress.evt_ingress.status),'REVIEW_REQUIRED');assert.equal(f.store.read(s=>s.intents.payment_one.confirmed),false);await f.retain({...f.event,id:'evt_approvedrotation'});const approved=createWebhookIngressWorker({...f.options,config:{...f.options.config,configurationHash:current,retainedConfigurationHashes:[f.options.config.configurationHash]}});await approved.run({runId:'approved_rotation'});assert.equal(f.store.read(s=>s.financeWebhookIngress.evt_approvedrotation.status),'DONE');assert.equal(f.store.read(s=>s.financeWebhookIngress.evt_ingress.status),'REVIEW_REQUIRED');});
function digestFixture(value){return createHmac('sha256','fixture').update(value).digest('hex');}

test('verified queue survives closing and reopening the SQLite store before the original signed event is processed',async t=>{
 const {mkdtempSync,realpathSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const {openLocalStore}=await import('../src/store.mjs'),{createSyntheticProvider}=await import('../src/provider-synthetic.mjs');
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'atlas-ingress-owned-'))),filename=join(directory,'queue.sqlite');let current;
 t.after(()=>{current?.close();rmSync(directory,{recursive:true,force:true});});const f=financeFixture({filename});current=f.store;
 f.store.transaction(tx=>preparePayment(tx,{intentId:'payment_one',order:f.order,policy:f.policy,platformAccountId:'acct_platform',connectedAccountId:'acct_seller'}));await f.execute('payment_one');f.provider.resolve('payment_one',{status:'succeeded'});
 const event={id:'evt_diskrestart',object:'event',type:'payment_intent.succeeded',livemode:false,data:{object:{id:f.store.read(s=>s.intents.payment_one.objectId),object:'payment_intent',metadata:{atlas_marketplace_intent:'payment_one'}}}};
 await retainFinanceWebhook({enabled:true,store:f.store,...signed(event),endpoints,...scope,now:NOW,maxRetained:5,assertRuntimeReady:()=>true});f.store.close();current=openLocalStore({filename,environment:'SYNTHETIC_LOCAL',clock:()=>NOW+600000});
 const provider=createSyntheticProvider({store:current,clock:()=>NOW+600000,enabled:true});await createWebhookIngressWorker({enabled:true,store:current,provider,config:{...scope,configurationHash:scopedWebhookBinding({endpoints}).configurationHash,maxItems:1,concurrency:1,maxAttempts:2,retryDelayMs:1000,leaseMs:2000,maxRoutingItems:10},assertRuntimeReady:()=>true,settlePayments:async()=>{}}).run({runId:'disk_restart'});
 assert.equal(current.read(s=>s.financeWebhookIngress.evt_diskrestart.status),'DONE');assert.equal(current.read(s=>s.intents.payment_one.confirmed),true);assert.equal(current.read(s=>s.syntheticProvider.calls.payment_one),1);
});

test('exhausted expired lease reports held work instead of a misleading complete run',async t=>{const f=await setup(t);await f.retain();f.store.transaction(tx=>{const row=tx.state.financeWebhookIngress.evt_ingress;row.attempts=2;row.status='PROCESSING';row.lease={token:'expired',expiresAt:NOW-1};});const receipt=await createWebhookIngressWorker(f.options).run({runId:'exhausted'});assert.equal(receipt.status,'REVIEW_REQUIRED');assert.equal(receipt.results[0].status,'EXHAUSTED');assert.equal(f.store.read(s=>s.intents.payment_one.confirmed),false);});
