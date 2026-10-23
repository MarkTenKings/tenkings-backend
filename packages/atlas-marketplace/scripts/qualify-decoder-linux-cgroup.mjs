#!/usr/bin/env node
// Explicit isolated-target harness. Creates one owned empty cgroup and moves an
// owned child into it. Freezes/kills that parent, proves empty, then operator-
// resets it. This is primitive evidence, not Docker or containment acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,rmdirSync,statSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {createProofDecoderLinuxCgroupController,assertProofDecoderLinuxCgroupController,assertProofDecoderKernelEmptyObservation} from '../src/proof-decoder-linux-cgroup.mjs';
import {loadProofDecoderLinuxPrimitives} from '../src/proof-decoder-linux-observer.mjs';

const [addonPath,addonSha256,expectedBootId]=process.argv.slice(2);
assert.equal(process.argv.length,5);assert.equal(process.getuid(),0);
const options={enabled:true,addonPath,addonSha256,expectedBootId};
const native=loadProofDecoderLinuxPrimitives(options),parent='/sys/fs/cgroup/atlasdecoder.slice';
const initialStat=statSync(parent,{bigint:true});
assert.equal(readdirSync(parent,{withFileTypes:true}).filter(item=>item.isDirectory()).length,0);
assert.match(readFileSync(parent+'/cgroup.events','utf8'),/^populated 0\nfrozen 0\n$/);
assert.equal(readFileSync(parent+'/cgroup.freeze','utf8'),'0\n');
async function until(predicate,ms=1500){const deadline=Date.now()+ms;while(!predicate()){assert.ok(Date.now()<deadline,'bounded kernel convergence');await delay(10);}}

test('default off, foreign handles, wrong boot and fabricated empty observations refuse',()=>{
  assert.equal(createProofDecoderLinuxCgroupController(),null);
  assert.throws(()=>assertProofDecoderLinuxCgroupController({}),{code:'DECODER_KERNEL_PARENT_REQUIRED'});
  assert.throws(()=>createProofDecoderLinuxCgroupController({...options,expectedBootId:'00000000-0000-0000-0000-000000000000'}),{code:'DECODER_KERNEL_BOOT'});
  for(const method of ['groupStatus','freezeAndKillGroup','closeGroup'])assert.throws(()=>native[method]({}));
  assert.throws(()=>native.captureGroup(1));assert.throws(()=>native.assertGroupMember({},process.pid,'0'.repeat(64)));
});

test('actual fixed-parent empty tokens stay branded and bind current controller/clock',()=>{
  const controller=createProofDecoderLinuxCgroupController(options),other=createProofDecoderLinuxCgroupController(options);
  try {
    const state=controller.status();assert.equal(state.parentName,'atlasdecoder.slice');assert.equal(state.device,String(initialStat.dev));assert.equal(state.inode,String(initialStat.ino));
    assert.equal(state.healthy,true);assert.equal(state.populated,false);assert.equal(state.classification,'UNQUALIFIED');
    const empty=controller.observeEmpty();assert.equal(assertProofDecoderKernelEmptyObservation(empty,{controller}),empty);
    assert.throws(()=>assertProofDecoderKernelEmptyObservation(JSON.parse(JSON.stringify(empty)),{controller}),{code:'DECODER_KERNEL_EMPTY_REQUIRED'});
    assert.throws(()=>assertProofDecoderKernelEmptyObservation(empty,{controller:other}),{code:'DECODER_KERNEL_EMPTY_REQUIRED'});
    assert.throws(()=>controller.assertMember({pid:process.pid,containerId:'0'.repeat(64)}));
    assert.equal(controller.boottimeNanoseconds()>=BigInt(empty.observedAtNs),true);
  }finally{controller.close();other.close();}
});

test('empty observation expires using actual BOOTTIME',{timeout:3000},async()=>{
  const controller=createProofDecoderLinuxCgroupController(options);
  try{const empty=controller.observeEmpty();await delay(1050);assert.throws(()=>assertProofDecoderKernelEmptyObservation(empty,{controller}),{code:'DECODER_KERNEL_EMPTY_STALE'});}
  finally{controller.close();}
});

