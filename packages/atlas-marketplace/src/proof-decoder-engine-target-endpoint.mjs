import net from 'node:net';
import {lstatSync,realpathSync} from 'node:fs';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {assertProofDecoderLinuxObserver} from './proof-decoder-linux-observer.mjs';

const PATH='/run/docker.sock',endpoints=new WeakMap();
const fail=()=>{const error=new Error('ENGINE_TARGET_ENDPOINT_REQUIRED');error.code='ENGINE_TARGET_ENDPOINT_REQUIRED';throw error;};
const check=value=>{if(!value)fail();};

/** Pure spelling check only; this grants no endpoint or daemon authority. */
export function assertProofDecoderEngineTargetSocketPath(value){check(value===PATH);return PATH;}
function stamp(path,socket=false){
  const st=lstatSync(path,{bigint:true});check(st.uid===0n&&!st.isSymbolicLink()&&realpathSync(path)===path);
  if(socket)check(st.isSocket()&&(st.mode&0o7007n)===0n&&(st.mode&0o600n)===0o600n);
  else check(st.isDirectory()&&(st.mode&0o022n)===0n);
  return [st.dev,st.ino,st.uid,st.gid,st.mode].map(String).join(':');
}
function current(){return ['/','/run',PATH].map((path,i)=>stamp(path,i===2)).join('|');}

/** One retained fixed endpoint per genuine observer, shared by effect and
 * cleanup channels. Root ownership and atomic peer-pidfd establish local
 * endpoint/lifetime facts only. PID 1 may own the systemd-activated socket;
 * neither that fact nor this private object identifies or qualifies dockerd.
 */
export function createProofDecoderEngineTargetEndpoint(options={}){
  const input=engineDataOptions(options,[],['enabled','socketPath','linuxObserver']);
  if(input.enabled!==true)return null;
  assertProofDecoderEngineTargetSocketPath(input.socketPath);
  const observer=assertProofDecoderLinuxObserver(input.linuxObserver);
  const prior=endpoints.get(observer);if(prior){prior.assertCurrent();return prior;}
  const identity=current(),peers=new WeakMap();
  const endpoint=Object.freeze({
    assertCurrent(){check(current()===identity);return true;},
    assertSocket(socket){endpoint.assertCurrent();const peer=peers.get(socket);check(peer);peer.assertAlive();return true;},
    connect(options={}){
      const {allowHalfOpen=false,timeoutMs,signal}=engineDataOptions(options,['timeoutMs','signal'],['allowHalfOpen']);
      check(typeof allowHalfOpen==='boolean'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=500&&signal instanceof AbortSignal&&!signal.aborted);
      endpoint.assertCurrent();
      return new Promise((resolve,reject)=>{
        let socket,peer,timer,settled=false;
        const stop=error=>{
          if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
          if(error){socket?.destroy();peer?.close();reject(Object.assign(new Error('ENGINE_TARGET_ENDPOINT_REQUIRED'),{code:'ENGINE_TARGET_ENDPOINT_REQUIRED'}));}
          else resolve(socket);
        };
        const abort=()=>stop(true);
        try{
          socket=net.createConnection({path:PATH,allowHalfOpen});
          socket.on('error',()=>stop(true));socket.once('close',()=>{peer?.close();stop(true);});
          signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>stop(true),timeoutMs);
          socket.once('connect',()=>{
            try{
              check(!signal.aborted);endpoint.assertCurrent();
              peer=observer.capture(socket,{uid:0,gid:0});peer.assertAlive();endpoint.assertCurrent();
              peers.set(socket,peer);stop(false);
            }catch{stop(true);}
          });
        }catch{stop(true);}
      });
    }
  });
  endpoints.set(observer,endpoint);return endpoint;
}
