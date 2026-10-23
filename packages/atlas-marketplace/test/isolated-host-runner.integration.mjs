import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {createConnection} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {createIsolatedHostFixture} from '../scripts/isolated-host-fixture.mjs';
import {startIsolatedHostRunner} from '../scripts/isolated-host-runner.mjs';

function request(address,path,{method='GET',headers={},body,declaredLength}={}){
  return new Promise((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port:address.port,path,method,agent:false,headers:{host:'atlasgrading.com',...headers,...(body!==undefined||declaredLength!==undefined?{'content-length':String(declaredLength??Buffer.byteLength(body))}:{})}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));res.on('error',reject);
    });req.on('error',reject);req.end(body);
  });
}
const idleTransport=snapshot=>{for(const key of ['providerCalls','commerceCalls','taxCalls','alertCalls','timerStarts'])assert.equal(snapshot[key],0,key+' must remain inert');assert.equal(snapshot.financialDispatchCount,0);};
const stopped=receipt=>{assert.equal(receipt.phase,'CLOSED');assert.equal(receipt.listenersClosed,true);assert.equal(receipt.fixtureClosed,true);assert.equal(receipt.compositionClosed,true);assert.equal(receipt.activeHandlers,0);};
const delivery=(snapshot,id)=>{const rows=snapshot.webhookRows;return Array.isArray(rows)?rows.find(row=>row.eventId===id):rows[id];};

/** Explicit-path, owned PG exercise. Import is inert; the root CLI owns enablement
 * and dependency-path validation. No environment or provider credentials read.
 */
