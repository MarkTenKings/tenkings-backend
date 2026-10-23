import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalJSON} from '../src/contract.mjs';
import {PROOF_DECODER_IMAGE_LAYOUT,PROOF_DECODER_RUNTIME_ENVIRONMENT} from '../src/proof-decoder-profile.mjs';
import {PROOF_DECODER_REQUIRED_CASES} from '../src/proof-decoder-qualification.mjs';
import {renderProofDecoderSecurityArtifacts,PROOF_DECODER_SECURITY_PINS} from '../scripts/render-proof-decoder-security.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const asset=name=>readFileSync(new URL('../security/proof-decoder/'+name,import.meta.url));
const seccompBytes=asset('seccomp-linux-amd64-v1.json'),seccomp=JSON.parse(seccompBytes),limitsBytes=asset('limits-v1.json'),limits=JSON.parse(limitsBytes),template=asset('apparmor-v1.template').toString();
const action=(name,args=[])=>{const rules=seccomp.syscalls.filter(rule=>rule.names.includes(name)&&(rule.args??[]).every(arg=>arg.op==='SCMP_CMP_EQ'&&args[arg.index]===arg.value));assert.ok(rules.length<=1);return rules.length?{action:rules[0].action,errno:rules[0].errnoRet??null}:{action:seccomp.defaultAction,errno:seccomp.defaultErrnoRet};};
const allowed={action:'SCMP_ACT_ALLOW',errno:null},denied={action:'SCMP_ACT_ERRNO',errno:1};

test('seccomp candidate keeps architecture/default deny and denies privilege, new sockets and namespace variants',()=>{
  assert.equal(seccompBytes.toString(),canonicalJSON(seccomp)+'\n');assert.deepEqual(seccomp.architectures,['SCMP_ARCH_X86_64']);
  for(const name of ['socket','socketpair','connect','bind','listen','accept','accept4','fork','vfork','execveat','unshare','setns','mount','umount2','pivot_root','chroot','bpf','ptrace','process_vm_readv','process_vm_writev','pidfd_getfd','perf_event_open','keyctl','add_key','request_key','userfaultfd','io_uring_setup','io_uring_enter','io_uring_register','memfd_create','setuid','setgid','setresuid','setresgid','setgroups','capset','unknown_future_call'])assert.deepEqual(action(name),denied,name);
  assert.deepEqual(action('clone',[0x3d0f00]),allowed);
  for(const flags of [0,17,0x3d0f00|17,0x3d0f00|0x10000000,0x3d0f00|0x20000000,0x3d0f00|0x40000000,0x3d0f00|0x20000,0x3d0f00|0x02000000,0x3d0f00|0x04000000,0x3d0f00|0x08000000,0x3d0f00^0x10000])assert.deepEqual(action('clone',[flags]),denied,String(flags));
  assert.deepEqual(action('clone3'),{action:'SCMP_ACT_ERRNO',errno:38});
  assert.deepEqual(action('prctl',[15]),allowed);assert.deepEqual(action('prctl',[4]),denied);assert.deepEqual(action('prctl',[22]),denied);assert.deepEqual(action('ioctl',[1,0x541b]),allowed);assert.deepEqual(action('ioctl',[1,0x5412]),denied);
});
test('AppArmor source has one pinned ABI, no host abstractions, no ambient execute/map and no broad proc read',()=>{
  assert.equal((template.match(/^abi /gm)??[]).length,1);assert.ok(template.includes('abi <abi/4.0>,'));assert.equal((template.match(/@@INVENTORY_RULES@@/g)??[]).length,1);
  assert.ok(!template.includes('#include'));assert.ok(!template.includes('attach_disconnected'));assert.ok(!template.includes('complain'));assert.ok(!template.includes('/proc/** r'));
  assert.ok(template.includes('owner /tmp/** rwk,'));assert.ok(template.includes('owner /dev/shm/** rwk,'));assert.ok(template.includes('deny ptrace (read, trace, tracedby),'));assert.ok(template.includes('ptrace (readby) peer=unconfined,'));
  assert.ok(!/^\s*(?:file|network|capability|mount)\s*,/m.test(template));
});
test('limits preserve the immutable worker command and conservative one-worker resource contract',()=>{
  assert.equal(limitsBytes.toString(),canonicalJSON(limits)+'\n');assert.equal(limits.image,PROOF_DECODER_SECURITY_PINS.image);
  assert.deepEqual(limits.limits,{maxObjectBytes:10485760,maxPixels:16000000,timeoutMs:15000,maxConcurrent:1});
  assert.deepEqual(limits.resources,{memoryBytes:536870912,cpuQuotaMicros:150000,cpuPeriodMicros:100000,pidsLimit:32,nofileLimit:64,tmpfsBytes:8388608,shmBytes:8388608});
  assert.deepEqual(limits.fixedControls.command,[PROOF_DECODER_IMAGE_LAYOUT.node,'--max-old-space-size=128',PROOF_DECODER_IMAGE_LAYOUT.worker]);assert.equal(limits.uid,65532);assert.equal(limits.gid,65532);
  assert.equal(limits.executionAllowed,false);assert.equal(limits.freshPublicationAllowed,false);assert.deepEqual(Object.keys(PROOF_DECODER_RUNTIME_ENVIRONMENT).sort(),['HOME','HOSTNAME','PATH','UV_THREADPOOL_SIZE','VIPS_CONCURRENCY']);
});
test('qualification design includes each existing case ID once and starts every case NOT_RUN',()=>{
  const document=readFileSync(new URL('../PROOF_DECODER_TARGET_QUALIFICATION.md',import.meta.url),'utf8');
  const rows=[...document.matchAll(/^\| `([A-Z_]+)` \|[^\n]+\| NOT_RUN \|$/gm)].map(match=>match[1]);assert.deepEqual(rows,PROOF_DECODER_REQUIRED_CASES);
  assert.ok(document.includes('PROBE_ONLY'));assert.ok(document.includes('restartReconcilesOwned'));assert.ok(document.includes('No automatic thaw'));
});
test('renderer rejects accessors, unknown inputs, wrong types/counts and byte-pin substitutions before rendering',()=>{
  let called=false;assert.throws(()=>renderProofDecoderSecurityArtifacts({get inventoryBytes(){called=true;return Buffer.alloc(32877);},abiBytes:Buffer.alloc(2205)}));assert.equal(called,false);
  for(const input of [{},{inventoryBytes:Buffer.alloc(32877),abiBytes:Buffer.alloc(2205),execute:true},{inventoryBytes:'inventory',abiBytes:Buffer.alloc(2205)},{inventoryBytes:Buffer.alloc(32878),abiBytes:Buffer.alloc(2205)},{inventoryBytes:Buffer.alloc(32877),abiBytes:Buffer.alloc(2205)}])assert.throws(()=>renderProofDecoderSecurityArtifacts(input));
});

