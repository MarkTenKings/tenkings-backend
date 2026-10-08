const test=require('node:test'),assert=require('node:assert/strict');
const {crypto,contracts,vault,FakeClock,makeDoorAvailable,tempDatabase}=require('./helpers');
const {makeSyntheticConfig}=require('../../vault-contracts/tests/profile-fixtures');
const {activationFixture}=require('./spark-activation-fixture');
const {digest}=require('../dist/util');
const {withModbusCrc,waveshareRequest}=require('../dist/waveshare-protocol');
const fs=require('node:fs');
async function fixture(t,options={}){
  const machineId=crypto.randomUUID(),pair=crypto.generateKeyPairSync('ed25519'),clock=new FakeClock('2026-10-07T12:00:00.000Z');
  const config=makeSyntheticConfig(machineId,1,pair.privateKey,2); config.keyId='test-config-key';
  const profile=config.payload.machineProfile;profile.provenance='QUALIFIED';profile.evidence=Object.fromEntries(['geometryDigest','wiringDigest','capabilityDigest','hardwareDigest'].map(k=>[k,'f'.repeat(64)]));
  profile.controller.adapterId='waveshare-modbus-rtu-relay-32ch-v2';
  config.digest=contracts.configDigest(config.payload);config.signature=crypto.sign(null,Buffer.from(contracts.canonicalJson(config.payload)),pair.privateKey).toString('base64');
  const controllerConfig={adapterId:profile.controller.adapterId,mode:'LIVE',devicePath:'/dev/serial/by-id/SYNTHETIC_NO_HARDWARE',serialFormat:'9600/8N1',
    endpoints:profile.controller.endpoints.map((e,i)=>({endpointId:e.endpointId,address:i+1,expectedFirmwareRegister:100})),mapping:config.payload.doorMapping,mappingVersion:'1',profileDigest:contracts.machineProfileDigest(profile),pulseMs:100,offSettleMs:300,minimumOffMs:100,qualificationEvidenceDigest:'d'.repeat(64)};
  const f=activationFixture({machineId,machineConfigDigest:config.digest,controller:controllerConfig,now:clock.now().getTime()});
  let allowed=true,checks=0,machine,pulseHook=null;const pulses=[],reads=[];
  const authority={paymentBindingDigest:f.plan.bindingDigest,controllerBindingDigest:vault.waveshareBindingDigest(controllerConfig),assertAuthorized(context){checks++;if(!allowed)throw new vault.VaultError('TEST_AUTHORITY_REVOKED','Synthetic revoked lease',503);vault.verifySparkActivation({...f.input,context,now:clock.now().getTime()});}};
  const peer={kind:'FAKE_SERIAL_PEER',async open(){},async close(){},async exchange(action,address,channel){reads.push(action);if(action==='pulse100ms'){pulses.push({address,channel});pulseHook?.();return waveshareRequest(action,address,channel);}if(action==='coils')return withModbusCrc(Buffer.from([address,1,4,0,0,0,0]));const bytes=Buffer.from([address,3,2,0,0]);bytes.writeUInt16BE(action==='address'?address:100,3);return withModbusCrc(bytes);}};
  const controller=new vault.WaveshareControllerAdapter(controllerConfig,peer,new vault.WaveshareCommandJournal(':memory:',authority.controllerBindingDigest),()=>{machine.requireProductionEffectAuthority();});
  await controller.initializeReadOnly();t.after(()=>controller.close());
  const payment=new vault.DeterministicPaymentMock(),caps=await payment.capabilities(),baseStart=payment.startSession.bind(payment),baseReconcile=payment.reconcile.bind(payment),requests=new Map();let calls=0;
  payment.capabilities=async()=>({...caps,adapterName:'synthetic-live-payment-injection',mode:'LIVE',provider:'NAYAX_SPARK',productionConfirmed:true,bindingDigest:authority.paymentBindingDigest});
  payment.startSession=async request=>{machine.requireProductionEffectAuthority();calls++;const {fulfillment,...simple}=request,result=await baseStart(simple);requests.set(result.providerSessionId,digest(request));return{...result,originalRequestDigest:requests.get(result.providerSessionId),providerTransactionId:'123456789'};};
  payment.reconcile=async(id,replay)=>({...await baseReconcile(id,replay),originalRequestDigest:requests.get(id),providerTransactionId:'123456789'});
  const store=new vault.VaultStore(options.databasePath??':memory:',{machineId,appVersion:'0.1.0',sourceCommit:'a'.repeat(40),acquireProcessLock:false});t.after(()=>store.close());
  const machineOptions={pinnedConfigKeys:{'test-config-key':pair.publicKey.export({type:'spki',format:'pem'})},appVersion:'0.1.0',clock,productionAuthority:authority};
  machine=new vault.VaultMachine(store,payment,controller,machineOptions);machine.stageConfig(config);assert.equal(machine.activatePendingConfig().activated,true);machine.markCloudContact();
  const reserve=async()=>{makeDoorAvailable({store},['door-0001']);machine.selectCartDoor('door-0001','sports-25',true);return(await machine.checkout({idempotencyKey:crypto.randomUUID(),mode:'CERTIFICATION',configVersion:1,doorIds:['door-0001']})).sale;};
  return{machineId,store,machine,payment,controller,clock,authority,f,config,pulses,reads,machineOptions,reserve,calls:()=>calls,checks:()=>checks,setAllowed:v=>{allowed=v;},onPulse:fn=>{pulseHook=fn;}};
}
test('simulated production capture pins exact controller before payment and dispatches only committed paid doors',async t=>{
  const r=await fixture(t),sale=await r.reserve();assert.equal(sale.mode,'PRODUCTION');assert.equal(r.pulses.length,0);
  assert.equal(r.store.one('SELECT binding_digest FROM sale_controller_binding').binding_digest,r.authority.controllerBindingDigest);
  await r.machine.startPayment(sale.saleId,crypto.randomUUID());assert.equal(r.machine.publicSale(sale.saleId).paymentState,'SETTLED');assert.equal(r.pulses.length,1);
  assert.equal(r.store.one('SELECT binding_digest FROM command_controller_binding').binding_digest,r.authority.controllerBindingDigest);
  assert.throws(()=>r.store.run('UPDATE command_controller_binding SET binding_digest=?','e'.repeat(64)),/immutable/);
  assert.throws(()=>r.store.run('DELETE FROM sale_controller_binding'),/retained/);
  await r.machine.openPaidDoorsAgain(sale.saleId,'once-only-retry');assert.equal(r.pulses.length,2);
  await r.machine.openPaidDoorsAgain(sale.saleId,'once-only-retry');assert.equal(r.pulses.length,2);
});
test('missing/revoked production authority prevents reservation and payment intent without consuming stock',async t=>{
  const r=await fixture(t);r.setAllowed(false);await assert.rejects(r.reserve(),{code:'MACHINE_NOT_SALES_READY'});assert.equal(r.store.one('SELECT COUNT(*) n FROM sale').n,0);
  r.setAllowed(true);const sale=await r.reserve();r.setAllowed(false);await assert.rejects(r.machine.startPayment(sale.saleId,crypto.randomUUID()));assert.equal(r.calls(),0);
  assert.equal(r.machine.publicSale(sale.saleId).paymentState,'NOT_REQUESTED');assert.equal(r.pulses.length,0);
});
test('capture reconciliation remains possible after revocation; queued entitlement and retry stay intact',async t=>{
  const r=await fixture(t);r.payment.scriptStart({outcome:'UNKNOWN'});const sale=await r.reserve();await r.machine.startPayment(sale.saleId,crypto.randomUUID());r.setAllowed(false);
  r.payment.scriptReconcile({outcome:'SETTLE'});await r.machine.reconcileSale(sale.saleId);assert.equal(r.machine.publicSale(sale.saleId).paymentState,'SETTLED');assert.equal(r.pulses.length,0);
  assert.equal(r.store.one('SELECT state FROM command_intent').state,'COMMAND_INTENT_RECORDED');
  await assert.rejects(r.machine.openPaidDoorsAgain(sale.saleId,'not-consumed'));assert.equal(r.machine.publicSale(sale.saleId).retryUsed,false);
  r.setAllowed(true);await r.machine.drainCommands();assert.equal(r.pulses.length,1);
});
test('lease revocation during active pulse still permits OFF verification and prevents queued subsequent pulse',async t=>{
  const r=await fixture(t);r.onPulse(()=>r.setAllowed(false));const sale=await r.reserve();await r.machine.startPayment(sale.saleId,crypto.randomUUID());
  assert.equal(r.pulses.length,1);assert.equal(r.store.one('SELECT state FROM command_intent').state,'ACCEPTED');assert.equal((await r.controller.identity()).outputState,'OFF_VERIFIED');
  assert.equal(r.store.one('SELECT recovery_required FROM machine_meta').recovery_required,0);await assert.rejects(r.machine.openPaidDoorsAgain(sale.saleId,'blocked'));assert.equal(r.machine.publicSale(sale.saleId).retryUsed,false);
});
test('controller rotation with unchanged mapping cannot take over retained paid commands',async t=>{
  const r=await fixture(t);r.payment.scriptStart({outcome:'UNKNOWN'});const sale=await r.reserve();await r.machine.startPayment(sale.saleId,crypto.randomUUID());r.setAllowed(false);r.payment.scriptReconcile({outcome:'SETTLE'});await r.machine.reconcileSale(sale.saleId);
  r.setAllowed(true);const identity=r.controller.identity.bind(r.controller);r.controller.identity=async()=>({...await identity(),bindingDigest:'e'.repeat(64)});
  await r.machine.drainCommands();assert.equal(r.pulses.length,0);assert.equal(r.store.one('SELECT state FROM command_intent').state,'COMMAND_INTENT_RECORDED');assert.equal(r.store.one('SELECT recovery_required FROM machine_meta').recovery_required,1);
});
test('restart preserves authority checks and durable clock prevents backward-clock lease revival',async t=>{
  const tmp=tempDatabase();t.after(()=>fs.rmSync(tmp.directory,{recursive:true,force:true}));const r=await fixture(t,{databasePath:tmp.path});
  r.machine.requireProductionEffectAuthority();r.clock.advance(10000);r.machine.requireProductionEffectAuthority();r.store.close();
  const reopened=new vault.VaultStore(tmp.path,{machineId:r.machineId,appVersion:'0.1.0',sourceCommit:'a'.repeat(40),acquireProcessLock:false});t.after(()=>reopened.close());r.clock.value=new Date(r.clock.now().getTime()-20000);
  const restarted=new vault.VaultMachine(reopened,r.payment,r.controller,r.machineOptions);assert.throws(()=>restarted.requireProductionEffectAuthority(),{code:'PRODUCTION_TECHNICAL_RECOVERY_REQUIRED'});assert.equal(r.pulses.length,0);
});
test('production approved void obeys lease before intent and queued transport without changing captured stock',async t=>{
  const r=await fixture(t),sale=await r.reserve();await r.machine.startPayment(sale.saleId,crypto.randomUUID());r.machine.markPresentationDone(sale.saleId);
  const row=r.store.one('SELECT * FROM sale WHERE sale_id=?',sale.saleId),ref=v=>'sha256:'+crypto.createHash('sha256').update(v).digest('hex');
  const action={actionId:crypto.randomUUID(),machineId:r.machineId,saleId:sale.saleId,provider:'NAYAX_SPARK',paymentBindingDigest:r.authority.paymentBindingDigest,providerSessionReference:ref(row.provider_session_id),providerTransactionReference:ref(row.provider_transaction_id),amountCents:row.total_cents,currency:'USD',reason:'Synthetic review',approvedByAdminId:'synthetic-admin',approvedAt:r.clock.now().toISOString(),expiresAt:new Date(r.clock.now().getTime()+300000).toISOString()};
  let transport=0;r.payment.voidPaidTransaction=async(request,options)=>{r.setAllowed(false);options.beforeTransport();transport++;return{...request,state:'VOIDED',evidenceReference:ref('fixture-void')};};
  r.setAllowed(false);await assert.rejects(r.machine.paymentOperations.executeApprovedVoid(action));assert.equal(r.store.one('SELECT COUNT(*) n FROM payment_void').n,0);
  r.setAllowed(true);await assert.rejects(r.machine.paymentOperations.executeApprovedVoid(action));assert.equal(transport,0);assert.equal(r.store.one('SELECT state FROM payment_void').state,'INTENT');
  assert.equal(r.store.one('SELECT payment_state FROM sale').payment_state,'SETTLED');assert.equal(r.store.one("SELECT state FROM door WHERE door_id='door-0001'").state,'COMMITTED_SOLD');
  r.setAllowed(true);r.payment.voidPaidTransaction=async(request,options)=>{options.beforeTransport();transport++;return{...request,state:'VOIDED',evidenceReference:ref('fixture-void')};};
  assert.equal((await r.machine.paymentOperations.executeApprovedVoid(action)).state,'VOIDED');assert.equal(transport,1);
  r.setAllowed(false);assert.equal((await r.machine.paymentOperations.executeApprovedVoid(action)).state,'VOIDED');assert.equal(transport,1,'terminal evidence stays readable after revocation');
});
test('sandbox payment cannot pair with LIVE controller even through direct machine injection',async t=>{
  const r=await fixture(t),caps=await r.payment.capabilities();r.payment.capabilities=async()=>({...caps,mode:'OFFICIAL_TEST',productionConfirmed:undefined,sandboxConfirmed:true});
  await assert.rejects(r.reserve(),{code:'MACHINE_NOT_SALES_READY'});assert.equal(r.pulses.length,0);assert.equal(r.calls(),0);
});
test('completed foreign provider history is retained during rotation; outstanding original operations block replacement',async t=>{
  const r=await fixture(t),sale=await r.reserve();await r.machine.startPayment(sale.saleId,crypto.randomUUID());
  let snapshot;r.payment.auditRecovery=async s=>{snapshot=s;return[];};const caps=await r.payment.capabilities();r.payment.capabilities=async()=>({...caps,bindingDigest:'e'.repeat(64)});
  await assert.rejects(r.machine.paymentOperations.auditRecovery(),{code:'PAYMENT_PREVIOUS_BINDING_RECOVERY_REQUIRED'});assert.equal(snapshot,undefined);
  r.machine.markPresentationDone(sale.saleId);r.store.run('UPDATE machine_meta SET automation_halted=0,recovery_required=0');await r.machine.paymentOperations.auditRecovery();assert.deepEqual(snapshot.sales,[]);assert.deepEqual(snapshot.voids,[]);
  assert.equal(r.store.one('SELECT binding_digest FROM sale_payment_binding').binding_digest,r.authority.paymentBindingDigest);assert.equal(r.store.one('SELECT payment_state FROM sale').payment_state,'SETTLED');
});
test('production staff restock pins controller identity before the first command',async t=>{
  const r=await fixture(t);const staff=require('./helpers').grant(r,'ADMIN');const operations=new vault.VaultOperationsService(r.machine,r.clock);
  await operations.startOrResumeRestock(staff.sessionId,['door-0001']);assert.equal(r.pulses.length,1);assert.equal(r.store.one('SELECT binding_digest FROM command_controller_binding').binding_digest,r.authority.controllerBindingDigest);
  assert.equal(r.store.one('SELECT authority FROM command_intent').authority,'RESTOCK');
});
