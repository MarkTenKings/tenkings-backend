import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {clone,hash} from '../src/contract.mjs';
import {createShipStationTrackingAdapter} from '../src/provider-tracking-shipstation.mjs';
import {createShippingLifecycle,assertShippingLifecycle} from '../src/shipping-lifecycle.mjs';
import {trackingFixture,TRACKING_NOW} from './shipping-lifecycle-fixtures.mjs';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const rejects=(promise,code)=>assert.rejects(promise,{code});

test('shipping is default off and cannot accept unqualified provider configuration',async t=>{
  let calls=0;const off=createShipStationTrackingAdapter({fetchImpl:()=>{calls++;}});
  assert.equal(off.enabled,false);await rejects(off.verifyIssuedShipment({}),'SHIPPING_TRACKING_DISABLED');assert.equal(calls,0);
  const cold=createShippingLifecycle();await rejects(cold.retainIssued({}),'SHIPPING_LIFECYCLE_DISABLED');assert.deepEqual(await cold.status(),[]);
  const f=trackingFixture(t);assert.equal(assertShippingLifecycle(f.lifecycle,{store:f.store,environment:'PROVIDER_SANDBOX'}),f.lifecycle);
  assert.throws(()=>assertShippingLifecycle({...f.lifecycle}),{code:'SHIPPING_LIFECYCLE_BINDING_MISMATCH'});
  assert.throws(()=>createShipStationTrackingAdapter({enabled:true,config:{...f.config,insuranceProviders:['third_party']},apiKey:'TEST_SYNTHETIC_NO_REAL_CREDENTIAL',assertReady:()=>true}),{code:'SHIPPING_TRACKING_CONFIG_REQUIRED'});
  assert.throws(()=>createShipStationTrackingAdapter({enabled:true,config:{...f.config,environment:'PRODUCTION'},apiKey:'TEST_SYNTHETIC_NO_REAL_CREDENTIAL',assertReady:()=>true}),{code:'SHIPPING_ACCOUNT_REQUIRED'});
  f.config.serviceCodes.push('unqualified');await rejects(f.lifecycle.retainIssued(f.input),'SHIPPING_TRACKING_CONFIG_CHANGED');assert.equal(f.control.calls.length,0);
});

test('retains only exact issued original and private hashes; replay never purchases or reassigns',async t=>{
  const f=trackingFixture(t),row=await f.lifecycle.retainIssued(f.input,f.auth);assert.equal(row.status,'ISSUED');assert.equal(row.totalCostCents,900);
  assert.equal(f.control.calls.length,3);assert.ok(f.control.calls.every(c=>c.method==='GET'&&c.body===undefined));
  assert.deepEqual(await f.lifecycle.retainIssued(f.input,f.auth),row);assert.equal(f.control.calls.length,3);
  await rejects(f.lifecycle.retainIssued({...f.input,labelId:'se-other'}),'SHIPPING_ORIGINAL_CONFLICT');
  await rejects(f.lifecycle.dispatchEvidence({orderId:f.order.orderId}),'SHIPPING_CARRIER_ACCEPTANCE_REQUIRED');
  const serialized=JSON.stringify(f.store.read());for(const value of ['Synthetic Buyer','123 Synthetic Buyer Road','+12025550123','DO_NOT_RETAIN','SYNTHETIC_ACCOUNT'])assert.equal(serialized.includes(value),false,value);
  const display=JSON.stringify(await f.lifecycle.status({orderId:f.order.orderId}));for(const value of [f.input.labelId,f.input.shipmentId,f.input.trackingNumber,'proof_coverage'])assert.equal(display.includes(value),false,value);
  f.store.transaction(tx=>{tx.state.orders.order_two={...clone(f.order),orderId:'order_two',paymentIntentId:'payment_two'};tx.state.intents.payment_two={...clone(tx.state.intents.payment_one),orderId:'order_two'};});
  await rejects(f.lifecycle.retainIssued({...f.input,requestId:'second_order_request',orderId:'order_two'}),'SHIPPING_ORIGINAL_ALREADY_USED');assert.equal(Object.keys(f.store.read().shippingLifecycle).length,1);
});

