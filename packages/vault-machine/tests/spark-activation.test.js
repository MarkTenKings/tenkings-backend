const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs');
const { verifySparkActivation, protectedProductionPath, createSparkProductionAuthority } = require('../dist/spark-activation');
const { activationFixture } = require('./spark-activation-fixture');
const { tempDatabase } = require('./helpers');
test('signed activation consumes fresh promotion once and permits a bounded longer unattended lease', () => {
  const f=activationFixture(); const initial=verifySparkActivation(f.input); assert.equal(initial.bindingDigest,f.plan.bindingDigest);
  f.input.now+=2*86400000; assert.deepEqual(verifySparkActivation(f.input),initial);
  f.input.now+=6*86400000; assert.throws(()=>verifySparkActivation(f.input),{code:'SPARK_ACTIVATION_LEASE_EXPIRED'});
});
test('forged activation, substituted trust and absent records cannot authorize production', () => {
  for(const change of [f=>f.input.envelope.signature='A'.repeat(86)+'==',f=>f.input.activationPublicKey=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}),f=>delete f.input.evidence.CABINET_ACCEPTANCE,f=>f.input.releaseSignature=Buffer.alloc(64),f=>f.input.releasePublicKey=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})]) {
    const f=activationFixture();change(f);assert.throws(()=>verifySparkActivation(f.input));
  }
});
test('machine configuration provider controller release and credential generation bind independently',()=>{
  for(const change of [f=>f.input.context.machineId=crypto.randomUUID(),f=>f.input.context.machineConfigDigest='f'.repeat(64),f=>f.input.context.sourceCommit='f'.repeat(40),f=>f.input.context.paymentBindingDigest='f'.repeat(64),f=>f.input.context.controllerBindingDigest='f'.repeat(64),f=>f.input.controller.endpoints[0].expectedFirmwareRegister++,f=>f.input.provisioning.profile.credentialGeneration=crypto.randomUUID(),f=>f.input.releaseManifest=Buffer.from('{}'),f=>f.input.provisioning.profile.nayaxMachineId='71234997']){
    const f=activationFixture();change(f);assert.throws(()=>verifySparkActivation(f.input));
  }
});
test('hashes of arbitrary fixtures or declared synthetic evidence are not external acceptance',()=>{
  for(const change of [pair=>pair.record=Buffer.from('fixture passed'),pair=>{const r=JSON.parse(pair.record);r.evidenceClass='SYNTHETIC';pair.record=Buffer.from(JSON.stringify(r));},pair=>pair.artifact=Buffer.from('replaced report'),pair=>{const r=JSON.parse(pair.record);r.outcome='PENDING';pair.record=Buffer.from(JSON.stringify(r));}]){
    const f=activationFixture();change(f.input.evidence.CABINET_ACCEPTANCE);
    f.input.envelope.promotion.payload.evidence.find(e=>e.kind==='CABINET_ACCEPTANCE').sha256=f.hash(f.input.evidence.CABINET_ACCEPTANCE.record);f.resignPromotion();
    assert.throws(()=>verifySparkActivation(f.input));
  }
});
test('lease time bounds and stale issuance cannot resurrect approval; signed candidates remain ineligible',()=>{
  for(const change of [f=>{f.input.envelope.payload.expiresAt=new Date(f.input.now+31*86400000).toISOString();f.resign();},f=>f.input.now-=1,f=>{f.input.envelope.promotion.payload.expiresAt=new Date(f.input.now-1).toISOString();f.resignPromotion();},f=>f.input.sourceBuild.sourceState='UNCOMMITTED_CANDIDATE',f=>f.input.sourceBuild.releaseAuthorized=false,f=>f.input.sourceBuild.buildCompleted=false]){
    const f=activationFixture();change(f);assert.throws(()=>verifySparkActivation(f.input));
  }
});
test('operational factory has no developer/mock/simulator or unprotected trust-path activation escape',t=>{
  const tmp=tempDatabase();t.after(()=>fs.rmSync(tmp.directory,{recursive:true,force:true}));const file=tmp.directory+'/key.pem';fs.writeFileSync(file,'untrusted');
  assert.throws(()=>protectedProductionPath(file));fs.symlinkSync(file,tmp.directory+'/link.pem');assert.throws(()=>protectedProductionPath(tmp.directory+'/link.pem'));
  const f=activationFixture();assert.throws(()=>createSparkProductionAuthority({VAULT_RELEASE_ROOT:tmp.directory},f.input.context.machineId,f.input.controller));
  const {createAdapterRuntime}=require('../dist/adapter-runtime');
  assert.throws(()=>createAdapterRuntime({VAULT_PAYMENT_ADAPTER:'NAYAX_SPARK_PRODUCTION',VAULT_CONTROLLER_ADAPTER:'SIMULATOR'},tmp.path,f.input.context.machineId),/SPARK_PRODUCTION_PHYSICAL_AUTHORITY_REQUIRED/);
  assert.equal(fs.existsSync(tmp.path+'.spark-provider.sqlite'),false);
});
