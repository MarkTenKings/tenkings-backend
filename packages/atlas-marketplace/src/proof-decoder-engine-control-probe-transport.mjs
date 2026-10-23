import http from 'node:http';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderContractData,decoderFreeze} from './proof-decoder-profile.mjs';
import {proofDecoderOwnedIdentity} from './proof-decoder-owned-operations.mjs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {PROOF_DECODER_ENGINE_API,compileProofDecoderEngineRequest} from './proof-decoder-engine-request.mjs';
import {projectProofDecoderEngineResponse} from './proof-decoder-engine-response.mjs';
import {encodeProofDecoderControlProbeInput,createProofDecoderControlProbeOutputReader} from './proof-decoder-control-probe-protocol.mjs';
import {canonicalJSON} from './contract.mjs';
import {assertProofDecoderFixedParentBinding,assertProofDecoderFixedParentReport} from './proof-decoder-engine-target-binding.mjs';
import {assertProofDecoderLinuxCgroupController} from './proof-decoder-linux-cgroup.mjs';
import {assertProofDecoderKernelGuardClient} from './proof-decoder-kernel-guard.mjs';
import {assertProofDecoderEngineTargetSocketPath,createProofDecoderEngineTargetEndpoint} from './proof-decoder-engine-target-endpoint.mjs';

const MARKERS={classification:'UNVERIFIED',evidenceKind:'PROBE_ONLY',executionAllowed:false,freshPublicationAllowed:false,runtimeQualified:false};
const SEQUENCE=['IMAGE_INSPECT','CREATE','INSPECT','ATTACH','START','INSPECT','INPUT','WAIT'];
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

export const PROOF_DECODER_CONTROL_PROBE_IMAGE='127.0.0.1:5001/atlas-r2-control-probe@sha256:961dacfae60d2a302f4699ab7c26c587833aac54dfcf25c1a7b8060140dfe999';
export const PROOF_DECODER_CONTROL_PROBE_REQUEST='atlas-proof-decoder-control-probe-request-v1';
export const PROOF_DECODER_CONTROL_PROBE_CLEANUP='atlas-proof-decoder-control-probe-cleanup-v1';

/** Exact reviewed comparison controls. The C ELF at the fixed node path is
 * explicitly a probe, so nodeVersion is only inherited baseline metadata. */
export function assertProofDecoderControlProbeLaunchPlan(value){
  const plan=assertProofDecoderLaunchPlan(value),p=plan.profile;
  check(p.image===PROOF_DECODER_CONTROL_PROBE_IMAGE&&p.platform==='linux/amd64'&&p.nodeVersion==='22.16.0'&&p.uid===65532&&p.gid===65532,'ENGINE_PROBE_IMAGE');
  check(canonicalJSON(p.limits)===canonicalJSON({maxConcurrent:1,maxObjectBytes:10485760,maxPixels:16000000,timeoutMs:15000}),'ENGINE_PROBE_LIMITS');
  check(canonicalJSON(p.resources)===canonicalJSON({memoryBytes:536870912,cpuQuotaMicros:150000,cpuPeriodMicros:100000,pidsLimit:32,nofileLimit:64,tmpfsBytes:8388608,shmBytes:8388608}),'ENGINE_PROBE_LIMITS');
  check(canonicalJSON(p.seccomp)===canonicalJSON({path:'/etc/atlas-r2-decoder/security-01/seccomp.json',sha256:'5f179abeafd17a18dbb6d0617fbda4a980d9b941e984b270f438ffdaebf47ede'})&&
    canonicalJSON(p.mac)===canonicalJSON({kind:'apparmor',name:'atlas_r2_decoder_8c01465b205082c010733e63f6966b7b24913d0da1db72ab8befc3dbc32d0291'}),'ENGINE_PROBE_POLICY');
  return plan;
}

/** Pure challenge descriptor, never an image plan or a capability. */
export function proofDecoderControlProbeRequest(options){
  const input=engineDataOptions(options,['mode','nonce']);
  const bytes=encodeProofDecoderControlProbeInput(input);
  try{return decoderFreeze({schema:PROOF_DECODER_CONTROL_PROBE_REQUEST,evidenceKind:'PROBE_ONLY',mode:input.mode,nonce:input.nonce,byteCount:48,sha256:digest(bytes)});}
  finally{bytes.fill(0);}
}
export function assertProofDecoderControlProbeRequest(value){
  const input=decoderContractData(value);
  engineDataOptions(input,['schema','evidenceKind','mode','nonce','byteCount','sha256']);
  const expected=proofDecoderControlProbeRequest({mode:input.mode,nonce:input.nonce});
  check(canonicalJSON(input)===canonicalJSON(expected),'ENGINE_PROBE_CHALLENGE');return expected;
}