test('actual loopback HTTP verifies original then derives acceptance and actual delivery with late observation',async t=>{
  let f;const server=createServer(async(req,res)=>{try{const reply=await f.remote('https://api.shipengine.com'+req.url,{method:req.method});res.writeHead(reply.status,{'content-type':'application/json'});res.end(await reply.text());}catch{res.writeHead(500);res.end('{}');}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const port=server.address().port;f=trackingFixture(t,{fetchImpl:(url,options)=>{assert.equal(new URL(url).origin,'https://api.shipengine.com');assert.equal(options.redirect,'error');assert.equal(options.method,'GET');return fetch('http://127.0.0.1:'+port+new URL(url).pathname,options);}});
  const row=await f.lifecycle.retainIssued(f.input),accepted=TRACKING_NOW-2000,delivered=TRACKING_NOW-1000;
  f.control.tracking={tracking_number:f.input.trackingNumber,status_code:'DE',actual_delivery_date:new Date(delivered).toISOString(),events:[f.event('DE',delivered),f.event('AC',accepted)]};
  f.control.now+=30*3600000;const synced=await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey});assert.equal(synced.deliveredAt,delivered);assert.equal(synced.observedAt,f.control.now);
  const dispatch=await f.lifecycle.dispatchEvidence({orderId:'order_one'}),delivery=await f.lifecycle.deliveryEvidence({orderId:'order_one'});assert.equal(dispatch.dispatchedAt,accepted);assert.equal(delivery.deliveredAt,delivered);assert.notEqual(delivery.deliveredAt,synced.observedAt);
  for(const [action,evidence]of [['DISPATCH',dispatch],['DELIVER',delivery]])assert.equal(f.store.transaction(tx=>f.lifecycle.assertInTransaction(tx,{kind:'FULFILLMENT',input:{orderId:'order_one',action,evidence}})),true);
  assert.equal(await f.lifecycle.validateEvidence({kind:'FULFILLMENT',input:{orderId:'order_one',action:'DELIVER',evidence:delivery}}),true);
  assert.equal(JSON.stringify(f.store.read()).includes('PRIVATE_PERSON_MUST_NOT_BE_RETAINED'),false);
  const before=Object.keys(f.store.read().shippingLifecycle[row.shipmentKey].observations).length;await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey});assert.equal(Object.keys(f.store.read().shippingLifecycle[row.shipmentKey].observations).length,before);
  await rejects(f.lifecycle.validateEvidence({kind:'FULFILLMENT',input:{orderId:'order_one',action:'DELIVER',evidence:{...delivery,deliveredAt:f.control.now}}}),'SHIPPING_MILESTONE_EVIDENCE_CHANGED');
});

test('independent exact original reads refuse void, wrong address, amount, parcel, mode and missing coverage',async t=>{
  for(const [name,mutate,code]of [
    ['void',f=>{f.label.voided=true;},'SHIPPING_LABEL_MISMATCH'],
    ['label identity',f=>{f.label.label_id='se-wrong';},'SHIPPING_LABEL_MISMATCH'],
    ['address',f=>{f.shipment.ship_to.address_line1='Different destination';},'SHIPPING_ADDRESS_MISMATCH'],
    ['insured amount',f=>{f.shipment.packages[0].insured_value.amount='99.99';},'SHIPPING_MEASUREMENT_MISMATCH'],
    ['parcel',f=>{f.shipment.packages.push(clone(f.shipment.packages[0]));},'SHIPPING_SHIPMENT_MISMATCH'],
    ['charge',f=>{f.label.shipment_cost.amount='7.001';},'SHIPPING_AMOUNT_INVALID'],
    ['coverage',f=>{f.shipment.insurance_provider='none';},'SHIPPING_SHIPMENT_MISMATCH'],
    ['account',f=>{f.account.account_number='OTHER_ACCOUNT';},'SHIPPING_ACCOUNT_MISMATCH'],
    ['before payment',f=>{f.label.created_at=new Date(TRACKING_NOW-6000).toISOString();},'SHIPPING_ORDER_CHANGED'],
    ['unreviewed proof',f=>{f.control.validEvidence=false;},'SHIPPING_ISSUANCE_EVIDENCE_REQUIRED']
  ])await t.test(name,async t=>{const f=trackingFixture(t);mutate(f);await rejects(f.lifecycle.retainIssued(f.input),code);assert.equal(f.store.read().shippingLifecycle,undefined);assert.ok(f.control.calls.every(c=>c.method==='GET'));});
});

