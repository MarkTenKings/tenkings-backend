import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadProofDecoderLinuxPrimitives} from './proof-decoder-linux-observer.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';

const controllers=new WeakMap(),observations=new WeakMap();
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const check=(value,code='DECODER_KERNEL_PARENT_REQUIRED')=>{if(!value)fail(code);};
const parentName='atlasdecoder.slice',parentPath='/sys/fs/cgroup/atlasdecoder.slice';
const bootPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Concrete Linux fixed-parent controller. Still UNQUALIFIED and no admission
 * authority. Captures protected cgroup descriptors; never accepts a path,
 * observation callback, thaw command, JSON receipt, or PID kill target. */
export function createProofDecoderLinuxCgroupController(options={}) {
  const {enabled=false,addonPath,addonSha256,expectedBootId}=engineDataOptions(options,[],['enabled','addonPath','addonSha256','expectedBootId']);
  if(enabled!==true)return null;
  check(typeof expectedBootId==='string'&&bootPattern.test(expectedBootId),'DECODER_KERNEL_BOOT');
  const bootId=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
  check(bootId===expectedBootId,'DECODER_KERNEL_BOOT');
  const native=loadProofDecoderLinuxPrimitives({enabled,addonPath,addonSha256});
  check(['captureGroup','groupStatus','freezeAndKillGroup','closeGroup','assertGroupMember'].every(key=>typeof native[key]==='function'),'DECODER_KERNEL_ADDON');
  const group=native.captureGroup();
  let closed=false,quarantined=false,initial;
  try{initial=native.groupStatus(group);check(initial.healthy&&!initial.closed,'DECODER_KERNEL_PARENT_UNAVAILABLE');}
  catch(error){native.closeGroup(group);throw error;}
  const {device,inode}=initial;
  check(/^[0-9]+$/.test(device)&&/^[0-9]+$/.test(inode),'DECODER_KERNEL_PARENT_UNAVAILABLE');
  const bindingHash=createHash('sha256').update(JSON.stringify({schema:'atlas-proof-decoder-kernel-parent-binding-v1',bootId,parentName,parentPath,device,inode,addonSha256})).digest('hex');
  const status=()=>{
    const observed=native.groupStatus(group);
    const healthy=!closed&&!quarantined&&observed.healthy&&!observed.closed&&!observed.quarantined&&observed.device===device&&observed.inode===inode;
    return Object.freeze({schema:'atlas-proof-decoder-kernel-parent-v1',classification:'UNQUALIFIED',evidenceOrigin:'LINUX_KERNEL',parentName,parentPath,bootId,bindingHash,device,inode,addonSha256,
      populated:observed.populated,freezeRequested:observed.freezeRequested,frozen:observed.frozen,closed,healthy});
  };
  const clock=()=>{check(!closed,'DECODER_KERNEL_PARENT_CLOSED');const value=native.boottimeNanoseconds();check(typeof value==='bigint'&&value>=0n&&value<=18446744073709551615n,'DECODER_NATIVE_CLOCK');return value;};
  const empty=()=>{const value=status();check(value.healthy&&!value.populated&&!value.freezeRequested&&!value.frozen,'DECODER_KERNEL_PARENT_NOT_EMPTY');return value;};
  const controller=Object.freeze({status,boottimeNanoseconds:clock,
    observeEmpty(){
      empty();const observedAtNs=clock().toString();empty();
      const token=Object.freeze({schema:'atlas-proof-decoder-kernel-empty-v1',bootId,bindingHash,parentName,device,inode,observedAtNs,populated:false,freezeRequested:false,frozen:false});
      observations.set(token,{controller,observedAtNs:BigInt(observedAtNs)});return token;
    },
    assertMember(options={}){
      const {pid,containerId}=engineDataOptions(options,['pid','containerId']);
      check(Number.isSafeInteger(pid)&&pid>0&&pid<=2147483647&&typeof containerId==='string'&&/^[a-f0-9]{64}$/.test(containerId),'DECODER_KERNEL_MEMBER');
      const state=status();check(state.healthy&&!state.freezeRequested&&!state.frozen,'DECODER_KERNEL_MEMBER');
      check(native.assertGroupMember(group,pid,containerId)===true,'DECODER_KERNEL_MEMBER');return true;
    },
    freezeAndKill(){
      check(!closed,'DECODER_KERNEL_PARENT_CLOSED');quarantined=true;
      native.freezeAndKillGroup(group);return status();
    },
    close(){if(!closed){closed=true;native.closeGroup(group);}}
  });
  controllers.set(controller,{empty,clock});return controller;
}

export function assertProofDecoderLinuxCgroupController(value) {
  check(controllers.has(value));return value;
}

/** An empty parent is necessary but never sufficient for ledger release. The
 * target ledger separately requires settled concrete Engine cleanup receipts. */
export function assertProofDecoderKernelEmptyObservation(value,options={}) {
  const {controller}=engineDataOptions(options,['controller']);
  const state=controllers.get(assertProofDecoderLinuxCgroupController(controller));
  const known=observations.get(value);check(known?.controller===controller,'DECODER_KERNEL_EMPTY_REQUIRED');
  const now=state.clock();check(now>=known.observedAtNs&&now-known.observedAtNs<=1000000000n,'DECODER_KERNEL_EMPTY_STALE');
  state.empty();return value;
}