// Explicit public metadata inputs are needed for the two positive pure cases.
// They are not host attestations. No default path or environment discovery.
const args=process.argv.slice(2);assert.ok(args.length===0||args.length===2,'Provide INVENTORY_JSON ABI_4_0 together');
if(args.length===2){
  const inventoryBytes=readFileSync(args[0]),abiBytes=readFileSync(args[1]);
  test('exact inventory/ABI render deterministic hash-bound candidate with only inventoried read and map grants',()=>{
    const rendered=renderProofDecoderSecurityArtifacts({inventoryBytes,abiBytes}),repeat=renderProofDecoderSecurityArtifacts({inventoryBytes,abiBytes});
    assert.deepEqual(rendered.receipt,repeat.receipt);assert.deepEqual(rendered.apparmorBytes,repeat.apparmorBytes);assert.equal(rendered.receipt.seccompSha256,sha(rendered.seccompBytes));assert.equal(rendered.receipt.apparmor.renderedSha256,sha(rendered.apparmorBytes));assert.equal(rendered.receipt.apparmor.abiSha256,sha(abiBytes));
    const name=rendered.receipt.apparmor.profileName,text=rendered.apparmorBytes.toString(),unbound=text.replaceAll(name,'@@NAME@@');assert.equal(name,'atlas_r2_decoder_'+sha(Buffer.from(unbound)));
    const grants=[...text.matchAll(/^  "([^"]+)" ([a-z]+),$/gm)],entries=JSON.parse(inventoryBytes).files;
    assert.deepEqual(grants.filter(row=>row[2].includes('x')).map(row=>row[1]),[PROOF_DECODER_IMAGE_LAYOUT.node]);assert.equal(grants.filter(row=>row[2].includes('m')).length,12);
    for(const grant of grants){assert.ok(!/[*?{}\[\]]/.test(grant[1]));assert.ok(!/[wkl]/.test(grant[2]));if(!grant[1].endsWith('/'))assert.ok(entries.some(entry=>'/'+entry.path===grant[1]));}
    assert.equal(rendered.receipt.inventoryRules.fileCount,145);assert.equal(rendered.receipt.apparmor.parserVersion,'4.0.1');assert.equal(rendered.receipt.apparmor.abiName,'4.0');
    for(const key of ['kernelApplied','functionalWorkerTested','hostileControlsTested','runtimeQualified'])assert.equal(rendered.receipt[key],false);assert.equal(rendered.executionAllowed,false);assert.equal(rendered.freshPublicationAllowed,false);
  });
  test('changed public inputs refuse and returned buffers never alter subsequent candidate rendering',()=>{
    for(const key of ['inventoryBytes','abiBytes']){const changed={inventoryBytes:Buffer.from(inventoryBytes),abiBytes:Buffer.from(abiBytes)};changed[key][0]^=1;assert.throws(()=>renderProofDecoderSecurityArtifacts(changed),{code:'DECODER_SECURITY_INPUT_PIN'});}
    const first=renderProofDecoderSecurityArtifacts({inventoryBytes,abiBytes});first.apparmorBytes.fill(0);first.abiBytes.fill(0);first.seccompBytes.fill(0);const next=renderProofDecoderSecurityArtifacts({inventoryBytes,abiBytes});assert.equal(sha(next.seccompBytes),next.receipt.seccompSha256);assert.equal(sha(next.apparmorBytes),next.receipt.apparmor.renderedSha256);assert.equal(sha(next.abiBytes),PROOF_DECODER_SECURITY_PINS.abiSha256);
  });
}
