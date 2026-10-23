import {createServer,createConnection} from 'node:net';
import {lstatSync,mkdirSync,chmodSync,realpathSync,readdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {hash,canonicalJSON} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderContractData,decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {parseProofDecoderEngineJSON,engineDataOptions} from './proof-decoder-engine-json.mjs';
import {proofDecoderOwnedIdentity} from './proof-decoder-owned-operations.mjs';
import {assertProofDecoderLinuxCgroupController} from './proof-decoder-linux-cgroup.mjs';
import {assertProofDecoderLinuxObserver} from './proof-decoder-linux-observer.mjs';
import {assertProofDecoderTargetRegistry} from './proof-decoder-target-registry.mjs';

const DIRECTORY='/run/atlas-r2-decoder-guard',SOCKET=DIRECTORY+'/control.sock';
const MAX_MESSAGE=4096,PULSE_NS=250000000n,MAX_NS=18446744073709551615n;
const clients=new WeakMap(),leases=new WeakMap();
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const check=(value,code='DECODER_KERNEL_GUARD_INVALID')=>{if(!value)fail(code);};
const ns=value=>{check(typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=MAX_NS);return BigInt(value);};
const nonce=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function binding(plan,controller,epoch){
  check(typeof epoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(epoch));
  const state=controller.status();check(state.healthy&&!state.closed&&!state.freezeRequested&&!state.frozen);
  return {bindingHash:hash({schema:'atlas-proof-decoder-target-ledger-binding-v1',bootId:state.bootId,epoch,profileHash:plan.profileHash,limitsHash:plan.limitsHash,image:plan.profile.image,parentBindingHash:state.bindingHash}),parentBindingHash:state.bindingHash,bootId:state.bootId};
}
function protectedDirectory(){
  for(let path=DIRECTORY;;path=dirname(path)){
    const st=lstatSync(path);check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&(st.mode&0o022)===0&&realpathSync(path)===path,'DECODER_GUARD_DIRECTORY');
    if(path===DIRECTORY)check((st.mode&0o7777)===0o700,'DECODER_GUARD_DIRECTORY');
    if(path==='/')break;
  }
  const st=lstatSync(DIRECTORY);return `${st.dev}:${st.ino}`;
}
function socketStamp(){const st=lstatSync(SOCKET);check(st.isSocket()&&st.uid===0&&(st.mode&0o7777)===0o600,'DECODER_GUARD_SOCKET');return `${st.dev}:${st.ino}`;}
function write(socket,value){
  check(!socket.destroyed&&socket.writable&&socket.writableLength<=MAX_MESSAGE,'DECODER_GUARD_TRANSPORT');
  const bytes=Buffer.from(canonicalJSON(value)+'\n');check(bytes.length<=MAX_MESSAGE);socket.write(bytes);
}
function frames(socket,receive,abort){
  let pending=Buffer.alloc(0);
  socket.on('data',bytes=>{
    try{
      check(pending.length+bytes.length<=MAX_MESSAGE*2,'DECODER_GUARD_TRANSPORT');pending=Buffer.concat([pending,bytes]);
      let end;
      while((end=pending.indexOf(10))!==-1){check(end>0&&end<MAX_MESSAGE);const frame=pending.subarray(0,end);pending=pending.subarray(end+1);receive(parseProofDecoderEngineJSON(frame,{maxBytes:MAX_MESSAGE}));}
      check(pending.length<MAX_MESSAGE);
    }catch{abort('PROTOCOL');}
  });
  socket.on('error',()=>abort('TRANSPORT'));socket.on('end',()=>abort('DISCONNECT'));socket.on('close',()=>{pending=Buffer.alloc(0);abort('DISCONNECT');});
}

/** Independent process guard. No Engine access, ledger writes, receipt minting,
 * automatic restart, thaw, or deserialized cleanup authority. The service must
 * additionally be supervised by its systemd watchdog/ExecStopPost kill hook. */
