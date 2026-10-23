import {createHash} from 'node:crypto';
import {requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderContractData,decoderFreeze} from './proof-decoder-profile.mjs';
import {proofDecoderOwnedIdentity} from './proof-decoder-owned-operations.mjs';
import {assertProofDecoderPlan} from './proof-decoder-protocol.mjs';
import {encodeProofDecoderWorkerRequestHeader,createProofDecoderWorkerResultReader,assertProofDecoderWorkerResult} from './proof-decoder-worker-protocol.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {PROOF_DECODER_ENGINE_API,compileProofDecoderEngineRequest} from './proof-decoder-engine-request.mjs';
import {projectProofDecoderEngineResponse,createProofDecoderEngineMultiplexReader} from './proof-decoder-engine-response.mjs';
import {assertProofDecoderFixedParentBinding,assertProofDecoderFixedParentReport} from './proof-decoder-engine-target-binding.mjs';

const check=(value,code='ENGINE_TRANSCRIPT_SEQUENCE')=>requireValue(value,code);
const eventFields={
  REQUEST:['operation'],RESPONSE:['operation','statusCode','headers','body','upgradeHead'],
  INPUT:['bytes'],INPUT_EOF:[],OUTPUT:['bytes'],OUTPUT_EOF:[],
  UNCERTAIN:['operation'],CLEANUP_CLAIM:[],
};
const reasons=new Set(['ENGINE_TRANSCRIPT_SEQUENCE','ENGINE_TRANSCRIPT_DEADLINE','ENGINE_TRANSCRIPT_EPOCH','ENGINE_TRANSCRIPT_INPUT','ENGINE_TRANSCRIPT_OUTCOME','ENGINE_TRANSCRIPT_UNCERTAIN','ENGINE_TRANSCRIPT_CLEANUP_UNVERIFIED']);

/** Pure in-memory review of an explicitly supplied synthetic transcript. It
 * opens no connection, executes no compiled request and grants no capability.
 * All clock/daemon/start reports are claims. Even a complete transcript retains
 * capacity and requires real independent ownership/cleanup/admission evidence.
 */
