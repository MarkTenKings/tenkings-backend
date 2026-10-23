import http from 'node:http';
import net from 'node:net';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderContractData,decoderFreeze} from './proof-decoder-profile.mjs';
import {assertProofDecoderPlan} from './proof-decoder-protocol.mjs';
import {proofDecoderOwnedIdentity} from './proof-decoder-owned-operations.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {PROOF_DECODER_ENGINE_API,compileProofDecoderEngineRequest} from './proof-decoder-engine-request.mjs';
import {projectProofDecoderEngineResponse,createProofDecoderEngineMultiplexReader} from './proof-decoder-engine-response.mjs';
import {reviewProofDecoderEngineTranscript} from './proof-decoder-engine-transcript.mjs';
import {encodeProofDecoderWorkerRequestHeader,createProofDecoderWorkerResultReader,assertProofDecoderWorkerResult} from './proof-decoder-worker-protocol.mjs';
import {canonicalJSON} from './contract.mjs';
import {assertProofDecoderFixedParentBinding} from './proof-decoder-engine-target-binding.mjs';
import {assertProofDecoderLinuxCgroupController} from './proof-decoder-linux-cgroup.mjs';
import {assertProofDecoderKernelGuardClient} from './proof-decoder-kernel-guard.mjs';
import {assertProofDecoderEngineTargetSocketPath,createProofDecoderEngineTargetEndpoint} from './proof-decoder-engine-target-endpoint.mjs';

const MARKERS={classification:'UNQUALIFIED',executionAllowed:false,evidenceOrigin:'ENGINE_UNVERIFIED_REPORTS'};
const ALLOWED=['IMAGE_INSPECT','CREATE','LOOKUP','INSPECT','ATTACH','START','WAIT'];
const check=(condition,code='ENGINE_TRANSPORT_INVALID')=>requireValue(condition,code);
const fault=code=>Object.assign(new Error(code),{code,classification:'UNQUALIFIED'});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

function headersOf(raw) {
  check(Array.isArray(raw)&&raw.length<=64,'ENGINE_TRANSPORT_HEADERS');
  const headers={};let size=0;
  for(let i=0;i<raw.length;i+=2){
    const name=raw[i].toLowerCase(),value=raw[i+1];
    check(/^[a-z0-9-]{1,64}$/.test(name)&&typeof value==='string'&&!Object.hasOwn(headers,name),'ENGINE_TRANSPORT_HEADERS');
    size+=Buffer.byteLength(name)+Buffer.byteLength(value);check(size<=8192,'ENGINE_TRANSPORT_HEADERS');headers[name]=value;
  }
  check(headers['content-encoding']===undefined,'ENGINE_TRANSPORT_HEADERS');
  return headers;
}

/** Concrete socket I/O, deliberately NOT a qualified executor/admission port.
 * One explicit job, original and Unix path; no caller HTTP fields or callbacks.
 * Raw Engine bodies exist only in this private, bounded, zeroed transcript.
 */