test('no inferred delivery from estimates, local time, collection point, delivery attempts or missing dates',async t=>{
  const f=trackingFixture(t),row=await f.lifecycle.retainIssued(f.input);
  for(const status of ['NY','SP','AT']){f.control.tracking={tracking_number:f.input.trackingNumber,status_code:status,estimated_delivery_date:new Date(TRACKING_NOW-1000).toISOString(),actual_delivery_date:null,events:[]};const result=await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey});assert.equal(result.deliveredAt,null);await rejects(f.lifecycle.deliveryEvidence({orderId:'order_one'}),'SHIPPING_ACTUAL_DELIVERY_REQUIRED');}
  f.control.tracking.status_code='DE';const missing=await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey});assert.equal(missing.attentionCode,'SHIPPING_DELIVERY_TIME_REQUIRED');
  for(const value of ['2026-10-23T11:59:59',new Date(TRACKING_NOW+1).toISOString(),'2026-02-30T11:59:59Z']){f.control.tracking.actual_delivery_date=value;await rejects(f.lifecycle.syncTracking({shipmentKey:row.shipmentKey}),'SHIPPING_EVENT_TIME_INVALID');assert.equal((await f.lifecycle.status({orderId:'order_one'}))[0].attentionCode,'SHIPPING_ORIGINAL_READ_UNCONFIRMED');}
  f.control.tracking={tracking_number:f.input.trackingNumber,status_code:'DE',actual_delivery_date:null,events:[f.event('DE',TRACKING_NOW-1000)]};const fallback=await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey});assert.equal(fallback.deliveredAt,TRACKING_NOW-1000);
});

test('conflicting delivery timestamps remain retained, block milestones and release, never extend window',async t=>{
  const f=trackingFixture(t),row=await f.lifecycle.retainIssued(f.input);f.control.tracking={tracking_number:f.input.trackingNumber,status_code:'DE',actual_delivery_date:new Date(TRACKING_NOW-1000).toISOString(),events:[]};
  await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey});const accepted=await f.lifecycle.deliveryEvidence({orderId:'order_one'});
  f.store.transaction(tx=>{tx.state.fulfillment.order_one={deliveredAt:accepted.deliveredAt};});
  assert.equal(f.store.transaction(tx=>f.lifecycle.assertInTransaction(tx,{kind:'FULFILLMENT',input:{orderId:'order_one',action:'RELEASE'}})),true);
  f.control.tracking.actual_delivery_date=new Date(TRACKING_NOW-500).toISOString();const conflict=await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey});assert.equal(conflict.deliveredAt,TRACKING_NOW-1000);assert.equal(conflict.attentionCode,'SHIPPING_DELIVERY_CONFLICT');
  await rejects(f.lifecycle.deliveryEvidence({orderId:'order_one'}),'SHIPPING_RECONCILIATION_REQUIRED');assert.throws(()=>f.store.transaction(tx=>f.lifecycle.assertInTransaction(tx,{kind:'FULFILLMENT',input:{orderId:'order_one',action:'RELEASE'}})),{code:'SHIPPING_RECONCILIATION_REQUIRED'});
  f.control.tracking.actual_delivery_date=new Date(TRACKING_NOW-1000).toISOString();assert.equal((await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey})).attentionCode,'SHIPPING_DELIVERY_CONFLICT');
});

