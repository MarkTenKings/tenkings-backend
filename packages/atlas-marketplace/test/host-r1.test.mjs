import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {createR1MarketplaceHost,loadR1CanonicalAuth} from '../src/host-r1.mjs';
import {createAuthorityContext} from '../src/authority-context.mjs';
import {emptyMarketplaceState,POSTGRES_STORE_FORMAT} from '../src/store-postgres.mjs';
import {hash} from '../src/contract.mjs';
import {createHostedFinance} from '../src/host-finance.mjs';

// Resolve one existing dependency-free workspace export in this isolated
// checkout. No module source is substituted, installed, or written to R1.
const hook=registerHooks({resolve(specifier,context,nextResolve){return specifier==='@atlas/customer-intake/profile'?{url:new URL('../../atlas-customer-intake/src/profile.mjs',import.meta.url).href,shortCircuit:true}:nextResolve(specifier,context);}});
const canonical=await loadR1CanonicalAuth();hook.deregister();
const actorId='11111111-1111-4111-8111-111111111111';
const digest=value=>createHash('sha256').update(value).digest('hex');
async function fixture() {
  const f={now:1792706400000,ready:true,admitted:[],ingress:[],queries:[],connects:0,providerCalls:0,gatewayCalls:[],gatewayMissing:false};
  const browser=Buffer.alloc(32,11).toString('base64url'),session=Buffer.alloc(32,12).toString('base64url');
  const customerConfig={mode:'LOCAL_FIXTURE',origin:'https://atlasgrading.com',deploymentId:'isolated_customer',releaseSha:'a'.repeat(40),configHash:'b'.repeat(64),databaseUrl:'postgresql://fixture@127.0.0.1/r1_customer_fixture',cookies:{browser:'fixture_browser',session:'fixture_session'},sessionKey:Buffer.alloc(32,13)};
  customerConfig.binding=Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(key=>[key,customerConfig[key]]));
  const customerClient={$transaction:async work=>work({$queryRaw:async(parts,...values)=>{
    const sql=parts.join('?');
    if(sql.includes('AS unsafe'))return[{unsafe:false}];
    if(sql.includes('AS schema_write'))return[{schema_write:false,table_access:false,sequence_access:false}];
    if(sql.includes('p.prosecdef AS definer'))return[{schema:'atlas_customer',name:'customer_call(text, jsonb, jsonb)',definer:true}];
    if(sql.includes('atlas_customer.customer_call')){f.gatewayCalls.push(values);assert.equal(values[0],'marketplace_session_access');if(f.gatewayMissing)return[{result:{error:{status:404,code:'NOT_FOUND'}}}];return[{result:{schema:'atlas-marketplace-session-access-v1',accountId:actorId,sessionHash:digest(session),browserHash:digest(browser),observedAt:f.now+500,expiresAt:f.now+60000}}];}
    assert.fail('Unexpected canonical customer query');
  },$executeRaw:async()=>{}})};
  const customerAuth=new canonical.CustomerAuth({database:new canonical.CustomerDatabase(customerClient,customerConfig),config:customerConfig,provider:{}});
  const staffConfig={...customerConfig,deploymentId:'isolated_staff',basePath:'/admin',databaseUrl:'postgresql://fixture@127.0.0.1/r1_staff_fixture',phoneByHash:new Map()};
  const staffAuth=new canonical.DurableStaffAuth({database:{client:{}},config:staffConfig,provider:{}});
  const guard=req=>{assert.equal(req.headers['x-fixture-original-proof'],'unchanged');assert.ok(req.socket);assert.ok(Buffer.isBuffer(req.rawBody));f.ingress.push(req);};
  const state=emptyMarketplaceState(),row={format:POSTGRES_STORE_FORMAT,environment:'PROVIDER_SANDBOX',revision:'0',document:state,state_hash:hash(state)};
  const pool={async connect(){f.connects++;return{async query(sql,values){f.queries.push(sql);
    if(sql.startsWith('SELECT current_user AS role'))return{rows:[{role:'market_writer',database:'market_fixture',rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false}]};
    if(sql.includes('FROM pg_catalog.pg_auth_members'))return{rows:[{present:false}]};
    if(sql.includes(' AS gateway_usage'))return{rows:[{gateway_usage:true,database_create:false,schema_write:false,direct_table:false,sequence_access:false,database_owner:false}]};
    if(sql.includes('FROM pg_catalog.pg_proc p'))return{rows:['read_state()','lock_state()','commit_state(bigint, text, jsonb, text, bigint)'].map(name=>({schema:'atlas_marketplace',name,definer:true,config:['search_path=pg_catalog'],owner:'market_owner'}))};
    if(sql.includes('atlas_marketplace.read_state()')||sql.includes('atlas_marketplace.lock_state()'))return{rows:[structuredClone(row)]};
    if(sql.startsWith('SELECT atlas_marketplace.commit_state')){row.document=JSON.parse(values[2]);row.state_hash=values[3];row.revision=String(Number(row.revision)+1);return{rows:[]};}
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SET LOCAL'))return{rows:[]};assert.fail('Unexpected marketplace query');
  },release(){}};}};
  const context=createAuthorityContext({environment:'PROVIDER_SANDBOX',evidenceOrigin:'https://atlasgrading.com',evidencePathPrefixes:['/account/marketplace/api/evidence/'],qualificationRefs:{fingerprintRef:'ISOLATED_CONTRACT_NO_REAL_AUTHORITY',titlePolicyRef:'ISOLATED_CONTRACT_NO_REAL_AUTHORITY',marketplacePolicyRef:'ISOLATED_CONTRACT_NO_REAL_AUTHORITY',evidenceContractRef:'ISOLATED_CONTRACT_NO_REAL_AUTHORITY'}});
  const provider={getAccount:async()=>{f.providerCalls++;assert.fail('unexpected provider I/O');}};
  const marketplace={context,provider,platformAccountId:'acct_isolatedfixture',listingPolicy:{id:'fixture_policy',version:1},financePolicy:{environment:'stripe-sandbox'},fulfillmentPolicy:{id:'fixture_policy',version:1},assertRuntimeReady:()=>f.ready};
  marketplace.runtimeApproval={approved:true,binding:{environment:'PROVIDER_SANDBOX',platformAccountId:marketplace.platformAccountId,listingPolicyHash:hash(marketplace.listingPolicy),financePolicyHash:hash(marketplace.financePolicy),fulfillmentPolicyHash:hash(marketplace.fulfillmentPolicy),qualificationRefs:context.qualificationRefs}};
  f.options={enabled:true,clock:()=>f.now,config:{approved:true,approvalRef:'ISOLATED_HOST_CONTRACT_ONLY',environment:'PROVIDER_SANDBOX',origin:'https://atlasgrading.com',maxDatabaseClockSkewMs:1000,
    authPolicy:{approved:true,approvalRef:'ISOLATED_ROLE_CONTRACT_ONLY',environment:'PROVIDER_SANDBOX',r1Mode:'LOCAL_FIXTURE',staffRoles:['REVIEWER'],customerRoles:['BUYER','SELLER']},
    routes:{public:{mountPath:'/marketplace/',catalogPath:'/marketplace/catalog'},buyer:{mountPath:'/account/marketplace/',apiPath:'/account/marketplace/api'},seller:{mountPath:'/account/marketplace/seller/',apiPath:'/account/marketplace/seller/api'},staff:{mountPath:'/admin/marketplace/',apiPath:'/admin/marketplace/api'}}},
    r1:{staffState:{auth:staffAuth,assertRequest:guard},customerState:{auth:customerAuth,config:customerConfig,assertRequest:guard},publicConfig:{...customerConfig,deploymentId:'isolated_public'},manualClient:{$transaction:()=>assert.fail('staff boundary not invoked by customer')},admitRequest:async input=>{f.admitted.push(input);return true;},admitPublicRequest:async()=>true},
    database:{pool,expectedRole:'market_writer',expectedDatabase:'market_fixture',expectedFunctionOwner:'market_owner'},marketplace,assertRuntimeReady:()=>f.ready};
  f.cookie=`fixture_browser=${browser}; fixture_session=${session}`;
  return f;
}
async function fetchNode(server,path,headers={}) {return new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path,headers:{host:'atlasgrading.com',...headers}},res=>{const chunks=[];res.on('data',value=>chunks.push(value));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end();});}