export function reviewProofDecoderEngineTranscript(options) {
  const input=engineDataOptions(options,['plan','job','original','seccompBytes','events'],['targetBinding']);
  const plan=assertProofDecoderLaunchPlan(input.plan),initialJob=proofDecoderOwnedIdentity(input.job,plan);
  const target=input.targetBinding===undefined?{}:{targetBinding:assertProofDecoderFixedParentBinding(input.targetBinding,{plan})};
  check(initialJob.containerId===null);
  const original=decoderContractData(input.original);assertProofDecoderPlan(original);
  check(original.byteCount<=plan.profile.limits.maxObjectBytes,'ENGINE_TRANSCRIPT_INPUT');
  check(Buffer.isBuffer(input.seccompBytes)&&input.seccompBytes.length<=65536);
  // Validate the fixed create artifact before processing any purported effects.
  const createRequest=compileProofDecoderEngineRequest({apiVersion:PROOF_DECODER_ENGINE_API,plan,job:initialJob,operation:'CREATE',seccompBytes:input.seccompBytes,...target});
  const events=input.events;
  check(Array.isArray(events)&&Object.getPrototypeOf(events)===Array.prototype&&events.length<=512);
  const descriptors=Object.getOwnPropertyDescriptors(events);
  check(Reflect.ownKeys(descriptors).length===events.length+1);
  for(let i=0;i<events.length;i++)check(descriptors[i]?.enumerable&&Object.hasOwn(descriptors[i],'value'));

  let job=initialJob,elapsedMs=0,seen=0,refusal=null;
  let createAttempted=false,startAttempted=false,attachAttempted=false,identityReported=false;
  let attached=false,startAcknowledged=false,started=false,inputClosed=false,outputClosed=false,earlyStdout=false;
  let terminalReported=false,startedPid=null,startedAt=null,observedExitCode=null;
  let imageId=null,workerResult=null,exitCode=null,headerAt=0,inputBytes=0;
  const requestCounts={},pending=new Set(),originalHash=createHash('sha256');
  const header=encodeProofDecoderWorkerRequestHeader({requestId:job.requestId,plan:original,limits:plan.profile.limits,limitsHash:plan.limitsHash});
  const worker=createProofDecoderWorkerResultReader();
  const multiplex=createProofDecoderEngineMultiplexReader({
    onStdout(bytes){if(!inputClosed)earlyStdout=true;worker.feed(bytes);},
    onStderr(){/* Never retain or emit unsafe worker diagnostic text. */},
  });
  const feedOutput=bytes=>{
    multiplex.feed(bytes);
    // A record may begin before stdin EOF and finish after it. Observe its
    // first byte, not only the completed-payload callback, to preserve order.
    if(!inputClosed&&multiplex.status().stdoutStarted)earlyStdout=true;
  };
  let streamSummary=null;

  try {
    for(let i=0;i<events.length;i++){
      seen=i+1;
      const raw=descriptors[i].value;
      // Read the discriminant through its data descriptor, never a getter.
      check(raw&&Object.getPrototypeOf(raw)===Object.prototype);
      const typeDescriptor=Object.getOwnPropertyDescriptor(raw,'type');
      check(typeDescriptor&&Object.hasOwn(typeDescriptor,'value')&&typeof typeDescriptor.value==='string'&&Object.hasOwn(eventFields,typeDescriptor.value));
      const type=typeDescriptor.value,event=engineDataOptions(raw,['type','atMs','epoch',...eventFields[type]]);
      check(Number.isSafeInteger(event.atMs)&&event.atMs>=elapsedMs&&event.atMs<plan.profile.limits.timeoutMs,'ENGINE_TRANSCRIPT_DEADLINE');
      elapsedMs=event.atMs;check(event.epoch===job.epoch,'ENGINE_TRANSCRIPT_EPOCH');

      if(type==='UNCERTAIN'){
        check(['CREATE','START','ATTACH','INPUT','OUTPUT','WAIT','INSPECT','LOOKUP','KILL','REMOVE','WATCHDOG','REGISTRY','ADMISSION'].includes(event.operation));
        check(false,'ENGINE_TRANSCRIPT_UNCERTAIN');
      }
      if(type==='CLEANUP_CLAIM')check(false,'ENGINE_TRANSCRIPT_CLEANUP_UNVERIFIED');
      if(type==='REQUEST'){
        const op=event.operation;
        check(['IMAGE_INSPECT','CREATE','LOOKUP','INSPECT','ATTACH','START','WAIT','KILL','REMOVE'].includes(op)&&!pending.has(op));
        requestCounts[op]=(requestCounts[op]??0)+1;
        check(requestCounts[op]<=(['INSPECT','LOOKUP'].includes(op)?8:1));
        if(op==='CREATE'){check(!createAttempted&&imageId!==null);createAttempted=true;}
        else if(op==='IMAGE_INSPECT')check(!createAttempted);
        else if(op==='LOOKUP')check(createAttempted&&!pending.has('CREATE')&&job.containerId!==null&&!startAttempted);
        else if(op==='INSPECT')check(job.containerId!==null);
        else if(op==='ATTACH'){check(identityReported&&!startAttempted&&!attachAttempted);attachAttempted=true;}
        else if(op==='START'){check(attached&&identityReported&&!startAttempted&&!outputClosed&&!earlyStdout);startAttempted=true;}
        else if(op==='WAIT')check(started);
        else if(op==='KILL'||op==='REMOVE'){
          // This reducer cannot supply exact cgroup/independent watchdog proof.
          // It must not make unsafe cleanup requests appear executable.
          check(false,'ENGINE_TRANSCRIPT_CLEANUP_UNVERIFIED');
        }
        if(op!=='CREATE')compileProofDecoderEngineRequest({apiVersion:PROOF_DECODER_ENGINE_API,plan,job,operation:op,...target});
        pending.add(op);continue;
      }
      if(type==='RESPONSE'){
        const op=event.operation;check(pending.has(op));
        check(Buffer.isBuffer(event.upgradeHead)&&event.upgradeHead.length<=10248);
        check(op==='ATTACH'||event.upgradeHead.length===0);
        const report=projectProofDecoderEngineResponse({apiVersion:PROOF_DECODER_ENGINE_API,plan,job,operation:op,statusCode:event.statusCode,headers:event.headers,body:event.body});
        pending.delete(op);
        if(['NOT_FOUND_REPORTED','ENGINE_ERROR_REPORTED'].includes(report.kind))check(false,'ENGINE_TRANSCRIPT_UNCERTAIN');
        if(op==='IMAGE_INSPECT'){check(report.kind==='IMAGE_REPORTED');imageId=report.data.imageId;}
        else if(op==='CREATE'){
          check(report.kind==='CREATE_REPORTED'&&report.data.warningCount===0);
          job=proofDecoderOwnedIdentity({...job,containerId:report.data.containerId},plan);
        }else if(op==='LOOKUP'||op==='INSPECT'){
          if(input.targetBinding!==undefined)assertProofDecoderFixedParentReport({body:event.body,targetBinding:input.targetBinding,plan});
          check(report.kind==='CONTAINER_REPORTED'&&report.data.imageId===imageId);
          const state=report.data.state;
          check(!state.oomKilled&&!state.paused&&!state.restarting&&!state.dead,'ENGINE_TRANSCRIPT_OUTCOME');
          if(!startAttempted){
            check(state.status==='created'&&!state.running&&state.pid===0&&state.exitCode===0);
            check(state.startedAt==='0001-01-01T00:00:00Z'&&state.finishedAt==='0001-01-01T00:00:00Z');identityReported=true;
          }
          else if(state.running){
            check(!terminalReported&&startAcknowledged&&state.status==='running'&&state.pid>0&&Date.parse(state.startedAt)>0);
            check(state.exitCode===0&&state.finishedAt==='0001-01-01T00:00:00Z');
            if(started)check(state.pid===startedPid&&state.startedAt===startedAt);
            startedPid=state.pid;startedAt=state.startedAt;
            started=true;
          }else {
            check(started&&state.status==='exited'&&state.pid===0&&state.startedAt===startedAt&&Date.parse(state.finishedAt)>=Date.parse(startedAt));
            if(observedExitCode!==null)check(state.exitCode===observedExitCode,'ENGINE_TRANSCRIPT_OUTCOME');
            terminalReported=true;observedExitCode=state.exitCode;
          }
        }else if(op==='ATTACH'){
          check(report.kind==='ATTACH_UPGRADE_REPORTED');attached=true;
          // A future transport must preserve buffered bytes after HTTP101.
          // Feeding them here prevents a model that silently drops that prefix.
          if(event.upgradeHead.length)feedOutput(event.upgradeHead);
        }else if(op==='START'){check(report.kind==='START_REPORTED');startAcknowledged=true;}
        else if(op==='WAIT'){
          check(started&&report.kind==='WAIT_REPORTED');exitCode=report.data.exitCode;
          if(observedExitCode!==null)check(exitCode===observedExitCode,'ENGINE_TRANSCRIPT_OUTCOME');
          terminalReported=true;observedExitCode=exitCode;
        }
        continue;
      }
      if(type==='INPUT'){
        check(started&&attached&&!terminalReported&&!inputClosed&&!outputClosed);
        check(Buffer.isBuffer(event.bytes)&&event.bytes.length>0&&event.bytes.length<=65536,'ENGINE_TRANSCRIPT_INPUT');
        let at=0;
        if(headerAt<header.length){
          const size=Math.min(header.length-headerAt,event.bytes.length);
          check(event.bytes.subarray(0,size).equals(header.subarray(headerAt,headerAt+size)),'ENGINE_TRANSCRIPT_INPUT');
          headerAt+=size;at+=size;
        }
        const bytes=event.bytes.subarray(at);inputBytes+=bytes.length;
        check(inputBytes<=original.byteCount,'ENGINE_TRANSCRIPT_INPUT');originalHash.update(bytes);
      }else if(type==='INPUT_EOF'){
        check(started&&attached&&!terminalReported&&!inputClosed&&headerAt===header.length&&inputBytes===original.byteCount,'ENGINE_TRANSCRIPT_INPUT');
        check(originalHash.digest('hex')===original.sha256,'ENGINE_TRANSCRIPT_INPUT');inputClosed=true;
      }else if(type==='OUTPUT'){
        check(attached&&!outputClosed&&Buffer.isBuffer(event.bytes)&&event.bytes.length>0&&event.bytes.length<=10248);
        feedOutput(event.bytes);
      }else if(type==='OUTPUT_EOF'){
        check(attached&&!outputClosed);streamSummary=multiplex.end();
        workerResult=assertProofDecoderWorkerResult(worker.end(),{requestId:job.requestId,plan:original,limits:plan.profile.limits});
        outputClosed=true;
        if(workerResult.outcome!=='DECODER_FAILURE')check(started&&inputClosed&&!earlyStdout,'ENGINE_TRANSCRIPT_OUTCOME');
      }
    }
    if(workerResult&&exitCode!==null){
      check(exitCode===(workerResult.outcome==='DECODER_FAILURE'?2:0),'ENGINE_TRANSCRIPT_OUTCOME');
    }
  }catch(error){refusal=reasons.has(error?.code)?error.code:'ENGINE_TRANSCRIPT_REFUSED';}
  finally {multiplex.dispose();worker.dispose();header.fill(0);}
  const complete=!refusal&&outputClosed&&exitCode!==null&&pending.size===0;
  return decoderFreeze({
    schema:'atlas-proof-decoder-engine-transcript-review-v1',classification:'UNQUALIFIED',executionAllowed:false,
    reviewStatus:refusal?'RECONCILIATION_REQUIRED':complete?'DECODE_REPORTED_CLEANUP_UNVERIFIED':'INCOMPLETE',
    refusal,processedEvents:seen,unprocessedEvents:events.length-seen,elapsedMs,
    clockAuthority:'SUPPLIED_SYNTHETIC_ELAPSED_TIME_ONLY',job,original,
    createRequestHash:createRequest.bodySha256,seccompArtifactSha256:createRequest.seccompArtifactSha256,
    createAttempted,startAttempted,identityReported,attachAttempted,attached,startAcknowledged,started,
    terminalReported,
    inputBytes,inputClosed,outputClosed,reportedOutcome:workerResult?.outcome??null,reportedExitCode:exitCode,
    streamSummary,cleanup:'UNKNOWN',capacityHeld:true,freshPublicationAllowed:false,
    requiredAuthority:['AUTHENTICATED_DAEMON_AND_PEER','TARGET_BOOT_CLOCK_AND_SERVICE_EPOCH','LIVE_ADMISSION_FENCE','INDEPENDENT_WATCHDOG','OWNED_WHOLE_CGROUP_CLEANUP'],
  });
}