export async function qualifyIsolatedHostRunner({pgModulePath,postgresBin,signal}={}){
  let fixture,runner,lastReceipt,failure;const receipts=[],checks=[];
  const current=()=>{if(signal?.aborted)throw Object.assign(Error('Qualification interrupted'),{code:'ISOLATED_QUALIFICATION_ABORTED'});};
  const abort=()=>{if(runner)void runner.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
  try{
    current();fixture=await createIsolatedHostFixture({enabled:true,pgModulePath,postgresBin});current();
    const seed=await fixture.snapshot();assert.ok(seed.domainHashes?.financial&&seed.domainHashes?.physical);idleTransport(seed);
    runner=await startIsolatedHostRunner({enabled:true,fixture,limits:{maxLifetimeMs:15000,maxRequests:96,maxConcurrent:2,maxConnections:4,requestTimeoutMs:500,headersTimeoutMs:250}});current();
    const {addresses}=runner;assert.equal(new Set(Object.values(addresses).map(row=>row.port)).size,3);for(const row of Object.values(addresses)){assert.equal(row.address,'127.0.0.1');assert.notEqual(row.port,8070);}
    const signed=async(surface,target,options={})=>request(addresses[surface],target,{...options,headers:{...await fixture.signRequest({zone:surface==='staff'?'staff':'customer',target,method:options.method??'GET',session:surface==='staff'?'staff':'buyer',...options.sign}),...options.headers}});
    assert.equal((await request(addresses.public,'/marketplace/catalog')).status,200);
    for(const [surface,shell,api] of [['customer','/account/marketplace/','/account/marketplace/api/catalog'],['staff','/admin/marketplace/','/admin/marketplace/api/catalog']]){
      assert.equal((await signed(surface,shell)).status,200);assert.equal((await signed(surface,api)).status,200);
      const target=api+'?limit=1',headers=await fixture.signRequest({zone:surface==='staff'?'staff':'customer',target,session:surface==='staff'?'staff':'buyer'});
      for(const altered of [api+'?limit=2',api+'?limit=1&limit=1',api+'?limit=%31'])assert.notEqual((await request(addresses[surface],altered,{headers})).status,200);
      assert.notEqual((await request(addresses[surface],target,{method:'POST',headers,body:'{}'})).status,200);
      assert.notEqual((await request(addresses[surface],api.replace('/catalog','/workspace')+'?limit=1',{headers})).status,200);
    }
    const api='/account/marketplace/api/catalog';
    assert.notEqual((await signed('customer',api,{sign:{session:null}})).status,200);
    for(const action of ['revoke','expire']){fixture.sessions[action]('buyer');assert.notEqual((await signed('customer',api)).status,200);fixture.sessions.restore('buyer');assert.equal((await signed('customer',api)).status,200);}
    const staffApi='/admin/marketplace/api/catalog';assert.notEqual((await signed('staff',staffApi,{sign:{session:null}})).status,200);
    for(const action of ['revoke','expire']){fixture.sessions[action]('staff');assert.notEqual((await signed('staff',staffApi)).status,200);fixture.sessions.restore('staff');assert.equal((await signed('staff',staffApi)).status,200);}
    fixture.sessions.setStaffRole('OBSERVER');assert.notEqual((await signed('staff','/admin/marketplace/api/catalog')).status,200);fixture.sessions.setStaffRole('REVIEWER');assert.equal((await signed('staff','/admin/marketplace/api/catalog')).status,200);
    const seller='/account/marketplace/seller/api/catalog';assert.equal((await signed('customer',seller,{sign:{session:'seller'}})).status,200);
    for(const surface of ['public','customer','staff']){const target='/unrelated?raw=x%20y&raw=x+y',response=await request(addresses[surface],target);assert.deepEqual(JSON.parse(response.body),{original:true,surface,method:'GET',url:target});}
    checks.push('canonical signed shell/API and session boundaries','raw target/method/query tampering','original unrelated handler preservation');current();
    const eventId='evt_isolated_runner_receipt',raw=Buffer.from(JSON.stringify({id:eventId,object:'event',type:'balance.available',livemode:false,data:{object:{object:'balance'}}}));
    const webhook='/admin/marketplace/api/provider/webhook',proof=await fixture.signWebhook(raw),headers={'stripe-signature':proof.signature,'content-type':'application/json'};
    assert.equal((await request(addresses.staff,webhook,{method:'POST',headers,body:raw})).status,200);
    for(const [surface,target,body,badHeaders] of [['staff',webhook,raw,{...headers,'stripe-signature':'bad'}],['staff',webhook,Buffer.concat([raw,Buffer.from(' ')]),headers],['staff',webhook+'?changed=1',raw,headers],['customer','/account/marketplace/api/provider/webhook',raw,headers],['customer','/account/marketplace/seller/api/provider/webhook',raw,headers]])assert.notEqual((await request(addresses[surface],target,{method:'POST',headers:badHeaders,body})).status,200);
    const retained=await fixture.snapshot();assert.deepEqual(retained.domainHashes,seed.domainHashes);assert.equal(delivery(retained,eventId)?.deliveryCount,1);idleTransport(retained);checks.push('exact raw provider webhook with durable receipt and negative ingress');
    const oversized=await request(addresses.customer,api,{headers:await fixture.signRequest({zone:'customer',target:api}),declaredLength:16385});assert.equal(oversized.status,413);
    const longQuery=api+'?'+Array.from({length:17},(_,i)=>'x'+i+'=1').join('&');assert.equal((await request(addresses.customer,longQuery)).status,429);
    const manyHeaders=Object.fromEntries(Array.from({length:40},(_,i)=>['x-fixture-bound-'+i,'one']));assert.equal((await request(addresses.public,'/unrelated',{headers:manyHeaders})).status,431);
    for(let i=0;i<20&&(await runner.snapshot()).openConnections;i++)await delay(5);
    const held=[];try{for(let i=0;i<4;i++)held.push(await new Promise((resolve,reject)=>{const socket=createConnection({host:'127.0.0.1',port:addresses.public.port},()=>resolve(socket));socket.on('error',reject);}));await assert.rejects(request(addresses.customer,api));assert.ok((await runner.snapshot()).counts.connectionRefusals>=1);}finally{for(const socket of held)socket.destroy();}
    for(let i=0;i<20&&(await runner.snapshot()).openConnections;i++)await delay(5);
    const slowOptions={method:'POST',headers:await fixture.signRequest({zone:'customer',target:api,method:'POST'}),body:'{',declaredLength:10};
    const slow=[request(addresses.customer,api,slowOptions).then(()=>false,()=>true),request(addresses.customer,api,slowOptions).then(()=>false,()=>true)];
    for(let i=0;i<30&&(await runner.snapshot()).activeHandlers<2;i++)await delay(5);
    assert.equal((await runner.snapshot()).activeHandlers,2);assert.equal((await request(addresses.customer,api)).status,429);assert.deepEqual(await Promise.all(slow),[true,true]);
    const bounded=await runner.snapshot();assert.equal(bounded.counts.requestTimeouts,2);assert.equal(bounded.fixture.stateHash,retained.stateHash);idleTransport(bounded.fixture);checks.push('body/header/query/connection/concurrency limits and incomplete-body request deadlines');
    lastReceipt=await runner.close();stopped(lastReceipt);assert.equal(lastReceipt.forcedDrain,false);receipts.push(lastReceipt);runner=null;current();
    fixture=await fixture.restart();current();const recovered=await fixture.snapshot();assert.equal(recovered.stateHash,retained.stateHash);assert.equal(delivery(recovered,eventId)?.deliveryCount,1);idleTransport(recovered);checks.push('closed-cluster restart preserves original durable receipt');
    runner=await startIsolatedHostRunner({enabled:true,fixture,limits:{maxRequests:2,maxLifetimeMs:5000}});current();
    assert.equal((await request(runner.addresses.public,'/marketplace/catalog')).status,200);assert.equal((await request(runner.addresses.public,'/marketplace/catalog')).status,200);
    lastReceipt=await runner.closed;current();stopped(lastReceipt);assert.equal(lastReceipt.reason,'REQUEST_LIMIT');receipts.push(lastReceipt);runner=null;current();
    fixture=await fixture.restart();current();runner=await startIsolatedHostRunner({enabled:true,fixture,limits:{maxLifetimeMs:500}});current();
    lastReceipt=await runner.closed;current();stopped(lastReceipt);assert.equal(lastReceipt.reason,'LIFETIME_LIMIT');receipts.push(lastReceipt);runner=null;
    const final=await fixture.snapshot();assert.equal(final.stateHash,retained.stateHash);assert.deepEqual(final.domainHashes,seed.domainHashes);idleTransport(final);checks.push('request budget and finite lifetime stop listeners and owned database');current();
    return {schema:'atlas-isolated-host-qualification-v1',status:'PASSED',syntheticAuthority:true,productionReady:false,saleAuthorityAvailable:false,checks,listeners:addresses,requestLimits:bounded.limits,requestCounts:bounded.counts,shutdowns:receipts,stateHash:final.stateHash,revision:final.revision,webhook:{eventId,deliveryCount:delivery(final,eventId)?.deliveryCount},ownedCluster:final.ownedCluster,deadlines:final.deadlines,domainKeys:final.domainKeys,domainHashes:final.domainHashes,financialDispatchCount:final.financialDispatchCount,canonical:Object.fromEntries(['canonicalCustomerReads','canonicalStaffReads','canonicalIngressChecks','admissions','unexpectedAuthorityCalls'].map(key=>[key,final[key]])),counters:Object.fromEntries(['providerCalls','commerceCalls','taxCalls','alertCalls','timerStarts'].map(key=>[key,final[key]]))};
  }catch(error){failure=error;throw error;}finally{
    signal?.removeEventListener('abort',abort);
    const priorQualification=failure?.qualificationReceipt;
    let cleanupError,fixtureClose=null,fixtureState=null;
    try{if(runner){lastReceipt=await runner.close();if(lastReceipt.phase!=='CLOSED')cleanupError=Object.assign(Error('Owned listener cleanup incomplete'),{code:'ISOLATED_QUALIFICATION_CLEANUP_FAILED'});}}catch(error){cleanupError=error;}
    try{if(fixture)fixtureClose=await fixture.close();}catch(error){cleanupError??=error;}
    if(fixture){try{const snapshot=await fixture.snapshot();fixtureState=Object.fromEntries(['ownedCluster','stopped','revision','stateHash','stateHashMatches','domainKeys','domainHashes','financialDispatchCount','deadlines','providerCalls','commerceCalls','taxCalls','alertCalls','timerStarts'].filter(key=>Object.hasOwn(snapshot,key)).map(key=>[key,snapshot[key]]));}catch(error){cleanupError??=error;}}
    const qualificationReceipt={checks,shutdowns:receipts,lastShutdown:lastReceipt??null,ownedCluster:fixtureState?.ownedCluster??priorQualification?.ownedCluster??cleanupError?.qualificationReceipt?.ownedCluster??null,fixtureClose,fixtureState,cleanupComplete:!cleanupError&&(fixture?fixtureClose?.stopped===true:priorQualification?.cleanup?.stopped!==false),productionReady:false,...(priorQualification?{priorQualification}:{}),...(cleanupError?.qualificationReceipt?{cleanupFailure:cleanupError.qualificationReceipt}:{})};
    if(failure)failure.qualificationReceipt=qualificationReceipt;
    if(cleanupError){cleanupError.qualificationReceipt=qualificationReceipt;throw cleanupError;}
  }
}