test('close is final and releases only this handle',()=>{
  const controller=createProofDecoderLinuxCgroupController(options);controller.close();controller.close();
  assert.equal(controller.status().closed,true);assert.equal(controller.status().healthy,false);
  for(const call of [()=>controller.boottimeNanoseconds(),()=>controller.observeEmpty(),()=>controller.freezeAndKill()])assert.throws(call);
});

test('native supervisor notifications require exact systemd context and closed message choice',()=>{
  for(const mode of ['',null,{},'READY=1','arbitrary'])assert.throws(()=>native.notifySupervisor(mode),{code:'DECODER_NATIVE_NOTIFY'});
  assert.throws(()=>native.notifySupervisor('ready'),{code:'DECODER_NATIVE_NOTIFY_CONTEXT'});
  assert.throws(()=>native.notifySupervisor('watchdog'),{code:'DECODER_NATIVE_NOTIFY_CONTEXT'});
});

test('real member and descendant die under fixed-parent freeze/kill; quarantined token never releases',{timeout:8000},async()=>{
  const controller=createProofDecoderLinuxCgroupController(options),containerId=randomBytes(32).toString('hex');
  const scope=parent+'/docker-'+containerId+'.scope';let child,created=false,scopeStat,exited,grandchildPid;
  const childSource=`const {spawn}=require('node:child_process');process.send({ready:true});process.on('message',()=>{const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:'ignore'});process.send({pid:child.pid});});setInterval(()=>{},1000);`;
  try{
    mkdirSync(scope);created=true;scopeStat=statSync(scope,{bigint:true});
    child=spawn(process.execPath,['-e',childSource],{env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['ignore','ignore','ignore','ipc']});exited=once(child,'exit');
    await once(child,'message');writeFileSync(scope+'/cgroup.procs',String(child.pid));
    const grandchild=once(child,'message');child.send({spawn:true});[{pid:grandchildPid}]=await grandchild;
    assert.equal(controller.assertMember({pid:child.pid,containerId}),true);
    assert.equal(controller.assertMember({pid:grandchildPid,containerId}),true);
    assert.throws(()=>controller.assertMember({pid:child.pid,containerId:'f'.repeat(64)}));
    assert.throws(()=>controller.observeEmpty(),{code:'DECODER_KERNEL_PARENT_NOT_EMPTY'});
    const before=controller.boottimeNanoseconds();controller.freezeAndKill();
    const [code,signal]=await exited;assert.equal(code,null);assert.equal(signal,'SIGKILL');
    await until(()=>!controller.status().populated);
    assert.equal(controller.status().freezeRequested,true);assert.equal(controller.status().healthy,false);
    assert.equal(controller.boottimeNanoseconds()>=before,true);
    assert.throws(()=>controller.observeEmpty(),{code:'DECODER_KERNEL_PARENT_NOT_EMPTY'});
    // Explicit operator fixture cleanup only. The production controller has no
    // thaw API, and this quarantined controller must remain unusable afterward.
    assert.equal(statSync(parent,{bigint:true}).ino,initialStat.ino);
    assert.equal(statSync(scope,{bigint:true}).ino,scopeStat.ino);
    assert.match(readFileSync(parent+'/cgroup.events','utf8'),/^populated 0\n/);
    writeFileSync(parent+'/cgroup.freeze','0');await until(()=>readFileSync(parent+'/cgroup.events','utf8').includes('frozen 0\n'));
    assert.throws(()=>controller.observeEmpty(),{code:'DECODER_KERNEL_PARENT_NOT_EMPTY'});
    rmdirSync(scope);created=false;
  }finally{
    if(child&&child.exitCode===null&&child.signalCode===null){try{controller.freezeAndKill();}catch{}await Promise.race([exited,delay(1500)]);}
    controller.close();
    // If anything is uncertain, leave the parent frozen and owned fixture in
    // place for explicit operator inspection. No unconditional destructive reset.
    if(created)process.stderr.write('OWNED_CGROUP_FIXTURE_HELD\n');
  }
});