/** Fixed Docker framing plus the finite probe grammar. No callbacks or worker
 * result parser. Missing FINAL stays incomplete even when death is expected. */
export function createProofDecoderControlProbeStreamReader(options){
  const reader=createProofDecoderControlProbeOutputReader(options),header=Buffer.alloc(8);
  let headerAt=0,payload=null,payloadAt=0,kind=0,frames=0,total=0,stdout=0,stderr=0,stdoutStarted=false,failed=false,ended=false;
  const clear=()=>{header.fill(0);payload?.fill(0);payload=null;headerAt=0;payloadAt=0;};
  function refuse(error){failed=true;clear();reader.close();throw error;}
  return Object.freeze({
    feed(chunk){try{
      check(!failed&&!ended&&Buffer.isBuffer(chunk),'ENGINE_PROBE_STREAM');total+=chunk.length;check(total<=14336,'ENGINE_PROBE_STREAM');let at=0;
      while(at<chunk.length){
        if(payload===null){
          if(headerAt===0&&chunk[at]===1)stdoutStarted=true;
          const n=Math.min(8-headerAt,chunk.length-at);chunk.copy(header,headerAt,at,at+n);headerAt+=n;at+=n;if(headerAt<8)continue;
          kind=header[0];check((kind===1||kind===2)&&header.readUIntBE(1,3)===0&&++frames<=256,'ENGINE_PROBE_STREAM');
          const size=header.readUInt32BE(4);check(size<=(kind===1?8192-stdout:4096-stderr),'ENGINE_PROBE_STREAM');payload=Buffer.alloc(size);payloadAt=0;
        }
        const n=Math.min(payload.length-payloadAt,chunk.length-at);chunk.copy(payload,payloadAt,at,at+n);payloadAt+=n;at+=n;
        if(payloadAt===payload.length){const body=payload;payload=null;headerAt=0;payloadAt=0;
          try{if(kind===1){stdout+=body.length;if(body.length)reader.feed(body);}else stderr+=body.length;}finally{body.fill(0);}
        }
      }
    }catch(error){refuse(error);}},
    end(){try{check(!failed&&!ended&&headerAt===0&&payload===null,'ENGINE_PROBE_STREAM');const result=reader.end();ended=true;clear();return result;}catch(error){refuse(error);}},
    snapshot(){const snapshot=reader.snapshot();return decoderFreeze({...snapshot,state:failed?'FAILED':snapshot.state});},
    status(){return Object.freeze({frames,totalBytes:total,stdoutBytes:stdout,stderrBytes:stderr,stdoutStarted,bufferedBytes:headerAt+payloadAt,allocatedBytes:8+(payload?.length??0)+4096,failed,ended});},
    dispose(){ended=true;clear();reader.close();}
  });
}

/** Root-only concrete transport for exactly the pinned C probe image. It has
 * no fixture endpoint, generic command, user-supplied parser or receipt mint. */
