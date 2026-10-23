import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {createProofDecoderLinuxCgroupController} from '../src/proof-decoder-linux-cgroup.mjs';
import {openProofDecoderTargetRegistry,assertProofDecoderTargetRegistry} from '../src/proof-decoder-target-registry.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';

const plan=createProofDecoderLaunchPlan({enabled:true,profile:syntheticDecoderProfile()});
const request=(durationMs=1000)=>({requestId:randomUUID(),requestPlan:{byteCount:1,sha256:'a'.repeat(64),declaredType:'image/png'},durationMs});
const files=directory=>Object.fromEntries(readdirSync(directory).sort().map(name=>[name,readFileSync(join(directory,name))]));

test('target ledger is default off; no caller-shaped controller or registry is accepted',()=>{
  assert.equal(openProofDecoderTargetRegistry(),null);
  assert.throws(()=>assertProofDecoderTargetRegistry({classification:'UNQUALIFIED',bindingHash:'a'.repeat(64)}),{code:'DECODER_TARGET_REGISTRY_REQUIRED'});
  assert.throws(()=>openProofDecoderTargetRegistry({enabled:true,plan,controller:{status:()=>({healthy:true})},epoch:'forged'}),{code:'DECODER_KERNEL_PARENT_REQUIRED'});
});
test('target ledger options are closed data properties and never invoke getters',()=>{
  let called=false;
  assert.throws(()=>openProofDecoderTargetRegistry({get enabled(){called=true;return true;}}));
  assert.equal(called,false);
  assert.throws(()=>openProofDecoderTargetRegistry({enabled:false,finalized:true}));
});