test('default-off host has no database/provider effects; explicit enabled composition requires independent approval and dedicated storage',async()=>{
  const disabled=await createR1MarketplaceHost();assert.equal(disabled.status().enabled,false);assert.equal(disabled.createHandlers,undefined);
  const denied=await fixture();denied.ready=false;await assert.rejects(createR1MarketplaceHost(denied.options),{code:'R1_HOST_UNAVAILABLE'});assert.equal(denied.connects,0);
  const same=await fixture();same.options.database.expectedDatabase='r1_customer_fixture';await assert.rejects(createR1MarketplaceHost(same.options),{code:'R1_HOST_UNAVAILABLE'});assert.equal(same.connects,0);
  const f=await fixture(),host=await createR1MarketplaceHost(f.options);assert.equal(f.connects,0);assert.equal(f.providerCalls,0);assert.equal(host.settlementCapability,undefined);assert.equal(host.status().saleAuthorityAvailable,false);
  await assert.rejects(host.service.publishListing({id:actorId,role:'SELLER'},{cardId:actorId}),/FULFILLMENT_POLICY|ELIGIBILITY_UNAVAILABLE/);
  await host.close();assert.equal(host.status().enabled,false);assert.equal(f.providerCalls,0);
});

test('canonical customer gateway and original mounted IncomingMessage drive role-scoped workspace; no session bootstrap or claimed actor fallback',async()=>{
  const f=await fixture(),host=await createR1MarketplaceHost(f.options),handlers=await host.createHandlers(),server=createServer(handlers.listener);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const response=await fetchNode(server,'/account/marketplace/api/workspace',{cookie:f.cookie,'x-fixture-original-proof':'unchanged'});
    assert.equal(response.status,200);assert.deepEqual(response.body.scope,{role:'BUYER',actorId});assert.equal(response.body.actor,undefined);assert.ok(response.body.csrfToken);
    assert.equal(f.ingress.length,1);assert.equal(f.ingress[0].url,'/account/marketplace/api/workspace');assert.equal(f.ingress[0].headers.cookie,f.cookie);assert.equal(f.ingress[0].socket.remoteAddress,'127.0.0.1');
    assert.ok(f.gatewayCalls.length>=3);assert.ok(f.gatewayCalls.every(row=>row[0]==='marketplace_session_access'));assert.equal(f.admitted[0].role,'BUYER');assert.equal(f.providerCalls,0);
    f.gatewayMissing=true;const refused=await fetchNode(server,'/account/marketplace/api/workspace',{cookie:f.cookie,'x-fixture-original-proof':'unchanged'});assert.equal(refused.status,503);assert.equal(refused.body.error,'AUTH_BOUNDARY_UNAVAILABLE');
    f.ready=false;const before=f.connects;assert.equal((await fetchNode(server,'/marketplace/catalog')).status,503);assert.equal(f.connects,before);
  } finally {await host.close();await new Promise(resolve=>server.close(resolve));}
});