export function createProofDecoderEngineControlProbeTransport(options={}) {
  const input=engineDataOptions(options,[],['enabled','socketPath','apiVersion','plan','job','challenge','seccompBytes','deadlineMono','headerTimeoutMs','signal','targetBinding','targetRuntime']);
  if(input.enabled!==true)return null;
  const plan=assertProofDecoderControlProbeLaunchPlan(input.plan),initialJob=proofDecoderOwnedIdentity(input.job,plan);
  check(process.platform==='linux'&&process.getuid()===0&&process.getgid()===0,'ENGINE_PROBE_ROOT');
  check(plan.profile.image===PROOF_DECODER_CONTROL_PROBE_IMAGE&&plan.profile.limits.maxConcurrent===1,'ENGINE_PROBE_IMAGE');
  const challenge=assertProofDecoderControlProbeRequest(input.challenge);
  check(initialJob.containerId===null&&input.apiVersion===PROOF_DECODER_ENGINE_API);
  check(typeof input.socketPath==='string'&&input.socketPath.length<=100&&/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(input.socketPath)&&input.socketPath.split('/').every(part=>part!=='.'&&part!=='..'));
  check(challenge.byteCount<=plan.profile.limits.maxObjectBytes);
  check(Buffer.isBuffer(input.seccompBytes)&&input.seccompBytes.length<=65536);
  const began=performance.now(),deadline=input.deadlineMono,headerTimeout=input.headerTimeoutMs??1000,signal=input.signal;
  check(Number.isFinite(deadline)&&deadline>began&&deadline-began<=plan.profile.limits.timeoutMs);
  check(Number.isSafeInteger(headerTimeout)&&headerTimeout>=1&&headerTimeout<=5000);
  check(signal===undefined||signal instanceof AbortSignal);
  let target={},runtime=null,targetMemberPid=null,endpoint=null,inputBarrier=null,inputControls=null;
  check(input.targetBinding!==undefined&&input.targetRuntime!==undefined,'ENGINE_PROBE_TARGET_REQUIRED');
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
  // Copy BEFORE any asynchronous boundary/socket. The challenge is reconstructed from its closed descriptor; the
  // seccomp artifact is copied before the first asynchronous boundary.
  const bytes=encodeProofDecoderControlProbeInput({mode:challenge.mode,nonce:challenge.nonce}),seccomp=Buffer.from(input.seccompBytes);
  try {
    check(digest(bytes)===challenge.sha256,'ENGINE_TRANSPORT_SOURCE_MISMATCH');
    compileProofDecoderEngineRequest({apiVersion:input.apiVersion,plan,job:initialJob,operation:'CREATE',seccompBytes:seccomp,...target});
  }catch(error){bytes.fill(0);seccomp?.fill(0);throw error;}
  const events=[],requests=new Set(),sockets=new Set(),bodyBuffers=new Set();
  let job=initialJob,closed=false,failure=null,attachment=null,inputStarted=false,inputClosed=false,outputClosed=false,outputBytes=0;
  let result=null,requestCount=0,activeWrites=0,stdoutBeforeEof=false,backpressureEvents=0,inputBytesWritten=0,sequenceAt=0,imageId=null,startedAt=null;
  let resolveOutput,rejectOutput;
  const outputDone=new Promise((resolve,reject)=>{resolveOutput=resolve;rejectOutput=reject;});outputDone.catch(()=>{});
  const multiplex=createProofDecoderControlProbeStreamReader({expectedMode:challenge.mode,expectedNonce:challenge.nonce});
  // This private agent has no TCP/DNS path and never pools a socket for another
  // job. allowHalfOpen preserves read-side draining after stdin FIN.
  const agent=new http.Agent({keepAlive:false,maxSockets:2,maxTotalSockets:2,maxFreeSockets:0});
  const connecting=runtime?new AbortController():null;
  agent.createConnection=(_,callback)=>{
    endpoint.connect({allowHalfOpen:true,timeoutMs:Math.max(1,Math.min(500,Math.floor(deadline-performance.now()))),signal:connecting.signal})
      .then(socket=>callback(null,socket),error=>callback(error));
  };
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
  function acceptReport(operation,observation,body){
    check(!['NOT_FOUND_REPORTED','ENGINE_ERROR_REPORTED'].includes(observation.kind),'ENGINE_PROBE_RESPONSE');
    if(operation==='IMAGE_INSPECT'){check(observation.kind==='IMAGE_REPORTED');imageId=observation.data.imageId;}
    else if(operation==='CREATE'){check(observation.kind==='CREATE_REPORTED'&&observation.data.warningCount===0);}
    else if(operation==='INSPECT'){
      assertProofDecoderFixedParentReport({body,targetBinding:target.targetBinding,plan});
      check(observation.kind==='CONTAINER_REPORTED'&&observation.data.imageId===imageId,'ENGINE_PROBE_IMAGE');
      const st=observation.data.state;check(!st.oomKilled&&!st.dead&&!st.paused&&!st.restarting&&st.exitCode===0,'ENGINE_PROBE_STATE');
      if(sequenceAt===3)check(st.status==='created'&&!st.running&&st.pid===0&&st.startedAt==='0001-01-01T00:00:00Z'&&st.finishedAt==='0001-01-01T00:00:00Z','ENGINE_PROBE_STATE');
      else{check(sequenceAt===6&&st.status==='running'&&st.running&&st.pid>0&&Date.parse(st.startedAt)>0&&st.finishedAt==='0001-01-01T00:00:00Z','ENGINE_PROBE_STATE');startedAt=st.startedAt;}
    }else if(operation==='ATTACH')check(observation.kind==='ATTACH_UPGRADE_REPORTED');
    else if(operation==='START')check(observation.kind==='START_REPORTED'&&!stdoutBeforeEof&&!outputClosed);
    else if(operation==='WAIT')check(observation.kind==='WAIT_REPORTED','ENGINE_PROBE_WAIT');
  }
  function acceptOutput(chunk) {
    try {
      live();if(endpoint)endpoint.assertSocket(attachment);check(!outputClosed&&Buffer.isBuffer(chunk)&&chunk.length>0&&chunk.length<=14336,'ENGINE_TRANSPORT_OUTPUT');
      outputBytes+=chunk.length;check(outputBytes<=14336,'ENGINE_TRANSPORT_OUTPUT');
      multiplex.feed(chunk);if(!inputClosed&&multiplex.status().stdoutStarted)stdoutBeforeEof=true;
    }catch{fail('ENGINE_TRANSPORT_OUTPUT');}
  }
  function attach(socket,head) {
    check(!attachment&&head.length<=14336,'ENGINE_TRANSPORT_UPGRADE');attachment=socket;socket.pause();
    // RESPONSE owns the upgrade head in the transcript; do not append it again.
    if(head.length){outputBytes+=head.length;multiplex.feed(head);if(!inputClosed&&multiplex.status().stdoutStarted)stdoutBeforeEof=true;}
    socket.on('data',acceptOutput);
    socket.on('end',()=>{
      try {
        live();if(endpoint)endpoint.assertSocket(socket);result=multiplex.end();check(inputClosed&&!stdoutBeforeEof&&sequenceAt>=7,'ENGINE_TRANSPORT_OUTPUT');
        append('OUTPUT_EOF');outputClosed=true;resolveOutput(decoderFreeze({...MARKERS,probeReport:result}));
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
      live();check(SEQUENCE[sequenceAt]===operation&&requests.size===0&&requestCount<7&&!activeWrites,'ENGINE_TRANSPORT_OPERATION');sequenceAt++;
      append('REQUEST',{operation});
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
            append('RESPONSE',{operation,statusCode});
            acceptReport(operation,observation,body);
            if(operation==='CREATE')job=proofDecoderOwnedIdentity({...job,containerId:observation.data.containerId},plan);
            if(operation==='INSPECT'&&observation.data?.state?.running)targetMemberPid=observation.data.state.pid;
            if(socket)attach(socket,upgradeHead);
            body.fill(0);upgradeHead.fill(0);done(null,observation);
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
    async sendChallenge() {
      live();check(!inputStarted&&attachment&&SEQUENCE[sequenceAt]==='INPUT'&&targetMemberPid&&requests.size===0,'ENGINE_TRANSPORT_SEQUENCE');sequenceAt++;inputStarted=true;activeWrites++;
      try {
        if(runtime){
          check(Number.isSafeInteger(targetMemberPid)&&targetMemberPid>0,'ENGINE_TRANSPORT_MEMBERSHIP');
          inputBarrier=await runtime.controller.openWorkerInputBarrier({pid:targetMemberPid,containerId:job.containerId,plan,deadlineBootNs:runtime.deadlineBootNs});
          live();inputControls=inputBarrier.assertLive();
        }
        for(const chunk of [bytes]){
          await writeChunk(chunk);live();append('INPUT',{byteCount:chunk.length});inputBytesWritten+=chunk.length;
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
    status(){return decoderFreeze({...MARKERS,closed,failure,requestCount,pendingRequests:requests.size,openSockets:sockets.size,activeWrites,backpressureEvents,inputBytesWritten,inputClosed,outputClosed,outputBytes,
      job,challenge,probeReport:multiplex.snapshot(),startedAt,imageId,inputControls,cleanup:'UNKNOWN',capacityHeld:true,peerIdentityVerified:false,independentWatchdog:false});},
    close(){
      if(closed)return this.status();
      if(!outputClosed||requests.size||activeWrites)fail('ENGINE_TRANSPORT_CLOSED');
      closed=true;inputBarrier?.close();inputBarrier=null;connecting?.abort();clearTimeout(timeout);signal?.removeEventListener('abort',abort);
      for(const request of requests)request.destroy();for(const socket of sockets)socket.destroy();agent.destroy();
      rejectOutput(fault('ENGINE_TRANSPORT_CLOSED'));multiplex.dispose();
      for(const buffer of bodyBuffers)buffer.fill(0);bodyBuffers.clear();bytes.fill(0);seccomp.fill(0);events.length=0;
      return this.status();
    },
  });
  return transport;
}
