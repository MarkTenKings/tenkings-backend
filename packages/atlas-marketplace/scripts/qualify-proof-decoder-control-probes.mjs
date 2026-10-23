// Explicit operator-only run: node THIS_FILE /absolute/protected/config.json
// One fresh probe reservation. No reset, thaw, retries, service or network setup.
import assert from 'node:assert/strict';
import {constants,openSync,closeSync,fstatSync,lstatSync,readSync,writeFileSync,fsyncSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,resolve,join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {engineDataOptions,parseProofDecoderEngineJSON} from '../src/proof-decoder-engine-json.mjs';
import {assertProofDecoderControlProbeLaunchPlan,proofDecoderControlProbeRequest} from '../src/proof-decoder-engine-control-probe-transport.mjs';
import {createProofDecoderLinuxObserver} from '../src/proof-decoder-linux-observer.mjs';
import {createProofDecoderLinuxCgroupController} from '../src/proof-decoder-linux-cgroup.mjs';
import {openProofDecoderTargetRegistry} from '../src/proof-decoder-target-registry.mjs';
import {createProofDecoderKernelGuardClient} from '../src/proof-decoder-kernel-guard.mjs';
import {createProofDecoderFixedParentBinding} from '../src/proof-decoder-engine-target-binding.mjs';
import {createProofDecoderTargetControlProbeSession,createProofDecoderOwnedEngineCleanup} from '../src/proof-decoder-engine-owned-cleanup.mjs';

function protectedParent(path){
  assert.equal(typeof path,'string');assert.ok(isAbsolute(path));assert.equal(resolve(path),path);assert.equal(realpathSync(dirname(path)),dirname(path));
  for(let parent=dirname(path);;parent=dirname(parent)){
    const st=lstatSync(parent);assert.ok(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&(st.mode&0o022)===0);
    if(parent==='/')break;
  }
}
function boundedFile(path,limit){
  protectedParent(path);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|constants.O_CLOEXEC);let bytes;
  try{
    const before=fstatSync(fd);assert.ok(before.isFile()&&before.uid===0&&before.nlink===1&&(before.mode&0o022)===0&&before.size>0&&before.size<=limit);
    bytes=Buffer.alloc(before.size+1);let at=0;
    while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,null);if(!n)break;at+=n;}
    assert.equal(at,before.size);const after=fstatSync(fd);
    for(const field of ['dev','ino','size','mtimeMs','ctimeMs','mode','uid','gid','nlink'])assert.equal(after[field],before[field]);
    return bytes.subarray(0,at);
  }catch(error){bytes?.fill(0);throw error;}finally{closeSync(fd);}
}
function syncDir(path){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_CLOEXEC);try{fsyncSync(fd);}finally{closeSync(fd);}}
function save(path,value){
  const bytes=Buffer.from(JSON.stringify(value)+'\n');assert.ok(bytes.length<=131072);protectedParent(path);
  const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_CLOEXEC,0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}syncDir(dirname(path));
}
const code=error=>typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,127}$/.test(error.code)?error.code:'CONTROL_PROBE_OPERATOR_FAILED';
assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.getgid(),0);assert.equal(process.versions.node,'22.16.0');assert.equal(process.argv.length,3);
const configBytes=boundedFile(process.argv[2],131072);let config;
try{config=engineDataOptions(parseProofDecoderEngineJSON(configBytes,{maxBytes:131072}),['schema','plan','addonPath','addonSha256','expectedBootId','epoch','mode','evidenceDirectory']);}finally{configBytes.fill(0);}
assert.equal(config.schema,'atlas-proof-decoder-control-probe-operator-v1');const plan=assertProofDecoderControlProbeLaunchPlan(config.plan);
const nonce=randomBytes(32).toString('hex'),requestId=randomUUID();proofDecoderControlProbeRequest({mode:config.mode,nonce});
const evidence=config.evidenceDirectory;protectedParent(evidence);assert.ok(!existsSync(evidence));mkdirSync(evidence,{mode:0o700});syncDir(dirname(evidence));
let observer,controller,registry,guard,lease,cleanup,session,row,seccomp,timer,result=null,io=null,failure=null,finalized=false,settled=false;
const aborter=new AbortController();
function poison(){aborter.abort();try{if(registry)registry.quarantineEpoch({reason:'CONTROL_PROBE_UNCERTAIN',...(row?{jobId:row.identity.jobId}:{})});}catch{}try{controller?.freezeAndKill();}catch{}}
function snapshot(){try{return registry?.snapshot()??null;}catch{return {observation:'REGISTRY_UNAVAILABLE'};}}
function parent(){try{return controller?.status()??null;}catch{return {observation:'PARENT_UNAVAILABLE'};}}
try{
  observer=createProofDecoderLinuxObserver({enabled:true,addonPath:config.addonPath,addonSha256:config.addonSha256});
  controller=createProofDecoderLinuxCgroupController({enabled:true,addonPath:config.addonPath,addonSha256:config.addonSha256,expectedBootId:config.expectedBootId});
  registry=openProofDecoderTargetRegistry({enabled:true,directory:join(evidence,'metadata'),plan,controller,epoch:config.epoch});
  guard=await createProofDecoderKernelGuardClient({enabled:true,controller,observer,plan,targetRegistry:registry});
  const targetBinding=createProofDecoderFixedParentBinding({enabled:true,plan});
  const shared={enabled:true,plan,targetRegistry:registry,parentController:controller,targetBinding,socketPath:'/run/docker.sock',apiVersion:'1.47',linuxObserver:observer};
  cleanup=createProofDecoderOwnedEngineCleanup(shared);seccomp=boundedFile(plan.profile.seccomp.path,65536);
  const deadlineBootNs=String(controller.boottimeNanoseconds()+BigInt(plan.profile.limits.timeoutMs)*1000000n);
  row=registry.reserveControlProbe({requestId,mode:config.mode,nonce,deadlineBootNs});
  save(join(evidence,'reservation.json'),{schema:'atlas-proof-decoder-control-probe-reservation-v1',classification:'UNVERIFIED',evidenceKind:'PROBE_ONLY',record:row,parent:parent(),runtimeQualified:false});
  const left=Number(BigInt(deadlineBootNs)-controller.boottimeNanoseconds())/1e6;assert.ok(left>0&&left<=plan.profile.limits.timeoutMs);
  timer=setTimeout(poison,Math.ceil(left));
  lease=await guard.adopt({identity:row.identity,deadlineBootNs});
  session=createProofDecoderTargetControlProbeSession({...shared,guardClient:guard,guardLease:lease,jobId:row.identity.jobId,seccompBytes:seccomp,headerTimeoutMs:1000,signal:aborter.signal});
  result=await session.run();io=session.status();session.close();session=null;
  const cleaned=await cleanup.finishSettledControlProbe(row.identity.jobId);assert.equal(cleaned.record.phase,'FINALIZED');finalized=true;
  await guard.settle(lease);lease=null;settled=true;
}catch(error){failure=code(error);poison();process.exitCode=1;}
finally{
  clearTimeout(timer);if(session){try{io=session.status();}catch{}try{session.close();}catch(error){failure??=code(error);}}
  seccomp?.fill(0);
  // Preserve the actual terminal row before deliberate guard shutdown. Closing
  // the client quarantines/freezes this one-use epoch even after normal settle.
  const terminalRegistry=snapshot();
  try{cleanup?.close();}catch(error){failure??=code(error);}
  try{guard?.close();}catch(error){failure??=code(error);}
  if(!guard)poison();
  const receipt={schema:'atlas-r2-control-probe-operator-v1',classification:'UNVERIFIED',evidenceKind:'PROBE_ONLY',mode:config.mode,nonce,requestId,
    expectedBootId:config.expectedBootId,epoch:config.epoch,profileHash:plan.profileHash,image:plan.profile.image,addonSha256:config.addonSha256,
    failure,normalProbeCompleted:result!==null,capacityFinalized:finalized,guardSettled:settled,result,io,terminalRegistry,afterShutdownRegistry:snapshot(),parent:parent(),
    workerValidation:null,controlAcceptance:'NOT_EVALUATED',freshPublicationAllowed:false,runtimeQualified:false,operatorReconciliationRequired:true};
  try{registry?.close();}catch(error){receipt.closeFailure=code(error);failure??=code(error);}
  try{observer?.close();}catch(error){receipt.observerCloseFailure=code(error);failure??=code(error);}
  try{controller?.close();}catch(error){receipt.controllerCloseFailure=code(error);failure??=code(error);}
  receipt.failure=failure;if(failure)process.exitCode=1;
  save(join(evidence,'receipt.json'),receipt);process.stdout.write(JSON.stringify(receipt)+'\n');
}
