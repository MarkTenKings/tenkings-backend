import {canonicalJSON,hash,requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {assertProofDecoderPlan} from './proof-decoder-protocol.mjs';
import {assertProofDecoderControlProbeLaunchPlan,assertProofDecoderControlProbeRequest,PROOF_DECODER_CONTROL_PROBE_REQUEST,PROOF_DECODER_CONTROL_PROBE_CLEANUP} from './proof-decoder-engine-control-probe-transport.mjs';
import {proofDecoderOwnedIdentity} from './proof-decoder-owned-operations.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
const MAX_RECORD=16384,MAX_EVENTS=64,PHASES=['RESERVED','CREATE_INTENT','CREATED','START_INTENT','RUNNING','CLEANUP','FINALIZED'],EFFECTS=['CREATE','START','KILL','REMOVE'];
const check=(value,code='DECODER_RECOVERY_RECORD')=>requireValue(value,code);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function ns(value){check(typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n);return BigInt(value);}
function array(value,max){check(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=max);const descriptors=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(descriptors).length===value.length+1);return Array.from({length:value.length},(_,i)=>{const item=descriptors[String(i)];check(item?.enumerable&&Object.hasOwn(item,'value'));return item.value;});}

/** Historical data only. Never reconstructs Engine/kernel receipts or grants
 * admission. The actual recovery coordinator additionally owns a native lock,
 * the fixed catalog, exact file identities and its own one-shot journal. */