test('host pins approved runtime configuration and independently gates settlement capability construction',async()=>{
  const f=await fixture(),host=await createR1MarketplaceHost(f.options);f.options.r1.customerState.config.deploymentHost='changed.vercel.app';assert.equal(host.status().enabled,false);await assert.rejects(host.createHandlers(),{code:'R1_HOST_UNAVAILABLE'});await host.close();
  const denied=await fixture();denied.options.config.settlement={enabled:true,approvalRef:'ISOLATED_SETTLEMENT_TEST'};await assert.rejects(createR1MarketplaceHost(denied.options),{code:'R1_HOST_UNAVAILABLE'});
  const allowed=await fixture();allowed.options.config.settlement={enabled:true,approvalRef:'ISOLATED_SETTLEMENT_TEST'};allowed.options.assertSettlementReady=binding=>binding.operation==='SETTLE_RECONCILED_ORIGINAL_PAYMENTS'&&binding.approvalRef==='ISOLATED_SETTLEMENT_TEST';
  const ready=await createR1MarketplaceHost(allowed.options);assert.ok(ready.settlementCapability);assert.deepEqual(await ready.service.settleRecoveredPayments(ready.settlementCapability,{intentIds:[]}),[]);await ready.close();assert.equal(allowed.providerCalls,0);
});

test('R1 and finance hosts share branded original dependencies; cloned, plain and unrelated hosts cannot supply the webhook receiver',async()=>{
  async function joined() {
    const f=await fixture();f.options.config.settlement={enabled:true,approvalRef:'isolated_settlement'};f.options.assertSettlementReady=()=>f.ready;
    for(const name of ['getIdentity','retrieve','discover','getAccountSnapshot','listBalanceTransactions'])f.options.marketplace.provider[name]=async()=>{f.providerCalls++;assert.fail('composition must not contact a provider');};
    f.options.marketplace.webhook={endpoints:[{id:'we_platform_fixture',scope:'PLATFORM',secret:'whsec_isolated_platform_no_provider'},{id:'we_connect_fixture',scope:'CONNECTED',secret:'whsec_isolated_connect_no_provider'}]};
    const host=await createR1MarketplaceHost(f.options);
    const config={environment:'PROVIDER_SANDBOX',platformAccountId:f.options.marketplace.platformAccountId,connectedAccountIds:['acct_isolatedseller'],activationRef:'isolated_activation',operationsRef:'isolated_operations',qualificationRefs:f.options.marketplace.context.qualificationRefs,
      recovery:{approvalRef:'isolated_recovery',maxItems:1,concurrency:1,maxEvidenceAgeMs:60000,maxDurationMs:1000},finalizationBudgetMs:1000,
      schedule:{intervalMs:1000,pollIntervalMs:100,leaseMs:3000},alerts:{approvalRef:'isolated_alerts',destinationRef:'isolated_sink',maxItems:1,leaseMs:1000,staleIntentMs:1000,staleReportMs:1000}};
    const finance=createHostedFinance({enabled:true,store:host.store,provider:host.provider,service:host.service,settlementCapability:host.settlementCapability,config,assertRuntimeReady:()=>f.ready});
    return {f,host,finance};
  }
  const first=await joined(),other=await joined();
  try {
    for(const finance of [{...first.finance},{receiveProviderWebhook:first.finance.receiveProviderWebhook},other.finance])await assert.rejects(first.host.createHandlers({finance}),{code:'HOST_FINANCE_BINDING_MISMATCH'});
    const handlers=await first.host.createHandlers({finance:first.finance});assert.equal(typeof handlers.listener,'function');
    assert.equal(first.f.connects,0);assert.equal(first.f.providerCalls,0);assert.equal(other.f.providerCalls,0);
    assert.equal(JSON.stringify(first.finance.binding).includes('whsec_'),false);assert.equal(first.finance.binding.webhookBinding.endpoints.length,2);
  }finally{await first.host.close();await other.finance.stop();await other.host.close();}
});
