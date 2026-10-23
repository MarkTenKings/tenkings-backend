import {requireValue} from './contract.mjs';
import {decoderExact,decoderFreeze} from './proof-decoder-profile.mjs';
import {engineDataOptions,parseProofDecoderEngineJSON} from './proof-decoder-engine-json.mjs';

export const PROOF_DECODER_CONTROL_PROBE_SCHEMA='atlas-proof-decoder-control-probe-v1';
export const PROOF_DECODER_CONTROL_PROBE_MODES=Object.freeze(['NETWORK','PRIVILEGE','READONLY','TMPFS','PIDS','FD','MEMORY_OOM','CPU_QUOTA','CPU_DEADLINE']);
export const PROOF_DECODER_CONTROL_PROBE_BOUNDS=Object.freeze({inputBytes:48,recordBytes:4096,totalOutputBytes:8192,records:2,threadAttempts:40,fdAttempts:80,memoryBytes:671088640,tmpBytesEach:9437184,cpuThreads:4,cpuQuotaMs:2000,cpuDeadlineMs:20000,cooperativeOrdinaryMs:5000,inputOutputMs:1000});
const MARKERS=Object.freeze({classification:'UNVERIFIED',evidenceKind:'PROBE_ONLY',executionAllowed:false,freshPublicationAllowed:false,runtimeQualified:false});
const check=value=>requireValue(value,'DECODER_CONTROL_PROBE_PROTOCOL');
const nonce=value=>check(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value));
const nanoseconds=value=>{check(typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n);return BigInt(value);};
const ids=decoderFreeze({
  NETWORK:['SOCKET_INET','SOCKET_INET6','SOCKET_INET_RAW','SOCKET_INET6_RAW','SOCKET_UNIX','SOCKET_PACKET','SOCKET_ALG','SOCKET_VSOCK','SOCKET_NETLINK'],
  PRIVILEGE:['UID','EUID','GID','EGID','NO_NEW_PRIVS','SECCOMP_MODE','SETUID_ROOT','SETGID_ROOT','CAPSET_ADMIN','UNSHARE_USER','UNSHARE_MOUNT','MOUNT_TMPFS','PTRACE_TRACEME','BPF_MAP','USERFAULTFD','IO_URING','KEYCTL_ID'],
  READONLY:['OPEN_NODE_WRITE','OPEN_WORKER_WRITE'],
  TMPFS:['TMP_CREATE','TMP_WRITTEN','TMP_EXEC_MAP','TMP_UNLINK','SHM_CREATE','SHM_WRITTEN','SHM_EXEC_MAP','SHM_UNLINK'],
  PIDS:['THREADS_CREATED','THREADS_JOINED'],
  FD:['NOFILE_SOFT','NOFILE_HARD','FD_OPENED','FD_CLOSED'],
  MEMORY_OOM:['REGIONS_CREATED','TOUCHED_BYTES','REGIONS_RELEASED'],
  CPU_QUOTA:['THREADS_CREATED','THREADS_JOINED','CPU_ELAPSED_NS'],
  CPU_DEADLINE:['THREADS_CREATED','THREADS_JOINED','CPU_ELAPSED_NS']
});
const reasons=Object.freeze(['NORMAL','BUDGET','CLOCK_ERROR','SYSCALL_ERROR','OWNERSHIP_ERROR','UNEXPECTED_SUCCESS','LIMIT_NOT_REACHED','INTERNAL_ERROR']);
const common=['schema','classification','evidenceKind','executionAllowed','freshPublicationAllowed','runtimeQualified','stage','mode','nonce','pid','startedBootNs'];
function observation(input,mode){
  decoderExact(input,['id','value','error']);check(ids[mode].includes(input.id)&&Number.isSafeInteger(input.value)&&input.value>=-1&&input.value<=1000000000000&&Number.isSafeInteger(input.error)&&input.error>=0&&input.error<=4095);
  if(['UID','EUID','GID','EGID'].includes(input.id))check(input.value===65532&&input.error===0);
  else if(input.id==='NO_NEW_PRIVS')check(input.value===1&&input.error===0);
  else if(input.id==='SECCOMP_MODE')check(input.value===2&&input.error===0);
  else if(input.id==='THREADS_CREATED'||input.id==='THREADS_JOINED')check(input.value>=0&&input.value<=(mode.startsWith('CPU_')?4:40));
  else if(['FD_OPENED','FD_CLOSED','REGIONS_CREATED','REGIONS_RELEASED'].includes(input.id))check(input.value>=0&&input.value<=80);
  else if(input.id==='TOUCHED_BYTES')check(input.value>=0&&input.value<=671088640&&input.value%4096===0);
  else if(input.id.endsWith('_WRITTEN'))check(input.value>=0&&input.value<=9437184);
  else if(!['NOFILE_SOFT','NOFILE_HARD','CPU_ELAPSED_NS'].includes(input.id))check(input.value===-1||input.value===0);
  if(input.value===-1&&!['NOFILE_SOFT','NOFILE_HARD'].includes(input.id))check(input.error>0);
}
function record(bytes,expected,begin){
  const value=parseProofDecoderEngineJSON(bytes,{maxBytes:4096});
  check(value&&value.stage===(begin?'FINAL':'BEGIN'));
  decoderExact(value,begin?[...common,'finishedBootNs','completion','reason','observations']:common);
  check(value.schema===PROOF_DECODER_CONTROL_PROBE_SCHEMA&&Object.entries(MARKERS).every(([key,field])=>value[key]===field)&&value.mode===expected.mode&&value.nonce===expected.nonce&&Number.isSafeInteger(value.pid)&&value.pid>0&&value.pid<=2147483647);nanoseconds(value.startedBootNs);
  if(begin){
    check(value.pid===begin.pid&&value.startedBootNs===begin.startedBootNs&&nanoseconds(value.finishedBootNs)>=nanoseconds(value.startedBootNs)&&['COMPLETE','STOPPED'].includes(value.completion)&&reasons.includes(value.reason)&&(value.completion==='COMPLETE')===(value.reason==='NORMAL')&&Array.isArray(value.observations)&&value.observations.length<=24);
    let previous=-1;for(const item of value.observations){observation(item,value.mode);const position=ids[value.mode].indexOf(item.id);check(position>previous);previous=position;}
    if(value.completion==='COMPLETE')check(!['MEMORY_OOM','CPU_DEADLINE'].includes(value.mode)&&value.observations.length===ids[value.mode].length);
  }
  return decoderFreeze(value);
}
/** The finite input is a challenge, not a permit or executable job descriptor. */
export function encodeProofDecoderControlProbeInput(options){
  const {mode,nonce:challenge}=engineDataOptions(options,['mode','nonce']);check(PROOF_DECODER_CONTROL_PROBE_MODES.includes(mode));nonce(challenge);
  const bytes=Buffer.alloc(48);bytes.write('ATR2P001',0,'ascii');bytes[8]=PROOF_DECODER_CONTROL_PROBE_MODES.indexOf(mode)+1;Buffer.from(challenge,'hex').copy(bytes,16);return bytes;
}
/** Pure bounded claim parser. Missing FINAL is incomplete even when external
 * evidence later proves OOM/death. No Engine/kernel receipt is minted here. */