// Explicit target-only metadata harness:
// node THIS_FILE ADDON_PATH ADDON_SHA256 BOOT_ID NEW_PRIVATE_DIRECTORY
// No Engine calls, image bytes, worker execution, freeze/kill or fake receipts.
// Owned metadata fixtures remain for inspection; this file never removes them.
const args=process.argv.slice(2);
assert.ok(args.length===0||args.length===4,'provide either no target inputs or all four explicit inputs');
if(args.length===4){
  assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.versions.node,'22.16.0');
  const [addonPath,addonSha256,expectedBootId,base]=args;
  mkdirSync(base,{mode:0o700});
  const controller=createProofDecoderLinuxCgroupController({enabled:true,addonPath,addonSha256,expectedBootId});
  after(()=>controller.close());
  const epoch='METADATA_ONLY_'+randomUUID();let number=0;
  function fixture(t){const directory=join(base,String(++number));const registry=openProofDecoderTargetRegistry({enabled:true,directory,plan,controller,epoch});t.after(()=>registry.close());return {directory,registry};}

  test('real kernel clock/binding and empty store clean reopen; wrong epoch cannot adopt it',t=>{
    const {directory,registry}=fixture(t);
    assert.equal(assertProofDecoderTargetRegistry(registry,{plan,controller}),registry);
    assert.equal(registry.status().occupiedSlots,0);assert.equal(registry.status().poisoned,false);
    assert.equal(registry.status().bootId,expectedBootId);assert.equal(registry.parentBindingHash,controller.status().bindingHash);
    registry.close();const before=files(directory);
    assert.throws(()=>openProofDecoderTargetRegistry({enabled:true,directory,ownership:registry.ownership,plan,controller,epoch:epoch+'_wrong'}),{code:'DECODER_TARGET_OWNERSHIP_REQUIRED'});
    assert.deepEqual(files(directory),before);
    const reopened=openProofDecoderTargetRegistry({enabled:true,directory,ownership:registry.ownership,plan,controller,epoch});
    try{assert.equal(reopened.status().occupiedSlots,0);assert.equal(reopened.bindingHash,registry.bindingHash);}finally{reopened.close();}
  });

  test('exclusive writer, one slot, immutable request and committed intent before acknowledgement',t=>{
    const {directory,registry}=fixture(t);
    const child=`const base=process.argv[1];const {openProofDecoderTargetRegistry}=await import(new URL('proof-decoder-target-registry.mjs',base));const {createProofDecoderLinuxCgroupController}=await import(new URL('proof-decoder-linux-cgroup.mjs',base));const [addonPath,addonSha256,expectedBootId,directory,plan,epoch]=JSON.parse(process.argv[2]);const controller=createProofDecoderLinuxCgroupController({enabled:true,addonPath,addonSha256,expectedBootId});try{openProofDecoderTargetRegistry({enabled:true,directory,plan,controller,epoch});process.exitCode=2;}catch(error){if(error.code!=='DECODER_TARGET_WRITER_LOCKED')throw error;}finally{controller.close();}`;
    const blocked=spawnSync(process.execPath,['--input-type=module','-e',child,new URL('../src/',import.meta.url).href,JSON.stringify([addonPath,addonSha256,expectedBootId,directory,plan,epoch])],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
    assert.equal(blocked.status,0,blocked.stderr);
    const input=request(),row=registry.reserve(input);input.requestPlan.sha256='b'.repeat(64);
    assert.equal(registry.get(row.identity.jobId).requestPlan.sha256,'a'.repeat(64));
    assert.equal(BigInt(row.deadlineAtNs)-BigInt(row.createdAtNs),1000000000n);
    assert.throws(()=>registry.reserve({...request(),requestId:row.identity.requestId}),{code:'DECODER_TARGET_REPLAY'});
    assert.throws(()=>registry.reserve(request()),{code:'DECODER_TARGET_BUSY'});
    assert.throws(()=>registry.beginEffect(row.identity.jobId,0,{operation:'START',requestHash:'c'.repeat(64)}),{code:'DECODER_TARGET_ORDER'});
    const intent=registry.beginEffect(row.identity.jobId,0,{operation:'CREATE',requestHash:'c'.repeat(64)});
    const probe=new DatabaseSync(join(directory,'target.sqlite'),{readOnly:true});
    try{const persisted=JSON.parse(probe.prepare('SELECT record FROM jobs WHERE id=?').get(row.identity.jobId).record);assert.deepEqual(persisted,intent.record);assert.equal(probe.prepare('SELECT count(*) AS n FROM events').get().n,2);}finally{probe.close();}
    assert.throws(()=>registry.beginEffect(row.identity.jobId,0,{operation:'CREATE',requestHash:'c'.repeat(64)}),{code:'DECODER_TARGET_CAS'});
    assert.throws(()=>registry.beginEffect(row.identity.jobId,intent.revision,{operation:'CREATE',requestHash:'c'.repeat(64)}),{code:'DECODER_TARGET_ORDER'});
    assert.equal(registry.status().poisoned,false);
  });

  test('unknown intent survives poison, current empty and stale lock; JSON cannot settle it',t=>{
    const {directory,registry}=fixture(t);const row=registry.reserve(request());
    const intent=registry.beginEffect(row.identity.jobId,0,{operation:'CREATE',requestHash:'c'.repeat(64)});
    assert.throws(()=>registry.observeEffect(row.identity.jobId,intent.revision,{operationId:intent.operationId,receipt:{status:404,settled:true}}),{code:'ENGINE_TARGET_EFFECT_RECEIPT_REQUIRED'});
    const held=registry.get(row.identity.jobId);assert.equal(held.phase,'CREATE_INTENT');assert.deepEqual(held.effects,intent.record.effects);
    const barrier=registry.enterCleanupBarrier(row.identity.jobId,held.revision);
    assert.throws(()=>registry.finalize(row.identity.jobId,barrier.revision,{settledCleanup:{settled:true},nativeEmpty:controller.observeEmpty()}),{code:'DECODER_TARGET_POISONED'});
    registry.quarantineEpoch({reason:'LATER_EMPTY'});assert.equal(registry.status().reason,'EFFECT_UNCERTAIN');assert.equal(registry.status().occupiedSlots,1);
    registry.close();const before=files(directory);
    assert.throws(()=>openProofDecoderTargetRegistry({enabled:true,directory,ownership:registry.ownership,plan,controller,epoch}),{code:'DECODER_TARGET_WRITER_LOCKED'});
    assert.deepEqual(files(directory),before);
    const probe=new DatabaseSync(join(directory,'target.sqlite'),{readOnly:true});try{assert.equal(JSON.parse(probe.prepare('SELECT state FROM metadata').get().state).poisoned,true);}finally{probe.close();}
  });

  test('genuine current empty never substitutes for an Engine cleanup receipt',t=>{
    const {registry}=fixture(t),row=registry.reserve(request());
    const barrier=registry.enterCleanupBarrier(row.identity.jobId,row.revision);
    assert.throws(()=>registry.finalize(row.identity.jobId,barrier.revision,{settledCleanup:{classification:'UNQUALIFIED',confirmed:true},nativeEmpty:controller.observeEmpty()}),{code:'ENGINE_TARGET_CLEANUP_RECEIPT_REQUIRED'});
    assert.equal(registry.status().occupiedSlots,1);assert.equal(registry.status().poisoned,true);
  });

  test('real BOOTTIME deadline expiration poisons without granting a CREATE retry',async t=>{
    const {registry}=fixture(t),row=registry.reserve(request(1));await delay(10);
    assert.throws(()=>registry.beginEffect(row.identity.jobId,0,{operation:'CREATE',requestHash:'c'.repeat(64)}),{code:'DECODER_TARGET_DEADLINE'});
    assert.equal(registry.get(row.identity.jobId).effects.length,0);assert.equal(registry.status().reason,'DEADLINE');assert.equal(registry.status().occupiedSlots,1);
    assert.throws(()=>registry.reserve(request()),{code:'DECODER_TARGET_POISONED'});
  });

  test('explicit BOOTTIME deadline is exact and never extended; ambiguous or expired forms refuse',async t=>{
    const {directory,registry}=fixture(t),{durationMs,...input}=request();
    const deadlineBootNs=String(controller.boottimeNanoseconds()+2000000000n);
    assert.throws(()=>registry.reserve({...input,durationMs,deadlineBootNs}));
    assert.equal(registry.status().occupiedSlots,0);
    await delay(20);const row=registry.reserve({...input,deadlineBootNs});
    assert.equal(row.deadlineAtNs,deadlineBootNs);assert.ok(BigInt(row.deadlineAtNs)-BigInt(row.createdAtNs)<1985000000n);
    const probe=new DatabaseSync(join(directory,'target.sqlite'),{readOnly:true});
    try{assert.equal(JSON.parse(probe.prepare('SELECT record FROM jobs').get().record).deadlineAtNs,deadlineBootNs);}finally{probe.close();}
    for(const delta of [-1n,BigInt(plan.profile.limits.timeoutMs+1000)*1000000n]){
      const {registry:refused}=fixture(t);
      assert.throws(()=>refused.reserve({...input,requestId:randomUUID(),deadlineBootNs:String(controller.boottimeNanoseconds()+delta)}),{code:'DECODER_TARGET_DEADLINE'});
      assert.equal(refused.status().occupiedSlots,0);assert.equal(refused.snapshot().jobs.length,0);
    }
  });

  test('every SQLite sidecar refuses before recovery and preserves exact fixture bytes',t=>{
    for(const suffix of ['-journal','-wal','-shm']){const {directory,registry}=fixture(t);registry.close();writeFileSync(join(directory,'target.sqlite'+suffix),Buffer.alloc(512,0x31),{mode:0o600,flag:'wx'});const before=files(directory);
      assert.throws(()=>openProofDecoderTargetRegistry({enabled:true,directory,ownership:registry.ownership,plan,controller,epoch}),{code:'DECODER_TARGET_RECOVERY_REQUIRED'});assert.deepEqual(files(directory),before);}
  });
}
