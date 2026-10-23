import {canonicalJSON,hash,requireValue} from './contract.mjs';

// Source contracts only. This module neither invokes Docker nor qualifies a
// target. The future image must implement this fixed layout; no image exists
// merely because a caller supplies a digest here.
export const PROOF_DECODER_PROFILE_LIMITS=Object.freeze({maxObjectBytes:10485760,maxPixels:16000000,timeoutMs:15000,maxConcurrent:2});
export const PROOF_DECODER_IMAGE_LAYOUT=Object.freeze({node:'/opt/atlas-proof-decoder/bin/node',worker:'/opt/atlas-proof-decoder/worker.mjs'});
export const PROOF_DECODER_RUNTIME_ENVIRONMENT=Object.freeze({HOME:'/nonexistent',HOSTNAME:'atlas-proof-decoder',PATH:'/opt/atlas-proof-decoder/bin',UV_THREADPOOL_SIZE:'1',VIPS_CONCURRENCY:'1'});

export function decoderContractData(input) {
  const seen=new Set();let nodes=0;
  const visit=(value,depth)=>{
    requireValue(++nodes<=4096&&depth<=12,'DECODER_CONTRACT_INVALID');
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='string'){requireValue(value.length<=8192,'DECODER_CONTRACT_INVALID');return value;}
    if(typeof value==='number'){requireValue(Number.isSafeInteger(value),'DECODER_CONTRACT_INVALID');return value;}
    requireValue(value&&typeof value==='object'&&!seen.has(value),'DECODER_CONTRACT_INVALID');
    const array=Array.isArray(value);requireValue(Object.getPrototypeOf(value)===(array?Array.prototype:Object.prototype),'DECODER_CONTRACT_INVALID');
    seen.add(value);const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors),result=array?[]:{};
    requireValue(keys.every(key=>typeof key==='string'),'DECODER_CONTRACT_INVALID');
    for(const key of keys){
      if(array&&key==='length')continue;
      const descriptor=descriptors[key];
      requireValue(descriptor.enumerable&&Object.hasOwn(descriptor,'value')&&!['__proto__','prototype','constructor'].includes(key),'DECODER_CONTRACT_INVALID');
      if(array)requireValue(/^(0|[1-9][0-9]*)$/.test(key)&&Number(key)===result.length,'DECODER_CONTRACT_INVALID');
      result[key]=visit(descriptor.value,depth+1);
    }
    if(array)requireValue(result.length===value.length,'DECODER_CONTRACT_INVALID');
    seen.delete(value);return result;
  };
  return visit(input,0);
}
export function decoderExact(value,keys) {requireValue(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),'DECODER_CONTRACT_INVALID');}
export function decoderFreeze(value) {if(value&&typeof value==='object'){for(const child of Object.values(value))decoderFreeze(child);Object.freeze(value);}return value;}
export function decoderToken(value) {requireValue(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value),'DECODER_CONTRACT_INVALID');return value;}
export function decoderDigest(value) {requireValue(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'DECODER_CONTRACT_INVALID');return value;}
const integer=(value,min=1,max=Number.MAX_SAFE_INTEGER)=>requireValue(Number.isSafeInteger(value)&&value>=min&&value<=max,'DECODER_PROFILE_INVALID');

