import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startDemoServer} from '../scripts/demo-server.mjs';
import {startStripeBrowserQualification} from '../scripts/serve-stripe-browser-qualification.mjs';
import {SANDBOX_PLATFORM,SANDBOX_SELLER,SANDBOX_PLAN_FORMAT} from '../scripts/qualify-stripe-sandbox.mjs';
import {hash} from '../src/contract.mjs';

async function assertImportClosure(homeURL){
  const home=await fetch(homeURL);assert.equal(home.status,200);
  const html=await home.text(),entry=/<script\s+type="module"\s+src="([^"]+)"/.exec(html);
  assert.ok(entry,'HTML must identify its browser module entrypoint');
  const queue=[new URL(entry[1],homeURL)],visited=new Set();
  while(queue.length){
    const url=queue.shift();if(visited.has(url.href))continue;visited.add(url.href);
    const response=await fetch(url);assert.equal(response.status,200,url.pathname);assert.match(response.headers.get('content-type'),/^text\/javascript(?:;|$)/,url.pathname);
    const source=await response.text(),name=url.pathname.split('/').at(-1);
    assert.equal(source,await readFile(new URL('../ui/'+name,import.meta.url),'utf8'),url.pathname);
    for(const [,specifier] of source.matchAll(/^\s*import\s+[^;\n]*?from\s*['"]([^'"]+)['"]/gm)){
      assert.ok(specifier.startsWith('./'),'Browser imports must resolve within this local asset mount');queue.push(new URL(specifier,url));
    }
  }
  for(const name of ['app.mjs','view.mjs','physical-evidence.mjs','parcel-presets.mjs'])assert.ok([...visited].some(url=>url.endsWith('/'+name)),name+' must be reachable through actual imports');
}

function staticQualificationFixture(){
  const now=1792699200000,plan={format:SANDBOX_PLAN_FORMAT,runId:'r2qa_mock_static_assets_001',platformAccountId:SANDBOX_PLATFORM,connectedAccountId:SANDBOX_SELLER,livemode:false,apiVersion:'2025-09-30.clover',
    authorization:{approved:true,evidenceRef:'MOCK_STATIC_ONLY',approvedAt:now-1000,expiresAt:now+600000,allowedStages:['confirm','reconcile']},
    financePolicy:{version:'MOCK_STATIC_POLICY',environment:'stripe-sandbox',maxEvidenceAgeMs:60000,...Object.fromEntries(['approvalRef','authorityRef','feeTermsRef','refundTermsRef','transferTermsRef','payoutTermsRef','returnsTermsRef','reserveTermsRef','disputeTermsRef'].map(key=>[key,'MOCK_ONLY_'+key]))},
    amounts:{totalCents:1000,itemCents:1000,feeCents:100,sellerNetCents:900,taxCents:0,shippingCents:0},refund:{timing:'AFTER_TRANSFER',amountCents:100,allocations:{sellerCents:100,feeCents:0,taxCents:0,shippingCents:0},evidenceRef:'MOCK_REFUND'},
    payout:{amountCents:800,externalAccountId:'ba_MockStatic',evidenceRef:'MOCK_PAYOUT'},openingReview:{approved:true,quiescent:true,reviewerId:'MOCK_REVIEWER',policyVersion:'MOCK_OPENING',evidenceRef:'MOCK_OPENING_REF'},releaseRef:'MOCK_RELEASE',paymentMethod:'pm_card_visa'};
  const planHash=hash(plan),order={...plan.amounts,currency:'USD',policyVersion:plan.financePolicy.version};
  for(const key of ['orderId','reservationId','listingId','cardId','sellerId','buyerId'])order[key]=plan.runId+'_'+key;
  order.bindingHash=hash({planHash,order});const intentId=plan.runId+'_payment';
  const state={sandbox:{runId:plan.runId,planHash,environment:'PROVIDER_SANDBOX'},journals:[],intents:{[intentId]:{kind:'PAYMENT',id:intentId,dispatchCount:1,objectId:'pi_MockStaticOnly',status:'PENDING',confirmed:false,order,amountCents:1000,currency:'USD',bindingHash:order.bindingHash,policy:plan.financePolicy,platformAccountId:SANDBOX_PLATFORM,accountId:SANDBOX_PLATFORM,connectedAccountId:SANDBOX_SELLER}}};
  const calls=[],store={read:fn=>structuredClone(fn(state)),transaction:()=>assert.fail('Static GET must not mutate finance state')};
  const provider={getIdentity:async()=>{calls.push('identity');return {provider:'stripe',environment:'PROVIDER_SANDBOX',livemode:false,platformAccountId:SANDBOX_PLATFORM,allowedConnectedAccountIds:[SANDBOX_SELLER],apiVersion:plan.apiVersion,paymentCollectionConfigured:true};},getPaymentCollection:()=>assert.fail('No payment collection'),retrieve:()=>assert.fail('No provider retrieve'),create:()=>assert.fail('No provider create')};
  return {calls,options:{enabled:true,store,provider,plan,approvedPlanHash:planHash,clock:()=>now}};
}

test('synthetic demo serves the complete browser module import closure over GET',async t=>{
  const directory=await mkdtemp(join(await realpath(tmpdir()),'atlas-browser-assets-'));let server;
  t.after(async()=>{await server?.close();await rm(directory,{recursive:true,force:true});});
  server=await startDemoServer({directory,enabled:true});const before=hash(server.store.read());
  await assertImportClosure(server.origin+'/');assert.equal(hash(server.store.read()),before);
});

test('Stripe browser helper serves the same import closure with only a mocked identity read',async t=>{
  const f=staticQualificationFixture(),server=await startStripeBrowserQualification(f.options);t.after(()=>server.close());
  await assertImportClosure(server.url);assert.deepEqual(f.calls,['identity']);
});