export function createProofDecoderEngineTransport(options={}) {
  const input=engineDataOptions(options,[],['enabled','socketPath','apiVersion','plan','job','original','originalBytes','seccompBytes','deadlineMono','headerTimeoutMs','signal','targetBinding','targetRuntime']);
  if(input.enabled!==true)return null;
  const plan=assertProofDecoderLaunchPlan(input.plan),initialJob=proofDecoderOwnedIdentity(input.job,plan);
  const original=decoderContractData(input.original);assertProofDecoderPlan(original);
  check(initialJob.containerId===null&&input.apiVersion===PROOF_DECODER_ENGINE_API);
  check(typeof input.socketPath==='string'&&input.socketPath.length<=100&&/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(input.socketPath)&&input.socketPath.split('/').every(part=>part!=='.'&&part!=='..'));
  check(Buffer.isBuffer(input.originalBytes)&&input.originalBytes.length===original.byteCount&&original.byteCount<=plan.profile.limits.maxObjectBytes);
  check(Buffer.isBuffer(input.seccompBytes)&&input.seccompBytes.length<=65536);
  const began=performance.now(),deadline=input.deadlineMono,headerTimeout=input.headerTimeoutMs??1000,signal=input.signal;
  check(Number.isFinite(deadline)&&deadline>began&&deadline-began<=plan.profile.limits.timeoutMs);
  check(Number.isSafeInteger(headerTimeout)&&headerTimeout>=1&&headerTimeout<=5000);
  check(signal===undefined||signal instanceof AbortSignal);
  let target={},runtime=null,targetMemberPid=null,endpoint=null,inputBarrier=null,inputControls=null;
  check((input.targetBinding===undefined)===(input.targetRuntime===undefined));
  if(input.targetBinding!==undefined){
    assertProofDecoderEngineTargetSocketPath(input.socketPath);
    target={targetBinding:assertProofDecoderFixedParentBinding(input.targetBinding,{plan})};
    runtime=engineDataOptions(input.targetRuntime,['controller','guardClient','lease','bindingHash','deadlineBootNs','linuxObserver']);
    assertProofDecoderLinuxCgroupController(runtime.controller);
    endpoint=createProofDecoderEngineTargetEndpoint({enabled:true,socketPath:input.socketPath,linuxObserver:runtime.linuxObserver});
    assertProofDecoderKernelGuardClient(runtime.guardClient,{controller:runtime.controller,bindingHash:runtime.bindingHash});
    check(typeof runtime.deadlineBootNs==='string'&&/^[1-9][0-9]{0,19}$/.test(runtime.deadlineBootNs)&&BigInt(runtime.deadlineBootNs)<=18446744073709551615n);
  }
  function targetLive(){
    if(!runtime)return;
    endpoint.assertCurrent();
    const lease=runtime.guardClient.assertLive(runtime.lease);
    check(lease.bindingHash===runtime.bindingHash&&lease.deadlineBootNs===runtime.deadlineBootNs&&
      canonicalJSON({...lease.identity,containerId:null})===canonicalJSON({...initialJob,containerId:null}),'ENGINE_TRANSPORT_TARGET_LEASE');
    check(runtime.controller.boottimeNanoseconds()<BigInt(runtime.deadlineBootNs),'ENGINE_TRANSPORT_DEADLINE');
  }
  targetLive();
  // Copy BEFORE any asynchronous boundary/socket. Caller mutation cannot change
  // bytes after this hash or change the seccomp artifact after compilation.
  const bytes=Buffer.from(input.originalBytes),seccomp=Buffer.isBuffer(input.seccompBytes)?Buffer.from(input.seccompBytes):null;
  try {
    check(digest(bytes)===original.sha256,'ENGINE_TRANSPORT_SOURCE_MISMATCH');
    compileProofDecoderEngineRequest({apiVersion:input.apiVersion,plan,job:initialJob,operation:'CREATE',seccompBytes:seccomp,...target});
  }catch(error){bytes.fill(0);seccomp?.fill(0);throw error;}
  const events=[],requests=new Set(),sockets=new Set(),bodyBuffers=new Set();
  let job=initialJob,closed=false,failure=null,attachment=null,inputStarted=false,inputClosed=false,outputClosed=false,outputBytes=0;
  let result=null,finalReview=null,requestCount=0,activeWrites=0,stdoutBeforeEof=false,backpressureEvents=0,inputBytesWritten=0;
  let resolveOutput,rejectOutput;
  const outputDone=new Promise((resolve,reject)=>{resolveOutput=resolve;rejectOutput=reject;});outputDone.catch(()=>{});
  const worker=createProofDecoderWorkerResultReader();
  const multiplex=createProofDecoderEngineMultiplexReader({onStdout:chunk=>worker.feed(chunk),onStderr:()=>{}});
  const header=encodeProofDecoderWorkerRequestHeader({requestId:job.requestId,plan:original,limits:plan.profile.limits,limitsHash:plan.limitsHash});
  // This private agent has no TCP/DNS path and never pools a socket for another
  // job. allowHalfOpen preserves read-side draining after stdin FIN.
  const agent=new http.Agent({keepAlive:false,maxSockets:2,maxTotalSockets:2,maxFreeSockets:0});
  const connecting=runtime?new AbortController():null;
  agent.createConnection=endpoint?(_,callback)=>{
    endpoint.connect({allowHalfOpen:true,timeoutMs:Math.max(1,Math.min(500,Math.floor(deadline-performance.now()))),signal:connecting.signal})
      .then(socket=>callback(null,socket),error=>callback(error));
  }:()=>net.createConnection({path:input.socketPath,allowHalfOpen:true});
  const elapsed=()=>Math.max(0,Math.floor(performance.now()-began));
  function append(type,fields={}) {
    check(events.length<512,'ENGINE_TRANSPORT_EVENT_LIMIT');
    events.push({type,atMs:elapsed(),epoch:job.epoch,...fields});
  }
  function fail(code,operation='OUTPUT') {
    if(failure||closed)return;
    failure=code;connecting?.abort();
    if(events.length<512)append('UNCERTAIN',{operation});
    for(const request of requests)request.destroy(fault(code));
    for(const socket of sockets)socket.destroy();
    agent.destroy();rejectOutput(fault(code));
  }
  function live() {check(!closed&&!failure,'ENGINE_TRANSPORT_UNAVAILABLE');targetLive();if(performance.now()>=deadline){fail('ENGINE_TRANSPORT_DEADLINE');throw fault('ENGINE_TRANSPORT_DEADLINE');}}
  function review() {
    if(finalReview)return finalReview;
    return reviewProofDecoderEngineTranscript({plan,job:initialJob,original,seccompBytes:seccomp,events,...target});
  }
  function sequence() {check(review().reviewStatus!=='RECONCILIATION_REQUIRED','ENGINE_TRANSPORT_SEQUENCE');}
  function acceptOutput(chunk) {
    try {
      live();if(endpoint)endpoint.assertSocket(attachment);check(!outputClosed&&Buffer.isBuffer(chunk)&&chunk.length>0&&chunk.length<=10248,'ENGINE_TRANSPORT_OUTPUT');
      outputBytes+=chunk.length;check(outputBytes<=10248,'ENGINE_TRANSPORT_OUTPUT');
      const copy=Buffer.from(chunk);bodyBuffers.add(copy);append('OUTPUT',{bytes:copy});
      multiplex.feed(copy);if(!inputClosed&&multiplex.status().stdoutStarted)stdoutBeforeEof=true;
    }catch{fail('ENGINE_TRANSPORT_OUTPUT');}
  }
  function attach(socket,head) {
    check(!attachment&&head.length<=10248,'ENGINE_TRANSPORT_UPGRADE');attachment=socket;socket.pause();
    // RESPONSE owns the upgrade head in the transcript; do not append it again.
    if(head.length){outputBytes+=head.length;multiplex.feed(head);if(!inputClosed&&multiplex.status().stdoutStarted)stdoutBeforeEof=true;}
    socket.on('data',acceptOutput);
    socket.on('end',()=>{
      try {
        live();if(endpoint)endpoint.assertSocket(socket);multiplex.end();result=assertProofDecoderWorkerResult(worker.end(),{requestId:job.requestId,plan:original,limits:plan.profile.limits});
        if(result.outcome!=='DECODER_FAILURE')check(inputClosed&&!stdoutBeforeEof,'ENGINE_TRANSPORT_OUTPUT');
        append('OUTPUT_EOF');outputClosed=true;resolveOutput(decoderFreeze({...MARKERS,workerReport:result}));
      }catch{fail('ENGINE_TRANSPORT_OUTPUT');}
    });
    socket.on('error',()=>fail('ENGINE_TRANSPORT_SOCKET'));
    socket.on('close',()=>{if(!outputClosed&&!closed)fail('ENGINE_TRANSPORT_SOCKET');});
    socket.resume();
  }
  const timeout=setTimeout(()=>fail('ENGINE_TRANSPORT_DEADLINE'),Math.max(1,deadline-performance.now()));
  const abort=()=>fail('ENGINE_TRANSPORT_CANCELLED');signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();

  function writeChunk(chunk) {
    live();check(attachment&&!attachment.destroyed&&chunk.length>0&&chunk.length<=65536);if(runtime){check(inputBarrier,'ENGINE_TRANSPORT_INPUT_BARRIER');inputBarrier.assertLive();}if(endpoint)endpoint.assertSocket(attachment);
    return new Promise((resolve,reject)=>{
      const socket=attachment;let settled=false,callbackDone=false,drained=false,needsDrain=false,insideWrite=true;
      const cleanup=()=>{socket.off('drain',onDrain);socket.off('error',onError);socket.off('close',onClose);};
      const finish=error=>{if(settled)return;settled=true;cleanup();error?reject(fault('ENGINE_TRANSPORT_WRITE')):resolve();};
      const maybe=()=>{if(!insideWrite&&callbackDone&&(!needsDrain||drained))finish();};
      const onDrain=()=>{drained=true;maybe();},onError=()=>finish(true),onClose=()=>finish(true);
      socket.once('drain',onDrain);socket.once('error',onError);socket.once('close',onClose);
      try {needsDrain=!socket.write(chunk,error=>{if(error)return finish(true);callbackDone=true;maybe();});if(needsDrain)backpressureEvents++;insideWrite=false;maybe();}
      catch{finish(true);}
    });
  }

  const transport=Object.freeze({...MARKERS,
    async request(operation) {
      live();check(ALLOWED.includes(operation)&&requests.size<2&&requestCount<24,'ENGINE_TRANSPORT_OPERATION');
      // The existing reviewer refuses illegal order before an effect is sent.
      append('REQUEST',{operation});try{sequence();}catch{fail('ENGINE_TRANSPORT_SEQUENCE',operation);throw fault('ENGINE_TRANSPORT_SEQUENCE');}
      const requestData=compileProofDecoderEngineRequest({apiVersion:input.apiVersion,plan,job,operation,...(operation==='CREATE'?{seccompBytes:seccomp}:{}),...target});
      const requestJob=job;requestCount++;
      return new Promise((resolve,reject)=>{
        let settled=false,request,requestSocket,headerTimer,responseBody=null,bodySize=0;
        const done=(error,observation)=>{
          if(settled)return;settled=true;clearTimeout(headerTimer);requests.delete(request);
          responseBody?.fill(0);responseBody=null;
          if(error){fail(error,operation);reject(fault(error));}else resolve(observation);
        };
        const received=(statusCode,headers,body,upgradeHead,socket)=>{
          try {
            live();if(endpoint)endpoint.assertSocket(requestSocket);const observation=projectProofDecoderEngineResponse({apiVersion:input.apiVersion,plan,job:requestJob,operation,statusCode,headers,body});
            bodyBuffers.add(body);bodyBuffers.add(upgradeHead);
            append('RESPONSE',{operation,statusCode,headers,body,upgradeHead});
            sequence();
            if(operation==='CREATE')job=proofDecoderOwnedIdentity({...job,containerId:observation.data.containerId},plan);
            if(operation==='INSPECT'&&observation.data?.state?.running)targetMemberPid=observation.data.state.pid;
            if(socket)attach(socket,upgradeHead);
            done(null,observation);
          }catch{body.fill(0);upgradeHead.fill(0);socket?.destroy();done('ENGINE_TRANSPORT_RESPONSE');}
        };
        try {
          request=http.request({agent,socketPath:input.socketPath,host:'localhost',method:requestData.http.method,path:requestData.http.path,
            headers:{...requestData.http.headers,...(operation==='ATTACH'?{}:{connection:'close'}),'content-length':String(requestData.http.body===null?0:Buffer.byteLength(requestData.http.body))},
            maxHeaderSize:8192,insecureHTTPParser:false,joinDuplicateHeaders:false},response=>{
            clearTimeout(headerTimer);
            let headers;try{headers=headersOf(response.rawHeaders);}catch{response.destroy();done('ENGINE_TRANSPORT_HEADERS');return;}
            response.on('data',chunk=>{
              if(settled)return;
              try{targetLive();if(endpoint)endpoint.assertSocket(requestSocket);}catch{response.destroy();done('ENGINE_TRANSPORT_SOCKET');return;}
              bodySize+=chunk.length;
              if(bodySize>262144){response.destroy();done('ENGINE_TRANSPORT_BODY_LIMIT');return;}
              // One bounded accumulator, not one allocation per peer fragment.
              responseBody??=Buffer.alloc(262144);chunk.copy(responseBody,bodySize-chunk.length);
            });
            response.on('aborted',()=>done('ENGINE_TRANSPORT_RESPONSE'));
            response.on('error',()=>done('ENGINE_TRANSPORT_RESPONSE'));
            response.on('end',()=>{
              if(settled)return;
              if(!response.complete||response.rawTrailers.length){done('ENGINE_TRANSPORT_RESPONSE');return;}
              received(response.statusCode,headers,responseBody?Buffer.from(responseBody.subarray(0,bodySize)):Buffer.alloc(0),Buffer.alloc(0));
            });
          });
          requests.add(request);
          request.on('socket',socket=>{requestSocket=socket;sockets.add(socket);socket.once('close',()=>sockets.delete(socket));try{targetLive();if(endpoint)endpoint.assertSocket(socket);}catch{done('ENGINE_TRANSPORT_SOCKET');}});
          request.on('information',()=>done('ENGINE_TRANSPORT_HEADERS'));
          request.on('upgrade',(response,socket,head)=>{
            clearTimeout(headerTimer);
            try{check(operation==='ATTACH','ENGINE_TRANSPORT_UPGRADE');received(response.statusCode,headersOf(response.rawHeaders),Buffer.alloc(0),Buffer.from(head),socket);}
            catch{socket.destroy();done('ENGINE_TRANSPORT_UPGRADE');}
          });
          request.on('error',()=>done(failure??'ENGINE_TRANSPORT_SOCKET'));
          headerTimer=setTimeout(()=>{done('ENGINE_TRANSPORT_HEADER_DEADLINE');request.destroy();},Math.max(1,Math.min(headerTimeout,deadline-performance.now())));
          live();request.end(requestData.http.body);
        }catch{done('ENGINE_TRANSPORT_SOCKET');}
      });
    },
    async sendOriginal() {
      live();check(!inputStarted&&attachment&&review().started,'ENGINE_TRANSPORT_SEQUENCE');inputStarted=true;activeWrites++;
      try {
        if(runtime){
          check(Number.isSafeInteger(targetMemberPid)&&targetMemberPid>0,'ENGINE_TRANSPORT_MEMBERSHIP');
          inputBarrier=await runtime.controller.openWorkerInputBarrier({pid:targetMemberPid,containerId:job.containerId,plan,deadlineBootNs:runtime.deadlineBootNs});
          live();inputControls=inputBarrier.assertLive();
        }
        for(const chunk of [header,...Array.from({length:Math.ceil(bytes.length/65536)},(_,i)=>bytes.subarray(i*65536,Math.min(bytes.length,(i+1)*65536)))]){
          await writeChunk(chunk);live();append('INPUT',{bytes:chunk});inputBytesWritten+=chunk.length;
        }
        await new Promise((resolve,reject)=>{
          const socket=attachment;
          const cleanup=()=>{socket.off('error',failed);socket.off('close',failed);};
          const failed=()=>{cleanup();reject(fault('ENGINE_TRANSPORT_WRITE'));};
          socket.once('error',failed);socket.once('close',failed);
          live();if(runtime){check(inputBarrier,'ENGINE_TRANSPORT_INPUT_BARRIER');inputBarrier.assertLive();}if(endpoint)endpoint.assertSocket(socket);
          socket.end(()=>{cleanup();try{live();if(endpoint)endpoint.assertSocket(socket);append('INPUT_EOF');inputClosed=true;resolve();}catch{reject(fault('ENGINE_TRANSPORT_WRITE'));}});
        });
      }catch(error){const code=typeof error?.code==='string'&&/^DECODER_(?:KERNEL|NATIVE)_INPUT_[A-Z_]+$/.test(error.code)?error.code:'ENGINE_TRANSPORT_WRITE';fail(code,'INPUT');throw fault(code);}
      finally{inputBarrier?.close();inputBarrier=null;activeWrites--;}
    },
    outputComplete(){return outputDone;},
    review,
    status(){return decoderFreeze({...MARKERS,closed,failure,requestCount,pendingRequests:requests.size,openSockets:sockets.size,activeWrites,backpressureEvents,inputBytesWritten,inputClosed,outputClosed,outputBytes,
      job,inputControls,cleanup:'UNKNOWN',capacityHeld:true,peerIdentityVerified:false,independentWatchdog:false});},
    close(){
      if(closed)return this.status();
      if(!outputClosed||requests.size||activeWrites)fail('ENGINE_TRANSPORT_CLOSED');
      try{finalReview=review();}catch{finalReview=null;}
      closed=true;inputBarrier?.close();inputBarrier=null;connecting?.abort();clearTimeout(timeout);signal?.removeEventListener('abort',abort);
      for(const request of requests)request.destroy();for(const socket of sockets)socket.destroy();agent.destroy();
      rejectOutput(fault('ENGINE_TRANSPORT_CLOSED'));multiplex.dispose();worker.dispose();
      for(const buffer of bodyBuffers)buffer.fill(0);bodyBuffers.clear();bytes.fill(0);seccomp.fill(0);header.fill(0);events.length=0;
      return this.status();
    },
  });
  return transport;
}
