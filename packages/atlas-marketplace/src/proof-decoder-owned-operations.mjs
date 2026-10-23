import {requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function proofDecoderOwnedIdentity(input,plan) {
  const job=decoderContractData(input);
  decoderExact(job,['registryId','jobId','requestId','ownerNonce','epoch','profileHash','image','name','containerId']);
  requireValue(uuid(job.registryId)&&uuid(job.jobId)&&uuid(job.requestId)&&digest(job.ownerNonce)&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(job.epoch),'DECODER_OWNERSHIP_INVALID');
  requireValue(job.profileHash===plan.profileHash&&job.image===plan.profile.image&&job.name===`atlas-proof-${job.registryId}-${job.jobId}`&&(job.containerId===null||digest(job.containerId)),'DECODER_OWNERSHIP_INVALID');
  return decoderFreeze(job);
}
/** Inert operation descriptions. No executable, shell or Docker connection. */
export function buildProofDecoderOwnedOperation({plan:input,job:identity,operation}) {
  const plan=assertProofDecoderLaunchPlan(input),job=proofDecoderOwnedIdentity(identity,plan);
  let args;
  if(operation==='IMAGE_INSPECT')args=['image','inspect',plan.profile.image];
  else if(operation==='CREATE') {
    requireValue(job.containerId===null,'DECODER_OWNERSHIP_INVALID');
    const labels={registry:job.registryId,job:job.jobId,nonce:job.ownerNonce,profile:job.profileHash,epoch:job.epoch};
    args=[...plan.createArguments.slice(0,-3),`--name=${job.name}`,...Object.entries(labels).map(([key,value])=>`--label=atlas.proof.${key}=${value}`),...plan.createArguments.slice(-3)];
  }else if(operation==='LOOKUP')args=['container','inspect',job.name];
  else {
    requireValue(digest(job.containerId),'DECODER_OWNERSHIP_INVALID');
    const commands={INSPECT:['container','inspect'],START:['container','start','--attach','--interactive'],WAIT:['container','wait'],KILL:['container','kill','--signal=KILL'],REMOVE:['container','rm']};
    if(Object.hasOwn(commands,operation))args=[...commands[operation],job.containerId];
    else {requireValue(['CGROUP_OBSERVE','CGROUP_KILL'].includes(operation),'DECODER_OPERATION_FORBIDDEN');args=[];}
  }
  return decoderFreeze({classification:'UNQUALIFIED',executionAllowed:false,operation,profileHash:plan.profileHash,job,arguments:args});
}
