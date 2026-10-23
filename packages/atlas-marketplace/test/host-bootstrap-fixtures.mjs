import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
import {createR1MarketplaceHost,loadR1CanonicalAuth} from '../src/host-r1.mjs';
import {createAuthorityContext} from '../src/authority-context.mjs';
import {emptyMarketplaceState,POSTGRES_STORE_FORMAT} from '../src/store-postgres.mjs';
import {hash} from '../src/contract.mjs';
import {MARKETPLACE_RELEASE_SCHEMA,MARKETPLACE_EXTERNAL_GATES} from '../src/release-readiness.mjs';
import {createMarketplaceCommerceFactory} from '../src/commerce-runtime.mjs';
import {config as providerQuoteConfig,NOW} from './provider-quote-fixtures.mjs';
import {makeCheckoutPolicy} from './policy-quote-fixtures.mjs';

// Resolve one existing dependency-free workspace export in this isolated
// checkout. No module source is substituted, installed, or written to R1.
const hook=registerHooks({resolve(specifier,context,nextResolve){return specifier==='@atlas/customer-intake/profile'?{url:new URL('../../atlas-customer-intake/src/profile.mjs',import.meta.url).href,shortCircuit:true}:nextResolve(specifier,context);}});
const canonical=await loadR1CanonicalAuth();hook.deregister();
const actorId='11111111-1111-4111-8111-111111111111';
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function canonicalHostFixture() {
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
  f.stateRow=row;
  f.cookie=`fixture_browser=${browser}; fixture_session=${session}`;
  return f;
}

