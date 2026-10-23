import {createProofDecoderLaunchPlan,PROOF_DECODER_PROFILE_LIMITS,PROOF_DECODER_RUNTIME_ENVIRONMENT} from '../src/proof-decoder-profile.mjs';
import {PROOF_DECODER_REQUIRED_CASES} from '../src/proof-decoder-qualification.mjs';

// Entirely fabricated schema fixtures, never target observations or executable
// authorization. .invalid image, identities, limits and hashes are test data.
export function syntheticDecoderProfile() {
  return {
    schema:'atlas-proof-decoder-profile-v1',targetRef:'SYNTHETIC_SCHEMA_ONLY',
    image:'synthetic.invalid/decoder@sha256:'+'a'.repeat(64),platform:'linux/amd64',nodeVersion:'22.16.0',uid:12345,gid:12345,
    limits:{...PROOF_DECODER_PROFILE_LIMITS},
    resources:{memoryBytes:268435456,cpuQuotaMicros:50000,cpuPeriodMicros:100000,pidsLimit:16,nofileLimit:32,tmpfsBytes:1048576,shmBytes:1048576},
    seccomp:{path:'/synthetic/profile.json',sha256:'b'.repeat(64)},mac:{kind:'apparmor',name:'SYNTHETIC_DECODER'},
    ipc:{socketPath:'/synthetic/ipc/decoder.sock',supervisorUid:12346,supervisorGid:12346,clientUid:12347,clientGid:12347},
    artifactHashes:{worker:'c'.repeat(64),dependencyLock:'d'.repeat(64),supervisor:'e'.repeat(64),watchdog:'f'.repeat(64)}
  };
}
export function syntheticDecoderEvidence(plan=createProofDecoderLaunchPlan({enabled:true,profile:syntheticDecoderProfile()})) {
  const p=plan.profile,r=p.resources,ipc=p.ipc;
  return {
    schema:'atlas-proof-decoder-target-evidence-v1',qualificationId:'SYNTHETIC_QUALIFICATION_DOCUMENT',targetRef:p.targetRef,serviceEpoch:'SYNTHETIC_EPOCH',
    issuedAt:1000,expiresAt:2000,profileHash:plan.profileHash,limitsHash:plan.limitsHash,
    artifactHashes:{...p.artifactHashes,harness:'0'.repeat(64),corpus:'2'.repeat(64)},
    observed:{
      image:p.image,platform:p.platform,bootId:'00000000-0000-4000-8000-000000000000',kernelRelease:'SYNTHETIC',dockerVersion:'SYNTHETIC',runtimeName:'SYNTHETIC',runtimeVersion:'SYNTHETIC',
      nodeVersion:p.nodeVersion,sharpVersion:'0.33.5',vipsVersion:'8.15.3',uid:p.uid,gid:p.gid,
      rootReadonly:true,capEffective:'0000000000000000',noNewPrivileges:true,seccompMode:2,seccompSha256:p.seccomp.sha256,mac:{...p.mac,enforcing:true},
      namespaces:{pid:'private',ipc:'private',cgroup:'private',network:'none'},networkInterfaces:['lo'],publishedPorts:[],operatorAddedMounts:[],imageDeclaredVolumes:[],mountManifestSha256:'3'.repeat(64),imageEnvironmentNames:[],
      runtimeEnvironment:{...PROOF_DECODER_RUNTIME_ENVIRONMENT},applicationSecretsPresent:false,dockerSocketPresent:false,
      ipc:{socketPath:ipc.socketPath,directoryRealPath:'/synthetic/ipc',directoryDevice:1,directoryInode:2,directoryUid:ipc.supervisorUid,directoryGid:ipc.clientGid,directoryMode:'0750',socketDevice:1,socketInode:3,socketUid:ipc.supervisorUid,socketGid:ipc.clientGid,socketMode:'0660',socketType:'unix-stream',symlinksPresent:false,ancestorsProtected:true,clientCanReplaceEndpoint:false,peerPid:100,peerUid:ipc.supervisorUid,peerGid:ipc.supervisorGid,serviceEpoch:'SYNTHETIC_EPOCH'},
      resources:{cgroupVersion:2,controllers:['cpu','memory','pids'],memoryMaxBytes:r.memoryBytes,memorySwapMaxBytes:0,cpuQuotaMicros:r.cpuQuotaMicros,cpuPeriodMicros:r.cpuPeriodMicros,pidsMax:r.pidsLimit,nofileSoft:r.nofileLimit,nofileHard:r.nofileLimit,coreMaxBytes:0,tmpfsMaxBytes:r.tmpfsBytes,shmMaxBytes:r.shmBytes,tmpfsMountFlags:['nodev','noexec','nosuid'],shmMountFlags:['nodev','noexec','nosuid'],cgroupKillAvailable:true},
      supervision:{independentWatchdog:true,restartReconcilesOwned:true,appHasDockerAccess:false,maxActiveJobs:p.limits.maxConcurrent,queueCapacity:0}
    },
    cases:PROOF_DECODER_REQUIRED_CASES.map(id=>({id,outcome:'PASS',startedAt:900,finishedAt:999,observationSha256:'1'.repeat(64)}))
  };
}
