import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrapFixture} from './host-bootstrap-fixtures.mjs';
import {createMarketplacePhysicalFactory,instantiateMarketplacePhysical} from '../src/physical-runtime.mjs';
import {createR1MarketplaceHost} from '../src/host-r1.mjs';
import {createMarketplaceHostBootstrap} from '../src/host-bootstrap.mjs';
import {inspectMarketplaceHostInputs,MARKETPLACE_PHYSICAL_RELEASE_SCHEMA} from '../src/release-readiness.mjs';
import {hash} from '../src/contract.mjs';
import {image,digest} from './proof-fixtures.mjs';

async function physicalFixture(t){
  const f=await bootstrapFixture(),directory=mkdtempSync(join(realpathSync(tmpdir()),'atlas-r2-host-proof-'));mkdirSync(join(directory,'objects'),{mode:0o700});t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const environment='PROVIDER_SANDBOX',proof={id:'atlas_proof_policy',version:'v1',environment,approvalRef:'ISOLATED_PROOF',retentionRef:'ISOLATED_RETENTION',reviewerAuthorityRef:'ISOLATED_REVIEWER',effectiveAt:f.now-1000,expiresAt:f.now+86400000,retentionMs:86400000,maxObjectBytes:10485760,maxProofsPerOrder:20,maxRetainedObjects:100,uploadTtlMs:300000,validationLeaseMs:30000};
  const config={environment,proof,storage:{directory:join(directory,'objects'),keyId:'isolated',storageId:'isolated_storage',maxObjectBytes:10485760},decoder:{maxObjectBytes:10485760,maxPixels:16000000,timeoutMs:15000,maxConcurrent:2},shipping:{environment,approvalRef:'ISOLATED_TRACKING',accountApprovalRef:'ISOLATED_ACCOUNT',qualificationRef:'ISOLATED_ONLY',timestampPolicyApprovalRef:'ISOLATED_TIME',effectiveAt:new Date(f.now-1000).toISOString(),expiresAt:new Date(f.now+86400000).toISOString(),carrierId:'se-123',carrierCode:'ups',carrierAccountNumber:'SYNTHETIC_ACCOUNT',serviceCodes:['ups_ground'],insuranceProviders:['carrier'],confirmations:['signature'],maxDeclaredValueCents:100000},shippingLifecycleApprovalRef:'ISOLATED_SHIPPING'};
  const args={enabled:true,config,proofEncryptionKey:Buffer.alloc(32,29),shippingApiKey:'TEST_SYNTHETIC_NO_REAL_CREDENTIAL',approvals:Object.fromEntries(['physical','proof','tracking','shippingLifecycle'].map(key=>[key,()=>f.ready])),authorizeProof:()=>f.ready,resolveShipment:async()=>assert.fail('no provider or shipment resolution in host preparation'),validateShipmentEvidence:async()=>false,shippingFetch:async()=>assert.fail('no provider I/O in host preparation')};
  const factory=createMarketplacePhysicalFactory(args),market=f.options.marketplace;market.physicalConfig=config;market.createPhysicalPorts=factory;
  return {f,config,args,factory};
}
test('physical factory is inert by default, same-store branded and pins config/independent approvals',async t=>{
  assert.equal(createMarketplacePhysicalFactory(),null);assert.throws(()=>instantiateMarketplacePhysical(()=>({}),{}),{code:'PHYSICAL_FACTORY_UNQUALIFIED'});
  const {f,args,config}=await physicalFixture(t),host=await createR1MarketplaceHost(f.options);t.after(()=>host.close());
  assert.equal(host.status().saleAuthorityAvailable,false);assert.equal(host.status().claimsEnabled,false);assert.equal(f.providerCalls,0);
  const buyer={id:'11111111-1111-4111-8111-111111111111',role:'BUYER'};
  await host.store.transaction(tx=>{tx.state.orders.atlas_order={orderId:'atlas_order',cardId:buyer.id,buyerId:buyer.id,sellerId:'22222222-2222-4222-8222-222222222222',paymentIntentId:'atlas_payment',bindingHash:'isolated_binding',policyVersion:'v1'};tx.state.intents.atlas_payment={kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId:'atlas_order',bindingHash:'isolated_binding'};tx.state.fulfillment.atlas_order={deliveredAt:f.now-1000,releaseNotBefore:f.now-1000+86400000,cases:[]};});
  const input={requestId:'atlas_upload_request',orderId:'atlas_order',purpose:'RETURN_REQUEST',declaredType:'image/png',byteCount:100,sha256:'a'.repeat(64)};
  const original=await host.service.prepareProof(buyer,input);assert.equal(original.status,'PREPARED');assert.equal((await host.service.listProofs(buyer,{orderId:'atlas_order'})).proofs[0].uploadId,original.uploadId);
  args.approvals.proof=()=>true;await assert.rejects(host.service.listProofs(buyer,{orderId:'atlas_order'}),{code:'PHYSICAL_CONFIGURATION_CHANGED'});
  config.proof.maxProofsPerOrder++;assert.equal(host.status().enabled,false);assert.equal(f.providerCalls,0);
});
test('v2 bootstrap binds physical configuration; v1 refuses physical ports and shutdown preserves R1 ownership',async t=>{
  const {f,config}=await physicalFixture(t),options=f.bootstrapOptions;
  assert.ok(inspectMarketplaceHostInputs(options).issues.some(row=>row.code==='PHYSICAL_RELEASE_MANIFEST_REQUIRED'));
  options.manifest.schema=MARKETPLACE_PHYSICAL_RELEASE_SCHEMA;options.manifest.physicalConfigHash=hash(config);
  assert.equal(inspectMarketplaceHostInputs(options).configurationComplete,true);
  const bootstrap=createMarketplaceHostBootstrap(options);t.after(()=>bootstrap.stop());
  await bootstrap.prepare();assert.equal(bootstrap.status().phase,'PREPARED');assert.equal(bootstrap.status().binding.physicalConfigHash,hash(config));assert.equal(f.providerCalls,0);assert.equal(f.timerStarts,0);
  const client=f.options.r1.customerState.auth.database.client;config.shipping.maxDeclaredValueCents++;
  assert.equal(bootstrap.status().enabled,false);await bootstrap.stop();assert.equal(f.options.r1.customerState.auth.database.client,client);assert.equal(bootstrap.status().phase,'STOPPED');
});

