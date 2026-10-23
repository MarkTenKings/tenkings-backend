import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,PROOF_DECODER_RUNTIME_ENVIRONMENT,decoderContractData,decoderExact,decoderFreeze,decoderToken,decoderDigest} from './proof-decoder-profile.mjs';

export const PROOF_DECODER_REQUIRED_CASES=Object.freeze([
  'VALID_PNG','VALID_JPEG','INPUT_AND_PIXEL_BOUNDS','CORRUPT_TRUNCATED_APPENDED',
  'FORGED_DUPLICATE_OR_TRAILING_OUTPUT','EXTERNAL_NETWORK_DENIED','HOST_SECRET_PROOF_DOCKER_ACCESS_DENIED',
  'ROOT_AND_CODE_READONLY','PRIVILEGE_AND_NAMESPACE_DENIED','CROSS_JOB_ACCESS_DENIED',
  'NATIVE_MEMORY_OOM','CPU_AND_WALL_DEADLINE','PID_THREAD_FD_LIMITS','TMPFS_SHM_LIMITS',
  'CANCEL_IGNORED_TERM_AND_DESCENDANTS','APP_DISCONNECT_AND_DEATH','SUPERVISOR_DEATH_WATCHDOG',
  'RESTART_RECONCILIATION','UNKNOWN_CLEANUP_QUARANTINE','EPOCH_PROFILE_TAMPER_REFUSED','CONCURRENCY_AND_NO_QUEUE','IPC_PEER_AND_DIRECTORY_INTEGRITY'
]);
const same=(actual,expected)=>requireValue(canonicalJSON(actual)===canonicalJSON(expected),'DECODER_OBSERVATION_MISMATCH');
const time=value=>requireValue(Number.isSafeInteger(value)&&value>=0,'DECODER_EVIDENCE_INVALID');
const version=value=>requireValue(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.+()-]{0,127}$/.test(value),'DECODER_EVIDENCE_INVALID');

/** Checks the completeness and consistency of claimed observations. This is
 * deliberately not signature verification, host attestation, approval, or a
 * runtime capability. Even an all-PASS caller document remains UNVERIFIED. */