function normalizeProfile(input) {
  const profile=decoderContractData(input);
  decoderExact(profile,['schema','targetRef','image','platform','nodeVersion','uid','gid','limits','resources','seccomp','mac','ipc','artifactHashes']);
  requireValue(profile.schema==='atlas-proof-decoder-profile-v1','DECODER_PROFILE_INVALID');decoderToken(profile.targetRef);
  // Digest required; no mutable tag, credentials, URL, shell syntax or flags.
  requireValue(typeof profile.image==='string'&&profile.image.length<=512&&/^[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[1-9][0-9]{0,4})?\/(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/.test(profile.image),'DECODER_PROFILE_INVALID');
  requireValue(['linux/amd64','linux/arm64'].includes(profile.platform)&&/^22\.(?:1[6-9]|[2-9][0-9]|[1-9][0-9]{2,})\.[0-9]+$/.test(profile.nodeVersion),'DECODER_PROFILE_INVALID');
  integer(profile.uid,1,2147483647);integer(profile.gid,1,2147483647);
  decoderExact(profile.limits,Object.keys(PROOF_DECODER_PROFILE_LIMITS));
  for(const [key,max] of Object.entries(PROOF_DECODER_PROFILE_LIMITS))integer(profile.limits[key],1,max);
  decoderExact(profile.resources,['memoryBytes','cpuQuotaMicros','cpuPeriodMicros','pidsLimit','nofileLimit','tmpfsBytes','shmBytes']);
  const r=profile.resources;integer(r.memoryBytes,6*1024*1024);integer(r.cpuQuotaMicros,1000);integer(r.cpuPeriodMicros,1000,1000000);integer(r.pidsLimit);integer(r.nofileLimit);integer(r.tmpfsBytes,1,r.memoryBytes);integer(r.shmBytes,1,r.memoryBytes);
  decoderExact(profile.seccomp,['path','sha256']);decoderDigest(profile.seccomp.sha256);
  requireValue(typeof profile.seccomp.path==='string'&&profile.seccomp.path.length<=1024&&/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(profile.seccomp.path)&&profile.seccomp.path.split('/').every(part=>part!=='.'&&part!=='..'),'DECODER_PROFILE_INVALID');
  decoderExact(profile.mac,['kind','name']);
  requireValue(['apparmor','selinux'].includes(profile.mac.kind)&&typeof profile.mac.name==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(profile.mac.name)&&!['unconfined','disable','docker-default'].includes(profile.mac.name),'DECODER_PROFILE_INVALID');
  if(profile.mac.kind==='selinux')requireValue(profile.mac.name.endsWith('_t'),'DECODER_PROFILE_INVALID');
  decoderExact(profile.ipc,['socketPath','supervisorUid','supervisorGid','clientUid','clientGid']);
  requireValue(typeof profile.ipc.socketPath==='string'&&profile.ipc.socketPath.length<=100&&/^\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.sock$/.test(profile.ipc.socketPath)&&profile.ipc.socketPath.split('/').every(part=>part!=='.'&&part!=='..'),'DECODER_PROFILE_INVALID');
  integer(profile.ipc.supervisorUid,0,2147483647);integer(profile.ipc.supervisorGid,0,2147483647);integer(profile.ipc.clientUid,1,2147483647);integer(profile.ipc.clientGid,1,2147483647);
  requireValue(profile.ipc.clientUid!==profile.ipc.supervisorUid,'DECODER_PROFILE_INVALID');
  decoderExact(profile.artifactHashes,['worker','dependencyLock','supervisor','watchdog']);Object.values(profile.artifactHashes).forEach(decoderDigest);
  return profile;
}

function build(profile) {
  const r=profile.resources;
  const createArguments=['create','--pull=never',`--platform=${profile.platform}`,'--read-only','--network=none','--ipc=private','--cgroupns=private','--cap-drop=ALL','--security-opt=no-new-privileges=true',`--security-opt=seccomp=${profile.seccomp.path}`,`--security-opt=${profile.mac.kind==='apparmor'?'apparmor='+profile.mac.name:'label=type:'+profile.mac.name}`,`--user=${profile.uid}:${profile.gid}`,`--memory=${r.memoryBytes}`,`--memory-swap=${r.memoryBytes}`,`--cpu-quota=${r.cpuQuotaMicros}`,`--cpu-period=${r.cpuPeriodMicros}`,`--pids-limit=${r.pidsLimit}`,`--ulimit=nofile=${r.nofileLimit}:${r.nofileLimit}`,'--ulimit=core=0:0',`--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=${r.tmpfsBytes},uid=${profile.uid},gid=${profile.gid},mode=0700`,`--shm-size=${r.shmBytes}`,'--restart=no','--no-healthcheck','--log-driver=none','--hostname=atlas-proof-decoder',...Object.entries(PROOF_DECODER_RUNTIME_ENVIRONMENT).map(([key,value])=>`--env=${key}=${value}`),'--interactive','--attach=stdin','--attach=stdout','--attach=stderr',`--entrypoint=${PROOF_DECODER_IMAGE_LAYOUT.node}`,profile.image,'--max-old-space-size=128',PROOF_DECODER_IMAGE_LAYOUT.worker];
  return decoderFreeze({schema:'atlas-proof-decoder-launch-plan-v1',status:'UNQUALIFIED',executionAllowed:false,profile,profileHash:hash(profile),limitsHash:hash(profile.limits),createArguments});
}

/** Default off. Returned tokens are inert review material, never authorization
 * to execute. Runtime must independently exclude image-defined volumes/env,
 * observe realized controls and supervise/reap every owned job. */
export function createProofDecoderLaunchPlan(options={}) {
  const value=decoderContractData(options);requireValue(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).every(key=>['enabled','profile'].includes(key)),'DECODER_CONTRACT_INVALID');
  const enabled=Object.hasOwn(value,'enabled')?value.enabled:false;requireValue(typeof enabled==='boolean','DECODER_PROFILE_INVALID');
  if(!enabled)return null;
  return build(normalizeProfile(value.profile));
}

/** Structural agreement only: no WeakSet capability or execution authority. */
export function assertProofDecoderLaunchPlan(plan) {
  const data=decoderContractData(plan);decoderExact(data,['schema','status','executionAllowed','profile','profileHash','limitsHash','createArguments']);
  const expected=build(normalizeProfile(data.profile));requireValue(canonicalJSON(data)===canonicalJSON(expected),'DECODER_LAUNCH_PLAN_CHANGED');return expected;
}