export function reviewProofDecoderRecoverySnapshot(options){
  const input=engineDataOptions(options,['plan','manifest','state','jobs','events']);
  const plan=assertProofDecoderLaunchPlan(input.plan),manifest=decoderContractData(input.manifest),state=decoderContractData(input.state);
  decoderExact(manifest,['schema','registryId','tokenHash','binding','bindingHash','uid','directory','database']);
  check(manifest.schema==='atlas-proof-decoder-target-registry-v1'&&uuid(manifest.registryId)&&digest(manifest.tokenHash)&&manifest.uid===0);
  const binding=manifest.binding;decoderExact(binding,['schema','bootId','epoch','profileHash','limitsHash','image','parentBindingHash']);
  check(binding.schema==='atlas-proof-decoder-target-ledger-binding-v1'&&typeof binding.bootId==='string'&&/^[a-f0-9-]{36}$/.test(binding.bootId)&&typeof binding.epoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(binding.epoch)&&binding.profileHash===plan.profileHash&&binding.limitsHash===plan.limitsHash&&binding.image===plan.profile.image&&digest(binding.parentBindingHash)&&manifest.bindingHash===hash(binding));
  for(const identity of [manifest.directory,manifest.database]){decoderExact(identity,['device','inode']);check(typeof identity.device==='string'&&/^[0-9]{1,20}$/.test(identity.device)&&typeof identity.inode==='string'&&/^[0-9]{1,20}$/.test(identity.inode));}
  decoderExact(state,['poisoned','reason','barrierClosed']);check(typeof state.poisoned==='boolean'&&typeof state.barrierClosed==='boolean'&&(state.reason===null||typeof state.reason==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(state.reason))&&(!state.poisoned||state.barrierClosed&&state.reason!==null));
  const epoch=binding.epoch,bindingHash=manifest.bindingHash,initial={bindingHash:binding.parentBindingHash,parentName:'atlasdecoder.slice'};
  function validateRequest(value){
    if(value.schema===PROOF_DECODER_CONTROL_PROBE_REQUEST){assertProofDecoderControlProbeLaunchPlan(plan);return assertProofDecoderControlProbeRequest(value);}
    return assertProofDecoderPlan(value);
  }
  function cleanupSchema(row){return row.requestPlan.schema===PROOF_DECODER_CONTROL_PROBE_REQUEST?PROOF_DECODER_CONTROL_PROBE_CLEANUP:'atlas-proof-decoder-owned-engine-cleanup-v1';}
  function validateRecord(value){
    const row=decoderContractData(value);decoderExact(row,['identity','requestPlan','bindingHash','phase','revision','createdAtNs','deadlineAtNs','barrierId','barrierAtNs','effects','engineExit','cleanup']);
    proofDecoderOwnedIdentity(row.identity,plan);validateRequest(row.requestPlan);check(row.identity.registryId===manifest.registryId&&row.identity.epoch===epoch&&row.bindingHash===bindingHash&&row.requestPlan.byteCount<=plan.profile.limits.maxObjectBytes,'DECODER_TARGET_CORRUPT');
    check(PHASES.includes(row.phase)&&Number.isSafeInteger(row.revision)&&row.revision>=0&&row.revision<MAX_EVENTS&&ns(row.deadlineAtNs)>ns(row.createdAtNs)&&ns(row.deadlineAtNs)-ns(row.createdAtNs)<=BigInt(plan.profile.limits.timeoutMs)*1000000n,'DECODER_TARGET_CORRUPT');
    check((row.barrierId===null&&row.barrierAtNs===null)||(uuid(row.barrierId)&&ns(row.barrierAtNs)>=ns(row.createdAtNs)),'DECODER_TARGET_CORRUPT');
    check(Array.isArray(row.effects)&&row.effects.length<=4,'DECODER_TARGET_CORRUPT');const seen=new Set(),ids=new Set();let priorRevision=0;
    for(const effect of row.effects){decoderExact(effect,['operationId','operation','requestHash','intentAtNs','intentRevision','receipt']);check(uuid(effect.operationId)&&!ids.has(effect.operationId)&&EFFECTS.includes(effect.operation)&&!seen.has(effect.operation)&&digest(effect.requestHash)&&ns(effect.intentAtNs)>=ns(row.createdAtNs)&&Number.isSafeInteger(effect.intentRevision)&&effect.intentRevision>priorRevision&&effect.intentRevision<=row.revision,'DECODER_TARGET_CORRUPT');seen.add(effect.operation);ids.add(effect.operationId);priorRevision=effect.intentRevision;
      if(effect.receipt!==null){const report=effect.receipt;decoderExact(report,['schema','classification','evidenceOrigin','identity','operationId','operation','requestHash','containerId','status','observedAtNs','bindingHash']);check(typeof report.schema==='string'&&report.schema.length<=128&&report.classification==='UNQUALIFIED'&&report.evidenceOrigin==='ENGINE_SOCKET_REPORT'&&report.bindingHash===bindingHash&&report.operationId===effect.operationId&&report.operation===effect.operation&&report.requestHash===effect.requestHash&&digest(report.containerId)&&report.status===(effect.operation==='CREATE'?201:204)&&ns(report.observedAtNs)>=ns(effect.intentAtNs),'DECODER_TARGET_CORRUPT');const expected={...row.identity,containerId:effect.operation==='CREATE'?null:row.identity.containerId};check(canonicalJSON(report.identity)===canonicalJSON(expected)&&report.containerId===row.identity.containerId,'DECODER_TARGET_CORRUPT');}
    }
    check(row.effects.filter(effect=>effect.receipt===null).length<=1,'DECODER_TARGET_CORRUPT');
    const effect=operation=>row.effects.find(item=>item.operation===operation),create=effect('CREATE'),start=effect('START');
    check(!start||create?.receipt&&create.intentRevision<start.intentRevision,'DECODER_TARGET_CORRUPT');
    check(row.identity.containerId===null?!create||create.receipt===null:create?.receipt?.containerId===row.identity.containerId,'DECODER_TARGET_CORRUPT');
    if(row.phase==='RESERVED')check(row.effects.length===0&&row.barrierId===null,'DECODER_TARGET_CORRUPT');
    if(row.phase==='CREATE_INTENT')check(create&&create.receipt===null&&row.effects.length===1&&row.barrierId===null,'DECODER_TARGET_CORRUPT');
    if(row.phase==='CREATED')check(create?.receipt&&!start&&row.barrierId===null,'DECODER_TARGET_CORRUPT');
    if(row.phase==='START_INTENT')check(create?.receipt&&start&&start.receipt===null&&row.barrierId===null,'DECODER_TARGET_CORRUPT');
    if(row.phase==='RUNNING')check(create?.receipt&&start?.receipt&&row.barrierId===null,'DECODER_TARGET_CORRUPT');
    if(['CLEANUP','FINALIZED'].includes(row.phase))check(row.barrierId!==null,'DECODER_TARGET_CORRUPT');
    for(const operation of ['KILL','REMOVE'])if(effect(operation))check(row.barrierId!==null&&ns(effect(operation).intentAtNs)>=ns(row.barrierAtNs),'DECODER_TARGET_CORRUPT');
    if(row.engineExit!==null){const exit=row.engineExit;decoderExact(exit,['schema','classification','identity','bindingHash','barrierId','observedAtNs','waitExitCode','state']);decoderExact(exit.state,['status','running','paused','restarting','dead','oomKilled','pid','exitCode','startedAt','finishedAt']);check(typeof exit.schema==='string'&&exit.schema.length<=128&&exit.classification==='UNQUALIFIED'&&canonicalJSON(exit.identity)===canonicalJSON(row.identity)&&exit.bindingHash===bindingHash&&exit.barrierId===row.barrierId&&row.barrierId!==null&&ns(exit.observedAtNs)>=ns(row.barrierAtNs)&&Number.isSafeInteger(exit.waitExitCode)&&exit.waitExitCode>=0&&exit.waitExitCode<=255&&exit.state.exitCode===exit.waitExitCode&&['exited','dead'].includes(exit.state.status)&&exit.state.running===false&&exit.state.paused===false&&exit.state.restarting===false&&typeof exit.state.dead==='boolean'&&typeof exit.state.oomKilled==='boolean'&&exit.state.pid===0&&typeof exit.state.startedAt==='string'&&exit.state.startedAt.length<=40&&typeof exit.state.finishedAt==='string'&&exit.state.finishedAt.length<=40,'DECODER_TARGET_CORRUPT');}
    if(effect('REMOVE'))check(row.engineExit!==null&&ns(effect('REMOVE').intentAtNs)>=ns(row.engineExit.observedAtNs),'DECODER_TARGET_CORRUPT');
    if(['CREATED','START_INTENT','RUNNING','FINALIZED'].includes(row.phase))check(digest(row.identity.containerId),'DECODER_TARGET_CORRUPT');
    check((row.phase==='FINALIZED')===(row.cleanup!==null),'DECODER_TARGET_CORRUPT');
    if(row.cleanup!==null){decoderExact(row.cleanup,['settledCleanup','nativeEmpty']);const engine=row.cleanup.settledCleanup,kernel=row.cleanup.nativeEmpty;
      decoderExact(engine,['schema','classification','identity','bindingHash','barrierId','lastRemoveAtNs','observedAtNs','createOperationId','startOperationId','removeOperationId','waitExitCode','absentAfterRemove','settled']);
      decoderExact(kernel,['schema','bootId','bindingHash','parentName','device','inode','observedAtNs','populated','freezeRequested','frozen']);
      check(['CREATE','START','REMOVE'].every(operation=>effect(operation)?.receipt)&&!row.effects.some(item=>item.receipt===null)&&engine.schema===cleanupSchema(row)&&engine.classification==='UNQUALIFIED'&&canonicalJSON(engine.identity)===canonicalJSON(row.identity)&&engine.barrierId===row.barrierId&&engine.bindingHash===bindingHash&&engine.createOperationId===create.operationId&&engine.startOperationId===start.operationId&&engine.removeOperationId===effect('REMOVE').operationId&&engine.lastRemoveAtNs===effect('REMOVE').receipt.observedAtNs&&engine.settled===true&&engine.absentAfterRemove===true&&Number.isSafeInteger(engine.waitExitCode)&&engine.waitExitCode>=0&&engine.waitExitCode<=255&&ns(engine.observedAtNs)>=ns(engine.lastRemoveAtNs)&&kernel.schema==='atlas-proof-decoder-kernel-empty-v1'&&kernel.bootId===binding.bootId&&kernel.bindingHash===initial.bindingHash&&kernel.parentName===initial.parentName&&typeof kernel.device==='string'&&/^[0-9]{1,20}$/.test(kernel.device)&&typeof kernel.inode==='string'&&/^[0-9]{1,20}$/.test(kernel.inode)&&kernel.populated===false&&kernel.freezeRequested===false&&kernel.frozen===false&&ns(kernel.observedAtNs)>=ns(engine.observedAtNs)&&ns(kernel.observedAtNs)>=ns(row.barrierAtNs),'DECODER_TARGET_CORRUPT');}
    check(Buffer.byteLength(canonicalJSON(row))<=MAX_RECORD,'DECODER_TARGET_FULL');return row;
  }
  const jobs=array(input.jobs,128),events=array(input.events,128*MAX_EVENTS).map(item=>decoderContractData(item)),ids=new Set(),requests=new Set(),rows=[];
  for(const storedInput of jobs){
    const stored=engineDataOptions(storedInput,['id','revision','record']);
    check(typeof stored.record==='string'&&Buffer.byteLength(stored.record)<=MAX_RECORD);let parsed;try{parsed=JSON.parse(stored.record);}catch{check(false);}
    const row=validateRecord(parsed);check(stored.id===row.identity.jobId&&stored.revision===row.revision&&canonicalJSON(row)===stored.record&&!ids.has(stored.id)&&!requests.has(row.identity.requestId));ids.add(stored.id);requests.add(row.identity.requestId);
    const history=events.filter(item=>item.job_id===stored.id).sort((a,b)=>a.revision-b.revision);check(history.length===row.revision+1);let previous=null;const details=[];
    for(let i=0;i<history.length;i++){
      const event=history[i];decoderExact(event,['job_id','revision','previous_hash','record_hash','event']);check(event.revision===i&&event.previous_hash===previous&&digest(event.record_hash)&&typeof event.event==='string'&&Buffer.byteLength(event.event)<=1024);previous=event.record_hash;
      let detail;try{detail=decoderContractData(JSON.parse(event.event));}catch{check(false);}decoderExact(detail,['type','atNs','operationId']);check(['RESERVE','EFFECT_INTENT','EFFECT_OBSERVED','EXIT_OBSERVED','CLEANUP_BARRIER','FINALIZED'].includes(detail.type)&&canonicalJSON(detail)===event.event&&ns(detail.atNs)>=ns(row.createdAtNs)&&(detail.operationId===null||uuid(detail.operationId)));details.push(detail);
    }
    check(previous===hash(row)&&details[0].type==='RESERVE'&&details[0].atNs===row.createdAtNs&&details[0].operationId===null);
    check(details.filter(item=>item.type==='RESERVE').length===1&&details.filter(item=>item.type==='EFFECT_INTENT').length===row.effects.length&&details.filter(item=>item.type==='EFFECT_OBSERVED').length===row.effects.filter(effect=>effect.receipt!==null).length);
    for(const effect of row.effects){const intent=details[effect.intentRevision];check(intent?.type==='EFFECT_INTENT'&&intent.operationId===effect.operationId&&intent.atNs===effect.intentAtNs);const settled=details.filter(item=>item.type==='EFFECT_OBSERVED'&&item.operationId===effect.operationId);check(settled.length===(effect.receipt===null?0:1));}
    for(const [type,present] of [['CLEANUP_BARRIER',row.barrierId!==null],['EXIT_OBSERVED',row.engineExit!==null],['FINALIZED',row.phase==='FINALIZED']]){const found=details.filter(item=>item.type===type);check(found.length===(present?1:0)&&found.every(item=>item.operationId===null));if(type==='CLEANUP_BARRIER'&&present)check(found[0].atNs===row.barrierAtNs);}
    if(row.phase==='FINALIZED')check(details.at(-1).type==='FINALIZED');rows.push(row);
  }
  check(events.every(item=>ids.has(item.job_id))&&rows.filter(row=>row.phase!=='FINALIZED').length<=1&&state.barrierClosed===(state.poisoned||rows.some(row=>row.phase==='CLEANUP')));
  return decoderFreeze({schema:'atlas-proof-decoder-recovery-snapshot-v1',classification:'UNQUALIFIED',executionAllowed:false,manifest,state,rows,heldJobs:rows.filter(row=>row.phase!=='FINALIZED').map(row=>row.identity.jobId),historicalDataOnly:true});
}