test('missing scans use retained issuance or carrier progress and return labels require approved case with ATLAS payer',async t=>{
  const f=trackingFixture(t),outbound=await f.lifecycle.retainIssued(f.input);f.control.now+=60000;let missing=await f.lifecycle.missingScans();assert.equal(missing[0].reason,'NO_CARRIER_ACCEPTANCE');assert.equal(missing[0].dueAt,TRACKING_NOW-3000+60000);
  f.control.tracking={tracking_number:f.input.trackingNumber,status_code:'IT',actual_delivery_date:null,events:[f.event('AC',TRACKING_NOW-2000),f.event('IT',TRACKING_NOW)]};await f.lifecycle.syncTracking({shipmentKey:outbound.shipmentKey});missing=await f.lifecycle.missingScans();assert.equal(missing[0].reason,'NO_RECENT_PROGRESS');
  const input={...f.input,requestId:'request_return',direction:'RETURN',caseId:'case_one',labelId:'se-return-123',shipmentId:'se-returnship-123',trackingNumber:'SYNTHETICRETURN01',externalShipmentId:'RETURN_ONE'};
  await rejects(f.lifecycle.retainIssued(input),'SHIPPING_APPROVED_RETURN_REQUIRED');
  f.store.transaction(tx=>{tx.state.fulfillment.order_one={cases:[{id:'case_one',kind:'RETURN',status:'OPEN',returnReview:{decision:'APPROVE'},initialShippingPayer:'ATLAS_INITIALLY'}]};});
  Object.assign(f.label,{label_id:input.labelId,shipment_id:input.shipmentId,tracking_number:input.trackingNumber,is_return_label:true});Object.assign(f.shipment,{shipment_id:input.shipmentId,external_shipment_id:input.externalShipmentId,ship_from:f.wire(f.expected.shipTo),ship_to:f.wire(f.expected.shipFrom)});[f.expected.shipFrom,f.expected.shipTo]=[f.expected.shipTo,f.expected.shipFrom];
  const returned=await f.lifecycle.retainIssued(input);assert.equal(returned.initialShippingPayer,'ATLAS');assert.notEqual(returned.shipmentKey,outbound.shipmentKey);
  f.control.tracking={tracking_number:input.trackingNumber,status_code:'DE',actual_delivery_date:new Date(TRACKING_NOW-1000).toISOString(),events:[]};await f.lifecycle.syncTracking({shipmentKey:returned.shipmentKey});
  assert.equal((await f.lifecycle.status({orderId:'order_one'})).find(r=>r.direction==='OUTBOUND').deliveredAt,null);assert.equal(f.store.read().fulfillment.order_one.cases[0].status,'OPEN');
});

test('revocation during awaited proof or provider GET prevents retention and transaction-time milestone commit',async t=>{
  for(const phase of ['evidence','/v1/labels/se-label-123'])await t.test(phase,async t=>{const f=trackingFixture(t),entered=deferred(),resume=deferred();f.control.hooks[phase]=async()=>{entered.resolve();await resume.promise;};const before=f.store.read();const promise=rejects(f.lifecycle.retainIssued(f.input,f.auth),'SHIPPING_AUTHORIZATION_REQUIRED');await entered.promise;f.control.authorized=false;resume.resolve();await promise;assert.deepEqual(f.store.read(),before);});
  const f=trackingFixture(t),row=await f.lifecycle.retainIssued(f.input);f.control.tracking={tracking_number:f.input.trackingNumber,status_code:'DE',actual_delivery_date:new Date(TRACKING_NOW-1000).toISOString(),events:[]};await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey});const evidence=await f.lifecycle.deliveryEvidence({orderId:'order_one'});f.control.approved=false;
  assert.throws(()=>f.store.transaction(tx=>f.lifecycle.assertInTransaction(tx,{kind:'FULFILLMENT',input:{orderId:'order_one',action:'DELIVER',evidence}})),{code:'SHIPPING_TRACKING_APPROVAL_REQUIRED'});
});