export async function startProofDecoderKernelGuard(options={}){
  const {enabled=false,controller:inputController,observer:inputObserver,plan:inputPlan,epoch}=engineDataOptions(options,[],['enabled','controller','observer','plan','epoch']);
  if(enabled!==true)return null;
  const controller=assertProofDecoderLinuxCgroupController(inputController),observer=assertProofDecoderLinuxObserver(inputObserver),plan=assertProofDecoderLaunchPlan(inputPlan);
  check(process.getuid()===0,'DECODER_GUARD_ROOT');const bound=binding(plan,controller,epoch);controller.observeEmpty();
  try{mkdirSync(DIRECTORY,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const directoryStamp=protectedDirectory();check(readdirSync(DIRECTORY).length===0,'DECODER_GUARD_STALE_SOCKET');
  let accepted=false,connected=null,peer=null,active=null,closed=false,poisoned=false,reason=null,sequence=0,lastRequest=0,jobs=0,timer;
  const serverNonce=randomBytes(32).toString('hex'),seen=new Set();
  const server=createServer({allowHalfOpen:false});
  const abort=why=>{
    if(poisoned)return;poisoned=true;reason=why;
    try{controller.freezeAndKill();}catch{reason='KERNEL_KILL_UNCERTAIN';}
    connected?.destroy();peer?.close();clearInterval(timer);server.close(()=>{});
  };
  const live=()=>{
    check(!closed&&!poisoned,'DECODER_GUARD_UNAVAILABLE');
    check(protectedDirectory()===directoryStamp,'DECODER_GUARD_DIRECTORY');
    const state=controller.status();check(state.healthy&&!state.freezeRequested&&!state.frozen&&state.bindingHash===bound.parentBindingHash,'DECODER_GUARD_PARENT');
    peer?.assertAlive();const now=controller.boottimeNanoseconds();
    if(active===null)controller.observeEmpty();
    if(active)check(now<ns(active.deadlineBootNs),'DECODER_GUARD_DEADLINE');return now;
  };
  const pulse=()=>{
    try{const now=live();if(connected){check(++sequence<=2147483647);write(connected,{kind:'PULSE',sequence,nowNs:String(now),serverNonce});}}
    catch{abort('LIVENESS');}
  };
  server.on('connection',socket=>{
    if(accepted||closed||poisoned){socket.on('error',()=>{});socket.destroy();return;}
    accepted=true;connected=socket;
    try{
      check(protectedDirectory()===directoryStamp);peer=observer.capture(socket,{uid:0,gid:0});
      check(peer.assertAlive().pid!==process.pid,'DECODER_GUARD_INDEPENDENCE');
      frames(socket,message=>{
        const now=live();decoderExact(message,['kind','request','serverNonce','bindingHash','payload']);
        check(Number.isSafeInteger(message.request)&&message.request===lastRequest+1&&message.request<=256&&message.serverNonce===serverNonce&&message.bindingHash===bound.bindingHash);lastRequest=message.request;
        if(message.kind==='ADOPT'){
          check(active===null&&++jobs<=128);decoderExact(message.payload,['identity','deadlineBootNs','leaseNonce']);
          const identity=proofDecoderOwnedIdentity(message.payload.identity,plan),deadline=ns(message.payload.deadlineBootNs);
          check(identity.epoch===epoch&&identity.containerId===null&&!seen.has(identity.jobId)&&nonce(message.payload.leaseNonce));
          check(deadline>now&&deadline-now<=BigInt(plan.profile.limits.timeoutMs)*1000000n);
          controller.observeEmpty();seen.add(identity.jobId);
          active=decoderFreeze({identity,deadlineBootNs:message.payload.deadlineBootNs,leaseNonce:message.payload.leaseNonce});
        }else if(message.kind==='SETTLE'){
          decoderExact(message.payload,['leaseNonce']);check(active!==null&&message.payload.leaseNonce===active.leaseNonce);
          // This empty snapshot never becomes a ledger receipt. Only the broker
          // may settle after its own in-process receipt checks and finalization.
          controller.observeEmpty();active=null;
        }else check(false);
        write(socket,{kind:'ACK',request:message.request,serverNonce,nowNs:String(live()),leaseNonce:message.payload.leaseNonce});
      },abort);
      write(socket,{kind:'HELLO',serverNonce,...bound,epoch,profileHash:plan.profileHash,nowNs:String(live())});pulse();
    }catch{abort('PEER');}
  });
  server.on('error',()=>abort('LISTENER'));
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(SOCKET,()=>{server.off('error',reject);resolve();});});
    chmodSync(SOCKET,0o600);socketStamp();check(protectedDirectory()===directoryStamp);timer=setInterval(pulse,50);
  }catch(error){abort('STARTUP');throw error;}
  return Object.freeze({classification:'UNQUALIFIED',executionAllowed:false,
    status(){return decoderFreeze({...bound,epoch,closed,poisoned,reason,connected:accepted,activeJobId:active?.identity.jobId??null});},
    assertHealthy(){live();return true;},
    close(){if(closed)return;closed=true;abort('SHUTDOWN');}
  });
}