// Reuses real canonical classes with explicit isolated PG/provider boundary
// doubles. These refs are test fixtures, never external qualification evidence.
export async function bootstrapFixture() {
  const f=await canonicalHostFixture();f.now=NOW;f.releaseReady=true;f.timerStarts=0;f.timerStops=0;f.fallback=[];f.alertCalls=0;
  const host=f.options,market=host.marketplace;
  host.config.settlement={enabled:true,approvalRef:'ISOLATED_SETTLEMENT_ONLY'};host.assertSettlementReady=()=>f.ready;
  for(const name of ['getIdentity','getAccount','create','retrieve','discover','getPaymentCollection','createOnboardingLink','getAccountSnapshot','listBalanceTransactions','listRelatedObjects','retrieveDispute'])market.provider[name]=async()=>{f.providerCalls++;assert.fail('bootstrap must not contact a provider');};
  market.provider.acceptsAccount=accountId=>accountId==='acct_isolatedseller';
  market.readEvidence=async()=>assert.fail('not qualified');market.validateEvidence=async()=>false;market.sellerAccount=async()=>assert.fail('not qualified');market.onboarding={};
  market.feeCalculator={enabled:true,preview:()=>assert.fail('not qualified'),assertCurrent:()=>assert.fail('not qualified')};
  const shipping=providerQuoteConfig('shipping'),tax={...providerQuoteConfig('tax'),accountId:market.platformAccountId};
  const checkout=makeCheckoutPolicy({id:'atlas_isolated_checkout',environment:'PROVIDER_SANDBOX',effectiveAt:shipping.effectiveAt,expiresAt:shipping.expiresAt,shippingPolicyRef:shipping.policyRef,taxPolicyRef:tax.policyRef,taxResponsibleEntityRef:tax.responsibleEntityRef});
  shipping.checkoutPolicyHash=hash(checkout);tax.checkoutPolicyHash=hash(checkout);
  market.commerceConfig={environment:'PROVIDER_SANDBOX',platformAccountId:market.platformAccountId,shipping,tax,checkout,taxLifecycleApprovalRef:'ISOLATED_TAX_LIFECYCLE',destinations:{id:'isolated_addresses',version:'1',environment:'PROVIDER_SANDBOX',approvalRef:'ISOLATED_ONLY',privacyRef:'ISOLATED_ONLY',allowedCountries:['US'],maxActive:3,receiptTtlMs:180000}};
  const noFetch=async()=>{f.providerCalls++;assert.fail('bootstrap does not contact shipping/tax providers');};
  market.createCommercePorts=createMarketplaceCommerceFactory({enabled:true,config:market.commerceConfig,keyring:{activeKeyId:'isolated',keys:{isolated:Buffer.alloc(32,19)}},shippingApiKey:'TEST_SYNTHETIC_NOT_A_REAL_KEY',taxSecretKey:'sk_test_SYNTHETICNOTAREALKEY',approvals:Object.fromEntries(['commerce','destinations','shipping','tax','checkout','taxLifecycle'].map(key=>[key,()=>f.ready])),shippingFetch:noFetch,taxFetch:noFetch});
  market.webhook={endpoints:[{id:'we_platform_fixture',scope:'PLATFORM',secret:'whsec_isolated_platform_no_provider'},{id:'we_connect_fixture',scope:'CONNECTED',secret:'whsec_isolated_connect_no_provider'}],ingress:{enabled:true,maxRetained:20},allowedConnectedAccountIds:['acct_isolatedseller']};
  const finance={enabled:true,assertRuntimeReady:()=>f.ready,timers:{setTimeout(){f.timerStarts++;return{unref(){}};},clearTimeout(){f.timerStops++;}},
    alertSender:{assertReady:()=>f.ready,send:async()=>{f.alertCalls++;assert.fail('no external sends');},lookup:async()=>{f.alertCalls++;assert.fail('no external lookups');}},
    config:{environment:'PROVIDER_SANDBOX',platformAccountId:market.platformAccountId,connectedAccountIds:['acct_isolatedseller'],activationRef:'ISOLATED_ACTIVATION',operationsRef:'ISOLATED_OPERATIONS',qualificationRefs:market.context.qualificationRefs,
      recovery:{approvalRef:'ISOLATED_RECOVERY',maxItems:1,concurrency:1,maxEvidenceAgeMs:60000,maxDurationMs:1000},finalizationBudgetMs:1000,
      taxReporting:{enabled:true,maxItems:1,approvalRef:'ISOLATED_TAX_REPORTING'},
      schedule:{intervalMs:1000,pollIntervalMs:100,leaseMs:3000},alerts:{approvalRef:'ISOLATED_ALERTS',destinationRef:'ISOLATED_SINK',maxItems:1,leaseMs:1000,staleIntentMs:1000,staleReportMs:1000},
      ingress:{enabled:true,maxItems:1,concurrency:1,maxAttempts:2,retryDelayMs:1000,leaseMs:3000,maxRoutingItems:10}}};
  const manifest={schema:MARKETPLACE_RELEASE_SCHEMA,environment:'PROVIDER_SANDBOX',origin:'https://atlasgrading.com',platformAccountId:market.platformAccountId,sourceRevision:'a'.repeat(40),releaseRef:'ISOLATED_RELEASE',bootstrapApprovalRef:'ISOLATED_BOOTSTRAP',networkApprovalRef:'ISOLATED_LOOPBACK',hostConfigHash:hash(host.config),financeConfigHash:hash(finance.config),commerceConfigHash:hash(market.commerceConfig),marketplaceBindingHash:hash(market.runtimeApproval.binding),
    listeners:{public:{host:'127.0.0.1',port:0},customer:{host:'127.0.0.1',port:0},staff:{host:'127.0.0.1',port:0}},limits:{maxConcurrent:4,maxConnections:10,requestTimeoutMs:1000,headersTimeoutMs:1000,keepAliveTimeoutMs:100,shutdownGraceMs:100},externalEvidence:Object.fromEntries(Object.keys(MARKETPLACE_EXTERNAL_GATES).map(key=>[key,null]))};
  const existingHandlers=Object.fromEntries(['public','customer','staff'].map(surface=>[surface,(req,res)=>{f.fallback.push({surface,req});res.writeHead(200);res.end(JSON.stringify({existing:true,surface,url:req.url}));}]));
  f.bootstrapOptions={enabled:true,manifest,host,finance,existingHandlers,assertReleaseReady:binding=>{assert.equal(binding.manifestHash,hash(manifest));return f.releaseReady;}};
  return f;
}