test('unknown GET outcome retains the same original and blocks release until successful original reread',async t=>{
  const f=trackingFixture(t),row=await f.lifecycle.retainIssued(f.input);f.control.tracking={tracking_number:f.input.trackingNumber,status_code:'DE',actual_delivery_date:new Date(TRACKING_NOW-1000).toISOString(),events:[]};await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey});
  f.control.hooks['/v1/labels/se-label-123/track']=()=>{throw new Error('PRIVATE_TOKEN_MUST_NOT_LEAK');};await rejects(f.lifecycle.syncTracking({shipmentKey:row.shipmentKey}),'QUOTE_PROVIDER_IO_UNKNOWN');const failed=await f.lifecycle.status({orderId:'order_one'});assert.equal(failed[0].attentionCode,'SHIPPING_ORIGINAL_READ_UNCONFIRMED');assert.equal(failed[0].deliveredAt,TRACKING_NOW-1000);assert.equal(JSON.stringify(f.store.read()).includes('PRIVATE_TOKEN_MUST_NOT_LEAK'),false);
  delete f.control.hooks['/v1/labels/se-label-123/track'];assert.equal((await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey})).attentionCode,null);assert.ok(f.control.calls.every(c=>c.method==='GET'));assert.equal(Object.keys(f.store.read().shippingLifecycle).length,1);
});

test('returned-to-sender delivery and progress after delivery cannot establish customer delivery',async t=>{
  for(const [name,tracking]of [
    ['returned',f=>({status_code:'DE',status_detail_code:'RETURNED_TO_SENDER',actual_delivery_date:new Date(TRACKING_NOW-1000).toISOString(),events:[{...f.event('DE',TRACKING_NOW-1000),status_detail_code:'RETURNED_TO_SENDER'}]})],
    ['later transit',f=>({status_code:'DE',actual_delivery_date:new Date(TRACKING_NOW-1000).toISOString(),events:[f.event('DE',TRACKING_NOW-1000),f.event('IT',TRACKING_NOW)]})]
  ])await t.test(name,async t=>{const f=trackingFixture(t),row=await f.lifecycle.retainIssued(f.input);f.control.tracking={tracking_number:f.input.trackingNumber,...tracking(f)};const result=await f.lifecycle.syncTracking({shipmentKey:row.shipmentKey});assert.equal(result.deliveredAt,null);assert.equal(result.attentionCode,'SHIPPING_DELIVERY_CONFLICT');await rejects(f.lifecycle.deliveryEvidence({orderId:'order_one'}),'SHIPPING_RECONCILIATION_REQUIRED');});
});


test('canonical request refresh refuses issuance/tracking commits after provider reads',async t=>{
  const f=trackingFixture(t);let refreshes=0;const denied={...f.auth,refreshAuthorization:async()=>{refreshes++;return false;}};
  await assert.rejects(f.lifecycle.retainIssued(f.input,denied),{code:'SHIPPING_AUTHORIZATION_REQUIRED'});assert.equal(Object.keys(f.store.read().shippingLifecycle??{}).length,0);
  const row=await f.lifecycle.retainIssued(f.input,f.auth);const before=structuredClone(f.store.read().shippingLifecycle[row.shipmentKey]);
  await assert.rejects(f.lifecycle.syncTracking({shipmentKey:row.shipmentKey},denied),{code:'SHIPPING_AUTHORIZATION_REQUIRED'});assert.deepEqual(f.store.read().shippingLifecycle[row.shipmentKey],before);assert.equal(refreshes,2);assert.ok(f.control.calls.every(row=>row.method==='GET'));
});