export function assessProofDecoderTargetEvidence(input) {
  const data=decoderContractData(input);decoderExact(data,['plan','evidence','now']);time(data.now);
  const plan=assertProofDecoderLaunchPlan(data.plan),p=plan.profile,r=p.resources,e=data.evidence;
  decoderExact(e,['schema','qualificationId','targetRef','serviceEpoch','issuedAt','expiresAt','profileHash','limitsHash','artifactHashes','observed','cases']);
  requireValue(e.schema==='atlas-proof-decoder-target-evidence-v1','DECODER_EVIDENCE_INVALID');decoderToken(e.qualificationId);decoderToken(e.serviceEpoch);
  time(e.issuedAt);time(e.expiresAt);requireValue(e.issuedAt<=data.now&&data.now<e.expiresAt&&e.issuedAt<e.expiresAt,'DECODER_EVIDENCE_EXPIRED');
  same(e.targetRef,p.targetRef);same(e.profileHash,plan.profileHash);same(e.limitsHash,plan.limitsHash);
  decoderExact(e.artifactHashes,['worker','dependencyLock','supervisor','watchdog','harness','corpus']);
  for(const key of Object.keys(p.artifactHashes))same(e.artifactHashes[key],p.artifactHashes[key]);decoderDigest(e.artifactHashes.harness);decoderDigest(e.artifactHashes.corpus);
  const o=e.observed;
  decoderExact(o,['image','platform','bootId','kernelRelease','dockerVersion','runtimeName','runtimeVersion','nodeVersion','sharpVersion','vipsVersion','uid','gid','rootReadonly','capEffective','noNewPrivileges','seccompMode','seccompSha256','mac','namespaces','networkInterfaces','publishedPorts','operatorAddedMounts','imageDeclaredVolumes','mountManifestSha256','imageEnvironmentNames','runtimeEnvironment','applicationSecretsPresent','dockerSocketPresent','ipc','resources','supervision']);
  same(o.image,p.image);same(o.platform,p.platform);same(o.nodeVersion,p.nodeVersion);same(o.sharpVersion,'0.33.5');same(o.vipsVersion,'8.15.3');
  requireValue(typeof o.bootId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(o.bootId),'DECODER_EVIDENCE_INVALID');
  for(const key of ['kernelRelease','dockerVersion','runtimeName','runtimeVersion'])version(o[key]);
  same(o.uid,p.uid);same(o.gid,p.gid);same(o.rootReadonly,true);same(o.capEffective,'0000000000000000');same(o.noNewPrivileges,true);same(o.seccompMode,2);same(o.seccompSha256,p.seccomp.sha256);
  same(o.mac,{...p.mac,enforcing:true});same(o.namespaces,{pid:'private',ipc:'private',cgroup:'private',network:'none'});
  same(o.networkInterfaces,['lo']);same(o.publishedPorts,[]);same(o.operatorAddedMounts,[]);same(o.imageDeclaredVolumes,[]);
  decoderDigest(o.mountManifestSha256);
  // Image-defined ENV and Docker-generated runtime env are separate observed
  // facts. Both require inspection; a declaration of an empty image is not it.
  same(o.imageEnvironmentNames,[]);same(o.runtimeEnvironment,PROOF_DECODER_RUNTIME_ENVIRONMENT);same(o.applicationSecretsPresent,false);same(o.dockerSocketPresent,false);
  decoderExact(o.ipc,['socketPath','directoryRealPath','directoryDevice','directoryInode','directoryUid','directoryGid','directoryMode','socketDevice','socketInode','socketUid','socketGid','socketMode','socketType','symlinksPresent','ancestorsProtected','clientCanReplaceEndpoint','peerPid','peerUid','peerGid','serviceEpoch']);
  const ipc=p.ipc;same(o.ipc.socketPath,ipc.socketPath);same(o.ipc.directoryRealPath,ipc.socketPath.slice(0,ipc.socketPath.lastIndexOf('/')));
  same(o.ipc.directoryUid,ipc.supervisorUid);same(o.ipc.directoryGid,ipc.clientGid);same(o.ipc.directoryMode,'0750');same(o.ipc.socketUid,ipc.supervisorUid);same(o.ipc.socketGid,ipc.clientGid);same(o.ipc.socketMode,'0660');same(o.ipc.socketType,'unix-stream');same(o.ipc.symlinksPresent,false);same(o.ipc.ancestorsProtected,true);same(o.ipc.clientCanReplaceEndpoint,false);same(o.ipc.peerUid,ipc.supervisorUid);same(o.ipc.peerGid,ipc.supervisorGid);same(o.ipc.serviceEpoch,e.serviceEpoch);
  for(const key of ['directoryDevice','socketDevice'])requireValue(Number.isSafeInteger(o.ipc[key])&&o.ipc[key]>=0,'DECODER_EVIDENCE_INVALID');
  for(const key of ['directoryInode','socketInode','peerPid'])requireValue(Number.isSafeInteger(o.ipc[key])&&o.ipc[key]>0,'DECODER_EVIDENCE_INVALID');
  same(o.resources,{cgroupVersion:2,controllers:['cpu','memory','pids'],memoryMaxBytes:r.memoryBytes,memorySwapMaxBytes:0,cpuQuotaMicros:r.cpuQuotaMicros,cpuPeriodMicros:r.cpuPeriodMicros,pidsMax:r.pidsLimit,nofileSoft:r.nofileLimit,nofileHard:r.nofileLimit,coreMaxBytes:0,tmpfsMaxBytes:r.tmpfsBytes,shmMaxBytes:r.shmBytes,tmpfsMountFlags:['nodev','noexec','nosuid'],shmMountFlags:['nodev','noexec','nosuid'],cgroupKillAvailable:true});
  same(o.supervision,{independentWatchdog:true,restartReconcilesOwned:true,appHasDockerAccess:false,maxActiveJobs:p.limits.maxConcurrent,queueCapacity:0});
  requireValue(Array.isArray(e.cases)&&e.cases.length===PROOF_DECODER_REQUIRED_CASES.length,'DECODER_CASES_REQUIRED');
  const seen=new Set(),failedCases=[],unresolvedCases=[];
  for(const result of e.cases){
    decoderExact(result,['id','outcome','startedAt','finishedAt','observationSha256']);
    requireValue(PROOF_DECODER_REQUIRED_CASES.includes(result.id)&&!seen.has(result.id)&&['PASS','FAIL','NOT_RUN'].includes(result.outcome),'DECODER_CASES_REQUIRED');seen.add(result.id);
    if(result.outcome==='NOT_RUN'){same(result.startedAt,null);same(result.finishedAt,null);same(result.observationSha256,null);unresolvedCases.push(result.id);}
    else {time(result.startedAt);time(result.finishedAt);requireValue(result.startedAt<=result.finishedAt&&result.finishedAt<=e.issuedAt,'DECODER_EVIDENCE_INVALID');decoderDigest(result.observationSha256);if(result.outcome==='FAIL')failedCases.push(result.id);}
  }
  return decoderFreeze({schema:'atlas-proof-decoder-target-assessment-v1',status:'UNVERIFIED',runtimeQualified:false,contractComplete:failedCases.length===0&&unresolvedCases.length===0,profileHash:plan.profileHash,evidenceHash:hash(e),failedCases:failedCases.sort(),unresolvedCases:unresolvedCases.sort()});
}