test('retained reviewed photos cannot replace an independent nonlocal return/refund business decision',async t=>{
  const {f}=await physicalFixture(t);let decisions=0;f.options.marketplace.validateEvidence=async()=>{decisions++;return false;};
  const host=await createR1MarketplaceHost(f.options);t.after(()=>host.close());
  const staff={id:'22222222-2222-4222-8222-222222222222',role:'STAFF'},orderId='atlas_financial_order';
  await host.store.transaction(tx=>{tx.state.orders[orderId]={orderId,cardId:staff.id,buyerId:'11111111-1111-4111-8111-111111111111',sellerId:staff.id,paymentIntentId:'atlas_payment',bindingHash:'isolated_binding',policyVersion:'v1'};tx.state.intents.atlas_payment={kind:'PAYMENT',status:'SUCCEEDED',confirmed:true,orderId,bindingHash:'isolated_binding'};tx.state.fulfillment[orderId]={cases:[{id:'atlas_return',kind:'RETURN',status:'OPEN'}]};});
  const bytes=await image();
  for(const [purpose,method] of [['RETURN_REVIEW','reviewReturn'],['REFUND_REVIEW','refundCase']]){
    const prepared=await host.service.prepareProof(staff,{requestId:'atlas_prepare_'+purpose,orderId,purpose,declaredType:'image/png',byteCount:bytes.length,sha256:digest(bytes)});
    const retained=await host.service.uploadProof(staff,{uploadId:prepared.uploadId,bytes});
    await host.service.reviewProof(staff,{requestId:'atlas_review_'+purpose,proofId:retained.proofId,decision:'APPROVE',reviewRef:'atlas_staff_record_'+purpose});
    await assert.rejects(host.service[method](staff,{requestId:'atlas_business_'+purpose,orderId,caseId:'atlas_return',decision:'APPROVE',reviewRef:retained.proofId}),{code:'EVIDENCE_UNAVAILABLE'});
  }
  assert.equal(decisions,2);assert.equal(f.providerCalls,0);
  assert.equal((await host.store.read()).fulfillment[orderId].cases[0].returnReview,undefined);
});

test('non-payment physical factory retains proof readers but rejects shipping and legacy write/decoder entrypoints',async t=>{
  const {f,config,args}=await physicalFixture(t);config.operatingMode='NON_PAYMENT';delete config.shipping;delete config.shippingLifecycleApprovalRef;
  const only={...args,config};for(const key of ['shippingApiKey','resolveShipment','validateShipmentEvidence','shippingFetch'])delete only[key];only.approvals={physical:()=>f.ready,proof:()=>f.ready};
  assert.throws(()=>createMarketplacePhysicalFactory({...only,shippingApiKey:'must-not-load'}),{code:'NON_PAYMENT_OWNER_REFUSED'});
  const factory=createMarketplacePhysicalFactory(only),store={read:()=>assert.fail('legacy entrypoint reached state'),transaction:()=>assert.fail('legacy entrypoint wrote state')};
  const physical=instantiateMarketplacePhysical(factory,{store,context:f.options.marketplace.context,environment:'PROVIDER_SANDBOX',clock:()=>f.now});t.after(()=>physical.close());
  assert.equal(physical.shippingLifecycle,undefined);assert.equal(physical.proofIntake.assertReady(),true);
  for(const name of ['prepare','upload','recover'])await assert.rejects(physical.proofIntake[name]({},{}),{code:'PROOF_CANONICAL_AUTHORITY_REQUIRED'});
  const {createEncryptedProofStorage}=await import('../src/proof-storage.mjs');
  const storage=createEncryptedProofStorage({...config.storage,encryptionKey:args.proofEncryptionKey,environment:config.environment,retentionRef:config.proof.retentionRef,readOnly:true});t.after(()=>storage.close());
  assert.throws(()=>storage.put({}),{code:'PROOF_STORAGE_READ_ONLY'});assert.equal(f.providerCalls,0);
});