/** Broker-only client. All peer lifetime, clock, parent and registry objects
 * must be concrete. HELLO/ACK/PULSE are bounded protocol reports, not cleanup
 * or admission receipts. A lost guard poisons the epoch and kills the parent. */
export async function createProofDecoderKernelGuardClient(options={}){
  const {enabled=false,controller:inputController,observer:inputObserver,plan:inputPlan,targetRegistry:inputRegistry}=engineDataOptions(options,[],['enabled','controller','observer','plan','targetRegistry']);
  if(enabled!==true)return null;
  const controller=assertProofDecoderLinuxCgroupController(inputController),observer=assertProofDecoderLinuxObserver(inputObserver),plan=assertProofDecoderLaunchPlan(inputPlan),registry=assertProofDecoderTargetRegistry(inputRegistry,{plan,controller});
  const registryState=registry.status(),bound=binding(plan,controller,registryState.epoch);
  check(!registryState.closed&&!registryState.poisoned&&registryState.bindingHash===bound.bindingHash&&registryState.parentBindingHash===bound.parentBindingHash);
  const directoryStamp=protectedDirectory(),before=socketStamp();
  let peer,hello=null,lastPulse=0n,lastSequence=0,request=0,pending=null,active=null,closed=false,poisoned=false,settling=false;
  let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const socket=createConnection(SOCKET);let timer;
  const abort=reason=>{
    if(poisoned)return;poisoned=true;
    try{registry.quarantineEpoch({reason:'GUARD_'+reason});}catch{}
    try{controller.freezeAndKill();}catch{}
    socket.destroy();peer?.close();clearInterval(timer);
    const error=new Error('DECODER_GUARD_UNAVAILABLE');error.code='DECODER_GUARD_UNAVAILABLE';
    readyReject(error);if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}
  };
  const fresh=stamp=>{const observed=ns(stamp),now=controller.boottimeNanoseconds();check(observed<=now&&now-observed<=PULSE_NS,'DECODER_GUARD_STALE');return observed;};
  const live=()=>{
    check(!closed&&!poisoned&&hello!==null&&peer,'DECODER_GUARD_UNAVAILABLE');peer.assertAlive();
    check(protectedDirectory()===directoryStamp&&socketStamp()===before,'DECODER_GUARD_SOCKET');
    const state=controller.status(),now=controller.boottimeNanoseconds();
    check(state.healthy&&!state.freezeRequested&&!state.frozen&&state.bindingHash===bound.parentBindingHash);
    check(lastPulse>0n&&now>=lastPulse&&now-lastPulse<=PULSE_NS,'DECODER_GUARD_STALE');
    check(!active||now<ns(active.deadlineBootNs),'DECODER_GUARD_DEADLINE');
    const current=registry.status();check(!current.closed&&!current.poisoned&&current.bindingHash===bound.bindingHash,'DECODER_GUARD_REGISTRY');return now;
  };
  socket.once('connect',()=>{
    try{check(protectedDirectory()===directoryStamp&&socketStamp()===before);peer=observer.capture(socket,{uid:0,gid:0});check(peer.assertAlive().pid!==process.pid,'DECODER_GUARD_INDEPENDENCE');}
    catch{abort('PEER');}
  });
  frames(socket,message=>{
    peer?.assertAlive();
    if(message.kind==='HELLO'){
      decoderExact(message,['kind','serverNonce','bindingHash','parentBindingHash','bootId','epoch','profileHash','nowNs']);
      check(hello===null&&nonce(message.serverNonce)&&message.bindingHash===bound.bindingHash&&message.parentBindingHash===bound.parentBindingHash&&message.bootId===bound.bootId&&message.epoch===registryState.epoch&&message.profileHash===plan.profileHash);
      lastPulse=fresh(message.nowNs);hello=decoderFreeze(message);readyResolve();
    }else if(message.kind==='PULSE'){
      decoderExact(message,['kind','sequence','nowNs','serverNonce']);check(hello&&message.serverNonce===hello.serverNonce&&Number.isSafeInteger(message.sequence)&&message.sequence===lastSequence+1&&message.sequence<=2147483647);
      const observed=fresh(message.nowNs);check(observed>=lastPulse);lastPulse=observed;lastSequence=message.sequence;
    }else if(message.kind==='ACK'){
      decoderExact(message,['kind','request','serverNonce','nowNs','leaseNonce']);check(hello&&pending&&message.request===pending.request&&message.serverNonce===hello.serverNonce&&message.leaseNonce===pending.leaseNonce);
      const observed=fresh(message.nowNs);check(observed>=lastPulse);lastPulse=observed;const done=pending;pending=null;clearTimeout(done.timer);done.resolve();
    }else check(false);
  },abort);
  const timeout=setTimeout(()=>abort('CONNECT_TIMEOUT'),500);
  try{await ready;live();}catch(error){abort('CONNECT');throw error;}finally{clearTimeout(timeout);}
  timer=setInterval(()=>{try{live();}catch{abort('LIVENESS');}},50);
  const exchange=(kind,payload)=>{
    live();check(!pending&&++request<=256);
    return new Promise((resolve,reject)=>{pending={request,leaseNonce:payload.leaseNonce,resolve,reject,timer:setTimeout(()=>abort('ACK_TIMEOUT'),500)};try{write(socket,{kind,request,serverNonce:hello.serverNonce,bindingHash:bound.bindingHash,payload});}catch{abort('TRANSPORT');}});
  };
  const client=Object.freeze({classification:'UNQUALIFIED',executionAllowed:false,
    async adopt(options={}){
      try{
        const {identity:input,deadlineBootNs}=engineDataOptions(options,['identity','deadlineBootNs']);
        live();check(active===null&&!settling,'DECODER_GUARD_BUSY');const identity=proofDecoderOwnedIdentity(input,plan),deadline=ns(deadlineBootNs),now=controller.boottimeNanoseconds();
        check(identity.registryId===registryState.registryId&&identity.epoch===registryState.epoch&&identity.containerId===null&&deadline>now&&deadline-now<=BigInt(plan.profile.limits.timeoutMs)*1000000n);
        const row=registry.get(identity.jobId);check(row?.phase==='RESERVED'&&canonicalJSON(row.identity)===canonicalJSON(identity)&&row.deadlineAtNs===deadlineBootNs);
        const state=decoderFreeze({identity,deadlineBootNs,bindingHash:bound.bindingHash}),lease=Object.freeze({classification:'UNQUALIFIED',executionAllowed:false});
        active={...state,leaseNonce:randomBytes(32).toString('hex'),lease};
        await exchange('ADOPT',{identity,deadlineBootNs,leaseNonce:active.leaseNonce});live();leases.set(lease,{client,state});return lease;
      }catch(error){abort('ADOPT');throw error;}
    },
    assertLive(lease){try{const known=leases.get(lease);check(known?.client===client&&active?.lease===lease&&!settling,'DECODER_GUARD_LEASE');live();return known.state;}catch(error){abort('LEASE');throw error;}},
    async settle(lease){
      try{
        client.assertLive(lease);const row=registry.get(active.identity.jobId);check(row?.phase==='FINALIZED'&&row.cleanup!==null&&row.bindingHash===bound.bindingHash,'DECODER_GUARD_NOT_FINALIZED');
        controller.observeEmpty();settling=true;await exchange('SETTLE',{leaseNonce:active.leaseNonce});active=null;settling=false;
      }catch(error){abort('SETTLE');throw error;}
    },
    close(){if(closed)return;closed=true;abort('SHUTDOWN');}
  });clients.set(client,{controller,bindingHash:bound.bindingHash});return client;
}

export function assertProofDecoderKernelGuardClient(value,options={}){
  const {controller,bindingHash}=engineDataOptions(options,['controller','bindingHash']);
  const known=clients.get(value);check(known&&known.controller===controller&&known.bindingHash===bindingHash,'DECODER_KERNEL_GUARD_CLIENT_REQUIRED');return value;
}