/** Pure decision only. A reported absence never restores capacity, and an
 * original or recovery REMOVE intent always forbids another DELETE. */
export function classifyProofDecoderRecoveryResource(options){
  const value=decoderContractData(options);decoderExact(value,['phase','hasCreateIntent','hasOriginalRemoveIntent','hasRecoveryRemoveIntent','observation']);
  check(PHASES.includes(value.phase)&&['ABSENT','PRESENT','UNOBSERVED'].includes(value.observation)&&['hasCreateIntent','hasOriginalRemoveIntent','hasRecoveryRemoveIntent'].every(key=>typeof value[key]==='boolean'));
  let action='LOOKUP';
  if(!value.hasCreateIntent)action='NO_ENGINE_EFFECT_HOLD';
  else if(value.observation==='ABSENT')action='ABSENCE_HOLD';
  else if(value.observation==='PRESENT')action=value.phase==='FINALIZED'?'CONTRADICTION_HOLD':value.hasOriginalRemoveIntent||value.hasRecoveryRemoveIntent?'LOOKUP_ONLY_HOLD':'ONE_OWNED_DELETE_CANDIDATE';
  return decoderFreeze({classification:'UNQUALIFIED',executionAllowed:false,action,capacityReleased:false,originalOutcomeChanged:false});
}
