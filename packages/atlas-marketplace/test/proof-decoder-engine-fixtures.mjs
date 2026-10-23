import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {proofDecoderEngineLabels} from '../src/proof-decoder-engine-request.mjs';
import {engineBytesHash} from '../src/proof-decoder-engine-json.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';

// All identities and policy values are invented in-memory schema fixtures.
export function syntheticEngineContext({created=true}={}) {
  const seccompBytes=Buffer.from('{ "defaultAction": "SCMP_ACT_ERRNO", "syscalls": [] }');
  const profile=syntheticDecoderProfile();profile.seccomp.sha256=engineBytesHash(seccompBytes);
  const plan=createProofDecoderLaunchPlan({enabled:true,profile});
  const registryId='00000000-0000-4000-8000-000000000001',jobId='00000000-0000-4000-8000-000000000002';
  const job={registryId,jobId,requestId:'00000000-0000-4000-8000-000000000003',ownerNonce:'8'.repeat(64),epoch:'SYNTHETIC_EPOCH',profileHash:plan.profileHash,image:profile.image,name:`atlas-proof-${registryId}-${jobId}`,containerId:created?'9'.repeat(64):null};
  return {apiVersion:'1.47',plan,job,seccompBytes};
}
export const syntheticEngineHeaders=()=>({'content-type':'application/json'});
export const syntheticUpgradeHeaders=()=>({'content-type':'application/vnd.docker.multiplexed-stream',connection:'Upgrade',upgrade:'tcp'});
export function syntheticContainerInspect(context=syntheticEngineContext()) {
  return {Id:context.job.containerId,Name:`/${context.job.name}`,Image:'sha256:'+'7'.repeat(64),Config:{Image:context.plan.profile.image,Labels:proofDecoderEngineLabels(context.job),Env:['SYNTHETIC_SECRET_DO_NOT_PROJECT=fixture']},State:{Status:'running',Running:true,Paused:false,Restarting:false,Dead:false,OOMKilled:false,Pid:123,ExitCode:0,StartedAt:'2026-10-23T00:00:00.000000001Z',FinishedAt:'0001-01-01T00:00:00Z'}};
}
export function syntheticDockerFrame(stream,bytes){const header=Buffer.alloc(8);header[0]=stream;header.writeUInt32BE(bytes.length,4);return Buffer.concat([header,bytes]);}
