import {canonicalJSON,requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderFreeze,PROOF_DECODER_IMAGE_LAYOUT,PROOF_DECODER_RUNTIME_ENVIRONMENT} from './proof-decoder-profile.mjs';
import {proofDecoderOwnedIdentity} from './proof-decoder-owned-operations.mjs';
import {engineBytesHash,engineDataOptions,compactProofDecoderEngineJSON} from './proof-decoder-engine-json.mjs';
import {assertProofDecoderFixedParentBinding} from './proof-decoder-engine-target-binding.mjs';

export const PROOF_DECODER_ENGINE_API='1.47';
export const PROOF_DECODER_ENGINE_OPERATIONS=Object.freeze(['IMAGE_INSPECT','CREATE','LOOKUP','INSPECT','ATTACH','START','WAIT','KILL','REMOVE']);
const check=value=>requireValue(value,'DECODER_ENGINE_REQUEST_INVALID');
export function proofDecoderEngineContext({apiVersion,plan:input,job:identity,operation}) {
  check(apiVersion===PROOF_DECODER_ENGINE_API&&PROOF_DECODER_ENGINE_OPERATIONS.includes(operation));
  const plan=assertProofDecoderLaunchPlan(input),job=proofDecoderOwnedIdentity(identity,plan);
  if(operation==='CREATE')check(job.containerId===null);
  if(!['IMAGE_INSPECT','CREATE','LOOKUP'].includes(operation))check(job.containerId!==null);
  return {plan,job};
}
export function proofDecoderEngineLabels(job) {
  return {'atlas.proof.registry':job.registryId,'atlas.proof.job':job.jobId,'atlas.proof.nonce':job.ownerNonce,'atlas.proof.profile':job.profileHash,'atlas.proof.epoch':job.epoch};
}

/** Pure reference-contract compiler, not a target adapter or execution permit. */
export function compileProofDecoderEngineRequest(options) {
  const input=engineDataOptions(options,['apiVersion','plan','job','operation'],['seccompBytes','targetBinding']);
  const {apiVersion,operation}=input,{plan,job}=proofDecoderEngineContext(input),p=plan.profile,r=p.resources;
  const target=input.targetBinding===undefined?null:assertProofDecoderFixedParentBinding(input.targetBinding,{plan});
  const prefix=`/v${apiVersion}`,id=job.containerId;
  let method='POST',path,body=null,seccompArtifactSha256=null,headers={};
  if(operation==='CREATE'){
    check(Buffer.isBuffer(input.seccompBytes)&&input.seccompBytes.length<=65536);
    seccompArtifactSha256=engineBytesHash(input.seccompBytes);check(seccompArtifactSha256===p.seccomp.sha256);
    const seccomp=compactProofDecoderEngineJSON(input.seccompBytes,{maxBytes:65536});
    check(seccomp.startsWith('{'));
    body=canonicalJSON({
      Image:p.image,Hostname:'atlas-proof-decoder',Domainname:'',User:`${p.uid}:${p.gid}`,
      AttachStdin:true,AttachStdout:true,AttachStderr:true,Tty:false,OpenStdin:true,StdinOnce:true,
      Env:Object.entries(PROOF_DECODER_RUNTIME_ENVIRONMENT).map(([key,value])=>`${key}=${value}`),
      Entrypoint:[PROOF_DECODER_IMAGE_LAYOUT.node],Cmd:['--max-old-space-size=128',PROOF_DECODER_IMAGE_LAYOUT.worker],
      WorkingDir:'/',Volumes:{},Labels:proofDecoderEngineLabels(job),Healthcheck:{Test:['NONE']},
      HostConfig:{
        ...(target?{CgroupParent:target.cgroupParent}:{}),
        ReadonlyRootfs:true,Privileged:false,NetworkMode:'none',IpcMode:'private',CgroupnsMode:'private',
        CapDrop:['ALL'],CapAdd:[],SecurityOpt:['no-new-privileges=true',`seccomp=${seccomp}`,p.mac.kind==='apparmor'?`apparmor=${p.mac.name}`:`label=type:${p.mac.name}`],
        Memory:r.memoryBytes,MemorySwap:r.memoryBytes,CpuQuota:r.cpuQuotaMicros,CpuPeriod:r.cpuPeriodMicros,PidsLimit:r.pidsLimit,
        Ulimits:[{Name:'nofile',Soft:r.nofileLimit,Hard:r.nofileLimit},{Name:'core',Soft:0,Hard:0}],
        Tmpfs:{'/tmp':`rw,nosuid,nodev,noexec,size=${r.tmpfsBytes},uid=${p.uid},gid=${p.gid},mode=0700`},ShmSize:r.shmBytes,
        RestartPolicy:{Name:'no',MaximumRetryCount:0},AutoRemove:false,LogConfig:{Type:'none',Config:{}},
        Binds:[],Mounts:[],VolumesFrom:[],Devices:[],DeviceRequests:[],PortBindings:{},PublishAllPorts:false
      }
    });
    check(Buffer.byteLength(body)<=262144);headers={'content-type':'application/json'};
    path=`${prefix}/containers/create?name=${encodeURIComponent(job.name)}&platform=${encodeURIComponent(p.platform)}`;
  }else{
    check(input.seccompBytes===undefined);
    if(operation==='IMAGE_INSPECT'){method='GET';path=`${prefix}/images/${encodeURIComponent(p.image)}/json`;}
    else if(operation==='LOOKUP'||operation==='INSPECT'){method='GET';path=`${prefix}/containers/${operation==='LOOKUP'?job.name:id}/json`;}
    else if(operation==='ATTACH'){path=`${prefix}/containers/${id}/attach?logs=0&stream=1&stdin=1&stdout=1&stderr=1`;headers={connection:'Upgrade',upgrade:'tcp'};}
    else if(operation==='START')path=`${prefix}/containers/${id}/start`;
    else if(operation==='WAIT')path=`${prefix}/containers/${id}/wait?condition=not-running`;
    else if(operation==='KILL')path=`${prefix}/containers/${id}/kill?signal=SIGKILL`;
    else if(operation==='REMOVE'){method='DELETE';path=`${prefix}/containers/${id}?force=0&v=0`;}
  }
  return decoderFreeze({schema:'atlas-proof-decoder-engine-request-v1',classification:'UNQUALIFIED',executionAllowed:false,apiVersion,operation,profileHash:plan.profileHash,limitsHash:plan.limitsHash,job,http:{method,path,headers,body},bodySha256:body===null?null:engineBytesHash(Buffer.from(body)),seccompArtifactSha256});
}