export function createProofDecoderControlProbeOutputReader(options){
  const {expectedMode,expectedNonce}=engineDataOptions(options,['expectedMode','expectedNonce']);check(PROOF_DECODER_CONTROL_PROBE_MODES.includes(expectedMode));nonce(expectedNonce);
  const expected={mode:expectedMode,nonce:expectedNonce},line=Buffer.alloc(4096);let used=0,total=0,begin=null,final=null,failed=false,ended=false;
  const clear=()=>{line.fill(0);used=0;};
  const snapshot=()=>decoderFreeze({...MARKERS,state:failed?'FAILED':ended?(final?'ENDED':'INCOMPLETE'):final?'FINAL_SEEN':begin?'BEGIN_ONLY':'EMPTY',expectedMode,expectedNonce,totalBytes:total,begin,final});
  return Object.freeze({
    feed(chunk){
      try{check(!failed&&!ended&&Buffer.isBuffer(chunk));total+=chunk.length;check(total<=8192);
        for(const byte of chunk){check(final===null);if(byte===10){check(used>0);const parsed=record(line.subarray(0,used),expected,begin);if(begin)final=parsed;else begin=parsed;clear();}else{check(byte!==13&&used<4095);line[used++]=byte;}}
      }catch(error){failed=true;clear();throw error;}
    },
    end(){try{check(!failed&&!ended&&used===0&&begin!==null&&final!==null);ended=true;clear();return snapshot();}catch(error){failed=true;clear();throw error;}},
    snapshot,
    close(){ended=true;clear();},
    status(){return Object.freeze({...MARKERS,bufferedBytes:used,allocatedBytes:line.length,totalBytes:total,records:(begin?1:0)+(final?1:0),failed,ended});}
  });
}
